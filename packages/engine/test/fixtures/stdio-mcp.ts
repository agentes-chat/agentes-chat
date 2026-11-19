import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

if (process.env.STDIO_PID_FILE) writeFileSync(process.env.STDIO_PID_FILE, String(process.pid));
if (process.argv.includes("--hang")) {
  setInterval(() => {}, 1000);
} else {
  const server = new McpServer({ name: "stdio-fixture", version: "1" });
  server.registerTool(
    "read_context",
    {
      description: "Read this test process's context",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pid: process.pid,
            cwd: process.cwd(),
            argument: process.argv.at(-1),
            value: process.env.STDIO_VALUE,
            inheritedSecret: process.env.STDIO_PARENT_SECRET !== undefined,
          }),
        },
      ],
    }),
  );
  await server.connect(new StdioServerTransport());
}
