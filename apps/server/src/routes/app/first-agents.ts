import {
  armFirstDelivery,
  FIRST_AGENT_LIMITS,
  FIRST_AGENT_START_LIMITS,
  latestFirstAgents,
  pickFirstAgent,
  readFirstDelivery,
  requireActiveMembership,
  saveFirstAgents,
  startFirstAgent,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";
import { AgentAppearance } from "./schemas";

const tags = ["Agents"];

const FirstAgentApp = z
  .object({
    key: z.string().nullable().openapi({
      description: "The app's mark when it is one we know: a connector brand (`stripe`) or a mailbox's (`gmail`).",
    }),
    label: z.string(),
  })
  .openapi("FirstAgentApp");

const FirstAgentOption = z
  .object({
    name: z.string(),
    handle: z.string().openapi({ description: "Free when proposed; a free one again when picked." }),
    role: z.string(),
    why: z.string(),
    tasks: z.array(z.string()).openapi({ description: "Its responsibilities, 1 to 4." }),
    apps: z.array(FirstAgentApp),
    routine: z
      .object({
        title: z.string(),
        schedule: z.string().openapi({ description: "As the AI wrote it." }),
        prompt: z.string(),
        cron: z
          .string()
          .nullable()
          .openapi({ description: "Read in the person's time zone; null when it couldn't be." }),
        timezone: z.string().nullable(),
      })
      .nullable(),
    today: z.array(z.string()).openapi({ description: "What it delivers on its first day, up to 3." }),
    instructions: z.string(),
    appearance: AgentAppearance,
  })
  .openapi("FirstAgentOption");

const FirstAgents = z
  .object({
    id: z.uuid(),
    about: z.string().nullable(),
    source: z.enum(["mcp", "paste"]),
    options: z.array(FirstAgentOption),
    picked: z.number().int().nullable().openapi({ description: "The option picked, from when the pick starts." }),
    agentId: z.uuid().nullable(),
    createdAt: z.string(),
  })
  .openapi("FirstAgents");

/**
 * What the person pastes from their AI, as `firstAgentsInput` reads it (a null reads as left out). Only its shape here:
 * the engine checks its lengths and counts, so a long name answers `first_agents.invalid` with what is wrong.
 */
const FirstAgentsBody = z
  .object({
    about: z
      .string()
      .nullish()
      .openapi({ description: `Up to ${FIRST_AGENT_LIMITS.about} characters.` }),
    options: z
      .array(
        z.object({
          name: z.string().openapi({ description: `1 to ${FIRST_AGENT_LIMITS.name} characters.` }),
          handle: z.string().nullish(),
          role: z.string().openapi({ description: `1 to ${FIRST_AGENT_LIMITS.role} characters.` }),
          why: z.string().openapi({ description: `1 to ${FIRST_AGENT_LIMITS.why} characters.` }),
          tasks: z.array(z.string()).openapi({
            description: `1 to ${FIRST_AGENT_LIMITS.tasks}, each up to ${FIRST_AGENT_LIMITS.task} characters.`,
          }),
          apps: z.array(z.string()).nullish().openapi({ description: "By name: Gmail, Stripe." }),
          routine: z
            .object({ title: z.string(), schedule: z.string(), prompt: z.string(), cron: z.string().nullish() })
            .nullish(),
          today: z
            .array(z.string())
            .nullish()
            .openapi({ description: `Up to ${FIRST_AGENT_LIMITS.today}.` }),
          instructions: z.string().nullish(),
        }),
      )
      .openapi({ description: `1 to ${FIRST_AGENT_LIMITS.options}, the task that takes the most time first.` }),
  })
  .openapi("FirstAgentsInput");

const Picked = z
  .object({
    agentId: z.uuid(),
    handle: z.string(),
    channelId: z.uuid().openapi({ description: "Its channel in a team's workspace, else your DM with it." }),
  })
  .openapi("FirstAgentPicked");

/** An agent of one of the onboarding's areas, or of "Outro" (ADR 0264 addendum). Only its shape: the engine checks it. */
const FirstAgentStartBody = z
  .object({
    area: z.string().openapi({
      description: `The onboarding's area (\`support\`, \`life\`, \`custom\`), 1 to ${FIRST_AGENT_START_LIMITS.area} characters.`,
    }),
    name: z.string().openapi({ description: `1 to ${FIRST_AGENT_START_LIMITS.name} characters.` }),
    role: z
      .string()
      .optional()
      .openapi({ description: `Up to ${FIRST_AGENT_START_LIMITS.role} characters.` }),
    instructions: z
      .string()
      .optional()
      .openapi({ description: `Up to ${FIRST_AGENT_START_LIMITS.instructions} characters.` }),
    appearance: z.object({ color: z.string(), eyes: z.string(), accessory: z.string() }).nullish(),
    task: z
      .string()
      .optional()
      .openapi({
        description: `What it delivers first when it has no routine of yours, up to ${FIRST_AGENT_START_LIMITS.task} characters.`,
      }),
    apps: z
      .array(z.string())
      .optional()
      .openapi({
        description: `Catalog ids of the apps its job needs, up to ${FIRST_AGENT_START_LIMITS.apps}: its checklist asks to connect those not connected yet.`,
      }),
    replace: z.uuid().nullish().openapi({
      description:
        "The agent this one takes the place of: your first agent made a moment ago, archived when its delivery hasn't fired.",
    }),
  })
  .openapi("FirstAgentStartInput");

const FirstDelivery = z
  .object({
    agentId: z.uuid(),
    area: z.string().nullable().openapi({ description: "The onboarding's area; null for an agent from another app." }),
    task: z.string(),
    armedAt: z
      .string()
      .nullable()
      .openapi({ description: "When I left the agent's step (`PUT`): it fires only once armed." }),
    firedAt: z
      .string()
      .nullable()
      .openapi({ description: "When it went out; null while it waits for the plan or the AI." }),
    runId: z.uuid().nullable().openapi({ description: "The run it woke in your DM with the agent, once fired." }),
  })
  .openapi("FirstDelivery");

/**
 * The first agents the person's own AI proposed (ADR 0264): the newest proposal, one pasted from an AI with no
 * connector, and the pick. All of it works while the workspace waits for its first plan: the onboarding runs before
 * Checkout. An agent of one of the onboarding's areas, and the person's first delivery (ADR 0264 addendum): what that
 * agent does for them first, in their DM with it, once the workspace has its plan and the agent its AI.
 */
export function firstAgentRoutes(deps: AppDeps) {
  const { db, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/first-agents",
      tags,
      security,
      summary: "My newest first-agent proposal here, or null",
      description:
        "What my AI sent through `propose_first_agents`, or what I pasted. The onboarding reads it every few seconds while it waits; the user event `first_agents.received` says a new one came.",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ proposal: FirstAgents.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json({ proposal: await latestFirstAgents(db, orgId, c.get("user").id) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/first-agents",
      tags,
      security,
      summary: "Keep a first-agent proposal I pasted from my AI",
      description:
        "1 to 3 options, the task that takes the most time first. Nothing is created. 400 `first_agents.invalid` with what is wrong; 429 `first_agents.rate_limited` past 10 an hour; 403 `org.paused` on any hold but the first plan's.",
      request: { params: OrgParams, body: body(FirstAgentsBody) },
      responses: { 200: json(z.object({ proposal: FirstAgents })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const proposal = await saveFirstAgents(
        { db, pubsub: adapters.pubsub, rateLimiter: adapters.rateLimiter, context: deps.extras?.context },
        { orgId, userId: c.get("user").id, grantId: null, source: "paste" },
        c.req.valid("json"),
      );
      return c.json({ proposal }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/first-agents/{id}/pick",
      tags,
      security,
      summary: 'Create the agent of one option ("Criar o …")',
      description:
        "One agent, as you, through the right hand's team card in your DM with it (Undo for a day): its routine, its AI, its own channel in a team's workspace. Picking again answers with the same agent. `replace`: your first agent made a moment ago on the onboarding (an area's, or an earlier proposal's) whose first delivery hasn't gone, archived, so the onboarding leaves one. 403 `create_agents_required` without the permission to create agents; 409 `first_agents.picking` while another pick of it runs.",
      request: {
        params: OrgParams.extend({ id: z.uuid() }),
        body: body(
          z.object({
            index: z
              .number()
              .int()
              .min(0)
              .max(FIRST_AGENT_LIMITS.options - 1),
            replace: z.uuid().nullish(),
          }),
        ),
      },
      responses: { 200: json(Picked), ...errors },
    }),
    async (c) => {
      const { orgId, id } = c.req.valid("param");
      const picked = await pickFirstAgent(
        { db, pubsub: adapters.pubsub, gateway: deps.extras?.context?.gateway, context: deps.extras?.context },
        { orgId, userId: c.get("user").id },
        id,
        c.req.valid("json").index,
        c.req.valid("json").replace,
      );
      return c.json(picked, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/first-agents/start",
      tags,
      security,
      summary: "Create my first agent from an area of the onboarding",
      description:
        "One agent, as you, made as a picked proposal is (its own channel in a team's workspace, its AI, a checklist row for each app to connect) but with no routine: connecting an app brings its routine. Its first delivery is kept, armed when you leave the agent's step (`PUT …/first-delivery`), and fires in your DM with it once the workspace has its plan and the agent its AI. `replace`: your first agent made a moment ago, archived. 400 `first_agents.invalid` with what is wrong; 403 `create_agents_required` without the permission to create agents.",
      request: { params: OrgParams, body: body(FirstAgentStartBody) },
      responses: { 201: json(Picked), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const made = await startFirstAgent(
        { db, pubsub: adapters.pubsub, gateway: deps.extras?.context?.gateway, context: deps.extras?.context },
        { orgId, userId: c.get("user").id },
        c.req.valid("json"),
      );
      return c.json(made, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/first-delivery",
      tags,
      security,
      summary: "My first delivery here, or null",
      description:
        "What the agent I set up on the onboarding does for me first, and whether it went out. Null when none was kept, or its agent was archived.",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ delivery: FirstDelivery.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      await requireActiveMembership(db, userId, orgId);
      return c.json({ delivery: await readFirstDelivery(db, orgId, userId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/first-delivery",
      tags,
      security,
      summary: "Arm my first delivery as I leave the agent's step",
      description:
        "Called by the onboarding's Continue on the agent's step: from then on it fires as soon as the workspace has its plan and the agent its AI. My waiting delivery of this agent keeps its area and task; any other agent of this workspace (one brought from another app) takes its place with no area and no task, its brief then its routine of yours, else its role. One already fired stays as it is. 404 `first_delivery.no_agent` for an agent not here or archived; 403 `first_delivery.not_yours` for one that doesn't answer you.",
      request: { params: OrgParams, body: body(z.object({ agentId: z.uuid() })) },
      responses: { 200: json(z.object({ delivery: FirstDelivery })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const delivery = await armFirstDelivery(db, { orgId, userId: c.get("user").id }, c.req.valid("json").agentId);
      return c.json({ delivery }, 200);
    },
  );

  return app;
}
