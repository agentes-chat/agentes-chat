import { and, eq, inArray, schema } from "@agenteschat/db";
import { type ArtifactDeps, type ArtifactDetailView, getArtifact } from "./artifacts";
import { UUID } from "./authority";
import { type BlockStateView, getBlockState } from "./block-state";
import { type ChoicesView, getChoices, getPoll, type PollView } from "./blocks";

/** What the apps draw as a card in the conversation, not as a file's tile: its size depends on what it holds. */
const CARD_KINDS = ["block", "poll", "choices"] as const;
/** A page's cards at most: a page of messages carries a few. */
const MAX_CARDS = 40;

export interface MessageCards {
  artifacts: ArtifactDetailView[];
  polls: PollView[];
  choices: ChoicesView[];
  blocks: BlockStateView[];
}

/**
 * What a page of messages needs to draw its cards whole on the first paint (`include=cards`, one round trip): each
 * live block, vote and question card the messages carry (`meta.artifacts`), at the version they show, with the
 * block's state, the vote's marks and the card's answer. One the person can't read is left out: its card asks for it
 * and says so, as before.
 */
export async function messageCards(
  deps: ArtifactDeps,
  userId: string,
  orgId: string,
  messages: { meta?: Record<string, unknown> | null }[],
): Promise<MessageCards> {
  const shown = new Map<string, { id: string; version: number }>();
  for (const m of messages) {
    const refs = m.meta?.artifacts;
    if (!Array.isArray(refs)) continue;
    for (const r of refs as { id?: unknown; version?: unknown; deleted?: unknown }[]) {
      if (typeof r?.id !== "string" || !UUID.test(r.id) || typeof r.version !== "number" || r.deleted === true)
        continue;
      shown.set(`${r.id}@${r.version}`, { id: r.id, version: r.version });
    }
  }
  const out: MessageCards = { artifacts: [], polls: [], choices: [], blocks: [] };
  if (shown.size === 0) return out;
  const rows = await deps.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.orgId, orgId),
        inArray(schema.artifacts.id, [...new Set([...shown.values()].map((r) => r.id))]),
        inArray(schema.artifacts.kind, [...CARD_KINDS]),
      ),
    );
  const cards = new Set(rows.map((r) => r.id));
  const person = { type: "person" as const, userId };
  const wanted = [...shown.values()].filter((r) => cards.has(r.id)).slice(0, MAX_CARDS);
  await Promise.all(
    wanted.map(async ({ id, version }) => {
      try {
        const a = await getArtifact(deps, person, orgId, id, version);
        if (a.kind === "poll") out.polls.push(await getPoll(deps, userId, orgId, id));
        if (a.kind === "choices") out.choices.push(await getChoices(deps, userId, orgId, id));
        if (a.kind === "block") out.blocks.push(await getBlockState(deps, userId, orgId, id, version));
        out.artifacts.push(a);
      } catch {
        // Not readable by this person (or gone): its card loads on its own and says so.
      }
    }),
  );
  return out;
}
