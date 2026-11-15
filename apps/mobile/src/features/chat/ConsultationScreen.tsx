import { useChannels, useConsultations, useExchangeConversation } from "@agenteschat/client";
import {
  consultChoiceKey,
  consultChoiceOf,
  consultChoices,
  consultLineState,
  consultOriginKey,
  openableConsultation,
} from "@agenteschat/client/lib/consult-group";
import { consultSubject } from "@agenteschat/client/lib/consultations";
import { namesText } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { groupsWith } from "@agenteschat/client/lib/timeline";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, LineIcon, PixelOrbit, Segmented, SheetSurface, Text } from "@/ui";
import { chatHref } from "../links/logic";
import { useColors, useDirectory, useMeId, useOrgId, useWhen } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { SheetTitle } from "../shared/PromptForm";
import { FocusLive, goBack } from "../shared/parts";
import { SheetHostProvider } from "../shared/SheetHost";
import { consultLineLabel } from "./ConsultGroup";
import { requestComposerText } from "./composer-request";
import { RowLookContext, useConversationLook } from "./look";
import { MessageRow } from "./MessageRow";
import { MessageText } from "./MessageText";

/**
 * A question an agent asked another from a conversation, in a sheet over it (the web opens it in a dialog, as a
 * long message): "Theo ⇄ Iris", where it was asked, the question as it went to the other agent, what that
 * agent wrote and the cards it posted in the conversation (an approval, a question, a secret), drawn as the
 * conversation draws them. Read only: people don't write in the agents' DM; "Falar com o Theo" goes back to the
 * conversation with the agent that asked mentioned in its field. The DM sends the app no events: it reloads while
 * the question is out. From a row of several asked agents (`group`): named as the row is ("Theo ⇄ Atlas e mais 1"),
 * with one choice per agent saying where it stands.
 */
export function ConsultationScreen({
  consultationId,
  channelId,
  group,
}: {
  consultationId: string;
  channelId: string;
  /** The questions of the row that opened it, when it stands for several agents. */
  group?: readonly string[];
}) {
  // The cards drawn here open their sheets (a question answered "do meu jeito") as in the conversation.
  return (
    <SheetHostProvider>
      <FocusLive>
        <SheetSurface>
          <Consultation consultationId={consultationId} channelId={channelId} group={group} />
        </SheetSurface>
      </FocusLive>
    </SheetHostProvider>
  );
}

function Consultation({
  consultationId: opened,
  channelId,
  group,
}: {
  consultationId: string;
  channelId: string;
  group?: readonly string[];
}) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const meId = useMeId();
  const dir = useDirectory();
  const c = useColors();
  const when = useWhen();
  const look = useConversationLook(false);
  const insets = useSafeAreaInsets();
  const several = Boolean(group && group.length > 1);
  const listed = useConsultations(orgId, channelId, several && Boolean(channelId));
  const items = useMemo(
    () => (several ? (listed.data ?? []).filter((x) => group?.includes(x.id)) : []),
    [several, group, listed.data],
  );
  const choices = consultChoices(items, Date.now(), items[0]?.agentId).filter((ch) => openableConsultation(ch.opens));
  const [pick, setPick] = useState(opened);
  const picked = consultChoiceOf(choices, items, pick) ?? choices[0];
  // On the chosen agent's own exchange as its asker asked it, so the title and "Falar com" stay on the asker.
  const consultationId = choices.length > 1 && picked ? picked.opens : pick;
  const nameOf = (id: string) => dir.agentById.get(id)?.name ?? t("mobile.chat.someone");
  // The whole exchange its row stands for: the other questions between the same two agents come in it too.
  const query = useExchangeConversation(orgId, channelId, consultationId && channelId ? consultationId : null);
  // DMs aren't in the list: no channel name there.
  const channelName = useChannels(orgId).data?.find((x) => x.id === channelId)?.name ?? null;
  const q = query.data?.consultation;
  const list = query.data?.messages ?? [];
  const asker = q ? dir.agentById.get(q.agentId) : undefined;
  const consulted = q ? dir.agentById.get(q.consultedAgentId) : undefined;
  const from = agentGrammar(asker?.name ?? t("mobile.chat.someone"));
  const to = agentGrammar(consulted?.name ?? t("mobile.chat.someone"));
  const state = q ? consultLineState(q, Date.now()) : null;
  // The consulted agent's own words came: its last one is the answer. Left out (its run also answers a question
  // from another conversation), the answer shows on its own.
  const said = list.some((m) => m.author.id === q?.consultedAgentId && m.channelId !== channelId);
  // A form sheet sizes its first scroll view to the whole sheet, over whatever stands before or after it: the
  // title rides pinned inside the list and the foot lies over its end, each on the sheet's own color, with the
  // foot's height kept free under the last row. The list is the sheet's own first child, with no view around it:
  // inside a painted one the sheet also moves the list to the screen's own frame, not only sizes it, and the list
  // can land off the sheet, which then shows empty.
  const [footHeight, setFootHeight] = useState(0);
  const talk = () => {
    if (asker) requestComposerText(channelId, `@${asker.handle} `);
    goBack(chatHref(channelId));
  };
  return (
    <>
      <ScrollView
        style={[styles.screen, { backgroundColor: c.bg }]}
        stickyHeaderIndices={[0]}
        contentContainerStyle={[styles.list, { paddingBottom: footHeight + 12 }]}
        scrollIndicatorInsets={{ bottom: footHeight }}
      >
        <View style={[styles.head, { backgroundColor: c.bg }]}>
          <SheetTitle
            title={
              q
                ? t("chat.consultPanel.title", {
                    from: from.name,
                    to:
                      choices.length > 1
                        ? namesText(
                            t,
                            choices.map((ch) => nameOf(ch.agentId)),
                            1,
                          )
                        : to.name,
                  })
                : ""
            }
            subtitle={[
              // What the exchange is about, ahead of where it is and how many messages it has.
              consultSubject(q?.question),
              channelName ? t("chat.consultPanel.where", { channel: channelName }) : t("chat.consultPanel.whereDm"),
              ...(list.length > 0 ? [t("chat.consultPanel.messages", { count: list.length })] : []),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </View>
        {choices.length > 1 && picked ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pad}>
            <Segmented
              value={picked.agentId}
              onChange={(agentId) => setPick(choices.find((ch) => ch.agentId === agentId)?.opens ?? pick)}
              items={choices.map((ch) => ({
                key: ch.agentId,
                label: (
                  <>
                    {nameOf(ch.agentId)}{" "}
                    <Text variant="footnote" tone="faint">
                      {t(consultChoiceKey(ch.state, ch.item))}
                    </Text>
                  </>
                ),
              }))}
            />
          </ScrollView>
        ) : null}
        {query.isLoading ? <ActivityIndicator color={c.muted} /> : null}
        {!query.isLoading && !query.data ? (
          <Text variant="small" tone="muted" style={styles.pad}>
            {query.isError ? t("common.loadFailed") : t("chat.consultPanel.missing")}
          </Text>
        ) : null}
        {q ? (
          <View style={[styles.line, styles.pad]}>
            <LineIcon variant="caption" name="agent" size={14} color={c.faint} />
            <Text variant="caption" tone="faint" style={styles.grow}>
              {t(consultOriginKey(q, Boolean(channelName)), {
                from: from.name,
                to: to.name,
                channel: channelName,
                time: when.time(q.createdAt),
              })}
            </Text>
          </View>
        ) : null}
        <RowLookContext.Provider value={look}>
          {list.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              grouped={groupsWith(list[i - 1], m.author, m.createdAt)}
              meId={meId}
              readOnly
            />
          ))}
        </RowLookContext.Provider>
        {q?.status === "answered" && q.answer && !said ? (
          <View style={[styles.answer, styles.pad]}>
            <Text variant="caption" tone="faint" style={styles.bold}>
              {t("chat.consultation.answerOf", { name: to.name, context: to.context })}
            </Text>
            <MessageText body={q.answer} />
          </View>
        ) : null}
        {q && state && state !== "answered" ? (
          <View style={[styles.line, styles.pad]} accessibilityLiveRegion="polite">
            {state === "working" ? (
              <LineIcon variant="caption" size={12} mark>
                <PixelOrbit color={agentLook(consulted).color} size={12} />
              </LineIcon>
            ) : (
              <LineIcon
                name={state === "waiting" || state === "offline" || state === "handedOn" ? "wait" : "clock"}
                size={12}
                color={c.faint}
                variant="caption"
              />
            )}
            <Text variant="caption" tone="faint" style={styles.grow}>
              {consultLineLabel(t, state, q, to)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <View
        style={[styles.foot, { paddingBottom: insets.bottom + 8, backgroundColor: c.bg }]}
        onLayout={(e) => setFootHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.note, { backgroundColor: c.sunken }]}>
          <LineIcon variant="footnote" name="lock" size={16} color={c.muted} />
          <Text variant="footnote" tone="muted" style={styles.grow}>
            <Text variant="footnote" tone="ink2" style={styles.bold}>
              {t("chat.consultPanel.readOnly")}
            </Text>{" "}
            {t("chat.consultPanel.steer", { name: from.name, context: from.context })}
          </Text>
        </View>
        {asker ? (
          <Button
            variant="secondary"
            size="sm"
            icon="chat"
            wide
            label={t("chat.consultPanel.talk", { name: from.name, context: from.context })}
            onPress={talk}
          />
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Under the sheet's grabber, the list's side inset.
  head: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  list: { gap: 2 },
  pad: { paddingHorizontal: 16 },
  // Sentences that wrap: the icon stays on their first line (`LineIcon`), not between the lines.
  line: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 6 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: "600" },
  answer: { gap: 4, paddingVertical: 8 },
  foot: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14 },
});
