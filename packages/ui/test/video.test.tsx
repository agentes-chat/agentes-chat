import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { claimPlayback, releasePlayback, stopPlayback } from "../src/components/media-playback";
import { VideoPlayer, type VideoPlayerProps } from "../src/components/VideoPlayer";

afterEach(() => cleanup());

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

describe("a file's comments on the player (ADR 0208)", () => {
  test("onVideo hands over the element; onTime hears where it is and how long it is", () => {
    const heard: [number, number][] = [];
    let element: HTMLVideoElement | null = null;
    player({ variant: "viewer", onTime: (at, length) => heard.push([at, length]), onVideo: (v) => (element = v) });
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(element === video).toBe(true);
    expect(heard.at(-1)).toEqual([0, 0]);
    Object.defineProperty(video, "duration", { configurable: true, value: 161 });
    fireEvent.loadedMetadata(video);
    expect(heard.at(-1)).toEqual([0, 161]);
    Object.defineProperty(video, "currentTime", { configurable: true, value: 42 });
    fireEvent.seeked(video);
    expect(heard.at(-1)).toEqual([42, 161]);
    // Only when something changed.
    const before = heard.length;
    fireEvent.seeked(video);
    expect(heard.length).toBe(before);
  });

  test("marks sit beside the timeline, never inside its slider", () => {
    player({
      variant: "viewer",
      marks: (
        <button type="button" className="mark" style={{ left: "25%" }}>
          1
        </button>
      ),
    });
    const box = document.querySelector(".ac-video__seekbox") as HTMLElement;
    const slider = screen.getByRole("slider", { name: "Posição no vídeo", hidden: true });
    expect(box.contains(slider)).toBe(true);
    const marks = box.querySelector(".ac-video__marks") as HTMLElement;
    expect(marks.querySelector("button.mark")?.textContent).toBe("1");
    expect(slider.contains(marks)).toBe(false);
    expect(marks.contains(slider)).toBe(false);
  });

  test("with no marks, the timeline is as it was", () => {
    player({ variant: "viewer" });
    expect(document.querySelector(".ac-video__seekbox")).toBeNull();
    expect(document.querySelector(".ac-video__marks")).toBeNull();
    expect(screen.getByRole("slider", { name: "Posição no vídeo", hidden: true })).toBeTruthy();
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
