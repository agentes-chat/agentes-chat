import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { keys } from "../src/api/keys";
import type { FolderAccessRequest } from "../src/api/types";
import { folderStatusKey, groupFolderRequests } from "../src/lib/folder-access";
import { applyMachineEvent } from "../src/realtime/machines";

const r = (id: string, patch: Partial<FolderAccessRequest> = {}): FolderAccessRequest => ({
  id,
  machineId: "m",
  agent: { id: "a", name: "Ada", handle: "ada" },
  path: "/project",
  reason: "Read",
  status: "pending",
  createdAt: "2026-11-14T12:00:00Z",
  expiresAt: "2026-11-15T12:00:00Z",
  decidedAt: null,
  command: "agentes-runner folders allow /project --agent ada",
  ...patch,
});

test("duplicate pending requests share one row, without losing other agents, paths or decisions", () => {
  const rows = [
    r("latest"),
    r("older"),
    r("other-path", { path: "/another" }),
    r("other-agent", { agent: { id: "b", name: "Ben", handle: "ben" } }),
    r("decided", { status: "denied" }),
  ];
  expect(groupFolderRequests(rows).map((v) => v.id)).toEqual(["latest", "other-path", "other-agent", "decided"]);
  expect(rows).toHaveLength(5);
  expect(folderStatusKey("denied")).toBe("machines.folderRequests.denied");
  expect(folderStatusKey("unknown")).toBe("machines.folderRequests.failed");
});

test("a machine update refreshes both its list and exact request cards without crossing workspaces", () => {
  const q = new QueryClient();
  const list = keys.folderRequests("org", "m");
  const card = keys.folderRequests("org", "m", "request");
  const other = keys.folderRequests("other", "m", "request");
  for (const k of [list, card, other]) q.setQueryData(k, [r("request")]);
  const event = { type: "machine.updated", machineId: "m", access: true };
  expect(applyMachineEvent(q, "org", event)).toBe(true);
  expect(q.getQueryState(list)?.isInvalidated).toBe(true);
  expect(q.getQueryState(card)?.isInvalidated).toBe(true);
  expect(q.getQueryState(other)?.isInvalidated).toBe(false);
  q.clear();
});
