import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { authorizeClaudeDesign, getClaudeDesignGrant, setClaudeDesignGrant } from "../src/claude-design/access";
import { type DesignFixture, designFixture } from "./claude-design-fixtures";
import { addMember } from "./fixtures";

let f: DesignFixture;
afterEach(async () => {
  await f?.close();
});
test("only an account owner who administers the agent grants Design; cross-org and foreign ownership refuse", async () => {
  f = await designFixture();
  const member = await addMember(f.db, f.org.id, "member", "member");
  await expect(setClaudeDesignGrant(f.designDeps, member.id, f.org.id, f.agent.id, f.accountId)).rejects.toThrow();
  await expect(
    setClaudeDesignGrant(f.designDeps, f.owner.id, crypto.randomUUID(), f.agent.id, f.accountId),
  ).rejects.toThrow();
  await f.db
    .update(schema.machineAccounts)
    .set({ createdBy: member.id })
    .where(eq(schema.machineAccounts.id, f.accountId));
  await expect(setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId)).rejects.toThrow();
});
test("grant authorizes only the owner's DM and a live verified account", async () => {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  expect((await authorizeClaudeDesign(f.designDeps, f.ctx, "create")).accountId).toBe(f.accountId);
  await expect(authorizeClaudeDesign(f.designDeps, { ...f.ctx, channelId: f.general.id }, "create")).rejects.toThrow();
  await expect(authorizeClaudeDesign({ ...f.designDeps, enabled: false }, f.ctx, "create")).rejects.toThrow();
  await f.db
    .update(schema.machineAccounts)
    .set({ authMethod: "setup_token" })
    .where(eq(schema.machineAccounts.id, f.accountId));
  await expect(authorizeClaudeDesign(f.designDeps, f.ctx, "create")).rejects.toThrow();
});
test("revocation bumps the grant revision and invalidates authority", async () => {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  const before = await authorizeClaudeDesign(f.designDeps, f.ctx, "create");
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, null);
  await expect(authorizeClaudeDesign(f.designDeps, f.ctx, "create")).rejects.toThrow();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  expect((await authorizeClaudeDesign(f.designDeps, f.ctx, "create")).grantRevision).toBeGreaterThan(
    before.grantRevision,
  );
});

test("candidate availability is checked on the backend before granting, without trusting plan labels", async () => {
  f = await designFixture();
  const { getClaudeDesignGrant } = await import("../src/claude-design/access");
  expect(await getClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId)).toMatchObject({
    enabled: false,
    available: true,
    accountId: null,
    reason: null,
  });
  await f.db
    .update(schema.machineAccounts)
    .set({ authMethod: "setup_token" })
    .where(eq(schema.machineAccounts.id, f.accountId));
  expect(await getClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId)).toMatchObject({
    enabled: false,
    available: false,
    reason: "unsupported",
  });
});

test("generic permission cards never offer the owner-only Design account grant", async () => {
  f = await designFixture();
  await f.db.delete(schema.agentScopes).where(eq(schema.agentScopes.agentId, f.agent.id));
  const { missingPermissions } = await import("../src/tools/permission");
  const missing = await missingPermissions(f.ctx);
  expect(missing.some((p) => p.id === "sandbox:run")).toBe(true);
  expect(missing.some((p) => p.id.startsWith("claude-design:"))).toBe(false);
});

test("upstream runners 65, 66 and 67 cannot grant or execute Design; protocol 68 can", async () => {
  f = await designFixture();
  await setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId);
  for (const protocol of [65, 66, 67]) {
    await f.db.update(schema.machines).set({ protocol }).where(eq(schema.machines.id, f.machineId));
    expect(await getClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId)).toMatchObject({
      available: false,
      reason: "unsupported",
    });
    await expect(setClaudeDesignGrant(f.designDeps, f.owner.id, f.org.id, f.agent.id, f.accountId)).rejects.toThrow();
    await expect(authorizeClaudeDesign(f.designDeps, f.ctx, "create")).rejects.toThrow();
  }
  await f.db.update(schema.machines).set({ protocol: 68 }).where(eq(schema.machines.id, f.machineId));
  expect((await authorizeClaudeDesign(f.designDeps, f.ctx, "create")).accountId).toBe(f.accountId);
});
