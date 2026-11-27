//! The Tailscale the app carries (ADR 0256 §4): Tailscale's open-source daemon, built with its command-line tool in the
//! same binary (`agentes-tailscaled`, a sidecar next to the app's own program), run by the app as a child in userspace
//! networking: no system extension, no administrator password, its state in the app's own data folder (`tailnet/`),
//! so the device survives an erase of the server here. It joins the person's tailnet as a device of its own, named
//! `agentes`, and shares the server here with `serve` (`tailscale.rs`, never Funnel).
//!
//! Its local control socket is the person's alone: a file in a folder only they may open (macOS, Linux), or a named
//! pipe only they may open (Windows, `--windows-mode=dev`). The child ends with the app whatever way the app ends: on
//! macOS and Linux it reads a pipe only the app holds open (`TS_PARENT_DEATH_FD`), on Windows it is in a Job Object
//! that kills what it holds when the app's handle to it closes.
//!
//! Which Tailscale shares the server here is chosen once and saved (`local-server.json`, `tailnet`): the system's,
//! when it is connected, isn't the Mac App Store variant (which may never share) and lets this person share (Linux's
//! operator); otherwise the app's own. It never flips by itself.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::tailscale::{self, Source};
use crate::Cut;

/// What the app's own connection is doing (`TailnetState`), to the app layer and the popover.
pub const STATE_EVENT: &str = "tailnet://state";
/// A sign-in to the private network under way, stage by stage.
pub const SIGN_IN_EVENT: &str = "tailnet://sign-in";
/// The daemon's file next to the app's own program (Tauri's sidecar name without its target triple).
const BIN: &str = "agentes-tailscaled";
/// The device's name on the tailnet: the address is `agentes.<tailnet>.ts.net`, whatever this computer is called.
const HOSTNAME: &str = "agentes";
/// The daemon's folder in the app's data folder.
const STATE_DIR: &str = "tailnet";
/// The longest socket path both systems take (`sun_path` is 104 bytes on macOS, 108 on Linux).
const SOCKET_MAX: usize = 100;
/// How long a start may take to answer on its socket.
const ANSWER_WAIT: Duration = Duration::from_secs(20);
/// How long the daemon gets to leave the tailnet tidily before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);
/// The device key's expiry is said this long ahead of time (ADR 0256 §4).
pub const EXPIRY_WARN_MS: u64 = 14 * 24 * 3600 * 1000;
/// Where the tailnet's admin approves a new device and turns a device's key expiry off.
pub const ADMIN_MACHINES: &str = "https://login.tailscale.com/admin/machines";
/// Only Tailscale's own sign-in pages are opened from what the daemon prints.
const SIGN_IN_PREFIX: &str = "https://login.tailscale.com/";
/// Its log is started again past this size (the previous one kept as `.1`).
const LOG_MAX: u64 = 4 * 1024 * 1024;

/// Which Tailscale shares the server here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// The system's Tailscale (installed by the person).
    System,
    /// The one the app carries.
    App,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::System => "system",
            Mode::App => "app",
        }
    }
}

/// What that Tailscale is doing (the TS side's `TailnetState`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Starting,
    SignedOut,
    SigningIn,
    NeedsApproval,
    On,
    Expired,
    Off,
    Failing,
}

/// Whether the tailnet lets the device share with HTTPS, as far as the app knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Https {
    Ok,
    NeedsApproval,
    Unknown,
}

/// `{ mode: "none" }`, or the chosen Tailscale and what it is doing (`key_expiry` in Unix milliseconds).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailnetState {
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Phase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_expiry: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub https: Option<Https>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approve_url: Option<String>,
}

impl TailnetState {
    pub fn none() -> Self {
        TailnetState { mode: "none", state: None, device: None, key_expiry: None, https: None, approve_url: None }
    }

    fn of(mode: Mode, state: Phase) -> Self {
        TailnetState { mode: mode.name(), state: Some(state), ..TailnetState::none() }
    }

    /// Signed in and connected, with its name on the tailnet.
    pub fn on(&self) -> bool {
        self.state == Some(Phase::On) && self.device.is_some()
    }
}

/// A stage of a sign-in to the private network (`tailnet://sign-in`): Tailscale's page to sign in at (the app opened
/// it in the browser), the admin's approval of the new device, done (its address), or why it ended.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum SignInStage {
    Url { url: String },
    Approval { url: String },
    Done { device: String },
    Failed { reason: &'static str },
}

#[derive(Default)]
struct Inner {
    /// The daemon now, shared with its watcher (which reaps it).
    child: Option<Arc<Mutex<Child>>>,
    /// Each start's number: a watcher of an older one does nothing.
    generation: u64,
    /// The app wants it running (a start, until `stop`): a crash restarts it.
    wanted: bool,
    /// Starts in a row that ended by themselves.
    failures: u32,
    /// The start whose shares were reset (`serve reset`).
    reset: u64,
    /// The write end of the pipe the daemon reads (`TS_PARENT_DEATH_FD`): closing it ends the daemon.
    #[cfg(unix)]
    death: Option<i32>,
    /// The sign-in page the last `up` named ("Open again").
    sign_in_url: Option<String>,
    /// What the chosen Tailscale was doing at the last read.
    last: Option<TailnetState>,
}

/// The daemon the app carries (managed state).
#[derive(Default)]
pub struct TailnetApp {
    inner: Mutex<Inner>,
    /// One start at a time.
    starting: Mutex<()>,
    /// A sign-in is under way.
    signing_in: AtomicBool,
    /// Its Cancel.
    sign_in_stop: AtomicBool,
}

fn inner(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<TailnetApp>().inner().inner.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ───────────────────────────── where it lives ─────────────────────────────

/// The daemon's binary next to the app's own program (None in a build without it).
pub fn bin() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?.parent()?.join(format!("{BIN}{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}

/// The daemon's state, certificates and logs: the app's own data folder, never the server here's (`~/.agentes`).
pub fn state_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join(STATE_DIR))
}

/// The daemon's control socket. macOS and Linux: `ts.sock` in its own folder (0700) when the path fits a socket's
/// length, else the person's own temporary folder (macOS's `$TMPDIR` is per person) or runtime folder (Linux's
/// `$XDG_RUNTIME_DIR`), else a folder of their own under `/tmp`. Windows: a named pipe with their account's SID in its
/// name, which the daemon makes theirs alone (`--windows-mode=dev`).
pub fn socket_for(state: &Path, os: &str, tmp: Option<&Path>, runtime: Option<&Path>, uid: u32, sid: Option<&str>) -> String {
    if os == "windows" {
        let who = sid.unwrap_or("user");
        return format!(r"\\.\pipe\agentes-tailscaled-{who}");
    }
    let own = state.join("ts.sock").to_string_lossy().into_owned();
    if own.len() <= SOCKET_MAX {
        return own;
    }
    let near = match os {
        "macos" => tmp.map(|t| t.join("agentes-tailscaled.sock")),
        _ => runtime.map(|r| r.join("agentes-tailscaled.sock")),
    };
    match near.map(|p| p.to_string_lossy().into_owned()).filter(|p| p.len() <= SOCKET_MAX) {
        Some(path) => path,
        None => format!("/tmp/agentes-tailscaled-{uid}/ts.sock"),
    }
}

/// This person's Windows account SID (`whoami /user`), read once.
#[cfg(windows)]
fn windows_sid() -> Option<String> {
    static SID: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    SID.get_or_init(|| {
        let out = crate::no_console(&mut Command::new("whoami")).args(["/user", "/fo", "csv", "/nh"]).output().ok()?;
        sid_in(&String::from_utf8_lossy(&out.stdout))
    })
    .clone()
}

/// The SID in `whoami /user /fo csv /nh`'s line (`"pc\ana","S-1-5-21-…"`).
pub fn sid_in(line: &str) -> Option<String> {
    line.split(',')
        .map(|f| f.trim().trim_matches('"'))
        .find(|f| f.starts_with("S-1-") && f.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'S'))
        .map(str::to_string)
}

fn socket(app: &AppHandle) -> Option<String> {
    let state = state_dir(app)?;
    #[cfg(windows)]
    let sid = windows_sid();
    #[cfg(not(windows))]
    let sid: Option<String> = None;
    #[cfg(unix)]
    // SAFETY: getuid never fails.
    let uid = unsafe { libc::getuid() } as u32;
    #[cfg(not(unix))]
    let uid = 0;
    let tmp = std::env::var_os("TMPDIR").map(PathBuf::from);
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
    Some(socket_for(&state, std::env::consts::OS, tmp.as_deref(), runtime.as_deref(), uid, sid.as_deref()))
}

/// The app's own Tailscale as a `Source`, when this build carries it.
pub fn app_source(app: &AppHandle) -> Option<Source> {
    Some(Source::App { bin: bin()?, socket: socket(app)? })
}

/// The chosen Tailscale as a `Source` (None before the choice, or when it isn't there any longer).
pub fn source(app: &AppHandle) -> Option<Source> {
    match crate::local_server::tailnet_mode(app)? {
        Mode::System => tailscale::system(),
        Mode::App => app_source(app),
    }
}

/// The choice made now when there is none yet (ADR 0256 §4): the system's Tailscale when it is connected, may share
/// and lets this person share; else the app's own. Kept from then on (saved with the server here).
pub fn choose(app: &AppHandle) -> Mode {
    if let Some(mode) = crate::local_server::tailnet_mode(app) {
        return mode;
    }
    let system_ok = || {
        let Some(system) = tailscale::system() else { return false };
        !tailscale::mac_app_store()
            && matches!(
                tailscale::tailnet_of(tailscale::status_json_of(&system).as_ref(), true, false),
                tailscale::Tailnet::On { .. }
            )
            && tailscale::may_serve(&system)
    };
    let mode = if bin().is_none() || system_ok() { Mode::System } else { Mode::App };
    crate::local_server::set_tailnet_mode(app, Some(mode));
    mode
}

// ───────────────────────────── what it says ─────────────────────────────

/// Unix milliseconds of an RFC 3339 time (`2027-05-25T10:00:00Z`, fractions and offsets too), as `status --json`
/// writes `KeyExpiry`.
pub fn rfc3339_ms(text: &str) -> Option<u64> {
    let text = text.trim();
    let (date, rest) = text.split_once(['T', 't', ' '])?;
    let mut ymd = date.split('-');
    let year: i64 = ymd.next()?.parse().ok()?;
    let month: i64 = ymd.next()?.parse().ok()?;
    let day: i64 = ymd.next()?.parse().ok()?;
    let zone_at = rest.find(['Z', 'z', '+', '-']).unwrap_or(rest.len());
    let (clock, zone) = rest.split_at(zone_at);
    let mut hms = clock.split(':');
    let hour: i64 = hms.next()?.parse().ok()?;
    let minute: i64 = hms.next()?.parse().ok()?;
    let seconds = hms.next().unwrap_or("0");
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let second: i64 = whole.parse().ok()?;
    let millis: i64 = format!("{fraction:0<3}").get(..3)?.parse().unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let offset = match zone {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let (h, m) = zone[1..].split_once(':').unwrap_or((&zone[1..], "0"));
            sign * (h.parse::<i64>().ok()? * 3600 + m.parse::<i64>().ok()? * 60)
        }
    };
    // Days since 1970 of a civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hour * 3600 + minute * 60 + second - offset;
    u64::try_from(secs * 1000 + millis).ok()
}

/// What `status --json` says: the phase, this device's name, and its key's expiry. A key past its expiry (or marked
/// expired) waiting for a sign-in is `Expired`; one that never signed in is `SignedOut`.
pub fn phase_of(status: &Value, now: u64) -> (Phase, Option<String>, Option<u64>) {
    let device = tailscale::device_name(status);
    let expiry = status.pointer("/Self/KeyExpiry").and_then(Value::as_str).and_then(rfc3339_ms);
    let marked = status.pointer("/Self/Expired").and_then(Value::as_bool).unwrap_or(false);
    let phase = match status.get("BackendState").and_then(Value::as_str).unwrap_or_default() {
        "Running" if device.is_some() => Phase::On,
        "Running" | "Starting" | "NoState" => Phase::Starting,
        "NeedsLogin" if marked || expiry.is_some_and(|e| e <= now) => Phase::Expired,
        "NeedsLogin" => Phase::SignedOut,
        "NeedsMachineAuth" => Phase::NeedsApproval,
        "Stopped" => Phase::Off,
        _ => Phase::Failing,
    };
    (phase, device, expiry)
}

/// `tailscale up --json`'s blocks: the sign-in page (`AuthURL`), the state it reached, and an error.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpBlock {
    pub auth_url: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Every whole JSON block in what `up --json` printed so far (two or more, pretty-printed, with the daemon's own lines
/// around them); a block still being written is left for the next read.
pub fn up_blocks(text: &str) -> Vec<UpBlock> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(found) = text[at..].find('{') {
        let start = at + found;
        let mut stream = serde_json::Deserializer::from_str(&text[start..]).into_iter::<Value>();
        match stream.next() {
            Some(Ok(Value::Object(block))) => {
                let field = |name: &str| {
                    block.get(name).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
                };
                out.push(UpBlock { auth_url: field("AuthURL"), state: field("BackendState"), error: field("Error") });
                at = start + stream.byte_offset();
            }
            Some(Err(e)) if e.is_eof() => break,
            _ => at = start + 1,
        }
    }
    out
}

/// `tailscale up`'s arguments for the app's own device: its JSON blocks, every setting not named here back to its
/// default, no time limit (the person signs in in the browser), named `agentes`, and nothing of the tailnet's DNS or
/// routes taken over by this computer (the app only shares the server here). `renew`: a new sign-in even while signed
/// in (its key about to expire).
pub fn up_args(hostname: &str, renew: bool) -> Vec<String> {
    let mut args: Vec<String> =
        ["up", "--json", "--reset", "--timeout=0", hostname, "--accept-dns=false", "--accept-routes=false"]
            .iter()
            .map(|a| a.to_string())
            .collect();
    if renew {
        args.push("--force-reauth".into());
    }
    args
}

/// A sign-in page the app may open: Tailscale's own, over https, nothing else the daemon could print.
pub fn sign_in_page(url: &str) -> bool {
    url.starts_with(SIGN_IN_PREFIX) && url.len() <= 2048 && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

// ───────────────────────────── the daemon ─────────────────────────────

/// Whether the daemon the app started is still there.
fn running(app: &AppHandle) -> bool {
    let child = inner(app).child.clone();
    child.is_some_and(|c| matches!(c.lock().unwrap_or_else(|e| e.into_inner()).try_wait(), Ok(None)))
}

/// Starts the daemon unless it runs, waits for it to answer on its socket, and resets what it shares once per start.
pub fn ensure_started(app: &AppHandle) -> Result<Source, String> {
    let tailnet = app.state::<TailnetApp>();
    let _one = tailnet.starting.lock().unwrap_or_else(|e| e.into_inner());
    let source = app_source(app).ok_or("this build doesn't carry Tailscale")?;
    inner(app).wanted = true;
    if !running(app) {
        spawn(app, &source)?;
    }
    let deadline = Instant::now() + ANSWER_WAIT;
    while tailscale::status_json_of(&source).is_none() {
        if Instant::now() > deadline || !running(app) {
            return Err("Tailscale didn't answer".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    // Windows: the pipe's name is known to every account on this computer, and the CLI doesn't check who answers on
    // a pipe it is named: the one that answered must be the daemon this app started (a pipe made `--windows-mode=dev`
    // is this person's alone, so nobody else can add an instance of it once that holds).
    #[cfg(windows)]
    {
        let ours = inner(app).child.as_ref().map(|c| c.lock().unwrap_or_else(|e| e.into_inner()).id());
        if let Source::App { socket, .. } = &source {
            if ours.is_none() || pipe_server_pid(socket) != ours {
                stop(app);
                return Err("another program answers on the daemon's pipe".into());
            }
        }
    }
    let generation = inner(app).generation;
    if inner(app).reset != generation {
        // Its state keeps the last share: until the server here answers again, its address leads nowhere.
        if tailscale::serve_reset(&source) {
            inner(app).reset = generation;
        }
    }
    Ok(source)
}

/// Starts it in the background (the app opens with the server here shared by it).
pub fn start_in_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(why) = ensure_started(&app) {
            crate::health::note(&app, &format!("tailscaled: {why}"));
        }
        refresh(&app);
    });
}

fn log_path(state: &Path) -> PathBuf {
    state.join("logs").join("tailscaled.log")
}

/// Its log, started again when it grew past `LOG_MAX`.
fn open_log(state: &Path) -> io::Result<fs::File> {
    let path = log_path(state);
    crate::local_server::make_private_dir(path.parent().unwrap_or(state))?;
    if fs::metadata(&path).is_ok_and(|m| m.len() > LOG_MAX) {
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }
    fs::OpenOptions::new().create(true).append(true).open(&path)
}

/// The arguments it starts with (`--windows-mode=dev` on Windows: run by a person, its pipe theirs alone).
pub fn daemon_args(state: &Path, socket: &str, windows: bool) -> Vec<String> {
    let mut args = vec![
        "--tun=userspace-networking".to_string(),
        format!("--statedir={}", state.to_string_lossy()),
        format!("--socket={socket}"),
        // Any free UDP port: the device needs none of its own.
        "--port=0".to_string(),
        // Nothing of it is sent to Tailscale's log service.
        "--no-logs-no-support".to_string(),
    ];
    if windows {
        args.push("--windows-mode=dev".to_string());
    }
    args
}

fn spawn(app: &AppHandle, source: &Source) -> Result<(), String> {
    let Source::App { bin, socket } = source else { return Err("not the app's own Tailscale".into()) };
    let state = state_dir(app).ok_or("no data folder")?;
    crate::local_server::make_private_dir(&state).map_err(|e| e.to_string())?;
    stop_leftover(&state, bin);
    #[cfg(unix)]
    prepare_socket(socket)?;
    let log = open_log(&state).map_err(|e| e.to_string())?;
    let mut command = Command::new(bin);
    crate::no_console(&mut command)
        .args(daemon_args(&state, socket, cfg!(windows)))
        .env("TS_LOGS_DIR", state.join("logs"))
        .env_remove("TS_BE_CLI")
        .env_remove("TAILSCALE_BE_CLI")
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(unix)]
    let death = {
        let (read, write) = death_pipe().map_err(|e| e.to_string())?;
        command.env("TS_PARENT_DEATH_FD", read.to_string());
        {
            use std::os::unix::process::CommandExt;
            // SAFETY: only `fcntl` runs between fork and exec; it is async-signal-safe.
            unsafe {
                command.pre_exec(move || {
                    // The read end stays open across exec in the daemon alone (both ends are close-on-exec in the app,
                    // so no other child of the app holds them and the daemon sees the app's end close).
                    if libc::fcntl(read, libc::F_SETFD, 0) == -1 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        (read, write)
    };
    let spawned = command.spawn();
    #[cfg(unix)]
    {
        // SAFETY: the app's copy of the read end; the daemon has its own after exec.
        unsafe { libc::close(death.0) };
        if spawned.is_err() {
            // SAFETY: the write end, unused.
            unsafe { libc::close(death.1) };
        }
    }
    let child = spawned.map_err(|e| e.to_string())?;
    #[cfg(windows)]
    tie_to_app(&child);
    let pid = child.id();
    let _ = fs::write(state.join("tailscaled.pid"), json!({ "pid": pid, "bin": bin }).to_string());
    let child = Arc::new(Mutex::new(child));
    let generation = {
        let mut inner = inner(app);
        #[cfg(unix)]
        {
            if let Some(old) = inner.death.replace(death.1) {
                // SAFETY: an older start's write end.
                unsafe { libc::close(old) };
            }
        }
        inner.generation += 1;
        inner.child = Some(child.clone());
        inner.generation
    };
    let app = app.clone();
    std::thread::spawn(move || watch(&app, child, generation));
    Ok(())
}

/// Waits for the daemon to end; one that ended by itself while the app wants it starts again (1 s doubling to 60 s).
fn watch(app: &AppHandle, child: Arc<Mutex<Child>>, generation: u64) {
    loop {
        if !matches!(child.lock().unwrap_or_else(|e| e.into_inner()).try_wait(), Ok(None)) {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    let delay = {
        let mut inner = inner(app);
        if inner.generation != generation || !inner.wanted {
            return;
        }
        inner.child = None;
        inner.failures += 1;
        crate::runners::backoff(inner.failures)
    };
    crate::health::note(app, "tailscaled ended by itself: starting it again");
    refresh(app);
    std::thread::sleep(delay);
    let again = {
        let inner = inner(app);
        inner.generation == generation && inner.wanted && inner.child.is_none()
    };
    if again {
        match ensure_started(app) {
            Ok(_) => inner(app).failures = 0,
            Err(why) => crate::health::note(app, &format!("tailscaled: {why}")),
        }
        refresh(app);
    }
}

/// Stops the daemon (quitting, or the server here no longer shared by it): it leaves the tailnet's live list, and its
/// state stays for the next start.
pub fn stop(app: &AppHandle) {
    let child = {
        let mut inner = inner(app);
        inner.wanted = false;
        inner.generation += 1;
        inner.child.take()
    };
    if let Some(child) = child {
        let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
        #[cfg(unix)]
        {
            // SAFETY: a signal to the daemon this app started, still its child (not reaped yet).
            unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
            let deadline = Instant::now() + STOP_GRACE;
            while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(unix)]
    if let Some(fd) = inner(app).death.take() {
        // SAFETY: the app's write end of the daemon's pipe.
        unsafe { libc::close(fd) };
    }
    if let Some(state) = state_dir(app) {
        let _ = fs::remove_file(state.join("tailscaled.pid"));
    }
}

/// A daemon left from an app that ended without stopping it (its pipe normally ends it with the app): stopped when
/// its pid file names a process that still runs this folder's daemon.
fn stop_leftover(state: &Path, bin: &Path) {
    #[cfg(unix)]
    {
        let Ok(text) = fs::read_to_string(state.join("tailscaled.pid")) else { return };
        let Some(pid) = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["pid"].as_u64()) else { return };
        let Ok(pid) = libc::pid_t::try_from(pid) else { return };
        let Ok(out) = Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output() else { return };
        let line = String::from_utf8_lossy(&out.stdout);
        let statedir = format!("--statedir={}", state.to_string_lossy());
        if line.contains(&*bin.to_string_lossy()) && line.contains(&statedir) {
            // SAFETY: a process running this app's daemon on this folder.
            unsafe { libc::kill(pid, libc::SIGTERM) };
            let deadline = Instant::now() + STOP_GRACE;
            // SAFETY: signal 0 only checks that it exists.
            while Instant::now() < deadline && unsafe { libc::kill(pid, 0) } == 0 {
                std::thread::sleep(Duration::from_millis(100));
            }
            // SAFETY: as above.
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
    }
    #[cfg(not(unix))]
    let _ = (state, bin);
}

/// The socket's folder exists and is this person's alone, and no stale socket file is left in it.
#[cfg(unix)]
fn prepare_socket(socket: &str) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let path = Path::new(socket);
    let dir = path.parent().ok_or("no socket folder")?;
    if !dir.exists() {
        crate::local_server::make_private_dir(dir).map_err(|e| e.to_string())?;
    }
    let meta = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    // SAFETY: getuid never fails.
    let me = unsafe { libc::getuid() };
    if meta.file_type().is_symlink() || meta.uid() != me {
        return Err("the socket's folder isn't this person's".into());
    }
    if dir.starts_with("/tmp") {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_file(path);
    Ok(())
}

/// A pipe whose ends both close on exec (`pipe2` isn't on macOS).
#[cfg(unix)]
fn death_pipe() -> io::Result<(i32, i32)> {
    let mut fds = [0 as libc::c_int; 2];
    // SAFETY: `fds` has room for the two ends.
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    for fd in fds {
        // SAFETY: an end just made.
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    Ok((fds[0], fds[1]))
}

/// Windows: the daemon goes into a Job Object that kills what it holds when its last handle closes, which the app
/// keeps until it ends (however it ends).
#[cfg(windows)]
fn tie_to_app(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    static JOB: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
    let job = JOB.get_or_init(|| {
        // SAFETY: a new, unnamed job object, configured before any process is in it; its handle is kept for the app's
        // life (it is never closed: the system closes it as the app ends, which kills the daemon).
        unsafe {
            let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(job.0 as usize)
        }
    });
    if let Some(job) = job {
        // SAFETY: the job made above and the daemon's own process handle, both open.
        unsafe {
            let _ = AssignProcessToJobObject(HANDLE(*job as *mut std::ffi::c_void), HANDLE(child.as_raw_handle()));
        }
    }
}

/// The server process of a named pipe (its client end opened for a moment): which program answers there.
#[cfg(windows)]
fn pipe_server_pid(pipe: &str) -> Option<u32> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
    let file = fs::OpenOptions::new().read(true).write(true).open(pipe).ok()?;
    let mut pid = 0u32;
    // SAFETY: the handle is the open client end of the pipe, kept by `file` for the call, and `pid` has room.
    unsafe { GetNamedPipeServerProcessId(HANDLE(file.as_raw_handle()), &mut pid) }.ok()?;
    Some(pid)
}

/// The end of the daemon's log, for "Copy details": never a line with a sign-in page in it (whoever opened one could
/// add the device to their own tailnet).
pub fn log_tail(app: &AppHandle) -> String {
    let Some(path) = state_dir(app).map(|s| log_path(&s)) else { return String::new() };
    let Ok(mut file) = fs::File::open(path) else { return String::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(8192)));
    let mut out = Vec::new();
    let _ = file.take(8192).read_to_end(&mut out);
    scrubbed(&String::from_utf8_lossy(&out))
}

/// A log's lines without those that name a sign-in page (`AuthURL`, `login.tailscale.com/a/…`).
pub fn scrubbed(log: &str) -> String {
    log.lines()
        .filter(|l| !l.contains("AuthURL") && !l.contains("/a/") && !l.to_ascii_lowercase().contains("authurl"))
        .collect::<Vec<_>>()
        .join("\n")
}

// ───────────────────────────── its state ─────────────────────────────

/// What the chosen Tailscale is doing now (runs its `status`; never on the main thread).
pub fn read(app: &AppHandle) -> TailnetState {
    let Some(mode) = crate::local_server::tailnet_mode(app) else { return TailnetState::none() };
    let signing_in = app.state::<TailnetApp>().signing_in.load(SeqCst);
    let status = match mode {
        Mode::System => match tailscale::system() {
            Some(system) => tailscale::status_json_of(&system),
            None => return TailnetState::of(mode, Phase::Off),
        },
        Mode::App => {
            let Some(source) = app_source(app) else { return TailnetState::of(mode, Phase::Failing) };
            if !running(app) {
                let (wanted, failures) = {
                    let inner = inner(app);
                    (inner.wanted, inner.failures)
                };
                let phase = match (wanted, failures) {
                    (true, 0) => Phase::Starting,
                    (true, _) => Phase::Failing,
                    (false, _) => Phase::Off,
                };
                return TailnetState::of(mode, phase);
            }
            tailscale::status_json_of(&source)
        }
    };
    let Some(status) = status else {
        return TailnetState::of(mode, if mode == Mode::System { Phase::Off } else { Phase::Failing });
    };
    let (phase, device, key_expiry) = phase_of(&status, now_ms());
    let phase = if signing_in && phase != Phase::On && phase != Phase::NeedsApproval { Phase::SigningIn } else { phase };
    TailnetState { mode: mode.name(), state: Some(phase), device, key_expiry, https: None, approve_url: None }
}

/// Reads it again; a change is kept and told (`tailnet://state`, with what the server here adds: HTTPS).
pub fn refresh(app: &AppHandle) -> TailnetState {
    let now = read(app);
    let changed = {
        let mut inner = inner(app);
        let changed = inner.last.as_ref() != Some(&now);
        inner.last = Some(now.clone());
        changed
    };
    if changed {
        emit_state(app);
        crate::local_server::tailnet_changed(app);
    }
    now
}

/// The last read (`refresh`), without asking Tailscale again: what the server here's status carries.
pub fn cached(app: &AppHandle) -> TailnetState {
    let last = inner(app).last.clone();
    match crate::local_server::tailnet_mode(app) {
        None => TailnetState::none(),
        Some(mode) => match last {
            Some(last) if last.mode == mode.name() => last,
            _ => TailnetState::of(mode, Phase::Starting),
        },
    }
}

/// Forgets the last read (the choice changed).
pub fn forget(app: &AppHandle) {
    inner(app).last = None;
}

fn emit_state(app: &AppHandle) {
    let state = crate::local_server::tailnet_state(app);
    for label in [crate::app_layer::LABEL, "popover"] {
        let _ = app.emit_to(label, STATE_EVENT, &state);
    }
}

fn say_sign_in(app: &AppHandle, stage: &SignInStage) {
    for label in [crate::app_layer::LABEL, "popover"] {
        let _ = app.emit_to(label, SIGN_IN_EVENT, stage);
    }
}

/// The sign-in page the last `up` named, for "Open again".
pub fn sign_in_url(app: &AppHandle) -> Option<String> {
    inner(app).sign_in_url.clone()
}

/// Signs the app's own connection in to the person's tailnet (ADR 0256 §3): `up` names Tailscale's page, which the
/// app opens in the browser, and waits there with no time limit of its own until the person signed in (and, where the
/// tailnet's admin approves new devices, until they did), Cancel (`tailnet_sign_in_cancel`, or `stop` saying so: the
/// setup's Cancel, "Stop waiting") or quitting. Ok: the device's address. Err: `busy`, `start` (the daemon didn't
/// answer), `cancelled` or `failed`.
pub fn sign_in(app: &AppHandle, stop: &dyn Fn() -> bool) -> Result<String, &'static str> {
    use tauri_plugin_opener::OpenerExt;
    let tailnet = app.state::<TailnetApp>();
    if tailnet.signing_in.swap(true, SeqCst) {
        return Err("busy");
    }
    struct Done<'a>(&'a AtomicBool);
    impl Drop for Done<'_> {
        fn drop(&mut self) {
            self.0.store(false, SeqCst);
        }
    }
    let _done = Done(&tailnet.signing_in);
    tailnet.sign_in_stop.store(false, SeqCst);
    // Signing in is choosing the app's own connection: with nothing chosen yet, it is chosen now; from the system's,
    // the share moves over (`use_tailnet`).
    match crate::local_server::tailnet_mode(app) {
        Some(Mode::App) => {}
        None => {
            crate::local_server::set_tailnet_mode(app, Some(Mode::App));
            forget(app);
        }
        Some(Mode::System) => {
            if let Err(why) = crate::local_server::use_tailnet(app, Mode::App) {
                crate::health::note(app, &format!("tailscaled: {why}"));
                say_sign_in(app, &SignInStage::Failed { reason: "start" });
                return Err("start");
            }
        }
    }
    let source = match ensure_started(app) {
        Ok(source) => source,
        Err(why) => {
            crate::health::note(app, &format!("tailscaled: {why}"));
            say_sign_in(app, &SignInStage::Failed { reason: "start" });
            return Err("start");
        }
    };
    // Signed in already, ahead of its key's expiry ("Sign in again" while it is about to expire): a new sign-in renews
    // the key; otherwise `up` would only say it runs.
    let renew = refresh(app).state == Some(Phase::On);
    let hostname = format!("--hostname={HOSTNAME}");
    let mut command = source.command();
    command.args(up_args(&hostname, renew));
    let mut seen = 0;
    let mut error: Option<String> = None;
    let stopped = || tailnet.sign_in_stop.load(SeqCst) || crate::local_server::cancelled(app) || stop();
    let mut watch = |so_far: &str| {
        if stopped() {
            return crate::Watch::Stop;
        }
        let blocks = up_blocks(so_far);
        for block in blocks.iter().skip(seen) {
            if let Some(url) = block.auth_url.as_deref().filter(|u| sign_in_page(u)) {
                let new = inner(app).sign_in_url.as_deref() != Some(url);
                if new {
                    inner(app).sign_in_url = Some(url.to_string());
                    let _ = app.opener().open_url(url, None::<&str>);
                    say_sign_in(app, &SignInStage::Url { url: url.to_string() });
                }
            }
            if block.state.as_deref() == Some("NeedsMachineAuth") {
                say_sign_in(app, &SignInStage::Approval { url: ADMIN_MACHINES.to_string() });
                refresh(app);
            }
            if let Some(why) = &block.error {
                error = Some(why.clone());
            }
        }
        seen = blocks.len();
        crate::Watch::WaitUpTo(Duration::MAX)
    };
    let ran = crate::run_watched(&mut command, Duration::MAX, &mut watch);
    let cut = ran.as_ref().ok().and_then(|r| r.cut.as_ref().map(|c| *c == Cut::Stopped));
    // Whatever `up` said, the daemon's own state decides (it may have ended before printing its last block). When the
    // command-line tool ended by itself without an error while the person is still on Tailscale's page (it died, or
    // its connection to the daemon dropped), the daemon is followed instead, with the same lack of a time limit.
    let read = || {
        tailscale::status_json_of(&source).map(|s| phase_of(&s, now_ms())).unwrap_or((Phase::Failing, None, None))
    };
    let (mut phase, mut device, _) = read();
    let shown = inner(app).sign_in_url.is_some();
    if cut.is_none() && error.is_none() && shown {
        while matches!(phase, Phase::SignedOut | Phase::NeedsApproval | Phase::Starting) && running(app) && !stopped() {
            std::thread::sleep(Duration::from_secs(1));
            (phase, device, _) = read();
        }
    }
    let cut = if cut.is_none() && stopped() { Some(true) } else { cut };
    inner(app).sign_in_url = None;
    refresh(app);
    match (phase, device) {
        (Phase::On, Some(device)) => {
            say_sign_in(app, &SignInStage::Done { device: device.clone() });
            Ok(device)
        }
        _ if cut == Some(true) => {
            say_sign_in(app, &SignInStage::Failed { reason: "cancelled" });
            Err("cancelled")
        }
        _ => {
            let why = error.or_else(|| ran.err().map(|e| e.to_string())).unwrap_or_default();
            crate::health::note(app, &format!("tailscale up didn't finish: {why}"));
            say_sign_in(app, &SignInStage::Failed { reason: "failed" });
            Err("failed")
        }
    }
}

/// Signs the app's own connection out of the tailnet (its device leaves the person's list once its key is gone).
pub fn sign_out(app: &AppHandle) {
    if let Some(source) = app_source(app).filter(|_| running(app)) {
        let _ = tailscale::run(&source, &["logout"], Duration::from_secs(15));
    }
    refresh(app);
}

// ───────────────────────────── commands ─────────────────────────────

/// What the chosen Tailscale is doing (the app's own connection is started first when it is the one chosen).
#[tauri::command]
pub async fn tailnet_status(app: AppHandle, webview: tauri::Webview) -> Result<TailnetState, String> {
    crate::local_server::app_window(&webview, &["main-app", "popover", "main-cover"])?;
    tauri::async_runtime::spawn_blocking(move || {
        if crate::local_server::tailnet_mode(&app) == Some(Mode::App) {
            let _ = ensure_started(&app);
        }
        refresh(&app);
        crate::local_server::tailnet_state(&app)
    })
    .await
    .map_err(|e| e.to_string())
}

/// "Sign in to Tailscale" (the first run's step, and again once its key expired): resolves with the device's address;
/// rejects with `busy`, `start`, `cancelled` or `failed`. Its stages arrive at `tailnet://sign-in`.
#[tauri::command]
pub async fn tailnet_sign_in(app: AppHandle, webview: tauri::Webview) -> Result<Value, String> {
    // Also the cover's "Turn the network on" over a workspace it can't reach (ADR 0256).
    crate::local_server::app_window(&webview, &["main-app", "main-cover"])?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let device = sign_in(&app, &|| false).map_err(str::to_string)?;
        // With reach on, the server here is shared again now (its key had expired, or it was never signed in), not at
        // the next minute's check.
        if crate::local_server::is_running(&app) {
            crate::local_server::ensure_served(&app);
        }
        Ok(json!({ "device": device }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Use the app's connection" / "Use the Tailscale on this computer": which Tailscale shares the server here from now
/// on (`local_server::use_tailnet`: the other one stops sharing it, and its address for people moves to the new one's,
/// which the phone and the team open from then on).
#[tauri::command]
pub async fn tailnet_use_source(app: AppHandle, webview: tauri::Webview, mode: Mode) -> Result<(), String> {
    crate::local_server::app_window(&webview, &["main-app"])?;
    tauri::async_runtime::spawn_blocking(move || crate::local_server::use_tailnet(&app, mode))
        .await
        .map_err(|e| e.to_string())?
}

/// Cancel while signing in: `up` ends, and the sign-in rejects with `cancelled`.
#[tauri::command]
pub fn tailnet_sign_in_cancel(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    crate::local_server::app_window(&webview, &["main-app"])?;
    app.state::<TailnetApp>().sign_in_stop.store(true, SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn up_json_s_two_blocks_as_tailscale_prints_them() {
        let printed = "{\n\t\"AuthURL\": \"https://login.tailscale.com/a/0123456789abcdef\",\n\t\"QR\": \"data:image/png;base64,iVBOR\",\n\t\"BackendState\": \"NeedsLogin\"\n}\n";
        assert_eq!(
            up_blocks(printed),
            vec![UpBlock {
                auth_url: Some("https://login.tailscale.com/a/0123456789abcdef".into()),
                state: Some("NeedsLogin".into()),
                error: None
            }]
        );
        let done = format!("{printed}some warning from the daemon\n{{\n  \"BackendState\": \"Running\"\n}}\n");
        let blocks = up_blocks(&done);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1].state.as_deref(), Some("Running"));
        // A device the admin approves first.
        let approval = "{\n  \"BackendState\": \"NeedsMachineAuth\"\n}\n";
        assert_eq!(up_blocks(approval)[0].state.as_deref(), Some("NeedsMachineAuth"));
        // An error, and a block still being written (read once it is whole).
        let failed = "{\n  \"BackendState\": \"NeedsLogin\",\n  \"Error\": \"backend error: invalid key\"\n}\n{\n  \"Backe";
        let blocks = up_blocks(failed);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].error.as_deref(), Some("backend error: invalid key"));
        assert!(up_blocks("").is_empty());
        assert!(up_blocks("no json at all {").is_empty());
    }

    #[test]
    fn up_signs_the_app_s_own_device_in_as_agentes_and_waits_for_the_person() {
        let args = up_args("--hostname=agentes", false);
        assert_eq!(
            args,
            vec!["up", "--json", "--reset", "--timeout=0", "--hostname=agentes", "--accept-dns=false", "--accept-routes=false"]
        );
        assert!(up_args("--hostname=agentes", true).ends_with(&["--force-reauth".to_string()]));
    }

    #[test]
    fn the_daemon_s_log_never_carries_a_sign_in_page() {
        let log = "starting\ncontrol: AuthURL is https://login.tailscale.com/a/0123456789\nhttps://login.tailscale.com/a/0123456789\nRunning";
        assert_eq!(scrubbed(log), "starting\nRunning");
    }

    #[test]
    fn only_tailscale_s_own_sign_in_pages_open() {
        assert!(sign_in_page("https://login.tailscale.com/a/0123456789abcdef"));
        assert!(!sign_in_page("http://login.tailscale.com/a/0123"));
        assert!(!sign_in_page("https://login.tailscale.com.evil.example/a/0123"));
        assert!(!sign_in_page("https://evil.example/https://login.tailscale.com/"));
        assert!(!sign_in_page("https://login.tailscale.com/a/01 23"));
    }

    #[test]
    fn times_as_status_json_writes_them() {
        assert_eq!(rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(rfc3339_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000));
        assert_eq!(rfc3339_ms("2027-05-25T10:00:00.5Z"), Some(1_811_239_200_500));
        assert_eq!(rfc3339_ms("2027-05-25T12:00:00+02:00"), Some(1_811_239_200_000));
        assert_eq!(rfc3339_ms("2027-05-25T07:30:00-02:30"), Some(1_811_239_200_000));
        // Go writes nanoseconds.
        assert_eq!(rfc3339_ms("2027-05-25T10:00:00.123456789Z"), Some(1_811_239_200_123));
        assert_eq!(rfc3339_ms("0001-01-01T00:00:00Z"), None);
        assert_eq!(rfc3339_ms("not a time"), None);
        assert_eq!(rfc3339_ms("2027-13-01T00:00:00Z"), None);
    }

    #[test]
    fn what_status_json_says_about_the_app_s_own_device() {
        let now = rfc3339_ms("2027-01-01T00:00:00Z").unwrap();
        let on = json!({
            "BackendState": "Running",
            "Self": { "DNSName": "agentes.tail1234.ts.net.", "KeyExpiry": "2027-05-25T10:00:00Z" }
        });
        assert_eq!(
            phase_of(&on, now),
            (Phase::On, Some("agentes.tail1234.ts.net".into()), rfc3339_ms("2027-05-25T10:00:00Z"))
        );
        // A second install's device gets the next free name: the address is always read, never assumed.
        let renamed = json!({ "BackendState": "Running", "Self": { "DNSName": "agentes-1.tail1234.ts.net." } });
        assert_eq!(phase_of(&renamed, now).1.as_deref(), Some("agentes-1.tail1234.ts.net"));
        // Expiry turned off by the admin: no KeyExpiry at all.
        assert_eq!(phase_of(&renamed, now).2, None);
        let never = json!({ "BackendState": "NeedsLogin", "Self": { "DNSName": "" } });
        assert_eq!(phase_of(&never, now).0, Phase::SignedOut);
        let expired = json!({ "BackendState": "NeedsLogin", "Self": { "KeyExpiry": "2026-12-01T00:00:00Z" } });
        assert_eq!(phase_of(&expired, now).0, Phase::Expired);
        let marked = json!({ "BackendState": "NeedsLogin", "Self": { "Expired": true } });
        assert_eq!(phase_of(&marked, now).0, Phase::Expired);
        assert_eq!(phase_of(&json!({ "BackendState": "NeedsMachineAuth" }), now).0, Phase::NeedsApproval);
        assert_eq!(phase_of(&json!({ "BackendState": "Stopped" }), now).0, Phase::Off);
        assert_eq!(phase_of(&json!({ "BackendState": "NoState" }), now).0, Phase::Starting);
        assert_eq!(phase_of(&json!({ "BackendState": "Running" }), now).0, Phase::Starting);
        assert_eq!(phase_of(&json!({}), now).0, Phase::Failing);
    }

    #[test]
    fn the_state_as_the_windows_read_it() {
        assert_eq!(serde_json::to_value(TailnetState::none()).unwrap(), json!({ "mode": "none" }));
        let on = TailnetState {
            device: Some("agentes.tail1234.ts.net".into()),
            key_expiry: Some(1_811_239_200_000),
            https: Some(Https::NeedsApproval),
            approve_url: Some("https://login.tailscale.com/f/serve?node=abc".into()),
            ..TailnetState::of(Mode::App, Phase::On)
        };
        assert_eq!(
            serde_json::to_value(on).unwrap(),
            json!({
                "mode": "app",
                "state": "on",
                "device": "agentes.tail1234.ts.net",
                "keyExpiry": 1_811_239_200_000u64,
                "https": "needsApproval",
                "approveUrl": "https://login.tailscale.com/f/serve?node=abc"
            })
        );
        assert_eq!(
            serde_json::to_value(TailnetState::of(Mode::System, Phase::NeedsApproval)).unwrap(),
            json!({ "mode": "system", "state": "needsApproval" })
        );
        assert_eq!(
            serde_json::to_value(SignInStage::Url { url: "https://login.tailscale.com/a/1".into() }).unwrap(),
            json!({ "stage": "url", "url": "https://login.tailscale.com/a/1" })
        );
        assert_eq!(
            serde_json::to_value(SignInStage::Failed { reason: "cancelled" }).unwrap(),
            json!({ "stage": "failed", "reason": "cancelled" })
        );
        assert_eq!(serde_json::to_value(Mode::App).unwrap(), json!("app"));
        assert_eq!(serde_json::from_value::<Mode>(json!("system")).unwrap(), Mode::System);
    }

    #[test]
    fn the_control_socket_is_the_person_s_own() {
        let mac = Path::new("/Users/ana/Library/Application Support/chat.agentes.desktop/tailnet");
        assert_eq!(
            socket_for(mac, "macos", Some(Path::new("/var/folders/x/T")), None, 501, None),
            "/Users/ana/Library/Application Support/chat.agentes.desktop/tailnet/ts.sock"
        );
        // A home too deep for a socket's path: the person's own temporary folder.
        let deep = PathBuf::from(format!("/Users/{}/Library/Application Support/chat.agentes.desktop/tailnet", "a".repeat(60)));
        assert_eq!(
            socket_for(&deep, "macos", Some(Path::new("/var/folders/x/T")), None, 501, None),
            "/var/folders/x/T/agentes-tailscaled.sock"
        );
        let linux_deep = PathBuf::from(format!("/home/{}/.local/share/chat.agentes.desktop/tailnet", "a".repeat(70)));
        assert_eq!(
            socket_for(&linux_deep, "linux", None, Some(Path::new("/run/user/1000")), 1000, None),
            "/run/user/1000/agentes-tailscaled.sock"
        );
        assert_eq!(socket_for(&linux_deep, "linux", None, None, 1000, None), "/tmp/agentes-tailscaled-1000/ts.sock");
        assert_eq!(
            socket_for(Path::new(r"C:\Users\ana\AppData\Local\chat.agentes.desktop\tailnet"), "windows", None, None, 0, Some("S-1-5-21-1-2-3-1001")),
            r"\\.\pipe\agentes-tailscaled-S-1-5-21-1-2-3-1001"
        );
        assert_eq!(sid_in("\"pc\\ana\",\"S-1-5-21-1-2-3-1001\"\r\n").as_deref(), Some("S-1-5-21-1-2-3-1001"));
        assert_eq!(sid_in("nothing here"), None);
    }

    #[test]
    fn the_daemon_starts_in_userspace_on_its_own_socket_without_log_uploads() {
        let args = daemon_args(Path::new("/data/tailnet"), "/data/tailnet/ts.sock", false);
        assert_eq!(
            args,
            vec![
                "--tun=userspace-networking",
                "--statedir=/data/tailnet",
                "--socket=/data/tailnet/ts.sock",
                "--port=0",
                "--no-logs-no-support",
            ]
        );
        assert!(daemon_args(Path::new("/data/tailnet"), r"\\.\pipe\x", true).contains(&"--windows-mode=dev".to_string()));
    }
}
