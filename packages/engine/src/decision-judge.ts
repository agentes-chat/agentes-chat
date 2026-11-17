import { type DecisionProviderId, decide, decisionCostNanoUsd, decisionModelLabel } from "@agenteschat/providers";
import type { DecisionModel } from "./decision-model";
import type { ModelGateway } from "./gateway";
import { type Judge, type JudgeAnswer, type JudgeQuestion, type JudgeRequest, judgeSeesImages } from "./judge";
import {
  asksAddressee,
  ROUTER_MESSAGE_CHARS,
  RouterOutputError,
  RouterSkip,
  type RouterStrategy,
  type RoutingInput,
  type RoutingResult,
  SOCIAL_REACTIONS,
  socialChoice,
  withAddressee,
} from "./router";

/**
 * The installation's optional decision model, in front of Jev (ADR 0195). It answers the same typed questions; when
 * it has no picture or no box, the Jev chain answers as before. Any failure is reported on the model's state and the
 * Jev chain takes over, so a provider that is down never leaves a message unanswered.
 */

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function assetsOf(request: JudgeRequest) {
  if (!request.images) return undefined;
  return Object.fromEntries(
    Object.entries(request.images).map(([key, image]) => [
      key,
      { mediaType: `image/${image.format}`, data: image.data },
    ]),
  );
}

const hasBox = (questions: Record<string, JudgeQuestion>) => Object.values(questions).some((q) => q.type === "box");

/** One question set to the configured model, its answers normalized and its usage recorded. */
async function askModel(
  model: NonNullable<Awaited<ReturnType<DecisionModel["current"]>>>,
  request: JudgeRequest,
  gateway: Pick<ModelGateway, "recordExternalUsage">,
  http?: typeof fetch,
): Promise<Record<string, JudgeAnswer>> {
  const result = await decide(
    {
      provider: model.provider,
      baseURL: model.baseURL,
      apiKey: model.apiKey,
      runtime: model.runtime,
      timeoutMs: model.timeoutMs,
    },
    {
      model: model.model,
      state: request.state,
      questions: request.questions,
      ...(assetsOf(request) ? { assets: assetsOf(request) } : {}),
    },
    http,
  );
  await gateway
    .recordExternalUsage({
      orgId: request.orgId,
      agentId: request.agentId,
      runId: request.runId,
      kind: "router",
      provider: model.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costNanoUsd: decisionCostNanoUsd(model.provider, result.usage.inputTokens),
    })
    .catch(() => {});
  return result.answers;
}

/**
 * The configured model, then the Jev chain. Images and box go straight to the chain when the model can't read
 * pictures (box only Jev answers); a calibrated request the model fails goes to the chain, which either has Jev or
 * refuses it as today.
 */
export function createDecisionJudge(options: {
  model: DecisionModel;
  /** Today's chain: Jev when it has a key, then the organization's small model. */
  fallback: Judge;
  gateway: Pick<ModelGateway, "recordExternalUsage">;
  http?: typeof fetch;
}): Judge {
  return {
    get name() {
      return options.model.usable() ? "decision" : options.fallback.name;
    },
    async ask(request) {
      const current = await options.model.current().catch(() => null);
      if (!current) return options.fallback.ask(request);
      if (hasBox(request.questions) || (judgeSeesImages(request) && !current.capabilities.inputs.includes("image")))
        return options.fallback.ask(request);
      try {
        const answers = await askModel(current, request, options.gateway, options.http);
        // A provider that answered only part of the questions is a failure, not a silent "no": Jev takes over.
        if (Object.keys(request.questions).some((id) => answers[id] === undefined))
          throw new Error("incomplete answer");
        return answers;
      } catch (error) {
        const state = (error as { state?: Parameters<DecisionModel["report"]>[0] }).state;
        if (state) options.model.report(state);
        return options.fallback.ask(request);
      }
    },
  };
}

/**
 * The same typed questions as Jev's router, answered by the configured model: does the message need an agent, and
 * which one fits best. The scores are the choice's probabilities, so policy stays in selectAgents.
 */
export function createDecisionRouterStrategy(options: {
  model: DecisionModel;
  gateway: Pick<ModelGateway, "recordExternalUsage">;
  http?: typeof fetch;
}): RouterStrategy {
  return {
    name: "decision",
    on: () => options.model.usable(),
    async decide(input: RoutingInput): Promise<RoutingResult> {
      const current = await options.model.current().catch(() => null);
      if (!current) throw new RouterSkip();
      const criteria: Record<string, string> = {};
      for (const c of input.candidates)
        criteria[c.handle] =
          `${c.name}${c.role ? `, ${c.role}` : ""}${c.about ? `: ${c.about}` : ""}${c.can ? ` (can use: ${c.can})` : ""}`;
      criteria.none = "No agent should reply.";
      const result = await decide(
        {
          provider: current.provider,
          baseURL: current.baseURL,
          apiKey: current.apiKey,
          runtime: current.runtime,
          timeoutMs: current.timeoutMs,
        },
        {
          model: current.model,
          state: {
            channel: { name: input.channel.name, topic: input.channel.topic || null },
            recent_messages: input.thread.map((m) => ({ from: m.author, names: m.names ?? [], text: m.body })),
            latest_message: {
              from: input.message.author,
              names: input.message.names ?? [],
              text: input.message.body.slice(0, ROUTER_MESSAGE_CHARS),
            },
            agent_just_talking: input.continuityHandle ? `@${input.continuityHandle}` : null,
            alone_with: input.aloneWith ? `@${input.aloneWith}` : null,
            agents_in_channel: input.candidates.map((c) => ({
              handle: `@${c.handle}`,
              name: c.name,
              role: c.role || null,
              about: c.about || null,
              can: c.can ?? null,
            })),
          },
          questions: {
            needs_agent: {
              type: "noul",
              instructions:
                "Should any AI agent reply to latest_message? People in a team chat mostly talk among themselves; an agent answers when the message speaks to an agent by @, name or role, asks the agents or anyone something an agent can help with, or continues a conversation with an agent. When unsure, no.",
              criteria: {
                true: "The message is for an agent or needs one.",
                false: "People talking to each other, or unclear.",
              },
            },
            best_agent: {
              type: "choice",
              instructions: "Which agent is best placed to reply to latest_message?",
              criteria,
            },
            already_answered: {
              type: "noul",
              instructions: "Did another agent already answer latest_message in recent_messages?",
              criteria: { true: "One already answered it.", false: "Nobody answered it yet." },
            },
            for_everyone: {
              type: "noul",
              instructions: "Does latest_message ask every agent in the channel to answer?",
              criteria: { true: "It speaks to every agent.", false: "It speaks to one agent or to nobody." },
            },
            social: {
              type: "choice",
              instructions:
                "Should an agent react to latest_message with one emoji, instead of replying? Choose none when a reply fits.",
              criteria: { none: "No reaction, a reply fits.", ...SOCIAL_REACTIONS },
            },
          },
        },
        options.http,
      );
      await options.gateway
        .recordExternalUsage({
          orgId: input.orgId,
          kind: "router",
          provider: current.provider,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costNanoUsd: decisionCostNanoUsd(current.provider, result.usage.inputTokens),
        })
        .catch(() => {});
      const answers = result.answers;
      if (!answers.needs_agent || !answers.best_agent) throw new RouterOutputError();
      const best = answers.best_agent;
      const probabilities = best?.probabilities ?? {};
      const choice = best?.choice;
      const bestPlaced = choice && choice !== "none" ? input.candidates.find((c) => c.handle === choice) : undefined;
      const addressee = asksAddressee(input) ? bestPlaced?.agentId : undefined;
      const emoji =
        answers.social?.choice && answers.social.choice !== "none" ? socialChoice(answers.social.choice) : null;
      const scored = withAddressee(
        {
          agents: input.candidates.map((c) => ({
            agentId: c.agentId,
            score: clamp(probabilities[c.handle] ?? (choice === c.handle ? 1 : 0)),
          })),
          needsAgent: clamp(answers.needs_agent?.noul),
          alreadyAnswered: clamp(answers.already_answered?.noul),
          forEveryone: clamp(answers.for_everyone?.noul),
        },
        new Map(addressee ? [[addressee, 1]] : []),
      );
      return {
        ...scored,
        ...(bestPlaced ? { best: { agentId: bestPlaced.agentId, confidence: clamp(best?.confidence) } } : {}),
        ...(emoji
          ? { social: { react: true, emoji } }
          : answers.social?.choice === "none"
            ? { social: { react: false, emoji: "" } }
            : {}),
        reason: bestPlaced ? `best @${bestPlaced.handle}` : choice === "none" ? "no agent should reply" : "",
        strategy: "decision",
        decidedBy: { step: "model", model: current.model, provider: current.provider as DecisionProviderId },
      };
    },
  };
}

export { decisionModelLabel };
