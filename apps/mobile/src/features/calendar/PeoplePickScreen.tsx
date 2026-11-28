import type { Actor } from "@agenteschat/client";
import { matchesWords } from "@agenteschat/ui/search";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, SearchField } from "@/ui";
import { goBack } from "@/ui/navigation";
import { Gap, SettingsPage } from "../settings/parts";
import { Face } from "../shared/Face";
import { useDirectory, useMeId } from "../shared/hooks";
import { sameActor, setPicked, usePeoplePick } from "./people-pick";

/** A face in the rows' 36 pt leading column, as the other pickers'. */
const FACE = 36;
/** From this many people and agents together, a search over the list. */
const SEARCH_FROM = 8;

/**
 * An event's participants, pushed from Novo evento (ADR 0135: screens, never sheets), drawn as the task's "who does
 * it": the people of the workspace and then its agents, each with its face and a quieter line (a person's @, an
 * agent's role), a check on each one picked. A tap adds one or takes one off and is written back at once; the bar's
 * "OK" (or back) goes back with them. The person writing the event is always in it and isn't listed.
 */
export function PeoplePickScreen() {
  const { t } = useTranslation();
  const dir = useDirectory();
  const meId = useMeId();
  const pick = usePeoplePick();
  const [query, setQuery] = useState("");
  // Opened with no form under it (its address on its own): nothing to pick for.
  useEffect(() => {
    if (!pick) goBack("/calendar");
  }, [pick]);
  const people = useMemo(
    () => [...dir.memberById.values()].filter((m) => m.userId !== meId).sort((a, b) => a.name.localeCompare(b.name)),
    [dir.memberById, meId],
  );
  const agents = useMemo(() => [...dir.agents].sort((a, b) => a.name.localeCompare(b.name)), [dir.agents]);
  const q = query.trim();
  const shownPeople = q ? people.filter((p) => matchesWords(`${p.name} @${p.handle}`, q)) : people;
  const shownAgents = q ? agents.filter((a) => matchesWords(`${a.name} ${a.role ?? ""}`, q)) : agents;
  const picked = pick?.value ?? [];
  const toggle = (who: Actor) =>
    setPicked(picked.some((p) => sameActor(p, who)) ? picked.filter((p) => !sameActor(p, who)) : [...picked, who]);
  const row = (who: Actor, label: string, sub: string | null | undefined) => (
    <GroupedRow
      key={`${who.type}:${who.id}`}
      leading={<Face who={who} size={FACE} live={false} />}
      label={label}
      {...(sub ? { sub } : {})}
      checked={picked.some((p) => sameActor(p, who))}
      onPress={() => toggle(who)}
    />
  );
  return (
    <SettingsPage
      title={t("calendar.form.participants")}
      action={{ label: t("mobile.common.done"), onPress: () => goBack("/calendar") }}
    >
      {people.length + agents.length >= SEARCH_FROM ? (
        <View style={styles.search}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={t("calendar.form.participantsSearch")}
            accessibilityLabel={t("calendar.form.participantsSearch")}
          />
        </View>
      ) : (
        <Gap />
      )}
      {shownPeople.length > 0 ? (
        <View>
          <GroupedHeader>{t("calendar.filter.person")}</GroupedHeader>
          <GroupedList>
            {shownPeople.map((p) => row({ type: "person", id: p.userId }, p.name, p.handle ? `@${p.handle}` : null))}
          </GroupedList>
        </View>
      ) : null}
      {shownAgents.length > 0 ? (
        <View>
          <GroupedHeader>{t("calendar.filter.agent")}</GroupedHeader>
          <GroupedList>{shownAgents.map((a) => row({ type: "agent", id: a.id }, a.name, a.role))}</GroupedList>
        </View>
      ) : null}
      {q && shownPeople.length === 0 && shownAgents.length === 0 ? (
        <GroupedFooter>{t("calendar.form.participantsEmpty")}</GroupedFooter>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  search: { paddingTop: 4, paddingBottom: 4 },
});
