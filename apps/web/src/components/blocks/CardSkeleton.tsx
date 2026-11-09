import type { ArtifactRef } from "@agenteschat/client";
import { CARD_BLOCK_ROOM, type CardKind, TYPICAL_CARD_OPTIONS } from "@agenteschat/client/lib/artifacts";
import { Skeleton, SkeletonGroup } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import "./blocks.css";

/**
 * A live block, a vote or a question card whose content hasn't loaded: the card's own frame and rows, with bars for
 * its words, so it opens at the size it keeps. The message's ref says its title and how many options and questions it
 * has (`ArtifactRef`); an older ref gets a typical card.
 */
export function CardSkeleton({
  kind,
  card,
}: {
  kind: CardKind;
  card?: Pick<ArtifactRef, "title" | "options" | "questions">;
}) {
  const { t } = useTranslation();
  const options = card?.options ?? TYPICAL_CARD_OPTIONS;
  const steps = card?.questions ?? 1;
  const title = <b>{card?.title || <Skeleton width="45%" height={14} />}</b>;
  // The head's buttons hold its height: a question card's close, a block's two.
  const buttons = kind === "block" ? 2 : kind === "choices" ? 1 : 0;
  return (
    <SkeletonGroup
      label={card?.title ?? t("common.loading")}
      className={`live-block ${kind === "choices" ? "choices" : ""}`}
    >
      <header className="live-block__head">
        <span className="live-block__titles">
          {title}
          {(kind === "poll" || steps > 1) && (
            <small>
              <Skeleton width={120} height={10} />
            </small>
          )}
        </span>
        {Array.from({ length: buttons }, (_, i) => (
          // The buttons' box (the kit's classes, so its touch sizes too), nothing to press yet.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
          <span key={i} className="ac-btn ac-btn--sm ac-btn--icon ac-btn--ghost" aria-hidden="true" />
        ))}
      </header>
      {kind === "choices" && (
        <>
          <p className="choices__question">
            <Skeleton width="70%" />
          </p>
          <div className="choices__options">
            {Array.from({ length: options + 1 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              <span key={i} className="choices__option ac-mediarow ac-mediarow--row">
                <span className="ac-mediarow__face">
                  <span className="choices__letter" />
                </span>
                <span className="ac-mediarow__head">
                  <Skeleton width={i === options ? "35%" : "55%"} />
                </span>
              </span>
            ))}
          </div>
          {steps > 1 && <div className="live-block__foot choices__foot" />}
        </>
      )}
      {kind === "poll" && (
        <>
          <div className="poll__options">
            {Array.from({ length: options }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              <span key={i} className="poll__option">
                <span className="poll__box" />
                <Skeleton width="45%" />
              </span>
            ))}
          </div>
          <div className="live-block__foot" />
        </>
      )}
      {kind === "block" && <div className="live-block__room" style={{ height: CARD_BLOCK_ROOM }} />}
    </SkeletonGroup>
  );
}
