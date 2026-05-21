// `npx sekura mcp` — spawn the MCP server over stdio.
//
// Pattern B (GitHits solution_id e23755a3-56d5-4dd1-88cb-fe5d7bbb8297).
// This subcommand is what each IDE's MCP registration ultimately invokes
// (Claude Code / Cursor / VS Code / Windsurf). It exposes the Sekura tool
// surface — sekura.scan / sekura.status / sekura.findings / sekura.fix —
// as a thin RPC over api.sekura.ai.

import { Command } from "commander";
import { startMcpServer } from "../mcp/server.js";

export const mcpCommand = new Command("mcp")
  .description("Run the Sekura MCP server (used by Claude Code / Cursor / VS Code).")
  .option("--api-url <url>", "override api.sekura.ai", "https://api.sekura.ai")
  .action(async (opts: { apiUrl: string }) => {
    await startMcpServer({ apiUrl: opts.apiUrl });
  });
