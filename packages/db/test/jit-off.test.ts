import { expect, test } from "bun:test";
import { createDatabase } from "../src/client";

test("the server's pool starts its sessions with JIT off; the URL may turn it back on", async () => {
  // postgres.js connects on the first query: none is sent here.
  const plain = createDatabase({ url: "postgres://u:p@127.0.0.1:1/x", poolMax: 1 });
  const on = createDatabase({ url: "postgres://u:p@127.0.0.1:1/x?jit=on", poolMax: 1 });
  try {
    expect(plain.client?.options.connection).toMatchObject({ jit: "off" });
    expect(on.client?.options.connection).toMatchObject({ jit: "on" });
  } finally {
    await plain.close();
    await on.close();
  }
});
