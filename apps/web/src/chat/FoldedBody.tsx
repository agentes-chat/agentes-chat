import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageBody } from "@/chat/MessageBody";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useOverflows } from "@/hooks/useOverflows";

/** A long text an agent wrote, on a page rather than in a conversation: its Markdown as a message's, folded until asked. */
export function FoldedBody({ body }: { body: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Only what this width really cuts: the same text may fit whole on a wide page and not on a phone.
  const cut = useOverflows(box, !open);
  return (
    <div className="folded-body">
      <div
        ref={box}
        className="folded-body__text"
        data-folded={open ? undefined : ""}
        data-cut={cut && !open ? "" : undefined}
      >
        <MessageBody body={body} resolveMention={dir.mentionName} mentionTone={dir.mentionTone} />
      </div>
      {cut && (
        <button type="button" className="ac-link folded-body__more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t(open ? "folded.less" : "folded.more")}
        </button>
      )}
    </div>
  );
}
