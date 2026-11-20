// VPS Zen: an agent's own photo, uploaded by its owner or who manages it, shown wherever the agent's face is drawn.
// Kept on the agent's look (`agents.appearance.photo`, jsonb: no migration, so a merge of upstream's migrations
// never collides with ours). The drawn symbol stays the default: without a photo nothing changes.
import type { BlobStore, PubSub } from "@agenteschat/adapters";
import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { AGENT_LOOK, type AgentAppearance } from "./appearance";
import { ownsOrManagesAgent, REACH_COLUMNS } from "./audience";
import { recordAudit } from "./audit";
import { readImage } from "./avatars";
import { caches } from "./cache";
import { ForbiddenError, NotFoundError } from "./errors";
import { publishAgentsChanged } from "./events";
import { getMembership, requirePermission } from "./organizations";

const { agents } = schema;

/** `/api/app/agent-photos/{orgId}/{agentId}/{hash}.{ext}`: the only address `appearance.photo` may hold. */
export const AGENT_PHOTO_PATH = /^\/api\/app\/agent-photos\/([^/]+)\/([^/]+)\/([0-9a-f]{16}\.(jpg|png|webp))$/;

/** The look a photo is stored on when the agent had none: the blank one, so the editors still read every part. */
const BLANK: AgentAppearance = { color: AGENT_LOOK.colors[0], eyes: AGENT_LOOK.eyes[0], accessory: "none" };

async function photoTarget(db: Database, actorId: string, orgId: string, agentId: string) {
  const membership = await requirePermission(db, actorId, orgId, "read");
  const [agent] = await db
    .select({ archivedAt: agents.archivedAt, appearance: agents.appearance, ...REACH_COLUMNS })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId), isNull(agents.deletedAt)));
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found");
  if (!ownsOrManagesAgent(agent, actorId, membership))
    throw new ForbiddenError("Only the agent's owner or an admin can change its photo");
  return agent.appearance as (AgentAppearance & { photo?: string }) | null;
}

async function storeLook(
  deps: { db: Database; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
  look: (AgentAppearance & { photo?: string }) | null,
  action: "agent.photo_changed" | "agent.photo_removed",
) {
  await deps.db
    .update(agents)
    .set({ appearance: look, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)));
  caches.agents.delete(`${orgId}:${agentId}`);
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorId },
    action,
    target: { type: "agent", id: agentId },
  });
  await publishAgentsChanged(deps.pubsub, orgId);
}

async function removeStored(
  blobs: BlobStore,
  orgId: string,
  agentId: string,
  photo: string | undefined,
  keep: string | null,
) {
  const m = photo ? AGENT_PHOTO_PATH.exec(photo) : null;
  if (!m || m[1] !== orgId || m[2] !== agentId || m[3] === keep) return;
  await blobs.delete(`agent-photos/${orgId}/${agentId}/${m[3]}`).catch(() => undefined);
}

/**
 * Sets an agent's photo (`PUT …/organizations/{orgId}/agents/{agentId}/photo`): same checks as a person's photo
 * (`readImage`: sniffed type, 2 MB, metadata stripped), the file named by its content hash. Audited.
 */
export async function setAgentPhoto(
  deps: { db: Database; blobs: BlobStore; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
  input: { imageBase64: string; contentType: string },
): Promise<{ photo: string }> {
  const before = await photoTarget(deps.db, actorId, orgId, agentId);
  const { body, type, file } = readImage(input, "avatar");
  await deps.blobs.put(`agent-photos/${orgId}/${agentId}/${file}`, body, { contentType: type });
  const photo = `/api/app/agent-photos/${orgId}/${agentId}/${file}`;
  const { photo: old, ...look } = before ?? BLANK;
  await storeLook(deps, actorId, orgId, agentId, { ...BLANK, ...look, photo }, "agent.photo_changed");
  await removeStored(deps.blobs, orgId, agentId, old, file);
  return { photo };
}

/** Removes an agent's photo (`DELETE …/agents/{agentId}/photo`): back to its drawn face. Audited. */
export async function removeAgentPhoto(
  deps: { db: Database; blobs: BlobStore; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
) {
  const before = await photoTarget(deps.db, actorId, orgId, agentId);
  if (!before?.photo) return;
  const { photo, ...look } = before;
  await storeLook(deps, actorId, orgId, agentId, look as AgentAppearance, "agent.photo_removed");
  await removeStored(deps.blobs, orgId, agentId, photo, null);
}

/** The stored photo for `GET /api/app/agent-photos/{orgId}/{agentId}/{file}`: the workspace's members only. */
export async function agentPhotoFile(
  deps: { db: Database; blobs: BlobStore },
  viewerId: string,
  orgId: string,
  agentId: string,
  file: string,
) {
  if (!/^[0-9a-f]{16}\.(jpg|png|webp)$/.test(file) || !/^[0-9a-f-]{36}$/.test(agentId))
    throw new NotFoundError("Not found");
  if (!(await getMembership(deps.db, viewerId, orgId))) throw new NotFoundError("Not found");
  const object = await deps.blobs.get(`agent-photos/${orgId}/${agentId}/${file}`);
  if (!object) throw new NotFoundError("Not found");
  return object;
}
