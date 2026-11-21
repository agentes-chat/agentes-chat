import { docsUrl } from "@agenteschat/i18n/docs";
import { HELP, HELP_PAGES, type HelpBlock, type HelpSlug } from "@agenteschat/i18n/help";
import { getAgentCached } from "./agents";
import { can, getMembership } from "./organizations";
import { personBehindCall } from "./requester";
import { isRightHand, rightHandId } from "./right-hand";
import { APP_PAGES, type AppPage, OFFER_OPEN_PAGE_TOOL, PAGE_PERMISSION } from "./setup-tools";
import { rankTools } from "./tools/directory";
import type { JsonSchema } from "./tools/json-schema";
import { hasScope } from "./tools/scopes";
import type { ToolDefinition, ToolSource } from "./tools/types";
import { WORKSPACE_ACTION_TOOL, WORKSPACE_ACTIONS } from "./workspace-actions";

/**
 * Where things are in the app and what it lets people do, for every agent (issue #1001): the right hand's screens
 * (`APP_PAGES`), its catalog of changes (`WORKSPACE_ACTIONS`) and the help pages' sections (`HELP`, this edition's),
 * searched with the directory's own ranking. All of it stays in the code and out of every prompt; the answer says how
 * this agent can help with each match.
 */
export const FIND_IN_APP_TOOL = "find_in_app";

/** At most this many matches: enough to pick from, never the whole app. */
const SHOWN = 5;

/** What the ranking reads of a screen or a help section beside its words: nothing. */
const NO_INPUT: JsonSchema = { type: "object", properties: {} };

/** How much of a help section the answer quotes: its gist, the link has the rest. */
const HELP_QUOTED = 400;

const blockText = (b: HelpBlock) => (typeof b === "string" ? b : "list" in b ? b.list.join(" ") : b.code);

/** The English help sections this edition reads (a Cloud workspace skips the self-hosting pages, and the other way). */
const helpSections = (cloud: boolean) =>
  Object.entries(HELP.en).flatMap(([slug, page]) =>
    page && HELP_PAGES[slug as HelpSlug] !== (cloud ? "selfhost" : "cloud")
      ? page.sections.map((section) => ({
          slug: slug as HelpSlug,
          title: page.title,
          section,
          text: section.blocks.map(blockText).join(" "),
        }))
      : [],
  );

/**
 * Screens, actions and help sections as one list to rank: a screen's name is `page:<key>`, a help section's
 * `help:<index>`, an action's its id.
 */
const entriesOf = (help: ReturnType<typeof helpSections>) => [
  ...Object.entries(APP_PAGES).map(
    ([key, does]) => ({ name: `page:${key}`, description: does, inputSchema: NO_INPUT }) as ToolDefinition,
  ),
  ...WORKSPACE_ACTIONS.map((a) => ({ name: a.id, description: a.does, inputSchema: a.input }) as ToolDefinition),
  ...help.map(
    (h, i) =>
      ({
        name: `help:${i}`,
        description: `${h.title}: ${h.section.heading}. ${h.text}`,
        inputSchema: NO_INPUT,
      }) as ToolDefinition,
  ),
];

/** `cloud`: this server is agentes.chat Cloud (`isAgentesCloud`), so the help it quotes is the Cloud's. */
export function createAppGuideToolSource(deps: { cloud: boolean }): ToolSource {
  const help = helpSections(deps.cloud);
  const entries = entriesOf(help);
  const tool: ToolDefinition = {
    name: FIND_IN_APP_TOOL,
    description:
      "Where something is in agentes.chat, the app you work in, and whether it does something: screens, settings, changes, help.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        what: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "In a few English words.",
        },
      },
      required: ["what"],
      additionalProperties: false,
    },
    describe: () => ({ title: "Look it up in the app" }),
    async execute(input, ctx) {
      const what = typeof input.what === "string" ? input.what : "";
      const best = rankTools(entries, "", what).slice(0, SHOWN);
      if (best.length === 0)
        return {
          content: `Nothing in the app's screens or settings matches "${what}". Try other words; if still nothing, say you didn't find it, never that it can't be done.`,
        };
      const [self, person, opens, rightHand] = await Promise.all([
        getAgentCached(ctx.db, ctx.orgId, ctx.agentId),
        personBehindCall(ctx),
        hasScope(ctx.db, ctx.orgId, ctx.agentId, null, "setup:write"),
        rightHandId(ctx.db, ctx.orgId),
      ]);
      const lodi = isRightHand(self);
      const membership = person ? await getMembership(ctx.db, person, ctx.orgId) : null;
      const hand = !lodi && rightHand ? await getAgentCached(ctx.db, ctx.orgId, rightHand) : null;
      const handName = hand ? `@${hand.handle}` : "the right hand";
      const lines = best.map((t) => {
        if (t.name.startsWith("help:")) {
          const h = help[Number(t.name.slice(5))];
          if (!h) return "";
          const gist = h.text.length > HELP_QUOTED ? `${h.text.slice(0, HELP_QUOTED)}…` : h.text;
          return `- Help, ${h.title} › ${h.section.heading}: ${gist} (${docsUrl("en", h.slug, h.section.id)})`;
        }
        if (t.name.startsWith("page:")) {
          const page = t.name.slice(5) as AppPage;
          const needs = PAGE_PERMISSION[page];
          const may =
            !membership || !needs || (needs === "manage_owners" ? membership.role === "owner" : can(membership, needs));
          const how = opens
            ? `offer it with ${OFFER_OPEN_PAGE_TOOL} (page "${page}")`
            : `name it; ${handName} can open it for them`;
          return `- Screen: ${APP_PAGES[page]}.${may ? "" : " This person's role doesn't open it: an owner or an admin does."} To help: ${how}.`;
        }
        const action = WORKSPACE_ACTIONS.find((a) => a.id === t.name);
        if (!action) return "";
        const may = !membership || action.needs === null || can(membership, action.needs);
        const how = lodi
          ? `${WORKSPACE_ACTION_TOOL} (action "${action.id}")`
          : `${handName} does it as them (ask_agent, or they ask it), or they do it on its screen`;
        return `- A change people make: ${action.does}${may ? "" : " This person's role doesn't give it: someone who may decides."} To help: ${how}.`;
      });
      return {
        content: [
          ...lines.filter(Boolean),
          "Name the place in the person's language. Something here you can't do yourself is still something the app does: say where, or who does it.",
        ].join("\n"),
      };
    },
  };
  return { name: "app-guide", tools: async () => [tool] };
}
