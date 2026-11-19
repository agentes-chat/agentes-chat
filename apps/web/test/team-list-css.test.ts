import { expect, test } from "bun:test";
import { builtCss, declarations } from "./built-css";

test("Equipe › Lista: the owner's name keeps one line and its column takes the name's width (rule 17)", async () => {
  const css = await builtCss("src/styles.css", "src/pages/team.css");
  const has = (selector: string, property: string, value: string) =>
    declarations(css, selector).some(([p, v]) => p === property && v === value);
  expect(has(".team-table__owner", "white-space", "nowrap")).toBe(true);
  expect(has(".team-table__owner", "width", "1%")).toBe(true);
  expect(has(".team-table__owner .team-who", "white-space", "nowrap")).toBe(true);
});
