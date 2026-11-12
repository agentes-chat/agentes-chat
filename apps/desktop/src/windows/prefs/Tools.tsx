import type { RunnerExecutorInfo, RunnerTools } from "@agenteschat/adapters/machine-protocol";
import type { ControlStatus } from "@agenteschat/adapters/runner-control";
import {
  BrainPortrait,
  type BrainPortraitState,
  Chip,
  Icon,
  type IconName,
  ProviderLogo,
  Switch,
} from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useSnapshot, useStore } from "../../app";
import { pairedHomes } from "../../control/store";
import { toolsHere } from "../../control/this-mac";
import { useLocalServer, usePending } from "../../hooks";
import { CardTitle, hintFor, PrefCard, PrefHead, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { listNames } from "../../ui/time";
import { ToolAccounts } from "./Accounts";

type Cli = "claude" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";

/** The coding programs agents think with, each with a switch of its own; the first two have a portrait. */
const CLIS: { tool: Cli; kind: string; portrait?: "claude_code" | "codex" }[] = [
  { tool: "claude", kind: "claude_code", portrait: "claude_code" },
  { tool: "codex", kind: "codex", portrait: "codex" },
  { tool: "cursor", kind: "cursor" },
  { tool: "opencode", kind: "opencode" },
  { tool: "grok", kind: "grok" },
  { tool: "antigravity", kind: "antigravity" },
];

/** A program's switch; one a runner stored no switch for follows Codex's, as the runner and the server read it. */
export const cliOn = (tools: RunnerTools, tool: Cli) => (tools[tool] ?? tools.codex) === true;

/** Tools are for the whole computer: every organization gets the same switch. */
export function Tools() {
  const { t, i18n } = useTranslation();
  const store = useStore();
  const snap = useSnapshot();
  const toast = useToast();
  const local = useLocalServer();
  const homes = pairedHomes(snap);
  const { tools, commandsOnlyFor } = toolsHere(homes);
  const executors: ControlStatus["executors"] = homes.find((h) => h.status)?.status?.executors ?? {};
  // The lines kept in sight under Commands describe its switch too: where it's on, and what commands can reach.
  const commandsLines = commandsOnlyFor.length > 0 ? "tool-commands-some tool-commands-warn" : "tool-commands-warn";

  // One tool's change at a time: its switch, and the others, wait for it.
  const [pending, run] = usePending<keyof RunnerTools>();
  const set = (tool: keyof RunnerTools, on: boolean) =>
    run(tool, async () => {
      try {
        await store.requestAll({ type: "tools.set", tool, on });
        if (tool === "commands" && on) toast(t("desktop.prefs.tools.commandsOn"), "code");
      } catch {
        toast(t("desktop.common.error"), "alert");
      }
    });

  const exec = (info: RunnerExecutorInfo | undefined) =>
    !info ? (
      <Chip icon="dash">{t("desktop.tools.notFound")}</Chip>
    ) : info.loggedIn === false ? (
      <Chip icon="alert" tone="waiting">
        {t("desktop.tools.loggedOut")}
      </Chip>
    ) : (
      <Chip icon="check" tone="done">
        {t("desktop.prefs.tools.connected")}
      </Chip>
    );

  /** Found and logged in: the engine at rest; not found or logged out: off. */
  const engineState = (info: RunnerExecutorInfo | undefined): BrainPortraitState =>
    info && info.loggedIn !== false ? "idle" : "off";

  const logo = (icon: IconName) => (
    <span className="dk-logo">
      <Icon name={icon} size={16} />
    </span>
  );

  return (
    <>
      <PrefHead title={t("desktop.prefs.tools.title")} lead={t("desktop.prefs.tools.lead")} />
      <PrefCard>
        {CLIS.map(({ tool, kind, portrait }) => {
          const name = t(`desktop.tools.${tool}Name`);
          return (
            <PrefRow
              key={tool}
              lead={
                portrait ? (
                  <BrainPortrait kind={portrait} state={engineState(executors[tool])} />
                ) : (
                  <ProviderLogo id={kind} off={!executors[tool]} />
                )
              }
              htmlFor={`tool-${tool}`}
              title={
                portrait ? (
                  <>
                    <ProviderLogo id={kind} size="xs" />
                    {name}
                  </>
                ) : (
                  name
                )
              }
              hint={hintFor(t, name, t(`desktop.tools.${tool}Desc`))}
              chip={exec(executors[tool])}
              end={
                // On or off whether or not its program is here yet: one installed later then works (ADR 0165).
                <Switch
                  id={`tool-${tool}`}
                  aria-describedby={`tool-${tool}-hint`}
                  checked={cliOn(tools, tool)}
                  disabled={homes.length === 0 || pending !== null}
                  onCheckedChange={(on) => void set(tool, on)}
                />
              }
            />
          );
        })}
        <PrefRow
          lead={logo("code")}
          htmlFor="tool-commands"
          title={t("desktop.tools.commandsName")}
          hint={hintFor(t, t("desktop.tools.commandsName"), t("desktop.tools.commandsDesc"))}
          end={
            <Switch
              id="tool-commands"
              aria-describedby={`tool-commands-hint ${commandsLines}`}
              checked={tools.commands}
              disabled={homes.length === 0 || pending !== null}
              onCheckedChange={(on) => void set("commands", on)}
            />
          }
          under={
            <>
              {commandsOnlyFor.length > 0 && (
                <span id="tool-commands-some" className="dk-help">
                  {t("desktop.tools.commandsSome", { orgs: listNames(commandsOnlyFor, i18n.language) })}
                </span>
              )}
              <span className="dk-honest ac-iconline">
                <Icon name="alert" size={14} />
                <span id="tool-commands-warn">
                  {local.run
                    ? t("desktop.tools.commandsWarnHere")
                    : homes.length > 1
                      ? t("desktop.tools.commandsWarnOrgs")
                      : t("desktop.tools.commandsWarn")}
                </span>
              </span>
            </>
          }
        />
        <PrefRow
          lead={logo("globe")}
          htmlFor="tool-browser"
          title={t("desktop.tools.browserName")}
          hint={hintFor(t, t("desktop.tools.browserName"), t("desktop.tools.browserDesc"))}
          end={
            <Switch
              id="tool-browser"
              aria-describedby="tool-browser-hint tool-browser-logins"
              checked={tools.browser === true}
              disabled={homes.length === 0 || pending !== null}
              onCheckedChange={(on) => void set("browser", on)}
            />
          }
          under={
            <span className="dk-honest ac-iconline">
              <Icon name="lock" size={14} />
              <span id="tool-browser-logins">{t("desktop.tools.browserLogins")}</span>
            </span>
          }
        />
      </PrefCard>

      <ToolAccounts homes={homes} executors={executors} />

      <CardTitle>{t("desktop.prefs.tools.protection")}</CardTitle>
      <PrefCard>
        <PrefRow
          lead={logo("shield")}
          htmlFor="protected-mode"
          title={t("desktop.prefs.tools.protectedTitle")}
          hint={hintFor(t, t("desktop.prefs.tools.protectedTitle"), t("desktop.prefs.tools.protectedDesc"))}
          chip={<Chip icon="clock">{t("desktop.common.soon")}</Chip>}
          end={
            <Switch
              id="protected-mode"
              aria-describedby="protected-mode-hint"
              checked={false}
              disabled
              onCheckedChange={() => {}}
            />
          }
        />
      </PrefCard>
    </>
  );
}
