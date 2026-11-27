import { View } from "react-native";
import { EventPillAction, EventPillText, type IconName, Text } from "@/ui";
import { AskDone, AskWaiting } from "../chat/asks";

/**
 * One offer as a waiting pill: its title, the action (tinted) for who may take it, else who may in the text under it
 * and `ask` (one tap to ask them); the agent's why and the detail (an address, names) under the pill too. Done, a
 * decided request's pill, `doneNote` under it.
 */
export function OfferShell({
  icon,
  title,
  why,
  detail,
  done,
  action,
  onAction,
  blocked,
  ask,
  doneNote,
}: {
  icon: IconName;
  title: string;
  why: string;
  detail?: string;
  done: string | null;
  action: string | null;
  onAction: () => void;
  blocked: string;
  ask?: { label: string; onPress: () => void; disabled: boolean; loading: boolean };
  doneNote?: string;
}) {
  if (done) {
    return (
      <View>
        <AskDone done words={done} />
        {doneNote ? (
          <Text variant="footnote" tone="muted">
            {doneNote}
          </Text>
        ) : null}
      </View>
    );
  }
  const note = action ? null : blocked;
  return (
    <AskWaiting
      forMe={action !== null}
      mark={icon}
      words={title}
      actions={
        action ? (
          <EventPillAction key="act" primary label={action} onPress={onAction} />
        ) : ask ? (
          <EventPillAction
            key="ask"
            label={ask.label}
            onPress={ask.onPress}
            disabled={ask.disabled}
            loading={ask.loading}
          />
        ) : null
      }
      below={
        why || detail || note ? (
          <EventPillText>
            {why ? <Text variant="footnote">{why}</Text> : null}
            {detail ? (
              <Text variant="footnote" tone="muted">
                {detail}
              </Text>
            ) : null}
            {note ? (
              <Text variant="footnote" tone="muted">
                {note}
              </Text>
            ) : null}
          </EventPillText>
        ) : null
      }
    />
  );
}
