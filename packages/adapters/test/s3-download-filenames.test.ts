import { expect, test } from "bun:test";
import { createS3BlobStore } from "../src/s3";

const store = createS3BlobStore({
  endpoint: "https://storage.example",
  region: "auto",
  bucket: "files",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  pathStyle: true,
});

test("signed downloads preserve Unicode names with an ASCII header fallback", async () => {
  const url = await store.signedUrl("report", { expiresInSeconds: 300, filename: "résumé-报告.pdf" });
  const disposition = new URL(url ?? "").searchParams.get("response-content-disposition");
  expect(disposition).toBe(
    `attachment; filename="r_sum_-__.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9-%E6%8A%A5%E5%91%8A.pdf`,
  );
});

test("extended filenames encode separators and control characters", async () => {
  const url = await store.signedUrl("report", { expiresInSeconds: 300, filename: "it's;\"a\\b\r\n.txt" });
  const disposition = new URL(url ?? "").searchParams.get("response-content-disposition");
  expect(disposition).toBe(`attachment; filename="it's__a_b__.txt"; filename*=UTF-8''it%27s%3B%22a%5Cb%0D%0A.txt`);
});

test("downloads without a filename do not override Content-Disposition", async () => {
  const url = await store.signedUrl("report", { expiresInSeconds: 300 });
  expect(new URL(url ?? "").searchParams.has("response-content-disposition")).toBe(false);
});
