//! Windows' Lightweight mode. WebView2 receives reduced motion before its first window is created, so CSS,
//! canvas loops, the loading cover and remote servers use the same preference. No OS setting or launcher changes.
//! The running browser keeps its arguments: a changed preference takes effect on the next opening.

use std::path::Path;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const FILE: &str = "lightweight-mode";
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const ARG: &str = "--force-prefers-reduced-motion";
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
static ACTIVE: OnceLock<bool> = OnceLock::new();

fn read(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(FILE)).is_ok_and(|text| text.trim() == "on")
}

fn write(dir: &Path, on: bool) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(FILE), if on { "on" } else { "off" })
}

/// Snapshot for this opening, including windows created after the preference changes. WebView2 shares a browser
/// process between views; giving a later view different arguments would fail its environment creation.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn active() -> bool {
    ACTIVE.get().copied().unwrap_or(false)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn append_arg(existing: Option<&str>) -> String {
    match existing.filter(|s| !s.is_empty()) {
        Some(args) => format!("{args} {ARG}"),
        None => ARG.to_owned(),
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn configure_windows(config: &mut tauri::Config, on: bool) {
    if on {
        for window in &mut config.app.windows {
            window.additional_browser_args = Some(append_arg(window.additional_browser_args.as_deref()));
        }
    }
}

/// Runs before `Builder::build` creates the configured popover. APPDATA is Tauri's app_config_dir on Windows.
/// Automatic login, an update and Reopen now all read the same file, without inheriting a forced environment flag.
pub fn configure(config: &mut tauri::Config) {
    #[cfg(target_os = "windows")]
    {
        let on = std::env::var_os("APPDATA")
            .map(std::path::PathBuf::from)
            .is_some_and(|base| read(&base.join(&config.identifier)));
        let _ = ACTIVE.set(on);
        configure_windows(config, on);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = config;
}

/// Only Preferences can read and change the saved setting (the capability is Windows-only).
#[tauri::command]
pub fn light_mode_get(app: AppHandle) -> Result<bool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(read(&dir))
}

#[tauri::command]
pub fn light_mode_set(app: AppHandle, on: bool) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    write(&dir, on).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_off_and_choice_survives_a_new_opening() {
        let dir = std::env::temp_dir().join(format!("agentes-light-mode-{}", std::process::id()));
        // A unique directory, without reading or changing a real app's settings.
        let dir = dir.join(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos().to_string());
        assert!(!read(&dir));
        write(&dir, true).unwrap();
        assert!(read(&dir));
        write(&dir, false).unwrap();
        assert!(!read(&dir));
        std::fs::write(dir.join(FILE), "broken").unwrap();
        assert!(!read(&dir));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_existing_browser_arguments() {
        assert_eq!(append_arg(None), ARG);
        assert_eq!(append_arg(Some("")), ARG);
        assert_eq!(append_arg(Some("--lang=en")), format!("--lang=en {ARG}"));
    }

    #[test]
    fn applies_to_all_configured_windows_before_the_first_browser_starts() {
        let mut config = tauri::Config::default();
        let mut window = tauri::utils::config::WindowConfig::default();
        window.additional_browser_args = Some("--lang=en".to_owned());
        config.app.windows = vec![window.clone(), window];
        configure_windows(&mut config, false);
        assert!(config.app.windows.iter().all(|w| w.additional_browser_args.as_deref() == Some("--lang=en")));
        configure_windows(&mut config, true);
        assert!(config.app.windows.iter().all(|w| w.additional_browser_args.as_deref() == Some("--lang=en --force-prefers-reduced-motion")));
    }
}
