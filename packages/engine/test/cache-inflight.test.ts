import { afterEach, expect, test } from "bun:test";
import { enableCaches, TtlCache } from "../src/cache";

afterEach(() => enableCaches(false));

test.each(["delete", "deletePrefix", "clear"] as const)(
  "%s prevents an in-flight read from restoring stale data",
  async (op) => {
    enableCaches();
    const cache = new TtlCache<string>(30_000);
    const load = Promise.withResolvers<string>();
    const stale = cache.getOrLoad("org:member", () => load.promise);
    cache.apply(op, op === "deletePrefix" ? "org:" : "org:member");
    load.resolve("old access");
    expect(await stale).toBe("old access");
    expect(cache.get("org:member")).toBeUndefined();
    expect(await cache.getOrLoad("org:member", async () => "new access")).toBe("new access");
  },
);

test("an invalidated read cannot overwrite a newer cached read", async () => {
  enableCaches();
  const cache = new TtlCache<string>(30_000);
  const load = Promise.withResolvers<string>();
  const stale = cache.getOrLoad("org:member", () => load.promise);
  cache.delete("org:member");
  await cache.getOrLoad("org:member", async () => "new access");
  load.resolve("old access");
  await stale;
  expect(cache.get("org:member")).toBe("new access");
});

test("invalidating another organization leaves an in-flight read cacheable", async () => {
  enableCaches();
  const cache = new TtlCache<string>(30_000);
  const load = Promise.withResolvers<string>();
  const reading = cache.getOrLoad("org:member", () => load.promise);
  cache.deletePrefix("another:");
  load.resolve("access");
  await reading;
  expect(cache.get("org:member")).toBe("access");
});

test("turning caching off while a read waits does not populate it on completion", async () => {
  enableCaches();
  const cache = new TtlCache<string>(30_000);
  const load = Promise.withResolvers<string>();
  const reading = cache.getOrLoad("org:member", () => load.promise);
  enableCaches(false);
  load.resolve("access");
  await reading;
  expect(cache.get("org:member")).toBeUndefined();
});
