// `npx sekura status` — show recent scan status without leaving the terminal.

import { Command } from "commander";
import { loadToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export const statusCommand = new Command("status")
  .description("Show recent Sekura scans and their status.")
  .option("--scan-id <id>", "Show details for a specific scan")
  .option("--api-url <url>", "override api.sekura.ai", "https://api.sekura.ai")
  .action(async (opts: { scanId?: string; apiUrl: string }) => {
    const token = await loadToken();
    if (!token) {
      console.error("Not signed in. Run `npx sekura login` first.");
      process.exit(4);
    }
    const api = new ApiClient(opts.apiUrl).withToken(token.access_token);
    if (opts.scanId) {
      const scan = await api.getScan(opts.scanId);
      console.log(JSON.stringify(scan, null, 2));
    } else {
      const list = await api.listRecentScans();
      for (const s of list) {
        console.log(`${s.id}  ${s.status.padEnd(10)}  ${s.repo}  ${s.created_at}`);
      }
    }
  });
