import { createContext, type ReactNode, useContext } from "react";
import type { ViewStyle } from "react-native";

/**
 * A card under someone else's words in a conversation of bubbles: it is a bubble of the same message, so it takes the
 * bubble's fill (and its light edge over a background) instead of the raised surface and its shadow (`useSurface`),
 * and joins the bubble group above it. Null elsewhere (a conversation of lines, my own row, Atividade, Início).
 */
export interface BubblePart {
  fill: string;
  edge: ViewStyle | null;
}
export const BubblePartContext = createContext<BubblePart | null>(null);
export const useBubblePart = () => useContext(BubblePartContext);

/**
 * A card's corners in a bubble group: the bubbles' 18, its top left close to what is above it (a run's 6), its bottom
 * left cut (the cards' own corner).
 */
export const BUBBLE_PART_CORNERS = {
  borderRadius: 18,
  borderTopLeftRadius: 6,
  borderBottomLeftRadius: 6,
} as const satisfies ViewStyle;

/**
 * A message with no words whose one card is a request (an approval, a question, a secret): in bubbles its name line
 * goes inside the card, at its top, and its time at the card's end, as a bubble's. Null elsewhere.
 */
export interface BubbleHead {
  who: ReactNode;
  time: string;
}
export const BubbleHeadContext = createContext<BubbleHead | null>(null);
export const useBubbleHead = () => useContext(BubbleHeadContext);
