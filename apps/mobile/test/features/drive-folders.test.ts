import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "../..", path), "utf8");

describe("the phone's Drive folders", () => {
  test("a folder is its own screen: the route passes it, the screen lists its folders, its path and its files", () => {
    expect(read("app/(app)/(main)/drive/index.tsx")).toContain("folderId={isSafeId(folder) ? folder : null}");
    const screen = read("src/features/drive/DriveScreen.tsx");
    expect(screen).toContain("{here ? <FolderPath trail={trail} /> : null}");
    expect(screen).toContain("<FolderRows folders={subfolders} onMenu={mayUpload ? arrange.folderMenu : null} />");
    expect(screen).toContain('title={t("drive.folderEmptyTitle")}');
    // Uploads land in the folder shown.
    expect(screen).toContain("useDriveUpload(list.refetch, folderId)");
  });

  test("who adds to the Drive makes folders and moves or renames files from a long press", () => {
    const screen = read("src/features/drive/DriveScreen.tsx");
    expect(screen).toContain("onPress: () => arrange.newFolder(folderId)");
    expect(screen).toContain("{...(mayUpload ? { onLongPress: arrange.fileMenu } : {})}");
    const folders = read("src/features/drive/folders.tsx");
    expect(folders).toContain('label: t("drive.moveToMenu")');
    expect(folders).toContain("folderAndInside(all, movingFolder)");
  });
});
