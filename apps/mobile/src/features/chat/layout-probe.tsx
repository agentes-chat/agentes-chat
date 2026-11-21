import { createContext, useSyncExternalStore } from "react";
import type { LayoutChangeEvent, TextLayoutEvent } from "react-native";
import { StyleSheet, Text, View } from "react-native";

/**
 * Diagnostic build only, never merged: the frames each layer of a long message was laid out at, drawn under its words
 * once it shows whole, to find which layer of a bubble ends up taller than the words it holds.
 */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Part = Frame | string;

const parts = new Map<string, Record<string, Part>>();
const versions = new Map<string, number>();
const listeners = new Set<() => void>();
let pending = false;

function notify() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    for (const listener of listeners) listener();
  });
}

export function noteValue(id: string, part: string, value: Part) {
  const kept = parts.get(id) ?? {};
  kept[part] = value;
  parts.set(id, kept);
  versions.set(id, (versions.get(id) ?? 0) + 1);
  notify();
}

export function noteFrame(id: string, part: string, e: LayoutChangeEvent) {
  const { x, y, width, height } = e.nativeEvent.layout;
  noteValue(id, part, { x, y, w: width, h: height });
}

/** A text block's lines: how many, and where the last one ends (its words' real bottom). */
export function noteLines(id: string, index: number, e: TextLayoutEvent) {
  const lines = e.nativeEvent.lines;
  const last = lines[lines.length - 1];
  noteValue(id, `t${index}`, `${lines.length}:${last ? Math.round(last.y + last.height) : 0}`);
}

/** The message whose words are being measured (`ClippedMessage`); null: nothing measured. */
export const ProbeContext = createContext<string | null>(null);

function useParts(id: string) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => versions.get(id) ?? 0,
  );
  return parts.get(id);
}

const isFrame = (p: Part | undefined): p is Frame => typeof p === "object" && p !== null;
const size = (p: Part | undefined) => (isFrame(p) ? `${Math.round(p.w)}x${Math.round(p.h)}` : "-");

const KIND_MARK: Record<string, string> = {
  paragraph: "p",
  heading: "h",
  bullet: "*",
  quote: ">",
  code: "c",
  table: "T",
  details: "d",
};

/** The numbers, under the message's last block (inside the empty space when there is one). */
export function ProbeLabel({ id }: { id: string }) {
  const p = useParts(id);
  const words = p?.words;
  if (!p || !isFrame(words) || words.h < 300) return null;
  const wrap = p.wrap;
  const blocks = Object.entries(p)
    .filter(([key]) => /^b\d+:/.test(key))
    .map(([key, frame]) => {
      const [head = "", kind = ""] = key.split(":");
      return { index: Number(head.slice(1)), kind, frame };
    })
    .filter((b): b is { index: number; kind: string; frame: Frame } => isFrame(b.frame))
    .sort((a, b) => a.index - b.index);
  const end = blocks.reduce((most, b) => Math.max(most, b.frame.y + b.frame.h), 0);
  const top = (isFrame(wrap) ? wrap.y : 0) + end;
  // Where the last block's words really end: its last line, when it is a text (a frame taller than its lines shows).
  const last = blocks[blocks.length - 1];
  const lastLines = last ? p[`t${last.index}`] : undefined;
  const lastBottom = typeof lastLines === "string" ? Number(lastLines.split(":")[1] ?? 0) : 0;
  const wordsEnd =
    last && lastBottom > 0 ? Math.min(top, (isFrame(wrap) ? wrap.y : 0) + last.frame.y + lastBottom) : top;
  const list = blocks
    .map((b) => {
      const lines = p[`t${b.index}`];
      const mark = `${KIND_MARK[b.kind] ?? "?"}${Math.round(b.frame.h)}`;
      const narrow = isFrame(wrap) && Math.abs(b.frame.w - wrap.w) > 2 ? `/w${Math.round(b.frame.w)}` : "";
      return typeof lines === "string" ? `${mark}${narrow}(${lines})` : `${mark}${narrow}`;
    })
    .join(" ");
  const tables = Object.entries(p)
    .filter(([key]) => key.startsWith("table"))
    .map(([, value]) => (typeof value === "string" ? value : ""))
    .join(" | ");
  const text = [
    `cell ${size(p.cell)} trig ${size(p.trig)} row ${size(p.row)}`,
    `area ${size(p.area)} bubble ${size(p.bubble)}`,
    `outer ${size(p.outer)} clip ${size(p.clip)} words ${size(words)} wrap ${size(wrap)}`,
    `end ${Math.round(top)} lines-end ${Math.round(wordsEnd)} extra ${Math.round(words.h - wordsEnd)} blocks ${blocks.length}`,
    list,
    tables ? `table ${tables}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  // Once over the words' start, and again right under their end when there is room under it (the empty space).
  return (
    <>
      <View pointerEvents="none" style={[styles.label, { top: 0 }]}>
        <Text style={styles.text} selectable={false}>
          {text}
        </Text>
      </View>
      {words.h - wordsEnd > 40 ? (
        <View pointerEvents="none" style={[styles.label, { top: wordsEnd + 6 }]}>
          <Text style={styles.text} selectable={false}>
            {text}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/** Outlines that take no room: the layers' edges, drawn over the bubble. */
export const PROBE_EDGES = StyleSheet.create({
  words: { outlineColor: "#16a34a", outlineWidth: 2, outlineStyle: "solid", outlineOffset: -2 },
  wrap: { outlineColor: "#0891b2", outlineWidth: 2, outlineStyle: "dashed", outlineOffset: -5 },
  block: { outlineColor: "#db2777", outlineWidth: 1, outlineStyle: "solid", outlineOffset: 0 },
  bubble: { outlineColor: "#dc2626", outlineWidth: 2, outlineStyle: "solid", outlineOffset: 0 },
});

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    padding: 6,
    borderRadius: 6,
    backgroundColor: "rgba(220,38,38,0.16)",
  },
  text: { fontFamily: "Menlo", fontSize: 10, lineHeight: 13, color: "#dc2626" },
});
