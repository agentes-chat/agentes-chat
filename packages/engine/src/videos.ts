import {
  bytesToBase64,
  isVideoBlocked,
  MAX_VIDEO_PROMPT_CHARS,
  ProviderError,
  providerCause,
  VIDEO_ASPECTS,
  type VideoAspect,
  videoModelInfo,
  videoSeconds,
} from "@agenteschat/providers";
import { type ArtifactDeps, createFileArtifact } from "./artifacts";
import { accountablePerson, runAuthorityById, UUID } from "./authority";
import { TtlCache } from "./cache";
import { BudgetExceededError, MissingCredentialError, PersonLimitError, ValidationError } from "./errors";
import type { ModelGateway } from "./gateway";
import { readPictureFile } from "./live/assets";
import { type AgentImageContext, agentActorOf } from "./live/images";
import type { ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

/**
 * Videos made with the workspace's video AI (ADR 0219): an agent's `generate_video` makes one through the Model
 * Gateway while it waits, saves it as a video file where its run posts, and its reply carries it, so people play it
 * in the chat like any video posted there.
 */

export type VideoFailure = "no_key" | "budget" | "limit" | "blocked" | "provider" | "too_many";

/**
 * The most a provider call may take. A computer brain gives a tool of ours five minutes (Codex's `tool_timeout_sec`),
 * so the wait ends before that.
 * ponytail: a video slower than this is lost (and may be billed by the provider); a job that posts it when ready, as
 * `live.image` does for canvases, if providers get slower.
 */
export const VIDEO_CALL_TIMEOUT_MS = 280_000;

export interface VideoDeps {
  artifacts: ArtifactDeps;
  gateway: ModelGateway;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
}

export interface ChatVideoInput {
  prompt: string;
  seconds?: number;
  aspect?: VideoAspect;
  model?: string | null;
  /** A picture file the agent reads, for the video to start from. */
  image?: string | null;
}

export type ChatVideoView =
  | { file: { id: string; version: number; title: string }; model: string; seconds: number; costNanoUsd: number }
  | { failure: VideoFailure; model: string };

export function videoFailureOf(error: unknown): VideoFailure {
  if (error instanceof MissingCredentialError) return "no_key";
  if (error instanceof BudgetExceededError) return "budget";
  if (error instanceof PersonLimitError) return "limit";
  if (isVideoBlocked(error)) return "blocked";
  if (error instanceof ProviderError) return providerCause(error) === "invalid_key" ? "no_key" : "provider";
  if (error instanceof ValidationError && (error.code.startsWith("storage.") || error.code.startsWith("limits.")))
    return "too_many";
  return "provider";
}

/** A video file's title and name from its prompt: `a-paper-boat-on-a-rainy-street.mp4`. */
function videoName(prompt: string, mediaType: string) {
  const line = prompt.replace(/\s+/g, " ").trim();
  const slug =
    line
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "video";
  const extension = mediaType === "video/webm" ? "webm" : mediaType === "video/quicktime" ? "mov" : "mp4";
  return { title: line.length > 60 ? `${line.slice(0, 59)}…` : line, name: `${slug}.${extension}` };
}

/**
 * An agent's video in its conversation (`generate_video`): the model is the one asked or the workspace's first,
 * the picture to start from one the agent reads; made through the gateway (budget, standing and usage as every
 * call), saved as a video file where the run posts. What wasn't made says why (`failure`); refused before any call
 * when the workspace has no video model or the one asked isn't one it can use.
 */
export async function generateVideoInChat(
  deps: VideoDeps,
  ctx: AgentImageContext,
  input: ChatVideoInput,
): Promise<ChatVideoView> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new ValidationError("Say what the video should show");
  if (prompt.length > MAX_VIDEO_PROMPT_CHARS)
    throw new ValidationError(`The prompt is over ${MAX_VIDEO_PROMPT_CHARS} characters`);
  const available = await deps.gateway.availableVideoModels(ctx.orgId);
  const model = input.model ?? available[0];
  const info = model && available.includes(model) ? videoModelInfo(model) : undefined;
  if (!model || !info) {
    if (available.length === 0) return { failure: "no_key", model: input.model ?? "" };
    throw new ValidationError(`The video model ${model} isn't available in this workspace`, "videos.model_unavailable");
  }
  const actor = agentActorOf(ctx);
  const startImage = input.image
    ? await readPictureFile(deps.artifacts, actor, ctx.orgId, input.image).then(
        (picture) => ({ mediaType: picture.contentType, data: bytesToBase64(picture.bytes) }),
        (error: unknown) => {
          throw new ValidationError(
            `The picture ${input.image} can't be used to start from: ${error instanceof Error ? error.message : String(error)}`,
            "videos.reference",
          );
        },
      )
    : undefined;
  const seconds = videoSeconds(info, input.seconds);
  const aspect = input.aspect && VIDEO_ASPECTS.includes(input.aspect) ? input.aspect : "16:9";
  const runId = actor.runId && UUID.test(actor.runId) ? actor.runId : null;
  const personId = runId ? accountablePerson(await runAuthorityById(deps.artifacts.db, ctx.orgId, runId)) : null;
  const limit = AbortSignal.timeout(VIDEO_CALL_TIMEOUT_MS);
  try {
    const made = await deps.gateway.generateVideo({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      personId,
      runId,
      request: { model, prompt, seconds, aspect, ...(startImage ? { startImage } : {}) },
      signal: ctx.signal ? AbortSignal.any([ctx.signal, limit]) : limit,
    });
    const file = await createFileArtifact(deps.artifacts, actor, ctx.orgId, {
      ...videoName(prompt, made.video.mediaType),
      bytes: made.video.bytes,
      contentType: made.video.mediaType,
    });
    return {
      file: { id: file.id, version: file.version, title: file.title },
      model,
      seconds,
      costNanoUsd: made.costNanoUsd,
    };
  } catch (error) {
    deps.log?.warn("chat video failed", { error: error instanceof Error ? error.message : String(error) });
    return { failure: videoFailureOf(error), model };
  }
}

/** What a video that wasn't made means to the agent, and what to do. */
const VIDEO_FAILURES: Record<VideoFailure, string> = {
  no_key:
    "No video AI is connected to this workspace. Say so: an administrator adds a Gemini or OpenRouter key in the workspace's settings.",
  budget: "Your budget can't pay for this video. Say so: whoever manages you can raise it.",
  limit: "The person who asked reached their monthly AI limit, so no video now. Say so.",
  blocked:
    "The video AI refused this prompt. Change what it asks for, or say plainly why it can't be made (never try to slip past the refusal).",
  provider: "The video AI failed or took too long this time. Say so; try once more only if it matters.",
  too_many: "The workspace's storage is full: no room for the video. Say so.",
};

/** Whether a workspace can make videos now (a key for a video model), read at most every 30 s per process. */
const videoModelsCache = new TtlCache<string[]>(30_000);

const str = (value: unknown) => (typeof value === "string" ? value : "");

function generateVideo(deps: VideoDeps, models: string[]): ToolDefinition {
  return {
    name: "generate_video",
    description: [
      "Make a short video, with sound, with the workspace's video AI. It goes on your reply as a video people play in the chat (a file in the Drive), and is paid from your budget. It takes a minute or two.",
      "Write a concrete prompt: the subject, what happens, the camera, the light, and the sound or what is said. `seconds`: how long (default 8). `aspect`: 16:9 landscape (default) or 9:16 portrait. `image`: a picture file's id to start from (a picture posted here, or one you made with generate_image).",
      `Models here: ${models.join(", ")} (the first is the default; name one only when a person asks for it).`,
    ].join("\n"),
    scope: "drive:write",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: MAX_VIDEO_PROMPT_CHARS },
        seconds: { type: "integer", minimum: 1, maximum: 15 },
        aspect: { enum: VIDEO_ASPECTS },
        image: { type: "string", minLength: 1, maxLength: 64 },
        model: { enum: models },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: "Make a video", detail: str(input.prompt).slice(0, 200) }),
    async checkCall(input) {
      return str(input.prompt).trim() ? { ok: true } : { ok: false, message: "Say what the video should show." };
    },
    async execute(input, ctx): Promise<ToolOutput> {
      try {
        const out = await generateVideoInChat(deps, ctx, {
          prompt: str(input.prompt),
          ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
          ...(input.aspect ? { aspect: input.aspect as VideoAspect } : {}),
          ...(input.model ? { model: str(input.model) } : {}),
          ...(input.image ? { image: str(input.image) } : {}),
        });
        if ("failure" in out) return { content: `No video was made. ${VIDEO_FAILURES[out.failure]}`, isError: true };
        return {
          content: `Made a ${out.seconds}-second video with ${out.model}: it goes on your reply as a video people play in the chat (file id ${out.file.id}). You haven't watched it: don't describe what it shows beyond what you asked for.`,
          data: { artifact: out.file },
        };
      } catch (error) {
        return { content: `Failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
}

/** `generate_video`, offered only where the workspace has a video model: elsewhere it could only fail. */
export function createVideoToolSource(deps: VideoDeps): ToolSource {
  return {
    name: "videos",
    async tools(ctx) {
      const models = await videoModelsCache
        .getOrLoad(ctx.orgId, () => deps.gateway.availableVideoModels(ctx.orgId))
        .catch(() => [] as string[]);
      return models.length > 0 ? [generateVideo(deps, models)] : [];
    },
  };
}
