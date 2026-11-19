import { describe, expect, test } from "bun:test";
import type { Agent, AgentRef, Machine } from "../src/api/types";
import { type WorksOnAgent, worksOnAgents, worksOnCrewShown, worksOnField } from "../src/lib/works-on";

/**
 * What the "Works on the computer of" field shows for an agent, one rule for web and phone (ADR 0202): who is offered
 * (the rules that depend on the agents alone; who may do it is the server's answer), the locked state of a member, the
 * explicit empty state, and the bounded list on the lead's side.
 */
const agent = (id: string, over: Partial<WorksOnAgent> = {}): WorksOnAgent => ({
  id,
  name: id,
  handle: id,
  ownerUserId: "ana",
  machineId: "m1",
  builtin: null,
  worksOnAgentId: null,
  worksOn: null,
  crew: [],
  ...over,
});
const ref = (id: string, archived = false): AgentRef => ({ id, name: id, handle: id, archived });

describe("who is offered", () => {
  test("same non-null owner, on a computer, not the right hand, not itself a member, not the agent", () => {
    const me = agent("me");
    const field = worksOnField(me, [
      me,
      agent("ok"),
      agent("other-owner", { ownerUserId: "bob" }),
      agent("no-owner", { ownerUserId: null }),
      agent("no-computer", { machineId: null }),
      agent("hand", { builtin: "right_hand" }),
      agent("a-member", { worksOnAgentId: "ok" }),
    ]);
    expect(field.kind).toBe("pick");
    expect(field.kind === "pick" ? field.options.map((a) => a.id) : []).toEqual(["ok"]);
  });

  test("nobody eligible: an explicit empty state, never a blank list", () => {
    const me = agent("me");
    expect(worksOnField(me, [me])).toEqual({ kind: "empty" });
    expect(worksOnField(me, [me, agent("x", { ownerUserId: "bob" })])).toEqual({ kind: "empty" });
  });

  test("an agent with no owner can't work on another's computer: the field is empty for it", () => {
    const me = agent("me", { ownerUserId: null });
    expect(worksOnField(me, [me, agent("x", { ownerUserId: null })])).toEqual({ kind: "empty" });
  });

  test("a 200-character, accented, right-to-left name goes through untouched", () => {
    const long = `${"ção ".repeat(50)}مرحبا`.slice(0, 200);
    const me = agent("me");
    const field = worksOnField(me, [me, agent("l", { name: long })]);
    expect(field.kind === "pick" ? field.options[0]?.name : null).toBe(long);
  });

  test("the right hand has no field", () => {
    const hand = agent("hand", { builtin: "right_hand" });
    expect(worksOnField(hand, [hand, agent("x")])).toEqual({ kind: "none" });
  });
});

describe("the two sides", () => {
  test("a member is locked on the lead the API names, even when that agent is gone from the live list", () => {
    const lead = agent("lead");
    const me = agent("me", { worksOnAgentId: "lead", worksOn: ref("lead") });
    expect(worksOnField(me, [me, lead])).toEqual({ kind: "member", lead: ref("lead"), available: true });
    expect(worksOnField(me, [me])).toEqual({ kind: "member", lead: ref("lead"), available: false });
  });

  test("a member of an archived lead takes the lead's name from worksOn and is unavailable", () => {
    const me = agent("me", { worksOnAgentId: "old", worksOn: ref("old", true) });
    expect(worksOnField(me, [me, agent("old")])).toEqual({ kind: "member", lead: ref("old", true), available: false });
  });

  test("a lead lists the live agents the API says work on its computer (no picker)", () => {
    const lead = agent("lead", { crew: [ref("a"), ref("b")] });
    expect(worksOnField(lead, [lead, agent("free")])).toEqual({ kind: "lead", crew: [ref("a"), ref("b")] });
  });

  test("a lead whose members are all archived shows the crew-empty state, never a picker (unarchived, it would make a chain)", () => {
    const lead = agent("lead", { crew: [ref("gone", true)] });
    expect(worksOnField(lead, [lead, agent("free")])).toEqual({ kind: "lead", crew: [] });
  });
});

describe("the mapping of agents and computers", () => {
  const api = (id: string, over: Partial<Agent> = {}) =>
    ({ id, name: id, handle: id, ownerUserId: "ana", ...over }) as Agent;
  const machine = (id: string, agents: string[]) =>
    ({ id, agents: agents.map((a) => ({ id: a, name: a, handle: a })) }) as unknown as Machine;
  test("reads worksOn and crew from the API and the computer from the machines list", () => {
    const [lead, member, loose] = worksOnAgents(
      [api("lead", { crew: [ref("m")] }), api("m", { worksOnAgentId: "lead", worksOn: ref("lead") }), api("loose")],
      [machine("m1", ["lead"])],
    );
    expect(lead).toMatchObject({ machineId: "m1", crew: [ref("m")], worksOn: null });
    expect(member).toMatchObject({ machineId: null, worksOnAgentId: "lead", worksOn: ref("lead") });
    expect(loose).toMatchObject({ machineId: null, crew: [], worksOn: null });
  });
});

describe("the lead's list is bounded", () => {
  const crew = Array.from({ length: 12 }, (_, i) => agent(`m${i}`));
  test("at the limit: all shown, none hidden; one past it: the rest are counted", () => {
    expect(worksOnCrewShown(crew.slice(0, 5), 5)).toEqual({ shown: crew.slice(0, 5), more: 0 });
    expect(worksOnCrewShown(crew.slice(0, 6), 5)).toEqual({ shown: crew.slice(0, 5), more: 1 });
    expect(worksOnCrewShown(crew, 5)).toEqual({ shown: crew.slice(0, 5), more: 7 });
    expect(worksOnCrewShown([], 5)).toEqual({ shown: [], more: 0 });
  });
});
