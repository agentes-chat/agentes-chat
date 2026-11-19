import type { Agent, ComputerTarget, Machine } from "@agenteschat/client";
import {
  useAgents,
  useComputer,
  useComputerSetup,
  useMachines,
  useSetComputerTarget,
  useSetWorksOn,
} from "@agenteschat/client";
import { managesAgent } from "@agenteschat/client/lib/audience";
import {
  type NoComputer,
  noComputerChoice,
  type SetupView,
  setupPending,
  setupPortrait,
  setupView,
  WORKSPACE_COMPUTER_KIND,
} from "@agenteschat/client/lib/computer";
import { errorText } from "@agenteschat/client/lib/errors";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import {
  computerKind,
  computerState,
  folderName,
  foldersOfAgent,
  machineTitle,
} from "@agenteschat/client/lib/machines";
import { can } from "@agenteschat/client/lib/permissions";
import { worksOnAgents, worksOnCrewShown, worksOnField } from "@agenteschat/client/lib/works-on";
import { modeKey } from "@agenteschat/client/lib/workspace-mode";
import {
  Card,
  CardHeader,
  ComputerIcon,
  ComputerPortrait,
  Field,
  Icon,
  InfoHint,
  List,
  Select,
  type SelectOption,
} from "@agenteschat/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { LoadingLine } from "@/components/Loading";
import { MachineChip } from "@/components/machine-bits";
import { useOrg } from "@/components/org-context";
import { ReconnectThisMacButton, useIsThisMac } from "@/components/ThisMac";
import { SetupProgress } from "@/components/WorkspaceComputer";
import { useToast } from "@/lib/toast";

/**
 * "Servidor do escritório · Online": a connected computer, turned on by whoever connected it, or the workspace's
 * own; who runs it is its name's ⓘ, and only being offline says more.
 */
function MachineTargetView({ target }: { target: Extract<ComputerTarget, { kind: "machine" }> }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  // In agentes for Mac, offline on this very Mac: reconnect from here (ADR 0036).
  const here = useIsThisMac(org.id, target.machineId);
  // The workspace's own computer: nobody connected it, nobody turns it on or off.
  const managed = useMachines(org.id).data?.find((m) => m.id === target.machineId)?.kind === "managed";
  return (
    <span className="stack-4" style={{ gap: 4 }}>
      <span className="row" style={{ gap: 8, alignItems: "center" }}>
        <span className="ac-hintline">
          <span className="computer-machine__name">{target.name}</span>
          <InfoHint name={t("common.about", { label: target.name })}>
            {managed ? t("computerSetup.managedHint") : t("computer.machineHint")}
          </InfoHint>
        </span>
        <MachineChip online={target.online} />
      </span>
      {!managed && !target.online && (
        <span className="small muted">{here ? t("machines.thisMac.offline") : t("computer.machineOffline")}</span>
      )}
      {!target.online && here && (
        <span>
          <ReconnectThisMacButton orgId={org.id} />
        </span>
      )}
    </span>
  );
}

export const NO_COMPUTER = "none";

/**
 * The pickers' "no computer" option (`NO_COMPUTER`, `machineId` null) as it reads here (`noComputerChoice`): the
 * workspace's own computer on its way, or no computer at all.
 */
export function useNoComputer() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const setupQ = useComputerSetup(org.id);
  const setup = setupView(setupQ.data, setupQ.dataUpdatedAt);
  return {
    setup,
    /** The workspace's own computer is on its way: "no computer" stands for it, so its row isn't offered apart. */
    pending: setupPending(setup),
    /** `current`: the agent has no computer now (the option shows for it even when not offered). */
    choice: (current: boolean) => noComputerChoice(setup, current),
    label: (choice: NoComputer) =>
      choice === "workspace" ? t(modeKey(org, "computerSetup.title"), { org: org.name }) : t("computer.target.none"),
  };
}

/** The "no computer" option's line icon: the workspace's own computer, or none. */
export function NoComputerIcon({ choice }: { choice: NoComputer }) {
  if (choice === "none") return <Icon name="dash" size={16} />;
  return <ComputerIcon kind={WORKSPACE_COMPUTER_KIND} size={16} />;
}

/** The connected computer the agent uses, as its portrait: its kind and pause from the computers list. */
function TargetPortrait({ target }: { target: Extract<ComputerTarget, { kind: "machine" }> }) {
  const { org } = useOrg();
  const machines = useMachines(org.id);
  const m = machines.data?.find((x) => x.id === target.machineId);
  return (
    <ComputerPortrait
      className="agp-pc__logo"
      kind={computerKind(m?.os)}
      state={m ? computerState(m) : target.online ? "online" : "offline"}
    />
  );
}

/** The workspace's own computer on its way, for an agent that gets it once it's ready. */
function WaitingForComputer({ view, title }: { view: SetupView; title: string }) {
  return (
    <span className="stack-4" style={{ gap: 6 }}>
      <span className="computer-machine__name">{title}</span>
      <SetupProgress view={view} />
    </span>
  );
}

/**
 * Configurações › Computador: the computer the agent uses (a connected one, the workspace's own on its way, or
 * none) and the folders it may use there.
 */
export function AgentComputerPanel({ agent, machineNote }: { agent: Agent; machineNote?: ReactNode }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const pc = useComputer(org.id, agent.id);
  const noComputer = useNoComputer();
  if (pc.isLoading) return <LoadingLine width={240} />;
  if (pc.isError || !pc.data) return <p className="small muted">{t("agentPage.computer.unavailable")}</p>;
  const target = pc.data.target;
  const choice = target.kind === "machine" ? null : noComputer.choice(true);
  // No computer yet where the workspace's own is on its way: that one is the agent's (its first hello gives it).
  const waiting = choice === "workspace" ? noComputer.setup : null;
  return (
    <div className="agp-pc">
      <div className="agp-pc__now">
        {waiting ? (
          <ComputerPortrait
            className="agp-pc__logo"
            kind={WORKSPACE_COMPUTER_KIND}
            state={setupPortrait(waiting, false)}
          />
        ) : target.kind === "machine" ? (
          <TargetPortrait target={target} />
        ) : null}
        <span className="agp-pc__text">
          {waiting ? (
            <WaitingForComputer view={waiting} title={noComputer.label("workspace")} />
          ) : target.kind === "machine" ? (
            <MachineTargetView target={target} />
          ) : (
            <span className="stack-4" style={{ gap: 4 }}>
              <span className="computer-machine__name">{t("computer.target.none")}</span>
              <span className="small muted">{t("computer.target.noneText")}</span>
            </span>
          )}
        </span>
      </div>
      {machineNote && (
        <div className="stack-4" style={{ gap: 6 }}>
          {machineNote}
        </div>
      )}
      <WorksOnField agent={agent} />
      {target.kind === "machine" && <AgentMachineFolders agent={agent} machineId={target.machineId} />}
    </div>
  );
}

const OWN_COMPUTER = "";
/** How many agents working on a computer its owner's panel names before "and N more". */
const CREW_SHOWN = 5;

/**
 * "Trabalha no computador de" (ADR 0202): the agent whose computer this one uses, and for an agent with others on its
 * computer, who they are. Picked and applied at once. The words say plainly what it gives (never "lead": that word is a
 * setor's person, ADR 0083). Nothing for the right hand.
 */
function WorksOnField({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const agents = useAgents(org.id).data;
  const machines = useMachines(org.id).data;
  const setWorksOn = useSetWorksOn(org.id);
  const me = agents?.find((x) => x.id === agent.id);
  // Nothing until both lists are in (and for someone who can't manage it): never "nobody has a computer" meanwhile.
  if (!agents || !machines || !me || !managesAgent(me)) return null;
  const known = worksOnAgents(agents, machines);
  const mine = known.find((x) => x.id === agent.id);
  if (!mine) return null;
  const field = worksOnField(mine, known);
  if (field.kind === "none") return null;
  const id = `works-on-${agent.id}`;
  const set = (worksOnAgentId: string | null) =>
    setWorksOn.mutate({ agentId: agent.id, worksOnAgentId }, { onError: (e) => toast.show(errorText(t, e), "error") });
  if (field.kind === "lead") {
    const { shown, more } = worksOnCrewShown(field.crew, CREW_SHOWN);
    return (
      <div className="stack-4" style={{ gap: 6 }}>
        <span className="newag__label">{t("worksOn.crewTitle")}</span>
        {shown.length === 0 ? (
          <span className="small muted">{t("worksOn.crewEmpty")}</span>
        ) : (
          <ul className="agent-folders">
            {shown.map((a) => (
              <li key={a.id}>
                <AgentAvatar agentId={a.id} name={a.name} size="sm" />
                <span className="machine-folder__name">{a.name}</span>
              </li>
            ))}
            {more > 0 && <li className="small muted">{t("worksOn.crewMore", { count: more })}</li>}
          </ul>
        )}
      </div>
    );
  }
  const lead = field.kind === "member" ? field.lead : null;
  const unavailable = field.kind === "member" && !field.available;
  // The lead stays a choice only while it can be followed; otherwise the way out is to stop.
  const choices = field.kind === "pick" ? field.options : lead ? [lead] : [];
  const options = choices.map((a) => ({
    value: a.id,
    label: a.name,
    leading: <AgentAvatar agentId={a.id} name={a.name} size="sm" />,
  }));
  return (
    <Field
      label={t("worksOn.label")}
      id={id}
      hint={{ name: t("common.about", { label: t("worksOn.label") }), text: t("worksOn.hint") }}
    >
      {field.kind === "empty" ? (
        <span className="small muted">{t("worksOn.noneEligible")}</span>
      ) : (
        <span className="stack-4" style={{ gap: 6 }}>
          <Select
            id={id}
            value={mine.worksOnAgentId ?? OWN_COMPUTER}
            disabled={setWorksOn.isPending}
            onValueChange={(v) => v !== (mine.worksOnAgentId ?? OWN_COMPUTER) && set(v || null)}
            options={[
              {
                value: OWN_COMPUTER,
                label: unavailable && lead ? t("worksOn.stop", { name: lead.name }) : t("worksOn.none"),
                leading: <ComputerIcon kind={WORKSPACE_COMPUTER_KIND} size={16} />,
              },
              ...options,
            ]}
          />
          {unavailable && lead && <span className="small muted">{t("worksOn.unavailable", { name: lead.name })}</span>}
          {field.kind === "member" && <span className="small muted">{t("worksOn.tradeoff")}</span>}
        </span>
      )}
    </Field>
  );
}

/**
 * "Pastas no computador": the folders of
 * its computer this agent may use beyond its own, as the machine reported them.
 * Read-only here: granting happens on the computer.
 */
function AgentMachineFolders({ agent, machineId }: { agent: Agent; machineId: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const machines = useMachines(org.id);
  const m = machines.data?.find((x) => x.id === machineId);
  if (!m) return null;
  const folders = foldersOfAgent(m.access, agent.id);
  const g = agentGrammar(agent.name);
  return (
    <div className="stack-4" style={{ gap: 6 }} data-agent-folders>
      <span className="ac-hintline">
        <span className="newag__label">{t("agentPage.computer.folders")}</span>
        {/* The workspace's own computer: nobody here allows more on it. */}
        {m.kind !== "managed" && (
          <InfoHint name={t("common.about", { label: t("agentPage.computer.folders") })}>
            {t("agentPage.computer.foldersHint")}
          </InfoHint>
        )}
      </span>
      {!m.access ? (
        <span className="small muted">
          {m.canManage
            ? t("agentPage.computer.foldersUnknown", { machine: m.name })
            : t("agentPage.computer.foldersHidden", { machine: m.name })}
        </span>
      ) : folders.length === 0 ? (
        <span className="small muted">{t("agentPage.computer.foldersOwn", g)}</span>
      ) : (
        <>
          <span className="small muted">{t("agentPage.computer.foldersMore", g)}</span>
          <ul className="agent-folders">
            {folders.map((f) => (
              <li key={f.path}>
                <Icon name="drive" size={14} />
                <span className="machine-folder__name">{folderName(f.path)}</span>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * "Qual computador cada agente usa": every agent and its computer, changed here at once. The current one comes from
 * the computers list (each says which agents use it); none there means no computer. Admins pick any computer; an
 * agent's owner, the ones they connected (the server checks again).
 */
export function AgentComputersCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const admin = can(org, "configure");
  const agents = useAgents(org.id);
  const machines = useMachines(org.id);
  const noComputer = useNoComputer();
  const list = agents.data ?? [];
  return (
    <Card aria-labelledby="sec-agent-computers">
      <CardHeader id="sec-agent-computers" icon="agent" title={t("computers.agents.title")} />
      {agents.isLoading || machines.isLoading ? (
        <LoadingLine width={240} />
      ) : list.length === 0 ? (
        <p className="small muted">{t("computers.agents.empty")}</p>
      ) : (
        <List aria-label={t("computers.agents.title")}>
          {list.map((a) => (
            <AgentComputerRow
              key={a.id}
              agent={a}
              admin={admin}
              machines={machines.data ?? []}
              noComputer={noComputer}
            />
          ))}
        </List>
      )}
    </Card>
  );
}

function AgentComputerRow({
  agent,
  admin,
  machines: all,
  noComputer,
}: {
  agent: Agent;
  admin: boolean;
  machines: Machine[];
  noComputer: ReturnType<typeof useNoComputer>;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const setTarget = useSetComputerTarget(org.id);
  const machines = noComputer.pending ? all.filter((m) => m.kind !== "managed") : all;
  const current = machines.find((m) => m.agents.some((a) => a.id === agent.id));
  const value = current?.id ?? NO_COMPUTER;
  const none = noComputer.choice(value === NO_COMPUTER);
  const choices = machines.filter((m) => admin || m.pairedBy?.id === me.user.id || m.id === value);
  // It works on another agent's computer (ADR 0202): it goes where that agent goes, so its own picker is locked.
  const followed = agent.worksOnAgentId ? (agent.worksOn?.name ?? "") : null;
  const canPick = followed === null && (admin || agent.ownerUserId === me.user.id) && choices.length > 0;
  const iconOf = (id: string) =>
    id === NO_COMPUTER && none ? (
      <NoComputerIcon choice={none} />
    ) : (
      <ComputerIcon kind={computerKind(machines.find((m) => m.id === id)?.os)} size={16} />
    );
  const host = t("machines.host.label");
  const nameOf = (id: string) => {
    const m = machines.find((x) => x.id === id);
    return id === NO_COMPUTER ? noComputer.label(none ?? "none") : m ? machineTitle(m, host) : id;
  };
  const options: SelectOption[] = [
    ...(none
      ? [
          {
            value: NO_COMPUTER,
            label: noComputer.label(none),
            description:
              none === "workspace" && noComputer.setup ? t(noComputer.setup.chipKey) : t("computer.target.noneText"),
          },
        ]
      : []),
    ...choices.map((m) => ({
      value: m.id,
      label: machineTitle(m, host),
      description: t(`computers.agents.state.${computerState(m)}`),
    })),
  ].map((o) => ({ ...o, leading: iconOf(o.value) }));
  return (
    <div className="ac-list__row computers-agent">
      <AgentAvatar agentId={agent.id} size="sm" name={agent.name} />
      <span className="list-col computers-agent__main">
        <span style={{ fontWeight: 600 }}>{agent.name}</span>
      </span>
      {canPick ? (
        <Select
          size="sm"
          className="computers-agent__pick"
          aria-label={t("computers.agents.pick", { name: agent.name })}
          value={value}
          options={options}
          disabled={setTarget.isPending}
          onValueChange={(v) => {
            if (v === value) return;
            setTarget.mutate(
              { agentId: agent.id, machineId: v === NO_COMPUTER ? null : v },
              {
                onSuccess: () => toast.show(t("computers.agents.saved", { name: agent.name, computer: nameOf(v) })),
                onError: (e) => toast.show(errorText(t, e), "error"),
              },
            );
          }}
          renderValue={(o) => (
            <span className="computers-agent__value">
              {o.leading}
              {o.label}
            </span>
          )}
        />
      ) : (
        <span className="computers-agent__value computers-agent__value--ro">
          {iconOf(value)}
          {nameOf(value)}
          {followed !== null && (
            <span className="small muted">
              {" "}
              · {followed ? t("worksOn.locked", { name: followed }) : t("worksOn.lockedUnknown")}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
