//! This computer's essentials as the system says them (ADR 0256 §7): opening at login, the macOS permissions agents
//! need (notifications, Screen Recording, Full Disk Access), what keeps the server here up after a restart or a power
//! cut, and whether this Mac stays awake while it serves. One call reads them all (`health_get`), and they are read
//! again whenever the main window comes back to the front (`health://changed`, at most every 15 s), so the popover
//! keeps the tray and "things that need you" current without the person opening the app's settings. What the app
//! decides itself (reach, the nightly backup, updates) the popover reads from the server here's status and its prefs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt as _;

/// Every read made when the app came to the front, to the web views that keep the essentials.
pub const CHANGED_EVENT: &str = "health://changed";
/// The web views that read the essentials: the popover (the tray, the notifications, the site's count) and the app
/// layer (This computer's settings, Prepare).
const READERS: &[&str] = &["popover", crate::app_layer::LABEL];
/// Reads on coming to the front are at least this far apart: each one runs `defaults` and `pmset` and opens a file.
const READ_GAP: Duration = Duration::from_secs(15);

/// The app's notifications as macOS has them: allowed (also quietly or for a while), turned off by the person, or not
/// asked yet. Elsewhere always allowed (no system asks).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotifyPermission {
    Granted,
    Denied,
    NotDetermined,
}

/// `UNAuthorizationStatus` in macOS's words: 0 not determined, 1 denied, 2 authorized, 3 provisional, 4 ephemeral.
fn permission_of(status: isize) -> NotifyPermission {
    match status {
        0 => NotifyPermission::NotDetermined,
        1 => NotifyPermission::Denied,
        _ => NotifyPermission::Granted,
    }
}

/// This computer's essentials that only the system knows. `awake`: None off a Mac (nothing keeps other systems awake).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    autostart: bool,
    screen: bool,
    disk: bool,
    notifications: NotifyPermission,
    keep_running: crate::local_server::KeepRunning,
    awake: Option<bool>,
}

/// Reads them all now, blocking (processes and files): never on the main thread.
fn read(app: &AppHandle) -> Health {
    Health {
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        screen: crate::prepare::screen_access(),
        disk: crate::prepare::disk_allowed(app),
        notifications: notify_status(),
        keep_running: crate::local_server::keep_running_now(),
        awake: cfg!(target_os = "macos").then(|| crate::local_server::awake(app)),
    }
}

/// Each command answers `READERS` alone (written out in each: the capabilities test reads the gate there).
#[tauri::command]
pub async fn health_get(app: AppHandle, webview: tauri::Webview) -> Result<Health, String> {
    if !matches!(webview.label(), "popover" | "main-app") {
        return Err("only the app's own windows ask this".into());
    }
    tauri::async_runtime::spawn_blocking(move || read(&app)).await.map_err(|e| e.to_string())
}

/// The app's notifications on this Mac, asking nothing (Prepare reads it live while the person turns it on).
#[tauri::command]
pub async fn notify_permission(webview: tauri::Webview) -> Result<NotifyPermission, String> {
    if !matches!(webview.label(), "popover" | "main-app") {
        return Err("only the app's own windows ask this".into());
    }
    tauri::async_runtime::spawn_blocking(notify_status).await.map_err(|e| e.to_string())
}

/// macOS's prompt for the app's notifications, only while it was never asked (it asks once: after that the person
/// changes it in System Settings); answers the permission as it is afterwards.
#[tauri::command]
pub async fn notify_request(webview: tauri::Webview) -> Result<NotifyPermission, String> {
    if !matches!(webview.label(), "popover" | "main-app") {
        return Err("only the app's own windows ask this".into());
    }
    tauri::async_runtime::spawn_blocking(notify_ask).await.map_err(|e| e.to_string())
}

/// When the last read on coming to the front was made, and whether one waits for the gap to end.
static READ_AT: Mutex<Option<Instant>> = Mutex::new(None);
static QUEUED: AtomicBool = AtomicBool::new(false);

/// How long a read asked for `now` waits: none when the last one is `READ_GAP` old, else the rest of the gap.
fn wait_for(last: Option<Instant>, now: Instant) -> Option<Duration> {
    let since = now.saturating_duration_since(last?);
    (since < READ_GAP).then(|| READ_GAP - since)
}

/// The main window gained focus, or the app came to the front: the essentials are read again and sent to their
/// readers. Within 15 s of the last read, one read is made when the gap ends (the person may have just turned a
/// permission on in System Settings and come back), never more.
pub fn on_front(app: &AppHandle) {
    let wait = {
        let mut at = READ_AT.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let wait = wait_for(*at, now);
        if wait.is_none() {
            *at = Some(now);
        }
        wait
    };
    let app = app.clone();
    match wait {
        None => {
            std::thread::spawn(move || send(&app));
        }
        Some(left) => {
            if QUEUED.swap(true, Ordering::SeqCst) {
                return;
            }
            std::thread::spawn(move || {
                std::thread::sleep(left);
                *READ_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                QUEUED.store(false, Ordering::SeqCst);
                send(&app);
            });
        }
    }
}

fn send(app: &AppHandle) {
    let health = read(app);
    for label in READERS {
        let _ = app.emit_to(*label, CHANGED_EVENT, &health);
    }
}

#[cfg(target_os = "macos")]
fn notify_status() -> NotifyPermission {
    mac::status().map_or(NotifyPermission::Granted, permission_of)
}

#[cfg(not(target_os = "macos"))]
fn notify_status() -> NotifyPermission {
    NotifyPermission::Granted
}

#[cfg(target_os = "macos")]
fn notify_ask() -> NotifyPermission {
    if notify_status() == NotifyPermission::NotDetermined {
        mac::ask();
    }
    notify_status()
}

#[cfg(not(target_os = "macos"))]
fn notify_ask() -> NotifyPermission {
    NotifyPermission::Granted
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, CStr};
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};

    // UNUserNotificationCenter's framework, which nothing else in the app links.
    #[link(name = "UserNotifications", kind = "framework")]
    extern "C" {}

    /// The settings answer in milliseconds; this is for a system that never does.
    const READ_WAIT: Duration = Duration::from_secs(3);
    /// The prompt waits for the person.
    const ASK_WAIT: Duration = Duration::from_secs(300);
    /// `UNAuthorizationOptionBadge | Sound | Alert`.
    const OPTIONS: usize = 1 | 2 | 4;

    /// UNUserNotificationCenter needs the app's bundle: in a binary run outside one (a development build) it raises
    /// an exception, which would end the app. There the notifications read as allowed.
    fn bundled() -> bool {
        // SAFETY: NSBundle's class methods and properties, read on any thread; the path is an NSString or nil.
        unsafe {
            let Some(class) = AnyClass::get(c"NSBundle") else { return false };
            let bundle: *mut AnyObject = msg_send![class, mainBundle];
            if bundle.is_null() {
                return false;
            }
            let id: *mut AnyObject = msg_send![bundle, bundleIdentifier];
            let path: *mut AnyObject = msg_send![bundle, bundlePath];
            if id.is_null() || path.is_null() {
                return false;
            }
            let utf8: *const c_char = msg_send![path, UTF8String];
            !utf8.is_null() && CStr::from_ptr(utf8).to_bytes().ends_with(b".app")
        }
    }

    fn center() -> Option<*mut AnyObject> {
        if !bundled() {
            return None;
        }
        let class = AnyClass::get(c"UNUserNotificationCenter")?;
        // SAFETY: the shared center, made by the framework for the app's bundle (checked above), any thread.
        let center: *mut AnyObject = unsafe { msg_send![class, currentNotificationCenter] };
        (!center.is_null()).then_some(center)
    }

    /// The app's `UNAuthorizationStatus`; None outside a bundle or when the system didn't answer.
    pub fn status() -> Option<isize> {
        let center = center()?;
        let (tx, rx) = mpsc::channel();
        let answer = RcBlock::new(move |settings: *mut AnyObject| {
            // SAFETY: the framework calls this once with a UNNotificationSettings that lives for the call (or nil).
            let status: isize = if settings.is_null() { -1 } else { unsafe { msg_send![settings, authorizationStatus] } };
            let _ = tx.send(status);
        });
        // SAFETY: the shared center; the framework copies the block and calls it once on a queue of its own.
        unsafe {
            let _: () = msg_send![center, getNotificationSettingsWithCompletionHandler: &*answer];
        }
        rx.recv_timeout(READ_WAIT).ok().filter(|status| *status >= 0)
    }

    /// The system's prompt (shown only while the app was never asked); returns once the person answered.
    pub fn ask() {
        let Some(center) = center() else { return };
        let (tx, rx) = mpsc::channel();
        let answer = RcBlock::new(move |granted: Bool, _error: *mut AnyObject| {
            let _ = tx.send(granted.as_bool());
        });
        // SAFETY: the shared center, options as `UNAuthorizationOptions` (NSUInteger); the framework copies the block
        // and calls it once, on a queue of its own, with a BOOL and an NSError or nil.
        unsafe {
            let _: () = msg_send![center, requestAuthorizationWithOptions: OPTIONS, completionHandler: &*answer];
        }
        let _ = rx.recv_timeout(ASK_WAIT);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_statuses_read_as_three_answers() {
        assert_eq!(permission_of(0), NotifyPermission::NotDetermined);
        assert_eq!(permission_of(1), NotifyPermission::Denied);
        // Authorized, provisional (quietly) and ephemeral (an App Clip's) all show the app's notifications.
        assert_eq!(permission_of(2), NotifyPermission::Granted);
        assert_eq!(permission_of(3), NotifyPermission::Granted);
        assert_eq!(permission_of(4), NotifyPermission::Granted);
    }

    #[test]
    fn reads_on_coming_to_the_front_are_15_seconds_apart() {
        let now = Instant::now();
        assert_eq!(wait_for(None, now), None);
        let then = now - Duration::from_secs(4);
        assert_eq!(wait_for(Some(then), now), Some(Duration::from_secs(11)));
        assert_eq!(wait_for(Some(now - READ_GAP), now), None);
        assert_eq!(wait_for(Some(now - Duration::from_secs(60)), now), None);
    }

    #[test]
    fn the_essentials_reach_the_web_views_as_camel_case() {
        let health = Health {
            autostart: true,
            screen: false,
            disk: true,
            notifications: NotifyPermission::NotDetermined,
            keep_running: crate::local_server::keep_running_now(),
            awake: None,
        };
        let json = serde_json::to_value(&health).unwrap();
        assert_eq!(json["notifications"], "notDetermined");
        assert_eq!(json["screen"], false);
        assert!(json["keepRunning"].is_object());
        assert!(json["awake"].is_null());
    }
}
