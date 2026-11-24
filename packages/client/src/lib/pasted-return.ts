/**
 * A sign-in's return the person pasted (ADR 0016 addendum 2026-11-23): a server that refused our callback took the
 * loopback address instead, so the sign-in ends on a page there that doesn't load, and the person copies its address
 * into the app. What it holds: `ok` with the `state` and `code` to finish with; `refused`, the provider's own refusal
 * (`error`); `partial`, the start of the address still being typed; `other`, any other text (another address, or another
 * sign-in's return); `empty`.
 */
export type PastedReturn =
  | { kind: "ok"; state: string; code: string }
  | { kind: "refused" }
  | { kind: "partial" }
  | { kind: "other" }
  | { kind: "empty" };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const bare = (text: string) => text.replace(SCHEME, "").replace(/\/+$/, "");

/**
 * Reads what was pasted against the loopback `redirectUri` the server took. `state`: the authorization's own (from its
 * authorize URL); a return with another one is `other`. Browsers copy the address with or without `http://`, and some
 * write the loopback host as 127.0.0.1.
 */
export function pastedReturn(text: string, redirectUri: string, state: string | null): PastedReturn {
  const typed = text.trim();
  if (!typed) return { kind: "empty" };
  const expected = new URL(redirectUri);
  let url: URL;
  try {
    url = new URL(SCHEME.test(typed) ? typed : `http://${typed}`);
  } catch {
    return startsTheAddress(typed, expected) ? { kind: "partial" } : { kind: "other" };
  }
  const same =
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.port === expected.port &&
    url.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "");
  if (!same) return startsTheAddress(typed, expected) ? { kind: "partial" } : { kind: "other" };
  const params = url.searchParams;
  if (params.get("error")) return { kind: "refused" };
  const code = params.get("code");
  const returned = params.get("state");
  if (!code || !returned) return url.search ? { kind: "other" } : { kind: "partial" };
  if (state && returned !== state) return { kind: "other" };
  return { kind: "ok", state: returned, code };
}

/** The address's start, as typed so far (with or without its scheme). */
function startsTheAddress(typed: string, expected: URL) {
  const whole = bare(`${expected.host}${expected.pathname}`);
  const so = bare(typed);
  return so.length > 0 && whole.startsWith(so);
}

/** The authorization's `state`, read from its authorize URL. Null when it has none. */
export function authorizeState(authorizeUrl: string): string | null {
  try {
    return new URL(authorizeUrl).searchParams.get("state");
  } catch {
    return null;
  }
}

/** How the pasted address starts, for the words that say what to paste ("http://localhost"). */
export const pastedStart = (redirectUri: string) => {
  const url = new URL(redirectUri);
  return `${url.protocol}//${url.hostname}`;
};
