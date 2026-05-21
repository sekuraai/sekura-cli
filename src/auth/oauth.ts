// RFC 8628 OAuth 2.0 device authorization grant — for headless CLI auth.
// Pattern A (GitHits solution_id bd3e787b-26ff-4e15-90b7-7fa973e01c8a).

import open from "open";
import type { ApiClient } from "./api.js";

export interface DeviceCodeBundle {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenBundle {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  /** ISO-8601 timestamp; computed locally, not from the server. */
  acquired_at: string;
}

export async function runDeviceFlow(
  api: ApiClient,
  opts: { openBrowser: boolean }
): Promise<AccessTokenBundle> {
  // 1. Request a device code.
  const bundle = await api.beginDeviceAuthorization();

  const url = bundle.verification_uri_complete ?? bundle.verification_uri;
  console.error(`  Open: ${url}`);
  console.error(`  Code: ${bundle.user_code}`);
  if (opts.openBrowser) {
    try {
      await open(url);
    } catch {
      // Headless environment — user copies the URL by hand.
    }
  }

  // 2. Poll the token endpoint.
  const deadline = Date.now() + bundle.expires_in * 1000;
  let interval = Math.max(1, bundle.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const result = await api.pollDeviceToken(bundle.device_code);
    if (result.kind === "ok") {
      return { ...result.token, acquired_at: new Date().toISOString() };
    }
    if (result.kind === "slow_down") {
      interval = Math.min(interval + 5000, 30_000);
      continue;
    }
    if (result.kind === "authorization_pending") {
      continue;
    }
    // access_denied | expired_token | invalid_request
    throw new Error(`OAuth device flow failed: ${result.kind}`);
  }
  throw new Error("OAuth device code expired before approval. Run `npx sekura login` again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
