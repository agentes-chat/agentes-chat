//! The app layer (ADR 0255): the app's own screens inside the main window, a local web view with the app's bundle
//! (`index.html`, the popover's) added over the site and its cover. It carries the first run, This computer's settings
//! and the sheets that were windows of their own (the offer to let agents use this computer, Prepare, a connect or pair
//! link, the iPhone setup). The site never gains a command from it: the layer is its own web view with its own
//! capability (capabilities/app.json, `webviews: ["main-app"]`), and every command it may call checks the web view's
//! label, never the window's (the site shares the window `main`).
//!
//! Its web views are stacked in the order they were added, and Tauri has no call to reorder them, so the layer is
//! always the last one added: the site (`main`), its cover (`main-cover`), then the layer, made on first use and kept
//! alive. It shows in one of three ways:
//! - `full`: the whole window (the first run, settings; on Linux and Windows every route);
//! - `sheet`: macOS only, transparent over a site that is there, the layer drawing a scrim and a card (the top 48pt of
//!   the scrim drags the window);
//! - `hidden`: no size and hidden, so drags from Finder reach the site under it (the cover's lesson).
//!
//! Linux packs child web views side by side (no overlay at all), so there the site is hidden while the layer shows.
//! Windows draws a transparent WebView2 black, so there sheets show opaque and full.
//!
//! A new route is sent to the page first (`layer://state`), and the layer appears once the page says it painted that
//! route (`layer_painted`), or after a short wait, so it never flashes the previous screen.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl};

use crate::{main_window, servers};

pub const LABEL: &str = "main-app";
/// Every change of the layer's state, to the layer itself.
pub const STATE_EVENT: &str = "layer://state";

/// How long a new route waits for the page to say it painted it, once the page has loaded.
const PAINT_WAIT: Duration = Duration::from_millis(250);
/// The same before the layer's page first loaded (its first route waits for the whole bundle).
const FIRST_PAINT_WAIT: Duration = Duration::from_millis(2000);
/// A hide asked for "after the site paints" happens anyway after this: a site that never paints leaves its cover, which
/// says why, never the layer that asked.
const SITE_PAINT_WAIT: Duration = Duration::from_secs(8);
/// The site may open the layer at most this often (`this_mac` `settings`).
pub const SITE_OPEN_GAP: Duration = Duration::from_secs(2);

/// The layer shows over the site (macOS); elsewhere sheets are full window (see the module's notes).
const OVERLAY: bool = cfg!(target_os = "macos");

// ───────────────────────────── routes ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FirstRunMode {
    /// "Add a workspace" (the site, the menu bar's Add a server…, settings).
    Add,
    /// The server here has no account left (or was just erased): its setup makes the new owner.
    Owner,
    /// The site's sign-in or the cover's way out: another server.
    Servers,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Section {
    Overview,
    Folders,
    Server,
    Activity,
    App,
}

/// The rows a settings route may scroll to and highlight (`focus`).
pub const FOCUS: &[&str] = &["tools", "updates", "reach", "telemetry", "phone", "backups", "notifications", "servers"];

/// A workspace this computer could work for (the popover's offer).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairTarget {
    pub server: String,
    pub org_id: String,
    pub name: String,
    pub logo: Option<String>,
}

/// What the layer shows (`apps/desktop/src/host/types.ts` `LayerRoute` mirrors it).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "screen", rename_all = "camelCase")]
pub enum Route {
    FirstRun {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mode: Option<FirstRunMode>,
    },
    Settings {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        section: Option<Section>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        focus: Option<String>,
    },
    PairOffer {
        target: PairTarget,
    },
    Prepare {
        org: String,
        server: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resumed: Option<bool>,
    },
    PairLink {
        server: String,
        code: String,
    },
    /// A connect link waits: the layer takes it with `link_take`.
    Link,
    Iphone,
}

impl Route {
    pub fn settings(section: Option<Section>, focus: Option<&str>) -> Self {
        Route::Settings { section, focus: focus.map(str::to_string) }
    }

    pub fn first_run(mode: Option<FirstRunMode>) -> Self {
        Route::FirstRun { mode }
    }

    /// The window's name while it shows full window (a label the popover sent), or None to keep the site's.
    fn title_key(&self) -> Option<&'static str> {
        match self {
            Route::FirstRun { .. } => Some("windowWelcome"),
            Route::Settings { .. } => Some("windowSettings"),
            _ => None,
        }
    }

    pub fn is_first_run(&self) -> bool {
        matches!(self, Route::FirstRun { .. })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Hidden,
    Full,
    Sheet,
}

/// How a route shows: the first run and settings take the window; the sheets show over a site that is there, where the
/// system can draw one web view over another (`overlay`), else full window too.
pub fn mode_for(route: &Route, site_there: bool, overlay: bool) -> Mode {
    match route {
        Route::FirstRun { .. } | Route::Settings { .. } => Mode::Full,
        _ if overlay && site_there => Mode::Sheet,
        _ => Mode::Full,
    }
}

/// A name a page or the popover sends (a workspace's): trimmed, at most 80 characters, no control characters.
fn shown_name(name: &str) -> Option<String> {
    let name: String = name.trim().chars().take(80).collect();
    (!name.is_empty() && !name.chars().any(char::is_control)).then_some(name)
}

fn good_org_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A workspace's logo: a small image as a data URL, as the app read it (workspaces.rs `LOGO_MAX`).
fn good_logo(logo: &str) -> bool {
    logo.len() <= 350_000
        && logo.starts_with("data:image/")
        && !logo.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// A route as a caller sent it, checked against what the app knows (`servers`: the app's server list) and rebuilt from
/// the fields it may have. Pure, for the tests.
pub fn checked_route(value: Value, servers: &[String]) -> Result<Route, String> {
    let route: Route = serde_json::from_value(value).map_err(|_| "bad route".to_string())?;
    let listed = |server: &str| servers.iter().any(|s| s == server);
    Ok(match route {
        Route::Settings { section, focus } => {
            if focus.as_deref().is_some_and(|f| !FOCUS.contains(&f)) {
                return Err("bad focus".into());
            }
            Route::Settings { section, focus }
        }
        Route::PairOffer { target } => {
            if !listed(&target.server) || !good_org_id(&target.org_id) {
                return Err("bad workspace".into());
            }
            let name = shown_name(&target.name).ok_or("bad workspace name")?;
            let logo = target.logo.filter(|l| good_logo(l));
            Route::PairOffer { target: PairTarget { server: target.server, org_id: target.org_id, name, logo } }
        }
        Route::Prepare { org, server, resumed } => {
            if !listed(&server) {
                return Err("not a server of this app".into());
            }
            Route::Prepare { org: shown_name(&org).ok_or("bad workspace name")?, server, resumed }
        }
        Route::PairLink { server, code } => {
            let ok = servers::origin_of(&server).as_deref() == Some(server.as_str())
                && code.len() == 8
                && code.chars().all(|c| c.is_ascii_alphanumeric());
            if !ok {
                return Err("bad link".into());
            }
            Route::PairLink { server, code: code.to_ascii_uppercase() }
        }
        other => other,
    })
}

// ───────────────────────────── the site's settings list ─────────────────────────────

/// Items the site may list in its settings (both groups together).
const NAV_MAX: usize = 40;
const NAV_LABEL_MAX: usize = 48;

/// A path of the site's settings: `/org/<id>/settings`, or one of its sections.
pub fn settings_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/org/") else { return false };
    let Some((org, tail)) = rest.split_once('/') else { return false };
    if !(1..=64).contains(&org.len()) || !org.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return false;
    }
    let Some(after) = tail.strip_prefix("settings") else { return false };
    match after {
        "" => true,
        _ => after.strip_prefix('/').is_some_and(|s| {
            (1..=32).contains(&s.len()) && s.chars().all(|c| c.is_ascii_lowercase() || c == '_')
        }),
    }
}

fn nav_item(item: &Value) -> Result<Value, String> {
    let text = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
    let (id, label, icon, path) = (text("id"), text("label").trim(), text("icon"), text("path"));
    let ok = (1..=32).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_lowercase() || c == '_')
        && !label.is_empty()
        && label.chars().count() <= NAV_LABEL_MAX
        && !label.chars().any(char::is_control)
        && (1..=32).contains(&icon.len())
        && icon.chars().all(|c| c.is_ascii_alphabetic())
        && settings_path(path);
    if !ok {
        return Err("bad settings item".into());
    }
    Ok(json!({ "id": id, "label": label, "icon": icon, "path": path }))
}

/// The site's settings list (`this_mac` `settingsNav`), checked and rebuilt: its workspace (or none), and its main and
/// advanced sections, 40 items at most in all.
pub fn checked_nav(request: &Value) -> Result<Value, String> {
    let org = match request.get("org") {
        None | Some(Value::Null) => Value::Null,
        Some(org) => {
            let id = org.get("id").and_then(Value::as_str).unwrap_or_default();
            let name = org.get("name").and_then(Value::as_str).and_then(shown_name);
            match name {
                Some(name) if good_org_id(id) => json!({ "id": id, "name": name }),
                _ => return Err("bad organization".into()),
            }
        }
    };
    let group = |key: &str| -> Result<Vec<Value>, String> {
        match request.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(Value::Array(items)) => items.iter().map(nav_item).collect(),
            Some(_) => Err("bad settings list".into()),
        }
    };
    let (main, advanced) = (group("main")?, group("advanced")?);
    if main.len() + advanced.len() > NAV_MAX {
        return Err("too many settings items".into());
    }
    Ok(json!({ "org": org, "main": main, "advanced": advanced }))
}

/// Whether `path` is one the site listed (`nav`), or one of a workspace's settings pages.
fn site_path_ok(nav: Option<&Value>, path: &str) -> bool {
    if path.len() > 512 || !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return false;
    }
    let listed = nav.is_some_and(|nav| {
        ["main", "advanced"].iter().any(|group| {
            nav[*group].as_array().is_some_and(|items| items.iter().any(|i| i["path"].as_str() == Some(path)))
        })
    });
    listed || settings_path(path)
}

// ───────────────────────────── state ─────────────────────────────

#[derive(Default)]
pub struct Layer(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    seq: u64,
    mode: Mode,
    route: Option<Route>,
    /// The layer is sized and shown now.
    shown: bool,
    /// The route `seq` was put on screen already (a late paint or timer for it does nothing).
    revealed: u64,
    /// The layer's page has loaded once (the wait for its first paint is longer before that).
    loaded: bool,
    /// A hide waiting for the site's next paint (`layer_hide` with `afterSitePaints`): its route's `seq`.
    hide_after_paint: Option<u64>,
    /// The site's own title, for the window while the layer doesn't name it.
    site_title: Option<String>,
    /// The site's settings list, per origin (`this_mac` `settingsNav`).
    nav: HashMap<String, Value>,
    full_screen: bool,
    /// The site last opened the layer (`this_mac` `settings`).
    site_opened: Option<Instant>,
}

fn lock(app: &AppHandle) -> MutexGuard<'_, Inner> {
    app.state::<Layer>().inner().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the layer's page draws from (`layer://state`, `layer_state`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerState {
    pub seq: u64,
    pub mode: Mode,
    pub route: Option<Route>,
    pub site: SiteState,
    pub full_screen: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SiteState {
    /// A page of a server of the app's list shows, its cover out of the way.
    pub there: bool,
    /// Its settings list, as it last sent it.
    pub nav: Option<Value>,
}

/// The origin the site shows now, when it is one of the app's servers.
fn site_origin(app: &AppHandle) -> Option<String> {
    let url = app.get_webview(main_window::LABEL)?.url().ok()?;
    let origin = url.origin().ascii_serialization();
    servers::get(app).servers.contains(&origin).then_some(origin)
}

fn site_there(app: &AppHandle) -> bool {
    site_origin(app).is_some() && !crate::cover::covering(app)
}

pub fn state(app: &AppHandle) -> LayerState {
    let origin = site_origin(app);
    let there = origin.is_some() && !crate::cover::covering(app);
    let inner = lock(app);
    LayerState {
        seq: inner.seq,
        mode: if inner.route.is_some() { inner.mode } else { Mode::Hidden },
        route: inner.route.clone(),
        site: SiteState { there, nav: origin.and_then(|o| inner.nav.get(&o).cloned()) },
        full_screen: inner.full_screen,
    }
}

fn emit_state(app: &AppHandle) {
    if app.get_webview(LABEL).is_some() {
        let _ = app.emit_to(LABEL, STATE_EVENT, state(app));
    }
}

/// The route on screen now (or on its way), if any.
pub fn route(app: &AppHandle) -> Option<Route> {
    lock(app).route.clone()
}

/// The first run is the layer's route now (the setup's window, `local_server.rs`).
pub fn first_run_on_screen(app: &AppHandle) -> bool {
    lock(app).route.as_ref().is_some_and(|r| r.is_first_run() || *r == Route::Link)
}

/// The layer is shown over the site now (`main_window::focus_top`).
pub fn shown(app: &AppHandle) -> bool {
    lock(app).shown
}

// ───────────────────────────── showing and hiding ─────────────────────────────

/// The layer's web view, made the first time: the last child of the main window, so it is over the site and its cover.
fn ensure_layer(app: &AppHandle) -> Result<tauri::Webview, String> {
    if let Some(layer) = app.get_webview(LABEL) {
        return Ok(layer);
    }
    let window = app.get_window(main_window::LABEL).ok_or("no main window")?;
    let theme = window.theme().unwrap_or(tauri::Theme::Light);
    let on_load = app.clone();
    let on_new = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::App("index.html".into()))
        // Transparent only where a sheet shows the site through its scrim (macOS); a transparent WebView2 draws black.
        .transparent(OVERLAY)
        .background_color(main_window::backdrop(theme))
        .auto_resize()
        // Files dragged into the window go to the site; the layer drops nothing.
        .disable_drag_drop_handler()
        // Only the app's own pages load in the layer (its links go through `open_external`); a new window's link opens
        // where the app opens links (`open_link`).
        .on_navigation(own_page)
        .on_new_window(move |url, _| {
            let app = on_new.clone();
            // Not from inside the web view's own callback.
            std::thread::spawn(move || {
                let _ = crate::open_link(&app, url.as_str());
            });
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                lock(&on_load).loaded = true;
            }
        });
    window
        .add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(0.0, 0.0))
        .map_err(|e| e.to_string())?;
    let layer = app.get_webview(LABEL).ok_or("no layer")?;
    let _ = layer.hide();
    Ok(layer)
}

/// The app's own pages: its bundle (`tauri://localhost`, `http://tauri.localhost` on Windows), the dev server in a debug
/// build, and blank pages.
fn own_page(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" if cfg!(debug_assertions) => matches!(url.host_str(), Some("localhost" | "127.0.0.1")),
        _ => false,
    }
}

/// The window's inner size in points (see cover.rs `window_points`).
fn window_points(app: &AppHandle) -> Option<LogicalSize<f64>> {
    let window = app.get_window(main_window::LABEL)?;
    let scale = window.scale_factor().ok()?;
    Some(window.inner_size().ok()?.to_logical(scale))
}

/// Puts `route` on screen: the main window (made if needed, blank with no server yet), the layer made and told the
/// route, then shown once it painted it. Never waits on the calling thread (menu events run on the main thread, which
/// the layer needs to paint).
pub fn show(app: &AppHandle, route: Route) -> Result<(), String> {
    main_window::ensure_window(app)?;
    ensure_layer(app)?;
    let mode = mode_for(&route, site_there(app), OVERLAY);
    let (seq, wait) = {
        let mut inner = lock(app);
        inner.seq += 1;
        inner.route = Some(route);
        inner.mode = mode;
        inner.hide_after_paint = None;
        (inner.seq, if inner.loaded { PAINT_WAIT } else { FIRST_PAINT_WAIT })
    };
    emit_state(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        reveal(&app, seq);
    });
    Ok(())
}

/// The page painted route `seq` (or the wait for it ran out): the layer takes its place in the window.
fn reveal(app: &AppHandle, seq: u64) {
    let (route, mode) = {
        let mut inner = lock(app);
        if inner.seq != seq || inner.revealed >= seq || inner.route.is_none() {
            return;
        }
        inner.revealed = seq;
        inner.shown = true;
        (inner.route.clone(), inner.mode)
    };
    let Some(layer) = app.get_webview(LABEL) else { return };
    if let Some(size) = window_points(app) {
        let _ = layer.set_size(size);
    }
    let _ = layer.show();
    // Linux has no overlay: the site gives the window to the layer while it shows.
    #[cfg(target_os = "linux")]
    if let Some(site) = app.get_webview(main_window::LABEL) {
        let _ = site.hide();
    }
    // Named after what fills it (the Dock's list, the Window menu), never a second "agentes.chat".
    let title = route.as_ref().and_then(Route::title_key).and_then(|k| crate::menus::labels(app).get(k).cloned());
    if let (Mode::Full, Some(title), Some(window)) = (mode, title, app.get_window(main_window::LABEL)) {
        let _ = window.set_title(&title);
    }
    let _ = main_window::front(app);
    main_window::keep_lights(app);
}

/// The layer steps aside: the route ends (a setup on screen ends with it, `prepare.rs`), the layer goes to no size and
/// hides, the site and its title come back. With no server chosen yet there is nothing under it: the first run comes
/// back instead.
pub fn hide(app: &AppHandle) {
    if servers::current(app).is_none() {
        if !first_run_on_screen(app) {
            let _ = show(app, Route::first_run(None));
        }
        return;
    }
    let (route, title) = {
        let mut inner = lock(app);
        let Some(route) = inner.route.take() else { return };
        inner.seq += 1;
        inner.mode = Mode::Hidden;
        inner.shown = false;
        inner.hide_after_paint = None;
        (route, inner.site_title.clone())
    };
    crate::prepare::closed(app, &route);
    if let Some(layer) = app.get_webview(LABEL) {
        let _ = layer.hide();
        let _ = layer.set_size(LogicalSize::new(0.0, 0.0));
    }
    #[cfg(target_os = "linux")]
    if let Some(site) = app.get_webview(main_window::LABEL) {
        let _ = site.show();
    }
    if let Some(window) = app.get_window(main_window::LABEL) {
        let _ = window.set_title(main_window::window_title(title.as_deref().unwrap_or_default()));
    }
    emit_state(app);
    main_window::focus_top(app, false);
    main_window::keep_lights(app);
}

/// The window's red button or ⌘W: settings and sheets end; the first run stays (its setup goes on, and opening the app
/// brings it back).
pub fn window_closing(app: &AppHandle) {
    // With no server chosen there is nothing under a sheet: it stays, as the first run does (hiding it would bring the
    // first run up and the window back with it).
    if servers::current(app).is_none() {
        return;
    }
    if lock(app).route.as_ref().is_some_and(|r| !r.is_first_run()) {
        hide(app);
    }
}

/// A site action from the menu bar (⌘K, Go…): settings step aside so the action lands where the person sees it.
pub fn dismiss_settings(app: &AppHandle) {
    if matches!(lock(app).route, Some(Route::Settings { .. })) {
        hide(app);
    }
}

/// The site painted: a hide that waited for it happens now.
pub fn site_painted(app: &AppHandle) {
    let waiting = {
        let inner = lock(app);
        inner.hide_after_paint.is_some_and(|seq| seq == inner.seq)
    };
    if waiting {
        hide(app);
    }
    emit_state(app);
}

/// The site or its cover changed (a page loaded, the cover came or went): the layer hears whether the site is there.
pub fn site_changed(app: &AppHandle) {
    emit_state(app);
}

/// A whole page of the site starts loading: its settings list goes with the page that sent it.
pub fn site_loading(app: &AppHandle, url: &Url) {
    let origin = url.origin().ascii_serialization();
    let removed = lock(app).nav.remove(&origin).is_some();
    if removed {
        emit_state(app);
    }
}

/// The site's title changed: kept for when the layer steps aside. False while the layer names the window itself.
pub fn site_title(app: &AppHandle, title: &str) -> bool {
    let mut inner = lock(app);
    inner.site_title = Some(title.to_string());
    !(inner.shown && inner.mode == Mode::Full && inner.route.as_ref().and_then(Route::title_key).is_some())
}

/// Full screen in or out (main_window.rs `fit_page`): the layer drops or keeps the room for the window's buttons.
pub fn full_screen(app: &AppHandle, full: bool) {
    let changed = {
        let mut inner = lock(app);
        let changed = inner.full_screen != full;
        inner.full_screen = full;
        changed
    };
    if changed {
        emit_state(app);
    }
}

/// The site's settings list (`this_mac` `settingsNav`, already checked) for its own origin.
pub fn set_nav(app: &AppHandle, origin: &str, nav: Value) {
    lock(app).nav.insert(origin.to_string(), nav);
    emit_state(app);
}

/// The site asks for This computer's settings (`this_mac` `settings`): at most one every `SITE_OPEN_GAP`.
pub fn open_from_site(app: &AppHandle, route: Route) -> Result<(), String> {
    {
        let mut inner = lock(app);
        if inner.site_opened.is_some_and(|at| at.elapsed() < SITE_OPEN_GAP) {
            return Err("too_soon".into());
        }
        inner.site_opened = Some(Instant::now());
    }
    show(app, route)
}

// ───────────────────────────── commands ─────────────────────────────

/// The layer itself, the popover ("This Mac settings", the offer, Prepare) and the cover (only its way to another
/// server) put a route on screen. Async: the main window and the layer may be made here (WebView2 needs the main
/// thread free).
#[tauri::command]
pub async fn layer_show(app: AppHandle, webview: tauri::Webview, route: Value) -> Result<(), String> {
    if !matches!(webview.label(), "main-app" | "popover" | "main-cover") {
        return Err("only the app's own screens ask this".into());
    }
    let route = checked_route(route, &servers::get(&app).servers)?;
    if webview.label() == crate::cover::LABEL && route != Route::first_run(Some(FirstRunMode::Servers)) {
        return Err("the cover only opens another server".into());
    }
    show(&app, route)
}

/// The layer steps aside, now or once the site painted (a server just chosen: the site, never its cover, comes in).
#[tauri::command]
pub fn layer_hide(app: AppHandle, webview: tauri::Webview, after_site_paints: Option<bool>) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("only the layer asks this".into());
    }
    if after_site_paints != Some(true) {
        hide(&app);
        return Ok(());
    }
    let seq = {
        let mut inner = lock(&app);
        if inner.route.is_none() {
            return Ok(());
        }
        inner.hide_after_paint = Some(inner.seq);
        inner.seq
    };
    std::thread::spawn(move || {
        std::thread::sleep(SITE_PAINT_WAIT);
        let still = lock(&app).hide_after_paint == Some(seq);
        if still {
            hide(&app);
        }
    });
    Ok(())
}

/// What the layer draws now: read when its page loads (again, after its web process ended), then `layer://state`.
#[tauri::command]
pub fn layer_state(app: AppHandle, webview: tauri::Webview) -> Result<LayerState, String> {
    if webview.label() != LABEL {
        return Err("only the layer asks this".into());
    }
    Ok(state(&app))
}

/// The layer painted route `seq`: it shows now.
#[tauri::command]
pub fn layer_painted(app: AppHandle, webview: tauri::Webview, seq: u64) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("only the layer says this".into());
    }
    lock(&app).loaded = true;
    std::thread::spawn(move || reveal(&app, seq));
    Ok(())
}

/// A workspace section in the layer's settings list: the layer steps aside and the site moves there (in the page, no
/// reload). Only a path the site listed itself, or one of a workspace's settings pages.
#[tauri::command]
pub fn layer_site_go(app: AppHandle, webview: tauri::Webview, path: String) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("only the layer asks this".into());
    }
    let origin = site_origin(&app).ok_or("no site")?;
    let nav = lock(&app).nav.get(&origin).cloned();
    if !site_path_ok(nav.as_ref(), &path) {
        return Err("not a page of the site's settings".into());
    }
    let url = origin.parse::<Url>().and_then(|o| o.join(&path)).map_err(|_| "not a URL")?;
    hide(&app);
    main_window::go_to(&app, url)
}

/// The first run's sign-in to agentes.chat: the Cloud joins the list and becomes the server open now, the window loads
/// its sign-in (Google and Apple start the browser's hand-off at once, `/login?with=`), and the layer steps aside once
/// that page painted. Async: the main window may be made here.
#[tauri::command]
pub async fn first_run_sign_in(app: AppHandle, webview: tauri::Webview, method: String) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("only the layer asks this".into());
    }
    let page = match method.as_str() {
        "google" | "apple" => format!("/login?with={method}"),
        "email" => "/login".to_string(),
        _ => return Err("unknown sign-in".into()),
    };
    servers::choose(&app, servers::CLOUD);
    let url: Url = format!("{}{page}", servers::CLOUD).parse().map_err(|_| "not a URL")?;
    main_window::show_url(&app, url)?;
    let seq = {
        let mut inner = lock(&app);
        let seq = inner.seq;
        if inner.route.is_some() {
            inner.hide_after_paint = Some(seq);
        }
        seq
    };
    std::thread::spawn(move || {
        std::thread::sleep(SITE_PAINT_WAIT);
        if lock(&app).hide_after_paint == Some(seq) {
            hide(&app);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn servers() -> Vec<String> {
        vec!["https://app.agentes.chat".into(), "https://agentes.tail1234.ts.net".into()]
    }

    #[test]
    fn routes_read_as_the_layer_sends_them() {
        assert_eq!(checked_route(json!({ "screen": "firstRun" }), &servers()), Ok(Route::first_run(None)));
        assert_eq!(
            checked_route(json!({ "screen": "firstRun", "mode": "add" }), &servers()),
            Ok(Route::first_run(Some(FirstRunMode::Add)))
        );
        assert_eq!(
            checked_route(json!({ "screen": "settings", "section": "folders", "focus": "tools" }), &servers()),
            Ok(Route::settings(Some(Section::Folders), Some("tools")))
        );
        assert_eq!(checked_route(json!({ "screen": "settings" }), &servers()), Ok(Route::settings(None, None)));
        assert_eq!(checked_route(json!({ "screen": "link" }), &servers()), Ok(Route::Link));
        assert_eq!(checked_route(json!({ "screen": "iphone" }), &servers()), Ok(Route::Iphone));
        // And back out the same way.
        assert_eq!(
            serde_json::to_value(Route::settings(Some(Section::App), None)).unwrap(),
            json!({ "screen": "settings", "section": "app" })
        );
        assert_eq!(serde_json::to_value(Route::first_run(None)).unwrap(), json!({ "screen": "firstRun" }));
    }

    #[test]
    fn a_route_names_only_what_the_app_knows() {
        for bad in [
            json!({ "screen": "firstRun", "mode": "evil" }),
            json!({ "screen": "settings", "section": "billing" }),
            json!({ "screen": "settings", "focus": "anything" }),
            json!({ "screen": "welcome" }),
            json!({ "screen": "prepare", "org": "Acme", "server": "https://evil.example" }),
            json!({ "screen": "prepare", "org": "", "server": "https://app.agentes.chat" }),
            json!({ "screen": "pairOffer", "target": { "server": "https://evil.example", "orgId": "o1", "name": "A", "logo": null } }),
            json!({ "screen": "pairOffer", "target": { "server": "https://app.agentes.chat", "orgId": "../x", "name": "A", "logo": null } }),
            json!({ "screen": "pairLink", "server": "https://x.example/login", "code": "ABCDEFGH" }),
            json!({ "screen": "pairLink", "server": "https://x.example", "code": "ABC" }),
        ] {
            assert!(checked_route(bad.clone(), &servers()).is_err(), "{bad}");
        }
        let offer = json!({ "screen": "pairOffer", "target": {
            "server": "https://app.agentes.chat", "orgId": "o-1", "name": "  Acme ", "logo": "javascript:alert(1)"
        } });
        assert_eq!(
            checked_route(offer, &servers()),
            Ok(Route::PairOffer {
                target: PairTarget {
                    server: "https://app.agentes.chat".into(),
                    org_id: "o-1".into(),
                    name: "Acme".into(),
                    logo: None
                }
            })
        );
        assert_eq!(
            checked_route(json!({ "screen": "pairLink", "server": "https://x.example", "code": "abcdefgh" }), &servers()),
            Ok(Route::PairLink { server: "https://x.example".into(), code: "ABCDEFGH".into() })
        );
    }

    #[test]
    fn sheets_show_over_the_site_only_where_a_web_view_can_cover_another() {
        let sheet = Route::Iphone;
        assert_eq!(mode_for(&sheet, true, true), Mode::Sheet);
        assert_eq!(mode_for(&sheet, false, true), Mode::Full, "no site behind it");
        assert_eq!(mode_for(&sheet, true, false), Mode::Full, "Windows and Linux");
        assert_eq!(mode_for(&Route::settings(None, None), true, true), Mode::Full);
        assert_eq!(mode_for(&Route::first_run(None), true, true), Mode::Full);
        assert_eq!(serde_json::to_value(Mode::Sheet).unwrap(), json!("sheet"));
    }

    #[test]
    fn the_sites_settings_list_is_checked_and_rebuilt() {
        let nav = json!({
            "org": { "id": "o1", "name": " Acme ", "x": 1 },
            "main": [{ "id": "general", "label": "General", "icon": "settings", "path": "/org/o1/settings", "x": 2 }],
            "advanced": [{ "id": "api_keys", "label": "API keys", "icon": "key", "path": "/org/o1/settings/api_keys" }],
            "extra": true,
        });
        assert_eq!(
            checked_nav(&nav),
            Ok(json!({
                "org": { "id": "o1", "name": "Acme" },
                "main": [{ "id": "general", "label": "General", "icon": "settings", "path": "/org/o1/settings" }],
                "advanced": [{ "id": "api_keys", "label": "API keys", "icon": "key", "path": "/org/o1/settings/api_keys" }],
            }))
        );
        assert_eq!(checked_nav(&json!({ "org": null })), Ok(json!({ "org": null, "main": [], "advanced": [] })));
        let item = |id: &str, label: &str, icon: &str, path: &str| json!({ "main": [{ "id": id, "label": label, "icon": icon, "path": path }] });
        for bad in [
            item("General", "General", "settings", "/org/o1/settings"),
            item("general", "", "settings", "/org/o1/settings"),
            item("general", &"a".repeat(49), "settings", "/org/o1/settings"),
            item("general", "Gen\u{7}", "settings", "/org/o1/settings"),
            item("general", "General", "set-tings", "/org/o1/settings"),
            item("general", "General", "settings", "/org/o1/channels"),
            item("general", "General", "settings", "https://evil.example/org/o1/settings"),
            item("general", "General", "settings", "/org/o1/settings/a/b"),
            json!({ "org": { "id": "../x", "name": "A" } }),
            json!({ "main": "x" }),
        ] {
            assert!(checked_nav(&bad).is_err(), "{bad}");
        }
        let many: Vec<_> = (0..41).map(|_| json!({ "id": "a", "label": "A", "icon": "x", "path": "/org/o/settings" })).collect();
        assert!(checked_nav(&json!({ "main": many })).is_err());
    }

    #[test]
    fn the_layer_moves_the_site_only_to_its_settings() {
        let nav = json!({ "main": [{ "path": "/org/o1/settings/people" }], "advanced": [] });
        assert!(site_path_ok(Some(&nav), "/org/o1/settings/people"));
        assert!(site_path_ok(None, "/org/o1/settings"));
        assert!(site_path_ok(None, "/org/o-2/settings/billing"));
        assert!(!site_path_ok(Some(&nav), "/org/o1/c/general"));
        assert!(!site_path_ok(None, "//evil.example/org/o1/settings"));
        assert!(!site_path_ok(None, "/org/o1/settings/../../x"));
    }

    #[test]
    fn only_the_apps_own_pages_load_in_the_layer() {
        assert!(own_page(&"tauri://localhost/index.html".parse().unwrap()));
        assert!(own_page(&"http://tauri.localhost/index.html".parse().unwrap()));
        assert!(!own_page(&"https://app.agentes.chat/".parse().unwrap()));
        assert!(!own_page(&"https://tauri.localhost.evil.example/".parse().unwrap()));
        assert!(!own_page(&"file:///etc/passwd".parse().unwrap()));
    }
}
