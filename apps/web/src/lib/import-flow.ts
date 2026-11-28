import type { PickedFile } from "@/lib/import";
import { filesFromDrop } from "@/lib/obsidian";

export * from "@agenteschat/client/lib/import/flow";
export { CARD_MARK } from "@/lib/import-marks";

/** A drop as the import reads it: the files, or every file in the dropped folders, with its path. */
export async function droppedFiles(dt: DataTransfer): Promise<PickedFile[]> {
  // The entries are only readable during the drop event: both reads below start before any await.
  const folders = Array.from(dt.items ?? []).some((i) => i.webkitGetAsEntry?.()?.isDirectory);
  if (!folders) return Array.from(dt.files);
  const files = await filesFromDrop(dt);
  return Promise.all(files.map(async (f) => ({ path: f.path, file: await f.blob() })));
}
