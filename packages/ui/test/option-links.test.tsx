import { afterEach, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { OptionLinks } from "../src";

afterEach(() => cleanup());

test("each way is a button named by its title, described by its line, the recommended one with the kit's chip", () => {
  const picked: string[] = [];
  const { container } = render(
    <OptionLinks
      aria-label="Ways"
      options={[
        {
          value: "command",
          title: "With a command",
          tag: "The most complete",
          description: "Brings everything",
          onSelect: () => picked.push("command"),
        },
        {
          value: "prompt",
          title: "By asking",
          description: (
            <>
              It writes what it knows. <a href="https://example.com/help">How</a>
            </>
          ),
          onSelect: () => picked.push("prompt"),
        },
        {
          value: "more",
          title: "Other apps",
          end: "chevronDown",
          button: { "aria-expanded": false },
          onSelect: () => {},
        },
        { value: "off", title: "Not now", disabled: true, onSelect: () => picked.push("off") },
      ]}
    />,
  );
  const list = within(container).getByRole("list", { name: "Ways" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  const command = within(list).getByRole("button", { name: "With a command" });
  // Described by its chip and its line: the recommendation is heard on the button.
  const described = (b: HTMLElement) =>
    (b.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((i) => document.getElementById(i)?.textContent)
      .join(" | ");
  expect(described(command)).toBe("The most complete | Brings everything");
  // The recommended way: the kit's tag, beside the title, outside the button's name.
  const chips = list.querySelectorAll(".ac-chip.ac-chip--info");
  expect([...chips].map((c) => c.textContent)).toEqual(["The most complete"]);
  // A link in a line stays a link, never inside the button.
  const how = within(list).getByRole("link", { name: "How" });
  expect(how.closest("button")).toBeNull();
  fireEvent.click(command);
  fireEvent.click(within(list).getByRole("button", { name: "By asking" }));
  // A disabled way can't be picked.
  const off = within(list).getByRole("button", { name: "Not now" }) as HTMLButtonElement;
  expect(off.disabled).toBe(true);
  fireEvent.click(off);
  expect(picked).toEqual(["command", "prompt"]);
  expect(within(list).getByRole("button", { name: "Other apps" }).getAttribute("aria-expanded")).toBe("false");
  // Each row ends on a chevron: right for steps, down for more rows here.
  expect(list.querySelectorAll(".ac-optrow__go")).toHaveLength(4);
});

test("flat: the same rows as a box's list, marked for the kit's flat look; each lead in its column", () => {
  const { container } = render(
    <OptionLinks
      flat
      className="my-list"
      aria-label="Works"
      options={[
        { value: "support", title: "Support", leading: <span>icon</span>, side: "apps", onSelect: () => {} },
        { value: "other", title: "Other", onSelect: () => {} },
      ]}
    />,
  );
  const list = within(container).getByRole("list", { name: "Works" });
  expect([...list.classList]).toEqual(["ac-optlist", "ac-optlinks", "ac-optlinks--flat", "my-list"]);
  const [support, other] = within(list).getAllByRole("listitem");
  // A row with a picture keeps its column; one without has none.
  expect(support?.classList.contains("ac-optrow--lead")).toBe(true);
  expect(support?.querySelector(".ac-optrow__side")?.textContent).toBe("apps");
  expect(other?.classList.contains("ac-optrow--lead")).toBe(false);
  // Without `flat`, the cards it always had.
  cleanup();
  const { container: cards } = render(<OptionLinks options={[{ value: "a", title: "A", onSelect: () => {} }]} />);
  expect(cards.querySelector(".ac-optlinks--flat")).toBeNull();
});
