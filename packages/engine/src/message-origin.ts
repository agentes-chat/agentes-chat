import { type SQL, schema, sql } from "@agenteschat/db";

const { messages } = schema;
type MessageOrigin = schema.MessageOrigin;

/**
 * The one rule for whose words a message carries (ADR 0250): only text a person typed in our own apps (`app`) and
 * that carries no outside mark is their own. Everything else (posted with a token or by an AI app, bridged from an
 * outside chat, written by the server, written before origins were recorded) is content the agents may read and
 * answer, never the source of a lasting rule, a memory in someone's name, an instruction change, an approval or a
 * permission.
 */
export const ownTyped = (m: {
  authorType: string;
  origin: MessageOrigin | null;
  meta?: Record<string, unknown> | null;
}): boolean => m.authorType === "person" && m.origin === "app" && m.meta?.readOutside !== true;

/** `ownTyped` as SQL, over `messages` or an alias of it (`m`). */
export const ownTypedSql = (alias?: string): SQL => {
  if (!alias) {
    return sql`(${messages.authorType} = 'person' and ${messages.origin} = 'app'
      and coalesce(${messages.meta}->>'readOutside', '') <> 'true')`;
  }
  const m = sql.raw(alias);
  return sql`(${m}.author_type = 'person' and ${m}.origin = 'app' and coalesce(${m}.meta->>'readOutside', '') <> 'true')`;
};

/** Origins that carry text from beyond our apps under a person's name: the prompt marks such a message as relayed. */
const RELAYED: ReadonlySet<MessageOrigin> = new Set(["mcp", "surface"]);

/** A person's message that came through a token, an AI app or a bridge (`RELAYED`). */
export const relayedPersonMessage = (m: { authorType: string; origin: MessageOrigin | null }) =>
  m.authorType === "person" && m.origin != null && RELAYED.has(m.origin);
