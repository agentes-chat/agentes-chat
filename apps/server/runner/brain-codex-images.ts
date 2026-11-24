import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { CodexBrainEvent } from "./brain-codex";

export const CODEX_IMAGES_FOLDER = "generated-images";
const UUID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const THREAD_ID = new RegExp(`^${UUID}$`, "i");
const EXEC_IMAGE = new RegExp(`^exec-${UUID}\\.(png|jpeg|jpg|webp)$`, "i");

/** Codex exec writes the same thread's images here but omits them from its JSONL (CLI 0.169.0). */
export function codexExecImages(home: string, thread: string | undefined): string[] {
  if (!thread || !THREAD_ID.test(thread)) return [];
  const images = path.join(home, "generated_images");
  const dir = path.join(images, thread);
  try {
    if (!lstatSync(images).isDirectory() || !lstatSync(dir).isDirectory()) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((file) => file.isFile() && EXEC_IMAGE.test(file.name))
      .map((file) => file.name);
  } catch {
    return [];
  }
}

/** Hand new images to the same Drive upload used by app-server turns. */
export function codexExecImageEvents(
  home: string,
  thread: string,
  before: string[],
  folder: string,
): CodexBrainEvent[] {
  const newImages = codexExecImages(home, thread).filter((name) => !before.includes(name));
  if (newImages.length === 0) return [];
  const dir = path.join(folder, CODEX_IMAGES_FOLDER);
  try {
    mkdirSync(dir, { recursive: true });
    if (!lstatSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  const events: CodexBrainEvent[] = [];
  for (const name of newImages) {
    const relative = `${CODEX_IMAGES_FOLDER}/${name}`;
    try {
      copyFileSync(path.join(home, "generated_images", thread, name), path.join(dir, name), constants.COPYFILE_EXCL);
    } catch {
      continue;
    }
    events.push(
      {
        type: "tool_call",
        id: name,
        name: "image_generation",
        input: {},
        executed: { content: `Saved ${relative} in your folder.` },
      },
      { type: "file", path: relative },
    );
  }
  return events;
}
