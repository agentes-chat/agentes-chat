import { type OrgSettings, useAskAdmins, useMe, useSpeechKey } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { voiceSetupAsk } from "@agenteschat/client/lib/voice";
import { Button, Dialog, DialogBody, DialogFooter } from "@agenteschat/ui";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { SpeechProviderPicker } from "@/components/VoiceSettings";
import { voiceSetupSeen } from "@/lib/storage";
import { useToast } from "@/lib/toast";

type Answer = boolean | "tap";

/**
 * The first press of the microphone where voice doesn't become text yet (`speechState` other than `ready`): the
 * server's owner chooses what turns it into text, everyone else asks them or records anyway (the note goes as audio).
 * Once per person on this browser; later presses record at once. `ask` is the composer's `allowed`: it answers when
 * the person picks.
 */
export function useVoiceSetup(settings: OrgSettings | undefined) {
  const me = useMe().data?.user.id ?? null;
  const [open, setOpen] = useState(false);
  const answer = useRef<((a: Answer) => void) | null>(null);
  const fresh = voiceSetupSeen.useFresh(me ?? "");
  const needed = voiceSetupAsk(settings, me, fresh);
  const ask = useCallback((): Promise<Answer> => {
    if (!needed) return Promise.resolve(true);
    setOpen(true);
    return new Promise((resolve) => {
      answer.current = resolve;
    });
  }, [needed]);
  const close = (a: Answer) => {
    setOpen(false);
    if (me) voiceSetupSeen.mark(me);
    answer.current?.(a);
    answer.current = null;
  };
  const dialog = (
    <VoiceSetupDialog
      open={open}
      owner={needed?.owner ?? null}
      isOwner={needed?.isOwner ?? false}
      onRecord={() => close("tap")}
      onDone={() => close(false)}
      onClose={() => {
        setOpen(false);
        answer.current?.(false);
        answer.current = null;
      }}
    />
  );
  return { ask, dialog };
}

export function VoiceSetupDialog({
  open,
  owner,
  isOwner,
  onRecord,
  onDone,
  onClose,
}: {
  open: boolean;
  owner: { userId: string; name: string } | null;
  isOwner: boolean;
  /** Record now: the note goes, with words once something turns voice into text. */
  onRecord: () => void;
  /** Answered without recording (asked the owner): later presses record at once. */
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const askOwner = useAskAdmins(org.id);
  const speech = useSpeechKey();
  const [ready, setReady] = useState(false);
  const view = isOwner ? speech.data : null;
  if (isOwner) {
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={t(ready ? "voice.setup.readyTitle" : "voice.setup.ownerTitle")}
        description={t(ready ? "voice.setup.readyText" : "voice.setup.ownerText")}
        closeLabel={t("common.close")}
        width={600}
      >
        {!ready && view && (
          <DialogBody>
            <SpeechProviderPicker view={view} onSaved={() => setReady(true)} />
          </DialogBody>
        )}
        <DialogFooter>
          {ready ? (
            <Button variant="primary" icon="mic" onClick={onRecord}>
              {t("voice.setup.record")}
            </Button>
          ) : (
            <Button onClick={onRecord}>{t("voice.setup.recordAnyway")}</Button>
          )}
        </DialogFooter>
      </Dialog>
    );
  }
  const name = owner?.name ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("voice.setup.memberTitle")}
      description={name ? t("voice.setup.memberText", { name }) : t("voice.setup.memberTextNoName")}
      closeLabel={t("common.close")}
      width={440}
    >
      <DialogFooter>
        {name && (
          <Button
            loading={askOwner.isPending}
            onClick={() =>
              askOwner.mutate(
                { what: "voice" },
                {
                  onSuccess: () => {
                    toast.show(t("voice.setup.asked", { name }));
                    onDone();
                  },
                  onError: (e) => toast.show(errorText(t, e), "error"),
                },
              )
            }
          >
            {t("voice.setup.ask", { name })}
          </Button>
        )}
        <Button variant="primary" icon="mic" onClick={onRecord}>
          {t("voice.setup.recordAnyway")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
