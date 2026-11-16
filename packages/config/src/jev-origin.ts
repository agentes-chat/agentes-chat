import { z } from "zod";

/**
 * A bare HTTP(S) origin: a host, with at most a root slash after it. Judged on the raw text: zod's `url()` and WHATWG
 * `URL` both normalize (they drop tabs and newlines, read backslashes as slashes, trim controls), so a value that is
 * normalized first would be accepted as something other than what was sent.
 */
export function isJevOrigin(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  const authority = value.match(/^https?:\/\/([^/?#]+)\/?$/i)?.[1];
  if (!authority || authority.includes("@")) return false;
  try {
    const url = new URL(value);
    return url.hostname.length > 0 && url.username === "" && url.pathname === "/";
  } catch {
    return false;
  }
}

export const jevOriginSchema = z
  .string()
  .refine(isJevOrigin, "Expected an HTTP(S) origin without a path, query, fragment or userinfo")
  .pipe(z.url({ protocol: /^https?$/i }))
  .transform((value) => new URL(value).origin);
