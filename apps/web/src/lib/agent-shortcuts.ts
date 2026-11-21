import { composes, typingInField } from "@agenteschat/ui";

type ShortcutKey = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">;

/**
 * The agent a quick-switch shortcut names, as its place in the sidebar's AGENTES list (0 for the first): Ctrl+1..9
 * (⌘1..9 on a Mac) and, off a Mac, Alt+1..9, since a browser tab keeps Ctrl+1..9 for its own tabs. The digit comes from
 * `code` too, so a layout whose number row types other characters (French AZERTY) still works. Shift and AltGr
 * combinations stay the page's, and nothing fires while an input method is composing.
 */
export function quickAgentIndex(e: ShortcutKey, apple: boolean): number | null {
  if (e.shiftKey || e.isComposing) return null;
  const primary = (apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
  // Option+digit types a character on a Mac: Alt is the fallback only elsewhere.
  const alt = !apple && e.altKey && !e.ctrlKey && !e.metaKey;
  if (!primary && !alt) return null;
  const digit = /^Digit[1-9]$/.test(e.code) ? e.code.slice(5) : /^[1-9]$/.test(e.key) ? e.key : null;
  return digit ? Number(digit) - 1 : null;
}

/** Whether this key event should be read as a quick switch at all (the event's own composing state, not only ours). */
export const quickAgentEvent = (e: KeyboardEvent, apple: boolean) =>
  e.defaultPrevented || e.repeat || composes(e) || typingInField(e.target) ? null : quickAgentIndex(e, apple);

/** The hint shown on the first nine agents' rows: "Alt 1" (the key that works in every browser off a Mac) or "⌘1". */
export const quickAgentHint = (index: number, apple: boolean) =>
  index >= 0 && index < 9 ? (apple ? `⌘${index + 1}` : `Alt ${index + 1}`) : null;
