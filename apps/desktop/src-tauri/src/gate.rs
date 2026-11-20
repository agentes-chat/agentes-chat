//! A gate in front of a server (ADR 0195): an identity-aware proxy, Cloudflare Access for now (`gate_cloudflare.rs`),
//! that answers nothing of the server before its own sign-in. Its sign-in shows in the main window, and only while it
//! is the sign-in of the server open now; the session it leaves in the window goes to that server's runner, and only
//! to it.
//!
//! The gate's sign-in page names the server it signs in to, so the window lets it stay only when that name is the
//! server open now; from there the gate's own pages stay too, until the window is back on the server. Any other host
//! on the way (another identity provider) still opens in the browser, which can't hand the session back: only a
//! sign-in that happens on the gate's own pages (Access's one-time PIN) signs in here.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::Cookie;
use tauri::{AppHandle, Manager, Url};

use crate::gate_cloudflare as cloudflare;

/// A sign-in left half done stops counting after this: the gate's pages no longer stay in the window.
const LOGIN_LIFETIME: Duration = Duration::from_secs(15 * 60);
/// How long the welcome window's question waits for the server's answer.
const ASK_TIMEOUT: Duration = Duration::from_secs(8);

/// The gate's sign-in going on in the main window, a page of the server asked for meanwhile, and what each runner
/// was handed.
#[derive(Default)]
pub struct GateLogin(Mutex<State>);

#[derive(Default)]
struct State {
    /// The gate's host and the server's origin it signs in to, since when.
    login: Option<(String, String, Instant)>,
    /// A page of the server the app was asked for while the window showed the sign-in: it goes there once the
    /// server's page is back.
    pending: Option<Url>,
    /// The session each runner got last, by `"<home> <origin>"`.
    handed: std::collections::HashMap<String, String>,
    /// The servers whose gate's sign-in the window went through since the app started.
    gated: std::collections::HashSet<String>,
}

fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, State> {
    app.state::<GateLogin>().inner().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the window does with `url` while the server open now is `site`: `Some(true)` it stays (the gate's sign-in
/// of that server, or the gate's pages during it), `None` it isn't the gate's to say.
pub fn stays(app: &AppHandle, url: &Url, site: &Url) -> Option<bool> {
    let origin = site.origin().ascii_serialization();
    let mut state = lock(app);
    if cloudflare::signs_in_to(url, site) {
        let host = cloudflare::team_host(url)?.to_string();
        state.gated.insert(origin.clone());
        state.login = Some((host, origin, Instant::now()));
        return Some(true);
    }
    let host = cloudflare::team_host(url)?;
    let during = state.login.as_ref().is_some_and(|(gate, server, since)| {
        gate == host && *server == origin && since.elapsed() < LOGIN_LIFETIME
    });
    during.then_some(true)
}

/// The window shows a page of a gate's sign-in now.
pub fn on_login_page(url: &Url) -> bool {
    cloudflare::team_host(url).is_some()
}

/// The window is back on a server's page: the sign-in is over.
pub fn back_on_site(app: &AppHandle) -> Option<Url> {
    let mut state = lock(app);
    state.login = None;
    state.pending.take()
}

/// A page of the server asked for while the sign-in shows: kept for when it's over (the latest wins).
pub fn defer(app: &AppHandle, url: Url) {
    lock(app).pending = Some(url);
}

/// Whether a response is a gate turning the request away.
pub fn wants_sign_in(status: u16, location: Option<&str>, www_authenticate: Option<&str>) -> bool {
    cloudflare::wants_sign_in(status, location, www_authenticate)
}

/// The person's gate session for `server` (an https origin) among the main window's cookies.
pub fn session_among(cookies: &[Cookie<'static>], server: &str) -> Option<String> {
    let url = Url::parse(server).ok().filter(|u| u.scheme() == "https")?;
    cookies
        .iter()
        .find(|c| c.name() == cloudflare::SESSION_COOKIE && crate::workspaces::sent_to(*c, &url))
        .map(|c| c.value().to_string())
}

/// The person's gate session for `server`, read from the main window. Blocking (`cookies::read` waits for the web
/// view): never from a command's or an event's own thread.
pub fn session_for(app: &AppHandle, server: &str) -> Option<String> {
    let page = app.get_webview(crate::main_window::LABEL)?;
    session_among(&crate::cookies::read(&page), server)
}

/// The header that shows `server`'s gate the person's session the window holds, for the app's own requests that
/// carry no cookies. Blocking, as `session_for`.
pub fn session_header(app: &AppHandle, server: &str) -> Option<(&'static str, String)> {
    session_for(app, server).map(|token| (cloudflare::SESSION_HEADER, token))
}

/// Sends the runner of `home_id` its server's gate session when it changed since the last one it got (or always,
/// `force`). Blocking, as `session_for`.
pub fn hand_session(app: &AppHandle, home_id: &str, server: &str, force: bool) {
    let Ok(origin) = Url::parse(server).map(|u| u.origin().ascii_serialization()) else { return };
    let token = session_for(app, &origin);
    hand(app, home_id, &origin, token, force);
}

/// `token` to the runner of `home_id` for `origin`, unless it already has it (or `force`); none, nothing is sent.
fn hand(app: &AppHandle, home_id: &str, origin: &str, token: Option<String>, force: bool) {
    let Some(token) = token else { return };
    {
        let mut state = lock(app);
        let key = format!("{home_id} {origin}");
        if !force && state.handed.get(&key) == Some(&token) {
            return;
        }
        state.handed.insert(key, token.clone());
    }
    send_gate(app, home_id, origin, Some(&token));
}

/// One `gate.set` line to the runner of `home_id`: the person's session for `origin`, or none (it forgets it).
fn send_gate(app: &AppHandle, home_id: &str, origin: &str, token: Option<&str>) {
    let line = serde_json::json!({
        "id": format!("gate-{home_id}"),
        "type": "gate.set",
        "server": origin,
        "kind": cloudflare::KIND,
        "token": token,
    });
    let _ = app.state::<crate::runners::Runners>().send(home_id, &line.to_string());
}

/// Every running runner gets its server's session when it changed: after the window signed in to the gate again,
/// and on the workspaces' minute (`workspaces.rs`, with the cookies it read). Blocking, as `session_for`.
pub fn hand_to_runners(app: &AppHandle, cookies: Option<&[Cookie<'static>]>) {
    let read;
    let cookies = match cookies {
        Some(cookies) => cookies,
        None => {
            let Some(page) = app.get_webview(crate::main_window::LABEL) else { return };
            read = crate::cookies::read(&page);
            &read
        }
    };
    for (home_id, server) in app.state::<crate::runners::Runners>().servers() {
        let Some(origin) = server.and_then(|s| Url::parse(&s).ok()).map(|u| u.origin().ascii_serialization()) else {
            continue;
        };
        hand(app, &home_id, &origin, session_among(cookies, &origin), false);
    }
}

/// The person signed out of `server` (Preferences › Servers): its runners forget the session they were handed.
/// The window's cookies go with the server's own (`sign_out_cookie`).
pub fn signed_out(app: &AppHandle, server: &str) {
    let Ok(origin) = Url::parse(server).map(|u| u.origin().ascii_serialization()) else { return };
    let suffix = format!(" {origin}");
    let homes: Vec<String> = {
        let mut state = lock(app);
        let homes = state.handed.keys().filter_map(|k| k.strip_suffix(&suffix)).map(str::to_string).collect();
        state.handed.retain(|k, _| !k.ends_with(&suffix));
        homes
    };
    for home_id in homes {
        send_gate(app, &home_id, &origin, None);
    }
}

/// Whether signing out of a server takes `cookie` from the window too: the gate's own cookies on the team's pages,
/// of the team whose session `session` (the server's gate session) is. Without them the next sign-in would pass
/// through the gate's remembered sign-in, asking nothing. Only the window's: the gate's session elsewhere (the system
/// browser, other applications) stays.
pub fn sign_out_cookie(cookie: &Cookie<'static>, session: Option<&str>) -> bool {
    let Some(team) = session.and_then(cloudflare::team_of_session) else { return false };
    let Ok(url) = Url::parse(&format!("https://{team}/")) else { return false };
    crate::workspaces::sent_to(cookie, &url)
}

/// A runner that just started: its server's session, from a thread of its own.
pub fn hand_to_runner_soon(app: &AppHandle, home_id: &str) {
    let (app, home_id) = (app.clone(), home_id.to_string());
    std::thread::spawn(move || {
        let server = app
            .state::<crate::runners::Runners>()
            .servers()
            .into_iter()
            .find(|(id, _)| *id == home_id)
            .and_then(|(_, s)| s);
        if let Some(server) = server {
            hand_session(&app, &home_id, &server, true);
        }
    });
}

/// The server a `pair.start` line pairs with.
pub fn pairing_server(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    (value.get("type")?.as_str()? == "pair.start").then(|| value.get("server")?.as_str().map(str::to_string))?
}

/// A runner says the gate turned it away from `server`: a newer session the window holds goes to it; with none,
/// the window opens on that server when it is the one open now, where the gate asks the person to sign in again.
pub fn runner_turned_away(app: &AppHandle, home_id: &str, server: &str) {
    let (app, home_id, server) = (app.clone(), home_id.to_string(), server.to_string());
    std::thread::spawn(move || {
        let before = lock(&app).handed.get(&format!("{home_id} {server}")).cloned();
        let now = session_for(&app, &server);
        if now.is_some() && now != before {
            hand_session(&app, &home_id, &server, true);
            return;
        }
        let current = crate::main_window::site(&app).map(|s| s.origin().ascii_serialization());
        if current.as_deref() == Some(server.as_str()) {
            if let Ok(url) = Url::parse(&server) {
                let _ = crate::main_window::show_url(&app, url);
            }
        }
    });
}

/// The window shows a page of a server whose gate it signed in to: when the gate turns the window's session away now
/// (it ran out), the page loads again, through the gate's sign-in, instead of staying on a page whose requests and
/// realtime all fail. `cookie` is what the window sends there. Asked on the workspaces' minute (`workspaces.rs`).
/// Blocking: a request.
pub fn recheck_open(app: &AppHandle, agent: &ureq::Agent, site: &str, cookie: &str) {
    if !lock(app).gated.contains(site) {
        return;
    }
    let mut request = agent.get(&format!("{site}/api/health"));
    if !cookie.is_empty() {
        request = request.set("Cookie", cookie);
    }
    let response = match request.call() {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(_) => return,
    };
    if !wants_sign_in(response.status(), response.header("location"), response.header("www-authenticate")) {
        return;
    }
    let Some(page) = app.get_webview(crate::main_window::LABEL) else { return };
    let Ok(url) = page.url() else { return };
    if url.origin().ascii_serialization() == site {
        let _ = page.navigate(url);
    }
}

/// Whether a gate stands in front of `server` (an origin) and wants its sign-in: asked without following the
/// redirect, so nothing reaches the gate's pages. The welcome window and Preferences ask it when their own check
/// (`GET /api/instance` from the app's pages, another origin, which the gate's redirect never answers) failed.
fn behind_gate(server: &str) -> bool {
    let Ok(url) = Url::parse(server) else { return false };
    if url.scheme() != "https" || url.origin().ascii_serialization() != server {
        return false;
    }
    let agent = ureq::AgentBuilder::new().timeout(ASK_TIMEOUT).redirects(0).build();
    let response = match agent.get(&format!("{server}/api/instance")).set("Accept", "application/json").call() {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(_) => return false,
    };
    wants_sign_in(response.status(), response.header("location"), response.header("www-authenticate"))
}

#[tauri::command]
pub async fn server_behind_gate(window: tauri::Window, server: String) -> Result<bool, String> {
    if !matches!(window.label(), "prefs" | "welcome") {
        return Err("only Preferences and the welcome window ask this".into());
    }
    tauri::async_runtime::spawn_blocking(move || behind_gate(&server)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::pairing_server;

    #[test]
    fn only_pairing_names_a_server_to_hand_the_session_to() {
        assert_eq!(
            pairing_server(r#"{"id":"1","type":"pair.start","server":"https://chat.example.com"}"#).as_deref(),
            Some("https://chat.example.com")
        );
        assert_eq!(pairing_server(r#"{"id":"1","type":"status"}"#), None);
        assert_eq!(pairing_server(r#"{"id":"1","type":"pair.start"}"#), None);
        assert_eq!(pairing_server("not json"), None);
    }
}
