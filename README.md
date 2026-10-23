# sekura

Connect your coding tool to [Sekura](https://sekura.ai) in one command.

```bash
npx sekura@latest init
```

Sekura is an AI red team as a service: it scans a GitHub repository you have granted it, exploits what it finds to prove each finding, and delivers a report. Its MCP server is remote, at `https://sekura.ai/mcp`, so this package runs no server. It writes that address into the coding tools on your machine and installs a skill that teaches the agent the quote-then-confirm rule. Then it finishes getting started right in the terminal: it signs you in once, helps you install the GitHub App, and lets you pick a repository. When you open your coding tool, Sekura already works.

## What `init` does

1. **Detects** the tools on this machine: Claude Code, Cursor, GitHub Copilot in VS Code, OpenAI Codex, Kiro, Cline, Zed, Antigravity, OpenCode, JetBrains Junie, Factory Droid, Tabnine, Devin and Goose.
2. **Asks** which to connect, and whether for every project (your user configuration) or this project only.
3. **Signs you in** once, in your browser. You sign in with GitHub on sekura.ai and approve, and the CLI receives a Sekura key and gives it to each tool, so none of them asks you to sign in. Codex and Devin can't take a key in their configuration, so the CLI runs their own `mcp login` for you; since your browser is already signed in, that's one click.
4. **Shows the plan** before anything is written: each file and the exact entry (with the key shown as `sek_live_…abcd`), or the tool's own command.
5. **Applies** it, one step at a time, and says what each did. Files that are not plain JSON (Zed's `settings.json` with comments, for one) are never rewritten; you are shown the lines to add instead.
6. **Checks** that the Sekura server answers.
7. **Gets you to a first scan**:
   - It says what your account still needs (the Terms, or email verification).
   - It offers to install the Sekura GitHub App when nothing can be scanned yet, or when the repository in the current folder isn't covered.
   - It lets you pick a repository, with the current folder's first.
   - If your free first scan is still available, it opens sekura.ai so you can start it there.
8. **Tells you what to type** in each tool, such as `/sekura scan owner/repo` in Claude Code (`/sekura help` lists every command).

Skip the sign-in with `--no-login`; each tool then opens a sekura.ai sign-in page the first time it uses Sekura. Project scope never writes the key, because project files get committed.

```bash
npx sekura@latest init --yes            # every detected tool, user scope, with the skill, no questions
npx sekura@latest init --dry-run        # show the plan and change nothing
npx sekura@latest init --scope project  # this project only: .mcp.json, .cursor/mcp.json, AGENTS.md …
npx sekura@latest init --tools claude,cursor --no-skill
npx sekura@latest init --no-login       # no sign-in here; each tool signs in on first use
npx sekura@latest login                 # sign in again, give connected tools the key, pick a repository
npx sekura@latest status                # what is connected, and who is signed in
npx sekura@latest logout                # forget the saved key
npx sekura@latest uninstall             # remove the entries, the skill, the guidance block and the saved key
SEKURA_API_KEY=sek_live_… npx sekura@latest init --yes   # unattended, with a key from Settings
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
- Your source code isn't read or uploaded by this installer.

## Your key

Signing in creates one Sekura key, named "Sekura CLI (your computer's name)". You can see it and revoke it at [sekura.ai/app/settings](https://sekura.ai/app/settings) → Agents and API keys. The CLI saves it in `~/.config/sekura/credentials.json`, readable by you only, and writes it as an `Authorization: Bearer` header into each tool's user configuration. `sekura uninstall` removes both, and `sekura logout` removes the saved copy. Revoking the key in Settings ends it everywhere; run `sekura login` to get a new one.

Review before running: the source is this repository, the package is [`sekura` on npm](https://www.npmjs.com/package/sekura), and `--dry-run` prints every write the wizard would make.

## Every tool, by hand

The page at [sekura.ai/connect](https://sekura.ai/connect/) has the file or screen for every tool, including the ones this installer cannot reach (claude.ai, Replit, Lovable, Bolt, v0, and the rest).

## Licence

MIT.
