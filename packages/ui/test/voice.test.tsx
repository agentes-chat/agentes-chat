import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VoicePlayer, type VoicePlayerProps } from "../src/components/VoicePlayer";
import { peaksOf } from "../src/components/voice-recorder";

const realAudio = globalThis.Audio;
afterEach(() => {
  cleanup();
  globalThis.Audio = realAudio;
});

/** The media elements the player makes; `fail()` is a load that went wrong (a 503, a dropped connection). */
function fakeAudio(play: () => Promise<void> = () => Promise.resolve()) {
  const made: { src: string; fail: () => void }[] = [];
  globalThis.Audio = class {
    currentTime = 0;
    playbackRate = 1;
    onerror: (() => void) | null = null;
    onended: (() => void) | null = null;
    constructor(readonly src: string) {
      made.push({ src, fail: () => this.onerror?.() });
    }
    play = play;
    pause() {}
  } as unknown as typeof Audio;
  return made;
}

const labels: VoicePlayerProps["labels"] = {
  play: "Ouvir",
  pause: "Pausar",
  seek: "Posição",
  speed: (s) => `Velocidade ${s}`,
  expired: "Áudio expirado",
  showText: "Ver texto",
  hideText: "Ocultar texto",
  cantPlay: "Não deu para tocar o áudio.",
  retry: "Tentar de novo",
};
const player = (props: Partial<VoicePlayerProps> = {}) =>
  render(<VoicePlayer src="/a" peaks={[0.2, 0.8]} durationMs={12_000} labels={labels} {...props} />);

describe("VoicePlayer", () => {
  test("one line of the words under the wave, opened in place and closed again", () => {
    player({ words: "as palavras" });
    expect(screen.getByRole("button", { name: "Ver texto" }).textContent).toBe("as palavras");
    fireEvent.click(screen.getByRole("button", { name: "Ver texto" }));
    expect(screen.queryByRole("button", { name: "Ver texto" })).toBeNull();
    expect(document.querySelector(".ac-voice__words p")?.textContent).toBe("as palavras");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar texto" }));
    expect(screen.getByRole("button", { name: "Ver texto" })).toBeTruthy();
  });

  test("no words, no button", () => {
    player({ words: null });
    expect(screen.queryByRole("button", { name: "Ver texto" })).toBeNull();
  });

  test("expired: no play, no seek, says so, and the words still open", () => {
    player({ expired: true, words: "as palavras" });
    expect(screen.queryByRole("button", { name: "Ouvir" })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(document.body.textContent).toContain("Áudio expirado");
    expect(screen.getByRole("button", { name: "Ver texto" })).toBeTruthy();
  });

  test("one that didn't load says so, and trying again loads it anew", async () => {
    const made = fakeAudio();
    player({ isGone: async () => false });
    fireEvent.click(screen.getByRole("button", { name: "Ouvir" }));
    await act(async () => made[0]?.fail());
    expect((await screen.findByRole("alert")).textContent).toContain("Não deu para tocar o áudio.");
    expect(screen.getByRole("button", { name: "Ouvir" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    // A new element: a new request, not the failed one again.
    expect(made.map((a) => a.src)).toEqual(["/a", "/a"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Pausar" })).toBeTruthy();
  });

  test("a pause before it started isn't a failure", async () => {
    fakeAudio(() => Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" })));
    player({ isGone: async () => false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ouvir" })));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("peaksOf", () => {
  test("at most 48 bars, scaled to the loudest", () => {
    const peaks = peaksOf(Array.from({ length: 500 }, (_, i) => (i % 100) / 200));
    expect(peaks.length).toBe(48);
    expect(Math.max(...peaks)).toBe(1);
  });
  test("a short recording keeps what it has", () => {
    expect(peaksOf([0.1, 0.2]).length).toBe(2);
    expect(peaksOf([])).toEqual([]);
  });
});
