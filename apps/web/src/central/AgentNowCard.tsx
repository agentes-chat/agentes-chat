import { useCentral } from "@agenteschat/client";
import { Card } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useOrg } from "@/components/org-context";
import { leadTask, STILL_ON, shortAgo, TONE, tasksOfAgent } from "./model";
import { setupLine, useCentralWords } from "./words";
import "./central.css";

/** VPS Zen: the top of an agent's page: what it does now, for whom, and how it is set up. */
export function AgentNowCard({ agentId }: { agentId: string }) {
  const { org } = useOrg();
  const w = useCentralWords();
  const view = useCentral(org.id, 5_000).data;
  const agent = view?.agents.find((a) => a.id === agentId);
  if (!view || !agent) return null;
  const tasks = tasksOfAgent(view, agent);
  const lead = leadTask(tasks.filter((t) => STILL_ON.has(t.state)));
  const talks = view.talks.filter((t) => t.fromAgentId === agentId || t.toAgentId === agentId).length;
  const requester = lead?.requester;
  const asked =
    requester?.kind === "agent"
      ? view.agents.find((a) => a.id === requester.id)?.name
      : requester?.kind === "person" || requester?.kind === "routine"
        ? requester.name
        : null;
  return (
    <Card className="central-now">
      <div className="central-now__top">
        <h3>{w.nowCard}</h3>
        <span className="central-state" data-tone={lead ? TONE[lead.state] : "muted"}>
          <i aria-hidden="true" />
          {lead ? w.state[lead.state] : w.idle}
        </span>
        <Link to="/org/$orgId/central" params={{ orgId: org.id }} search={{ agent: agentId }}>
          {w.central}
        </Link>
      </div>
      {lead && <p className="central-now__task">{lead.title ?? w.untitled}</p>}
      {lead?.progress && (
        <div className="central-progress">
          <span style={{ width: `${lead.progress.percent}%` }} />
          <b>
            {lead.progress.percent}% · {lead.progress.done}/{lead.progress.total}
          </b>
        </div>
      )}
      <small>
        {[
          lead && asked ? `${w.askedBy} ${asked}` : null,
          lead ? `${w.lastSign} ${shortAgo(lead.lastSignalAt, Date.parse(view.at), w.now)}` : null,
          setupLine(agent, w),
          agent.machine ? `${agent.machine.name} · ${agent.machine.online ? w.online : w.off}` : w.noComputer,
          talks ? `${talks} ${w.sections.talks.toLowerCase()}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </Card>
  );
}
