import type { Issue, IssueColumn, IssueProjectRef } from "@agenteschat/client";
import { useIssueProjects, useTaskUnread } from "@agenteschat/client";
import { dueLabel, dueTone } from "@agenteschat/client/lib/format";
import { githubLinkLabel } from "@agenteschat/client/lib/github-link";
import { pickableProjects } from "@agenteschat/client/lib/issue-projects";
import { type CardState, cardState, cardStateText, cardWaits, isOpen } from "@agenteschat/client/lib/issues";
import { codeAndBoldParts } from "@agenteschat/client/lib/markdown";
import { stepPhrase } from "@agenteschat/client/lib/work";
import { bodyTones } from "@agenteschat/ui/agent/engine";
import { memo, type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  Chip,
  Icon,
  IconButton,
  type IconName,
  PixelOrbit,
  Sky,
  Text,
  type TextProps,
  TOOL_H,
  TOUCH,
  textLineOf,
  useFontScale,
  useReducedMotion,
} from "@/ui";
import { SocialMark } from "@/ui/auth/SocialMarks";
import { mediaRowAxis } from "@/ui/media-row";
import { router } from "@/ui/navigation";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { type ActionItem, MentionCount, MONO, Tile, useSurface } from "../shared/parts";
import { criteriaProgress, type IssueState, issueState, latestPr } from "./logic";

/** An agent's step in the person's words ("Mexeu nos arquivos do PC · trips.service.ts"), as the web says it. */
export function useStepText() {
  const { t } = useTranslation();
  return useCallback(
    (step: Parameters<typeof stepPhrase>[1] | null | undefined) => (step ? stepPhrase(t, step) : ""),
    [t],
  );
}

/** A column's name as people read it: its own, or the stage's when it has none ("A fazer"). */
export function useColumnLabel() {
  const { t } = useTranslation();
  return useCallback((c: Pick<IssueColumn, "name" | "stage">) => c.name ?? t(`issues.status.${c.stage}`), [t]);
}

/**
 * A board column inside a stage (only where the board is customized): its name, whole, and count. In A fazer, for who
 * may create tasks, "+" at its end opens Nova tarefa in that column (the web's column head); a long name's first line
 * sits on the button's middle.
 */
export function ColumnHeader({ label, count, onNew }: { label: string; count: number; onNew?: () => void }) {
  const { t } = useTranslation();
  const line = textLineOf("small", useFontScale()).height;
  const onButton = onNew ? { paddingTop: Math.max(0, (TOOL_H - line) / 2) } : null;
  return (
    <View style={[styles.column, onNew && styles.columnActs]} accessibilityRole="header">
      <Text variant="small" tone="muted" style={[styles.columnName, onButton]}>
        {label}
      </Text>
      <Text variant="small" tone="faint" style={onButton}>
        {count}
      </Text>
      {onNew ? (
        <View style={styles.columnEnd}>
          <IconButton small icon="plus" label={t("issues.newIn", { column: label })} onPress={onNew} />
        </View>
      ) : null}
    </View>
  );
}

/** A task's title, whole, with its `code` as the inline code pill and its **bold** (the web card's); no links. */
export function TaskTitle({ title, ...text }: { title: string } & Omit<TextProps, "children">) {
  const c = useColors();
  return (
    <Text {...text}>
      {codeAndBoldParts(title).map((part, k) =>
        part.mark ? (
          <RNText
            // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one title, in order
            key={k}
            style={part.mark === "code" ? [styles.code, { backgroundColor: c.sunken, color: c.ink2 }] : styles.heavy}
          >
            {part.text}
          </RNText>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

const STATE_ICON: Record<Exclude<IssueState, "running">, IconName> = {
  waiting: "wait",
  stalled: "pause",
  review: "code",
  progress: "clock",
  todo: "circle",
  done: "checkc",
  canceled: "x",
};

/** The issue's state as a chip: "Trabalhando" with the agent's orbit, "Em revisão · PR #212", "Esperando você"… */
export function StateChip({ issue }: { issue: Issue }) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const state = issueState(issue);
  const pr = latestPr(issue);
  const label =
    state === "review" && pr
      ? t("mobile.issues.state.reviewPr", { number: pr.number })
      : t(`mobile.issues.state.${state}`);
  if (state === "running") {
    const agent = issue.assignee?.type === "agent" ? dir.agentById.get(issue.assignee.id) : undefined;
    return <Chip label={label} leading={<PixelOrbit color={agentLook(agent).color} size={10} />} />;
  }
  return <Chip label={label} icon={STATE_ICON[state]} />;
}

/** Who has it: the agent's living body (moving while it works) or the person's face; nobody: an empty tile. */
export function AssigneeFace({ issue, size, live }: { issue: Issue; size: number; live: boolean }) {
  if (!issue.assignee) return <Tile icon="circle" size={size} />;
  const running = issue.work?.state === "running";
  return (
    <Face
      who={issue.assignee}
      size={issue.assignee.type === "agent" ? size : size - 4}
      mode={running ? "run" : issue.work?.state === "stalled" ? "rest" : "idle"}
      live={live}
    />
  );
}

/** The task's GitHub link as a chip: `repo#12`, with GitHub's mark. */
export function GithubChip({ url }: { url: string }) {
  const c = useColors();
  return <Chip label={githubLinkLabel(url)} leading={<SocialMark provider="github" color={c.muted} size={12} />} />;
}

/** A state's mark: the agent's orbit while it works; what calls on a person, or stopped, in the attention color. */
const CARD_STATE_ICON: Record<Exclude<CardState["kind"], "running">, IconName> = {
  approval: "shield",
  question: "help",
  stalled: "pause",
  blocked: "wait",
};

/** The one state of a task in words, as the web's card says it: "Pergunta algo", "Parado há 2 dias". */
export function useCardState(i: Issue) {
  const { t } = useTranslation();
  const state = cardState(i, Boolean(i.conversation?.working));
  return { state, words: state ? cardStateText(t, state) : null };
}

/** A state's mark and words, beside who has it on a card, after the name in a row. */
export function StateWords({ issue, state, words }: { issue: Issue; state: CardState; words: string }) {
  const c = useColors();
  const dir = useDirectory();
  const agent = issue.assignee?.type === "agent" ? dir.agentById.get(issue.assignee.id) : undefined;
  return (
    <View style={[styles.inline, styles.state]}>
      {state.kind === "running" ? (
        <PixelOrbit color={agentLook(agent).color} size={10} />
      ) : (
        <Icon
          name={state.kind === "blocked" && state.blocked.reason === "failed" ? "info" : CARD_STATE_ICON[state.kind]}
          size={14}
          color={c.warn}
        />
      )}
      <Text variant="small" style={[styles.bold, styles.shrink, { color: state.kind === "running" ? c.agent : c.ink }]}>
        {words}
      </Text>
    </View>
  );
}

/**
 * A card's one row of facts, wrapping between facts: the number, the project, the label, the priority, the date in words (in the
 * attention color today, tomorrow and once late), the criteria, GitHub, the conversation's count with my mentions.
 */
function CardFacts({
  issue: i,
  mentions,
  unread,
  project,
}: {
  issue: Issue;
  mentions: number;
  unread: boolean;
  project: boolean;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const [label, ...labels] = i.labels;
  const due = i.dueDate && isOpen(i) ? { text: dueLabel(t, i18n.language, i.dueDate), tone: dueTone(i.dueDate) } : null;
  const crit = criteriaProgress(i);
  const pr = latestPr(i);
  const talk = i.conversation?.count ?? 0;
  // A mark on the first line's middle, for a fact whose words wrap (a repository's name wider than the card).
  const mark = mediaRowAxis(12, textLineOf("caption", useFontScale())).face;
  return (
    <View style={styles.facts}>
      <Text variant="caption" tone="muted">
        #{i.number}
      </Text>
      {project && i.project ? <ProjectName project={i.project} /> : null}
      {label ? <Chip label={label} /> : null}
      {labels.length > 0 ? (
        <Text variant="caption" tone="muted" accessibilityLabel={labels.join(", ")}>
          +{labels.length}
        </Text>
      ) : null}
      {i.priority !== "normal" ? (
        <View style={styles.inline}>
          <Icon name="flag" size={12} color={i.priority === "high" ? c.warn : c.faint} />
          <Text variant="caption" tone="muted">
            {t(`issues.priority.${i.priority}`)}
          </Text>
        </View>
      ) : null}
      {due ? (
        <View style={styles.inline}>
          <Icon name="clock" size={12} color={due.tone ? c.warn : c.faint} />
          <Text variant="caption" style={due.tone ? [styles.bold, { color: c.warn }] : { color: c.muted }}>
            {t("mobile.issues.until", { date: due.text })}
          </Text>
        </View>
      ) : null}
      {crit ? (
        <View style={styles.inline}>
          <Icon name="checkc" size={12} color={crit.done === crit.total ? c.ok : c.faint} />
          <Text variant="caption" tone="muted">
            {crit.done}/{crit.total}
          </Text>
        </View>
      ) : null}
      {pr ? (
        <View style={styles.inline}>
          <SocialMark provider="github" color={c.faint} size={12} />
          <Text variant="caption" tone="muted">
            {t("issues.pr", { number: pr.number })}
          </Text>
        </View>
      ) : null}
      {i.githubUrl ? (
        <View style={[styles.inline, styles.wraps]}>
          <View style={{ marginTop: mark }}>
            <SocialMark provider="github" color={c.faint} size={12} />
          </View>
          <Text variant="caption" tone="muted" style={styles.shrink}>
            {githubLinkLabel(i.githubUrl)}
          </Text>
        </View>
      ) : null}
      {talk > 0 || mentions > 0 ? (
        <View style={styles.inline}>
          <Icon name="chat" size={12} color={c.faint} />
          {talk > 0 ? (
            <Text variant="caption" tone={unread ? "ink" : "muted"} style={unread ? styles.heavy : undefined}>
              {talk}
            </Text>
          ) : null}
          <MentionCount count={mentions} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One task on the board, in the web card's three parts: the title, whole; one row of facts; who has it (the face 24,
 * moving while its agent works) and its one state. An agent waiting on a person puts its sky at the card's top, faded
 * in. A long name wraps beside the face, on the face's line first; a state that doesn't fit goes under, whole.
 */
export const BoardCard = memo(function BoardCard({
  issue: i,
  live,
  project = true,
}: {
  issue: Issue;
  live: boolean;
  /** Its project among the facts. A project's own board leaves it out. */
  project?: boolean;
}) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const surface = useSurface();
  const reduced = useReducedMotion();
  const axis = mediaRowAxis(24, textLineOf("small", useFontScale()));
  const { state, words } = useCardState(i);
  const agent = i.assignee?.type === "agent" ? dir.agentById.get(i.assignee.id) : undefined;
  // Mentions of me not read in its conversation (ADR 0145), red as on the web's card.
  const { mentions, unread } = useTaskUnread(useOrgId(), i.id);
  return (
    <Pressable
      onPress={() => router.push(`/issues/${i.number}`)}
      accessibilityRole="button"
      accessibilityLabel={[
        t("issues.open", { number: i.number, title: i.title }),
        words,
        mentions > 0 ? t("shell.unreadMentions", { count: mentions }) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [styles.card, surface, pressed && styles.pressed]}
    >
      {cardWaits(state) ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} style={styles.sky}>
          <Sky
            color={agentLook(agent).color}
            surface="raised"
            depth={0.55}
            fade={0.15}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
      <TaskTitle title={i.title} variant="callout" style={styles.title} />
      <CardFacts issue={i} mentions={mentions} unread={unread > 0} project={project} />
      {i.assignee || state ? (
        <View style={styles.who}>
          {i.assignee ? (
            <View style={styles.person}>
              <View style={[styles.face, { marginTop: axis.face }]}>
                <AssigneeFace issue={i} size={24} live={live} />
              </View>
              <Text variant="small" tone="ink2" style={[styles.bold, styles.name, { paddingTop: axis.words }]}>
                {dir.nameOf(i.assignee)}
              </Text>
            </View>
          ) : null}
          {state && words ? <StateWords issue={i} state={state} words={words} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

/** A project's color as one flat tone, as the web's dot: the middle of the five its dither is drawn in. */
const projectTone = (color: string) => bodyTones(color)[2];

/** A project's dot in its color. No color: a hollow ring ("Sem projeto", "Todos os projetos"). */
export function ProjectDot({ color }: { color?: string | null | undefined }) {
  const c = useColors();
  return (
    <View style={styles.dotBox}>
      <View
        style={[
          styles.dot,
          color ? { backgroundColor: projectTone(color) } : { borderWidth: 1.5, borderColor: c.faint },
        ]}
      />
    </View>
  );
}

/** A task's project on its card and its row: the dot and the name, which wraps whole inside the line. */
export function ProjectName({ project }: { project: IssueProjectRef }) {
  const mark = mediaRowAxis(12, textLineOf("caption", useFontScale())).face;
  return (
    <View style={[styles.inline, styles.wraps]}>
      <View style={{ marginTop: mark }}>
        <ProjectDot color={project.color} />
      </View>
      <Text variant="caption" tone="muted" style={styles.shrink}>
        {project.name}
      </Text>
    </View>
  );
}

/**
 * A sheet's rows to pick a task's project: the ones in use (and the task's own, even archived) with their dots, then
 * "Sem projeto", a check on the current one. Projects are created and changed on the web.
 */
export function useProjectItems() {
  const { t } = useTranslation();
  const projects = useIssueProjects(useOrgId()).data?.projects ?? [];
  return (current: IssueProjectRef | null | undefined, onPick: (projectId: string | null) => void): ActionItem[] => {
    const check = (on: boolean) => (on ? { trailing: <Icon name="check" size={18} /> } : {});
    return [
      ...pickableProjects(projects, current).map((p) => ({
        key: p.id,
        label: p.name,
        leading: <ProjectDot color={p.color} />,
        ...check(p.id === current?.id),
        onPress: () => onPick(p.id),
      })),
      {
        key: "none",
        label: t("issues.projects.none"),
        leading: <ProjectDot />,
        ...check(!current),
        onPress: () => onPick(null),
      },
    ];
  };
}

/** The strip's value line at the default text size: one line makes the 32 control. */
const PROP_LINE = textLineOf("subhead", 1).height;

/**
 * A field on a strip: 32 high in the field look, its icon or face and its value; a press opens its picker. A value
 * wider than the screen wraps inside it, never cut, its icon or face on the first line.
 */
export function PropChip({
  label,
  value,
  icon,
  leading,
  onPress,
}: {
  label: string;
  value: string;
  icon?: IconName;
  leading?: ReactNode;
  onPress: () => void;
}) {
  const c = useColors();
  const line = textLineOf("subhead", useFontScale()).height;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      hitSlop={{ top: (TOUCH - TOOL_H) / 2, bottom: (TOUCH - TOOL_H) / 2 }}
      style={({ pressed }) => [
        styles.prop,
        { backgroundColor: c.sunken, borderColor: c.line2 },
        pressed && styles.pressed,
      ]}
    >
      <View style={{ height: line, justifyContent: "center" }}>
        {leading ?? (icon ? <Icon name={icon} size={16} color={c.muted} /> : null)}
      </View>
      <Text variant="subhead" style={styles.propText}>
        {value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // An icon's 12 box with the 8 dot in its middle, so the dot sits where a fact's mark does.
  dotBox: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  prop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    minHeight: TOOL_H,
    maxWidth: "100%",
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: (TOOL_H - PROP_LINE) / 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  propText: { fontWeight: "600", flexShrink: 1 },
  card: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 12, gap: 8, overflow: "hidden" },
  pressed: { opacity: 0.85 },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  // A long state (a stopped run's reason) wraps inside the card instead of running past its edge.
  state: { flexShrink: 1, maxWidth: "100%" },
  // A fact wider than the card (a long repository's link) wraps its words inside it, its mark on the first line.
  wraps: { maxWidth: "100%", alignItems: "flex-start" },
  shrink: { flexShrink: 1 },
  bold: { fontWeight: "600" },
  heavy: { fontWeight: "700" },
  title: { fontWeight: "600" },
  // The approval card's sky at the top, fading into the card (the web's 64px).
  sky: { position: "absolute", top: 0, left: 0, right: 0, height: 64 },
  // A narrow card wraps between the facts, never inside one.
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 },
  // The face with the name, then the state; a state that doesn't fit goes to the next line whole.
  who: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4 },
  // Never the face alone on a line: the name wraps beside it.
  person: { flexDirection: "row", alignItems: "flex-start", gap: 8, flexShrink: 1 },
  // A person's photo is 20 (an agent's body 24): either sits in the 24 box, on the name's first line.
  face: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  name: { flexShrink: 1 },
  code: { fontFamily: MONO },
  column: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 4,
  },
  columnName: { fontWeight: "600", flexShrink: 1 },
  // With "+": the row as tall as the button, the words on its first line's middle.
  columnActs: { alignItems: "flex-start", paddingTop: 2 },
  columnEnd: { marginLeft: "auto" },
});
