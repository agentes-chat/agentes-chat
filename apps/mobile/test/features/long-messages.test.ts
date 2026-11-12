import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (file: string) => readFileSync(join(import.meta.dir, "../../src", file), "utf8");

describe("long messages on the phone", () => {
  test("a tall message clips by the rule the web uses, and opens whole in the screen's sheet with a copy", () => {
    const clip = src("features/chat/ClippedMessage.tsx");
    expect(clip).toContain('import { clippedHeight } from "@agenteschat/client/lib/message-length"');
    expect(clip).toMatch(/const shows = sheet \? clippedHeight\(height\) : null;/);
    expect(clip).toMatch(/sheet\?\.open\(/);
    expect(clip).toContain("copyText(body)");
    // A fade, never an ellipsis: no line count cuts the words.
    expect(clip).not.toContain("numberOfLines");
    const row = src("features/chat/MessageRow.tsx");
    expect(row.match(/<ClippedMessage /g)?.length).toBe(2);
  });

  test("a failed message says why and offers one way out; the toast says the cause too", () => {
    const row = src("features/chat/MessageRow.tsx");
    expect(row).toContain("{sendFailureText(t, m.sendFailure, i18n.language)}");
    expect(row).toContain('t(sendNeedsEdit(m.sendFailure) ? "channel.editSend" : "channel.retrySend")');
    const screen = src("features/chat/ChatScreen.tsx");
    expect(screen).toContain('if (!waits) toast({ title: errorText(t, error, i18n.language), icon: "x" });');
    expect(screen).toMatch(/else if \(sendNeedsEdit\(m\.sendFailure\)\) \{[\s\S]*?setCaptionBack\(\{ text: m\.body/);
    // The row leaves the list, so its text must reach the field even when something is being typed there.
    expect(screen).toContain("setCaptionBack({ text: m.body, at: Date.now(), join: true });");
    expect(src("ui/Composer.tsx")).toContain("prefill.join ? joinDrafts(handed, current)");
  });

  test("the field holds a draft past the limit, says the sizes and offers it as a file", () => {
    const composer = src("ui/Composer.tsx");
    expect(composer).toContain("const tooLong = tooLongToSend(text);");
    expect(composer).toContain("if ((!value && !sendEmpty) || tooLong) return;");
    expect(composer).toContain("{tooLongText(t, i18n.language, text.trim().length)}");
    expect(composer).toContain('t("channel.tooLong.asFile")');
    expect(src("features/chat/ChatScreen.tsx")).toContain('new File(dir, t("channel.tooLong.fileName"))');
  });
});
