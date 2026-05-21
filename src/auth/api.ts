// HTTP client for api.sekura.ai (the Sekura control plane).
//
// Thin RPC wrapper — every method maps 1:1 onto a route defined in
// src/api/routes/{cloud_scan,ci_setup,cloud_oauth,cloud_notifications}.rs
// in the sekura-rs repo (which currently returns 501 — wire-up happens
// alongside Phase 2 backend work).

import type { DeviceCodeBundle } from "./oauth.js";

export interface Repo {
  full_name: string;
  default_branch?: string;
  private?: boolean;
}

export interface ScanDispatchResult {
  scan_id: string;
  github_run_url: string;
  dashboard_url: string;
}

export interface CiSetupResult {
  commit_sha: string;
  secret_set: boolean;
  action_url: string;
  already_configured?: boolean;
}

export interface ScanRecord {
  id: string;
  status: string;
  repo: string;
  created_at: string;
}

export interface MeResponse {
  email: string;
  tenant_id: string;
  subscription_tier: string;
}

export type DeviceTokenPoll =
  | { kind: "ok"; token: { access_token: string; refresh_token?: string; token_type: string; expires_in: number } }
  | { kind: "authorization_pending" }
  | { kind: "slow_down" }
  | { kind: "access_denied" | "expired_token" | "invalid_request" };

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  withToken(token: string): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  // ── Auth / identity ────────────────────────────────────────────────

  async beginDeviceAuthorization(): Promise<DeviceCodeBundle> {
    return this.fetch<DeviceCodeBundle>("POST", "/v1/oauth/device");
  }

  async pollDeviceToken(deviceCode: string): Promise<DeviceTokenPoll> {
    const res = await fetch(`${this.baseUrl}/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    if (res.ok) {
      return { kind: "ok", token: await res.json() };
    }
    if (res.status === 400) {
      const body = (await res.json()) as { error?: string };
      const err = body.error ?? "invalid_request";
      if (err === "authorization_pending") return { kind: "authorization_pending" };
      if (err === "slow_down") return { kind: "slow_down" };
      return { kind: err as DeviceTokenPoll["kind"] };
    }
    throw new Error(`Token poll failed: ${res.status}`);
  }

  async me(): Promise<MeResponse> {
    return this.fetch<MeResponse>("GET", "/v1/me");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Repos ──────────────────────────────────────────────────────────

  async listRepos(): Promise<Repo[]> {
    const res = await this.fetch<{ repos: Repo[] }>("GET", "/v1/repos");
    return res.repos ?? [];
  }

  /**
   * Poll until GitHub App installation completes (webhook persists
   * installation_id) and repos become available, or timeout elapses.
   */
  async pollForRepos(timeoutMs: number): Promise<Repo[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const repos = await this.listRepos();
      if (repos.length > 0) return repos;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return [];
  }

  // ── Scan lifecycle ─────────────────────────────────────────────────

  async dispatchScan(
    repo: string,
    opts: { scanType?: string; minSeverity?: string; autoFixPr?: boolean; ref?: string } = {},
  ): Promise<ScanDispatchResult> {
    return this.fetch<ScanDispatchResult>("POST", "/v1/scan", {
      repo,
      scan_type: opts.scanType,
      min_severity: opts.minSeverity,
      auto_fix_pr: opts.autoFixPr ?? false,
      ref: opts.ref,
    });
  }

  async getScan(scanId: string): Promise<unknown> {
    return this.fetch("GET", `/v1/scan/${encodeURIComponent(scanId)}`);
  }

  async listRecentScans(): Promise<ScanRecord[]> {
    const res = await this.fetch<{ scans: ScanRecord[] }>("GET", "/v1/scans?limit=20");
    return res.scans ?? [];
  }

  // ── CI/CD setup ────────────────────────────────────────────────────

  async ciSetup(
    repo: string,
    opts: { autoFixPr?: boolean; commitMode?: string } = {},
  ): Promise<CiSetupResult> {
    return this.fetch<CiSetupResult>("POST", "/v1/ci/setup", {
      repo,
      auto_fix_pr: opts.autoFixPr ?? false,
      commit_mode: opts.commitMode ?? "direct",
    });
  }

  // ── Notifications (long-poll for MCP push) ─────────────────────────

  async longPollNotifications(
    since: string | undefined,
    waitSecs: number,
  ): Promise<{ notifications: unknown[]; cursor: string }> {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    params.set("wait", String(waitSecs));
    return this.fetch("GET", `/v1/notifications?${params.toString()}`);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private async fetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }
}
