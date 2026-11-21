import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons/Icon";

export type FactTone = "neutral" | "waiting" | "done";

export interface Fact {
  key: string;
  /** An icon name, or a node in its place (a connector's logo). */
  icon: IconName | ReactNode;
  label: ReactNode;
  value: ReactNode;
  /** `waiting` (attention) for what calls for care, `done` for a result. */
  tone?: FactTone;
  /** The whole value, on hover, when it is cut. */
  title?: string;
  /** In a strip in `columns`: the fact takes a whole line (a long value, as a repository's name). */
  wide?: boolean;
}

/**
 * A row of short facts, each an icon, a small label and a one-line value, split by hairlines ("Onde · Efeito ·
 * Prazo"). Each fact is as wide as its words: one that doesn't fit moves whole to the next line, and only a value wider
 * than the whole strip wraps. `columns`: the facts in that many equal columns instead, so a strip on several lines
 * lines up (a fact `wide` takes a whole line).
 */
export function FactStrip({
  facts,
  columns,
  className,
  style,
  ...rest
}: { facts: Fact[]; columns?: number } & HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cx("ac-facts", columns ? "ac-facts--columns" : null, className)}
      style={columns ? ({ ...style, "--fact-columns": columns } as CSSProperties) : style}
      {...rest}
    >
      {facts.map((f) => (
        <div
          key={f.key}
          className={cx(
            "ac-facts__item",
            f.tone && f.tone !== "neutral" && `ac-facts__item--${f.tone}`,
            columns && f.wide ? "ac-facts__item--wide" : null,
          )}
        >
          <span className="ac-facts__icon" aria-hidden="true">
            {typeof f.icon === "string" ? <Icon name={f.icon as IconName} size={16} /> : f.icon}
          </span>
          <dt className="ac-facts__label">{f.label}</dt>
          <dd className="ac-facts__value" title={f.title}>
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
