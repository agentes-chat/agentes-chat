import { describe, expect, test } from "bun:test";
import { authorizeState, pastedReturn, pastedStart } from "../src/lib/pasted-return";

const LOOPBACK = "http://localhost:8976/callback";
const read = (text: string, state: string | null = "s1") => pastedReturn(text, LOOPBACK, state);

/** A sign-in's return pasted back into the app (ADR 0016 addendum 2026-11-23). */
describe("pastedReturn", () => {
  test("the page's address, as browsers copy it: with or without its scheme, a slash at the end, 127.0.0.1 or [::1]", () => {
    for (const text of [
      "http://localhost:8976/callback?code=c1&state=s1",
      "  localhost:8976/callback?code=c1&state=s1  ",
      "http://localhost:8976/callback/?code=c1&state=s1",
      "http://127.0.0.1:8976/callback?state=s1&code=c1",
      "http://[::1]:8976/callback?code=c1&state=s1",
    ]) {
      expect(read(text)).toEqual({ kind: "ok", state: "s1", code: "c1" });
    }
    // Without a state of its own to compare (an authorize URL without one), any state goes.
    expect(read("localhost:8976/callback?code=c1&state=other", null)).toEqual({
      kind: "ok",
      state: "other",
      code: "c1",
    });
  });

  test("the provider's refusal, another sign-in's return, another address", () => {
    expect(read("http://localhost:8976/callback?error=access_denied&state=s1")).toEqual({ kind: "refused" });
    expect(read("http://localhost:8976/callback?code=c1&state=s0")).toEqual({ kind: "other" });
    expect(read("https://acme.example.com/entrar")).toEqual({ kind: "other" });
    expect(read("http://localhost:3000/callback?code=c1&state=s1")).toEqual({ kind: "other" });
    expect(read("http://localhost:8976/other?code=c1&state=s1")).toEqual({ kind: "other" });
    expect(read("http://evil.example.com:8976/callback?code=c1&state=s1")).toEqual({ kind: "other" });
    expect(read("http://localhost:8976/callback?code=c1")).toEqual({ kind: "other" });
  });

  test("while it is typed: nothing, its start, the address without its query yet", () => {
    expect(read("   ")).toEqual({ kind: "empty" });
    expect(read("local")).toEqual({ kind: "partial" });
    expect(read("http://localhost:89")).toEqual({ kind: "partial" });
    expect(read("localhost:8976/callback")).toEqual({ kind: "partial" });
  });
});

test("the authorization's state from its URL, and how the address to paste starts", () => {
  expect(authorizeState("https://auth.example.com/authorize?client_id=c&state=abc")).toBe("abc");
  expect(authorizeState("https://auth.example.com/authorize")).toBeNull();
  expect(authorizeState("not a url")).toBeNull();
  expect(pastedStart(LOOPBACK)).toBe("http://localhost");
});
