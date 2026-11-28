import { createContext, type ReactNode, useContext } from "react";
import type { ViewStyle } from "react-native";
import { corners, RADIUS } from "@/ui/radius";

/**
 * A card under someone else's words in a conversation of bubbles: it is a bubble of the same message, so it takes the
 * bubble's fill (and its light edge over a background) instead of the raised surface and its shadow (`useSurface`),
 * the one gap under the part above it as every part of the message. Null elsewhere (a conversation of lines, my own row, Atividade, Início).
 */
export interface BubblePart {
  fill: string;
  edge: ViewStyle | null;
}
export const BubblePartContext = createContext<BubblePart | null>(null);
export const useBubblePart = () => useContext(BubblePartContext);

/**
 * A conversation's one shape, for every bubble and every card in a message (its tools, what it changed, a request, a
 * file, its work, a proposal): the bubbles' 18 on three corners and the top left cut (6), on the side the words come
 * from (my bubbles mirror it, top right). The same wherever it stands in a run: no corner squares off to join the
 * next one.
 */
export const MESSAGE_CARD_CORNERS = corners(RADIUS.sm, RADIUS.xl, RADIUS.xl, RADIUS.xl);

/** A card in a bubble group: the conversation's one shape, as the bubbles above it. */
export const BUBBLE_PART_CORNERS = MESSAGE_CARD_CORNERS;

/** Someone else's bubble: the conversation's one shape. */
export const THEIR_BUBBLE_CORNERS = MESSAGE_CARD_CORNERS;

/** My bubble, on the right: the same shape mirrored, its top right cut. */
export const MY_BUBBLE_CORNERS = corners(RADIUS.xl, RADIUS.sm, RADIUS.xl, RADIUS.xl);

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
