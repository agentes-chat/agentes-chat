import { expect, test } from "bun:test";
import { connectReturnOf } from "@/lib/connect-return";

/*
 * Back from an app's sign-in on the onboarding's agent step (ADR 0264): what came in, as the server's OAuth return says
 * it, and nothing else the address may carry.
 */

test("only the known keys, each a short string: a catalog app's, a mailbox's, nothing else", () => {
  expect(connectReturnOf({ connected: "stripe", outcome: "connected", paid: "1", delete: 1 })).toEqual({
    connected: "stripe",
    outcome: "connected",
  });
  expect(connectReturnOf({ mail: "connected", account: "acc-1" })).toEqual({ mail: "connected", account: "acc-1" });
  // Not a string, or too long to be what the server sends: left out.
  expect(
    connectReturnOf({ connected: ["stripe"], outcome: 3, mail: "x".repeat(201), account: "x".repeat(200) }),
  ).toEqual({
    account: "x".repeat(200),
  });
  expect(connectReturnOf({})).toEqual({});
});
