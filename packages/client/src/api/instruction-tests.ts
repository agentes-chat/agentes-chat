import type { createRequester } from "./http";

export interface InstructionTestCase {
  id: string;
  situation: string;
  expectation: string;
}

export type InstructionTestVerdict = "met" | "not_met" | "inconclusive";

export interface InstructionTestRun {
  id: string;
  agentId: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  model: string;
  executor: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  baseInstructions: string;
  candidateInstructions: string;
  results: {
    caseId: string;
    situation: string;
    expectation: string;
    current: string;
    candidate: string;
    currentVerdict: InstructionTestVerdict;
    candidateVerdict: InstructionTestVerdict;
    reason: string;
  }[];
  limitations: string[];
  usage: { inputTokens: number; outputTokens: number; costNanoUsd: number | null };
}

export interface InstructionTestsOverview {
  support: {
    available: boolean;
    executor: string | null;
    model: string | null;
    reason: string | null;
    limitations: string[];
  };
  cases: InstructionTestCase[];
  runs: InstructionTestRun[];
}

export interface InstructionTestInput {
  baseInstructions: string;
  candidateInstructions: string;
  cases: InstructionTestCase[];
}

export interface InstructionTestsApi {
  list(orgId: string, agentId: string): Promise<InstructionTestsOverview>;
  saveCases(orgId: string, agentId: string, cases: InstructionTestCase[]): Promise<{ cases: InstructionTestCase[] }>;
  start(orgId: string, agentId: string, input: InstructionTestInput): Promise<{ run: InstructionTestRun }>;
  get(orgId: string, agentId: string, testId: string): Promise<{ run: InstructionTestRun }>;
  cancel(orgId: string, agentId: string, testId: string): Promise<{ run: InstructionTestRun }>;
  remove(orgId: string, agentId: string, testId: string): Promise<void>;
  suggest(
    orgId: string,
    agentId: string,
    input: Omit<InstructionTestInput, "cases">,
  ): Promise<{ case: InstructionTestCase }>;
}

export function createInstructionTestsApi(request: ReturnType<typeof createRequester>): InstructionTestsApi {
  const base = (orgId: string, agentId: string) =>
    `/api/app/organizations/${encodeURIComponent(orgId)}/agents/${encodeURIComponent(agentId)}`;
  const runs = (orgId: string, agentId: string) => `${base(orgId, agentId)}/instruction-tests`;
  return {
    list: (orgId, agentId) => request(runs(orgId, agentId)),
    saveCases: (orgId, agentId, cases) =>
      request(`${base(orgId, agentId)}/instruction-test-cases`, { method: "PUT", json: { cases } }),
    start: (orgId, agentId, input) => request(runs(orgId, agentId), { json: input }),
    get: (orgId, agentId, testId) => request(`${runs(orgId, agentId)}/${encodeURIComponent(testId)}`),
    cancel: (orgId, agentId, testId) =>
      request(`${runs(orgId, agentId)}/${encodeURIComponent(testId)}/cancel`, { json: {} }),
    remove: (orgId, agentId, testId) =>
      request(`${runs(orgId, agentId)}/${encodeURIComponent(testId)}`, { method: "DELETE" }),
    suggest: (orgId, agentId, input) => request(`${runs(orgId, agentId)}/suggest`, { json: input }),
  };
}
