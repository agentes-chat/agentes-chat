// A fake Antigravity CLI (`agy`) for runner tests. Each start appends its argv, cwd and the env that matters (its home,
// the MCP run and token, keys that must stay out) to $FAKE_AGY_LOG (one JSON line). Signed in: its token file,
// `antigravity-oauth-token` in $HOME/.gemini/antigravity-cli, as 1.5.0 keeps it with no keyring (JSON with its tokens
// and the home it signed in from; $FAKE_AGY_KEYRING: a file of its own instead, as a keyring would; $FAKE_AGY_BOUND:
// a copy in another home isn't signed in). `--version` prints a version line, `models` the models as Antigravity CLI
// 1.5.0 does (seen on Linux, 2026-11-11): "Fetching available models..." on stderr, then one model a line on stdout,
// its slug and name split by a tab; signed out "Please sign in…", an account Google won't serve "Eligibility check
// failed…", exit 1. $FAKE_AGY_CHECK, in a home named `.check` only (root's try of a copy): "slow" answers after a
// minute, "offline" can't reach Google.
// `acp --login` prints its Google sign-in link and prompt as 1.5.0 does and, as 1.5.x does, reads the pasted code only
// from its terminal (none: "no controlling terminal", exit 1), then exchanges it: a code with "bad" in it, or with paste
// marks it never turned on, is refused by Google (`invalid_grant`), one with "offline" can't reach Google, one with
// "ineligible" signs in an account `models` then refuses; else "Logged in as …", exit 0. `-p /usage` prints the
// quotas ($FAKE_AGY_REFRESH_MS: it refreshes its sign-in in place first, the file empty for that long), `-p /logout`
// signs out. `-p <prompt> --output-format stream-json` prints one turn: init (the conversation:
// `--conversation`'s, or a new one when it doesn't know that one; its tools: our server's alone with `--agent`, else
// the CLI's own and ours, or $FAKE_AGY_TOOLS; $FAKE_AGY_MCP_OFF: none of ours, as 1.5.15 does on a Gemini Enterprise
// seat with MCP servers off), a text delta, a shell step (none with "BRIDGE_ONLY"), a call to our server (a tool of the
// CLI's own with "OWN_TOOL"; none with MCP off), the last delta with usage and the result. "LIMIT": an AGY_ERROR
// quota line on stderr and exit 3. "ENV": the shell step's output is the env.
// With no arguments: the CLI's own screens, as 1.5.15 draws Gemini Enterprise's sign-in (seen on Linux, 2026-11-23):
// the login method, Google Cloud's sign-in method, Google's link (its text wrapped, whole only in its "Click here"
// hyperlink) and the code, the billing model, then the subscriptions ($FAKE_AGY_SUBSCRIPTIONS: "name|project|location"
// ones split by ";", empty for none); or, Pay As You Go, the project's field and the region (unnumbered rows). ↑/↓
// move the cursor, Enter picks. A picked subscription (or region) saves the sign-in with `auth_method` "gcp"
// ($FAKE_AGY_GIVES: another), its project, region and tier (none paid as you go), and its project in the settings,
// then goes on to the first-run setup until it is stopped. A code with "bad" in it: Google refuses it, on the screen.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
const dir = path.join(env.HOME ?? "/nonexistent", ".gemini", "antigravity-cli");
const auth = path.join(dir, "antigravity-oauth-token");
const keyring = path.join(dir, "fake-keyring.json");
/** The sign-in it keeps, if any. */
const stored = () => {
  const file = [auth, keyring].find((f) => existsSync(f));
  return file ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (env.FAKE_AGY_LOG) {
  appendFileSync(
    env.FAKE_AGY_LOG,
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      home: env.HOME ?? null,
      run: env.AGENTES_MCP_RUN ?? null,
      token: env.AGENTES_MCP_TOKEN ?? null,
      geminiKey: env.GEMINI_API_KEY ?? null,
      dbus: env.DBUS_SESSION_BUS_ADDRESS ?? null,
      updates: env.AGY_CLI_DISABLE_AUTO_UPDATE ?? null,
    })}\n`,
  );
}
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (args[0] === "--version") {
  process.stdout.write("agy 1.4.12\n");
  process.exit(0);
}
if (args[0] === "models") {
  process.stderr.write("Fetching available models...\n");
  if (path.basename(env.HOME ?? "") === ".check" && env.FAKE_AGY_CHECK === "slow") {
    await new Promise((r) => setTimeout(r, 60_000));
  }
  if (path.basename(env.HOME ?? "") === ".check" && env.FAKE_AGY_CHECK === "offline") {
    process.stderr.write(
      'Error: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host\n',
    );
    process.exit(1);
  }
  const token = stored();
  if (!token || (env.FAKE_AGY_BOUND && token.home !== env.HOME)) {
    process.stderr.write(
      "Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n",
    );
    process.exit(1);
  }
  if (token.ineligible) {
    process.stderr.write(
      "Error: Eligibility check failed: PERMISSION_DENIED (code 403): The caller does not have permission\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n",
  );
  process.exit(0);
}
if (args[0] === "acp" && args[1] === "--login") {
  process.stdout.write(
    "Open this link in a browser to log in with Google:\r\n\r\n  https://accounts.google.com/o/oauth2/auth?client_id=agy&state=s1\r\n\r\nThen paste the authorization code, or the full URL of the page you land on, and press Enter:\r\n",
  );
  if (!process.stdin.isTTY) {
    process.stderr.write("Error: no controlling terminal; cannot complete interactive login\n");
    process.exit(1);
  }
  let code = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    code += chunk;
    if (/[\r\n]/.test(code)) break;
  }
  if (!code.trim() || code.includes("\x1b") || code.includes("bad")) {
    process.stdout.write('\r\ncouldn\'t log in: token exchange failed: oauth2: "invalid_grant" "Bad Request"\r\n');
    process.exit(1);
  }
  if (code.includes("offline")) {
    process.stdout.write(
      '\r\ncouldn\'t log in: token exchange failed: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host\r\n',
    );
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  const token = { access_token: "fake-access", refresh_token: "fake-refresh", token_type: "Bearer", home: env.HOME };
  writeFileSync(
    env.FAKE_AGY_KEYRING ? keyring : auth,
    JSON.stringify(code.includes("ineligible") ? { ...token, ineligible: true } : token),
    { mode: 0o600 },
  );
  process.stdout.write("Logged in as ana@example.com.\r\n");
  process.exit(0);
}
if (args.length === 0) {
  if (!process.stdin.isTTY) {
    process.stderr.write("Error: no controlling terminal\n");
    process.exit(1);
  }
  const ESC = "\x1b";
  const BEL = "\x07";
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  const queue = [];
  let wake = null;
  process.stdin.on("data", (chunk) => {
    queue.push(chunk);
    wake?.();
  });
  const next = async () => {
    while (!queue.length) await new Promise((r) => (wake = r));
    return queue.shift();
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const draw = (lines) => process.stdout.write(`${ESC}[H${ESC}[2J${lines.join("\r\n")}\r\n`);
  const logo = ["", "     ▄▀▀▄", "    ▀▀▀▀▀▀", ""];
  const menu = async (heading, rows, before = [], numbered = true) => {
    let at = 0;
    for (;;) {
      const row = (r, i) => (numbered ? `${i + 1}. ${r}` : r);
      draw([
        ...logo,
        ...before,
        ` ${heading}:`,
        ...rows.map((r, i) => (i === at ? ` > ${row(r, i)}` : `${ESC}[4G${row(r, i)}`)),
        "",
        `${ESC}[4G${ESC}[94;1m↑/↓${ESC}[90;22m Navigate · ${ESC}[94;1menter${ESC}[90;22m Select${ESC}[m`,
      ]);
      const key = await next();
      if (key === `${ESC}[B`) at = Math.min(at + 1, rows.length - 1);
      else if (key === `${ESC}[A`) at = Math.max(at - 1, 0);
      else if (key.includes("\r")) return at;
    }
  };
  process.stdout.write(`${ESC}[?1049h${ESC}[?2004h`);
  const method = await menu(
    "Select login method",
    ["Google OAuth", "Use a Google Cloud project"],
    [" Welcome to the Antigravity CLI. You are currently not signed in.", ""],
  );
  if (method !== 1) process.exit(4);
  if ((await menu("Google Cloud sign-in method", ["Continue with Google Cloud", "Use advanced SSO config"])) !== 0) {
    process.exit(4);
  }
  const link =
    "https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=agy-gcp&prompt=consent&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform&state=s2";
  draw([
    ...logo,
    " Your browser should open automatically. If not:",
    ...(link.match(/.{1,72}/g) ?? []).map((l) => ` ${l}`),
    "",
    ` ${ESC}]8;;${link}${BEL}Click here${ESC}]8;;${BEL} to authenticate`,
    "",
    " If you aren't automatically redirected, paste the authorization code below:",
    " > ",
  ]);
  let code = "";
  while (!code.includes("\r")) code += await next();
  code = code.replace(`${ESC}[200~`, "").replace(`${ESC}[201~`, "").replace(/\r.*/s, "");
  if (!code.trim() || code.includes("bad")) {
    draw([...logo, ` couldn't log in: token exchange failed: oauth2: "invalid_grant" "Bad Request"`]);
    await new Promise(() => undefined);
  }
  draw([...logo, " ⣯  Signing in..."]);
  await pause(50);
  const billing = await menu("Select billing model", [
    "Subscriptions – Use Antigravity through your Gemini subscription.",
    "Pay As You Go – Pay only for the tokens you use, billed through Gemini platform.",
  ]);
  /** The sign-in saved as Google gives it, its project in the settings, then the first-run setup until stopped. */
  const signedIn = async (project, location, tier) => {
    draw([...logo, " ⣷  Signing in..."]);
    await pause(50);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      auth,
      JSON.stringify({
        token: { access_token: "fake-access", token_type: "Bearer", refresh_token: "fake-refresh", expires_in: 3599 },
        auth_method: env.FAKE_AGY_GIVES ?? "gcp",
        id_token_email: "ana@example.com",
        project_id: project,
        region: location,
        ...(tier ? { user_tier: tier } : {}),
        home: env.HOME,
      }),
      { mode: 0o600 },
    );
    const settingsFile = path.join(dir, "settings.json");
    const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
    writeFileSync(settingsFile, JSON.stringify({ ...settings, gcp: { project, location } }, null, 2));
    draw([...logo, " Welcome to Antigravity CLI", " Choose your color scheme:", " > terminal", "   light"]);
    await new Promise(() => undefined);
  };
  if (billing === 1) {
    // Pay As You Go: the project typed in its field (its placeholder while empty), echoed as it comes.
    let typed = "";
    for (;;) {
      draw([
        ...logo,
        " Provide Google Cloud project:",
        " Your Antigravity use will be associated with provided project. Make sure",
        " you trust the project ID before proceeding.",
        "",
        ` > ${typed || "my-gcp-project"}`,
      ]);
      const key = (await next()).replace(`${ESC}[200~`, "").replace(`${ESC}[201~`, "");
      if (key.includes("\r") && typed) break;
      for (const ch of key) {
        if (ch === "\x7f") typed = typed.slice(0, -1);
        else if (ch >= " ") typed += ch;
      }
    }
    const regions = ["global", "us", "eu"];
    const region = await menu("Choose region", regions, [], false);
    await signedIn(typed, regions[region], null);
  }
  draw([...logo, " ⣾  Fetching licenses..."]);
  await pause(50);
  const subscriptions = (env.FAKE_AGY_SUBSCRIPTIONS ?? "Gemini Enterprise Plus|demo-project|global")
    .split(";")
    .filter(Boolean)
    .map((s) => s.split("|"));
  const picked = await menu(
    "Select available subscription",
    [
      ...subscriptions.map(([name, project, location]) => `${name} (Project: ${project}, Location: ${location})`),
      "Can't find your subscription? Enter a Google Cloud project",
    ],
    [" Verify that these licenses were provided by your administrator and that you trust the project ID.", ""],
  );
  const [, project, location] = subscriptions[picked] ?? [];
  if (!project) process.exit(4);
  await signedIn(project, location, "gcp-ge-plus-tier");
}
if (args[0] === "-p" && args[1] === "/usage") {
  if (env.FAKE_AGY_REFRESH_MS && existsSync(auth)) {
    const whole = readFileSync(auth, "utf8");
    writeFileSync(auth, "");
    await new Promise((r) => setTimeout(r, Number(env.FAKE_AGY_REFRESH_MS)));
    writeFileSync(auth, whole);
  }
  process.stdout.write(
    "Model quotas\n\nGemini Models\nWeekly Limit Remaining\n75%\nFive Hour Limit Remaining\n40% · resets in 2h 30m\n\nClaude and GPT models\nWeekly Limit Remaining\n100%\n",
  );
  process.exit(0);
}
if (args[0] === "-p" && args[1] === "/logout") {
  for (const f of [auth, keyring]) rmSync(f, { force: true });
  process.exit(0);
}

if (args[0] === "-p") {
  const prompt = args[1] ?? "";
  if (!stored()) {
    process.stderr.write("Error: authentication required\n");
    process.exit(1);
  }
  const known = path.join(dir, "fake-conversations.json");
  const conversations = existsSync(known) ? JSON.parse(readFileSync(known, "utf8")) : [];
  let conversation = flag("--conversation");
  if (conversation && !conversations.includes(conversation)) {
    process.stderr.write(`warning: conversation ${conversation} not found, starting a new one\n`);
    conversation = undefined;
  }
  if (!conversation) {
    conversation = `c3b60000-0000-4000-8000-${String(conversations.length + 1).padStart(12, "0")}`;
    writeFileSync(known, JSON.stringify([...conversations, conversation]));
  }
  const mcpOff = Boolean(env.FAKE_AGY_MCP_OFF);
  const tools = (
    env.FAKE_AGY_TOOLS
      ? env.FAKE_AGY_TOOLS.split(",")
      : flag("--agent")
        ? ["agenteschat_agentes/post_message"]
        : ["ask_permission", "run_command", "write_to_file", "agenteschat_agentes/post_message"]
  ).filter((t) => !mcpOff || !t.startsWith("agenteschat_agentes"));
  const step = (o) => out({ event: "step_update", step_update: { conversation_id: conversation, ...o } });
  out({
    event: "init",
    conversation_id: conversation,
    init: {
      cwd: process.cwd(),
      tools,
      permission_mode: "request-review",
      ...(flag("--model") ? { model: flag("--model") } : {}),
    },
  });
  step({ step_index: 0, state: "DONE", step_type: "user_input" });
  if (prompt.includes("LIMIT")) {
    process.stderr.write(
      `AGY_ERROR: ${JSON.stringify({ status: "RESOURCE_EXHAUSTED", code: 429, retryable: true, message: "Quota exceeded for Gemini 4 Argon. Resets in 2h 5m." })}\n`,
    );
    out({ event: "result", result: { conversation_id: conversation, status: "ERROR", response: "", error: "quota" } });
    process.exit(3);
  }
  step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Let me check. " });
  if (!prompt.includes("BRIDGE_ONLY")) {
    step({
      step_index: 2,
      state: "DONE",
      step_type: "tool",
      tool_name: "run_command",
      tool_info: {
        name: "run_command",
        parameters: { CommandLine: "bun test" },
        output: prompt.includes("ENV") ? JSON.stringify(env) : "3 pass\n",
      },
    });
  }
  const call = prompt.includes("OWN_TOOL") ? "view_file" : mcpOff ? null : "agenteschat_agentes/post_message";
  if (call) {
    step({
      step_index: 3,
      state: "DONE",
      step_type: "tool",
      tool_name: call,
      tool_info: { name: call, parameters: {}, output: "ok" },
    });
  }
  step({
    step_index: 4,
    state: "DONE",
    step_type: "agent_response",
    text_delta: "All good.\n",
    usage: { input_tokens: 1000, output_tokens: 40, thinking_tokens: 30, cache_read_tokens: 400, total_tokens: 1040 },
  });
  out({
    event: "result",
    result: {
      conversation_id: conversation,
      status: "SUCCESS",
      response: "Let me check. All good.\n",
      num_turns: 1,
      usage: { input_tokens: 9000, output_tokens: 400, cache_read_tokens: 0, total_tokens: 9400 },
    },
  });
  process.exit(0);
}
process.exit(2);
