import { expect, test } from "bun:test";
import { artifactDownload, createFileArtifact } from "../src";
import { setup } from "./fixtures";

test("an uploaded file keeps its original name when requesting a signed download", async () => {
  const f = await setup();
  try {
    const name = "résumé-报告.pdf";
    const file = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "Report",
      name,
      bytes: new TextEncoder().encode("report"),
    });
    let filename: string | undefined;
    f.platformBlobs.signedUrl = async (_key, options) => {
      filename = options.filename;
      return "https://storage.example/signed-report";
    };
    const download = await artifactDownload(f.artifactDeps, f.owner.id, f.org.id, file.id);
    expect(filename).toBe(name);
    expect(download.url).toBe("https://storage.example/signed-report");
  } finally {
    await f.close();
  }
});
