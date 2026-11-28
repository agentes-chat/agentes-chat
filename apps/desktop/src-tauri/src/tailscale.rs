//! Tailscale on this computer, the official one the person installs (ADR 0265 §4: the app carries none), through its
//! own command-line tool: whether it is connected (Connect's discovery, the way people reach the server here), and
//! sharing the server here on the person's tailnet (`tailscale serve`, HTTPS inside the tailnet only; never Funnel).
//! The tool is looked up at the places it installs itself, never at a path from a page.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::{Cut, Watch};

/// `status` gets this long to answer.
const STATUS_WAIT: Duration = Duration::from_secs(4);
/// `serve` gets this long when it asks for nothing.
const SERVE_WAIT: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Tailnet {
    /// No Tailscale on this computer.
    Missing,
    /// Installed, signed out or turned off. `app`: Tailscale's Mac app is there to open, not only its command-line
    /// tool (Homebrew's).
    Off { app: bool },
    /// Connected: this device's own name on the tailnet (`ana-mac.tail1234.ts.net`).
    #[serde(rename_all = "camelCase")]
    On { device: String },
}

/// Why the server here isn't reached from the person's other devices (control/local-server.ts `ServeProblem`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "camelCase")]
pub enum ServeError {
    /// HTTPS (or Serve) is off for the tailnet: its admin turns it on at `url`.
    Https { url: Option<String> },
    /// This computer's user may not change what Tailscale shares (Linux, until `tailscale set --operator`).
    Operator,
    /// Tailscale is missing, or refused (the Mac App Store variant may never share).
    Serve,
    /// Tailscale is installed but not connected on this computer: connecting it (its app, or `tailscale up`) fixes it.
    NotConnected { app: bool },
    /// The person stopped waiting for HTTPS to be allowed.
    Stopped,
    /// It is shared, but the server didn't answer again at its new address (not Tailscale's doing, nor the address's).
    Start,
    /// Reach was turned off, and the server didn't answer again at this computer's own address.
    Back,
    /// The person's own address doesn't lead here (`address.rs`): `status` is the HTTP status of an error answer.
    Address {
        why: crate::address::AddressProblem,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
    },
}

impl From<crate::address::AddressFail> for ServeError {
    fn from(fail: crate::address::AddressFail) -> Self {
        ServeError::Address { why: fail.why, status: fail.status }
    }
}

/// Tailscale's Mac app, which "Open Tailscale" opens.
pub const MAC_APP: &str = "/Applications/Tailscale.app";

/// The tool at the places it installs itself.
pub fn cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let fixed: &[&str] = &[
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
    ];
    #[cfg(target_os = "windows")]
    let fixed: &[&str] = &[r"C:\Program Files\Tailscale\tailscale.exe"];
    #[cfg(target_os = "linux")]
    let fixed: &[&str] = &["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"];
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let fixed: &[&str] = &[];
    fixed.iter().map(PathBuf::from).find(|p| p.is_file())
}

/// Whether the installed Tailscale is the Mac App Store variant (said in Copy details: its sandbox may refuse to share).
pub fn mac_app_store() -> bool {
    cfg!(target_os = "macos") && Path::new(MAC_APP).join("Contents").join("_MASReceipt").exists()
}

/// Whether Tailscale's Mac app is there to open.
fn mac_app() -> bool {
    cfg!(target_os = "macos") && Path::new(MAC_APP).is_dir()
}

/// The environment the tool is started with. On a Mac, its app binary decides between being the command-line
/// tool and opening the app's own window by its environment: told nothing (and with no terminal), it opens the
/// window, prints that it couldn't run the command and still ends with code 0, so `status --json` isn't JSON.
/// `term`: whether this process has a `TERM` of its own to pass on.
fn cli_env(macos: bool, term: bool) -> Vec<(&'static str, &'static OsStr)> {
    if !macos {
        return Vec::new();
    }
    let mut env: Vec<(&'static str, &'static OsStr)> = vec![("TAILSCALE_BE_CLI", OsStr::new("1"))];
    if !term {
        env.push(("TERM", OsStr::new("dumb")));
    }
    env
}

/// The tool, set up to run as the command-line tool (see `cli_env`).
fn command_for(cli: &Path) -> Command {
    let mut command = Command::new(cli);
    for (key, value) in cli_env(cfg!(target_os = "macos"), std::env::var_os("TERM").is_some()) {
        command.env(key, value);
    }
    command
}

/// Runs the tool with `args`: whether it ended well, and what it printed (stdout, then stderr); None when it isn't
/// there or couldn't start. Taking longer than `wait` stops it (what it printed so far is kept).
fn run(args: &[&str], wait: Duration) -> Option<(bool, String)> {
    let ran = crate::run_program(command_for(&cli()?).args(args), wait, &|| false).ok()?;
    Some((ran.code == Some(0), ran.out + &ran.err))
}

/// `tailscale status --json`, or None when the tool isn't there, fails or takes too long.
pub fn status_json() -> Option<Value> {
    let (ok, out) = run(&["status", "--json"], STATUS_WAIT)?;
    if !ok {
        return None;
    }
    serde_json::from_str(&out).ok()
}

/// This device's name on the tailnet from `status --json` (`Self.DNSName`), when it is a plain host name.
fn device_name(status: &Value) -> Option<String> {
    status
        .pointer("/Self/DNSName")
        .and_then(Value::as_str)
        .map(|n| n.trim_end_matches('.').to_ascii_lowercase())
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'))
}

/// What `status --json` says about this device; `app`: whether Tailscale's Mac app is there.
pub fn tailnet_of(status: Option<&Value>, installed: bool, app: bool) -> Tailnet {
    let Some(status) = status else {
        return if installed { Tailnet::Off { app } } else { Tailnet::Missing };
    };
    let running = status.get("BackendState").and_then(Value::as_str) == Some("Running");
    match (running, device_name(status)) {
        (true, Some(device)) => Tailnet::On { device },
        _ => Tailnet::Off { app },
    }
}

/// Tailscale on this computer now. Cheap enough to ask every 2 s while the first run waits for it to be installed or
/// turned on: one `status --json`, or nothing at all while it isn't installed.
pub fn tailnet() -> Tailnet {
    match cli() {
        Some(_) => tailnet_of(status_json().as_ref(), true, mac_app()),
        None => Tailnet::Missing,
    }
}

/// The HTTPS port to share on: 443, unless this device already shares something else there.
fn https_port(serve: Option<&Value>, device: &str, target: &str) -> u16 {
    let taken =
        serve.and_then(|s| web_handlers(s, device, 443)).is_some_and(|handlers| !handlers.to_string().contains(target));
    if taken {
        8443
    } else {
        443
    }
}

/// `serve status --json`'s handlers for `device:port`.
fn web_handlers<'a>(serve: &'a Value, device: &str, port: u16) -> Option<&'a Value> {
    let key = format!("{device}:{port}").replace('~', "~0").replace('/', "~1");
    serve.pointer(&format!("/Web/{key}"))
}

/// Whether `serve status --json` shows `device:https` proxying to `target`: `serve` may end well without sharing
/// anything (it returns once HTTPS isn't coming, ADR 0265 §4), so its own exit code is never the proof.
pub fn served_at(serve: Option<&Value>, device: &str, https: u16, target: &str) -> bool {
    serve
        .and_then(|s| web_handlers(s, device, https))
        .and_then(|h| h.pointer("/Handlers/~1/Proxy"))
        .and_then(Value::as_str)
        .is_some_and(|proxy| proxy.trim_end_matches('/') == target)
}

/// The tailnet's admin page `serve` named, where HTTPS (or Serve) is allowed.
pub fn admin_url(out: &str) -> Option<String> {
    out.split_whitespace()
        .find(|w| w.starts_with("https://login.tailscale.com/"))
        .map(|w| w.trim_end_matches(['.', ',', ')']).to_string())
}

/// Why `serve` failed, from what it printed.
pub fn serve_error(out: &str) -> ServeError {
    let lower = out.to_ascii_lowercase();
    let url = admin_url(out);
    if url.is_some() || lower.contains("https") && (lower.contains("not enabled") || lower.contains("certificate")) {
        ServeError::Https { url }
    } else if lower.contains("access denied") || lower.contains("operator") {
        ServeError::Operator
    } else {
        ServeError::Serve
    }
}

/// `serve status --json`.
fn serve_status() -> Option<Value> {
    run(&["serve", "status", "--json"], STATUS_WAIT)
        .filter(|(ok, _)| *ok)
        .and_then(|(_, out)| serde_json::from_str(&out).ok())
}

/// This device's name on the tailnet, or why it can't share now.
pub fn device() -> Result<String, ServeError> {
    match tailnet() {
        Tailnet::On { device } => Ok(device),
        Tailnet::Off { app } => Err(ServeError::NotConnected { app }),
        Tailnet::Missing => Err(ServeError::Serve),
    }
}

/// Shares `http://127.0.0.1:<port>` on the tailnet over HTTPS; the address it answers at. When HTTPS isn't allowed in
/// the tailnet yet, Tailscale names its admin page and waits there until it is: `asks` gets that page at once, and
/// `serve` goes on by itself once the person allowed it, with no time limit of its own (ADR 0265 §3), until `stopped`
/// says so. Its share is then read back (`served_at`) before it counts.
pub fn serve(port: u16, asks: &mut dyn FnMut(&str), stopped: &dyn Fn() -> bool) -> Result<String, ServeError> {
    let device = device()?;
    let cli = cli().ok_or(ServeError::Serve)?;
    let target = format!("http://127.0.0.1:{port}");
    let https = https_port(serve_status().as_ref(), &device, &target);
    let flag = format!("--https={https}");
    let mut asked: Option<String> = None;
    let mut watch = |so_far: &str| {
        if stopped() {
            return Watch::Stop;
        }
        if asked.is_none() {
            if let Some(url) = admin_url(so_far) {
                asks(&url);
                asked = Some(url);
            }
        }
        if asked.is_some() {
            Watch::WaitUpTo(Duration::MAX)
        } else {
            Watch::Wait
        }
    };
    let mut command = command_for(&cli);
    command.args(["serve", "--bg", flag.as_str(), target.as_str()]);
    let ran = crate::run_watched(&mut command, SERVE_WAIT, &mut watch).map_err(|_| ServeError::Serve)?;
    let printed = ran.out + &ran.err;
    match ran.cut {
        Some(Cut::Stopped) => return Err(ServeError::Stopped),
        _ if ran.code != Some(0) => return Err(serve_error(&printed)),
        _ => {}
    }
    if !served_at(serve_status().as_ref(), &device, https, &target) {
        // Ended well without sharing: HTTPS is still off in the tailnet.
        return Err(ServeError::Https { url: asked.or_else(|| admin_url(&printed)) });
    }
    Ok(if https == 443 { format!("https://{device}") } else { format!("https://{device}:{https}") })
}

/// Stops sharing the address `public_url` (either HTTPS port the app may have used).
pub fn unserve(public_url: &str) {
    let https = if public_url.rsplit_once(':').is_some_and(|(_, p)| p == "8443") { 8443 } else { 443 };
    let _ = run(&["serve", &format!("--https={https}"), "off"], SERVE_WAIT);
}

#[tauri::command]
pub async fn tailscale_status(webview: tauri::Webview) -> Result<Tailnet, String> {
    if !matches!(webview.label(), "main-app" | "main-cover") {
        return Err("only the app's own windows ask this".into());
    }
    tauri::async_runtime::spawn_blocking(tailnet).await.map_err(|e| e.to_string())
}

/// Tailscale's official download page for this system (`std::env::consts::OS`). On a Mac, the standalone app: the App
/// Store variant's sandbox may refuse to share the server here.
pub fn download_url(os: &str) -> &'static str {
    match os {
        "macos" => "https://pkgs.tailscale.com/stable/#macos",
        "windows" => "https://tailscale.com/download/windows",
        "linux" => "https://tailscale.com/download/linux",
        _ => "https://tailscale.com/download",
    }
}

/// Tailscale's pages the app opens for the person: Download Tailscale (`download`), Turn HTTPS on (`https`: the admin
/// page the last `serve` named, or the tailnet's DNS settings, where HTTPS is turned on), and the admin console
/// (`admin`). Open Tailscale (its Mac app, `app`) is a path, not a page (`tailscale_open`).
pub fn page_url(page: &str, https: Option<String>, os: &str) -> Result<String, String> {
    match page {
        "download" => Ok(download_url(os).into()),
        "https" => Ok(https.unwrap_or_else(|| "https://login.tailscale.com/admin/dns".to_string())),
        "admin" => Ok("https://login.tailscale.com/admin".into()),
        _ => Err("unknown page".into()),
    }
}

#[tauri::command]
pub async fn tailscale_open(app: tauri::AppHandle, webview: tauri::Webview, page: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !matches!(webview.label(), "main-app" | "main-cover") {
        return Err("only the app's own windows open this".into());
    }
    // Off the main thread: opening runs a program and waits for it.
    tauri::async_runtime::spawn_blocking(move || {
        if page == "app" {
            if !mac_app() {
                return Err("no Tailscale app to open on this computer".to_string());
            }
            return app.opener().open_path(MAC_APP, None::<&str>).map_err(|e| e.to_string());
        }
        let url = page_url(&page, crate::local_server::https_admin_url(&app), std::env::consts::OS)?;
        app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn why_it_wasnt_shared_as_the_windows_read_it() {
        assert_eq!(
            serde_json::to_value(ServeError::NotConnected { app: true }).unwrap(),
            json!({ "reason": "notConnected", "app": true })
        );
        assert_eq!(serde_json::to_value(ServeError::Back).unwrap(), json!({ "reason": "back" }));
        assert_eq!(serde_json::to_value(ServeError::Https { url: None }).unwrap(), json!({ "reason": "https", "url": null }));
        use crate::address::{AddressFail, AddressProblem};
        assert_eq!(
            serde_json::to_value(ServeError::from(AddressFail::new(AddressProblem::Unreachable))).unwrap(),
            json!({ "reason": "address", "why": "unreachable" })
        );
        assert_eq!(
            serde_json::to_value(ServeError::from(AddressFail { why: AddressProblem::Error, status: Some(502) })).unwrap(),
            json!({ "reason": "address", "why": "error", "status": 502 })
        );
    }

    #[test]
    fn this_device_on_the_tailnet() {
        let on = json!({ "BackendState": "Running", "Self": { "DNSName": "Ana-Mac.tail1234.ts.net." } });
        assert_eq!(tailnet_of(Some(&on), true, true), Tailnet::On { device: "ana-mac.tail1234.ts.net".into() });
        let off = json!({ "BackendState": "Stopped", "Self": { "DNSName": "ana-mac.tail1234.ts.net." } });
        assert_eq!(tailnet_of(Some(&off), true, true), Tailnet::Off { app: true });
        assert_eq!(tailnet_of(None, true, true), Tailnet::Off { app: true });
        // Only the command-line tool (Homebrew's on a Mac): no app to open.
        assert_eq!(tailnet_of(Some(&off), true, false), Tailnet::Off { app: false });
        assert_eq!(tailnet_of(None, false, false), Tailnet::Missing);
        let odd = json!({ "BackendState": "Running", "Self": { "DNSName": "evil name/../x." } });
        assert_eq!(tailnet_of(Some(&odd), true, true), Tailnet::Off { app: true });
        assert_eq!(serde_json::to_value(Tailnet::Off { app: false }).unwrap(), json!({ "state": "off", "app": false }));
        assert_eq!(serde_json::to_value(Tailnet::Missing).unwrap(), json!({ "state": "missing" }));
    }

    #[test]
    fn the_tool_is_told_to_be_the_command_line_one_on_a_mac() {
        let env = cli_env(true, false);
        assert!(env.contains(&("TAILSCALE_BE_CLI", OsStr::new("1"))));
        // No terminal of its own: one is made up, so the Mac app doesn't take the missing `TERM` for a window.
        assert!(env.contains(&("TERM", OsStr::new("dumb"))));
        // A `TERM` already there (a terminal, or a person's own) is passed on untouched.
        assert_eq!(cli_env(true, true), vec![("TAILSCALE_BE_CLI", OsStr::new("1"))]);
        // Elsewhere the tool needs nothing told: Linux and Windows stay as they were.
        assert!(cli_env(false, false).is_empty());
        assert!(cli_env(false, true).is_empty());
    }

    #[test]
    fn https_on_443_unless_something_else_is_there() {
        let target = "http://127.0.0.1:4310";
        let device = "ana-mac.tail1234.ts.net";
        assert_eq!(https_port(None, device, target), 443);
        let ours = json!({ "Web": { "ana-mac.tail1234.ts.net:443": { "Handlers": { "/": { "Proxy": target } } } } });
        assert_eq!(https_port(Some(&ours), device, target), 443);
        let other =
            json!({ "Web": { "ana-mac.tail1234.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:8080" } } } } });
        assert_eq!(https_port(Some(&other), device, target), 8443);
    }

    #[test]
    fn a_share_counts_only_once_serve_status_shows_it() {
        let target = "http://127.0.0.1:4310";
        let device = "ana-mac.tail1234.ts.net";
        let shared = json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "ana-mac.tail1234.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:4310" } } } }
        });
        assert!(served_at(Some(&shared), device, 443, target));
        // Another port, another device, another target, or nothing shared at all.
        assert!(!served_at(Some(&shared), device, 8443, target));
        assert!(!served_at(Some(&shared), "bia-mac.tail1234.ts.net", 443, target));
        assert!(!served_at(Some(&shared), device, 443, "http://127.0.0.1:4311"));
        assert!(!served_at(Some(&json!({})), device, 443, target));
        assert!(!served_at(None, device, 443, target));
    }

    #[test]
    fn why_serve_failed() {
        assert_eq!(
            serve_error("Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc\n"),
            ServeError::Https { url: Some("https://login.tailscale.com/f/serve?node=abc".into()) }
        );
        assert_eq!(serve_error("HTTPS is not enabled for this tailnet"), ServeError::Https { url: None });
        assert_eq!(serve_error("Access denied: serve config denied"), ServeError::Operator);
        assert_eq!(serve_error("something else"), ServeError::Serve);
    }

    #[test]
    fn tailscale_s_pages_the_app_opens() {
        assert_eq!(page_url("https", None, "macos").unwrap(), "https://login.tailscale.com/admin/dns");
        assert_eq!(
            page_url("https", Some("https://login.tailscale.com/f/serve?node=abc".into()), "linux").unwrap(),
            "https://login.tailscale.com/f/serve?node=abc"
        );
        assert_eq!(page_url("admin", None, "windows").unwrap(), "https://login.tailscale.com/admin");
        // The official download, for this system: on a Mac the standalone app.
        assert_eq!(page_url("download", None, "macos").unwrap(), "https://pkgs.tailscale.com/stable/#macos");
        assert_eq!(page_url("download", None, "windows").unwrap(), "https://tailscale.com/download/windows");
        assert_eq!(page_url("download", None, "linux").unwrap(), "https://tailscale.com/download/linux");
        // Only these pages, never one a window names.
        for refused in ["signIn", "keyExpiry", "approve", "file:///etc/passwd", "app"] {
            assert!(page_url(refused, None, "macos").is_err(), "{refused}");
        }
    }
}
