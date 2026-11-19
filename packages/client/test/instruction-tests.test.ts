import { expect, test } from "bun:test";
import { createHttpApi } from "../src/api/http-client";

test("instruction comparisons use encoded agent routes and never save the live agent", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createHttpApi({
    fetch: async (path, init) => {
      calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ support: { available: false }, cases: [], runs: [], run: { id: "test-1" } });
    },
  });
  await api.instructionTests.list("org", "agent/one");
  await api.instructionTests.start("org", "agent/one", {
    baseInstructions: "current",
    candidateInstructions: "draft",
    cases: [{ id: "case-1", situation: "A request", expectation: "Answer briefly" }],
  });
  await api.instructionTests.cancel("org", "agent/one", "test/one");
  expect(calls.map((c) => [c.path, c.method])).toEqual([
    ["/api/app/organizations/org/agents/agent%2Fone/instruction-tests", "GET"],
    ["/api/app/organizations/org/agents/agent%2Fone/instruction-tests", "POST"],
    ["/api/app/organizations/org/agents/agent%2Fone/instruction-tests/test%2Fone/cancel", "POST"],
  ]);
  expect(calls[1]?.body).toMatchObject({ baseInstructions: "current", candidateInstructions: "draft" });
});

test("saved examples and explicit AI suggestions use separate endpoints", async () => {
  const calls: string[] = [];
  const api = createHttpApi({
    fetch: async (path) => {
      calls.push(path);
      return Response.json({ cases: [], case: { id: "suggested", situation: "Example", expectation: "Be useful" } });
    },
  });
  await api.instructionTests.saveCases("org", "agent", []);
  await api.instructionTests.suggest("org", "agent", { baseInstructions: "before", candidateInstructions: "after" });
  expect(calls).toEqual([
    "/api/app/organizations/org/agents/agent/instruction-test-cases",
    "/api/app/organizations/org/agents/agent/instruction-tests/suggest",
  ]);
});
