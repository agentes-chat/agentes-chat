import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const mode = process.env.FAKE_COMPARISON_MODE;
const say = (body) => process.stdout.write(`${JSON.stringify(body)}\n`);
if (args.includes("--input-format") || args.includes("app-server")) {
  if (process.env.FAKE_COMPARISON_PROBE_LOG) writeFileSync(process.env.FAKE_COMPARISON_PROBE_LOG, JSON.stringify(args));
  for await (const line of createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line);
    if (msg.type === "control_request") {
      const response =
        msg.request.subtype === "initialize"
          ? {}
          : {
              rate_limits_available: true,
              rate_limits: {
                five_hour: { utilization: mode === "full" ? 100 : 10 },
                seven_day: { utilization: 10 },
                ...(mode === "unknown" ? {} : { extra_usage: { is_enabled: mode === "paid" } }),
              },
            };
      say({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response } });
    } else if (msg.id) {
      say({
        id: msg.id,
        result:
          msg.method === "account/read"
            ? { account: { type: mode === "key" ? "apiKey" : "chatgpt" } }
            : msg.method === "account/rateLimits/read"
              ? {
                  rateLimits: {
                    primary: { usedPercent: mode === "full" ? 100 : 10, windowDurationMins: 300 },
                    ...(mode === "unknown" ? {} : { credits: { hasCredits: mode === "paid", unlimited: false } }),
                  },
                }
              : {},
      });
    }
  }
} else {
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  if (process.env.FAKE_COMPARISON_LOG)
    appendFileSync(
      process.env.FAKE_COMPARISON_LOG,
      JSON.stringify({
        args,
        cwd: process.cwd(),
        prompt,
        apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? null,
        configHome: process.env.CODEX_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? null,
      }) + "\n",
    );
  const json = { text: "A contained response" };
  if (args.includes("exec")) {
    writeFileSync(flag("-o"), JSON.stringify(json));
    say({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } });
  } else {
    readFileSync(flag("--system-prompt-file"), "utf8");
    say({
      structured_output: json,
      modelUsage: { [`claude-${flag("--model")}-5-5`]: {} },
      usage: { input_tokens: 10, output_tokens: 4 },
    });
  }
  if (mode === "exit-fail") process.exitCode = 1;
}
