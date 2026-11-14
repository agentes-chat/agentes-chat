import { describe, expect, test } from "bun:test";
import { planModelUsage } from "@agenteschat/client/lib/plan-usage";
import { translator } from "./fixtures";

const source = (file: string) => Bun.file(new URL(`../../src/features/usage/${file}`, import.meta.url).pathname).text();

describe("Uso: a plan's models at a limit of their own", () => {
  test("one line each in the phone's words, in the plan's order, an expired limit left out", async () => {
    const t = await translator("pt-BR");
    const now = new Date("2026-11-13T12:00:00.000Z");
    const at = now.toISOString();
    const rows = planModelUsage(
      t,
      "pt-BR",
      {
        models: {
          "glm-5.3": { at, until: "2026-11-14T18:00:00.000Z" },
          "minimax-m3": { at, off: true },
          "deepseek-v4.1-pro": { at, until: "2026-11-13T11:00:00.000Z" },
        },
      },
      "opencode",
      now,
    );
    expect(rows.map((r) => r.label)).toEqual(["MiniMax M3", "GLM-5.3"]);
    expect(rows[0]?.text).toBe("Desligado");
    expect(rows[1]?.text).toMatch(/^Sem cota · renova /);
  });

  test("the workspace's accounts and the agent's Agora list them under the windows", async () => {
    for (const file of ["UsageScreen.tsx", "AgentUsageScreen.tsx"]) {
      expect(await source(file)).toMatch(
        /<PlanModels usage=\{(account|current)\.usage\} provider=\{\1\.provider\} \/>/,
      );
    }
  });
});
