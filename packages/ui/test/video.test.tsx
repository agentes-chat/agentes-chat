import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { claimPlayback, releasePlayback, stopPlayback } from "../src/components/media-playback";
import { VideoPlayer, type VideoPlayerProps } from "../src/components/VideoPlayer";

afterEach(() => cleanup());

const css = await Bun.file(new URL("../src/styles/components.css", import.meta.url).pathname).text();
/** The declarations of the first rule written exactly as `selector {`. */
const rule = (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

const labels: VideoPlayerProps["labels"] = {
  play: "Tocar",
  pause: "Pausar",
  replay: "Ver de novo",
  seek: "Posição no vídeo",
  volume: "Volume",
  mute: "Tirar o som",
  unmute: "Ligar o som",
  speed: (s) => `Velocidade ${s}×`,
  fullscreen: "Tela cheia",
  exitFullscreen: "Sair da tela cheia",
  open: "Abrir",
};
const player = (props: Partial<VideoPlayerProps> = {}) =>
  render(<VideoPlayer src="/f?version=2" name="abertura.mp4" labels={labels} {...props} />);

describe("VideoPlayer", () => {
  test("stopped: the first frame, a play key named after the file, its length, and the corner group", () => {
    let opened = 0;
    let saved = 0;
    player({
      onOpen: () => opened++,
      actions: (
        <button type="button" onClick={() => saved++}>
          Baixar
        </button>
      ),
    });
    const video = document.querySelector("video");
    // `#t`: the first frame shows before it plays; only its details load until then.
    expect(video?.getAttribute("src")).toBe("/f?version=2#t=0.001");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(screen.getByRole("button", { name: "Tocar: abertura.mp4" })).toBeTruthy();
    // No name over the picture (a picture's tile has none): only its length, once it is known.
    expect(document.querySelector(".ac-video__caption")).toBeNull();
    expect(document.querySelector(".ac-video__length")).toBeNull();
    Object.defineProperty(video, "duration", { configurable: true, value: 161 });
    fireEvent.loadedMetadata(video as HTMLVideoElement);
    expect(document.querySelector(".ac-video__length")?.textContent).toBe("2:41");
    // The bar waits, out of the tab order, until it plays.
    expect(document.querySelector(".ac-video__bar")?.hasAttribute("inert")).toBe(true);
    // The corner group: open in the viewer, then the caller's actions; a click there never plays the video.
    const group = document.querySelector(".ac-video__acts") as HTMLElement;
    expect(
      Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Abrir", "Baixar"]);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar" }));
    expect([opened, saved]).toEqual([1, 1]);
  });

  test("the viewer has no length badge and no corner button", () => {
    player({ variant: "viewer", onOpen: () => undefined });
    expect(document.querySelector(".ac-video__acts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir" })).toBeNull();
  });

  test("a video that can't play here says so to the caller", () => {
    let failed = 0;
    player({ onFailed: () => failed++ });
    const video = document.querySelector("video");
    if (!video) throw new Error("no video");
    fireEvent.error(video);
    expect(failed).toBe(1);
  });

  test("speed goes 1×, 1.5×, 2× and back", () => {
    player();
    const speed = () => screen.getByRole("button", { name: /^Velocidade/, hidden: true });
    expect(speed().textContent).toBe("1×");
    fireEvent.click(speed());
    expect(speed().textContent).toBe("1.5×");
    fireEvent.click(speed());
    fireEvent.click(speed());
    expect(speed().textContent).toBe("1×");
  });
});

describe("full screen", () => {
  test("the player marks itself while it is the full screen element, and unmarks when it leaves", () => {
    player();
    const root = document.querySelector(".ac-video") as HTMLElement;
    const setFull = (el: Element | null) => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: el });
      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });
    };
    try {
      setFull(root);
      expect(root.hasAttribute("data-full")).toBe(true);
      setFull(null);
      expect(root.hasAttribute("data-full")).toBe(false);
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
  });

  test("a chat tile in full screen leaves its 320 x 180 box: its video fills the screen", () => {
    // The browser stretches the full screen tile itself; the chat's fixed media box would otherwise stay in force
    // and leave a small video in the corner of a black screen.
    expect(rule(".ac-video--tile .ac-video__media")).toContain("width: 320px");
    expect(rule(".ac-video--tile .ac-video__media")).toContain("height: 180px");
    const media = rule(".ac-video--tile[data-full] .ac-video__media");
    expect(media).toContain("width: 100%");
    expect(media).toContain("max-width: none");
    expect(media).toContain("height: 100%");
    // Written after the rules it undoes.
    expect(css.indexOf("\n.ac-video--tile[data-full] .ac-video__media {")).toBeGreaterThan(
      css.indexOf("\n.ac-video--tile .ac-video__media {"),
    );
  });
});

describe("one thing plays at a time", () => {
  test("claiming stops the one before; releasing forgets it", () => {
    const stopped: string[] = [];
    const a = () => stopped.push("a");
    const b = () => stopped.push("b");
    claimPlayback(a);
    claimPlayback(b);
    expect(stopped).toEqual(["a"]);
    releasePlayback(b);
    stopPlayback();
    expect(stopped).toEqual(["a"]);
    claimPlayback(a);
    stopPlayback();
    expect(stopped).toEqual(["a", "a"]);
  });
});
