# sekura

Connect your coding tool to [Sekura](https://sekura.ai) in one command.

```bash
npx sekura@latest init
```

Sekura is an AI red team as a service: it scans a GitHub repository you have granted it, exploits what it finds to prove each finding, and delivers a report. Its MCP server is remote, at `https://sekura.ai/mcp`, so this package runs no server. It writes that address into the coding tools on your machine and installs a skill that teaches the agent the quote-then-confirm rule. Then it finishes getting started right in the terminal: it signs you in once, waits while you accept the Terms and install the GitHub App, and lets you pick a repository. When you open your coding tool, Sekura already works.

`npx sekura@latest` on its own runs `init` too.

## What `init` does

1. **Detects** the tools on this machine: Claude Code, Cursor, GitHub Copilot in VS Code, OpenAI Codex, Kiro, Cline, Zed, Antigravity, OpenCode, JetBrains Junie, Factory Droid, Tabnine, Devin and Goose.
2. **Asks one question**, with every detected tool, your user configuration, the skill and the sign-in as the defaults: `Connect Claude Code, Cursor and OpenAI Codex for every project, with the skill, and sign in to Sekura?` Answer **Yes**, **No**, or **Edit** to choose the tools, every project or this project only, the skill, and the sign-in one by one. A flag answers its own question and skips it.
3. **Shows the plan** before anything happens: each file and the exact entry, or the tool's own command. The key isn't there yet, so the plan shows `Authorization: Bearer <your key, after sign-in>` where it will go (a key you already have is shown as `sek_live_…abcd`). Then it asks **Apply?**
4. **Signs you in** once you've said yes. You sign in with GitHub on sekura.ai and approve, and the CLI receives a Sekura key. On a machine whose browser is somewhere else (over SSH, in a devcontainer or Codespace, with `--device`, or when no browser opens), it prints a code instead: open `https://sekura.ai/connect/device` on any device and enter it. If the sign-in doesn't finish, the same plan is applied without a key, and each tool signs in the first time it uses Sekura.
5. **Applies** the plan with the key in it, one step at a time, and says what each step did. Files that are not plain JSON (Zed's `settings.json` with comments, for one) are never rewritten; you are shown the lines to add instead. Codex and Devin can't take a key in their configuration, so the CLI runs their own `mcp login`; since your browser is already signed in, that's one click.
6. **Checks** that the Sekura server answers.
7. **Gets you to a first scan**:
   - If your account still needs the Terms or email verification, it opens sekura.ai and carries on by itself once they are done.
   - If nothing can be scanned yet, or the repository in the current folder isn't covered, it offers to open the GitHub App install and carries on by itself once the repository shows up.
   - It lets you pick a repository, with the current folder's first.

   Each wait shows a one-line spinner, stops after five minutes, and Enter skips it.
8. **Tells you the next step in each tool**, such as "Cursor: restart Cursor (or reload MCP servers in Settings → MCP)" or "Claude Code: start a new Claude Code session, then type /sekura", and what to type to scan, such as `/sekura scan owner/repo` (`/sekura help` lists every command).

## What a scan costs

A scan started through the Sekura CLI, the MCP server or a coding tool is **Sekura Once at $199**. It is quoted first, with the price and the authorization wording, and starts only after you agree. Your first scan is free only when you start it yourself on the website, at [sekura.ai/app/start](https://sekura.ai/app/start). A recurring plan is Sekura Always, quoted the same way.

## Flags

| Flag | What it does |
|---|---|
| `-y, --yes` | No questions: every detected tool, user scope, the skill, and the key in `SEKURA_API_KEY` or the one `sekura login` saved. Signs in nowhere. |
| `--tools <ids>` | Only these, comma-separated: `claude`, `cursor`, `copilot`, `codex`, `kiro`, `cline`, `zed`, `antigravity`, `opencode`, `jetbrains`, `factory`, `tabnine`, `devin`, `goose`. |
| `--scope <user\|project>` | `user` (every project, the default) or `project` (this directory). |
| `--no-skill` | The MCP server only: no skill, no guidance block. |
| `--no-login` | No sign-in here; each tool opens a sekura.ai sign-in page the first time it uses Sekura. This is how 0.1.x worked. |
| `--device` | Sign in with a code on another device. The default over SSH (`SSH_CONNECTION`, `SSH_TTY`), in Codespaces, devcontainers (`REMOTE_CONTAINERS`) and Gitpod. `sekura login` takes it too. |
| `--dry-run` | Show the plan and change nothing. Never signs in and needs no key. |
| `--no-verify` | Don't check that the Sekura server answers. |
| `--endpoint <url>` | Use another Sekura server instead of `https://sekura.ai`, such as `https://dev.sekura.ai` or a local one at `http://127.0.0.1:8787`. The same as setting `SEKURA_ENDPOINT`. Works with every command. |

Project scope never writes the key, because project files get committed.

```bash
npx sekura@latest                       # the same as init
npx sekura@latest init --yes            # every detected tool, user scope, with the skill, no questions
npx sekura@latest init --dry-run        # show the plan and change nothing
npx sekura@latest init --scope project  # this project only: .mcp.json, .cursor/mcp.json, AGENTS.md …
npx sekura@latest init --tools claude,cursor --no-skill
npx sekura@latest init --no-login       # no sign-in here; each tool signs in on first use
npx sekura@latest init --device         # sign in with a code, for a terminal on another machine
npx sekura@latest login                 # sign in again, give connected tools the key, pick a repository
npx sekura@latest status                # what is connected, and who is signed in
npx sekura@latest logout                # forget the saved key
npx sekura@latest uninstall             # remove the entries, the skill, the guidance block and the saved key
SEKURA_API_KEY=sek_live_… npx sekura@latest init --yes   # unattended, with a key from Settings
```

## Another Sekura server

`SEKURA_ENDPOINT` (or `--endpoint`) points the sign-in, the server check, the links and the address written into each tool at another Sekura server:

```bash
SEKURA_ENDPOINT=https://dev.sekura.ai npx sekura@latest init
npx sekura@latest init --endpoint http://127.0.0.1:8787
```

The address must be `https://`, or `http://` for `127.0.0.1` or `localhost` only (use `127.0.0.1` for a local server). The default is `https://sekura.ai`. A key from another server is kept in its own file beside `credentials.json`, and a key saved for one server is never sent to another. Run `sekura init` again without the override to point your tools back at `https://sekura.ai`.

## What it writes

| Tool | User scope | Project scope |
|---|---|---|
| Claude Code | `claude mcp add --transport http -s user sekura …`, or `~/.claude.json` → `mcpServers.sekura` (always the file when it carries your key) | `.mcp.json` |
| Cursor | `~/.cursor/mcp.json` → `mcpServers.sekura` | `.cursor/mcp.json` |
| GitHub Copilot in VS Code | the VS Code user `mcp.json` → `servers.sekura` | `.mcp.json` |
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

Signing in creates one Sekura key, named "Sekura CLI (your computer's name)", whichever way you signed in (browser or code). The CLI saves it in `~/.config/sekura/credentials.json` (under `$XDG_CONFIG_HOME` when that is set) and writes it as an `Authorization: Bearer` header into each tool's user configuration. The key is stored in plain text. Every file the CLI writes it into, its own and each tool's, is set to mode 0600 (readable by you only), and `~/.config/sekura` to 0700; a tool that later rewrites its own file may set its own mode. On Windows the files keep the permissions of your user folder. The key never appears on a command line: for Claude Code it is written into `~/.claude.json` rather than passed to `claude mcp add`. `SEKURA_API_KEY` in the environment is used instead of the saved file when it is set. Nothing printed ever shows the whole key.

- **See or revoke it** at [sekura.ai/app/settings](https://sekura.ai/app/settings) → Agents and API keys. Revoking it there ends it everywhere at once; run `sekura login` for a new one.
- **`sekura logout`** removes the saved copy. Tools that were given the key keep it.
- **`sekura uninstall`** removes the entries (with their key), the skill, the guidance block and the saved copy.
- **`--no-login`** writes no key anywhere, as 0.1.x did.

Review before running: the source is this repository, the package is [`sekura` on npm](https://www.npmjs.com/package/sekura), and `--dry-run` prints every write the wizard would make.

## Every tool, by hand

The page at [sekura.ai/connect](https://sekura.ai/connect/) has the file or screen for every tool, including the ones this installer cannot reach (claude.ai, Replit, Lovable, Bolt, v0, and the rest).

## Help

Write to [support@sekura.ai](mailto:support@sekura.ai).

## Licence

MIT.
