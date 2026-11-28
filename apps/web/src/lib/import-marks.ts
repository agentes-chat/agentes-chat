import type { ImportCard } from "@agenteschat/client/lib/import/flow";

/**
 * Each card's tile: the app's official mark (apps/web/public/brands/README.md), and the maker's own dark
 * coloring where the mark would vanish on a dark theme. A module of its own, with no reader of the import's in it: the
 * onboarding's work step shows three of them without loading the import (its parsers, the archive reader).
 */
export const CARD_MARK: Record<Exclude<ImportCard, "other">, { icon: string; dark?: string }> = {
  "grok-bot": { icon: "/brands/grok-bot.svg", dark: "/brands/grok-bot-dark.svg" },
  "chatgpt-dots": { icon: "/brands/chatgpt-dots.svg" },
  openbotrun: { icon: "/brands/openbotrun.svg" },
  openmausbot: { icon: "/brands/openmausbot.svg" },
  hermes: { icon: "/brands/hermes.svg", dark: "/brands/hermes-dark.svg" },
  openclaw: { icon: "/brands/openclaw.svg" },
  paperclip: { icon: "/brands/paperclip.svg", dark: "/brands/paperclip-dark.svg" },
  agenteschat: { icon: "/favicon.svg" },
};
