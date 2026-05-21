// `npx sekura login` — re-authenticate without rerunning the full init flow.
// Useful when a token expires or the user wants to switch accounts.

import { Command } from "commander";
import { runDeviceFlow } from "../auth/oauth.js";
import { storeToken } from "../auth/keychain.js";
import { ApiClient } from "../auth/api.js";

export const loginCommand = new Command("login")
  .description("Sign in to sekura.ai (refreshes credentials in your OS keychain).")
  .option("--no-browser", "Print the verification URL instead of opening it")
  .option("--api-url <url>", "Override api.sekura.ai (for staging)", "https://api.sekura.ai")
  .action(async (opts: { browser: boolean; apiUrl: string }) => {
    const api = new ApiClient(opts.apiUrl);
    const token = await runDeviceFlow(api, { openBrowser: opts.browser });
    await storeToken(token);
    const me = await api.withToken(token.access_token).me();
    console.error(`Signed in as ${me.email}`);
  });
