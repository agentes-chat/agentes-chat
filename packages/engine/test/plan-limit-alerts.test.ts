import { afterEach, expect, spyOn, test } from "bun:test";
import { ACCOUNTS_PROTOCOL, type PlanUsage, type RunnerAccountInfo } from "@agenteschat/adapters";
import { eq, schema, sql } from "@agenteschat/db";
import { withRateLimit } from "../../../apps/server/runner/plan-usage";
import { createOrganization, noticeOn, setNoticePref, storeOwnUsage, syncMachineAccounts } from "../src";
import { notify } from "../src/notifications";
import { alertPlanLimits, checkPlanLimits } from "../src/plan-limit-alerts";
import { renderPush } from "../src/push-messages";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/** ADR 0063 addendum 2026-11-18: an AI account at 90% of a window tells its people once per reset period. */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const ACCOUNT = "0193eeee-0000-4000-8000-000000000001";
const SECOND = "0193eeee-0000-4000-8000-000000000002";
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const soon = (hours = 2) => iso(Date.now() + hours * HOUR);

const reading = (
  usedPercent: number,
  resetsAt: string | null = soon(),
  kind = "five_hour",
  at = iso(Date.now()),
): PlanUsage =>
  ({
    windows: [{ kind, usedPercent, ...(resetsAt ? { resetsAt } : {}) }],
    source: "probe",
    at,
  }) as PlanUsage;

const report = (id: string, usage: PlanUsage): RunnerAccountInfo => ({
  id,
  kind: "claude_code",
  loggedIn: true,
  email: "ana@example.com",
  shared: true,
  usage,
});

async function computer(name = "mac", orgId = f.org.id) {
  const { machineId } = await pairMachine({ db: f.db, pubsub: f.pubsub }, f.owner.id, orgId, {
    name,
    hostname: name,
    os: "darwin",
    arch: "arm64",
    version: "0.9.0",
    workspace: "/Users/a/agentes",
    protocol: ACCOUNTS_PROTOCOL,
    exec: true,
  });
  return machineId;
}

const addAccount = (machineId: string, id = ACCOUNT, over: Record<string, unknown> = {}) =>
  f.db.insert(schema.machineAccounts).values({
    id,
    orgId: f.org.id,
    machineId,
    kind: "claude_code",
    label: "Trabalho",
    email: "ana@example.com",
    status: "active",
    shared: true,
    createdBy: f.owner.id,
    ...over,
  });

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const at = (ms: number) => ({ ...deps(), now: () => new Date(ms) });
const sync = (machineId: string, ...accounts: RunnerAccountInfo[]) =>
  syncMachineAccounts(deps(), f.org.id, machineId, accounts);
const told = () => f.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "plan_limit_near"));
const setUsage = (usage: PlanUsage, id = ACCOUNT) =>
  f.db
    .update(schema.machineAccounts)
    .set({ usage: usage as never })
    .where(eq(schema.machineAccounts.id, id));
/** A reading stored as of `ms`, then the alert as that moment sees it. */
async function readAt(machineId: string, ms: number, usage: PlanUsage, id = ACCOUNT) {
  await setUsage(usage, id);
  await alertPlanLimits(at(ms), f.org.id, machineId);
}

test("crossing 90% tells the owner once, however often it is reported", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const resetsAt = soon();
  await sync(machineId, report(ACCOUNT, reading(89, resetsAt)));
  expect(await told()).toHaveLength(0);
  await sync(machineId, report(ACCOUNT, reading(90, resetsAt)));
  await sync(machineId, report(ACCOUNT, reading(93, resetsAt)));
  await sync(machineId, report(ACCOUNT, reading(100, resetsAt)));
  const rows = await told();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    userId: f.owner.id,
    source: { label: "Trabalho", accountId: ACCOUNT, machineId },
    latest: { percent: 90, window: { kind: "five_hour" }, resetsAt },
  });
  expect(JSON.stringify(await f.db.select().from(schema.planLimitAlerts))).not.toContain("ana@example.com");
});

test("what was told survives a restart, and a reset that moved a little is the same period", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const reset = Date.now() + 2 * HOUR;
  await sync(machineId, report(ACCOUNT, reading(95, iso(reset))));
  // As after a restart: only the table remembers. The provider counted the reset from a later moment.
  await alertPlanLimits(deps(), f.org.id, machineId);
  await sync(machineId, report(ACCOUNT, reading(96, iso(reset + 90_000))));
  expect(await told()).toHaveLength(1);
});

test("the next period tells again; a window already reset says nothing", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const first = Date.now() + 2 * HOUR;
  await sync(machineId, report(ACCOUNT, reading(91, iso(first))));
  const after = first + 60_000;
  // The old reading, read after its reset: empty by now.
  await alertPlanLimits(at(after), f.org.id, machineId);
  expect(await told()).toHaveLength(1);
  // A reading a moment past the reset, its time barely moved: still that period.
  await readAt(machineId, after, reading(92, iso(first + 120_000), "five_hour", iso(after)));
  expect(await told()).toHaveLength(1);
  const next = iso(first + 5 * HOUR);
  await readAt(machineId, after + 1000, reading(92, next, "five_hour", iso(after + 1000)));
  const rows = await told();
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.latest.resetsAt)).toContain(next);
});

test("a first reading with no reset doesn't hide the periods after it", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  await readAt(machineId, t, reading(95, null, "five_hour", iso(t)));
  expect(await told()).toHaveLength(1);
  for (const [i, hours] of [1, 6, 11].entries()) {
    const now = t + hours * HOUR;
    await readAt(machineId, now, reading(95, iso(now + 4 * HOUR), "five_hour", iso(now)));
    expect(await told()).toHaveLength(i + 2);
  }
});

test("a reset moved earlier is a new period at once", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  await readAt(machineId, t, reading(95, iso(t + 7 * DAY), "seven_day", iso(t)));
  const later = t + DAY;
  await readAt(machineId, later, reading(95, iso(later + 2 * DAY), "seven_day", iso(later)));
  expect(await told()).toHaveLength(2);
});

test("a late reading from another computer takes nothing over", async () => {
  f = await setup();
  const one = await computer("one");
  const two = await computer("two");
  await addAccount(one);
  await addAccount(two, SECOND);
  const t = Date.now();
  await readAt(one, t, reading(95, iso(t + 3 * HOUR), "five_hour", iso(t)));
  await readAt(two, t + 1000, reading(95, iso(t - HOUR + 6 * HOUR), "five_hour", iso(t - 60_000)), SECOND);
  expect(await told()).toHaveLength(1);
});

test("a reading older than its window, with no reset, says nothing on any hello", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const old = iso(Date.now() - 60 * DAY);
  await setUsage(reading(95, null, "five_hour", old));
  for (let i = 0; i < 3; i++) await alertPlanLimits(deps(), f.org.id, machineId);
  await storeOwnUsage(deps(), f.org.id, machineId, { claude_code: reading(95, null, "five_hour", old) });
  await alertPlanLimits(deps(), f.org.id, machineId);
  expect(await told()).toHaveLength(0);
});

test("a window with no reset is told once per its length", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  await readAt(machineId, t, reading(97, null, "five_hour", iso(t)));
  await readAt(machineId, t + 4 * HOUR, reading(98, null, "five_hour", iso(t + 4 * HOUR)));
  expect(await told()).toHaveLength(1);
  await readAt(machineId, t + 5 * HOUR, reading(97, null, "five_hour", iso(t + 5 * HOUR)));
  expect(await told()).toHaveLength(2);
});

test("only what limits the account alerts: a model's week and extra usage don't, a model group's quota does", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const usage = {
    windows: [
      { kind: "five_hour", usedPercent: 95, resetsAt: soon(2) },
      { kind: "seven_day", usedPercent: 92, resetsAt: soon(40) },
      { kind: "seven_day_opus", usedPercent: 99, resetsAt: soon(40) },
      { kind: "seven_day_sonnet", usedPercent: 99, resetsAt: soon(40) },
      { kind: "other", label: "Extra usage", usedPercent: 100 },
      { kind: "other", label: "Fable", usedPercent: 100, resetsAt: soon(40) },
    ],
    source: "probe",
    at: iso(Date.now()),
  } as PlanUsage;
  await sync(machineId, report(ACCOUNT, usage));
  const kinds = (await told()).map((r) => (r.latest as { window?: { kind: string } }).window?.kind);
  expect(kinds.sort()).toEqual(["five_hour", "seven_day"]);

  await addAccount(machineId, SECOND, { kind: "antigravity", email: "gem@example.com", label: "Gemini" });
  await setUsage(
    {
      windows: [{ kind: "other", label: "Claude and GPT models · 5h", usedPercent: 95, resetsAt: soon(2) }],
      source: "probe",
      at: iso(Date.now()),
    } as PlanUsage,
    SECOND,
  );
  await alertPlanLimits(deps(), f.org.id, machineId);
  expect((await told()).filter((r) => r.source.accountId === SECOND)).toHaveLength(1);
});

test("one account on two computers is told once, to both people who connected it", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const one = await computer("one");
  const two = await computer("two");
  await addAccount(one);
  await addAccount(two, SECOND, { createdBy: bia.id });
  const resetsAt = soon();
  await sync(one, report(ACCOUNT, reading(91, resetsAt)));
  await sync(two, report(SECOND, reading(91, resetsAt)));
  expect((await told()).map((r) => r.userId).sort()).toEqual([f.owner.id, bia.id].sort());
});

test("whose agents think with it hear it, by its name; its owner reads their own; the rest hear nothing", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const caio = await addMember(f.db, f.org.id, "member", "Caio");
  const machineId = await computer();
  // Never named: its owner knows it by the email, everyone else by the name.
  await addAccount(machineId, ACCOUNT, { label: "Claude 2", serves: "everyone" });
  await f.db
    .update(schema.agents)
    .set({ machineId, brain: "claude_code", brainAccountId: ACCOUNT, ownerUserId: bia.id })
    .where(eq(schema.agents.id, f.agent.id));
  await sync(machineId, report(ACCOUNT, reading(92)));
  const rows = await told();
  expect(rows.map((r) => r.userId).sort()).toEqual([f.owner.id, bia.id].sort());
  expect(rows.map((r) => r.userId)).not.toContain(caio.id);
  expect(rows.find((r) => r.userId === f.owner.id)?.source.label).toBe("ana@example.com");
  const theirs = rows.find((r) => r.userId === bia.id);
  expect(theirs?.source.label).toBe("Claude 2");
  expect(JSON.stringify(theirs)).not.toContain("ana@example.com");
});

test("who chose it for their own right hand hears it", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const machineId = await computer();
  await addAccount(machineId);
  await f.db
    .insert(schema.rightHandBrains)
    .values({ orgId: f.org.id, userId: bia.id, brain: "claude_code", brainAccountId: ACCOUNT });
  await sync(machineId, report(ACCOUNT, reading(92)));
  expect((await told()).map((r) => r.userId)).toContain(bia.id);
});

test("an account of nobody goes to whoever connected the computer it is on", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const one = await computer("one");
  const two = await computer("two");
  await f.db.update(schema.machines).set({ pairedByUserId: bia.id }).where(eq(schema.machines.id, two));
  await f.db.update(schema.machines).set({ pairedByUserId: null }).where(eq(schema.machines.id, one));
  await addAccount(one, ACCOUNT, { createdBy: null });
  await addAccount(two, SECOND, { createdBy: null });
  // Reported by the computer nobody connected: the other login's pairer is the one who hears.
  await setUsage(reading(92));
  await alertPlanLimits(deps(), f.org.id, one);
  expect((await told()).map((r) => r.userId)).toEqual([bia.id]);
});

test("a computer's own sign-in tells who connected the computer, unless it is signed out", async () => {
  f = await setup();
  const machineId = await computer();
  await storeOwnUsage(deps(), f.org.id, machineId, { claude_code: reading(94) });
  await storeOwnUsage(deps(), f.org.id, machineId, { claude_code: reading(95) });
  const rows = await told();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId: f.owner.id, source: { label: "Claude · mac", machineId } });
  expect(rows[0]?.source.accountId).toBeUndefined();

  const out = await computer("out");
  const [m] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, out));
  await f.db
    .update(schema.machines)
    .set({ executors: { ...m?.executors, claude: { loggedIn: false } } as never })
    .where(eq(schema.machines.id, out));
  await storeOwnUsage(deps(), f.org.id, out, { claude_code: reading(95) });
  expect(await told()).toHaveLength(1);
});

test("a signed-out account says nothing", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId, ACCOUNT, { status: "signed_out", usage: reading(99) });
  await alertPlanLimits(deps(), f.org.id, machineId);
  expect(await told()).toHaveLength(0);
  expect(await f.db.select().from(schema.planLimitAlerts)).toHaveLength(0);
});

test("a failure tells nobody and keeps no claim, stops no other account, is logged, and the next reading retries", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId, ACCOUNT, { label: "Ruim" });
  await addAccount(machineId, SECOND, { label: "Boa", email: "bia@example.com" });
  await f.db.execute(
    sql.raw(`create function refuse_alert() returns trigger language plpgsql as $$
      begin if new.source->>'label' = 'Ruim' then raise exception 'no room'; end if; return new; end $$`),
  );
  await f.db.execute(
    sql.raw("create trigger refuse_alert before insert on notifications for each row execute function refuse_alert()"),
  );
  const warned: unknown[] = [];
  const log = { warn: (_: string, data?: Record<string, unknown>) => void warned.push(data) };
  const usage = reading(95);
  await syncMachineAccounts({ ...deps(), log }, f.org.id, machineId, [
    report(ACCOUNT, usage),
    { ...report(SECOND, usage), email: "bia@example.com" },
  ]);
  // The usage is stored all the same.
  const [row] = await f.db.select().from(schema.machineAccounts).where(eq(schema.machineAccounts.id, ACCOUNT));
  expect(row?.usage?.windows[0]?.usedPercent).toBe(95);
  expect((await told()).map((r) => r.source.label)).toEqual(["Boa"]);
  expect(await f.db.select().from(schema.planLimitAlerts)).toHaveLength(1);
  expect(warned).toHaveLength(1);

  await f.db.execute(sql.raw("drop trigger refuse_alert on notifications"));
  await alertPlanLimits(deps(), f.org.id, machineId);
  expect((await told()).map((r) => r.source.label).sort()).toEqual(["Boa", "Ruim"]);
});

test("each workspace keeps its own alerts and its own people", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const { organization: two } = await createOrganization(f.db, f.owner.id, { name: "Two" });
  const here = await computer("here");
  const there = await computer("there", two.id);
  await addAccount(here, ACCOUNT, { createdBy: bia.id });
  await addAccount(there, SECOND, { orgId: two.id });
  const usage = reading(95);
  await setUsage(usage);
  await setUsage(usage, SECOND);
  await alertPlanLimits(deps(), f.org.id, here);
  await alertPlanLimits(deps(), two.id, there);
  const rows = await told();
  expect(rows.map((r) => [r.orgId, r.userId]).sort()).toEqual(
    [
      [f.org.id, bia.id],
      [two.id, f.owner.id],
    ].sort(),
  );
  expect(await f.db.select().from(schema.planLimitAlerts)).toHaveLength(2);
});

const phone = () =>
  f.db.insert(schema.pushDevices).values({
    userId: f.owner.id,
    platform: "android",
    token: "phone-token",
    locale: "pt-BR",
  });

test("the person can turn the phone's alert off: the inbox keeps it", async () => {
  f = await setup();
  expect(noticeOn({}, "plan_limit_near", false)).toBe(true);
  const view = await setNoticePref(f.db, f.org.id, f.owner.id, "plans", false);
  expect(view.categories.find((c) => c.id === "plans")?.on).toBe(false);
  const machineId = await computer();
  await addAccount(machineId);
  await phone();
  await sync(machineId, report(ACCOUNT, reading(92)));
  expect(await told()).toHaveLength(1);
  expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"))).toHaveLength(0);
});

test("with the alert on, it goes to the phone through the usual job", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  await phone();
  await sync(machineId, report(ACCOUNT, reading(92)));
  expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"))).toHaveLength(1);
});

const MINUTE = 60_000;
const pushJobs = () => f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"));

test("a reset that runs ahead of every reading is one alert while the account stays over the line", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  await phone();
  const t = Date.now();
  // Past the first reset too: seven hours of readings, each resetting five hours after itself.
  for (let i = 0; i <= 84; i++) {
    const now = t + i * 5 * MINUTE;
    await readAt(machineId, now, reading(95, iso(now + 5 * HOUR), "five_hour", iso(now)));
  }
  expect(await told()).toHaveLength(1);
  expect(await pushJobs()).toHaveLength(1);
});

test("a reset sliding a minute per reading is one alert too", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  for (let i = 0; i <= 24; i++) {
    const now = t + i * 5 * MINUTE;
    await readAt(machineId, now, reading(95, iso(t + 3 * HOUR + i * MINUTE), "five_hour", iso(now)));
  }
  expect(await told()).toHaveLength(1);
});

test("a real drop with a new reset tells the next crossing, and the row stays", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now() - HOUR;
  const first = iso(t + 4 * HOUR);
  const next = iso(t + 90 * HOUR);
  const send = (percent: number, reset: string, minutes: number) =>
    sync(machineId, report(ACCOUNT, reading(percent, reset, "five_hour", iso(t + minutes * MINUTE))));
  await send(95, first, 0);
  await send(96, first, 1);
  expect(await told()).toHaveLength(1);
  await send(10, next, 2);
  const [row] = await f.db.select().from(schema.planLimitAlerts);
  expect(row?.rearmedAt?.toISOString()).toBe(iso(t + 2 * MINUTE));
  expect(row?.alertedAt.toISOString()).toBe(iso(t));
  expect(await told()).toHaveLength(1);
  await send(91, next, 3);
  expect(await told()).toHaveLength(2);
  const [after] = await f.db.select().from(schema.planLimitAlerts);
  expect(after?.rearmedAt).toBeNull();
});

test("a number going round the line within one reset is one alert", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  const reset = iso(t + 4 * HOUR);
  for (let i = 0; i < 24; i++) {
    const now = t + i * 5 * MINUTE;
    await readAt(machineId, now, reading(i % 2 ? 89 : 91, reset, "five_hour", iso(now)));
  }
  expect(await told()).toHaveLength(1);
});

test("under 80% with the same reset, or between 80% and the line with a new one, ends no period", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const t = Date.now();
  const reset = t + 40 * HOUR;
  await readAt(machineId, t, reading(95, iso(reset), "seven_day", iso(t)));
  await readAt(machineId, t + MINUTE, reading(10, iso(reset), "seven_day", iso(t + MINUTE)));
  await readAt(machineId, t + 2 * MINUTE, reading(85, iso(reset + 9 * HOUR), "seven_day", iso(t + 2 * MINUTE)));
  const [row] = await f.db.select().from(schema.planLimitAlerts);
  expect(row?.rearmedAt).toBeNull();
  await readAt(machineId, t + 3 * MINUTE, reading(95, iso(reset), "seven_day", iso(t + 3 * MINUTE)));
  expect(await told()).toHaveLength(1);
});

test("a second computer's old number, under a new reading's time, re-arms nothing", async () => {
  f = await setup();
  const a = await computer("a");
  const b = await computer("b");
  await addAccount(a);
  await addAccount(b, SECOND);
  const t = Date.now();
  const reset = iso(t + 96 * HOUR);
  // What the runner does (`withRateLimit`): the week it last knew, stamped with the time of an event about another window.
  let onB = reading(85, reset, "seven_day", iso(t - 3 * HOUR));
  for (let i = 0; i < 6; i++) {
    const now = t + i * 10 * MINUTE;
    await readAt(a, now, reading(92 + (i % 3), reset, "seven_day", iso(now)));
    onB = withRateLimit(
      onB,
      { status: "allowed", rateLimitType: "five_hour", utilization: 0.2, resetsAt: Math.floor((t + 2 * HOUR) / 1000) },
      now + MINUTE,
    ) as PlanUsage;
    await readAt(b, now + MINUTE, onB, SECOND);
  }
  expect(await told()).toHaveLength(1);
});

test("a late reading at the line after a new period was seen tells nothing", async () => {
  f = await setup();
  const a = await computer("a");
  const b = await computer("b");
  await addAccount(a);
  await addAccount(b, SECOND);
  const t = Date.now();
  const reset = t + 96 * HOUR;
  const newer = reset + 72 * HOUR;
  await readAt(a, t, reading(95, iso(reset), "seven_day", iso(t)));
  await readAt(a, t + 2 * HOUR, reading(10, iso(newer), "seven_day", iso(t + 2 * HOUR)));
  await readAt(b, t + 3 * HOUR, reading(95, iso(newer), "seven_day", iso(t + HOUR)), SECOND);
  expect(await told()).toHaveLength(1);
  // A reading after the mark is the new crossing.
  await readAt(a, t + 3 * HOUR, reading(96, iso(newer), "seven_day", iso(t + 3 * HOUR)));
  expect(await told()).toHaveLength(2);
});

test("after a new period, a computer still holding the old reset tells nothing", async () => {
  f = await setup();
  const a = await computer("a");
  const b = await computer("b");
  await addAccount(a);
  await addAccount(b, SECOND);
  const t = Date.now();
  const reset = t + 96 * HOUR;
  await readAt(a, t, reading(95, iso(reset), "seven_day", iso(t)));
  await readAt(a, t + HOUR, reading(10, iso(reset + 72 * HOUR), "seven_day", iso(t + HOUR)));
  await readAt(b, t + 2 * HOUR, reading(95, iso(reset), "seven_day", iso(t + 2 * HOUR)), SECOND);
  expect(await told()).toHaveLength(1);
});

test("an older reading below the line ends nothing", async () => {
  f = await setup();
  const one = await computer("one");
  const two = await computer("two");
  await addAccount(one);
  await addAccount(two, SECOND);
  const t = Date.now();
  const reset = iso(t + 3 * HOUR);
  await readAt(one, t, reading(95, reset, "five_hour", iso(t)));
  await readAt(two, t + 1000, reading(70, reset, "five_hour", iso(t - MINUTE)), SECOND);
  await readAt(one, t + 2000, reading(96, reset, "five_hour", iso(t + 2000)));
  expect(await told()).toHaveLength(1);
});

test("a report below the line with nothing told of costs one read", async () => {
  f = await setup();
  const machineId = await computer();
  const select = spyOn(f.db, "select");
  await checkPlanLimits(deps(), f.org.id, machineId, [reading(40)]);
  expect(select).toHaveBeenCalledTimes(1);
  select.mockRestore();
});

test("two computers reporting at once tell it once", async () => {
  f = await setup();
  const one = await computer("one");
  const two = await computer("two");
  await addAccount(one);
  await addAccount(two, SECOND);
  const usage = reading(95);
  await setUsage(usage);
  await setUsage(usage, SECOND);
  await Promise.all([alertPlanLimits(deps(), f.org.id, one), alertPlanLimits(deps(), f.org.id, two)]);
  expect(await told()).toHaveLength(1);
});

test("the push never carries the account's email: its given name, else its maker", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId, ACCOUNT, { label: "Claude 2" });
  await addAccount(machineId, SECOND, { label: "Trabalho", email: "bia@example.com" });
  await setUsage(reading(95));
  await setUsage(reading(95), SECOND);
  await alertPlanLimits(deps(), f.org.id, machineId);
  const rows = await told();
  const push = (accountId: string) => {
    const r = rows.find((x) => x.source.accountId === accountId);
    return renderPush("pt-BR", {
      kind: "plan_limit_near",
      waiting: false,
      label: r?.source.label as string,
      title: r?.latest.title as string,
      percent: 95,
    });
  };
  // The inbox line may keep the owner's address; what leaves for the phone does not.
  expect(rows.find((x) => x.source.accountId === ACCOUNT)?.source.label).toBe("ana@example.com");
  expect(push(ACCOUNT).title).toBe("Claude: 95% do limite usado");
  expect(push(SECOND).title).toBe("Trabalho: 95% do limite usado");
});

test("notify tells each person in turn: one failing leaves the one before fully told", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const members = await f.db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.orgId, f.org.id));
  const [first, second] = members.map((m) => m.userId).filter((id) => id === f.owner.id || id === bia.id);
  await f.db.insert(schema.pushDevices).values({
    userId: first as string,
    platform: "android",
    token: "phone-token",
    locale: "pt-BR",
  });
  await f.db.execute(
    sql.raw(`create function refuse_second() returns trigger language plpgsql as $$
      begin if new.user_id = '${second}' then raise exception 'no room'; end if; return new; end $$`),
  );
  await f.db.execute(
    sql.raw(
      "create trigger refuse_second before insert on notifications for each row execute function refuse_second()",
    ),
  );
  const input = {
    orgId: f.org.id,
    userIds: [first, second],
    kind: "machine_connected" as const,
    groupKey: "machine_connected:test",
    source: { label: "mac" },
  };
  await expect(notify(deps(), input)).rejects.toThrow();
  expect(await pushJobs()).toHaveLength(1);
  await f.db.execute(sql.raw("drop trigger refuse_second on notifications"));
  expect(await notify(deps(), input)).toHaveLength(1);
  expect(await pushJobs()).toHaveLength(1);
});
