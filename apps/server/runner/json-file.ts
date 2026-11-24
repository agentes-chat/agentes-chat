import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, renameSync, writeSync } from "node:fs";

/** The file's JSON, or null when it is missing or not JSON. */
export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * A file's JSON when it is a plain file of at most `maxBytes`, else null. Never waits on a pipe put in its place, reads
 * no more than the size it had when opened, and follows a link only when `follow`: root reads folders an agent's user
 * had, where a blocked open would hang it, a file that keeps growing would fill its memory, and a link could point
 * anywhere. With `owner`, only a file of that user's.
 */
export function readSmallJson(file: string, maxBytes: number, follow = false, owner?: number): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (follow ? 0 : (constants.O_NOFOLLOW ?? 0)) | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes || (owner !== undefined && st.uid !== owner)) return null;
    const bytes = Buffer.alloc(st.size);
    return JSON.parse(bytes.toString("utf8", 0, readSync(fd, bytes, 0, st.size, 0)));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Written whole (mode 600), then renamed: a crash never leaves half a file. The temporary is one this call creates
 * (`O_EXCL`) and writes through its own descriptor, so a link an agent's user left under the name — the folder may be
 * lent to one while root writes (ADR 0059 §8) — is never followed: the bytes land in a file this call made, and the
 * rename puts them where they belong. A temporary left behind by a runner that died is skipped, never reopened.
 */
export function writeJson(file: string, data: unknown) {
  const bytes = Buffer.from(JSON.stringify(data));
  for (let attempt = 0; ; attempt++) {
    const tmp = `${file}.${process.pid}.${attempt}.tmp`;
    let fd: number;
    try {
      fd = openSync(
        tmp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    } catch (error) {
      // Anything else (a folder root can't write) is the caller's to see.
      if (attempt < 4 && error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
    try {
      let at = 0;
      while (at < bytes.byteLength) at += writeSync(fd, bytes, at, bytes.byteLength - at);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    return;
  }
}
