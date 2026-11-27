import { useTranslation } from "react-i18next";
import "./feedback-facts.css";

/**
 * What a feedback an agent writes carries besides its text (ADR 0160 §11 and §12, amended 2026-11-11): the run's side
 * as the server read it, label and value, so the person sees all that goes in their name before it goes. The labels
 * are the email's own (its reader is whoever runs the server), so they stay as they are.
 */
export function FeedbackFacts({ facts }: { facts: readonly (readonly [string, string])[] | undefined }) {
  const { t } = useTranslation();
  if (!facts || facts.length === 0) return null;
  return (
    <section className="fb-facts" aria-label={t("feedback.alongWith")}>
      <span className="fb-facts__head">{t("feedback.alongWith")}</span>
      <dl className="fb-facts__list">
        {facts.map(([label, value], i) => (
          // A label may repeat (one line per tool error): its place keeps it apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed once drawn
          <div key={i} className="fb-facts__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
