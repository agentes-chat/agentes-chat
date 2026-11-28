//! An address of the person's own for the server here (ADR 0265 §4): a tunnel, a reverse proxy or a domain of theirs,
//! running on this computer, that leads to the server's loopback port. The app never makes or runs it; it only checks
//! that it leads here. The server answers `GET /api/native/here-id` with an id made when its process starts, for any
//! Host (apps/server `http/native-hosts.ts`): the same id through the address and at the loopback origin means the
//! address leads to this very server.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

/// The path that names the running server (apps/server `HERE_ID_PATH`).
pub const HERE_ID_PATH: &str = "/api/native/here-id";
/// Each request of a check gets this long (connecting, TLS and the answer together).
pub const CHECK_WAIT: Duration = Duration::from_secs(10);
/// Checks in a row through the address that didn't lead here before the server here counts as out of reach (the
/// minute timer, `local_server::check_reach`): a tunnel that blinks once isn't down.
pub const MISSES_DOWN: u32 = 3;

/// Why an address of the person's own doesn't lead here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AddressProblem {
    /// Not `https://host[:port]` with nothing after it.
    NotHttps,
    /// Nothing answered there (its name, the connection or TLS failed, or it took too long).
    Unreachable,
    /// A server answered, but not this one (another server, or another process on this computer).
    OtherServer,
    /// It answered with an error, or with something that isn't the server's id (`status`: its HTTP status).
    Error,
}

/// A check that didn't pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AddressFail {
    pub why: AddressProblem,
    pub status: Option<u16>,
}

impl AddressFail {
    pub fn new(why: AddressProblem) -> Self {
        AddressFail { why, status: None }
    }
}

/// What asking for the server's id at one origin gave.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fetched {
    Id(String),
    /// No answer (its name, the connection or TLS failed, or it took too long).
    Unreachable,
    /// An answer that isn't an id: a status other than 2xx, or a body that isn't `{ "id": "<hex>" }`.
    Error(u16),
}

/// The address the person typed, as the origin the server and the app keep (`https://host[:port]`, the host in lower
/// case, no default port): only https, and nothing after the host but a single `/`. None for anything else.
pub fn normalize(typed: &str) -> Option<String> {
    let typed = typed.trim();
    if typed.is_empty() || typed.len() > 2048 || typed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let url = tauri::Url::parse(typed).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    if url.host_str().is_none_or(str::is_empty) || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    if !matches!(url.path(), "" | "/") {
        return None;
    }
    // `https://host/` is fine, `https://host//` or `https://host/?` aren't: what was typed after the host is at most "/".
    let after_host = typed.splitn(4, '/').nth(3).unwrap_or("");
    if !after_host.is_empty() {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

/// The id in a here-id answer's body: hex, of a sane length.
pub fn id_of(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let id = value.get("id")?.as_str()?;
    ((8..=128).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit())).then(|| id.to_ascii_lowercase())
}

/// What a here-id answer says, from its status and body.
pub fn fetched_of(status: u16, body: &str) -> Fetched {
    if !(200..300).contains(&status) {
        return Fetched::Error(status);
    }
    match id_of(body) {
        Some(id) => Fetched::Id(id),
        None => Fetched::Error(status),
    }
}

/// Asks `origin` for the running server's id (no redirect followed: the address must lead here itself).
pub fn here_id(origin: &str, wait: Duration) -> Fetched {
    let agent = ureq::AgentBuilder::new().timeout(wait).redirects(0).build();
    let response = match agent.get(&format!("{origin}{HERE_ID_PATH}")).set("Accept", "application/json").call() {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(_)) => return Fetched::Unreachable,
    };
    let status = response.status();
    let mut body = String::new();
    // A small JSON answer: anything far longer isn't the server's id.
    let read = std::io::Read::read_to_string(&mut std::io::Read::take(response.into_reader(), 4096), &mut body);
    if read.is_err() {
        return Fetched::Error(status);
    }
    fetched_of(status, &body)
}

/// Whether the address leads here: what it answered against what the loopback origin answered.
pub fn judge(through: Fetched, here: &Fetched) -> Result<(), AddressFail> {
    match through {
        Fetched::Unreachable => Err(AddressFail::new(AddressProblem::Unreachable)),
        Fetched::Error(status) => Err(AddressFail { why: AddressProblem::Error, status: Some(status) }),
        Fetched::Id(id) => match here {
            Fetched::Id(own) if *own == id => Ok(()),
            _ => Err(AddressFail::new(AddressProblem::OtherServer)),
        },
    }
}

/// Checks `typed` against the server here at `loopback`: its origin when it leads here. The address is asked first,
/// then the loopback origin, so a restart in between can only fail the check, never pass a wrong one.
pub fn check(typed: &str, loopback: &str) -> Result<String, AddressFail> {
    let origin = normalize(typed).ok_or(AddressFail::new(AddressProblem::NotHttps))?;
    let through = here_id(&origin, CHECK_WAIT);
    let here = here_id(loopback, CHECK_WAIT);
    judge(through, &here)?;
    Ok(origin)
}

/// A check as the windows read it (control/local-server.ts `AddressCheck`).
pub fn check_json(result: &Result<String, AddressFail>) -> Value {
    match result {
        Ok(url) => json!({ "ok": true, "url": url }),
        Err(AddressFail { why, status: Some(status) }) => json!({ "ok": false, "why": why, "status": status }),
        Err(AddressFail { why, status: None }) => json!({ "ok": false, "why": why }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_https_origin_passes_and_is_kept_as_one() {
        assert_eq!(normalize("https://Agentes.Example.com").as_deref(), Some("https://agentes.example.com"));
        assert_eq!(normalize("  https://agentes.example.com/  ").as_deref(), Some("https://agentes.example.com"));
        // Pasted with its line break: the address itself.
        assert_eq!(normalize("https://agentes.example.com\n").as_deref(), Some("https://agentes.example.com"));
        assert_eq!(normalize("https://agentes.example.com:8443").as_deref(), Some("https://agentes.example.com:8443"));
        // The default port is the origin without one.
        assert_eq!(normalize("https://agentes.example.com:443/").as_deref(), Some("https://agentes.example.com"));
        assert_eq!(normalize("https://203.0.113.7").as_deref(), Some("https://203.0.113.7"));
        for refused in [
            "",
            "   ",
            "agentes.example.com",
            "http://agentes.example.com",
            "ftp://agentes.example.com",
            "https://",
            "https://agentes.example.com/app",
            "https://agentes.example.com//",
            "https://agentes.example.com/?",
            "https://agentes.example.com?x=1",
            "https://agentes.example.com#here",
            "https://agentes.example.com/#",
            "https://ana:secret@agentes.example.com",
            "https://agentes example.com",
            "https://agentes.exa\nmple.com",
            "javascript:alert(1)",
        ] {
            assert_eq!(normalize(refused), None, "{refused:?}");
        }
        assert_eq!(normalize(&format!("https://{}.example.com", "a".repeat(2100))), None);
    }

    #[test]
    fn only_the_server_s_id_is_an_answer() {
        assert_eq!(fetched_of(200, r#"{"id":"00ff10aa00ff10aa00ff10aa00ff10aa"}"#), Fetched::Id("00ff10aa00ff10aa00ff10aa00ff10aa".into()));
        assert_eq!(fetched_of(200, r#"{"id":"ABCDEF0123456789"}"#), Fetched::Id("abcdef0123456789".into()));
        assert_eq!(fetched_of(404, r#"{"id":"00ff10aa00ff10aa"}"#), Fetched::Error(404));
        assert_eq!(fetched_of(302, ""), Fetched::Error(302));
        assert_eq!(fetched_of(502, "Bad gateway"), Fetched::Error(502));
        // A page, another JSON, an id that isn't hex: an error with the status it came with.
        assert_eq!(fetched_of(200, "<!doctype html><title>Hi</title>"), Fetched::Error(200));
        assert_eq!(fetched_of(200, r#"{"ok":true}"#), Fetched::Error(200));
        assert_eq!(fetched_of(200, r#"{"id":"not hex at all"}"#), Fetched::Error(200));
        assert_eq!(fetched_of(200, r#"{"id":"ab"}"#), Fetched::Error(200));
        assert_eq!(fetched_of(200, r#"{"id":42}"#), Fetched::Error(200));
    }

    #[test]
    fn the_address_leads_here_only_with_the_same_id() {
        let here = Fetched::Id("00ff10aa00ff10aa".into());
        assert_eq!(judge(Fetched::Id("00ff10aa00ff10aa".into()), &here), Ok(()));
        assert_eq!(judge(Fetched::Id("11ff10aa00ff10aa".into()), &here), Err(AddressFail::new(AddressProblem::OtherServer)));
        assert_eq!(judge(Fetched::Unreachable, &here), Err(AddressFail::new(AddressProblem::Unreachable)));
        assert_eq!(
            judge(Fetched::Error(502), &here),
            Err(AddressFail { why: AddressProblem::Error, status: Some(502) })
        );
        // The server here didn't answer its own id (it restarted in between): never a pass.
        assert_eq!(
            judge(Fetched::Id("00ff10aa00ff10aa".into()), &Fetched::Unreachable),
            Err(AddressFail::new(AddressProblem::OtherServer))
        );
    }

    #[test]
    fn a_check_as_the_windows_read_it() {
        assert_eq!(check_json(&Ok("https://agentes.example.com".into())), json!({ "ok": true, "url": "https://agentes.example.com" }));
        assert_eq!(check_json(&Err(AddressFail::new(AddressProblem::NotHttps))), json!({ "ok": false, "why": "notHttps" }));
        assert_eq!(check_json(&Err(AddressFail::new(AddressProblem::OtherServer))), json!({ "ok": false, "why": "otherServer" }));
        assert_eq!(check_json(&Err(AddressFail::new(AddressProblem::Unreachable))), json!({ "ok": false, "why": "unreachable" }));
        assert_eq!(
            check_json(&Err(AddressFail { why: AddressProblem::Error, status: Some(404) })),
            json!({ "ok": false, "why": "error", "status": 404 })
        );
    }

    #[test]
    fn a_typed_address_that_isn_t_https_is_refused_before_any_request() {
        // No request goes out: the loopback origin given is never asked.
        assert_eq!(check("http://agentes.example.com", "http://127.0.0.1:1"), Err(AddressFail::new(AddressProblem::NotHttps)));
    }
}
