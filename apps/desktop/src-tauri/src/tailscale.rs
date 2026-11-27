//! Tailscale through its command-line tool: whether the system's Tailscale is connected (Connect's discovery), and
//! sharing the server here on the person's tailnet (`tailscale serve`, HTTPS inside the tailnet only; never Funnel).
//! Two Tailscales can do it (ADR 0256 §4), each a `Source`: the system's own (its tool is looked up at the places it
//! installs itself, never at a path from a page), or the one the app carries (`tailnet_app.rs`), whose daemon answers
//! only on the app's own socket and is asked with the same binary as its command-line tool (`TS_BE_CLI=1`).

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

/// Why sharing the server here on the tailnet didn't work.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "camelCase")]
pub enum ServeError {
    /// HTTPS (or Serve) is off for the tailnet: its admin turns it on at `url`.
    Https { url: Option<String> },
    /// This computer's user may not change what the system's Tailscale shares (Linux, until `tailscale set --operator`).
    Operator,
    /// Tailscale is missing, or refused (the Mac App Store variant may never share).
    Serve,
    /// The system's Tailscale is installed but not connected on this computer: connecting it (its app, or
    /// `tailscale up`) fixes it.
    NotConnected { app: bool },
    /// The app's own connection isn't signed in to the private network (yet, or the sign-in didn't finish): signing in
    /// at `url` (Tailscale's page, in the browser) fixes it.
    SignIn { url: Option<String> },
    /// The app's own connection was signed in, and its key expired: signing in again fixes it.
    Expired,
    /// The tailnet's admin approves new devices, and hasn't approved this one yet (at `url`).
    NeedsApproval { url: Option<String> },
    /// The person stopped waiting for HTTPS to be allowed (or for the sign-in).
    Stopped,
    /// Tailscale shares it, but the server didn't answer again at its new address (not Tailscale's doing).
    Start,
    /// Reach was turned off, and the server didn't answer again at this computer's own address.
    Back,
}

/// Tailscale's Mac app, which "Open Tailscale" opens.
pub const MAC_APP: &str = "/Applications/Tailscale.app";

/// Which Tailscale a command goes to.
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    /// The system's Tailscale, through its own tool.
    System(PathBuf),
    /// The daemon the app carries (`tailnet_app.rs`): the same binary is its command-line tool, always told the app's
    /// own socket, so it never talks to the system's Tailscale.
    App { bin: PathBuf, socket: String },
}

impl Source {
    pub fn is_app(&self) -> bool {
        matches!(self, Source::App { .. })
    }

    /// The tool, set up to run as the command-line tool of this Tailscale.
    pub fn command(&self) -> Command {
        match self {
            Source::System(cli) => {
                let mut command = Command::new(cli);
                for (key, value) in cli_env(cfg!(target_os = "macos"), std::env::var_os("TERM").is_some()) {
                    command.env(key, value);
                }
                command
            }
            Source::App { bin, socket } => {
                let mut command = Command::new(bin);
                command.env("TS_BE_CLI", "1").arg(socket_flag(socket));
                command
            }
        }
    }
}

/// The CLI's root flag naming the daemon's socket (`--socket` also makes the CLI use only it, never the system
/// Tailscale's: on a Mac the CLI would otherwise look for the Tailscale app's own local port first).
pub fn socket_flag(socket: &str) -> String {
    format!("--socket={socket}")
}

/// The system's tool at the places it installs itself.
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

/// The system's Tailscale, when its tool is there.
pub fn system() -> Option<Source> {
    cli().map(Source::System)
}

/// Whether the system's Tailscale is the Mac App Store variant, which may never share the server (its sandbox).
pub fn mac_app_store() -> bool {
    cfg!(target_os = "macos") && Path::new(MAC_APP).join("Contents").join("_MASReceipt").exists()
}

/// The environment the system's tool is started with. On a Mac, its app binary decides between being the
/// command-line tool and opening the app's own window by its environment: told nothing (and with no terminal), it
/// opens the window, prints that it couldn't run the command and still ends with code 0, so `status --json` isn't
/// JSON. `term`: whether this process has a `TERM` of its own to pass on.
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

/// Runs the tool with `args`: whether it ended well, and what it printed (stdout, then stderr); None when it couldn't
/// start. Taking longer than `wait` stops it (what it printed so far is kept).
pub fn run(source: &Source, args: &[&str], wait: Duration) -> Option<(bool, String)> {
    let ran = crate::run_program(source.command().args(args), wait, &|| false).ok()?;
    Some((ran.code == Some(0), ran.out + &ran.err))
}

/// `tailscale status --json` of `source`, or None when it fails or takes too long.
pub fn status_json_of(source: &Source) -> Option<Value> {
    let (ok, out) = run(source, &["status", "--json"], STATUS_WAIT)?;
    if !ok {
        return None;
    }
    serde_json::from_str(&out).ok()
}

/// The system's Tailscale's `status --json` (Connect's discovery reads its peers).
pub fn status_json() -> Option<Value> {
    status_json_of(&system()?)
}

/// This device's name on the tailnet from `status --json` (`Self.DNSName`), when it is a plain host name.
pub fn device_name(status: &Value) -> Option<String> {
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

/// The system's Tailscale.
pub fn tailnet() -> Tailnet {
    let app = cfg!(target_os = "macos") && Path::new(MAC_APP).is_dir();
    match system() {
        Some(source) => tailnet_of(status_json_of(&source).as_ref(), true, app),
        None => Tailnet::Missing,
    }
}

/// The HTTPS port to share on: 443, unless this device already shares something else there (only the system's
/// Tailscale may: the app's own daemon shares nothing but the server here).
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
/// anything (it returns once HTTPS isn't coming, ADR 0256 §4), so its own exit code is never the proof.
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

/// `serve status --json` of `source`.
fn serve_status(source: &Source) -> Option<Value> {
    run(source, &["serve", "status", "--json"], STATUS_WAIT)
        .filter(|(ok, _)| *ok)
        .and_then(|(_, out)| serde_json::from_str(&out).ok())
}

/// This device's name on `source`'s tailnet, or why it can't share now.
pub fn device_of(source: &Source) -> Result<String, ServeError> {
    let status = status_json_of(source);
    match tailnet_of(status.as_ref(), true, false) {
        Tailnet::On { device } => Ok(device),
        _ if source.is_app() => Err(ServeError::SignIn { url: None }),
        _ => Err(ServeError::NotConnected { app: cfg!(target_os = "macos") && Path::new(MAC_APP).is_dir() }),
    }
}

/// Shares `http://127.0.0.1:<port>` on `source`'s tailnet over HTTPS; the address it answers at. When HTTPS isn't
/// allowed in the tailnet yet, Tailscale names its admin page and waits there until it is: `asks` gets that page at
/// once, and `serve` goes on by itself once the person allowed it, with no time limit of its own (ADR 0256 §3), until
/// `stopped` says so. Its share is then read back (`served_at`) before it counts.
pub fn serve(
    source: &Source,
    port: u16,
    asks: &mut dyn FnMut(&str),
    stopped: &dyn Fn() -> bool,
) -> Result<String, ServeError> {
    let device = device_of(source)?;
    let target = format!("http://127.0.0.1:{port}");
    let https = if source.is_app() { 443 } else { https_port(serve_status(source).as_ref(), &device, &target) };
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
    let mut command = source.command();
    command.args(["serve", "--bg", flag.as_str(), target.as_str()]);
    let ran = crate::run_watched(&mut command, SERVE_WAIT, &mut watch).map_err(|_| ServeError::Serve)?;
    let printed = ran.out + &ran.err;
    match ran.cut {
        Some(Cut::Stopped) => return Err(ServeError::Stopped),
        _ if ran.code != Some(0) => return Err(serve_error(&printed)),
        _ => {}
    }
    if !served_at(serve_status(source).as_ref(), &device, https, &target) {
        // Ended well without sharing: HTTPS is still off in the tailnet.
        return Err(ServeError::Https { url: asked.or_else(|| admin_url(&printed)) });
    }
    Ok(if https == 443 { format!("https://{device}") } else { format!("https://{device}:{https}") })
}

/// Stops sharing the address `public_url` (either HTTPS port the app may have used).
pub fn unserve(source: &Source, public_url: &str) {
    let https = if public_url.rsplit_once(':').is_some_and(|(_, p)| p == "8443") { 8443 } else { 443 };
    let _ = run(source, &["serve", &format!("--https={https}"), "off"], SERVE_WAIT);
}

/// Everything the app's own daemon shares goes (it shares only the server here, and its state keeps the last share
/// across starts: until the server answers again, that address must lead nowhere).
pub fn serve_reset(source: &Source) -> bool {
    run(source, &["serve", "reset"], SERVE_WAIT).is_some_and(|(ok, _)| ok)
}

/// Whether the system's Tailscale lets this computer's user change what it shares (Linux: the person is its
/// operator; elsewhere the system's Tailscale lets its own user).
pub fn may_serve(source: &Source) -> bool {
    if !cfg!(target_os = "linux") || source.is_app() {
        return true;
    }
    let Some((true, out)) = run(source, &["debug", "prefs"], STATUS_WAIT) else { return false };
    let operator = serde_json::from_str::<Value>(&out)
        .ok()
        .and_then(|p| p.get("OperatorUser").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default();
    let user = std::env::var("USER").unwrap_or_default();
    !operator.is_empty() && operator == user
}

#[tauri::command]
pub async fn tailscale_status(webview: tauri::Webview) -> Result<Tailnet, String> {
    if !matches!(webview.label(), "main-app" | "main-cover") {
        return Err("only the app's own windows ask this".into());
    }
    tauri::async_runtime::spawn_blocking(tailnet).await.map_err(|e| e.to_string())
}

/// Tailscale's pages the app opens for the person: Get Tailscale (its download page), Turn it on (the admin page the
/// last `serve` named, or the tailnet's DNS settings, where HTTPS is turned on), the sign-in the app's own connection
/// waits on ("Open the page again"), the admin's list of devices (where a new one is approved, `approve`, and where its
/// key's expiry is turned off, `keyExpiry`), and the admin console. Open Tailscale (its Mac app) is a path, not a page (`tailscale_open`).
pub fn page_url(page: &str, https: Option<String>, sign_in: Option<String>) -> Result<String, String> {
    match page {
        "download" => Ok("https://tailscale.com/download".into()),
        "https" => Ok(https.unwrap_or_else(|| "https://login.tailscale.com/admin/dns".to_string())),
        "signIn" => sign_in.ok_or_else(|| "no sign-in under way".into()),
        "keyExpiry" | "approve" => Ok(crate::tailnet_app::ADMIN_MACHINES.into()),
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
            if !cfg!(target_os = "macos") {
                return Err("only a Mac has Tailscale's app to open".to_string());
            }
            return app.opener().open_path(MAC_APP, None::<&str>).map_err(|e| e.to_string());
        }
        let url = page_url(&page, crate::local_server::https_admin_url(&app), crate::tailnet_app::sign_in_url(&app))?;
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
        assert_eq!(
            serde_json::to_value(ServeError::SignIn { url: None }).unwrap(),
            json!({ "reason": "signIn", "url": null })
        );
        assert_eq!(serde_json::to_value(ServeError::Expired).unwrap(), json!({ "reason": "expired" }));
        assert_eq!(
            serde_json::to_value(ServeError::NeedsApproval {
                url: Some("https://login.tailscale.com/admin/machines".into())
            })
            .unwrap(),
            json!({ "reason": "needsApproval", "url": "https://login.tailscale.com/admin/machines" })
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
    }

    #[test]
    fn the_system_tool_is_told_to_be_the_command_line_one_on_a_mac() {
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
    fn the_app_s_own_daemon_is_asked_on_its_own_socket_only() {
        let source = Source::App {
            bin: PathBuf::from("/Applications/agentes.chat.app/Contents/MacOS/agentes-tailscaled"),
            socket: "/tmp/x/ts.sock".into(),
        };
        let command = source.command();
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, vec!["--socket=/tmp/x/ts.sock".to_string()]);
        assert!(command.get_envs().any(|(k, v)| k == "TS_BE_CLI" && v == Some(OsStr::new("1"))));
        assert!(source.is_app());
        assert!(!Source::System(PathBuf::from("/usr/bin/tailscale")).is_app());
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
        let device = "agentes.tail1234.ts.net";
        let shared = json!({
            "TCP": { "443": { "HTTPS": true } },
            "Web": { "agentes.tail1234.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:4310" } } } }
        });
        assert!(served_at(Some(&shared), device, 443, target));
        // Another port, another device, another target, or nothing shared at all.
        assert!(!served_at(Some(&shared), device, 8443, target));
        assert!(!served_at(Some(&shared), "ana-mac.tail1234.ts.net", 443, target));
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
        assert_eq!(page_url("https", None, None).unwrap(), "https://login.tailscale.com/admin/dns");
        assert_eq!(
            page_url("https", Some("https://login.tailscale.com/f/serve?node=abc".into()), None).unwrap(),
            "https://login.tailscale.com/f/serve?node=abc"
        );
        assert_eq!(
            page_url("signIn", None, Some("https://login.tailscale.com/a/0123".into())).unwrap(),
            "https://login.tailscale.com/a/0123"
        );
        assert!(page_url("signIn", None, None).is_err());
        assert_eq!(page_url("keyExpiry", None, None).unwrap(), "https://login.tailscale.com/admin/machines");
        assert_eq!(page_url("approve", None, None).unwrap(), "https://login.tailscale.com/admin/machines");
        assert!(page_url("file:///etc/passwd", None, None).is_err());
    }
}
