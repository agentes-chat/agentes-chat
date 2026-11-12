import { createAnthropicProvider } from "./anthropic";
import { createOpenRouterProvider } from "./openrouter";
import { type ModelProvider, type ModelResult, ProviderError } from "./types";

/**
 * Command Code's Provider API (commandcode.ai/docs/provider-api, read 2026-11-12): one key, many makers' models, at
 * each maker's API rates. Claude answers only on Anthropic Messages (`/v1/messages`), every other model only on Chat
 * Completions (`/v1/chat/completions`): the wrong route answers 400. `/v1/models` names each model's routes in
 * `supported_endpoints`, but no prices, so the catalog carries the models it offers (`catalog.ts`).
 */
export const COMMANDCODE_API = "https://api.commandcode.ai/provider";

/** Command Code's models in the catalog: `commandcode:<its own id>`, so a Claude or GPT id it shares stays apart. */
const PREFIX = "commandcode:";

export const isCommandCodeModel = (id: string) => id.startsWith(PREFIX) && id.length > PREFIX.length;

/** The id Command Code knows a catalog model by; null for any other id. */
export const commandCodeModelOf = (id: string) => (isCommandCodeModel(id) ? id.slice(PREFIX.length) : null);

/** Claude's models are served on Anthropic Messages alone. */
const onMessages = (model: string) => model.startsWith("claude-");

/**
 * The adapter for Command Code's models: Claude through Anthropic's adapter in its compatible mode (it honors
 * `tool_choice: any`, so structured output is a forced tool), the rest through the Chat Completions one OpenRouter
 * uses, in its compatible mode. Its own id is sent and the full `commandcode:` id comes back, so the catalog prices
 * the call at Command Code's rates.
 */
export function createCommandCodeProvider(options: { fetch?: typeof fetch; maxRetries?: number } = {}): ModelProvider {
  const messages = createAnthropicProvider({
    id: "commandcode",
    baseURL: COMMANDCODE_API,
    compat: { toolChoiceAny: true },
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
  const chat = createOpenRouterProvider({
    compatible: { id: "commandcode", baseURL: `${COMMANDCODE_API}/v1` },
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
  return {
    id: "commandcode",
    async stream(request, streamOptions): Promise<ModelResult> {
      const model = commandCodeModelOf(request.model);
      if (!model) throw new ProviderError(`${request.model} isn't one of Command Code's models`, false);
      const inner = onMessages(model) ? messages : chat;
      const { costNanoUsd: _reported, ...result } = await inner.stream({ ...request, model }, streamOptions);
      return { ...result, model: request.model };
    },
  };
}
