// The installer against a throwaway home: what it writes, what it leaves
// alone, that a rerun changes nothing, and that uninstall takes out only
// its own entry. PATH is emptied so no tool's own command runs; the file
// fallbacks are what is proved here. Run after `npm run build`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'sekura-home-'))
const PROJECT = mkdtempSync(join(tmpdir(), 'sekura-project-'))
process.env.SEKURA_HOME = HOME
process.env.HOME = HOME
process.env.PATH = mkdtempSync(join(tmpdir(), 'sekura-empty-path-'))
delete process.env.XDG_CONFIG_HOME
for (const v of ['CLINE_MCP_SETTINGS_PATH', 'CLINE_DATA_DIR', 'CLINE_DIR']) delete process.env[v]
process.env.APPDATA = join(HOME, 'AppData', 'Roaming')

const { clineSettingsPath, codeUserDir, gooseDir, toolById, ENDPOINT, TOOLS } = await import('../dist/catalogue.js')
const { buildPlan, detectTools, applyStep, removeStep, stepPresent } = await import('../dist/plan.js')
const { runInit, isProjectDir } = await import('../dist/commands/init.js')
const { runUninstall } = await import('../dist/commands/uninstall.js')
const { GUIDANCE } = await import('../dist/skill.js')

const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))

// A machine with Claude Code (no binary), Cursor, VS Code with Cline, Codex (no binary), Kiro, Zed with comments, OpenCode, Goose.
mkdirSync(join(HOME, '.claude'), { recursive: true })
writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { other: { command: 'x', args: [] } } }, null, 2) + '\n')
mkdirSync(join(HOME, '.cursor'), { recursive: true })
writeFileSync(join(HOME, '.cursor', 'mcp.json'), '{\n    "mcpServers": {\n        "theirs": { "url": "https://example.test/mcp" }\n    }\n}\n')
mkdirSync(join(codeUserDir(HOME), 'globalStorage', 'saoudrizwan.claude-dev', 'settings'), { recursive: true })
mkdirSync(join(HOME, '.codex'), { recursive: true })
writeFileSync(join(HOME, '.codex', 'config.toml'), 'model = "gpt-5"\n\n[mcp_servers.other]\nurl = "https://example.test/other"\n')
mkdirSync(join(HOME, '.kiro'), { recursive: true })
mkdirSync(join(HOME, '.config', 'zed'), { recursive: true })
writeFileSync(join(HOME, '.config', 'zed', 'settings.json'), '{\n  // my theme\n  "theme": "One Dark",\n}\n')
mkdirSync(join(HOME, '.config', 'opencode'), { recursive: true })
writeFileSync(join(HOME, '.config', 'opencode', 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {} }, null, 2))
const GOOSE = join(gooseDir(HOME), 'config.yaml')
const GOOSE_BEFORE = 'GOOSE_PROVIDER: openai\nextensions:\n    developer:\n        bundled: true\n        enabled: true\n        name: developer\n        type: builtin\n\nGOOSE_MODEL: gpt-5\n'
mkdirSync(gooseDir(HOME), { recursive: true })
writeFileSync(GOOSE, GOOSE_BEFORE)

test('detects the tools whose directories exist and nothing else', () => {
  const ids = detectTools(PROJECT).map((t) => t.id).sort()
  assert.deepEqual(ids, ['tools-claude', 'tools-cline', 'tools-codex', 'tools-copilot', 'tools-cursor', 'tools-goose', 'tools-kiro', 'tools-opencode', 'tools-zed'])
})

test('every tool has a user target, and only commands depend on PATH', () => {
  for (const t of TOOLS) assert.ok(t.user(HOME).length > 0, t.id)
})

test('init --yes writes each tool its own shape and leaves the rest of each file alone', async () => {
  const r = await runInit({ yes: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.equal(r.failed, 0)
  assert.equal(r.byHand, 1, 'Zed has comments and is reported by hand')

  const claude = json(join(HOME, '.claude.json'))
  assert.deepEqual(claude.mcpServers.sekura, { type: 'http', url: ENDPOINT })
  assert.deepEqual(claude.mcpServers.other, { command: 'x', args: [] })
  assert.equal(claude.numStartups, 3)

  const cursor = read(join(HOME, '.cursor', 'mcp.json'))
  assert.deepEqual(JSON.parse(cursor).mcpServers.sekura, { url: ENDPOINT })
  assert.deepEqual(JSON.parse(cursor).mcpServers.theirs, { url: 'https://example.test/mcp' })
  assert.ok(cursor.includes('\n    "mcpServers"'), 'the file keeps its four-space indent')

  assert.deepEqual(json(join(codeUserDir(HOME), 'mcp.json')).servers.sekura, { type: 'http', url: ENDPOINT })
  assert.deepEqual(json(join(HOME, '.cline', 'data', 'settings', 'cline_mcp_settings.json')).mcpServers.sekura, { type: 'streamableHttp', url: ENDPOINT }, 'Cline v4 reads ~/.cline, not global storage')
  assert.ok(!existsSync(join(codeUserDir(HOME), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')), 'the legacy file is left alone')
  assert.deepEqual(json(join(HOME, '.kiro', 'settings', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
  assert.deepEqual(json(join(HOME, '.config', 'opencode', 'opencode.json')).mcp.sekura, { type: 'remote', url: ENDPOINT })
  assert.equal(json(join(HOME, '.config', 'opencode', 'opencode.json')).$schema, 'https://opencode.ai/config.json')

  const toml = read(join(HOME, '.codex', 'config.toml'))
  assert.ok(toml.startsWith('model = "gpt-5"\n\n[mcp_servers.other]\nurl = "https://example.test/other"\n'), 'the existing TOML is untouched')
  assert.ok(toml.endsWith(`[mcp_servers.sekura]\nurl = "${ENDPOINT}"\n`), toml)

  assert.equal(read(join(HOME, '.config', 'zed', 'settings.json')), '{\n  // my theme\n  "theme": "One Dark",\n}\n', 'a file with comments is never rewritten')

  const goose = read(GOOSE)
  assert.ok(goose.startsWith('GOOSE_PROVIDER: openai\nextensions:\n    developer:\n'), goose)
  assert.ok(goose.includes(`        bundled: true\n        enabled: true\n        name: developer\n        type: builtin\n    sekura:\n        type: streamable_http\n        name: sekura\n        enabled: true\n        uri: ${ENDPOINT}\n`), 'the entry sits under extensions at the file\'s own indent')
  assert.ok(goose.endsWith('\n\nGOOSE_MODEL: gpt-5\n'), 'what follows extensions is untouched')

  assert.ok(existsSync(join(HOME, '.agents', 'skills', 'sekura', 'SKILL.md')), 'the skill in the agents location')
  assert.ok(existsSync(join(HOME, '.claude', 'skills', 'sekura', 'SKILL.md')), 'and for Claude Code')
  assert.match(read(join(HOME, '.agents', 'skills', 'sekura', 'SKILL.md')), /^---\nname: sekura\n/)
  assert.ok(!existsSync(join(PROJECT, 'AGENTS.md')), 'user scope writes no guidance block into the project')
})

test('a rerun changes no byte', async () => {
  const before = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.kiro/settings/mcp.json', '.config/opencode/opencode.json'].map((p) => read(join(HOME, p))).concat(read(GOOSE))
  const r = await runInit({ yes: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.equal(r.written, 0)
  const after = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.kiro/settings/mcp.json', '.config/opencode/opencode.json'].map((p) => read(join(HOME, p))).concat(read(GOOSE))
  assert.deepEqual(after, before)
})

test('a changed entry is corrected on rerun', async () => {
  const p = join(HOME, '.kiro', 'settings', 'mcp.json')
  writeFileSync(p, JSON.stringify({ mcpServers: { sekura: { url: 'https://old.example/mcp' } } }))
  const r = await runInit({ yes: true, scope: 'user', tools: 'kiro', skill: false, cwd: PROJECT, verify: false })
  assert.equal(r.written, 1)
  assert.deepEqual(json(p).mcpServers.sekura, { url: ENDPOINT })
})

test('Cline is found by its extension folder or ~/.cline, and its file follows Cline\'s overrides', () => {
  const h = mkdtempSync(join(tmpdir(), 'sekura-cline-'))
  const cline = toolById('tools-cline')
  assert.equal(cline.detect(h, PROJECT), false)
  mkdirSync(join(h, '.vscode', 'extensions', 'saoudrizwan.claude-dev-4.1.25'), { recursive: true })
  assert.equal(cline.detect(h, PROJECT), true, 'a fresh install, before it has any global storage')
  rmSync(join(h, '.vscode'), { recursive: true })
  mkdirSync(join(h, '.cline'))
  assert.equal(cline.detect(h, PROJECT), true, 'the Cline CLI, or the extension after first run')
  assert.equal(clineSettingsPath(h), join(h, '.cline', 'data', 'settings', 'cline_mcp_settings.json'))
  process.env.CLINE_DIR = join(h, 'c')
  assert.equal(clineSettingsPath(h), join(h, 'c', 'data', 'settings', 'cline_mcp_settings.json'))
  process.env.CLINE_DATA_DIR = join(h, 'd')
  assert.equal(clineSettingsPath(h), join(h, 'd', 'settings', 'cline_mcp_settings.json'))
  process.env.CLINE_MCP_SETTINGS_PATH = join(h, 'mcp.json')
  assert.equal(clineSettingsPath(h), join(h, 'mcp.json'))
  for (const v of ['CLINE_MCP_SETTINGS_PATH', 'CLINE_DATA_DIR', 'CLINE_DIR']) delete process.env[v]
  rmSync(h, { recursive: true, force: true })
})

test('a Goose entry Goose rewrote in its own order and quoting is still there', async () => {
  const mine = read(GOOSE)
  writeFileSync(GOOSE, `extensions:\n  sekura:\n    available_tools: []\n    bundled: null\n    description: ''\n    enabled: true\n    env_keys: []\n    envs: {}\n    headers: {}\n    name: sekura\n    timeout: 300\n    type: streamable_http\n    uri: "${ENDPOINT}"\n`)
  const r = await runInit({ yes: true, scope: 'user', tools: 'goose', skill: false, cwd: PROJECT, verify: false })
  assert.equal(r.written, 0)
  writeFileSync(GOOSE, mine)
})

test('init refuses project scope in the home folder', async () => {
  assert.equal(isProjectDir(HOME), false)
  assert.equal(isProjectDir(PROJECT), true)
  const r = await runInit({ yes: true, scope: 'project', cwd: HOME, verify: false })
  assert.equal(r.failed, 1)
  assert.equal(r.written, 0)
  assert.ok(!existsSync(join(HOME, 'AGENTS.md')))
  assert.ok(!existsSync(join(HOME, '.mcp.json')))
})

test('status reads the same plan and sees every entry present', () => {
  const plan = buildPlan({ tools: detectTools(PROJECT).map((t) => t.id), scope: 'user', skill: true, cwd: PROJECT })
  for (const s of plan.steps) {
    const p = stepPresent(s)
    if (s.kind === 'tool' && s.tool.id === 'tools-zed') assert.equal(p, 'unknown')
    else assert.equal(p, true, s.kind === 'tool' ? s.tool.id : s.path)
  }
})

test('project scope writes the project files and a marked block in AGENTS.md, idempotently', async () => {
  writeFileSync(join(PROJECT, 'AGENTS.md'), '# My project\n\nRules.\n')
  writeFileSync(join(PROJECT, 'CLAUDE.md'), '# Claude\n')
  const r = await runInit({ yes: true, scope: 'project', cwd: PROJECT, verify: false })
  assert.equal(r.failed, 0)
  assert.deepEqual(json(join(PROJECT, '.mcp.json')).mcpServers.sekura, { type: 'http', url: ENDPOINT })
  assert.deepEqual(json(join(PROJECT, '.cursor', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
  assert.deepEqual(json(join(PROJECT, '.kiro', 'settings', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
  assert.deepEqual(json(join(PROJECT, 'opencode.json')).mcp.sekura, { type: 'remote', url: ENDPOINT })
  assert.ok(existsSync(join(PROJECT, '.agents', 'skills', 'sekura', 'SKILL.md')))
  const agents = read(join(PROJECT, 'AGENTS.md'))
  assert.ok(agents.startsWith('# My project\n\nRules.\n\n'), 'the person\'s text comes first, untouched')
  assert.ok(agents.endsWith(GUIDANCE))
  assert.ok(read(join(PROJECT, 'CLAUDE.md')).endsWith(GUIDANCE))
  const again = await runInit({ yes: true, scope: 'project', cwd: PROJECT, verify: false })
  assert.equal(again.written, 0)
  assert.equal(read(join(PROJECT, 'AGENTS.md')), agents)
})

test('uninstall removes only the sekura entries, the skill and the block', async () => {
  const failed = await runUninstall({ yes: true, scope: 'user', cwd: PROJECT })
  assert.equal(failed, 0)
  assert.equal(json(join(HOME, '.claude.json')).mcpServers.sekura, undefined)
  assert.deepEqual(json(join(HOME, '.claude.json')).mcpServers.other, { command: 'x', args: [] })
  assert.deepEqual(json(join(HOME, '.cursor', 'mcp.json')).mcpServers, { theirs: { url: 'https://example.test/mcp' } })
  assert.equal(read(join(HOME, '.codex', 'config.toml')), 'model = "gpt-5"\n\n[mcp_servers.other]\nurl = "https://example.test/other"\n')
  assert.ok(!existsSync(join(HOME, '.agents', 'skills', 'sekura')))
  assert.ok(!existsSync(join(HOME, '.claude', 'skills', 'sekura')))
  assert.equal(read(GOOSE), GOOSE_BEFORE, 'Goose\'s file is as it was')

  const projectFailed = await runUninstall({ yes: true, scope: 'project', cwd: PROJECT })
  assert.equal(projectFailed, 0)
  assert.equal(read(join(PROJECT, 'AGENTS.md')), '# My project\n\nRules.\n')
  assert.equal(read(join(PROJECT, 'CLAUDE.md')), '# Claude\n')
  assert.equal(json(join(PROJECT, '.mcp.json')).mcpServers.sekura, undefined)
})

test('a tool that is not here is refused by name', () => {
  assert.throws(() => buildPlan({ tools: ['tools-nope'], scope: 'user', skill: false, cwd: PROJECT }), /no tool named tools-nope/)
})

test('a tool with no project file is skipped with a reason in project scope', () => {
  const plan = buildPlan({ tools: ['tools-codex', 'tools-cline', 'tools-zed'], scope: 'project', skill: false, cwd: PROJECT })
  assert.deepEqual(plan.skipped.map((s) => s.tool.id).sort(), ['tools-cline', 'tools-codex', 'tools-zed'])
  assert.equal(plan.steps.length, 0)
})

test.after(() => { rmSync(HOME, { recursive: true, force: true }); rmSync(PROJECT, { recursive: true, force: true }) })
