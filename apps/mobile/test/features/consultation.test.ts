import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composerRequestFor,
  currentComposerRequest,
  requestComposerText,
  takeComposerRequest,
} from "../../src/features/chat/composer-request";
import { consultationHref } from "../../src/features/links/logic";

test("two agents' conversation opens on its screen, with the conversation that asked", () => {
  expect(consultationHref("q1", "c1")).toBe("/consultation/q1?channel=c1");
});

test("'Falar com o Theo' hands '@theo ' to that conversation's composer, once", () => {
  requestComposerText("c1", "@theo ");
  const asked = currentComposerRequest();
  expect(asked).toMatchObject({ channelId: "c1", text: "@theo " });
  // Only that conversation's screen takes it.
  expect(composerRequestFor(asked, "c1")).toBe(asked);
  expect(composerRequestFor(asked, "c2")).toBeNull();
  // A request that isn't the one waiting leaves it; the one waiting, taken, is gone.
  takeComposerRequest((asked?.at ?? 0) - 1);
  expect(currentComposerRequest()).toBe(asked);
  takeComposerRequest(asked?.at ?? 0);
  expect(currentComposerRequest()).toBeNull();
});

test("the two agents' line wraps their names whole, never clipped at a narrow width", () => {
  const group = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultGroup.tsx"), "utf8");
  const pair = group.slice(group.indexOf("<AgentFace agentId={askerId}"), group.indexOf("</Pressable>"));
  expect(pair).not.toContain("numberOfLines");
  expect(pair).not.toContain('ellipsizeMode="clip"');
  expect(group).toContain('flexWrap: "wrap",\n    justifyContent: "center",');
});

test("two agents' conversation is a sheet over the one that asked, as the web's dialog", () => {
  const layout = readFileSync(join(import.meta.dir, "../../app/(app)/_layout.tsx"), "utf8");
  expect(layout).toContain('<Stack.Screen name="consultation/[id]" options={formSheet} />');
  const screen = readFileSync(join(import.meta.dir, "../../src/features/chat/ConsultationScreen.tsx"), "utf8");
  expect(screen).toContain("<SheetSurface>");
  expect(screen).not.toContain("PushedHeader");
});

test("the composer names whom it writes to in its placeholder only: no face in an agent's field", () => {
  const composer = readFileSync(join(import.meta.dir, "../../src/ui/Composer.tsx"), "utf8");
  expect(composer).not.toMatch(/\bface\?:/);
  for (const screen of ["chat/ChatScreen.tsx", "computer/AgentScreen.tsx"])
    expect(readFileSync(join(import.meta.dir, "../../src/features", screen), "utf8")).not.toMatch(
      /\bface[=:]\s*[{<]<?AgentFace/,
    );
});
