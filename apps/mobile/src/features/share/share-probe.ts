import { useSyncExternalStore } from "react";

/**
 * Diagnostic build only, never merged: what the share extension's handoff said at each step (the link, the native
 * module's raw answer, the library's error, what the app made of it), drawn under "Nada para compartilhar".
 */
let lines: string[] = [];
const listeners = new Set<() => void>();
const started = Date.now();

export function noteShare(line: string) {
  const at = ((Date.now() - started) / 1000).toFixed(1);
  lines = [...lines.slice(-14), `${at}s ${line}`];
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useShareProbe = (): string[] => useSyncExternalStore(subscribe, () => lines);
