import type { CentralLink, CentralView } from "@agenteschat/client";
import { Icon } from "@agenteschat/ui";
import { AgentAvatar, PersonAvatar } from "@/components/AgentAvatar";
import { shortAgo } from "./model";
import type { useCentralWords } from "./words";

type Words = ReturnType<typeof useCentralWords>;

const linkWords = (l: CentralLink, w: Words) =>
  l.from.kind === "person"
    ? w.requestsN(l.tasks)
    : [l.asks ? w.asksN(l.asks) : null, l.tasks ? w.tasksN(l.tasks) : null].filter(Boolean).join(", ");

/**
 * VPS Zen: who orchestrates whom, read from what happened (the last week's requests), with the org chart's "responde a"
 * beside it. Grouped by who asks: an agent asking others is an orchestrator, whatever its title.
 */
export function Orchestration({ view, now, w }: { view: CentralView; now: number; w: Words }) {
  const name = (id: string) => view.agents.find((a) => a.id === id)?.name ?? "?";
  const groups = new Map<string, CentralLink[]>();
  for (const l of view.links) {
    const key = `${l.from.kind}:${l.from.id}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const chart = view.agents.filter((a) => a.reportsToAgentId);
  if (groups.size === 0 && chart.length === 0) return <p className="central-muted">{w.noLinks}</p>;
  return (
    <div className="central-orch">
      {[...groups.values()].map((links) => {
        const from = links[0]?.from;
        if (!from) return null;
        const who = from.kind === "agent" ? name(from.id) : from.name;
        return (
          <div key={`${from.kind}:${from.id}`} className="central-orch__group" data-kind={from.kind}>
            <div className="central-orch__from">
              {from.kind === "agent" ? (
                <AgentAvatar agentId={from.id} name={who} size="sm" />
              ) : (
                <PersonAvatar id={from.id} name={who} size="sm" />
              )}
              <b>{who}</b>
              {from.kind === "agent" && <span className="central-orch__badge">{w.orchestrates}</span>}
            </div>
            <ul>
              {links.map((l) => (
                <li key={l.toAgentId}>
                  <Icon name="arrowRight" size={14} />
                  <AgentAvatar agentId={l.toAgentId} name={name(l.toAgentId)} size="xs" />
                  <b>{name(l.toAgentId)}</b>
                  <span>{linkWords(l, w)}</span>
                  <small>{shortAgo(l.lastAt, now, w.now)}</small>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {chart.length > 0 && (
        <ul className="central-orch__chart">
          {chart.map((a) => (
            <li key={a.id}>
              <b>{a.name}</b> {w.answersTo} <b>{name(a.reportsToAgentId as string)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
