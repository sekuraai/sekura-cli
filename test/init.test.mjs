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

const { codeUserDir, ENDPOINT, TOOLS } = await import('../dist/catalogue.js')
const { buildPlan, detectTools, applyStep, removeStep, stepPresent } = await import('../dist/plan.js')
const { runInit } = await import('../dist/commands/init.js')
const { runUninstall } = await import('../dist/commands/uninstall.js')
const { GUIDANCE } = await import('../dist/skill.js')

const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))

// A machine with Claude Code (no binary), Cursor, VS Code with Cline, Codex (no binary), Kiro, Zed with comments, OpenCode.
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

test('detects the tools whose directories exist and nothing else', () => {
  const ids = detectTools(PROJECT).map((t) => t.id).sort()
  assert.deepEqual(ids, ['tools-claude', 'tools-cline', 'tools-codex', 'tools-copilot', 'tools-cursor', 'tools-kiro', 'tools-opencode', 'tools-zed'])
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
  assert.deepEqual(json(join(codeUserDir(HOME), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')).mcpServers.sekura, { type: 'streamableHttp', url: ENDPOINT })
  assert.deepEqual(json(join(HOME, '.kiro', 'settings', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
  assert.deepEqual(json(join(HOME, '.config', 'opencode', 'opencode.json')).mcp.sekura, { type: 'remote', url: ENDPOINT })
  assert.equal(json(join(HOME, '.config', 'opencode', 'opencode.json')).$schema, 'https://opencode.ai/config.json')

  const toml = read(join(HOME, '.codex', 'config.toml'))
  assert.ok(toml.startsWith('model = "gpt-5"\n\n[mcp_servers.other]\nurl = "https://example.test/other"\n'), 'the existing TOML is untouched')
  assert.ok(toml.endsWith(`[mcp_servers.sekura]\nurl = "${ENDPOINT}"\n`), toml)

  assert.equal(read(join(HOME, '.config', 'zed', 'settings.json')), '{\n  // my theme\n  "theme": "One Dark",\n}\n', 'a file with comments is never rewritten')

  assert.ok(existsSync(join(HOME, '.agents', 'skills', 'sekura', 'SKILL.md')), 'the skill in the agents location')
  assert.ok(existsSync(join(HOME, '.claude', 'skills', 'sekura', 'SKILL.md')), 'and for Claude Code')
  assert.match(read(join(HOME, '.agents', 'skills', 'sekura', 'SKILL.md')), /^---\nname: sekura\n/)
  assert.ok(!existsSync(join(PROJECT, 'AGENTS.md')), 'user scope writes no guidance block into the project')
})

test('a rerun changes no byte', async () => {
  const before = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.kiro/settings/mcp.json', '.config/opencode/opencode.json'].map((p) => read(join(HOME, p)))
  const r = await runInit({ yes: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.equal(r.written, 0)
  const after = ['.claude.json', '.cursor/mcp.json', '.codex/config.toml', '.kiro/settings/mcp.json', '.config/opencode/opencode.json'].map((p) => read(join(HOME, p)))
  assert.deepEqual(after, before)
})

test('a changed entry is corrected on rerun', async () => {
  const p = join(HOME, '.kiro', 'settings', 'mcp.json')
  writeFileSync(p, JSON.stringify({ mcpServers: { sekura: { url: 'https://old.example/mcp' } } }))
  const r = await runInit({ yes: true, scope: 'user', tools: 'kiro', skill: false, cwd: PROJECT, verify: false })
  assert.equal(r.written, 1)
  assert.deepEqual(json(p).mcpServers.sekura, { url: ENDPOINT })
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
