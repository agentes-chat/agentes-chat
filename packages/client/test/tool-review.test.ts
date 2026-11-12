import { expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import type { CustomTool } from "../src/api/types";
import { FREEABLE_LEVELS, reviewTool, runsUnasked, SENSITIVE_LEVELS, toolName } from "../src/lib/tool-review";

const tFor = (lng: string) => {
  const instance = i18next.createInstance();
  void instance.init({ lng, fallbackLng: "en", resources, initAsync: false });
  return instance.t.bind(instance) as TFunction;
};

test("a tool's name in the language's word order: the verb last in ja and ko", () => {
  const parts = { verb: "get", words: ["campaign", "budget"] };
  expect(toolName(tFor("en"), parts, "campaign_budget_get")).toBe("Get campaign budget");
  expect(toolName(tFor("pt-BR"), parts, "campaign_budget_get")).toBe("Ver orçamento da campanha");
  expect(toolName(tFor("ja"), parts, "campaign_budget_get")).toBe("キャンペーンの 予算 取得");
  expect(toolName(tFor("ko"), parts, "campaign_budget_get")).toBe("캠페인 예산 조회");
});

test("a sensitive tool: write too when the server lets it be freed, a free level only once a person freed it", () => {
  const t = tFor("en");
  const tool = (extra: Partial<CustomTool>): CustomTool => ({
    name: "campaign_delete",
    description: "",
    readOnlyHint: null,
    access: "write",
    level: "write",
    sensitive: true,
    label: "Delete campaign",
    firstSeenAt: "2026-11-12T00:00:00Z",
    ...extra,
  });
  const freed = reviewTool(t, tool({ freed: true, mayFree: true }));
  expect([freed.level, freed.levels]).toEqual(["write", FREEABLE_LEVELS]);
  expect(runsUnasked(freed, freed.level)).toBe(true);
  expect(runsUnasked(freed, "approval")).toBe(false);
  // Stored free some other way, or as a read: it asks, as the server's gateway does.
  expect(reviewTool(t, tool({ mayFree: true })).level).toBe("approval");
  expect(reviewTool(t, tool({ access: "read", level: "read", freed: true, mayFree: true })).level).toBe("approval");
  // Composio's, or a server that doesn't say: only ask or off.
  expect(reviewTool(t, tool({ access: "approval", level: "approval", mayFree: false })).levels).toEqual(
    SENSITIVE_LEVELS,
  );
  expect(reviewTool(t, tool({ access: "approval", level: "approval" })).levels).toEqual(SENSITIVE_LEVELS);
  expect(runsUnasked(reviewTool(t, tool({ sensitive: false })), "write")).toBe(false);
});
