import { describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { fireEvent, render, within } from "@testing-library/react";
import { EffortPixels, Locked, OptionList } from "../src";

const steps = [
  { value: "low", label: "Baixo" },
  { value: "high", label: "Alto" },
];

describe("what a fieldset can't reach, inside Locked", () => {
  test("the effort slider's keys and look are off", () => {
    let picked = "";
    const { container } = render(
      <Locked when>
        <EffortPixels value="low" onValueChange={(v) => (picked = v)} steps={steps} label="Esforço" />
      </Locked>,
    );
    const slider = within(container).getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(picked).toBe("");
    expect(slider.getAttribute("aria-disabled")).toBe("true");
    expect(slider.tabIndex).toBe(-1);
  });

  test("an option list shows the look of its own disabled state", () => {
    const { container } = render(
      <Locked when>
        <OptionList
          aria-label="Quem"
          value="low"
          onValueChange={() => {}}
          options={steps.map((s) => ({ value: s.value, title: s.label }))}
        />
      </Locked>,
    );
    expect(container.querySelector(".ac-optlist--locked")).not.toBeNull();
  });
});

describe("an effort the model isn't sold at", () => {
  test("is greyed out, unclickable, and the keys go past it", () => {
    let picked = "";
    // The whole ladder: none and minimal are off for this model, the rest is what it offers.
    const scale = [
      { value: "none", label: "Nenhum", disabled: true },
      { value: "low", label: "Baixo" },
      { value: "minimal", label: "Mínimo", disabled: true },
      { value: "medium", label: "Médio" },
      { value: "high", label: "Alto" },
    ];
    const ramp = (value: string) => (
      <EffortPixels value={value} onValueChange={(v) => (picked = v)} steps={scale} label="Esforço" />
    );
    const { container, rerender } = render(ramp("low"));
    // The names are decorative for a screen reader (the slider speaks), so they are found by their place.
    const names = [...container.querySelectorAll<HTMLButtonElement>(".ac-effort__names button")];
    expect(names.map((b) => b.disabled)).toEqual([true, false, true, false, false]);
    fireEvent.keyDown(within(container).getByRole("slider"), { key: "ArrowRight" });
    expect(picked).toBe("medium");
    // Back from Médio: past Mínimo, onto Baixo.
    rerender(ramp("medium"));
    fireEvent.keyDown(within(container).getByRole("slider"), { key: "ArrowLeft" });
    expect(picked).toBe("low");
  });
});
