// The tools `sekura init` can reach, and how each one takes a remote MCP
// server. One entry per tool, in the order of https://sekura.ai/connect/
// (docs/connector-master.md's order of reach). The config shapes are the
// ones the website's catalogue documents and tests against each vendor's
// docs (sekura-www, src/marketing/content/connect-tools.ts); a shape typed
// here that differs from the website's would be a connector that installs
// but never connects, so change both or neither.
//
// A tool is "present" when its config directory exists or its binary is on
// PATH. Presence decides what the wizard offers, never what it writes: the
// person chooses, and a tool they did not choose is not touched.

import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, delimiter } from 'node:path'

export const ENDPOINT = 'https://sekura.ai/mcp'
export const SERVER_NAME = 'sekura'
export const DOCS = 'https://sekura.ai/connect/'

/** The home directory, overridable for tests. */
export const home = (): string => process.env.SEKURA_HOME || homedir()

/** VS Code's user directory, where Copilot's `mcp.json` and Cline's settings live. */
export function codeUserDir(h = home()): string {
  switch (platform()) {
    case 'darwin': return join(h, 'Library', 'Application Support', 'Code', 'User')
    case 'win32': return join(process.env.APPDATA || join(h, 'AppData', 'Roaming'), 'Code', 'User')
    default: return join(process.env.XDG_CONFIG_HOME || join(h, '.config'), 'Code', 'User')
  }
}

const xdg = (h: string) => process.env.XDG_CONFIG_HOME || join(h, '.config')

/** Goose's config directory: ~/.config/goose on macOS and Linux (Goose uses
 *  the XDG layout on both), %APPDATA%\Block\goose\config on Windows. */
export function gooseDir(h = home()): string {
  if (platform() === 'win32') return join(process.env.APPDATA || join(h, 'AppData', 'Roaming'), 'Block', 'goose', 'config')
  return join(xdg(h), 'goose')
}

/** True when `bin` is an executable on PATH. */
export function onPath(bin: string): boolean {
  const exts = platform() === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) if (existsSync(join(dir, bin + ext))) return true
  }
  return false
}

/** How Sekura is written for one tool and one scope. Listed in order of
 *  preference: a command is used when its binary is on PATH, else the next
 *  target; a `link` is never applied, only shown. A command with `get` can
 *  be asked whether the entry is already there, so a rerun reads "already
 *  there" instead of the tool's own "already exists" refusal. A `yaml`
 *  target is one entry under a top-level mapping (Goose's `extensions`). */
export type Target =
  | { kind: 'json'; path: string; key: string; entry: Record<string, unknown> }
  | { kind: 'toml'; path: string; table: string; lines: string[] }
  | { kind: 'yaml'; path: string; key: string; lines: string[] }
  | { kind: 'command'; bin: string; add: string[]; remove: string[]; get?: string[] }
  | { kind: 'link'; href: string; note: string }

export type Tool = {
  id: string
  name: string
  /** Present on this machine. */
  detect: (h: string, cwd: string) => boolean
  user: (h: string) => Target[]
  project?: (cwd: string) => Target[]
  /** How the person signs in once the tool is configured. */
  signIn: string
}

const SIGN_IN = 'the first time the tool uses Sekura, a sekura.ai page opens in your browser: sign in with GitHub and approve.'
const url = { url: ENDPOINT }
const http = { type: 'http', url: ENDPOINT }

export const TOOLS: Tool[] = [
  {
    id: 'tools-claude', name: 'Claude Code',
    detect: (h) => existsSync(join(h, '.claude')) || existsSync(join(h, '.claude.json')) || onPath('claude'),
    user: (h) => [
      { kind: 'command', bin: 'claude', add: ['mcp', 'add', '--transport', 'http', '-s', 'user', SERVER_NAME, ENDPOINT], remove: ['mcp', 'remove', '-s', 'user', SERVER_NAME], get: ['mcp', 'get', SERVER_NAME] },
      { kind: 'json', path: join(h, '.claude.json'), key: 'mcpServers', entry: http },
    ],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.mcp.json'), key: 'mcpServers', entry: http }],
    signIn: `type /mcp in Claude Code, choose ${SERVER_NAME}, and sign in with GitHub.`,
  },
  {
    id: 'tools-cursor', name: 'Cursor',
    detect: (h) => existsSync(join(h, '.cursor')) || onPath('cursor'),
    user: (h) => [{ kind: 'json', path: join(h, '.cursor', 'mcp.json'), key: 'mcpServers', entry: url }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.cursor', 'mcp.json'), key: 'mcpServers', entry: url }],
    signIn: SIGN_IN,
  },
  {
    id: 'tools-copilot', name: 'GitHub Copilot in VS Code',
    detect: (h) => existsSync(codeUserDir(h)),
    user: (h) => [{ kind: 'json', path: join(codeUserDir(h), 'mcp.json'), key: 'servers', entry: http }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.mcp.json'), key: 'mcpServers', entry: http }],
    signIn: SIGN_IN,
  },
  {
    id: 'tools-codex', name: 'OpenAI Codex',
    detect: (h) => existsSync(join(h, '.codex')) || onPath('codex'),
    user: (h) => [
      { kind: 'command', bin: 'codex', add: ['mcp', 'add', SERVER_NAME, '--url', ENDPOINT], remove: ['mcp', 'remove', SERVER_NAME] },
      { kind: 'toml', path: join(h, '.codex', 'config.toml'), table: `mcp_servers.${SERVER_NAME}`, lines: [`url = "${ENDPOINT}"`] },
    ],
    signIn: `run codex mcp login ${SERVER_NAME}, or sign in when Codex first uses Sekura.`,
  },
  {
    id: 'tools-kiro', name: 'Kiro',
    detect: (h) => existsSync(join(h, '.kiro')) || onPath('kiro'),
    user: (h) => [{ kind: 'json', path: join(h, '.kiro', 'settings', 'mcp.json'), key: 'mcpServers', entry: url }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.kiro', 'settings', 'mcp.json'), key: 'mcpServers', entry: url }],
    signIn: SIGN_IN,
  },
  {
    id: 'tools-cline', name: 'Cline',
    detect: (h) => existsSync(join(codeUserDir(h), 'globalStorage', 'saoudrizwan.claude-dev')),
    user: (h) => [{ kind: 'json', path: join(codeUserDir(h), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), key: 'mcpServers', entry: { type: 'streamableHttp', url: ENDPOINT } }],
    signIn: SIGN_IN,
  },
  {
    id: 'tools-zed', name: 'Zed',
    detect: (h) => existsSync(join(xdg(h), 'zed')) || onPath('zed'),
    user: (h) => [{ kind: 'json', path: join(xdg(h), 'zed', 'settings.json'), key: 'context_servers', entry: url }],
    signIn: `${SIGN_IN} Zed keeps the sign-in in your system keychain.`,
  },
  {
    id: 'tools-antigravity', name: 'Antigravity',
    detect: (h) => existsSync(join(h, '.gemini', 'config')),
    user: (h) => [{ kind: 'json', path: join(h, '.gemini', 'config', 'mcp_config.json'), key: 'mcpServers', entry: { serverUrl: ENDPOINT } }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.agents', 'mcp_config.json'), key: 'mcpServers', entry: { serverUrl: ENDPOINT } }],
    signIn: SIGN_IN,
  },
  {
    id: 'tools-opencode', name: 'OpenCode',
    detect: (h) => existsSync(join(xdg(h), 'opencode')) || onPath('opencode'),
    user: (h) => [{ kind: 'json', path: join(xdg(h), 'opencode', 'opencode.json'), key: 'mcp', entry: { type: 'remote', url: ENDPOINT } }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, 'opencode.json'), key: 'mcp', entry: { type: 'remote', url: ENDPOINT } }],
    signIn: `OpenCode registers itself with Sekura and opens the sign-in on first use; ${SIGN_IN}`,
  },
  {
    id: 'tools-jetbrains', name: 'JetBrains Junie',
    detect: (h, cwd) => existsSync(join(cwd, '.junie')) || existsSync(join(h, '.junie')),
    user: () => [{ kind: 'link', href: `${DOCS}#tools-jetbrains`, note: 'Junie reads a project file; run sekura init --scope project in the project, or follow the page.' }],
    project: (cwd) => [{ kind: 'json', path: join(cwd, '.junie', 'mcp', 'mcp.json'), key: 'mcpServers', entry: url }],
    signIn: `type /mcp in Junie and sign in with GitHub.`,
  },
  {
    id: 'tools-factory', name: 'Factory Droid',
    detect: (h) => existsSync(join(h, '.factory')) || onPath('droid'),
    user: () => [
      { kind: 'command', bin: 'droid', add: ['mcp', 'add', SERVER_NAME, ENDPOINT, '--type', 'http'], remove: ['mcp', 'remove', SERVER_NAME] },
      { kind: 'link', href: `${DOCS}#tools-factory`, note: 'droid is not on PATH; run the command from the page in a terminal where it is.' },
    ],
    signIn: `type /mcp in Droid and sign in to ${SERVER_NAME}.`,
  },
  {
    id: 'tools-tabnine', name: 'Tabnine CLI',
    detect: () => onPath('tabnine'),
    user: () => [{ kind: 'command', bin: 'tabnine', add: ['mcp', 'add', SERVER_NAME, ENDPOINT, '--type', 'http'], remove: ['mcp', 'remove', SERVER_NAME] }],
    signIn: 'run /mcp auth in the Tabnine CLI.',
  },
  {
    id: 'tools-devin', name: 'Devin Desktop and CLI',
    detect: () => onPath('devin'),
    user: () => [{ kind: 'command', bin: 'devin', add: ['mcp', 'add', SERVER_NAME, ENDPOINT], remove: ['mcp', 'remove', SERVER_NAME] }],
    signIn: `run devin mcp login ${SERVER_NAME}.`,
  },
  {
    id: 'tools-goose', name: 'Goose',
    detect: (h) => existsSync(gooseDir(h)) || onPath('goose'),
    // The streamable_http shape of Goose's ExtensionConfig (block/goose,
    // crates/goose/src/agents/extension.rs; documentation/docs/guides/config-files.md).
    user: (h) => [{ kind: 'yaml', path: join(gooseDir(h), 'config.yaml'), key: 'extensions', lines: [
      'type: streamable_http', `name: ${SERVER_NAME}`, 'enabled: true', `uri: ${ENDPOINT}`,
      'envs: {}', 'env_keys: []', 'headers: {}', 'timeout: 300', 'bundled: null', 'available_tools: []',
    ] }],
    signIn: SIGN_IN,
  },
]

export const toolById = (id: string): Tool | undefined => TOOLS.find((t) => t.id === id)

/** The first target that can be applied: a command only when its binary is on PATH. */
export function pickTarget(targets: Target[]): Target | null {
  for (const t of targets) {
    if (t.kind === 'command' && !onPath(t.bin)) continue
    return t
  }
  return null
}
