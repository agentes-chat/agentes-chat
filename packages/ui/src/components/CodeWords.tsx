import type { ReactNode } from "react";
import { codeAndBoldParts } from "../markdown";

/**
 * Code between backticks and **bold**, nothing else, as text nodes (never parsed HTML): copy that names a command, a
 * path or a setting, and words inside a control (an option, a button), where no link can go.
 */
export function codeAndBold(text: string, key = "cb"): ReactNode[] {
  return codeAndBoldParts(text).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.mark === "code")
      return (
        <code key={k} className="ac-inlinecode">
          {part.text}
        </code>
      );
    if (part.mark === "bold") return <b key={k}>{part.text}</b>;
    return part.text;
  });
}
