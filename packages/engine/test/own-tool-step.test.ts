import { expect, test } from "bun:test";
import { ownToolStep } from "../src/executor";

test("VPS Zen: a computer brain's own call becomes one line of what it did, never its output", () => {
  expect(ownToolStep({ id: "a", name: "Bash", input: { command: "bun test", description: "Roda os testes" } })).toEqual(
    {
      toolUseId: "a",
      name: "Bash",
      detail: "Roda os testes",
    },
  );
  expect(ownToolStep({ id: "b", name: "Edit", input: { file_path: "/x/app.ts", old_string: "a" } })).toEqual({
    toolUseId: "b",
    name: "Edit",
    detail: "/x/app.ts",
  });
  expect(ownToolStep({ id: "c", name: "Bash", input: { command: "false" }, result: { isError: true } })).toMatchObject({
    detail: "false",
    isError: true,
  });
  expect(ownToolStep({ id: "d", name: "ToolSearch", input: {} })).toBeNull();
});
