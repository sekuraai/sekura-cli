// `npx sekura scan owner/repo` — ad-hoc scan trigger.
//
// Thin wrapper over POST /v1/scan; the actual work happens on the user's
// GitHub Actions runner. Prints the run URL and exits — no streaming,
// notification arrives via email + MCP when the scan completes.

import { Command } from "commander";
import { loadToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export const scanCommand = new Command("scan")
  .description("Trigger a Sekura scan against a GitHub repo.")
  .argument("<repo>", "GitHub repo in owner/name form")
  .option("--type <scan-type>", "sast | web | full", "sast")
  .option("--severity <level>", "min severity to fail on (critical|high|medium|low)", "high")
  .option("--auto-pr", "open a fix PR if Pro tier permits", false)
  .option("--api-url <url>", "override api.sekura.ai", "https://api.sekura.ai")
  .action(
    async (
      repo: string,
      opts: { type: string; severity: string; autoPr: boolean; apiUrl: string }
    ) => {
      const token = await loadToken();
      if (!token) {
        console.error("Not signed in. Run `npx sekura login` first.");
        process.exit(4);
      }
      const api = new ApiClient(opts.apiUrl).withToken(token.access_token);
      const scan = await api.dispatchScan(repo, {
        scanType: opts.type,
        minSeverity: opts.severity,
        autoFixPr: opts.autoPr,
      });
      console.error(`Scan dispatched: ${scan.github_run_url}`);
      console.error(`Dashboard: ${scan.dashboard_url}`);
      console.error("You'll be notified when it completes.");
    }
  );
