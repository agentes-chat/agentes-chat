import type { Message } from "@agenteschat/client";
import { sendHelpers, useChannels, usePostMessage } from "@agenteschat/client";
import { Button, Dialog, DialogBody, DialogFooter, Select, Textarea } from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

/**
 * "Nova thread": a thread is a reply chain under a message of the channel, so starting one posts the message that
 * opens the subject (the composer's own send: optimistic, retried) and hands it back once the server has it, for the
 * caller to open its thread with the reply field in focus. Its words are the thread's title until someone renames it.
 */
function useStartThread(channelId: string, onStarted: (message: Message, channelId: string) => void) {
  const { org, me } = useOrg();
  const post = usePostMessage(org.id, channelId, {
    me: { id: me.user.id },
    onSent: (message) => onStarted(message, channelId),
  });
  return { start: (body: string) => sendHelpers(post).send(body), pending: post.isPending, failed: post.isError };
}

/** The subject's field: one sentence, Enter starts it (Shift+Enter a new line). */
function SubjectField({
  value,
  onChange,
  onSubmit,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="ac-field">
      <label className="ac-field__label" htmlFor={id}>
        {t("threads.new.subject")}
      </label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        autoFocus={autoFocus}
        placeholder={t("threads.new.placeholder")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}

/** Inside a channel's threads popover: the channel is known, the thread opens in the panel beside it. */
export function NewThreadInline({
  channelId,
  onStarted,
  onCancel,
}: {
  channelId: string;
  onStarted: (message: Message) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const { start, pending, failed } = useStartThread(channelId, (m) => onStarted(m));
  const submit = () => {
    if (body.trim() && !pending) start(body.trim());
  };
  return (
    <form
      className="thread-new"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SubjectField value={body} onChange={setBody} onSubmit={submit} autoFocus />
      {failed && (
        <p className="ac-field__error" role="alert">
          {t("threads.new.failed")}
        </p>
      )}
      <div className="thread-new__acts">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={pending} disabled={!body.trim() || pending}>
          {t("threads.new.start")}
        </Button>
      </div>
    </form>
  );
}

/** From the Threads page: the person picks the channel (one they are in), the thread opens on the page. */
export function NewThreadDialog({
  open,
  onOpenChange,
  initialChannelId,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialChannelId?: string | null;
  onStarted: (message: Message) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const channels = (useChannels(org.id).data ?? []).filter((c) => c.isMember);
  const [picked, setPicked] = useState<string | null>(null);
  const channelId =
    picked ?? (channels.some((c) => c.id === initialChannelId) ? initialChannelId : channels[0]?.id) ?? "";
  const [body, setBody] = useState("");
  const { start, pending, failed } = useStartThread(channelId, (m) => {
    setBody("");
    onOpenChange(false);
    onStarted(m);
  });
  const submit = () => {
    if (channelId && body.trim() && !pending) start(body.trim());
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("threads.new.title")}
      description={t("threads.new.text")}
      closeLabel={t("common.close")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <DialogBody>
          <div className="ac-field">
            <span className="ac-field__label">{t("threads.new.channel")}</span>
            <Select
              aria-label={t("threads.new.channel")}
              value={channelId || undefined}
              onValueChange={setPicked}
              options={channels.map((c) => ({ value: c.id, label: `# ${c.name}` }))}
            />
          </div>
          <SubjectField value={body} onChange={setBody} onSubmit={submit} autoFocus />
          {failed && (
            <p className="ac-field__error" role="alert">
              {t("threads.new.failed")}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={pending} disabled={!channelId || !body.trim() || pending}>
            {t("threads.new.start")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
