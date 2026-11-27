//! Cloudflare Access as a gate in front of a server (ADR 0195, `gate.rs`): how the window tells its sign-in apart,
//! where the person's session is kept, and how an answer says Access wants its sign-in.
//!
//! Access answers every request without its session with a redirect to the team's own sign-in page,
//! `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<server's host>?…`, and names itself in
//! `WWW-Authenticate` (RFC 9728 style, `Cloudflare-Access resource_metadata=…`). Once the person typed the one-time
//! PIN, Access sends the window back to the server with its `CF_Authorization` cookie, host only, on the server's
//! host: every server keeps its own session.

use tauri::Url;

/// The gate's name in the runner's control channel (`gate.set`, `gate.required`).
pub const KIND: &str = "cloudflare-access";
/// Access's own cookie on the server's host: the person's session there, a JWT.
pub const SESSION_COOKIE: &str = "CF_Authorization";
/// The header a program shows Access the person's session in.
pub const SESSION_HEADER: &str = "cf-access-token";
/// Every Access team's own pages are under this domain.
const TEAM_DOMAIN: &str = ".cloudflareaccess.com";
/// The sign-in page of a team, followed by the host it signs in to.
const LOGIN_PATH: &str = "/cdn-cgi/access/login/";

/// `<team>.cloudflareaccess.com`, a single label for the team, on https and its default port.
pub fn team_host(url: &Url) -> Option<&str> {
    if url.scheme() != "https" || url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    let team = host.strip_suffix(TEAM_DOMAIN)?;
    let label_ok = !team.is_empty()
        && team.len() <= 63
        && !team.starts_with('-')
        && !team.ends_with('-')
        && team.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    label_ok.then_some(host)
}

/// The team's sign-in page for `site`'s own host (Access names the host it signs in to in the path).
pub fn signs_in_to(url: &Url, site: &Url) -> bool {
    let (Some(_), Some(site_host)) = (team_host(url), site.host_str()) else { return false };
    site.scheme() == "https"
        && url
            .path()
            .strip_prefix(LOGIN_PATH)
            .is_some_and(|rest| rest.split('/').next() == Some(site_host))
}

/// The team host a session (`CF_Authorization`, a JWT) was issued by: its `iss`, `https://<team>.cloudflareaccess.com`.
/// Read, not verified: it only names which of the window's cookies go with it.
pub fn team_of_session(jwt: &str) -> Option<String> {
    use base64::Engine as _;
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let issuer = Url::parse(claims.get("iss")?.as_str()?).ok()?;
    team_host(&issuer).map(str::to_string)
}

/// Whether a response is Access turning the request away: a redirect to a team's sign-in page, or its own
/// `WWW-Authenticate`.
pub fn wants_sign_in(status: u16, location: Option<&str>, www_authenticate: Option<&str>) -> bool {
    if www_authenticate.is_some_and(|w| w.trim_start().starts_with("Cloudflare-Access")) {
        return true;
    }
    (300..400).contains(&status)
        && location
            .and_then(|l| Url::parse(l).ok())
            .is_some_and(|u| team_host(&u).is_some() && u.path().starts_with(LOGIN_PATH))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_a_teams_own_host() {
        assert_eq!(team_host(&url("https://acme.cloudflareaccess.com/x")), Some("acme.cloudflareaccess.com"));
        assert_eq!(team_host(&url("https://acme-1.cloudflareaccess.com/")), Some("acme-1.cloudflareaccess.com"));
        assert_eq!(team_host(&url("http://acme.cloudflareaccess.com/")), None);
        assert_eq!(team_host(&url("https://acme.cloudflareaccess.com:8443/")), None);
        assert_eq!(team_host(&url("https://a.b.cloudflareaccess.com/")), None);
        assert_eq!(team_host(&url("https://cloudflareaccess.com/")), None);
        assert_eq!(team_host(&url("https://evilcloudflareaccess.com/")), None);
        assert_eq!(team_host(&url("https://acme.cloudflareaccess.com.evil.com/")), None);
        assert_eq!(team_host(&url("https://user:pw@acme.cloudflareaccess.com/")), None);
    }

    #[test]
    fn the_sign_in_names_the_server_open_now() {
        let site = url("https://chat.example.com");
        assert!(signs_in_to(
            &url("https://acme.cloudflareaccess.com/cdn-cgi/access/login/chat.example.com?kid=1&redirect_url=%2F"),
            &site
        ));
        // Another server's sign-in, or a page of the team that isn't the sign-in.
        assert!(!signs_in_to(&url("https://acme.cloudflareaccess.com/cdn-cgi/access/login/other.example.com"), &site));
        assert!(!signs_in_to(&url("https://acme.cloudflareaccess.com/cdn-cgi/access/login/chat.example.com.evil"), &site));
        assert!(!signs_in_to(&url("https://acme.cloudflareaccess.com/somewhere/chat.example.com"), &site));
        // A server on plain http (this computer's) is never behind Access.
        assert!(!signs_in_to(
            &url("https://acme.cloudflareaccess.com/cdn-cgi/access/login/localhost"),
            &url("http://localhost:3000")
        ));
    }

    #[test]
    fn what_access_answers_without_its_session() {
        let login = "https://acme.cloudflareaccess.com/cdn-cgi/access/login/chat.example.com?kid=1";
        assert!(wants_sign_in(302, Some(login), None));
        assert!(wants_sign_in(
            401,
            None,
            Some(r#"Cloudflare-Access resource_metadata="https://chat.example.com/.well-known/cloudflare-access-protected-resource/""#)
        ));
        assert!(!wants_sign_in(302, Some("https://chat.example.com/login"), None));
        assert!(!wants_sign_in(200, Some(login), None));
        assert!(!wants_sign_in(401, None, Some("Bearer realm=\"x\"")));
    }

    #[test]
    fn the_team_a_session_names() {
        use base64::Engine as _;
        let jwt = |claims: &str| {
            let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
            format!("{}.{}.sig", enc(r#"{"alg":"RS256"}"#), enc(claims))
        };
        assert_eq!(
            team_of_session(&jwt(r#"{"iss":"https://acme.cloudflareaccess.com","type":"app"}"#)).as_deref(),
            Some("acme.cloudflareaccess.com")
        );
        assert_eq!(team_of_session(&jwt(r#"{"iss":"https://evil.example.com"}"#)), None);
        assert_eq!(team_of_session(&jwt(r#"{"type":"app"}"#)), None);
        assert_eq!(team_of_session("not-a-jwt"), None);
    }
}
