import type { Actor } from "@agenteschat/client";
import { useSyncExternalStore } from "react";
import { pickStore } from "../agents/pick-store";

/**
 * An event's participants, picked on their own pushed screen (`/calendar/people`, ADR 0135: screens, never a list
 * opened in the form): who is picked now (the person writing it is always in, and never listed) and how each tap goes
 * back to the form. The form opens it before pushing and closes it when it goes away.
 */
export interface PeoplePick {
  value: readonly Actor[];
  apply: (next: Actor[]) => void;
}

const store = pickStore<PeoplePick>();

export const openPeoplePick = store.open;
export const closePeoplePick = store.close;

/** One tap on the screen: written back to the form at once, the screen redrawn from it. */
export function setPicked(next: Actor[]) {
  const pick = store.now();
  if (!pick) return;
  pick.apply(next);
  store.update((p) => ({ ...p, value: next }));
}

export function usePeoplePick(): PeoplePick | null {
  return useSyncExternalStore(store.subscribe, store.now);
}

/** The same person or agent. */
export const sameActor = (a: Actor, b: Actor) => a.type === b.type && a.id === b.id;
