import { useSyncExternalStore } from "react";

/*
 * VPS Zen: a voice-only channel shows its room or its chat (per channel, for this tab), and who manages it turns it
 * into one or back.
 */

const views = new Map<string, "room" | "chat">();
const viewListeners = new Set<() => void>();
let viewVersion = 0;
const subscribeViews = (cb: () => void) => {
  viewListeners.add(cb);
  return () => viewListeners.delete(cb);
};
export function showVoiceView(channelId: string, view: "room" | "chat") {
  views.set(channelId, view);
  viewVersion++;
  for (const cb of viewListeners) cb();
}
export function useVoiceView(channelId: string) {
  useSyncExternalStore(
    subscribeViews,
    () => viewVersion,
    () => viewVersion,
  );
  return views.get(channelId) ?? "room";
}

/** Makes a channel voice only, or a text channel again (who manages it). */
export async function setVoiceOnly(orgId: string, channelId: string, on: boolean) {
  const res = await fetch(`/api/app/organizations/${orgId}/channels/${channelId}/voice-only`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on }),
  });
  if (!res.ok) throw new Error(String(res.status));
}
