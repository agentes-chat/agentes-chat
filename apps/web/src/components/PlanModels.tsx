import type { PlanUsage } from "@agenteschat/client";
import { planModelUsage } from "@agenteschat/client/lib/plan-usage";
import { useTranslation } from "react-i18next";
import "./plan-models.css";

/*
 * The quota per model of a plan whose models have limits of their own (OpenCode Go): the account's windows only say
 * how much the whole account used, so each model that is out gets its own line (`PlanUsage.models`). Shown to people
 * in an account's row and under the meters of "Quem pensa" (ADR 0063, #320).
 */

/**
 * One line per model at a limit of its own ("GLM-5.3 — Sem quota · renova sáb 18:00"): its name, then where its quota
 * stands (no quota left and when it resets, off, the region it needs, or no subscription). Nothing while none is.
 */
export function PlanModels({ usage, provider }: { usage: Pick<PlanUsage, "models"> | null; provider: string | null }) {
  const { t, i18n } = useTranslation();
  const rows = planModelUsage(t, i18n.language, usage, provider);
  if (rows.length === 0) return null;
  return (
    <div className="plan-models">
      {rows.map((r) => (
        <div key={r.id} className="plan-model" data-level="limited">
          <span className="plan-model__name">{r.label}</span>
          <small className="plan-model__text">{r.text}</small>
        </div>
      ))}
    </div>
  );
}

/** "Sem leitura de quota": the honest line where nothing reads an account's quota, instead of a number nobody read. */
export function NoQuotaReading() {
  const { t } = useTranslation();
  return <p className="plan-models__none">{t("usageViews.models.noReading")}</p>;
}
