import { CLAUDE_DESIGN_LIMITS } from "@agenteschat/adapters";
import type { ToolContext, ToolDefinition, ToolSource } from "../tools/types";
import type { DesignInput } from "./ledger";
import {
  type ClaudeDesignServiceDeps,
  checkClaudeDesignInput,
  designAuthorityBinding,
  getClaudeDesignJobForContext,
  submitClaudeDesign,
} from "./service";

const sourceIds = {
  type: "array",
  items: { type: "string", minLength: 36, maxLength: 36 },
  maxItems: CLAUDE_DESIGN_LIMITS.maxSources,
};
const brief = { type: "string", minLength: 1, maxLength: CLAUDE_DESIGN_LIMITS.briefChars };
function inputOf(action: "create" | "update", input: Record<string, unknown>): DesignInput {
  return {
    action,
    brief: String(input.brief),
    sourceArtifactIds: Array.isArray(input.source_artifact_ids) ? (input.source_artifact_ids as string[]) : [],
    ...(action === "create"
      ? { title: String(input.title) }
      : { designId: String(input.design_id), expectedRevision: Number(input.expected_revision) }),
  };
}
const failed = () => ({
  content:
    "Claude Design is unavailable for this request. Check the selected account and agent access, then ask again.",
  isError: true,
});
export function createClaudeDesignToolSource(deps: ClaudeDesignServiceDeps): ToolSource {
  const write = (action: "create" | "update"): ToolDefinition => ({
    name: `${action}_claude_design`,
    scope: "claude-design:write",
    service: "claude",
    sensitive: true,
    description:
      action === "create"
        ? "Create a private Claude Design using the account explicitly enabled for this agent. Returns a job id and a board task created automatically; do not create a duplicate task. Completion arrives in this conversation. An empty shell is still creating, not published. Do not announce a ready link until the job returns remote. Completion wakes you automatically; do not schedule polling routines. Requires the account owner's DM."
        : "Update an existing Claude Design at the exact local revision. Returns a job id. Never retries an uncertain publication automatically.",
    inputSchema: {
      type: "object",
      properties: {
        brief,
        source_artifact_ids: sourceIds,
        ...(action === "create"
          ? { title: { type: "string", minLength: 1, maxLength: CLAUDE_DESIGN_LIMITS.titleChars } }
          : {
              design_id: { type: "string", minLength: 36, maxLength: 36 },
              expected_revision: { type: "integer", minimum: 1 },
            }),
      },
      required: action === "create" ? ["title", "brief"] : ["design_id", "expected_revision", "brief"],
      additionalProperties: false,
    },
    describe: (input) => ({
      title: action === "create" ? `Create Claude Design: ${String(input.title)}` : "Update Claude Design",
      detail: String(input.brief).slice(0, 500),
    }),
    approvalBinding: async (input, ctx) =>
      designAuthorityBinding(await checkClaudeDesignInput(deps, ctx, inputOf(action, input))),
    checkCall: async (input, ctx) => {
      try {
        await checkClaudeDesignInput(deps, ctx, inputOf(action, input));
        return { ok: true };
      } catch {
        return { ok: false, message: failed().content };
      }
    },
    execute: async (input, ctx) => {
      try {
        const job = await submitClaudeDesign(deps, ctx, inputOf(action, input));
        return { content: JSON.stringify({ job_id: job.id, ...job }), data: { claudeDesign: job } };
      } catch {
        return failed();
      }
    },
  });
  return {
    name: "claude-design",
    async tools(_ctx: ToolContext) {
      return [
        ...(deps.enabled ? [write("create"), write("update")] : []),
        {
          name: "get_claude_design_job",
          scope: "claude-design:read",
          service: "claude",
          description:
            "Read a Claude Design job from this account owner's conversation. The live progress includes the board task and pendingConsentId; ask for owner review only while pendingConsentId is present. Historical consent messages do not prove a current pending request. A remote link is returned only after content publication is confirmed. Without remote, do not claim ready/published or invent a link. Completion arrives automatically; do not schedule polling routines.",
          inputSchema: {
            type: "object",
            properties: { job_id: { type: "string", minLength: 36, maxLength: 36 } },
            required: ["job_id"],
            additionalProperties: false,
          },
          execute: async (input, ctx) => {
            try {
              return { content: JSON.stringify(await getClaudeDesignJobForContext(deps, ctx, String(input.job_id))) };
            } catch {
              return failed();
            }
          },
        },
      ];
    },
  };
}
