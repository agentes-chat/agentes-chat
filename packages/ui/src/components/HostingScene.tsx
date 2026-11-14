import { type CSSProperties, useMemo } from "react";
import { cx } from "../cx";
import { useDawn } from "../hooks/useDawn";
import { HOSTING_CAST, type Hosting, teamSky } from "../sky/team";
import { Avatar } from "./Avatar";
import { ComputerPortrait } from "./Computer";
import { PixelSky } from "./PixelSky";

export type { Hosting };

/**
 * The choice of where a workspace lives, drawn: on the Cloud, day, the always-on server lit and the team up under it;
 * on one's own server, night, the laptop dark and the team asleep (they stop when it does). Turns from one to the other
 * with the dawn's motion (held still with reduced motion). `tall`: a window's side, the server over the team. `band`:
 * a strip over a sheet, side by side. Decorative: the words beside it say the same.
 */
export function HostingScene({ hosting, shape = "band" }: { hosting: Hosting; shape?: "band" | "tall" }) {
  const cloud = hosting === "cloud";
  const day = useDawn(cloud, { dusk: true });
  const options = useMemo(() => teamSky(day), [day]);
  return (
    <div className={cx("ac-hosting", `ac-hosting--${shape}`)} data-hosting={hosting} aria-hidden="true">
      <PixelSky options={options} />
      <div className="ac-hosting__row">
        <span className="ac-hosting__cast" data-awake={cloud ? "" : undefined}>
          {HOSTING_CAST.map((a, i) => (
            <span key={a.name} className="ac-hosting__agent" style={{ "--i": i } as CSSProperties}>
              <Avatar
                kind="agent"
                name={a.name}
                appearance={a.look}
                size="lg"
                framed={false}
                state={cloud ? "idle" : "sleeping"}
                expression={cloud ? "happy" : undefined}
              />
            </span>
          ))}
        </span>
        <span className="ac-hosting__trail" data-lit={cloud ? "" : undefined}>
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} />
          ))}
        </span>
        <ComputerPortrait kind={cloud ? "linux" : "mac"} state={cloud ? "online" : "offline"} size={96} />
      </div>
    </div>
  );
}
