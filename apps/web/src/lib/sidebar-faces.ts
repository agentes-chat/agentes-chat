import { STORAGE_KEYS, storage } from "./storage";

/*
 * VPS Zen: the sidebar's channel rows show up to three of their members' faces (agents first) in place of the "#",
 * so a channel is known by who is in it. On by default, on this device; Preferências turns it off.
 */
const CHANGE_EVENT = "agentes:sidebar-faces";

let on = storage.get(STORAGE_KEYS.sidebarFaces) !== "off";

export const sidebarFacesOn = () => on;

export function setSidebarFaces(next: boolean) {
  on = next;
  storage.set(STORAGE_KEYS.sidebarFaces, next ? "on" : "off");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const onSidebarFacesChange = (cb: () => void) => {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
};
