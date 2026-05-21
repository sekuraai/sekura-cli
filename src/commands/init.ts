// `npx sekura@latest init` — the most critical surface area of the product.
//
// Target: under 60 seconds for users with the Sekura GitHub App already
// installed; under 90 seconds for first-time install. See the
// second-by-second script in docs/distribution-model-plan.md
// "First-Time UX" section.

import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import open from "open";
import { detectInstalledIdes, registerMcpServer } from "../ide-detect.js";
import { runDeviceFlow } from "../auth/oauth.js";
import { storeToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export const initCommand = new Command("init")
  .description("Sign in, link a GitHub repo, and run your first Sekura scan.")
  .option("--no-browser", "Print the verification URL instead of opening it")
  .option("--api-url <url>", "Override api.sekura.ai (for staging)", "https://api.sekura.ai")
  .action(async (opts: { browser: boolean; apiUrl: string }) => {
    console.error("");
    console.error("  Sekura — security audits, every commit");
    console.error("");

    // t≈0–2s: detect IDEs
    const ides = await detectInstalledIdes();
    if (ides.length === 0) {
      console.error(
        "  Note: no supported AI tool detected (Claude Code, Cursor, VS Code, Windsurf)."
      );
      console.error("  Sekura will still work; just no MCP integration to register.");
    } else {
      console.error(`  Found ${ides.map((i) => i.name).join(", ")}. I'll wire Sekura into all of them.`);
    }

    // t≈4–15s: OAuth device flow
    console.error("  Opening browser to sign you in…");
    const api = new ApiClient(opts.apiUrl);
    const token = await runDeviceFlow(api, { openBrowser: opts.browser });
    await storeToken(token);
    const me = await api.withToken(token.access_token).me();
    console.error(`  ✓ Signed in as ${me.email}`);

    // t≈16s: list repos via the GitHub App; if empty, prompt to install
    let repos = await api.withToken(token.access_token).listRepos();
    if (repos.length === 0) {
      console.error("");
      console.error("  Install the Sekura GitHub App to scan your repos.");
      console.error("  Opening https://github.com/apps/sekura/installations/new …");
      if (opts.browser) await open("https://github.com/apps/sekura/installations/new");
      // Poll for the installation.created webhook to fire on the backend.
      // The backend signals readiness once it persists the installation_id.
      repos = await api.withToken(token.access_token).pollForRepos(180_000);
    }

    if (repos.length === 0) {
      console.error("  No repos available after install. Run `npx sekura init` again to retry.");
      process.exit(1);
    }

    // t≈20s: pick a repo
    const chosen = await select({
      message: "Which repo do you want to scan first?",
      choices: repos.slice(0, 25).map((r) => ({ name: r.full_name, value: r.full_name })),
    });

    // t≈22–25s: backend commits the workflow file + sets SEKURA_TOKEN secret
    // + fires workflow_dispatch.
    console.error(`  Scanning ${chosen}. Setting up the workflow now.`);
    const setup = await api.withToken(token.access_token).ciSetup(chosen, { autoFixPr: false });
    const scan = await api.withToken(token.access_token).dispatchScan(chosen, { scanType: "sast" });

    // t≈25s: register MCP across detected IDEs (idempotent)
    for (const ide of ides) {
      await registerMcpServer(ide);
    }

    // t≈27s: print summary + exit
    console.error("");
    console.error(`  ✓ Signed in as ${me.email}`);
    console.error(`  ✓ Sekura GitHub App installed on ${chosen}`);
    console.error(`  ✓ .github/workflows/sekura.yml committed (${setup.commit_sha.slice(0, 7)})`);
    console.error(`  ✓ First scan dispatched: ${scan.github_run_url}`);
    if (ides.length > 0) {
      console.error(`  ✓ MCP server registered in ${ides.map((i) => i.name).join(", ")}`);
    }
    console.error("");
    console.error("  Your scan is running now (~3–5 min). You can:");
    console.error("    • Close this terminal — we'll email you when it's done");
    console.error("    • Check status: `npx sekura status`");
    console.error(`    • Watch live: ${scan.github_run_url}`);
    console.error(`    • Open dashboard: ${scan.dashboard_url}`);
    console.error("");
  });
