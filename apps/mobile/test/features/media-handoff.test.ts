import { expect, test } from "bun:test";
import { HANDED_LINK_MS, handVideo, takeVideo } from "../../src/features/files/handoff";
import { viewerVersion } from "../../src/features/files/logic";

const link = { uri: "https://files.example/v.mp4", headers: { cookie: "s=1" } };

test("a video's tile hands its viewer its cover and its link, taken once", () => {
  handVideo("v1@3", link, 1_000, null, 2_000);
  expect(takeVideo("v1@3", 2_100)).toEqual({ source: link, frame: null });
  // Once: a second page (paged back to it) reads its own link.
  expect(takeVideo("v1@3", 2_200)).toBeUndefined();
});

test("a link too old to outlive the player isn't handed: the page reads its own, still on the cover", () => {
  handVideo("v2@1", link, 0, null, HANDED_LINK_MS + 1);
  expect(takeVideo("v2@1", HANDED_LINK_MS + 2)).toEqual({ source: null, frame: null });
});

test("a touch that didn't open hands nothing for long", () => {
  handVideo("v3@1", link, 0, null, 0);
  expect(takeVideo("v3@1", 11_000)).toBeUndefined();
});

test("the tile and the viewer's page agree on the version: the message's own first, else the details'", () => {
  expect(viewerVersion({ id: "a", version: 2 })).toBe(2);
  const detail = { kind: "file", title: "v.mp4", content: { kind: "file" }, shownVersion: 5, version: 5 } as never;
  expect(viewerVersion({ id: "a", version: 2, detail })).toBe(2);
  expect(viewerVersion({ id: "a", detail })).toBe(5);
});
