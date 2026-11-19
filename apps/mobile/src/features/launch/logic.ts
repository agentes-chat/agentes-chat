import {
  isAppIcon,
  isMadeIconExpression,
  isMadeIconFace,
  type MadeIconColor,
  type MadeIconExpression,
  type MadeIconSky,
  madeIconOf,
} from "@agenteschat/client/lib/app-icons";
import type { AgentAccessory, AgentEyes } from "@agenteschat/tokens/look";
import { idlePose, mixHex, type Pose } from "@agenteschat/ui/agent/engine";

/**
 * The launch splash: pure pieces the screen and the tests share. No React
 * Native imports. Times in seconds.
 */
export const LAUNCH = {
  /** The shortest it plays before it may leave, once its rise is under way. */
  min: 0.9,
  /**
   * Ready this soon (its first frames: the session and the workspace kept from last time), it leaves at once, with no
   * minimum to sit through: its rise had barely begun.
   */
  quick: 0.15,
  /** The sky rising and the agent lifting with it. */
  rise: 0.85,
  /** Leaving: the agent and the name go up and out first, the sky sinks, the screen fades into the app. */
  exit: 0.55,
  /** Leaving with reduced motion: a short fade. */
  reducedExit: 0.25,
  /** The agent popping in over the blank first frame, as the rise starts. */
  pop: 0.32,
  /** When the name comes in. */
  nameAt: 0.45,
  /** How long it waits before one line says why it is still here. */
  lineAfter: 2.5,
  /** How high the sky rises (share of the screen's height). */
  sky: 0.5,
  /** How far the agent lifts with it (points). */
  lift: 26,
  /** Waiting on something the person can act on (a server that doesn't answer): the agent's height, as a share of the screen. */
  waitingAgent: 0.3,
  /** And the sky's level then (its top just under the name). */
  waitingSky: 0.56,
} as const;

/**
 * The agent's body, centered on the screen: as wide as the logo's body in a 120 pt image of 512 px with the body at
 * 56–456. The native launch image (assets/images/splash-icon.png) is blank, the background alone: the splash's first
 * frame is the same, then the agent pops in, so the icon fixed at build time never shows before the one in use.
 */
export const LOGO = (120 * 400) / 512;
/** The splash's agent and sky: the app icon's in use, so the opening is the icon the person picked. */
export interface LaunchLook {
  /** Drawn as the build draws the icon (`iconGradient`): `sky` is the landing's blue, never the accent. */
  color: MadeIconColor;
  eyes: AgentEyes;
  /** A made icon's held face (a wink, a heart), when the choreography shows none of its own. */
  expression?: MadeIconExpression;
  accessory: AgentAccessory;
  sky: MadeIconSky;
}

/** The agent in the logo: the shipped icon's (on the night sky). */
export const LOGO_LOOK: LaunchLook = { color: "sky", eyes: "round", accessory: "none", sky: "night" };

/**
 * The look of the icon in use, from its id as last read from the system (`STORED.appIcon`); the logo's when there is
 * none or it is unknown. The ready icons all have the logo's agent, on their sky.
 */
export function launchLookOf(id: string | null): LaunchLook {
  if (!id) return LOGO_LOOK;
  if (isAppIcon(id)) return { ...LOGO_LOOK, sky: id === "sky" || id === "peekSky" ? "sky" : "night" };
  const made = madeIconOf(id);
  if (!made) return LOGO_LOOK;
  const face = isMadeIconFace(made.look) ? made.look : "round";
  return {
    color: made.color,
    eyes: isMadeIconExpression(face) ? "round" : face,
    ...(isMadeIconExpression(face) ? { expression: face } : {}),
    accessory: isMadeIconFace(made.look) ? "none" : made.look,
    sky: made.sky,
  };
}

/** Whether the app, ready `readyMs` after the splash came up, skips its minimum (`LAUNCH.quick`). */
export const launchesAtOnce = (readyMs: number) => readyMs <= LAUNCH.quick * 1000;

/** The line under the name while it waits: none at first, then why (no network, or just slow). */
export function waitLine(late: boolean, offline: boolean): "offline" | "slow" | null {
  if (!late) return null;
  return offline ? "offline" : "slow";
}

const ease = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * The logo agent `a` seconds in: it looks down at the sky coming up, back up, smiles, then idles. Without a
 * network, after a while, it closes its eyes; leaving, it smiles.
 */
export function launchPose(a: number, opts: { offline?: boolean; leaving?: boolean } = {}): Pose {
  let pose: Pose;
  if (a < 0.5) pose = { turn: [0, 0.75 * ease(a / 0.3)], blink: a > 0.08 && a < 0.16 };
  else if (a < 0.9) pose = { turn: [0, 0.75 - 0.95 * ease((a - 0.5) / 0.4)] };
  else {
    pose = { ...idlePose(a, 1.4, { every: 4.5, expressions: ["happy"] }), turn: [Math.sin(a * 0.9) * 0.35, -0.2] };
    if (a < 1.5) pose.expression = "happy";
  }
  if (opts.leaving) return { ...pose, expression: "happy", blink: false };
  if (opts.offline && a > LAUNCH.lineAfter) return { ...pose, expression: "closed" };
  return pose;
}

/** The little pixel agents going up through the sky: a column each, their own pace and start. */
export const SPRITES = [
  { x: 0.08, speed: 0.05, phase: 0.1, blink: 0.4 },
  { x: 0.25, speed: 0.072, phase: 0.55, blink: 2.1 },
  { x: 0.41, speed: 0.04, phase: 0.3, blink: 1.2 },
  { x: 0.58, speed: 0.065, phase: 0.8, blink: 3.0 },
  { x: 0.74, speed: 0.045, phase: 0.05, blink: 0.9 },
  { x: 0.9, speed: 0.06, phase: 0.62, blink: 2.6 },
] as const;

/**
 * Where a sprite is (share of the height from the top) with the sky at `level`: it rises from `bottom` (near the
 * screen's bottom, or above what the splash shows there) to a little under the sky's top and starts again; null
 * while the sky is too low to hold it.
 */
export function spriteY(sprite: (typeof SPRITES)[number], t: number, level: number, bottom = 0.95): number | null {
  "worklet";
  const travel = bottom - (1 - level) - 0.06;
  if (travel <= 0.04) return null;
  const k = t * sprite.speed + sprite.phase * travel;
  return bottom - (k - travel * Math.floor(k / travel));
}

/** A sprite blinks for a moment every 3.6 s. */
export function spriteBlinks(sprite: (typeof SPRITES)[number], t: number): boolean {
  "worklet";
  return (t + sprite.blink) % 3.6 < 0.12;
}

/** The sprites' body color (deep navy, white eyes: the sky's agents). */
export const SPRITE_BODY = "#04203f";

/**
 * The sky's tones, deep to light from the screen's background. `dusk`: the sky of a team's own server (lilac, as
 * the workspace's sky at dusk), so the splash that waits on that server says which one fell silent. `sky`: the app
 * icon's; a day sky's icon is its brighter blues in light (in dark the icons are all at night, as is this).
 */
export function launchSkyTones(bg: string, dark: boolean, dusk = false, sky: MadeIconSky = "night"): string[] {
  if (dusk) {
    const [deep, light] = dark ? ["#4a40a8", "#7b6fe0"] : ["#c9c0ff", "#aaa6f5"];
    return dark
      ? [bg, mixHex(bg, deep, 0.14), mixHex(bg, deep, 0.3), mixHex(bg, deep, 0.48), mixHex(bg, light, 0.66)]
      : [bg, mixHex(bg, deep, 0.22), mixHex(bg, deep, 0.48), mixHex(bg, deep, 0.78), deep, light];
  }
  if (dark)
    return [
      bg,
      mixHex(bg, "#2b74e6", 0.14),
      mixHex(bg, "#2b74e6", 0.3),
      mixHex(bg, "#2b74e6", 0.48),
      mixHex(bg, "#4b93ff", 0.66),
    ];
  if (sky === "sky")
    return [
      bg,
      mixHex(bg, "#8cc3ff", 0.25),
      mixHex(bg, "#8cc3ff", 0.55),
      mixHex(bg, "#8cc3ff", 0.85),
      "#8cc3ff",
      "#4693e8",
    ];
  return [
    bg,
    mixHex(bg, "#a6cfff", 0.22),
    mixHex(bg, "#a6cfff", 0.48),
    mixHex(bg, "#a6cfff", 0.78),
    "#a6cfff",
    "#78b4ff",
  ];
}
