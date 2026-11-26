import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { fileSaver } from "@/components/artifacts/fileSaver";
import { TeamWelcome } from "@/pages/onboarding/CelebrateStep";
import type { ShellFace } from "@/pages/onboarding/Shell";
import { type TeamPhotoInput, teamPhoto } from "@/pages/onboarding/team-photo";
import { createFakeApi, seedState } from "./fake-api";
import { renderPage, screen, settle } from "./render";

/*
 * The celebration after Checkout (ADR 0162): "Download the team photo" draws the photo with its words in the browser
 * and saves it through the app's saver, named after the workspace. The drawing itself needs a real canvas: here it is
 * swapped, and what it was asked to draw is checked.
 */

const realDraw = teamPhoto.draw;
const realSave = fileSaver.save;
const realObjectUrl = URL.createObjectURL;
afterEach(() => {
  cleanup();
  teamPhoto.draw = realDraw;
  fileSaver.save = realSave;
  URL.createObjectURL = realObjectUrl;
});

const LODI: ShellFace = { id: "lodi", name: "Lodi", look: { color: "teal", accessory: "headphones" } };
const CAIO: ShellFace = { id: "caio", name: "Caio", look: { color: "amber", accessory: "hat" } };

async function celebrate(personal = false) {
  return renderPage(
    <TeamWelcome
      org="Acme Saúde"
      person={{ name: "Ana Souza", image: null }}
      first="Ana"
      lodi={LODI}
      team={[CAIO]}
      plan="Equipe"
      personal={personal}
      aiDone={false}
      toAi
      people={personal ? null : false}
      deliveries={3}
      onNext={() => {}}
    />,
    { api: createFakeApi(seedState()) },
  );
}

/** The drawing, held until the test lets it finish; what it was asked to draw. */
function heldDrawing() {
  const asked: TeamPhotoInput[] = [];
  let finish: (fail?: boolean) => void = () => {};
  teamPhoto.draw = (input) => {
    asked.push(input);
    return new Promise<Blob>((resolve, reject) => {
      finish = (fail) => (fail ? reject(new Error("no canvas")) : resolve(new Blob(["png"], { type: "image/png" })));
    });
  };
  return { asked, finish: (fail?: boolean) => finish(fail) };
}

function savedFiles() {
  const saved: [string, string][] = [];
  URL.createObjectURL = () => "blob:team-photo";
  fileSaver.save = (url, name) => saved.push([url, name]);
  return saved;
}

const press = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle();
};

describe("the team's photo to download", () => {
  test("draws the photo with its words, waits while it draws, then saves it named after the workspace", async () => {
    const drawing = heldDrawing();
    const saved = savedFiles();
    await celebrate();
    const button = screen().getByRole("button", { name: "Baixar a foto do time" }) as HTMLButtonElement;
    // In the box's footer, beside the step's one button.
    expect(button.closest(".ac-dialog__foot-note")).toBeTruthy();
    await press(button);

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    const [input] = drawing.asked;
    expect(input?.cast.map((a) => a.id)).toEqual(["lodi", "caio"]);
    expect(input?.person).toEqual({ name: "Ana Souza", image: null });
    expect(input?.say).toBe("Oi, Ana! A gente começa hoje.");
    expect(input?.eyebrow.startsWith("Time da Acme Saúde · desde ")).toBe(true);
    expect(input?.title).toBe("Boas-vindas ao time da Acme Saúde");
    // The picture names the person, where the page says "Você".
    expect(input?.lead).toBe("Ana, o Lodi e o Caio. A partir de hoje, trabalhando juntos, de dia e de noite.");
    expect(document.querySelector(".onbx__lead")?.textContent?.startsWith("Você, o Lodi e o Caio.")).toBe(true);
    expect(saved).toEqual([]);

    await act(async () => drawing.finish());
    await settle();
    expect(saved).toEqual([["blob:team-photo", "time-acme-saude.png"]]);
    expect(button.disabled).toBe(false);
  });

  test("a personal workspace's says whose team it is, and its file is the person's own", async () => {
    const drawing = heldDrawing();
    const saved = savedFiles();
    await celebrate(true);
    await press(screen().getByRole("button", { name: "Baixar a foto do seu time" }));
    expect(drawing.asked[0]?.title).toBe("Boas-vindas ao seu time");
    expect(drawing.asked[0]?.eyebrow.startsWith("Seus agentes · desde ")).toBe(true);
    await act(async () => drawing.finish());
    await settle();
    expect(saved).toEqual([["blob:team-photo", "meu-time.png"]]);
  });

  test("a photo that couldn't be made says so, saves nothing, and can be tried again", async () => {
    const drawing = heldDrawing();
    const saved = savedFiles();
    await celebrate();
    const button = screen().getByRole("button", { name: "Baixar a foto do time" }) as HTMLButtonElement;
    await press(button);
    await act(async () => drawing.finish(true));
    await settle();
    expect(screen().getByText("Não deu para criar a foto. Tente de novo.")).toBeTruthy();
    expect(saved).toEqual([]);
    expect(button.disabled).toBe(false);
  });
});
