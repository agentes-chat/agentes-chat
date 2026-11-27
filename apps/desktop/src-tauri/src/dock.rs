//! The Dock: the app is always in it, like any other app (the bundle is a regular app, never a menu bar only
//! one, so the icon needs no switch at runtime and can be kept in the Dock). Its badge shows how many notifications
//! there are (nothing when there are none, 9+ from 10), and it bounces once when something new waits while the app
//! isn't in front. Windows shows the same on the taskbar button (an overlay dot) and Linux on the launcher, where the
//! desktop supports it.

use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, UserAttentionType};

use crate::main_window;

#[derive(Default)]
pub struct Dock {
    /// What the badge showed last: `waiting` going up bounces the icon.
    last_waiting: Mutex<u32>,
}

/// How many notifications the badge counts: the unread ones, or the ones waiting on the person when more are.
// ponytail: the larger of the two, not unread or waiting; a waiting row already read plus other unread ones
// undercounts, a count of their union from the server when that matters.
pub fn count(waiting: u32, unread: u32) -> u32 {
    waiting.max(unread)
}

/// What the badge says: nothing without notifications, their number, 9+ from 10.
#[cfg_attr(target_os = "linux", allow(dead_code))]
pub fn label(waiting: u32, unread: u32) -> Option<String> {
    match count(waiting, unread) {
        0 => None,
        n if n >= 10 => Some("9+".into()),
        n => Some(n.to_string()),
    }
}

/// The taskbar's overlay on Windows: a dot (16 × 16), drawn here.
// ponytail: a dot, not the number; digit overlays (one image per count, 9+) when people ask for the count.
#[cfg(target_os = "windows")]
fn dot() -> tauri::image::Image<'static> {
    const N: u32 = 16;
    let mut rgba = vec![0u8; (N * N * 4) as usize];
    for y in 0..N {
        for x in 0..N {
            let (dx, dy) = (x as f32 - 7.5, y as f32 - 7.5);
            if dx * dx + dy * dy <= 49.0 {
                let i = ((y * N + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[214, 52, 52, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, N, N)
}

/// The site's counts (`this_mac` `badge`): the badge, a bounce when more waits than before, and the popover's
/// "3 waiting for you".
pub fn set_badge(app: &AppHandle, waiting: u32, unread: u32) {
    let _ = app.emit_to("popover", "badge://counts", json!({ "waiting": waiting, "unread": unread }));
    let Some(window) = app.get_window(main_window::LABEL).or_else(|| app.get_window("popover")) else { return };
    #[cfg(target_os = "macos")]
    let _ = window.set_badge_label(label(waiting, unread));
    #[cfg(target_os = "linux")]
    let _ = window.set_badge_count(match count(waiting, unread) {
        0 => None,
        n => Some(i64::from(n)),
    });
    #[cfg(target_os = "windows")]
    let _ = window.set_overlay_icon(label(waiting, unread).map(|_| dot()));
    let more = {
        // The state outlives the lock (a temporary `State` would be dropped while still borrowed).
        let dock = app.state::<Dock>();
        let mut last = dock.last_waiting.lock().unwrap_or_else(|e| e.into_inner());
        let more = waiting > *last;
        *last = waiting;
        more
    };
    let in_front = app
        .get_window(main_window::LABEL)
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if more && !in_front {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_labels() {
        assert_eq!(label(0, 0), None);
        assert_eq!(label(0, 7), Some("7".into()));
        assert_eq!(label(3, 2), Some("3".into()));
        assert_eq!(label(0, 9), Some("9".into()));
        assert_eq!(label(0, 10), Some("9+".into()));
        assert_eq!(label(120, 0), Some("9+".into()));
    }
}
