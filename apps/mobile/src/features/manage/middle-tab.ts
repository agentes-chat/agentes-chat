import { useSyncExternalStore } from "react";
import { readValueSync, STORED, writeValue } from "@/lib/storage";
import { type MiddleTab, middleTabOf } from "./logic";

/** The tab bar's second place on this phone (Você › Preferências): Threads unless the person chose Gestão. */
let choice: MiddleTab = middleTabOf(readValueSync(STORED.middleTab));
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const current = () => choice;

export const useMiddleTab = () => useSyncExternalStore(subscribe, current, current);

export function setMiddleTab(next: MiddleTab) {
  choice = next;
  void writeValue(STORED.middleTab, next);
  for (const cb of listeners) cb();
}

/** The phone forgot its remembered values (the last sign-out): back to Threads, so the next account starts there. */
export function resetMiddleTab() {
  choice = "threads";
  for (const cb of listeners) cb();
}
