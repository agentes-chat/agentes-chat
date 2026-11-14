import { expect, test } from "bun:test";
import { createS3BlobStore } from "../src/s3";

const list = (keys: string[]) =>
  createS3BlobStore(
    {
      endpoint: "https://storage.example",
      region: "auto",
      bucket: "files",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      pathStyle: true,
    },
    {
      fetch: async () =>
        new Response(
          `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`,
        ),
    },
  ).list("files/");

test("S3 listings decode decimal and hexadecimal character references in object keys", async () => {
  expect(await list(["files/report&#32;final.txt", "files/&#x62A5;&#x544A;.pdf", "files/&#128640;.png"])).toEqual([
    "files/report final.txt",
    "files/报告.pdf",
    "files/🚀.png",
  ]);
});

test("entity references are decoded exactly once", async () => {
  expect(await list(["files/&amp;#32;.txt", "files/&lt;&gt;&quot;&apos;&amp;.txt"])).toEqual([
    "files/&#32;.txt",
    `files/<>"'&.txt`,
  ]);
});

test("unknown and invalid XML character references do not corrupt keys or throw", async () => {
  const keys = ["files/&other;.txt", "files/&#x110000;.txt", "files/&#xD800;.txt", "files/&#0;.txt"];
  expect(await list(keys)).toEqual(keys);
});
