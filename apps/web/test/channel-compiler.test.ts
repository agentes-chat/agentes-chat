import { expect, test } from "bun:test";
// @ts-expect-error @babel/core ships no types
import { transformSync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";

test("the built live chat stays outside React Compiler memoization", async () => {
  const file = new URL("../src/pages/ChannelPage.tsx", import.meta.url);
  const built = transformSync(await Bun.file(file).text(), {
    filename: file.pathname,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [[reactCompiler, {}]],
  });
  expect(built?.code).toBeDefined();
  expect(built?.code.includes("react/compiler-runtime")).toBe(false);
  expect(built?.code.includes("react.memo_cache_sentinel")).toBe(false);
});
