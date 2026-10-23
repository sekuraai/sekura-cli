# sekura

Connect your coding tool to [Sekura](https://sekura.ai) in one command.

```bash
npx sekura@latest init
```

Sekura is an AI red team as a service: it scans a GitHub repository you have granted it, exploits what it finds to prove each finding, and delivers a report. Its MCP server is remote, at `https://sekura.ai/mcp`, so this package runs no server and holds no credential. It writes that address into the coding tools on your machine, installs a skill that teaches the agent the quote-then-confirm rule, and gets out of the way.

## What `init` does

1. **Detects** the tools on this machine: Claude Code, Cursor, GitHub Copilot in VS Code, OpenAI Codex, Kiro, Cline, Zed, Antigravity, OpenCode, JetBrains Junie, Factory Droid, Tabnine, Devin and Goose.
2. **Asks** which to connect, and whether for every project (your user configuration) or this project only.
3. **Shows the plan** before anything is written: each file and the exact entry, or the tool's own command.
4. **Applies** it, one step at a time, and says what each did. Files that are not plain JSON (Zed's `settings.json` with comments, for one) are never rewritten; you are shown the lines to add instead.
5. **Checks** that the Sekura server answers, and tells you how to sign in from each tool.

Signing in happens in the tool: the first time it uses Sekura, a sekura.ai page opens in your browser. Sign in with GitHub and approve. Nothing to copy.

```bash
npx sekura@latest init --yes            # every detected tool, user scope, with the skill, no questions
npx sekura@latest init --dry-run        # show the plan and change nothing
npx sekura@latest init --scope project  # this project only: .mcp.json, .cursor/mcp.json, AGENTS.md …
npx sekura@latest init --tools claude,cursor --no-skill
npx sekura@latest status                # what is connected
npx sekura@latest uninstall             # remove the entries, the skill and the guidance block
```

## What it writes

| Tool | User scope | Project scope |
|---|---|---|
| Claude Code | `claude mcp add --transport http -s user sekura …`, or `~/.claude.json` → `mcpServers.sekura` | `.mcp.json` |
| Cursor | `~/.cursor/mcp.json` → `mcpServers.sekura` | `.cursor/mcp.json` |
| GitHub Copilot (VS Code) | the VS Code user `mcp.json` → `servers.sekura` | `.mcp.json` |
| OpenAI Codex | `codex mcp add sekura --url …`, or `~/.codex/config.toml` → `[mcp_servers.sekura]` | — |
| Kiro | `~/.kiro/settings/mcp.json` | `.kiro/settings/mcp.json` |
| Cline | `~/.cline/data/settings/cline_mcp_settings.json` (shared by the extension, v4 and later, and the Cline CLI) | — |
| Zed | `~/.config/zed/settings.json` → `context_servers.sekura` (shown by hand when the file has comments) | — |
| Antigravity | `~/.gemini/config/mcp_config.json` → `serverUrl` | `.agents/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` → `mcp.sekura` | `opencode.json` |
| JetBrains Junie | — | `.junie/mcp/mcp.json` |
| Factory Droid, Tabnine, Devin | the tool's own `mcp add` command | — |
| Goose | `~/.config/goose/config.yaml` → `extensions.sekura` (`streamable_http`) | — |

The skill goes to `~/.agents/skills/sekura/SKILL.md` and, when Claude Code is present, `~/.claude/skills/sekura/SKILL.md`; in project scope to the same paths under the project, plus a section between `<!-- sekura:start -->` and `<!-- sekura:end -->` in `AGENTS.md` (and `CLAUDE.md` if one exists). Reruns replace only what sits between the markers.

## What stays untouched

- Every other server, setting and file. The installer sets one key, `sekura`, and reads nothing else.
- Your source code. Nothing is read, uploaded or committed.
- Your credentials. There is no login step and no token on disk; the sign-in is the tool's own OAuth flow with sekura.ai.

Review before running: the source is this repository, the package is [`sekura` on npm](https://www.npmjs.com/package/sekura), and `--dry-run` prints every write the wizard would make.

## Every tool, by hand

The page at [sekura.ai/connect](https://sekura.ai/connect/) has the file or screen for every tool, including the ones this installer cannot reach (claude.ai, Replit, Lovable, Bolt, v0, and the rest).

## Licence

MIT.
