#!/usr/bin/env node
// Sekura CLI entry point.
//
// Pattern B (GitHits solution_id e23755a3-56d5-4dd1-88cb-fe5d7bbb8297):
// detect --help / --version BEFORE initialising the MCP transport so the
// help text doesn't deadlock when this binary is launched as an MCP server.
// All logging goes to stderr; stdout is reserved for MCP framing.

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";
import { ciSetupCommand } from "./commands/ci-setup.js";
import { mcpCommand } from "./commands/mcp.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("sekura")
  .description(
    "AI-driven security scanning that runs in your GitHub Actions, with zero LLM-key configuration.\n\nDocs: https://sekura.ai/docs   Get started: npx sekura@latest init"
  )
  .version("0.1.0-alpha.0");

program.addCommand(initCommand);
program.addCommand(loginCommand);
program.addCommand(scanCommand);
program.addCommand(statusCommand);
program.addCommand(ciSetupCommand);
program.addCommand(mcpCommand);
program.addCommand(doctorCommand);

// Surface graceful shutdown so the MCP transport (stdio) flushes cleanly.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

await program.parseAsync(process.argv);
