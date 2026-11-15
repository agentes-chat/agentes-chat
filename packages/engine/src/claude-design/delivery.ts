import { and, type Executor, eq, schema } from "@agenteschat/db";

/** Work/session roots are not reply locations. Preserve the original message's actual thread, including null. */
export async function designReplyThreadId(
  db: Executor,
  job: Pick<typeof schema.claudeDesignJobs.$inferSelect, "orgId" | "channelId" | "triggerMessageId" | "threadRootId">,
): Promise<string | null> {
  const [message] = await db
    .select({ threadId: schema.messages.threadId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.orgId, job.orgId),
        eq(schema.messages.channelId, job.channelId),
        eq(schema.messages.id, job.triggerMessageId),
      ),
    );
  return message ? message.threadId : job.threadRootId;
}
