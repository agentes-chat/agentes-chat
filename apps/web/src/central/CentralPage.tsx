import type { CentralAgent, CentralComputer, CentralTalk, CentralTask, CentralView } from "@agenteschat/client";
import { useApi, useCentral, useTaskSteps } from "@agenteschat/client";
import { Button, cx, EmptyState, Icon, PageHeader, PixelSpinner } from "@agenteschat/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { SidePanel } from "@/components/SidePanel";
import { colorOf } from "@/components/Sky";
import { TaskStepsBlock } from "@/components/ToolCalls";
import { StopTaskButton, useOpenTask, useTaskStop } from "@/components/tasks/TaskBits";
import { useDirectory } from "@/hooks/useDirectory";
import { BrainQuick } from "./BrainQuick";
import { COLUMNS, columnOf, leadTask, STILL_ON, shortAgo, TONE, tasksOfAgent } from "./model";
import { Orchestration } from "./Orchestration";
import { setupLine, useCentralWords } from "./words";
import "./central.css";

type Words = ReturnType<typeof useCentralWords>;

/** The clock the "há 3 min" lines read: a few seconds is close enough. */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function StateMark({ task, w }: { task: Pick<CentralTask, "state">; w: Words }) {
  return (
    <span className="central-state" data-tone={TONE[task.state]}>
      <i aria-hidden="true" />
      {w.state[task.state]}
    </span>
  );
}

function Progress({ task, w }: { task: CentralTask; w: Words }) {
  const p = task.progress;
  if (!p) return null;
  return (
    <div
      className="central-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p.percent}
      aria-label={`${p.done}/${p.total} ${w.steps}`}
    >
      <span style={{ width: `${p.percent}%` }} />
      <b>
        {p.percent}% · {p.done}/{p.total}
      </b>
    </div>
  );
}

function useNames() {
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  return { dir, agentName: (id: string) => dir.anyAgent(id)?.name ?? "?" };
}

function requesterText(task: CentralTask, w: Words, agentName: (id: string) => string) {
  const r = task.requester;
  if (!r) return w.askedByUnknown;
  const who = r.kind === "agent" ? agentName(r.id) : r.name;
  return `${w.askedBy} ${who}${task.origin ? ` · ${w.chainFrom} ${task.origin}` : ""}`;
}

function TaskCard({ task, now, w, onOpen }: { task: CentralTask; now: number; w: Words; onOpen: () => void }) {
  const { agentName } = useNames();
  const live = STILL_ON.has(task.state);
  return (
    <li>
      <button type="button" className="central-task" data-state={task.state} onClick={onOpen}>
        <span className="central-task__top">
          <AgentAvatar agentId={task.agentId} name={agentName(task.agentId)} size="xs" />
          <b>{agentName(task.agentId)}</b>
          <StateMark task={task} w={w} />
        </span>
        <span className="central-task__title">{task.title ?? w.untitled}</span>
        <Progress task={task} w={w} />
        {task.now && live && (
          <code className="central-task__now">
            {task.now.tool}
            {task.now.detail ? ` ${task.now.detail}` : ""}
          </code>
        )}
        <small>{requesterText(task, w, agentName)}</small>
        <small>
          {live ? `${w.lastSign} ${shortAgo(task.lastSignalAt, now, w.now)}` : shortAgo(task.finishedAt, now, w.now)}
          {live && task.steps > 0 ? ` · ${task.steps} ${w.steps}` : ""}
        </small>
      </button>
    </li>
  );
}

function AgentCard({
  agent,
  tasks,
  now,
  w,
  onOpen,
}: {
  agent: CentralAgent;
  tasks: CentralTask[];
  now: number;
  w: Words;
  onOpen: () => void;
}) {
  const on = tasks.filter((t) => STILL_ON.has(t.state));
  const lead = leadTask(on);
  const peak = Math.max(1, ...agent.activity);
  const bars = agent.activity.slice(-24);
  return (
    <li>
      <button type="button" className="central-agent" data-state={lead?.state ?? "idle"} onClick={onOpen}>
        <span className="central-agent__head">
          <AgentAvatar agentId={agent.id} name={agent.name} size="md" presence />
          <span>
            <b>{agent.name}</b>
            <small>{agent.role || `@${agent.handle}`}</small>
          </span>
          {lead ? (
            <StateMark task={lead} w={w} />
          ) : (
            <span className="central-state" data-tone="muted">
              <i aria-hidden="true" />
              {w.idle}
            </span>
          )}
        </span>
        <span className="central-agent__task">
          {lead
            ? (lead.title ?? w.untitled)
            : `${agent.doneThisWeek} ${w.doneWeek} · ${agent.failedThisWeek} ${w.failedWeek}`}
        </span>
        {lead && <Progress task={lead} w={w} />}
        {lead && (
          <small>
            {w.lastSign} {shortAgo(lead.lastSignalAt, now, w.now)}
            {on.length > 1 ? ` · +${on.length - 1}` : ""}
          </small>
        )}
        <span className="central-agent__spark" aria-hidden="true">
          {bars.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: minutes in a fixed order
            <i key={i} style={{ height: `${Math.max(8, (n / peak) * 100)}%` }} data-on={n > 0 || undefined} />
          ))}
        </span>
        {agent.memory && <small>{w.memoryLine(agent.memory.rssMb, agent.memory.processes)}</small>}
        <small className="central-agent__setup">
          {setupLine(agent, w)} ·{" "}
          {agent.machine ? (agent.machine.online ? agent.machine.name : w.offline) : w.noComputer}
          {agent.hasInstructions ? "" : ` · ${w.noInstructions}`}
        </small>
      </button>
    </li>
  );
}

function TalkRow({ talk, now, w, agentId }: { talk: CentralTalk; now: number; w: Words; agentId?: string }) {
  const { agentName } = useNames();
  const [open, setOpen] = useState(false);
  const from = agentName(talk.fromAgentId);
  const to = agentName(talk.toAgentId);
  return (
    <li className="central-talk" data-open={open || undefined} data-mine={agentId ? true : undefined}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <AgentAvatar agentId={talk.fromAgentId} name={from} size="xs" />
        <b>{from}</b>
        <Icon name="arrowRight" size={14} />
        <AgentAvatar agentId={talk.toAgentId} name={to} size="xs" />
        <b>{to}</b>
        <span>{w.ask[talk.kind] ?? talk.kind}</span>
        <em data-status={talk.status}>{w.talk[talk.status] ?? talk.status}</em>
        <small>{shortAgo(talk.createdAt, now, w.now)}</small>
      </button>
      {open && (
        <div className="central-talk__body">
          {talk.question === null ? (
            <p>{w.private}</p>
          ) : (
            <>
              <h4>{w.question}</h4>
              <p>{talk.question}</p>
              {talk.answer && (
                <>
                  <h4>{w.answer}</h4>
                  <p>{talk.answer}</p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TaskPanel({ task, now, w, onClose }: { task: CentralTask; now: number; w: Words; onClose: () => void }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const { dir, agentName } = useNames();
  const openTask = useOpenTask();
  const { stop, stopping } = useTaskStop();
  const live = STILL_ON.has(task.state);
  const steps = useTaskSteps(org.id, task.runId, live ? 2_000 : false);
  const resume = useMutation({
    mutationFn: () => api.agents.continueRun(org.id, task.runId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["org", org.id, "central"] }),
  });
  const name = agentName(task.agentId);
  const calls = steps.data?.steps.some((s) => s.kind === "tool_call") ?? false;
  return (
    <SidePanel label={task.title ?? w.untitled} onClose={onClose} className="thread-panel--wide central-panel">
      <header className="central-panel__head">
        <AgentAvatar agentId={task.agentId} name={name} size="md" />
        <div>
          <h2>{task.title ?? w.untitled}</h2>
          <p>
            {name} · <StateMark task={task} w={w} />
          </p>
        </div>
        <Button variant="ghost" size="sm" iconOnly icon="close" aria-label={w.close} onClick={onClose} />
      </header>
      <div className="central-panel__body">
        {task.state === "stalled" && <p className="central-note">{w.stalledHint}</p>}
        {task.progress ? <Progress task={task} w={w} /> : live && <p className="central-muted">{w.noProgress}</p>}
        <dl className="central-facts">
          <Fact label={w.askedBy}>{requesterText(task, w, agentName).replace(`${w.askedBy} `, "")}</Fact>
          <Fact label={w.lastSign}>{shortAgo(task.lastSignalAt, now, w.now)}</Fact>
          {task.now && (
            <Fact label={w.running}>
              <code>
                {task.now.tool}
                {task.now.detail ? ` ${task.now.detail}` : ""}
              </code>
            </Fact>
          )}
          {task.helpers > 0 && <Fact label={w.helpers}>{task.helpers}</Fact>}
          {task.latestUpdate && <Fact label={w.update}>{task.latestUpdate}</Fact>}
          {task.error && <Fact label={w.error}>{task.error}</Fact>}
        </dl>
        <div className="central-actions">
          <Button size="sm" variant="default" onClick={() => openTask(task)}>
            {w.open}
          </Button>
          {task.canContinue && (
            <Button size="sm" loading={resume.isPending} onClick={() => resume.mutate()}>
              {w.go}
            </Button>
          )}
          {task.canStop && (
            <StopTaskButton
              label={w.stop}
              title={task.title ?? w.untitled}
              stopping={stopping.has(task.runId)}
              onClick={() => stop([task.runId])}
            />
          )}
        </div>
        <section className="central-live">
          <h3>
            {live && <PixelSpinner size={14} color={colorOf(dir.anyAgent(task.agentId))} label={w.live} />} {w.live}
          </h3>
          <p className="central-muted">{w.liveNote}</p>
          {steps.data && calls ? (
            <TaskStepsBlock
              steps={steps.data.steps}
              run={steps.data.run}
              working={live}
              agentName={name}
              color={colorOf(dir.anyAgent(task.agentId))}
            />
          ) : (
            <p className="central-muted">{w.noSteps}</p>
          )}
        </section>
      </div>
    </SidePanel>
  );
}

function AgentPanelView({
  agent,
  view,
  now,
  w,
  onClose,
  onTask,
}: {
  agent: CentralAgent;
  view: CentralView;
  now: number;
  w: Words;
  onClose: () => void;
  onTask: (runId: string) => void;
}) {
  const { org } = useOrg();
  const tasks = tasksOfAgent(view, agent);
  const talks = view.talks.filter((t) => t.fromAgentId === agent.id || t.toAgentId === agent.id);
  return (
    <SidePanel label={agent.name} onClose={onClose} className="thread-panel--wide central-panel">
      <header className="central-panel__head">
        <AgentAvatar agentId={agent.id} name={agent.name} size="md" presence />
        <div>
          <h2>{agent.name}</h2>
          <p>{agent.role || `@${agent.handle}`}</p>
        </div>
        <Button variant="ghost" size="sm" iconOnly icon="close" aria-label={w.close} onClick={onClose} />
      </header>
      <div className="central-panel__body">
        <dl className="central-facts">
          <Fact label={w.model}>{setupLine(agent, w)}</Fact>
          <Fact label={w.computer}>
            {agent.machine ? `${agent.machine.name} · ${agent.machine.online ? w.online : w.off}` : w.noComputer}
          </Fact>
          <Fact label={w.approvals}>{w.approval[agent.approvals] ?? agent.approvals}</Fact>
          <Fact label={w.memoryNow}>
            {agent.memory ? w.memoryLine(agent.memory.rssMb, agent.memory.processes) : w.memoryNone}
          </Fact>
        </dl>
        <BrainQuick agent={agent} w={w} />
        <div className="central-actions">
          <Button asChild size="sm" variant="default">
            <Link to="/org/$orgId/dm/agent/$agentId" params={{ orgId: org.id, agentId: agent.id }}>
              {w.chat}
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/org/$orgId/agents/$agentId" params={{ orgId: org.id, agentId: agent.id }}>
              {w.profile}
            </Link>
          </Button>
        </div>
        <h3>{w.agentTasks}</h3>
        {tasks.length ? (
          <ul className="central-list">
            {tasks.slice(0, 20).map((t) => (
              <TaskCard key={t.runId} task={t} now={now} w={w} onOpen={() => onTask(t.runId)} />
            ))}
          </ul>
        ) : (
          <p className="central-muted">{w.nothing}</p>
        )}
        <h3>{w.agentTalks}</h3>
        {talks.length ? (
          <ul className="central-talks">
            {talks.map((t) => (
              <TalkRow key={t.id} talk={t} now={now} w={w} agentId={agent.id} />
            ))}
          </ul>
        ) : (
          <p className="central-muted">{w.noTalks}</p>
        )}
      </div>
    </SidePanel>
  );
}

function ComputerCard({ c, w }: { c: CentralComputer; w: Words }) {
  const used = c.memoryAvg !== null && c.memoryGb !== null ? c.memoryAvg * c.memoryGb : null;
  return (
    <li className="central-computer" data-online={c.online}>
      <b>{c.name}</b>
      <span className="central-state" data-tone={c.online ? "ok" : "muted"}>
        <i aria-hidden="true" />
        {c.online ? w.online : w.off}
      </span>
      {c.memoryAvg !== null && (
        <div className="central-progress">
          <span style={{ width: `${Math.round(c.memoryAvg * 100)}%` }} />
          <b>
            {w.memory} {used !== null ? `${used.toFixed(1)} / ${c.memoryGb} GB` : `${Math.round(c.memoryAvg * 100)}%`}
            {c.memoryPeak !== null ? ` · ${w.peak} ${Math.round(c.memoryPeak * 100)}%` : ""}
          </b>
        </div>
      )}
      <small>
        {c.working} {w.running_n} · {c.inLine} {w.inLine}
        {c.diskFreeGb !== null ? ` · ${Math.round(c.diskFreeGb)} GB ${w.disk}` : ""}
        {c.cpus ? ` · ${c.cpus} CPU` : ""}
      </small>
    </li>
  );
}

export function CentralPage({ initialAgent }: { initialAgent: string | null }) {
  const { org } = useOrg();
  const w = useCentralWords();
  const now = useClock();
  const navigate = useNavigate();
  const central = useCentral(org.id);
  const view = central.data;
  const { agentName } = useNames();
  const [agentId, setAgentId] = useState<string | null>(initialAgent);
  const [runId, setRunId] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const out = new Map<string, CentralTask[]>(COLUMNS.map((c) => [c, []]));
    for (const t of view?.tasks ?? []) out.get(columnOf(t.state))?.push(t);
    out.set("ended", (out.get("ended") ?? []).slice(0, 12));
    return out;
  }, [view]);
  const task = view?.tasks.find((t) => t.runId === runId) ?? null;
  const agent = view?.agents.find((a) => a.id === agentId) ?? null;
  const count = (states: string[]) => view?.tasks.filter((t) => states.includes(t.state)).length ?? 0;
  const closeAgent = () => {
    setAgentId(null);
    if (initialAgent) void navigate({ to: "/org/$orgId/central", params: { orgId: org.id }, search: {} });
  };
  return (
    <div className="central">
      <PageHeader title={w.title} lead={w.lead} />
      <div className="central-summary">
        {(
          [
            ["working", count(["working"]), "live"],
            ["you", count(["waiting_you"]), "warn"],
            ["stalled", count(["quiet", "stalled"]), "danger"],
            ["done", count(["done"]), "ok"],
          ] as const
        ).map(([key, n, tone]) => (
          <div key={key} data-tone={tone} data-zero={n === 0 || undefined}>
            <b>{n}</b>
            <span>{w.summary[key]}</span>
          </div>
        ))}
      </div>
      {central.isError && !view && <EmptyState title={String(central.error)} />}
      {view && (
        <>
          <section>
            <h2>{w.sections.agents}</h2>
            {view.agents.length ? (
              <ul className="central-agents">
                {view.agents.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    tasks={tasksOfAgent(view, a)}
                    now={now}
                    w={w}
                    onOpen={() => setAgentId(a.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="central-muted">{w.noAgents}</p>
            )}
          </section>
          <section>
            <h2>{w.orchestration}</h2>
            <p className="central-muted central-lead">{w.orchestrationLead}</p>
            <Orchestration view={view} now={now} w={w} />
          </section>
          <section>
            <h2>{w.sections.tasks}</h2>
            {view.hiddenTasks > 0 && (
              <p className="central-muted">
                +{view.hiddenTasks} {w.hidden}
              </p>
            )}
            <div className="central-board">
              {COLUMNS.map((c) => {
                const list = grouped.get(c) ?? [];
                return (
                  <div key={c} className={cx("central-column", list.length === 0 && "is-empty")} data-column={c}>
                    <h3>
                      {w.columns[c]} <span>{list.length}</span>
                    </h3>
                    <ul className="central-list">
                      {list.map((t) => (
                        <TaskCard key={t.runId} task={t} now={now} w={w} onOpen={() => setRunId(t.runId)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <h2>{w.sections.talks}</h2>
            {view.talks.length ? (
              <ul className="central-talks">
                {view.talks.map((t) => (
                  <TalkRow key={t.id} talk={t} now={now} w={w} />
                ))}
              </ul>
            ) : (
              <p className="central-muted">{w.noTalks}</p>
            )}
          </section>
          <div className="central-split">
            <section>
              <h2>{w.sections.prs}</h2>
              {view.pullRequests.length ? (
                <ul className="central-prs">
                  {view.pullRequests.map((p) => (
                    <li key={`${p.repo}#${p.number}`}>
                      <AgentAvatar agentId={p.agentId} name={agentName(p.agentId)} size="xs" />
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.repo}#{p.number}
                      </a>
                      <small>
                        {agentName(p.agentId)} · {shortAgo(p.updatedAt, now, w.now)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="central-muted">{w.noPrs}</p>
              )}
            </section>
            <section>
              <h2>{w.sections.computers}</h2>
              <ul className="central-computers">
                {view.computers.map((c) => (
                  <ComputerCard key={c.id} c={c} w={w} />
                ))}
              </ul>
            </section>
          </div>
          {agent && !task && (
            <AgentPanelView agent={agent} view={view} now={now} w={w} onClose={closeAgent} onTask={setRunId} />
          )}
          {task && <TaskPanel task={task} now={now} w={w} onClose={() => setRunId(null)} />}
        </>
      )}
    </div>
  );
}
