import type { ConnectorDef, FirstAgentOption, MailAccount, Routine } from "@agenteschat/client";
import { useCatalog, useConnections, useCustomServers, useMailAccounts, useRoutines } from "@agenteschat/client";
import { connectRoutineName, connectRoutineOf } from "@agenteschat/client/lib/connect-routines";
import { connectedItems } from "@agenteschat/client/lib/connected";
import { CUSTOM_LOOK, FIRST_AREAS, type FirstArea, MAILBOX_APP } from "@agenteschat/client/lib/first-areas";
import { toYmd } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { connectorName } from "@agenteschat/client/lib/scopes";
import { Button, Field, Icon, Input, Locked, normalizeAppearance, SearchField, Textarea } from "@agenteschat/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectFlow, type FlowState } from "@/components/ConnectFlow";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { ConnectHereContext } from "@/components/connect-here";
import { MailConnectFlow, type MailFlowState } from "@/components/MailConnect";
import { fromApiRule, ruleSentence } from "@/lib/recurrence";
import { type AreaApp, useAreaApps } from "./areas";
import { Box, Meet, type ShellFace } from "./Shell";
import "./agent-step.css";

/*
 * Meeting the first agent (ADR 0256, addendum of 2026-11-27): its portrait, its name and what it does, and the apps it
 * works in as flat rows, each with Connect through the app's real connect flow (a mailbox's own), where connecting
 * brings the app's routine for this agent (ADR 0242) with its first run left for the first delivery. A connected row
 * says its account and when the routine runs. Continue once one app is connected; at once for work that starts
 * without one. "Other" (`custom`): the person names the agent and says what it does, then searches the catalog's apps.
 * The agent exists before this step shows (made on the work step), except for "Other", made by its first Connect or
 * by Continue, so a connect always has an agent to bring the routine to.
 */

/** The catalog apps "Other" lists before anything is searched: the ones most people already use. */
const MOST_USED = [
  "google-calendar",
  "google-sheets",
  "notion",
  "stripe",
  "hubspot",
  "github",
  "linear",
  "slack",
  "drive",
  "instagram",
] as const;
/** How many rows a search shows. */
const FOUND_MAX = 6;

/** Gmail through the mail flow, else the catalog's own entry: what the search and "Other app" list. */
const MAILBOX: AreaApp = {
  id: MAILBOX_APP,
  label: "Gmail",
  def: { iconUrl: "/connectors/gmail.svg", brandColor: "#EA4335" },
  catalog: null,
  mailbox: true,
};

export interface AgentStepAgent {
  id: string;
  name: string;
  role: string;
  look: ShellFace["look"];
}

export function AgentStep({
  orgId,
  org,
  agent,
  area,
  option,
  eyebrow,
  busy,
  mailBack,
  returned,
  onBack,
  onCreate,
  onContinue,
}: {
  orgId: string;
  /** The workspace's name, in the area's words ("what people say about Acme"). */
  org: string;
  /** The agent, once made (always, but for "Other" before its first Connect or Continue). */
  agent: AgentStepAgent | null;
  /** The work it was made for; `custom` for "Other"; null for one asked of the person's AI or brought from an app. */
  area: FirstArea | "custom" | null;
  /** What the person's AI proposed, for an agent made from it: its first task leads, its apps are listed. */
  option: FirstAgentOption | null;
  eyebrow?: ReactNode;
  /** Continue or the agent's making is saving. */
  busy: boolean;
  /** Where a mailbox's one-click sign-in comes back to. */
  mailBack: "onboarding" | "welcome";
  /** Back from an app's sign-in: the connection that came in (`?connected=`), or the mailbox (`?mail=`). */
  returned?: { connected?: string; outcome?: string; mail?: string; account?: string } | null;
  onBack?: (() => void) | null;
  /** "Other": makes the agent with what was typed, and answers with it. */
  onCreate: (draft: { name: string; does: string; apps: string[] }) => Promise<AgentStepAgent | null>;
  onContinue: () => void;
}) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog();
  const connections = useConnections(orgId);
  const servers = useCustomServers(orgId);
  const mail = useMailAccounts(orgId);
  const routines = useRoutines(orgId);
  const def = area && area !== "custom" ? FIRST_AREAS[area] : null;
  const custom = area === "custom";
  const [name, setName] = useState("");
  const [does, setDoes] = useState("");
  const [q, setQ] = useState("");
  // An area's own apps, or the catalog searched ("Other", "Another app", an agent with no area).
  const [searching, setSearching] = useState(!def);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [mailFlow, setMailFlow] = useState<MailFlowState | null>(null);
  const [making, setMaking] = useState(false);

  const optionApps = (option?.apps ?? []).flatMap((a) => (a.key ? [a.key] : []));
  const { apps: own } = useAreaApps(def ? def.apps : optionApps);
  const defs = catalog.data?.connectors ?? [];
  const asApp = (d: ConnectorDef): AreaApp => ({
    id: d.id,
    label: connectorName(t, d),
    def: d,
    catalog: d,
    mailbox: false,
  });
  // What "Other" lists: the most used apps with nothing searched, else the catalog's apps whose name has the words.
  const found = ((): AreaApp[] => {
    const words = q.trim().toLowerCase();
    const available = defs.filter((d) => d.available);
    if (!words) {
      const first = MOST_USED.flatMap((id) => available.find((d) => d.id === id) ?? []);
      return [MAILBOX, ...first.map(asApp)].slice(0, FOUND_MAX);
    }
    const hits = available.filter((d) => connectorName(t, d).toLowerCase().includes(words) || d.id.includes(words));
    const mailHit = MAILBOX.label.toLowerCase().includes(words) ? [MAILBOX] : [];
    return [...mailHit, ...hits.map(asApp)].slice(0, FOUND_MAX);
  })();
  const rows = searching ? found : own;

  // What is connected here, by app: a catalog connection, or the person's Gmail.
  const connectedOf = (app: AreaApp): { account: string } | null => {
    if (app.mailbox) {
      const box = (mail.data ?? []).find((m: MailAccount) => m.provider === "gmail");
      return box ? { account: box.address } : null;
    }
    const c = (connections.data ?? []).find((x) => x.connector === app.id && !x.revokedAt);
    return c ? { account: c.accountLabel || c.label } : null;
  };
  // When the routine the app brought runs, for this agent.
  const whenOf = (app: AreaApp): string | null => {
    const r = connectRoutineOf(app.mailbox ? "mailbox" : app.id);
    if (!r || !agent) return null;
    const named = connectRoutineName(t, r).toLowerCase();
    const made = (routines.data ?? []).find((x: Routine) => x.agentId === agent.id && x.name.toLowerCase() === named);
    const rule = made?.trigger.type === "schedule" ? made.trigger.rule : null;
    return rule ? ruleSentence(t, i18n.language, fromApiRule(rule, toYmd(new Date())), new Date(), false) : null;
  };
  const anyConnected = own.some((a) => connectedOf(a) !== null) || found.some((a) => connectedOf(a) !== null);
  // Continue: once one app is connected; at once where the work needs none, or where none can connect here.
  const ready = custom
    ? agent !== null || (name.trim() !== "" && does.trim() !== "")
    : !def || Boolean(def.open) || own.length === 0 || anyConnected;

  /** The agent a Connect brings its routine to: "Other" makes it first. */
  const ensureAgent = async (): Promise<AgentStepAgent | null> => {
    if (agent) return agent;
    if (!name.trim() || !does.trim()) return null;
    setMaking(true);
    try {
      return await onCreate({ name: name.trim(), does: does.trim(), apps: [] });
    } finally {
      setMaking(false);
    }
  };
  const connect = async (app: AreaApp) => {
    if (!(await ensureAgent())) return;
    if (app.mailbox) setMailFlow({ step: 0, choice: "gmail" });
    else if (app.catalog) setFlow({ step: 0, def: app.catalog });
  };

  // Back from an app's sign-in (OAuth leaves the page): the flow reopens on its confirmation, which makes the routine.
  const back = useRef(false);
  useEffect(() => {
    if (back.current || !returned || !agent) return;
    if (returned.connected && connections.data && servers.data && catalog.data) {
      back.current = true;
      // The newest of that app's connections: its confirmation, where its routine is made (as Settings does).
      const item = connectedItems(connections.data, servers.data, catalog.data.connectors)
        .filter((x) => !x.custom && x.def?.id === returned.connected)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (item && returned.outcome !== "reconnected" && returned.outcome !== "same_account")
        setFlow({ step: "done", item });
    }
    if (returned.mail === "connected" && mail.data) {
      back.current = true;
      const box = mail.data.find((m) => m.id === returned.account) ?? mail.data[0];
      if (box) setMailFlow({ step: 1, account: box });
    }
  }, [returned, agent, connections.data, servers.data, catalog.data, mail.data]);

  const face: ShellFace = agent
    ? { id: agent.id, name: agent.name, look: agent.look }
    : { id: "new-agent", name: name || "?", look: normalizeAppearance(CUSTOM_LOOK) };
  const who = agentGrammar(agent?.name ?? name);
  const title = def
    ? t(`onboarding.areas.list.${def.id}.heading`, { name: def.name, org })
    : custom && !agent
      ? t("onboarding.meet.customTitle")
      : (agent?.name ?? "");
  const lead = def
    ? t(`onboarding.areas.list.${def.id}.does`, { org, ...agentGrammar(def.name) })
    : custom && !agent
      ? undefined
      : (option?.tasks[0] ?? agent?.role ?? undefined);
  const label = def
    ? t(`onboarding.areas.list.${def.id}.connect`, agentGrammar(def.name))
    : t("onboarding.meet.apps", who);

  const appRows = (list: readonly AreaApp[]) => (
    <ul className="onb-rows">
      {list.map((app) => {
        const on = connectedOf(app);
        const when = on ? whenOf(app) : null;
        return (
          <li key={app.id} className="onb-row">
            <ConnectorIcon def={app.def} label={app.label} size="lg" />
            <span className="onb-row__text">
              <span className="onb-row__head">
                <b className="onb-row__name">{app.label}</b>
                {on ? (
                  <span className="onb-ok">
                    <Icon name="check" size={16} />
                    <span>{t("onboarding.meet.connected")}</span>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy || making || (custom && !agent && (!name.trim() || !does.trim()))}
                    onClick={() => void connect(app)}
                  >
                    {t("onboarding.meet.connect")}
                  </Button>
                )}
              </span>
              {on && (
                <span className="onb-row__sub">
                  {when ? t("onboarding.meet.account", { account: on.account, when }) : on.account}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <ConnectHereContext.Provider value={{ agentId: agent?.id, firstRunLater: true, mailBack }}>
      <Box
        cover={<Meet who={face} />}
        eyebrow={eyebrow}
        title={title}
        lead={lead}
        onBack={onBack}
        busy={busy || making}
        acts={
          <Button
            variant="primary"
            kbd={["↵"]}
            data-enter=""
            disabled={!ready || busy || making}
            loading={busy || making}
            onClick={async () => {
              if (custom && !(await ensureAgent())) return;
              onContinue();
            }}
          >
            {t("onboarding.actions.continue")}
          </Button>
        }
      >
        <Locked when={busy || making}>
          {custom && !agent ? (
            <div className="onb-form">
              <Field label={t("onboarding.meet.name")} id="onb-agent-name">
                <Input
                  id="onb-agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  autoFocus
                />
              </Field>
              <Field label={t("onboarding.meet.does")} id="onb-agent-does">
                <Textarea
                  id="onb-agent-does"
                  rows={2}
                  value={does}
                  onChange={(e) => setDoes(e.target.value)}
                  maxLength={500}
                />
              </Field>
              <Field label={t("onboarding.meet.appsUsed")} id="onb-agent-apps">
                <SearchField
                  id="onb-agent-apps"
                  value={q}
                  placeholder={t("onboarding.meet.search")}
                  aria-label={t("onboarding.meet.search")}
                  onChange={(e) => setQ(e.target.value)}
                />
              </Field>
              {found.length > 0 ? appRows(found) : <p className="onb-rows__none">{t("onboarding.meet.noApps")}</p>}
            </div>
          ) : (
            <div className="onb-apps">
              <p className="onb-apps__label">{label}</p>
              {searching && (
                <SearchField
                  value={q}
                  placeholder={t("onboarding.meet.search")}
                  aria-label={t("onboarding.meet.search")}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                />
              )}
              {rows.length > 0
                ? appRows(rows)
                : searching && <p className="onb-rows__none">{t("onboarding.meet.noApps")}</p>}
              {!searching && (
                <div className="onb-row onb-row--more">
                  <Button variant="link" icon="plus" onClick={() => setSearching(true)}>
                    {t("onboarding.meet.otherApp")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Locked>
        <ConnectFlow
          flow={flow}
          onChange={setFlow}
          onClose={() => setFlow(null)}
          returnTo={mailBackPath(mailBack, orgId)}
        />
        <MailConnectFlow flow={mailFlow} onChange={setMailFlow} onClose={() => setMailFlow(null)} />
      </Box>
    </ConnectHereContext.Provider>
  );
}

/** Where an app's sign-in comes back to: this onboarding, which reopens the flow on its confirmation. */
const mailBackPath = (back: "onboarding" | "welcome", orgId: string) =>
  back === "onboarding" ? "/onboarding" : `/welcome/${orgId}`;
