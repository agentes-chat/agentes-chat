import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  resizable,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { IslandProps } from "./props";

/**
 * The agents at work in the Dynamic Island and on the Lock Screen (ADR 0210): one Live Activity per person, its content
 * made and pushed by the server (`IslandProps`, a JSON string in the push's `content-state`). Drawn by iOS from iOS's
 * own components: a face, words and the system's timer, nothing of ours that moves.
 *
 * The system's timer takes all the width it is offered: left to itself it stretched the closed island to its widest,
 * with the time loose in the middle, and on the Lock Screen each line's time fell somewhere else. So every timer here
 * stands in a box of its own size at the trailing edge (`frame` + trailing alignment), and the words keep to the leading
 * edge.
 *
 * - Closed: the first agent's face against the camera on one side, its time against it on the other; a request says
 *   its short word in amber there instead ("Aprovar?"), and the end says "Pronto" in green.
 * - Open: the face, the name and where on the top's leading side; the time on its trailing side, larger; what it is
 *   doing under them across the width, in up to two lines (with several, a line per agent).
 * - Lock Screen: the app's name and how many work, then a line per agent, every time in one column at the edge.
 *
 * It runs in the widget extension's own runtime (the `widget` directive): no hooks, no state, and nothing from this
 * module's scope but the components it imports, so its colors and helpers live inside it.
 */
function AgentsActivityLayout(props: IslandProps, _environment: LiveActivityEnvironment) {
  "widget";
  const AMBER = "#ffb340";
  const GREEN = "#34c759";
  const DIM = "#ffffffa0";
  const agents = props?.agents ?? [];
  const first = agents[0];
  const tone = props?.tone ?? "working";
  const accent = tone === "waiting" ? AMBER : tone === "done" ? GREEN : "#ffffff";

  // A face: the agent's picture the app left in the widgets directory, or a plain dot in its place.
  const face = (agent: IslandProps["agents"][number] | undefined, size: number) =>
    agent?.face ? (
      <Image uiImage={agent.face} modifiers={[resizable(), frame({ width: size, height: size })]} />
    ) : (
      <Image systemName="circle.fill" size={size * 0.7} color="#5aa8ff" />
    );
  // How long an agent has been at it, counted by the system, in a box as wide as "59:59" at this size (digits all one
  // width), its figures against the box's trailing edge.
  const clock = (agent: IslandProps["agents"][number] | undefined, size: number, color = DIM) =>
    agent && agent.state === "working" ? (
      <Text
        date={new Date(agent.since)}
        dateStyle="timer"
        modifiers={[
          font({ size, weight: "semibold" }),
          monospacedDigit(),
          foregroundStyle(color),
          multilineTextAlignment("trailing"),
          frame({ width: Math.ceil(size * 3.2), alignment: "trailing" }),
        ]}
      />
    ) : (
      <Text modifiers={[font({ size, weight: "semibold" }), foregroundStyle(accent)]}>
        {agent?.state === "done" ? "✓" : ""}
      </Text>
    );
  // The end of the closed island and of the open one's top: the time while agents work; a request's or the end's short
  // word otherwise, as wide as its letters.
  const end = (size: number, color?: string) =>
    tone !== "working" && props?.trailing ? (
      <Text modifiers={[font({ size, weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>
        {props.trailing}
      </Text>
    ) : (
      clock(first, size, color)
    );
  // One agent's line: its face, its name and what it does, and its time (or the request's word) at the edge.
  const line = (agent: IslandProps["agents"][number], size: number, nameSize: number) => (
    <HStack spacing={10} alignment="center">
      {face(agent, size)}
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ size: nameSize, weight: "semibold" }), lineLimit(1)]}>{agent.name}</Text>
        <Text modifiers={[font({ size: nameSize - 1 }), foregroundStyle(DIM), lineLimit(1)]}>{agent.step}</Text>
      </VStack>
      <Spacer />
      {agent.state === "waiting" ? (
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(AMBER), lineLimit(1)]}>
          {props.trailing ?? ""}
        </Text>
      ) : (
        clock(agent, 15)
      )}
    </HStack>
  );
  const url = props?.url ?? "agenteschat://island";
  const several = agents.length + (props?.more ?? 0) > 1;

  return {
    // The Lock Screen: the app and how many work, then every agent shown, a request first.
    banner: (
      <VStack
        alignment="leading"
        spacing={12}
        modifiers={[padding({ all: 16 }), activityBackgroundTint("#1c1c1ee6"), widgetURL(url)]}
      >
        <HStack spacing={6} alignment="center">
          <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(DIM)]}>agentes.chat</Text>
          <Spacer />
          {tone === "working" && several ? (
            <Text modifiers={[font({ size: 13 }), foregroundStyle(DIM), lineLimit(1)]}>{props.headline}</Text>
          ) : null}
        </HStack>
        {agents.map((agent) => line(agent, 36, 15))}
        {props?.more ? <Text modifiers={[font({ size: 13 }), foregroundStyle(DIM)]}>{`+${props.more}`}</Text> : null}
      </VStack>
    ),
    compactLeading: face(first, 22),
    compactTrailing: end(14, "#ffffff"),
    minimal: face(first, 20),
    // Open: the face and who on the leading side of the top, the time on the trailing side, against the camera's row.
    expandedLeading: (
      <HStack spacing={10} alignment="center" modifiers={[widgetURL(url)]}>
        {face(first, 40)}
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 16, weight: "semibold" }), lineLimit(1)]}>{props?.headline ?? ""}</Text>
          {first ? (
            <Text modifiers={[font({ size: 13 }), foregroundStyle(DIM), lineLimit(1)]}>{first.where}</Text>
          ) : null}
        </VStack>
      </HStack>
    ),
    expandedTrailing: end(20, "#ffffff"),
    expandedBottom:
      agents.length > 1 ? (
        <VStack alignment="leading" spacing={10} modifiers={[padding({ top: 10 }), widgetURL(url)]}>
          {agents.map((agent) => line(agent, 28, 15))}
        </VStack>
      ) : (
        // What it does against the leading edge: the spacer takes the rest of the row (a lone text sat centred).
        <HStack spacing={0} modifiers={[padding({ top: 10 }), widgetURL(url)]}>
          <Text modifiers={[font({ size: 15 }), lineLimit(2), multilineTextAlignment("leading")]}>
            {first?.step ?? ""}
          </Text>
          <Spacer />
        </HStack>
      ),
  };
}

/** The Live Activity's name: the server's pushes say it (`content-state.name`, ADR 0210). */
export const AGENTS_ACTIVITY = "AgentsActivity";

export default createLiveActivity<IslandProps>(AGENTS_ACTIVITY, AgentsActivityLayout);
