import { useEffect, useState } from "react";
import { HtmlFrame } from "@/components/artifacts/HtmlFrame";
import { useCentralWords } from "./words";
import "./central.css";

/** How long the text must rest before the page is drawn: a reply still arriving doesn't reload it at every word. */
const SETTLE_MS = 500;

/** VPS Zen: a fenced `html` block as the page it is, in the same sandbox as an artifact (no network, no app access). */
export function HtmlPreview({ html }: { html: string }) {
  const w = useCentralWords();
  const [shown, setShown] = useState(html);
  useEffect(() => {
    const id = setTimeout(() => setShown(html), SETTLE_MS);
    return () => clearTimeout(id);
  }, [html]);
  return <HtmlFrame html={shown} title={w.preview} className="central-html" />;
}

export const isHtmlLang = (lang: string) => lang === "html" || lang === "htm";
