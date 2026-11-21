import {
  type TerminalEnd,
  terminalCloseState,
  terminalFrame,
  terminalSize,
  terminalSocketUrl,
  useMachines,
} from "@agenteschat/client";
import { Button } from "@agenteschat/ui";
import type { Terminal } from "@xterm/xterm";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolOffWayOut } from "@/components/devices/ToolOneClick";
import { SocketFactoryContext } from "@/realtime/context";
import "@xterm/xterm/css/xterm.css";
import "./code-terminal.css";

/** What the pane shows: the shell opening or live, or why it closed (`dropped`: it was live, then its socket broke). */
type PaneState = "opening" | "live" | "dropped" | TerminalEnd;

/** Each closed state's line. */
const END_WORDS = {
  ended: "codeTerminal.ended",
  dropped: "codeTerminal.dropped",
  screening: "codeTerminal.screening",
  forbidden: "codeTerminal.forbidden",
  offline: "codeTerminal.offline",
  outdated: "codeTerminal.outdated",
  unavailable: "codeTerminal.unavailable",
  busy: "codeTerminal.busy",
  paused: "codeTerminal.paused",
  failed: "codeTerminal.failed",
} as const satisfies Record<Exclude<PaneState, "opening" | "live">, string>;

/** Where opening again changes nothing by itself: the server's rule, the person's rights, the computer's app. */
const FINAL: PaneState[] = ["screening", "forbidden", "outdated"];

const FONT_SIZE = 13;
const LINE_HEIGHT = 1.2;
const SCROLLBACK = 5000;
/** How long the terminal waits for its face before it measures its cells with whatever face there is. */
const FONT_WAIT_MS = 1500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A binary frame's bytes (an ArrayBuffer from the browser's socket, a view from a test's); null for anything else. */
function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/**
 * A code session's terminal (ADR 0214): a shell on the agent's computer, as its agent's user, started in the session's
 * worktree, for the person's own scripts (the agent doesn't work in it). xterm.js fills the pane and follows its size;
 * keys go to the shell as bytes (binary frames), its output comes back the same way, and a new size goes as a `resize`
 * text frame. Who may open it is who may drive that computer (ADR 0058 §6). Its shell's end, or a refusal, says why
 * under it, with "Open again" where opening again can change that: a new terminal is a new shell, nothing is kept.
 */
export function TerminalPane({
  orgId,
  agentId,
  machineId,
  sessionId,
}: {
  orgId: string;
  agentId: string;
  /** The agent's computer: where its terminal is off, the way to turn it on there. */
  machineId: string | null;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const createSocket = useContext(SocketFactoryContext);
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("opening");
  /** Its computer is too old for the session's folder: the shell started in the agent's folder. */
  const [agentFolder, setAgentFolder] = useState(false);
  const [round, setRound] = useState(0);
  // Refused for want of the computer's switch: the computer, for the way to turn the terminal on.
  const machines = useMachines(orgId, state === "unavailable" && machineId !== null);
  const machine = machines.data?.find((m) => m.id === machineId) ?? null;
  const off = state === "unavailable" && machine !== null && machine.access?.tools.terminal !== true;

  // A new socket, and so a new shell, for each of these and for each "Open again" (`round`).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let done = false;
    let term: Terminal | null = null;
    let socket: ReturnType<typeof createSocket> | null = null;
    let observer: ResizeObserver | null = null;
    let frame = 0;
    setState("opening");
    setAgentFolder(false);

    const start = async () => {
      const [xterm, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (done) return;
      // Its colors and face are the page's tokens (code-terminal.css), the agent's screen's dark ground in both themes.
      const style = getComputedStyle(host);
      const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
      const fontFamily = token("--font-mono") ?? "monospace";
      // Cells measured in a face that isn't loaded yet would all be off once it is.
      await Promise.race([document.fonts?.load(`${FONT_SIZE}px ${fontFamily}`), sleep(FONT_WAIT_MS)]).catch(() => {});
      if (done) return;
      const background = token("--code-term-bg");
      const shell = new xterm.Terminal({
        fontFamily,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        cursorBlink: true,
        scrollback: SCROLLBACK,
        theme: {
          background,
          foreground: token("--code-term-ink"),
          cursor: token("--code-term-cursor"),
          cursorAccent: background,
          selectionBackground: token("--code-term-selection"),
        },
      });
      term = shell;
      const fit = new FitAddon();
      shell.loadAddon(fit);
      shell.open(host);
      // The pane's room in cells, within the sizes the server takes. A room it can't read (a hidden pane) is no new
      // size: the terminal keeps its own, as xterm's own fit does.
      const fitted = () => {
        const room = fit.proposeDimensions();
        const read = room && Number.isFinite(room.cols) && Number.isFinite(room.rows) ? room : shell;
        return terminalSize(read.cols, read.rows);
      };
      const first = fitted();
      shell.resize(first.cols, first.rows);

      const ws = createSocket(
        terminalSocketUrl(window.location, { orgId, agentId, cols: first.cols, rows: first.rows, session: sessionId }),
      );
      socket = ws;
      ws.binaryType = "arraybuffer";
      // The size the shell has: a new one goes once the socket is open (frames before it would be lost).
      let shellSize = first;
      const sendSize = () => {
        if (ws.readyState !== 1 || (shellSize.cols === shell.cols && shellSize.rows === shell.rows)) return;
        shellSize = { cols: shell.cols, rows: shell.rows };
        ws.send(JSON.stringify({ type: "resize", ...shellSize }));
      };
      const send = (bytes: Uint8Array) => {
        if (ws.readyState === 1) ws.send(bytes);
      };
      const encoder = new TextEncoder();
      // Keys and pastes as UTF-8; text frames from here are only `resize` (the server closes on any other).
      shell.onData((data) => send(encoder.encode(data)));
      // Some mouse reports are bytes past 127, one per character.
      shell.onBinary((data) => send(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)));
      shell.onResize(sendSize);
      ws.onopen = sendSize;
      ws.onmessage = (ev) => {
        if (done) return;
        const data = ev.data;
        if (typeof data === "string") {
          const said = terminalFrame(data);
          if (said === "exit") setState("ended");
          else if (said === "cwd_ignored") setAgentFolder(true);
          return;
        }
        const bytes = bytesOf(data);
        if (!bytes) return;
        shell.write(bytes);
        setState((s) => (s === "opening" ? "live" : s));
      };
      ws.onclose = (ev) => {
        if (done) return;
        socket = null;
        shell.options.disableStdin = true;
        shell.options.cursorBlink = false;
        const end = terminalCloseState(ev.code, (ev as { reason?: string }).reason ?? "");
        // Its shell's `exit` came first: it ended, however its socket closed after.
        setState((s) => (s === "ended" ? s : s === "live" && end === "failed" ? "dropped" : end));
      };

      const resized = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const next = fitted();
          if (!done && (next.cols !== shell.cols || next.rows !== shell.rows)) shell.resize(next.cols, next.rows);
        });
      };
      observer = new ResizeObserver(resized);
      observer.observe(host);
      // Opened again by the person's click: the keys go to it at once. A first open leaves the focus where it is (the
      // pane may open with the page, while the person types in the conversation).
      if (round > 0) shell.focus();
    };
    start().catch(() => {
      if (!done) setState("failed");
    });

    // A page kept for the Back button would keep its shell open: it ends with the page (coming back opens it again).
    const leave = (e: PageTransitionEvent) => {
      if (e.persisted) socket?.close(1000);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      done = true;
      window.removeEventListener("pagehide", leave);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        socket.close(1000);
      }
      term?.dispose();
    };
  }, [orgId, agentId, sessionId, createSocket, round]);

  return (
    <section className="code-term" aria-label={t("codeTerminal.label")}>
      {agentFolder && <p className="code-term__note">{t("codeTerminal.agentFolder")}</p>}
      {/* Off on its computer: no screen, only why and the way to turn it on. */}
      <div className="code-term__screen" ref={hostRef} hidden={off} />
      {state === "opening" && (
        <p className="code-term__opening" role="status">
          {t("codeTerminal.opening")}
        </p>
      )}
      {state !== "opening" && state !== "live" && (
        <div className="code-term__end">
          <p role="status">{off ? t("codeTerminal.off", { computer: machine.name }) : t(END_WORDS[state])}</p>
          {off ? (
            <ToolOffWayOut machine={machine} tool="terminal">
              <Button size="sm" icon="refresh" onClick={() => setRound((r) => r + 1)}>
                {t("codeTerminal.openAgain")}
              </Button>
            </ToolOffWayOut>
          ) : (
            !FINAL.includes(state) && (
              <Button size="sm" icon="refresh" onClick={() => setRound((r) => r + 1)}>
                {t("codeTerminal.openAgain")}
              </Button>
            )
          )}
        </div>
      )}
    </section>
  );
}
