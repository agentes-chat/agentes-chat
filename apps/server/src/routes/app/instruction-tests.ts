import {
  cancelInstructionTest,
  createInstructionTest,
  deleteInstructionTest,
  getInstructionTest,
  instructionTestOverview,
  saveInstructionTestCases,
  suggestInstructionTestCase,
  TooManyError,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  noContent,
  OrgParams,
  requireSession,
  security,
} from "./context";

const tags = ["Agent instruction tests"];
const Params = OrgParams.extend({ agentId: z.uuid() });
const RunParams = Params.extend({ testId: z.uuid() });
const Case = z.object({
  id: z.string().trim().min(1).max(100),
  situation: z.string().trim().min(1).max(4_000),
  expectation: z.string().trim().min(1).max(2_000),
});
const Verdict = z.enum(["met", "not_met", "inconclusive"]);
const Instructions = z.object({
  baseInstructions: z.string().max(100_000),
  candidateInstructions: z.string().max(100_000),
});
const Run = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  status: z.enum(["queued", "running", "done", "failed", "canceled"]),
  model: z.string(),
  executor: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
  baseInstructions: z.string(),
  candidateInstructions: z.string(),
  results: z.array(
    z.object({
      caseId: z.string(),
      situation: z.string(),
      expectation: z.string(),
      current: z.string(),
      candidate: z.string(),
      currentVerdict: Verdict,
      candidateVerdict: Verdict,
      reason: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), costNanoUsd: z.number().nullable() }),
});

export function instructionTestRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("*", requireSession(deps.auth));
  const service = { db: deps.db, gateway: deps.extras?.context?.gateway, hub: deps.extras?.sandbox?.machines?.hub };
  const root = "/organizations/{orgId}/agents/{agentId}";
  const rate = async (userId: string, orgId: string, kind: string, limit: number) => {
    if (
      !(
        await deps.adapters.rateLimiter.consume(`instruction-test:${kind}:${orgId}:${userId}`, {
          limit,
          windowMs: 60_000,
        })
      ).allowed
    )
      throw new TooManyError("Too many instruction test requests");
  };

  app.openapi(
    createRoute({
      method: "get",
      path: `${root}/instruction-tests`,
      tags,
      security,
      summary: "Reusable examples, recent comparisons and executor support",
      request: { params: Params },
      responses: {
        200: json(
          z.object({
            support: z.object({
              available: z.boolean(),
              executor: z.string().nullable(),
              model: z.string().nullable(),
              reason: z.string().nullable(),
              limitations: z.array(z.string()),
            }),
            cases: z.array(Case),
            runs: z.array(Run),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json(await instructionTestOverview(service, c.get("user").id, orgId, agentId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: `${root}/instruction-test-cases`,
      tags,
      security,
      summary: "Replace this agent's reusable examples",
      request: { params: Params, body: body(z.object({ cases: z.array(Case).max(5) })) },
      responses: { 200: json(z.object({ cases: z.array(Case) })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      return c.json(
        { cases: await saveInstructionTestCases(service, c.get("user").id, orgId, agentId, c.req.valid("json").cases) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${root}/instruction-tests`,
      tags,
      security,
      summary: "Queue an isolated, response-only comparison",
      request: { params: Params, body: body(Instructions.extend({ cases: z.array(Case).min(1).max(5) })) },
      responses: { 201: json(z.object({ run: Run })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      await rate(c.get("user").id, orgId, "run", 3);
      const run = await createInstructionTest(service, c.get("user").id, orgId, agentId, c.req.valid("json"));
      deps.wakeWorkers?.();
      return c.json({ run }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${root}/instruction-tests/suggest`,
      tags,
      security,
      summary: "Explicitly ask the configured API model for one synthetic example",
      request: { params: Params, body: body(Instructions) },
      responses: { 200: json(z.object({ case: Case })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId } = c.req.valid("param");
      await rate(c.get("user").id, orgId, "suggest", 3);
      return c.json(
        { case: await suggestInstructionTestCase(service, c.get("user").id, orgId, agentId, c.req.valid("json")) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${root}/instruction-tests/{testId}`,
      tags,
      security,
      summary: "Read a comparison this person may inspect",
      request: { params: RunParams },
      responses: { 200: json(z.object({ run: Run })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId, testId } = c.req.valid("param");
      return c.json({ run: await getInstructionTest(service, c.get("user").id, orgId, agentId, testId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${root}/instruction-tests/{testId}/cancel`,
      tags,
      security,
      summary: "Cancel a queued or running comparison",
      request: { params: RunParams },
      responses: { 200: json(z.object({ run: Run })), ...errors },
    }),
    async (c) => {
      const { orgId, agentId, testId } = c.req.valid("param");
      return c.json({ run: await cancelInstructionTest(service, c.get("user").id, orgId, agentId, testId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: `${root}/instruction-tests/{testId}`,
      tags,
      security,
      summary: "Cancel and remove stored comparison inputs and outputs",
      request: { params: RunParams },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, agentId, testId } = c.req.valid("param");
      await deleteInstructionTest(service, c.get("user").id, orgId, agentId, testId);
      return c.body(null, 204);
    },
  );
  return app;
}
