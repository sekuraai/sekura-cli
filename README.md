# Sekura CLI

AI-driven security scanning that runs in **your** GitHub Actions runner — with zero LLM-key configuration. Source code never leaves GitHub; Sekura only sees prompts and responses (briefly, in the proxy).

```bash
npx sekura@latest init
```

That's the whole onboarding. Roughly 60 seconds end-to-end:

1. Detects Claude Code / Cursor / VS Code / Windsurf and registers Sekura as an MCP server in each.
2. Opens browser → OAuth via Sekura → tokens stored in your OS keychain.
3. Installs the Sekura GitHub App on your chosen repo (skipped if already installed).
4. Commits `.github/workflows/sekura.yml` to the repo's default branch.
5. Triggers your first scan; CLI exits — you're notified by email + IDE when it completes.

Subsequent scans happen automatically on every push and PR.

## Commands

| Command | What it does |
|---|---|
| `npx sekura init` | First-time setup. Idempotent. |
| `npx sekura login` | Re-authenticate (refresh credentials in keychain). |
| `npx sekura scan owner/repo [--type sast\|web\|full] [--auto-pr]` | Trigger an ad-hoc scan. |
| `npx sekura status [--scan-id <id>]` | List recent scans or show one. |
| `npx sekura ci-setup --repo owner/name [--auto-pr]` | Wire Sekura into a repo's CI. |
| `npx sekura mcp` | MCP server entry (invoked by IDEs, not by humans). |
| `npx sekura doctor` | Diagnose configuration issues. |

## Architecture (TL;DR)

```
You ──── npx ────▶ Sekura cloud (control plane + LLM proxy)
                      │
                      │  workflow_dispatch via GitHub App
                      ▼
                Your GitHub Actions runner runs the scan
                      │
                      ▼
                Findings → PR comments + SARIF + dashboard
```

The npm package itself is a ~5MB thin client; all heavy work happens on your runner (using the published `ghcr.io/sekuraai/sekura-cloud` Docker image) and our control plane.

See [`docs/distribution-model-plan.md`](https://github.com/sekura-ai/sekura-rs/blob/beta/sekura-rs/docs/distribution-model-plan.md) in the main repo for the full design.

## Pricing

- **Free**: public repos, SAST + crypto-agility, 2M LLM tokens/month.
- **Pro**: private repos, auto-fix PRs, 50M LLM tokens/month, HTML reports.
- **Enterprise**: DAST, self-hosted runner support, compliance frameworks, custom support.

LLM tokens are the only metered resource; runner minutes come out of your existing GitHub Actions quota (unlimited for public repos).

## License

AGPL-3.0-or-later. The CLI is open source; the backend services are operated by Sekura AI.
