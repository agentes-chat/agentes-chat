/**
 * Development only (`bun run dev` in a browser, the fake host): `?first=<state>` opens the first run straight on one of
 * its states, so each can be looked at and captured without clicking through. Not read in the app.
 *
 * - `welcome`, `company` (a company's server by its address), `install` (installing for the team on a server);
 * - Run here: `owner`, `where`, `net` (how the phone and the team get here, Tailscale's row), `address` (the same step
 *   with an address of the person's own chosen), `setup` (it starts the setup at once, as Ana Souza), `done` (the
 *   phone's code; needs the server here reached: `scenario=here&reach=1`).
 *
 * The fake host's own options shape what each shows (`fake.ts`): `tailscale=missing|off` for the last step's waiting
 * (`install=1` turns it on about 6 s after Download or Open), `addr=unreachable|other|error` for an address that
 * doesn't lead here, `approve=1` for the setup's "One click left", `hold=<step>` and `fail=<step>` for the setup's steps.
 */
export type FirstStart = "welcome" | "company" | "install" | "owner" | "where" | "net" | "address" | "setup" | "done";

const STARTS: readonly FirstStart[] = [
  "welcome",
  "company",
  "install",
  "owner",
  "where",
  "net",
  "address",
  "setup",
  "done",
];

/** The state `?first=` asks for, on the fake host only. */
export function devFirstStart(fake: boolean): FirstStart | null {
  if (!fake || typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get("first");
  return (STARTS as readonly string[]).includes(asked ?? "") ? (asked as FirstStart) : null;
}
