import type { PlanAccountUsage } from "@agenteschat/client";
import { useAiAccounts, useApi, usePlanUsage } from "@agenteschat/client";
import { computerNameOf } from "@agenteschat/client/lib/computer";
import {
  noQuotaText,
  quotaSections,
  quotaSummary,
  quotaSummaryText,
  recentLines,
  tightestAccounts,
} from "@agenteschat/client/lib/quotas";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import { Card, CardHeader, EmptyState, GroupHeading, PlanMeter } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { accountName, brandOf, groupUsageAccounts, planMeterText } from "@/lib/plan-usage";
import { PlanModels } from "./PlanModels";
import { AccountHead } from "./PlanUsage";
import "./plan-usage.css";
import "./plan-quotas.css";

/*
 * Cotas (ADR 0063 addendum 2026-11-17): every AI account the viewer sees, a card per maker, each account with all its
 * windows open (a model group's under its own heading) and when each renews, or, where the provider reports no
 * limits, its use over the last day, week and month. Uso › Cotas, and the line on Início that leads there.
 */

/** The workspace's accounts as Cotas lists them: the viewer's logins of one account as one, as "Contas" groups them. */
function useQuotaAccounts({ refresh }: { refresh: boolean }) {
  const { org } = useOrg();
  const api = useApi();
  const usage = usePlanUsage(org.id);
  const mine = useAiAccounts(org.id);
  // Looking at the quotas: they are read again (they come back as `machine.updated`). Início only reads them.
  useEffect(() => {
    if (refresh) void api.machines.refreshAccountUsage(org.id).catch(() => undefined);
  }, [api, org.id, refresh]);
  return { usage, accounts: usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : undefined };
}

/** Uso › Cotas: a card per maker. */
export function PlanQuotas() {
  const { t } = useTranslation();
  const { usage, accounts } = useQuotaAccounts({ refresh: true });
  if (usage.isLoading) {
    return (
      <Card>
        <LoadingList count={3} avatar={false} trailing />
      </Card>
    );
  }
  if (!accounts) {
    return (
      <Card>
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      </Card>
    );
  }
  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState size="panel" title={t("quotas.empty")}>
          {t("usageViews.accounts.empty")}
        </EmptyState>
      </Card>
    );
  }
  const several = new Set(accounts.map((a) => a.machineId)).size > 1;
  return (
    <div className="quotas">
      <p className="quotas__lead">{t("quotas.lead")}</p>
      {quotaSections(accounts).map((s) => (
        <Card key={s.maker} aria-labelledby={`quotas-${s.maker}`}>
          <CardHeader id={`quotas-${s.maker}`} mark={s.maker} title={s.name} />
          <ul className="quotas__accounts">
            {s.accounts.map((a) => (
              <QuotaAccount key={a.key} account={a} several={several} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/** One account: its head, then its meters, or why it has none and its recent use. */
function QuotaAccount({ account, several }: { account: PlanAccountUsage; several: boolean }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const text = planMeterText(t, i18n.language);
  const known = account.usage && (account.usage.windows.length > 0 || account.usage.limited === true);
  const recent = recentLines(t, i18n.language, account.recent);
  const computer = several ? computerNameOf(t, org.name, account.machineName, isPersonal(org)) : null;
  return (
    <li className="quotas__account">
      <AccountHead account={account} extra={computer} />
      {known && account.usage ? (
        <>
          <PlanMeter usage={account.usage} text={text} />
          <PlanModels usage={account.usage} provider={account.provider} />
        </>
      ) : (
        <>
          <p className="plan-empty">{noQuotaText(t, account)}</p>
          {recent.length > 0 && (
            <dl className="quotas__recent" aria-label={t("quotas.recent.title")}>
              {recent.map((r) => (
                <div key={r.period} className="quotas__period">
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </li>
  );
}

/** How many accounts Início shows, the closest to a limit. */
const HOME_QUOTAS = 3;

/**
 * Início's line into Cotas: where the workspace's AI accounts stand ("1 no limite · 2 quase no limite"), with the
 * tightest account's compact meter, and "Ver cotas". Nothing while it has no AI account.
 */
export function HomeQuotas() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  // One seat on two computers is one account here too, as Cotas lists it.
  const accounts = useQuotaAccounts({ refresh: false }).accounts ?? [];
  if (accounts.length === 0) return null;
  const summary = quotaSummary(accounts);
  const text = planMeterText(t, i18n.language);
  const tightest = tightestAccounts(accounts, HOME_QUOTAS);
  return (
    <section className="home-sec quotas-home" aria-label={t("quotas.home")}>
      <GroupHeading
        title={t("quotas.home")}
        note={quotaSummaryText(t, summary)}
        aside={
          <Link
            className="home-sec__more"
            to="/org/$orgId/settings/$section"
            params={{ orgId: org.id, section: "usage" }}
            search={{ view: "quotas" }}
          >
            {t("quotas.seeAll")}
          </Link>
        }
      />
      {tightest.length > 0 && (
        <ul className="list-card quotas-home__list">
          {tightest.map((a) =>
            a.usage ? (
              <li key={a.key} className="quotas-home__row">
                <PlanMeter usage={a.usage} text={text} compact label={`${brandOf(a)} · ${accountName(t, a)}`} />
              </li>
            ) : null,
          )}
        </ul>
      )}
    </section>
  );
}
