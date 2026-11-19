import { isAbsolute } from "node:path";
import { and, eq, isNull, schema } from "@agenteschat/db";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { ValidationError } from "../errors";
import { isAgentesCloud } from "../telemetry";
import { type ConnectorDeps, openConnectionSecret } from "./connections";
import { type McpConnect, type McpSession, mcpSessionOver } from "./mcp";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes("\0"), "Must not contain NUL");

/** Arguments stay separate: no shell interpolation and no inherited server secrets. */
export const stdioConfigSchema = z
  .object({
    command: text(2000)
      .min(1)
      .refine((v) => v === v.trim(), "Use the executable, without surrounding spaces"),
    args: z.array(text(8000)).max(128).default([]),
    cwd: text(4000).refine(isAbsolute, "Use an absolute directory on the server").optional(),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), text(16000))
      .refine((v) => Object.keys(v).length <= 100, "At most 100 environment variables")
      .default({}),
  })
  .strict();

export type StdioMcpConfig = z.infer<typeof stdioConfigSchema>;

/** Running programs is the installation operator's decision, never enabled by a workspace or an agent. */
export function allowsStdioMcp(config: { MCP_STDIO_ENABLED?: boolean; PUBLIC_URL: string; ALLOW_SIGNUP?: boolean }) {
  return config.MCP_STDIO_ENABLED === true && !config.ALLOW_SIGNUP && !isAgentesCloud(config.PUBLIC_URL);
}

export function requireStdioMcp(allowed: boolean | undefined) {
  if (!allowed)
    throw new ValidationError("Local MCP processes are disabled on this server", "connector.stdio_disabled");
}

export function parseStdioConfig(input: unknown): StdioMcpConfig {
  const parsed = stdioConfigSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError("Check the command, arguments, directory and environment", "connector.stdio_invalid");
  return parsed.data;
}

export function isStdioMcp(url: string) {
  return /^stdio:\/\/[0-9a-f-]{36}\/?$/i.test(url);
}

/** A session owns its child process; the same lifecycle applies to listing, calls and failed initialize. */
export async function connectOverStdio(config: StdioMcpConfig, timeout = 15_000): Promise<McpSession> {
  const transport = new StdioClientTransport({
    ...parseStdioConfig(config),
    stderr: "pipe",
    maxBufferSize: 8 * 1024 * 1024,
  });
  // The SDK may close asynchronously on an initialize timeout. Join that same close instead of
  // returning from a second close while its child is still being terminated.
  const close = transport.close.bind(transport);
  let closing: Promise<void> | undefined;
  transport.close = () => (closing ??= close());
  // Drain diagnostics without retaining or logging them: stderr can contain credentials.
  transport.stderr?.on("data", () => {});
  try {
    return await mcpSessionOver(transport, timeout);
  } catch {
    await transport.close().catch(() => {});
    throw new ValidationError("The local MCP process could not start or answer initialize", "connector.stdio_failed");
  }
}

/** Resolve the active organization's encrypted configuration at every session, including after revocation. */
export function withStdioMcp(
  deps: Pick<ConnectorDeps, "db" | "keyWrappers" | "stdioAllowed">,
  remote: McpConnect,
): McpConnect {
  return async (connection, headers) => {
    if (!connection.serverUrl.startsWith("stdio:")) return remote(connection, headers);
    requireStdioMcp(deps.stdioAllowed);
    if (!isStdioMcp(connection.serverUrl) || !connection.orgId)
      throw new ValidationError("Invalid local MCP connection", "connector.stdio_invalid");
    const [stored] = await deps.db
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, connection.orgId),
          eq(schema.connectorConnections.serverUrl, connection.serverUrl),
          eq(schema.connectorConnections.authType, "stdio"),
          eq(schema.connectorConnections.status, "active"),
          isNull(schema.connectorConnections.revokedAt),
        ),
      )
      .limit(1);
    if (!stored) throw new ValidationError("Local MCP connection is unavailable", "connector.stdio_unavailable");
    const secret = await openConnectionSecret(deps.keyWrappers, stored);
    return connectOverStdio(parseStdioConfig(secret?.stdio));
  };
}
