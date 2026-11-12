import { LONG_MESSAGE } from "@agenteschat/client/lib/message-length";
import { Button, Dialog, DialogBody } from "@agenteschat/ui";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverflows } from "@/hooks/useOverflows";
import { copyText } from "@/lib/context-menu";
import { useToast } from "@/lib/toast";

/**
 * A message's words in a conversation: one taller than `LONG_MESSAGE.over` (the `.msg-clip` rules) shows its start,
 * faded, with "Ver mais", which opens it whole in a dialog (`text` for its copy button). `children` draws the words
 * with the class it is given on their own root (in the conversation) or with none (in the dialog): no box goes around
 * them, since the bubble's rules read the words as the direct child of the message's text.
 */
export function ClippedBody({
  name,
  text,
  children,
}: {
  name: string;
  text: string;
  children: (className?: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const foot = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = foot.current?.previousElementSibling;
    words.current = el instanceof HTMLElement ? el : null;
  }, []);
  const cut = useOverflows(words, true, LONG_MESSAGE.over);
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(cut ? "msg-clip msg-clip--cut" : "msg-clip")}
      {/* Always there, to find the words by; empty under a message that shows whole, so its text reads as its words alone. */}
      <div ref={foot} className="msg-clip__foot" hidden={!cut}>
        {cut && (
          <button type="button" className="ac-link msg-clip__more" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            {t("channel.long.more")}
          </button>
        )}
      </div>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          title={t("channel.long.title", { name })}
          closeLabel={t("common.close")}
          width={620}
          actions={
            <Button
              variant="ghost"
              size="sm"
              icon="copy"
              onClick={() => void copyText(text, () => toast.show(t("contextMenu.textCopied")))}
            >
              {t("common.copy")}
            </Button>
          }
        >
          <DialogBody className="msg-clip__whole">{children()}</DialogBody>
        </Dialog>
      )}
    </>
  );
}
