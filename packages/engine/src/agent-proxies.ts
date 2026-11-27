import type { KeyWrapper, PubSub } from "@agenteschat/adapters";
import {
  CUSTOM_PROXY_PROTOCOL,
  type MachineReplies,
  type MachineRequest,
} from "@agenteschat/adapters/machine-protocol";
import {
  type ProxyAddress,
  ProxyDialError,
  parseProxyUrl,
  proxyExit,
  proxyLabel,
  proxyUrlOf,
} from "@agenteschat/adapters/proxy-dial";
import { and, type Database, eq, gte, isNull, schema } from "@agenteschat/db";
import { recordAudit } from "./audit";
import { openSecret, sealSecret } from "./crypto";
import { publishDevicesChanged } from "./devices";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getMachine } from "./machines";
import { assertPublicHttpsUrl, type ResolveHost } from "./net-guard";
import { can, requirePermission } from "./organizations";

const { agentProxies, machines } = schema;

export type AgentProxyRow = typeof agentProxies.$inferSelect;

/** What the apps see of a proxy: never its user or password. */
export interface AgentProxyView {
  /** `socks5://host:1080`. */
  label: string;
  scheme: ProxyAddress["scheme"];
  host: string;
  port: number;
  hasAuth: boolean;
  updatedAt: string;
}

/** The workspace's proxy and each computer's own (by id), as the apps show them. */
export interface AgentProxies {
  workspace: AgentProxyView | null;
  computers: Record<string, AgentProxyView>;
}

export interface AgentProxyDeps {
  db: Database;
  keyWrappers: KeyWrapper[];
  pubsub?: PubSub;
  /** The computers' sockets: a change reaches the ones online at once (`proxy.set`); the rest get it in `welcome`. */
  hub?: {
    call(
      machineId: string,
      request: Extract<MachineRequest, { op: "proxy.set" }>,
      options?: { timeoutMs?: number },
    ): Promise<MachineReplies["proxy.set"]>;
  };
  resolveHost?: ResolveHost;
  /** Tests: where the proxy test's connection goes. */
  exit?: (proxy: ProxyAddress) => Promise<{ ip: string; country: string | null }>;
}

const aad = (orgId: string, id: string) => `agent-proxy|${orgId}|${id}`;

const viewOf = (r: AgentProxyRow): AgentProxyView => ({
  label: proxyLabel(r),
  scheme: r.scheme,
  host: r.host,
  port: r.port,
  hasAuth: r.hasAuth,
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * A proxy address as a person typed it, checked: one we speak (HTTP, HTTPS or SOCKS5), on a public host (as an MCP
 * server's is: never this server's own network, unless its operator allowed the range).
 */
export async function checkProxyUrl(raw: string, resolve?: ResolveHost): Promise<ProxyAddress> {
  const proxy = parseProxyUrl(raw);
  if (!proxy) {
    throw new ValidationError(
      "Use a proxy address like socks5://user:password@host:1080 or http://host:3128",
      "proxy.invalid",
    );
  }
  const host = proxy.host.includes(":") ? `[${proxy.host}]` : proxy.host;
  await assertPublicHttpsUrl(`https://${host}:${proxy.port}/`, resolve);
  return proxy;
}

/** Who sets a proxy: the workspace's, who configures it; a computer's, also the person who connected it. */
async function mayChange(db: Database, actorId: string, orgId: string, machineId: string | null) {
  const membership = await requirePermission(db, actorId, orgId, "read");
  if (machineId === null) {
    if (!can(membership, "configure")) {
      throw new ForbiddenError("Only who configures the workspace sets its agents' proxy", "proxy.forbidden");
    }
    return;
  }
  const machine = await getMachine(db, orgId, machineId);
  if (!machine || machine.deletedAt) throw new NotFoundError("Computer not found");
  if (machine.pairedByUserId !== actorId && !can(membership, "configure")) {
    throw new ForbiddenError("Only who connected this computer, or an admin, sets its proxy", "proxy.forbidden");
  }
}

export async function listAgentProxies(db: Database, actorId: string, orgId: string): Promise<AgentProxies> {
  await requirePermission(db, actorId, orgId, "read");
  const rows = await db.select().from(agentProxies).where(eq(agentProxies.orgId, orgId));
  const workspace = rows.find((r) => r.machineId === null);
  return {
    workspace: workspace ? viewOf(workspace) : null,
    computers: Object.fromEntries(rows.filter((r) => r.machineId).map((r) => [r.machineId as string, viewOf(r)])),
  };
}

/**
 * The proxy a computer's agents use now, user and password included (for its runner only): its own, else the
 * workspace's; null for none, or a row that can't be opened.
 */
export async function proxyForMachine(
  deps: Pick<AgentProxyDeps, "db" | "keyWrappers">,
  machine: { id: string; orgId: string },
): Promise<string | null> {
  const rows = await deps.db.select().from(agentProxies).where(eq(agentProxies.orgId, machine.orgId));
  const row = rows.find((r) => r.machineId === machine.id) ?? rows.find((r) => r.machineId === null);
  if (!row) return null;
  return openSecret(
    deps.keyWrappers,
    { ciphertext: row.secretCiphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId },
    aad(row.orgId, row.id),
  ).catch(() => null);
}

/** Tells the computers it changed for (one, or every one of the workspace's without its own) what they use now. */
async function pushToComputers(deps: AgentProxyDeps, orgId: string, machineId: string | null) {
  if (!deps.hub) return;
  const targets = await deps.db
    .select({ id: machines.id, orgId: machines.orgId })
    .from(machines)
    .where(
      and(
        eq(machines.orgId, orgId),
        isNull(machines.deletedAt),
        gte(machines.protocol, CUSTOM_PROXY_PROTOCOL),
        machineId ? eq(machines.id, machineId) : undefined,
      ),
    );
  const own = machineId
    ? new Set<string>()
    : new Set(
        (await deps.db.select({ m: agentProxies.machineId }).from(agentProxies).where(eq(agentProxies.orgId, orgId)))
          .map((r) => r.m)
          .filter((m): m is string => !!m),
      );
  await Promise.all(
    targets
      .filter((m) => !own.has(m.id))
      .map(async (m) => {
        const url = await proxyForMachine(deps, m);
        // Offline or older: its next `welcome` says it.
        await deps.hub?.call(m.id, { op: "proxy.set", url }, { timeoutMs: 5_000 }).catch(() => undefined);
      }),
  );
}

/** Sets the workspace's proxy (`machineId` null) or a computer's, replacing the one it had. */
export async function setAgentProxy(
  deps: AgentProxyDeps,
  actorId: string,
  orgId: string,
  input: { machineId: string | null; url: string },
): Promise<AgentProxyView> {
  await mayChange(deps.db, actorId, orgId, input.machineId);
  const proxy = await checkProxyUrl(input.url, deps.resolveHost);
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  const sealed = await sealSecret(wrapper, proxyUrlOf(proxy), aad(orgId, id));
  const row = await deps.db.transaction(async (tx) => {
    await tx
      .delete(agentProxies)
      .where(
        and(
          eq(agentProxies.orgId, orgId),
          input.machineId ? eq(agentProxies.machineId, input.machineId) : isNull(agentProxies.machineId),
        ),
      );
    const [inserted] = await tx
      .insert(agentProxies)
      .values({
        id,
        orgId,
        machineId: input.machineId,
        scheme: proxy.scheme,
        host: proxy.host,
        port: proxy.port,
        hasAuth: Boolean(proxy.username),
        secretCiphertext: sealed.ciphertext,
        wrappedDataKey: sealed.wrappedDataKey,
        kekId: sealed.kekId,
        createdByUserId: actorId,
      })
      .returning();
    if (!inserted) throw new Error("proxy insert returned nothing");
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorId },
      action: "proxy.set",
      target: input.machineId ? { type: "machine", id: input.machineId } : { type: "organization", id: orgId },
      details: { proxy: proxyLabel(proxy), hasAuth: Boolean(proxy.username) },
    });
    return inserted;
  });
  await pushToComputers(deps, orgId, input.machineId);
  await publishDevicesChanged(deps.pubsub, orgId);
  return viewOf(row);
}

export async function removeAgentProxy(
  deps: AgentProxyDeps,
  actorId: string,
  orgId: string,
  machineId: string | null,
): Promise<void> {
  await mayChange(deps.db, actorId, orgId, machineId);
  const gone = await deps.db
    .delete(agentProxies)
    .where(
      and(
        eq(agentProxies.orgId, orgId),
        machineId ? eq(agentProxies.machineId, machineId) : isNull(agentProxies.machineId),
      ),
    )
    .returning({ id: agentProxies.id });
  if (gone.length === 0) return;
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "proxy.removed",
    target: machineId ? { type: "machine", id: machineId } : { type: "organization", id: orgId },
  });
  await pushToComputers(deps, orgId, machineId);
  await publishDevicesChanged(deps.pubsub, orgId);
}

/** What a proxy test found: where agents come out, or why it didn't get through (in words for the apps). */
export type ProxyTest =
  | { ok: true; ip: string; country: string | null }
  | { ok: false; reason: "unreachable" | "auth" | "refused" };

/**
 * Tests a proxy from this server: one request through it to a public address echo. `url` tests what a person typed
 * before saving; without it, the saved one of the workspace or the computer.
 */
export async function testAgentProxy(
  deps: AgentProxyDeps,
  actorId: string,
  orgId: string,
  input: { machineId: string | null; url?: string },
): Promise<ProxyTest> {
  await mayChange(deps.db, actorId, orgId, input.machineId);
  let raw = input.url;
  if (!raw) {
    const [row] = await deps.db
      .select()
      .from(agentProxies)
      .where(
        and(
          eq(agentProxies.orgId, orgId),
          input.machineId ? eq(agentProxies.machineId, input.machineId) : isNull(agentProxies.machineId),
        ),
      );
    if (!row) throw new NotFoundError("No proxy is set here");
    raw = await openSecret(
      deps.keyWrappers,
      { ciphertext: row.secretCiphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId },
      aad(row.orgId, row.id),
    );
  }
  const proxy = await checkProxyUrl(raw, deps.resolveHost);
  try {
    const exit = await (deps.exit ?? proxyExit)(proxy);
    return { ok: true, ...exit };
  } catch (error) {
    return { ok: false, reason: error instanceof ProxyDialError ? error.reason : "unreachable" };
  }
}
