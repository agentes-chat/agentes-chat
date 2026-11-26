import type { FirstAgents, FirstAgentsInput } from "@agenteschat/client";
import { useAgents, useApps, useFirstAgents, useMe, usePasteFirstAgents } from "@agenteschat/client";
import { APP_CLIENTS, type AppClient } from "@agenteschat/client/lib/app-clients";
import { aiAppAsk, appMark } from "@agenteschat/client/lib/apps";
import { RIGHT_HAND_DEFAULT, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { Avatar, Button, Icon, ProviderLogo, Skeleton, SwapLabel, Textarea } from "@agenteschat/ui";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GuideExtras, GuideInstalls, GuideWords } from "@/components/AiApps";
import { lookOf } from "@/lib/look";
import { Box } from "./Shell";
import "./ask-step.css";

/*
 * "Ask for your first agent" (ADR 0119, the onboarding's first agent): the person's own AI, connected to this server
 * by MCP, reads what it already knows of them, finds the tasks that take most of their time and sends up to three
 * agents through `propose_first_agents`, which this step reads as they arrive. Without a connector, the same request
 * asks for a JSON answer to paste here. Nothing is created until the person picks one.
 */

/** Who asks: a team's owner, a member who just joined, or a personal workspace. */
export type AskVariant = "team" | "member" | "personal";

/** How often the step asks for the proposal: this page has no socket to say it arrived. */
const PROPOSALS_POLL_MS = 4000;
/** How often the person's apps are read while the step shows, so "Connected" appears once the sign-in is done. */
const APPS_POLL_MS = 5000;
/** After this long with nothing, what to check. */
const STUCK_MS = 2 * 60_000;

/** The assistants first in the row, the most used first; every other app of the list after them, in its order. */
const FIRST = [
  "chatgpt",
  "claude",
  "gemini",
  "grok",
  "perplexity",
  "le_chat",
  "cursor",
  "claude_code",
  "codex",
  "vscode",
];
const rank = (id: string) => {
  const i = FIRST.indexOf(id);
  return i < 0 ? FIRST.length : i;
};
/** "Other app" asks for a token, which the onboarding has no place for: other agent apps go through the import. */
export const ASK_CLIENTS: readonly AppClient[] = APP_CLIENTS.filter((c) => c.id !== "other").sort(
  (a, b) => rank(a.id) - rank(b.id),
);

/** The maker a mark stands for, so a connected app's verified brand matches the clients it covers. */
const MAKER: Record<string, string> = { claude_code: "claude", codex: "openai" };
const makerOf = (mark: string | null) => (mark ? (MAKER[mark] ?? mark) : null);

/**
 * The request the person pastes into a new conversation with their AI: the opening and what to read first in the
 * variant's words, the same interview and job descriptions for all, then how to send it: `propose_first_agents`, or,
 * with no connector (`json`), an opening that says none and a JSON answer to paste here, its example under the line.
 * The JSON answer also gives each routine as a cron: the routines read one with no model, and a workspace still
 * waiting for its plan has none to read the schedule's words (ADR 0253).
 */
export function askPrompt(t: TFunction, variant: AskVariant, org: string, json = false): string {
  const open = json
    ? t(`onboarding.ask.prompt.json.${variant}`, { org })
    : t(`onboarding.ask.prompt.${variant}.open`, { org });
  const design = json
    ? `${t("onboarding.ask.prompt.design")} ${t("onboarding.ask.prompt.json.cron")}`
    : t("onboarding.ask.prompt.design");
  const send = json
    ? `${t("onboarding.ask.prompt.json.send")}\n${t("onboarding.ask.prompt.json.example")}`
    : t(`onboarding.ask.prompt.${variant}.send`, { org });
  return [
    open,
    t(`onboarding.ask.prompt.${variant}.know`, { org }),
    t("onboarding.ask.prompt.interview"),
    design,
    send,
  ].join("\n\n");
}

/**
 * The answer pasted: the JSON in it (the AI may wrap it in words or a code block), or null when there is none. The
 * server checks its shape.
 */
export function pastedProposal(text: string): unknown {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  try {
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    return null;
  }
}

/**
 * The step: a row of assistants that scrolls sideways (the most used first, "Another agent app" last when
 * `onOther` opens the import), then (1) connecting agentes.chat in that app (its own guide, "Connected" once the person
 * has an app connected here) and (2) the request to paste in a new conversation, its start in view. Under them, the
 * wait for the proposal, and the way without a connector: the JSON request and a field for the answer. `onProposal`:
 * a proposal that arrived after the step opened, or the one pasted, with the app picked in the row. `onSkip`: "Not
 * now". `org`: the workspace's name, said in the request.
 */
export function AskYourAi({
  orgId,
  variant,
  onProposal,
  onSkip,
  org = "",
  eyebrow,
  onBack,
  onOther,
  onClient,
  skipping = false,
}: {
  orgId: string;
  variant: AskVariant;
  onProposal: (proposal: FirstAgents, app: AppClient | null) => void;
  onSkip: () => void;
  org?: string;
  eyebrow?: ReactNode;
  onBack?: (() => void) | null;
  /** "Another agent app": the import of other agent apps, a file or a link. */
  onOther?: () => void;
  /** The assistant picked in the row (the page draws its mark on the sky). */
  onClient?: (client: AppClient) => void;
  /** "Not now" is saving. */
  skipping?: boolean;
}) {
  const { t } = useTranslation();
  const apps = useApps(orgId, false, APPS_POLL_MS);
  const standing = useMe().data?.organizations.find((o) => o.id === orgId)?.standing;
  const mcp = aiAppAsk(t, apps.data, standing);
  const lodi = rightHandOf(useAgents(orgId).data ?? []);
  const mine = apps.data?.apps ?? [];

  // An app already connected picks its own assistant; else Claude.
  const [picked, setPicked] = useState<string | null>(null);
  const connectedMakers = mine.map((a) => appMark(a)).flatMap((m) => (m.kind === "brand" ? [makerOf(m.id)] : []));
  const fallback =
    ASK_CLIENTS.find((c) => connectedMakers.includes(makerOf(c.mark))) ?? ASK_CLIENTS.find((c) => c.id === "claude");
  const client = ASK_CLIENTS.find((c) => c.id === picked) ?? fallback ?? ASK_CLIENTS[0];
  const appName = client?.name ?? "";
  // Connected in this app: an app of the person's whose brand is this assistant's maker, or one with no verified brand.
  const connected =
    client !== undefined &&
    mine.some((a) => {
      const m = appMark(a);
      return m.kind !== "brand" || makerOf(m.id) === makerOf(client.mark);
    });

  const report = useRef(onClient);
  report.current = onClient;
  useEffect(() => {
    if (client) report.current?.(client);
  }, [client]);

  // Without a connector (asked, or none possible here): the JSON request and the field for the answer.
  const [pasting, setPasting] = useState(false);
  const unavailable = apps.isError || (mcp !== null && !mcp.available);
  const byPaste = pasting || unavailable;

  // A proposal that arrives after the step opened (the one there before is not this request's answer).
  const proposals = useFirstAgents(orgId, { poll: PROPOSALS_POLL_MS });
  const latest = proposals.data ?? null;
  const seen = useRef<string | null | undefined>(undefined);
  const arrived = useRef(onProposal);
  arrived.current = onProposal;
  const clientNow = useRef(client ?? null);
  clientNow.current = client ?? null;
  useEffect(() => {
    if (proposals.data === undefined) return;
    const id = latest?.id ?? null;
    if (seen.current === undefined) {
      seen.current = id;
      return;
    }
    if (!latest || id === seen.current || latest.picked !== null || latest.options.length === 0) return;
    seen.current = id;
    arrived.current(latest, clientNow.current);
  }, [proposals.data, latest]);

  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, []);

  const prompt = askPrompt(t, variant, org, byPaste);
  // The parts' numbers: without a connector, the request comes first and the answer second.
  const n = { connect: 1, prompt: byPaste ? 1 : 2, answer: 2 };
  return (
    <Box
      eyebrow={eyebrow}
      title={t(variant === "member" ? "onboarding.ask.titleMember" : "onboarding.ask.title")}
      lead={t(variant === "personal" ? "onboarding.ask.leadPersonal" : "onboarding.ask.lead")}
      onBack={onBack}
      acts={
        <Button onClick={onSkip} loading={skipping}>
          {t("onboarding.ask.later")}
        </Button>
      }
    >
      <fieldset className="onb-ask__ais">
        <legend className="ac-visually-hidden">{t("onboarding.ask.apps")}</legend>
        {ASK_CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="onb-ask__ai"
            aria-pressed={c.id === client?.id}
            onClick={() => setPicked(c.id)}
          >
            {c.mark ? (
              <ProviderLogo id={c.mark} size="sm" />
            ) : (
              <span className="onb-ask__more" aria-hidden="true">
                <Icon name="plug" size={16} />
              </span>
            )}
            <span>{c.name}</span>
          </button>
        ))}
        {onOther && (
          <button type="button" className="onb-ask__ai" onClick={onOther}>
            <span className="onb-ask__more" aria-hidden="true">
              <Icon name="more" size={16} />
            </span>
            <span>{t("onboarding.ask.other")}</span>
          </button>
        )}
      </fieldset>
      <ol className="onb-ask__steps">
        {!byPaste && (
          <li>
            <span className="onb-ask__n" aria-hidden="true">
              {n.connect}
            </span>
            <div className="onb-ask__step">
              <p className="onb-ask__title">
                <span>{t("onboarding.ask.connect")}</span>
                {connected && (
                  <span className="onb-ask__done">
                    <Icon name="check" size={14} />
                    {t("onboarding.ask.connected")}
                  </span>
                )}
              </p>
              {mcp?.available && client ? <ConnectGuide client={client} url={mcp.url} /> : <Skeleton width="70%" />}
            </div>
          </li>
        )}
        <li>
          <span className="onb-ask__n" aria-hidden="true">
            {n.prompt}
          </span>
          <div className="onb-ask__step">
            <p className="onb-ask__title">
              <span>{t(byPaste ? "onboarding.ask.pasteJson" : "onboarding.ask.paste", { app: appName })}</span>
            </p>
            {unavailable && mcp && !mcp.available && <p className="onb-ask__hint">{mcp.note}</p>}
            <PromptBox text={prompt} />
          </div>
        </li>
        {byPaste && (
          <li>
            <span className="onb-ask__n" aria-hidden="true">
              {n.answer}
            </span>
            <PasteAnswer orgId={orgId} app={appName} onRead={(p) => onProposal(p, client ?? null)} />
          </li>
        )}
      </ol>
      {/* With no connector on this server there is nothing to wait for nor to switch to: no row (and no rule) at all. */}
      {!unavailable && (
        <div className="onb-ask__wait">
          {!byPaste && (
            <p className="onb-ask__line" role="status">
              <Avatar
                kind="agent"
                name={lodi?.name ?? RIGHT_HAND_DEFAULT.name}
                appearance={lookOf(lodi) ?? RIGHT_HAND_DEFAULT.appearance}
                size="xs"
                state="writing"
              />
              <span>{t("onboarding.ask.waiting", { app: appName })}</span>
            </p>
          )}
          <button type="button" className="ac-link onb-ask__switch" onClick={() => setPasting(!pasting)}>
            {t(pasting ? "onboarding.ask.useConnector" : "onboarding.ask.noConnector")}
          </button>
        </div>
      )}
      {late && !byPaste && <p className="onb-ask__stuck">{t("onboarding.ask.stuck")}</p>}
    </Box>
  );
}

/** The assistant's own steps to connect this server (ADR 0119): each step's words, then its button or what to copy. */
function ConnectGuide({ client, url }: { client: AppClient; url: string }) {
  const guide = client.guide(url);
  // A personal token is for apps that sign in no other way: "Other app" only, which the row leaves out.
  const steps = guide.steps.filter((s) => !s.install && !s.token);
  return (
    <>
      <GuideInstalls steps={guide.steps} />
      <ol className="onb-ask__guide">
        {steps.map((s) => (
          <li key={`${s.text}${s.code ?? ""}`}>
            <span>
              <GuideWords step={s} />
            </span>
            <GuideExtras step={s} client={client} url={url} />
          </li>
        ))}
      </ol>
    </>
  );
}

/** The request to paste: its start in view and the rest a scroll away, the copy button always under it. */
function PromptBox({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div className="onb-ask__prompt">
      {/* Plain text, so it can be selected and copied by hand when the clipboard says no. */}
      <div className="onb-ask__text">
        {text.split("\n\n").map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <span className="onb-ask__copy">
        <Button onClick={() => void copy()}>
          <SwapLabel
            icon="copy"
            altIcon="check"
            label={t("onboarding.ask.copy")}
            alt={t("common.copied")}
            showAlt={copied === "ok"}
          />
        </Button>
        <span role="status" className="small muted">
          {copied === "failed" ? t("onboarding.import.request.copyFailed") : ""}
        </span>
      </span>
    </div>
  );
}

/** The AI's answer pasted: its JSON read here, its shape checked by the server, then the proposal to pick from. */
function PasteAnswer({ orgId, app, onRead }: { orgId: string; app: string; onRead: (proposal: FirstAgents) => void }) {
  const { t } = useTranslation();
  const paste = usePasteFirstAgents(orgId);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const read = () => {
    const body = pastedProposal(text);
    if (!body) return setBad(true);
    setBad(false);
    paste.mutate(body as FirstAgentsInput, { onSuccess: onRead });
  };
  return (
    <div className="onb-ask__step">
      <label className="onb-ask__title" htmlFor="onb-ask-answer">
        <span>{t("onboarding.ask.answer", { app })}</span>
      </label>
      <Textarea
        id="onb-ask-answer"
        className="onb-ask__answer"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        placeholder={t("onboarding.ask.answerPlaceholder")}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? "onb-ask-bad" : undefined}
        spellCheck={false}
      />
      {bad && (
        <p id="onb-ask-bad" className="onb-ask__bad" role="alert">
          {t("onboarding.ask.notJson")}
        </p>
      )}
      <span className="row">
        <Button variant="primary" disabled={!text.trim()} loading={paste.isPending} onClick={read}>
          {t("onboarding.ask.read")}
        </Button>
      </span>
    </div>
  );
}
