import { expect, mock, test } from "bun:test";

mock.module("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    bytes = async () => new TextEncoder().encode(`bytes of ${this.uri}`);
  },
}));

const { uploadPart } = await import("../src/lib/upload-part");

// expo/fetch refuses React Native's `{ uri }` form part: the part must carry `bytes()` and no `uri`.
test("a phone file becomes a part with bytes(), its name and type", async () => {
  const part = uploadPart({ uri: "file:///cache/a.pdf", name: "a.pdf", type: "application/pdf" }) as unknown as {
    name: string;
    type: string;
    uri?: string;
    bytes: () => Promise<Uint8Array>;
  };
  expect(part.name).toBe("a.pdf");
  expect(part.type).toBe("application/pdf");
  expect(part.uri).toBeUndefined();
  expect(new TextDecoder().decode(await part.bytes())).toBe("bytes of file:///cache/a.pdf");
});
