import { type FestiveMood, festiveMoodOf } from "@agenteschat/client/lib/festive";
import { useMemo, useSyncExternalStore } from "react";
import { readValueSync, STORED, writeValue } from "./storage";

/**
 * Festive moods on this phone (`@agenteschat/client/lib/festive`): on by default, "Climas festivos" in Você turns
 * them off. Read at once, so the launch splash knows before its first frame.
 */
let on = readValueSync(STORED.festive) !== "off";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const current = () => on;

export const useFestiveOn = () => useSyncExternalStore(subscribe, current, current);

export function setFestiveOn(next: boolean) {
  on = next;
  void writeValue(STORED.festive, next ? null : "off");
  for (const cb of listeners) cb();
}

/** Today's mood now, or null on an ordinary day or with the switch off. */
export const festiveMood = (): FestiveMood | null => (on ? festiveMoodOf(new Date()) : null);

/** `festiveMood`, following the switch (the day as it was when the screen came up). */
export function useFestiveMood(): FestiveMood | null {
  const enabled = useFestiveOn();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `festiveMood` reads the switch `enabled` follows
  return useMemo(festiveMood, [enabled]);
}
