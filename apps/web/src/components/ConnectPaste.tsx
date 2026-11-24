import { type ConnectOutcome, type ConnectorDef, useCompleteOAuth } from "@agenteschat/client";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { authorizeState, pastedReturn, pastedStart } from "@agenteschat/client/lib/pasted-return";
import { AffixInput, Button, DialogBody, DialogFooter, Locked, onThemeChange, SettingNote } from "@agenteschat/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { useOrg } from "@/components/org-context";

/** The authorization finished: the connection it made, and what connecting did. */
export interface PastedDone {
  connectionId: string;
  outcome: ConnectOutcome;
}

/** Its state is gone (expired or used): a new authorization is needed, with a new address to open. */
const RESTARTS = new Set(["oauth.link_expired", "oauth.link_used"]);

/**
 * Connecting a server that refused our callback's domain and took only the loopback address (ADR 0016 addendum
 * 2026-11-23), in two stages of one thing each. `open`: the service opens in a new tab, where the person approves.
 * `paste`: they paste the address of the page it ends on, which doesn't load (drawn, with its address selected); the
 * right address connects at once, anything else or the provider's refusal is said under the field. The parent holds the
 * stage (its header's back goes from `paste` to `open`). `onRestart`: the authorization expired or was used, so a new
 * one is asked for (`authorizeUrl` changes, what is on screen stays).
 */
export function ConnectPaste({
  name,
  stage,
  onStage,
  authorizeUrl,
  redirectUri,
  note,
  onDone,
  onRestart,
  onClose,
}: {
  name: string;
  stage: "open" | "paste";
  onStage: (stage: "open" | "paste") => void;
  authorizeUrl: string;
  redirectUri: string;
  /** The footer's words on the first stage (who will be able to use it). */
  note: ReactNode;
  onDone: (done: PastedDone) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const complete = useCompleteOAuth(org.id);
  const [value, setValue] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pasteFailed, setPasteFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const tried = useRef<string | null>(null);
  const read = pastedReturn(value, redirectUri, authorizeState(authorizeUrl));
  const busy = complete.isPending || complete.isSuccess;

  // The right address connects at once, once: the same text isn't sent again after a refusal.
  useEffect(() => {
    if (read.kind !== "ok" || busy || tried.current === value) return;
    tried.current = value;
    setFailure(null);
    complete.mutate(
      { state: read.state, code: read.code },
      {
        onSuccess: (done) => onDone({ connectionId: done.connectionId, outcome: done.outcome ?? "connected" }),
        onError: (error) => {
          setFailure(errorText(t, error, i18n.language));
          if (RESTARTS.has(errorCode(error) ?? "")) onRestart();
        },
      },
    );
  }, [read, value, busy, complete, onDone, onRestart, t, i18n.language]);

  const paste = async () => {
    setPasteFailed(false);
    try {
      setValue((await navigator.clipboard.readText()).trim());
    } catch {
      setPasteFailed(true);
      field.current?.focus();
    }
  };
  // Opening the service's page: a link, so the desktop app's window sends it to the browser as any other.
  const open = (label: string, primary: boolean) => (
    <Button asChild variant={primary ? "primary" : "link"}>
      <a href={authorizeUrl} target="_blank" rel="noopener noreferrer" onClick={() => onStage("paste")}>
        {label}
      </a>
    </Button>
  );

  if (stage === "open") {
    return (
      <>
        <DialogBody className="cflow__body">
          <ConnectScene name={name} lit={2} />
          <StageHead
            title={t("connectFlow.paste.openTitle", { name })}
            text={t("connectFlow.paste.openText", { name })}
          />
        </DialogBody>
        <DialogFooter bar note={note}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {open(t("connectFlow.paste.open", { name }), true)}
        </DialogFooter>
      </>
    );
  }

  const error =
    failure ??
    (read.kind === "other"
      ? t("connectFlow.paste.wrong", { start: pastedStart(redirectUri) })
      : read.kind === "refused"
        ? t("connectFlow.paste.refused", { name })
        : null);
  return (
    <>
      <DialogBody className="cflow__body">
        <PasteScene redirectUri={redirectUri} />
        <StageHead
          title={busy ? t("connectFlow.paste.connecting", { name }) : t("connectFlow.paste.pasteTitle")}
          text={t("connectFlow.paste.pasteText")}
          htmlFor="cflow-paste"
        />
        <span className="cflow__big">
          <Locked when={busy}>
            <AffixInput
              ref={field}
              id="cflow-paste"
              value={value}
              placeholder={`${redirectUri}?code=…`}
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setFailure(null);
                setPasteFailed(false);
              }}
              action={
                !value.trim() && (
                  <Button variant="ghost" size="sm" icon="copy" onClick={() => void paste()}>
                    {t("connectFlow.paste.paste")}
                  </Button>
                )
              }
            />
          </Locked>
        </span>
        {error && <SettingNote icon="alert">{error}</SettingNote>}
        {pasteFailed && <SettingNote icon="alert">{t("connectFlow.paste.pasteFailed")}</SettingNote>}
      </DialogBody>
      <DialogFooter
        bar
        note={
          busy ? undefined : (
            <span>
              {t("connectFlow.paste.notOpened")} {open(t("connectFlow.paste.openAgain", { name }), false)}
            </span>
          )
        }
      >
        <Button disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * A stage's question, large, with a line under it. `htmlFor`: the question names that field (its only one).
 */
export function StageHead({ title, text, htmlFor }: { title: ReactNode; text?: ReactNode; htmlFor?: string }) {
  return (
    <div className="cflow__ask">
      {htmlFor ? (
        <label className="cflow__question" htmlFor={htmlFor}>
          {title}
        </label>
      ) : (
        <p className="cflow__question">{title}</p>
      )}
      {text && <p className="muted cflow__text">{text}</p>}
    </div>
  );
}

/** The trail between the agent and the service: this many pixels long. */
const TRAIL = 7;

/**
 * Connecting, drawn as the app draws its scenes: agentes.chat's own agent (the engine's, alive) and the service's tile on
 * a band of dithered ground, a pixel trail between them lit up to where the connection has come (`lit` of 7; all of it,
 * connected, the agent happy). Decorative for screen readers: the stage's words say the same.
 */
export function ConnectScene({
  name,
  def = null,
  image = null,
  lit,
}: {
  name: string;
  def?: Pick<ConnectorDef, "iconUrl" | "brandColor"> | null;
  image?: string | null;
  lit: number;
}) {
  const ground = useGround();
  const done = lit >= TRAIL;
  return (
    <span className="cflow-scene" aria-hidden="true">
      <canvas ref={ground} className="cflow-ground" />
      <span className="cflow-scene__row">
        <span className="cflow-scene__agent">
          <AgentAvatar
            name="agentes.chat"
            appearance={{ color: "sky", eyes: "round" }}
            size="lg"
            framed={false}
            state="idle"
            {...(done ? { expression: "happy" as const } : {})}
          />
        </span>
        <span className="cflow-scene__trail">
          {Array.from({ length: TRAIL }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of pixels, by their place
            <i key={i} data-on={i < lit ? "" : undefined} data-next={i === lit ? "" : undefined} />
          ))}
        </span>
        <ConnectorIcon def={def} image={image} label={name} size="lg" />
      </span>
    </span>
  );
}

/**
 * The page that doesn't load, drawn on the same ground: a pixel browser window rising from it, its address selected as
 * text is right before it is copied. The address and the page's words are real text, so the person knows the page when
 * they get there. Decorative for screen readers.
 */
function PasteScene({ redirectUri }: { redirectUri: string }) {
  const { t } = useTranslation();
  const ground = useGround();
  const url = new URL(redirectUri);
  return (
    <span className="cflow-paste__scene" aria-hidden="true">
      <canvas ref={ground} className="cflow-ground" />
      <span className="cflow-paste__win">
        <span className="cflow-paste__top">
          <span className="cflow-paste__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="cflow-paste__addr">
            <span>{`${url.host}${url.pathname}?code=…`}</span>
          </span>
        </span>
        <span className="cflow-paste__page">
          <i />
          <span>{t("connectFlow.paste.unreachable")}</span>
        </span>
      </span>
    </span>
  );
}

/** A canvas painted as the scenes' ground, again when its size or the theme changes. */
function useGround() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => paintGround(canvas);
    paint();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(paint);
    resize?.observe(canvas);
    const offTheme = onThemeChange(paint);
    return () => {
      resize?.disconnect();
      offTheme();
    };
  }, []);
  return ref;
}

/** Bayer 4×4 thresholds, the sky's dither. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** How far each tone of the ground goes from the surface toward the ink. */
const GROUND_MIX = [0, 0.035, 0.07, 0.11];
const CELL = 4;

/**
 * The ground: the dialog's surface dithered toward its ink, deeper at the bottom and the sides, with a few loose pixels
 * in the upper part. Its colors are the theme's, read again on every repaint.
 */
function paintGround(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return;
  const w = Math.max(1, Math.ceil(canvas.clientWidth / CELL));
  const h = Math.max(1, Math.ceil(canvas.clientHeight / CELL));
  canvas.width = w;
  canvas.height = h;
  const style = getComputedStyle(canvas);
  const surface = rgbOf(ctx, style.getPropertyValue("--surface-raised"));
  const ink = rgbOf(ctx, style.getPropertyValue("--ink"));
  const tones = GROUND_MIX.map(
    (k) => `rgb(${surface.map((c, i) => Math.round(c + ((ink[i] ?? c) - c) * k)).join(",")})`,
  );
  const last = tones.length - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.min(1, (y / h) * 0.75 + Math.abs(x / w - 0.5) * 0.5) * last;
      const lo = Math.floor(v);
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const loose = n - Math.floor(n) > 0.992 && y < h * 0.6;
      const tone = loose ? lo + 2 : v - lo > (BAYER[((y & 3) << 2) | (x & 3)] ?? 0.5) ? lo + 1 : lo;
      ctx.fillStyle = tones[Math.min(last, tone)] ?? tones[0] ?? "transparent";
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** A CSS color (any form the theme writes) as its red, green and blue, through the canvas's own parser. */
function rgbOf(ctx: CanvasRenderingContext2D, color: string): number[] {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color.trim() || "#000";
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}
