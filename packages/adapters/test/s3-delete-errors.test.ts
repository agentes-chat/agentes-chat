import { expect, test } from "bun:test";
import { createS3BlobStore, StorageError } from "../src/s3";

const settings = {
  endpoint: "https://storage.example",
  region: "auto",
  bucket: "files",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  pathStyle: true,
};

test("deleting from a missing S3 bucket reports its configuration failure", async () => {
  const store = createS3BlobStore(settings, {
    fetch: async () =>
      new Response("<Error><Code>NoSuchBucket</Code><Message>Missing bucket</Message></Error>", { status: 404 }),
  });
  const result = await store.delete("orgs/test/file").catch((error: unknown) => error);
  expect(result).toBeInstanceOf(StorageError);
  expect((result as StorageError).code).toBe("bucket_missing");
});

test("deleting an already absent key remains idempotent", async () => {
  const store = createS3BlobStore(settings, {
    fetch: async () => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }),
  });
  await expect(store.delete("orgs/test/file")).resolves.toBeUndefined();
});

test("S3 delete still surfaces permission failures", async () => {
  const store = createS3BlobStore(settings, {
    fetch: async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }),
  });
  await expect(store.delete("orgs/test/file")).rejects.toMatchObject({ code: "permission" });
});
