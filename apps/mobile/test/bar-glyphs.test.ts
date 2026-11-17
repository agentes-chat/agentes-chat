import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSvg } from "../src/ui/iconSvg";

const src = (file: string) => readFileSync(join(import.meta.dir, "../src", file), "utf8");

describe("the system's bar buttons draw our line icons", () => {
  test("an icon as Icon draws it: the 24 grid, stroke 1.7, round caps, one color", () => {
    const laptop = iconSvg("laptop");
    // The rasterizer sizes the document by this exact width and height.
    expect(laptop).toMatch(/\swidth="24"\s+height="24"/);
    expect(laptop).toContain('viewBox="0 0 24 24"');
    expect(laptop).toContain(
      '<rect x="5" y="5" width="14" height="10" rx="1.8" fill="none" stroke="#000" stroke-width="1.7"/>',
    );
    expect(laptop).toContain(
      '<path d="M3 18.5h18" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    );
    // The "…" is three filled dots.
    expect(iconSvg("more").match(/<circle [^>]*fill="#000"\/>/g)).toHaveLength(3);
  });

  test("every system bar button takes our icon, a menu's rows keep the system's symbols", () => {
    const bar = src("ui/headerActions.tsx");
    expect(bar.match(/icon: barIcon\(a\),/g)).toHaveLength(3);
    expect(bar).toContain('icon: { type: "sfSymbol" as const, name: m.sf },');
    expect(bar).toContain(
      'return glyph ? { type: "image" as const, source: glyph } : { type: "sfSymbol" as const, name: sf };',
    );
    // The same size as an IconButton's icon, so a bar of ours (a counted button showing) looks the same.
    expect(src("ui/barGlyphs.ts")).toContain("const BAR_GLYPH_PT = 20;");
  });
});
