import { describe, expect, test } from "bun:test";
import { LOGO_PLATES } from "@agenteschat/ui/org-logo";

/** The first run's own CSS (ADR 0256: `layer/first-run/`), and the app's shared one. */
const firstRunCss = () => Bun.file(new URL("../src/layer/first-run/first-run.css", import.meta.url).pathname).text();
const ruleIn = (css: string) => (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0];

describe("equal side padding", () => {
  test("blocks with visible edges span their column, so no cap leaves the right side wider than the left", async () => {
    const rule = ruleIn(await firstRunCss());
    // The first run: a company's server's field and found servers, the numbered steps, where it will be used, the
    // owner's fields.
    for (const selector of [
      ".dk-first__address",
      ".dk-first__found",
      ".dk-first__numbered",
      ".dk-first__picks",
      ".dk-first__fields",
    ]) {
      expect({ selector, rule: rule(selector) !== undefined }).toEqual({ selector, rule: true });
      expect(rule(selector)).not.toContain("max-width");
    }
    // The setup's steps and the bar, shared with the other screens.
    const shared = ruleIn(await Bun.file(new URL("../src/styles.css", import.meta.url).pathname).text());
    for (const selector of [".dk-fr__steps", ".dk-bar"]) {
      expect(shared(selector)).toBeDefined();
      expect(shared(selector)).not.toContain("max-width");
    }
  });
});

describe("a company's server: its found servers", () => {
  test("its tiles and Use buttons sit in the column's edges, as the field above does", async () => {
    const rule = ruleIn(await firstRunCss());
    expect(rule(".dk-first__foundrow")).toContain("padding: 9px 0;");
    expect(rule(".dk-first__foundrow + .dk-first__foundrow")).toContain("border-top: 1px solid var(--line);");
  });
});

describe("Run here's frame", () => {
  test("the band, the step's column that scrolls, and the footer that stays", async () => {
    const rule = ruleIn(await firstRunCss());
    expect(rule(".dk-flow")).toContain("grid-template-rows: 168px minmax(0, 1fr) auto;");
    expect(rule(".dk-flow__scroll")).toContain("overflow-y: auto;");
    expect(rule(".dk-flow__foot")).toContain("border-top: 1px solid var(--line);");
  });

  test("how the phone and the team get here: rows with a hairline, no card and no bar behind them (ADR 0256 §4)", async () => {
    const css = await Bun.file(new URL("../src/ui/reach-way.css", import.meta.url).pathname).text();
    const rule = ruleIn(css);
    expect(rule(".dk-way")).toContain("border-top: 1px solid var(--line);");
    expect(rule(".dk-way__item")).toContain("border-bottom: 1px solid var(--line);");
    for (const selector of [".dk-way", ".dk-way__item", ".dk-way__row", ".dk-way__part"]) {
      expect(rule(selector)).not.toContain("background");
      expect(rule(selector)).not.toContain("border-left");
      expect(rule(selector)).not.toContain("max-width");
    }
  });

  test("where it will be used: rows with a hairline, no card behind them", async () => {
    const rule = ruleIn(await firstRunCss());
    expect(rule(".dk-first__pick")).toContain("border-bottom: 1px solid var(--line);");
    expect(rule(".dk-first__pick")).not.toContain("background");
    expect(rule(".dk-first__pick")).not.toContain("border-left");
  });
});

describe("switch rows", () => {
  test("a switch's label is regular weight, lighter than a field's label; other row titles stay bold", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url).pathname).text();
    const rule = (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";
    expect(rule(".dk-crow__title")).toContain("font-weight: 600;");
    expect(rule(".dk-crow:has(> .dk-crow__end > .ac-switch) .dk-crow__title")).toContain("font-weight: 400;");
  });
});

test("an organization's logo shows whole, on the web's plate: only where the surface would hide its ink", async () => {
  const css = await Bun.file(new URL("../src/styles.css", import.meta.url).pathname).text();
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";
  expect(rule(".dk-org--logo")).toContain("object-fit: contain;");
  expect(rule(".dk-org--logo")).toContain("background: none;");
  expect(rule('.dk-org--logo[data-ink="light"]')).toContain(`background: ${LOGO_PLATES.lightInk};`);
  expect(rule('[data-theme="dark"] .dk-org--logo')).toContain(`background: ${LOGO_PLATES.darkInk};`);
  expect(rule('[data-theme="dark"] .dk-org--logo[data-ink="light"]')).toContain("background: none;");
});
