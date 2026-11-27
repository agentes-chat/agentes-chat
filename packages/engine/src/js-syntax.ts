/** JavaScript files, Google Apps Script and Google Ads Scripts (`.gs`) included. */
const JS_FILE = /\.(?:[cm]?jsx?|gs)$/i;

// The jsx loader also takes plain scripts, sloppy mode included (`with`, legacy octals).
const parser = new Bun.Transpiler({ loader: "jsx" });

type ParseMessage = { message?: string; position?: { line: number; column: number } | null };

/**
 * The first syntax error of a JavaScript file as "line L, column C: message", or null when it parses or isn't
 * JavaScript. Syntax only: a method the platform doesn't have still passes.
 */
export function jsSyntaxError(path: string, text: string): string | null {
  if (!JS_FILE.test(path)) return null;
  try {
    parser.scan(text);
    return null;
  } catch (error) {
    const first = (error instanceof AggregateError ? error.errors[0] : error) as ParseMessage | undefined;
    const at = first?.position;
    return `${at ? `line ${at.line}, column ${at.column}: ` : ""}${first?.message ?? String(error)}`;
  }
}
