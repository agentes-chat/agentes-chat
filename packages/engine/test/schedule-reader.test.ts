import { describe, expect, test } from "bun:test";
import type { ErrorReporter } from "@agenteschat/adapters";
import { createFakeScheduleReader, createLlmScheduleReader, readSchedule } from "../src";
import type { ModelGateway } from "../src/gateway";

// Thursday 2026-10-15, 12:00 in São Paulo.
const now = new Date("2026-10-15T15:00:00Z");
const sp = "America/Sao_Paulo";

/** A reporter that keeps what it was given, so a test can read the cause. */
function recordingReporter() {
  const captured: { error: unknown; tags: unknown }[] = [];
  const errors: ErrorReporter = {
    capture(error, tags) {
      captured.push({ error, tags });
      return undefined;
    },
    flush: async () => true,
  };
  return { errors, captured };
}

/** A gateway whose model answers `text`, or fails with `failure`. */
function gatewayAnswering(result: { text: string } | { failure: Error }): Pick<ModelGateway, "complete"> {
  return {
    complete: (async () => {
      if ("failure" in result) throw result.failure;
      return { text: result.text };
    }) as unknown as ModelGateway["complete"],
  };
}

describe("semanal quinta e domingo", () => {
  test("the model's weekdays and time become one weekly rule with cron", async () => {
    const reader = createFakeScheduleReader({
      "semanal quinta e domingo às 7h": { rule: { freq: "weekly", byWeekday: ["TH", "SU"], times: ["07:00"] } },
    });
    const reading = await readSchedule(reader, {
      orgId: "org",
      phrase: "semanal quinta e domingo às 7h",
      timezone: sp,
      now,
    });
    expect(reading).toMatchObject({
      ok: true,
      type: "cron",
      cron: "0 7 * * 0,4",
      description: "Every week, Sun and Thu, at 07:00 (Brasília time)",
    });
  });
});

describe("a reader that can't answer", () => {
  const phrase = "semanal quinta e domingo às 7h";

  test("a failed model call gives the same reply to the user and reports the cause", async () => {
    const { errors, captured } = recordingReporter();
    const failure = new Error("429 rate limited");
    const reader = createLlmScheduleReader({
      gateway: gatewayAnswering({ failure }),
      resolveModel: async () => "cheap-model",
      errors,
    });
    const reading = await readSchedule(reader, { orgId: "org", phrase, timezone: sp, now });
    expect(reading).toMatchObject({ ok: false, code: "schedule.unreadable" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.error).toBe(failure);
    expect(captured[0]?.tags).toMatchObject({ org_id: "org" });
  });

  test("an answer that is not JSON is reported and still reads as unreadable", async () => {
    const { errors, captured } = recordingReporter();
    const reader = createLlmScheduleReader({
      gateway: gatewayAnswering({ text: "desculpe, não entendi" }),
      resolveModel: async () => "cheap-model",
      errors,
    });
    const reading = await readSchedule(reader, { orgId: "org", phrase, timezone: sp, now });
    expect(reading).toMatchObject({ ok: false, code: "schedule.unreadable" });
    expect(captured).toHaveLength(1);
    expect(String(captured[0]?.error)).toContain("not JSON");
  });

  test("without a reporter the reply is the same and nothing throws", async () => {
    const reader = createLlmScheduleReader({
      gateway: gatewayAnswering({ failure: new Error("timeout") }),
      resolveModel: async () => "cheap-model",
    });
    const reading = await readSchedule(reader, { orgId: "org", phrase, timezone: sp, now });
    expect(reading).toMatchObject({ ok: false, code: "schedule.unreadable" });
  });
});
