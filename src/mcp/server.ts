// Sekura MCP server (Pattern B — GitHits solution_id e23755a3-…).
//
// Exposes four tools (sekura.scan / sekura.status / sekura.findings /
// sekura.fix) plus a long-poll loop that surfaces scan-complete
// notifications inline in the IDE's chat session. All log lines go to
// stderr; stdout is reserved for the MCP framing.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export interface McpOptions {
  apiUrl: string;
}

export async function startMcpServer(opts: McpOptions): Promise<void> {
  const token = await loadToken();
  if (!token) {
    console.error("Sekura MCP server: not signed in. Run `npx sekura login` first.");
    process.exit(4);
  }
  const api = new ApiClient(opts.apiUrl).withToken(token.access_token);

  const server = new Server(
    { name: "sekura", version: "0.1.0-alpha.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sekura.scan",
        description: "Trigger a Sekura security scan against a GitHub repo.",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/name" },
            scan_type: {
              type: "string",
              enum: ["sast", "web", "full"],
              default: "sast",
            },
            auto_fix_pr: { type: "boolean", default: false },
          },
          required: ["repo"],
        },
      },
      {
        name: "sekura.status",
        description: "Get the status of a Sekura scan (or list recent ones).",
        inputSchema: {
          type: "object",
          properties: { scan_id: { type: "string" } },
        },
      },
      {
        name: "sekura.findings",
        description: "Return full findings for a Sekura scan.",
        inputSchema: {
          type: "object",
          properties: { scan_id: { type: "string" } },
          required: ["scan_id"],
        },
      },
      {
        name: "sekura.fix",
        description: "Open an auto-fix PR for a finding (Pro tier).",
        inputSchema: {
          type: "object",
          properties: {
            scan_id: { type: "string" },
            finding_id: { type: "string" },
          },
          required: ["scan_id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    switch (req.params.name) {
      case "sekura.scan": {
        const result = await api.dispatchScan(args.repo as string, {
          scanType: (args.scan_type as string) ?? "sast",
          autoFixPr: (args.auto_fix_pr as boolean) ?? false,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "sekura.status": {
        const data = args.scan_id
          ? await api.getScan(args.scan_id as string)
          : await api.listRecentScans();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "sekura.findings": {
        const scan = await api.getScan(args.scan_id as string);
        return { content: [{ type: "text", text: JSON.stringify(scan, null, 2) }] };
      }
      case "sekura.fix":
        return {
          content: [{ type: "text", text: "sekura.fix wiring lands with services/github-app." }],
        };
      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        };
    }
  });

  // Background long-poll for scan-complete notifications. When the backend
  // signals a completion, push a `notifications/message` event onto the MCP
  // channel — the IDE renders it inline ("Sekura finished scanning …").
  void runNotificationLoop(api, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sekura MCP server ready.");
}

async function runNotificationLoop(api: ApiClient, server: Server): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    try {
      const res = await api.longPollNotifications(cursor, 25);
      cursor = res.cursor || cursor;
      for (const notification of res.notifications) {
        try {
          await server.sendLoggingMessage({
            level: "info",
            data: notification,
          });
        } catch {
          // transport may have closed — exit the loop
          return;
        }
      }
    } catch {
      // Network blip — back off and retry.
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
