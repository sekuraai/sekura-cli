// IDE detection + MCP registration.
//
// Walks well-known config paths for Claude Code, Cursor, VS Code, and
// Windsurf, then writes a `sekura` MCP server entry into each one
// idempotently (preserves any existing MCP registrations).

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface DetectedIde {
  name: string;
  mcpConfigPath: string;
}

const home = homedir();

function vsCodeConfigDir(): string {
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Code", "User");
    case "win32":
      return join(process.env.APPDATA ?? home, "Code", "User");
    default:
      return join(home, ".config", "Code", "User");
  }
}

const KNOWN_IDES: DetectedIde[] = [
  { name: "Claude Code", mcpConfigPath: join(home, ".claude", "mcp.json") },
  { name: "Cursor", mcpConfigPath: join(home, ".cursor", "mcp.json") },
  { name: "VS Code", mcpConfigPath: join(vsCodeConfigDir(), "mcp.json") },
  { name: "Windsurf", mcpConfigPath: join(home, ".windsurf", "mcp.json") },
];

export async function detectInstalledIdes(): Promise<DetectedIde[]> {
  return KNOWN_IDES.filter((ide) => existsSync(dirname(ide.mcpConfigPath)));
}

/**
 * Register Sekura as an MCP server in the given IDE. Idempotent — if a
 * `sekura` entry already exists it's overwritten with the current command;
 * other server entries are preserved untouched.
 */
export async function registerMcpServer(ide: DetectedIde): Promise<void> {
  const command = "npx";
  const args = ["-y", "sekura@latest", "mcp"];

  type McpFile = { mcpServers?: Record<string, { command: string; args: string[] }> };
  let existing: McpFile = {};
  if (existsSync(ide.mcpConfigPath)) {
    try {
      existing = JSON.parse(await readFile(ide.mcpConfigPath, "utf8")) as McpFile;
    } catch {
      // corrupted file — overwrite rather than nuke silently
      existing = {};
    }
  }
  existing.mcpServers ??= {};
  existing.mcpServers.sekura = { command, args };

  await mkdir(dirname(ide.mcpConfigPath), { recursive: true });
  await writeFile(ide.mcpConfigPath, JSON.stringify(existing, null, 2));
}
