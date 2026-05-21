// `npx sekura ci-setup` — wire Sekura into a repo's GitHub Actions.
//
// Idempotent: if .github/workflows/sekura.yml already exists with matching
// content, the backend returns 200 with `already_configured: true`.

import { Command } from "commander";
import { loadToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export const ciSetupCommand = new Command("ci-setup")
  .description("Commit .github/workflows/sekura.yml to a repo (via the Sekura GitHub App).")
  .requiredOption("--repo <owner/name>", "Target repository")
  .option("--auto-pr", "Enable auto-fix-PR mode in the workflow (Pro tier)", false)
  .option("--mode <direct|pull-request>", "Commit directly or open a PR", "direct")
  .option("--api-url <url>", "override api.sekura.ai", "https://api.sekura.ai")
  .action(
    async (opts: { repo: string; autoPr: boolean; mode: string; apiUrl: string }) => {
      const token = await loadToken();
      if (!token) {
        console.error("Not signed in. Run `npx sekura login` first.");
        process.exit(4);
      }
      const api = new ApiClient(opts.apiUrl).withToken(token.access_token);
      const result = await api.ciSetup(opts.repo, {
        autoFixPr: opts.autoPr,
        commitMode: opts.mode,
      });
      if (result.already_configured) {
        console.error(`Already configured on ${opts.repo}.`);
      } else {
        console.error(`Workflow committed to ${opts.repo} (${result.commit_sha.slice(0, 7)}).`);
      }
    }
  );
