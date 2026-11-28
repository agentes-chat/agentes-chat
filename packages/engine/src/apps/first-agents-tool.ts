import { firstAgentsInput, firstAgentsOpen, saveFirstAgents } from "../first-agents";
import type { AppPrincipal } from "./grants";
import type { AppsToolDeps, RegisterTool } from "./tools";
import { appsUrls } from "./urls";

/**
 * The onboarding's ask (ADR 0119 addendum of 2026-11-26, ADR 0264): the person's own AI, which knows their work,
 * proposes their first agents. The tool only keeps the proposal for the person who connected it, so every connection
 * gets it, whatever its access, and it is the one tool that works while the workspace waits for its first plan. It is
 * offered only while the person may still pick one (`firstAgentsOpen`: an owner on the onboarding, anyone else who may
 * create agents on their welcome page, before their first agent's delivery is armed); called after that, it keeps
 * nothing and says there is nothing to pick.
 */
export const APP_FIRST_AGENT_TOOL_NAMES = ["propose_first_agents"] as const;

export function registerFirstAgentTools(deps: AppsToolDeps, p: AppPrincipal, tool: RegisterTool) {
  if (!p.firstAgentsOpen) return;
  const issuer = appsUrls(deps.publicUrl).issuer;
  const person = p.personName;

  tool(
    "propose_first_agents",
    {
      scope: "read",
      title: "Propose first agents",
      description: `Sends up to 3 options for ${person}'s first agent in agentes.chat, for ${person} to pick one there. Nothing is created here: ${person} picks where to start in agentes.chat. Each option is an agent for one repetitive task of theirs, described like a job opening: a short first name, its role, why you chose that task (one sentence, from what you saw), its responsibilities (what it does alone, when it runs, when it calls them), the apps it needs, its routine (a title, when it runs in their words and as cron in their time zone, what each run does) and what it can deliver on its first day. Order the options by the time each task takes them, the most first. Write everything in ${person}'s language. A newer call replaces the options they see. After calling it, tell ${person} to go back to agentes.chat to pick one.`,
      input: firstAgentsInput.strict(),
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
    },
    async (args) => {
      // Read again at the call: the person may have moved past the work step since this connection's tools were listed.
      const where = await firstAgentsOpen(deps.db, p.orgId, p.userId);
      if (!where.open)
        return {
          received: 0,
          next: `There is nothing to pick in agentes.chat now: ${person} already has their first agent there, or can't create agents in this workspace. Nothing was kept. Tell ${person} they can create more agents inside agentes.chat whenever they like.`,
        };
      const saved = await saveFirstAgents(
        { db: deps.db, pubsub: deps.pubsub, rateLimiter: deps.rateLimiter, context: deps.context },
        { orgId: p.orgId, userId: p.userId, grantId: p.grantId, source: "mcp", app: p.app.name },
        args,
      );
      return {
        received: saved.options.length,
        // An owner picks on their onboarding; anyone else on their own welcome page (ADR 0264).
        pickIn: where.pickIn === "onboarding" ? `${issuer}/onboarding` : `${issuer}/welcome/${p.orgId}`,
        options: saved.options.map((o) => ({
          name: o.name,
          handle: o.handle,
          schedule_read: Boolean(o.routine?.cron),
        })),
        next: `Nothing was created. Tell ${person} to go back to agentes.chat and pick where to start.`,
      };
    },
  );
}
