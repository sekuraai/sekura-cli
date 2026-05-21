// `npx sekura doctor` — diagnose common configuration issues.
// Surfaced from the failed-first-scan recovery path in init.

import { Command } from "commander";
import { loadToken } from "../auth/keychain.js";
import { detectInstalledIdes } from "../ide-detect.js";
import { ApiClient } from "../auth/api.js";

export const doctorCommand = new Command("doctor")
  .description("Diagnose Sekura CLI configuration issues.")
  .option("--api-url <url>", "override api.sekura.ai", "https://api.sekura.ai")
  .action(async (opts: { apiUrl: string }) => {
    let healthy = true;

    const token = await loadToken();
    if (token) {
      console.error("✓ OAuth token present in keychain");
    } else {
      console.error("✗ No OAuth token (run `npx sekura login`)");
      healthy = false;
    }

    const ides = await detectInstalledIdes();
    if (ides.length > 0) {
      console.error(`✓ IDEs detected: ${ides.map((i) => i.name).join(", ")}`);
    } else {
      console.error("• No supported IDEs detected (Sekura still works via CLI)");
    }

    try {
      const api = new ApiClient(opts.apiUrl);
      const ok = await api.healthCheck();
      console.error(ok ? "✓ api.sekura.ai reachable" : "✗ api.sekura.ai unreachable");
      if (!ok) healthy = false;
    } catch (err) {
      console.error(`✗ api.sekura.ai error: ${(err as Error).message}`);
      healthy = false;
    }

    process.exit(healthy ? 0 : 1);
  });
