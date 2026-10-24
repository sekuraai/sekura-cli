// The installer with a key: each user-scope entry carries it as a header,
// nothing printed ever shows it, a rerun changes nothing, project files
// never get it, and uninstall takes it out with the saved copy. Sekura is
// a stubbed fetch; nothing here reaches the network. Run after `npm run build`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync, chmodSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'sekura-home-'))
const PROJECT = mkdtempSync(join(tmpdir(), 'sekura-project-'))
process.env.SEKURA_HOME = HOME
process.env.HOME = HOME
process.env.PATH = mkdtempSync(join(tmpdir(), 'sekura-empty-path-'))
delete process.env.XDG_CONFIG_HOME
delete process.env.SEKURA_API_KEY
for (const v of ['CLINE_MCP_SETTINGS_PATH', 'CLINE_DATA_DIR', 'CLINE_DIR']) delete process.env[v]
process.env.APPDATA = join(HOME, 'AppData', 'Roaming')

const KEY = 'sek_live_TestKey0123456789abcdWXYZ'
const BEARER = `Bearer ${KEY}`

// Sekura, as far as the CLI asks it anything.
const calls = []
let signedOut = false
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null
  calls.push({ url: String(url), auth: init.headers?.authorization, tool: body?.params?.name })
  if (signedOut) return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'revoked' }), { status: 401, headers: { 'content-type': 'application/json' } })
  const data = body?.params?.name === 'getAccount'
    ? { email: 'dev@example.test', termsAccepted: true, emailVerified: true, freeScanAvailable: true, links: { start: 'https://sekura.ai/app/start' } }
    : { installations: [{ account: 'acme', error: null, repositories: [{ fullName: 'acme/api', private: true, empty: false }] }] }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'prose' }], structuredContent: data } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

// Everything the CLI says, to look for the key in.
let said = ''
const write = process.stderr.write.bind(process.stderr)
process.stderr.write = (s, ...rest) => { said += String(s); return write(s, ...rest) }

const { codeUserDir, gooseDir, ENDPOINT } = await import('../dist/catalogue.js')
const { runInit } = await import('../dist/commands/init.js')
const { runUninstall } = await import('../dist/commands/uninstall.js')
const { runStatus } = await import('../dist/commands/status.js')
const { credentialsPath, saveKey, readKey, redact, redactAll, pkce, readCallback, ISSUER } = await import('../dist/auth.js')
const { callTool, SignedOut } = await import('../dist/api.js')
const { parseGithubRemote } = await import('../dist/repo.js')

const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))
const headers = { headers: { Authorization: BEARER } }

mkdirSync(join(HOME, '.claude'), { recursive: true })
mkdirSync(join(HOME, '.cursor'), { recursive: true })
mkdirSync(join(HOME, '.cline'), { recursive: true })
mkdirSync(join(HOME, '.kiro'), { recursive: true })
mkdirSync(join(HOME, '.codex'), { recursive: true })
mkdirSync(codeUserDir(HOME), { recursive: true })
mkdirSync(join(HOME, '.config', 'opencode'), { recursive: true })
mkdirSync(gooseDir(HOME), { recursive: true })

test('init --yes with a saved key writes it into every user entry that takes a header', async () => {
  saveKey(KEY, 'dev@example.test')
  if (platform() !== 'win32') assert.equal(statSync(credentialsPath()).mode & 0o777, 0o600, 'the saved key is readable by its owner only')
  const r = await runInit({ yes: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.equal(r.failed, 0)
  assert.deepEqual(json(join(HOME, '.claude.json')).mcpServers.sekura, { type: 'http', url: ENDPOINT, ...headers })
  assert.deepEqual(json(join(HOME, '.cursor', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT, ...headers })
  assert.deepEqual(json(join(codeUserDir(HOME), 'mcp.json')).servers.sekura, { type: 'http', url: ENDPOINT, ...headers })
  assert.deepEqual(json(join(HOME, '.cline', 'data', 'settings', 'cline_mcp_settings.json')).mcpServers.sekura, { type: 'streamableHttp', url: ENDPOINT, ...headers })
  assert.deepEqual(json(join(HOME, '.kiro', 'settings', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT, ...headers })
  assert.deepEqual(json(join(HOME, '.config', 'opencode', 'opencode.json')).mcp.sekura, { type: 'remote', url: ENDPOINT, ...headers })
  assert.ok(read(join(gooseDir(HOME), 'config.yaml')).includes(`headers: { Authorization: "${BEARER}" }`))
  assert.ok(!read(join(HOME, '.codex', 'config.toml')).includes(KEY), 'Codex takes no header; it signs in with codex mcp login')
  assert.ok(calls.some((c) => c.tool === 'getAccount' && c.auth === BEARER), 'the key was checked with Sekura')
  assert.ok(calls.some((c) => c.tool === 'listRepositories'), 'and the repositories listed')
  assert.match(said, /Signed in to Sekura as dev@example\.test/)
  assert.match(said, /Ready, no sign-in needed: Claude Code/)
  assert.match(said, /Sekura Once at \$200, quoted first and started only after you agree/, 'the price is shown before the handoff')
  assert.match(said, /To scan from your coding tool \(Sekura Once, \$200 a scan/)
  assert.match(said, /Your first scan is free only when you start it yourself on the website: https:\/\/sekura\.ai\/app\/start/)
  assert.match(said, /Next, in each tool:/)
  assert.match(said, /Cursor: restart Cursor/)
})

test('every file the key is written into is readable by its owner only (CLI-1)', { skip: platform() === 'win32' }, () => {
  const mode = (p) => statSync(p).mode & 0o777
  for (const p of [join(HOME, '.claude.json'), join(HOME, '.cursor', 'mcp.json'), join(codeUserDir(HOME), 'mcp.json'), join(HOME, '.cline', 'data', 'settings', 'cline_mcp_settings.json'), join(HOME, '.kiro', 'settings', 'mcp.json'), join(HOME, '.config', 'opencode', 'opencode.json'), join(gooseDir(HOME), 'config.yaml')]) {
    assert.equal(mode(p), 0o600, p)
  }
  assert.equal(mode(join(HOME, '.config', 'sekura')), 0o700)
  assert.deepEqual(readdirSync(join(HOME, '.cursor')).filter((f) => f.endsWith('.tmp')), [], 'no temp file is left behind')
})

test('the key never goes on a command line: Claude Code gets ~/.claude.json with a key (CLI-5)', async () => {
  const { toolById } = await import('../dist/catalogue.js')
  const keyed = toolById('tools-claude').user(HOME, KEY)
  assert.ok(keyed.every((t) => t.kind !== 'command'))
  assert.equal(toolById('tools-claude').user(HOME)[0].kind, 'command')
})

test('a symlinked config stays a symlink, and a file without the key keeps its mode', { skip: platform() === 'win32' }, async () => {
  const { writeConfig } = await import('../dist/writers.js')
  const dir = mkdtempSync(join(tmpdir(), 'sekura-link-'))
  const target = join(dir, 'real.json')
  writeFileSync(target, '{}\n')
  chmodSync(target, 0o640)
  symlinkSync(target, join(dir, 'link.json'))
  writeConfig(join(dir, 'link.json'), '{"a":1}\n', false)
  assert.ok(lstatSync(join(dir, 'link.json')).isSymbolicLink())
  assert.equal(read(target), '{"a":1}\n')
  assert.equal(statSync(target).mode & 0o777, 0o640)
  writeConfig(join(dir, 'link.json'), '{"b":2}\n', true)
  assert.equal(statSync(target).mode & 0o777, 0o600)
  rmSync(dir, { recursive: true, force: true })
})

test('a rerun with the same key changes no byte; a new key is written over the old', async () => {
  const p = join(HOME, '.cursor', 'mcp.json')
  const before = read(p)
  const again = await runInit({ yes: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.equal(again.written, 0)
  assert.equal(read(p), before)
  const other = 'sek_live_OtherKey99'
  process.env.SEKURA_API_KEY = other
  const r = await runInit({ yes: true, scope: 'user', tools: 'cursor,goose', skill: false, cwd: PROJECT, verify: false })
  assert.equal(r.written, 2)
  assert.equal(json(p).mcpServers.sekura.headers.Authorization, `Bearer ${other}`)
  assert.ok(read(join(gooseDir(HOME), 'config.yaml')).includes(other))
  process.env.SEKURA_API_KEY = KEY
  await runInit({ yes: true, scope: 'user', tools: 'cursor,goose', skill: false, cwd: PROJECT, verify: false })
  delete process.env.SEKURA_API_KEY
})

test('nothing printed carries the key, and the dry run shows it redacted', async () => {
  said = ''
  await runInit({ yes: true, dryRun: true, scope: 'user', cwd: PROJECT, verify: false })
  assert.ok(said.includes(redact(KEY)), said)
  assert.ok(!said.includes(KEY))
})

test('project scope never carries the key', async () => {
  const r = await runInit({ yes: true, scope: 'project', tools: 'claude,cursor', skill: false, cwd: PROJECT, verify: false })
  assert.equal(r.failed, 0)
  assert.deepEqual(json(join(PROJECT, '.mcp.json')).mcpServers.sekura, { type: 'http', url: ENDPOINT })
  assert.deepEqual(json(join(PROJECT, '.cursor', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
})

test('status says the entries carry the key and who is signed in', async () => {
  said = ''
  await runStatus({ cwd: PROJECT })
  assert.match(said, /Cursor: connected \(with your key\)/)
  assert.match(said, /Signed in to Sekura as dev@example\.test/)
})

test('a revoked saved key is forgotten, and the entries go back to signing in in the tool', async () => {
  signedOut = true
  const r = await runInit({ yes: true, scope: 'user', tools: 'kiro', skill: false, cwd: PROJECT, verify: false })
  signedOut = false
  assert.equal(r.written, 1)
  assert.equal(readKey(), null)
  assert.deepEqual(json(join(HOME, '.kiro', 'settings', 'mcp.json')).mcpServers.sekura, { url: ENDPOINT })
  saveKey(KEY)
})

test('uninstall removes the entries with their key, and the saved key', async () => {
  const failed = await runUninstall({ yes: true, scope: 'user', cwd: PROJECT })
  assert.equal(failed, 0)
  assert.equal(json(join(HOME, '.cursor', 'mcp.json')).mcpServers.sekura, undefined)
  assert.equal(json(join(HOME, '.claude.json')).mcpServers.sekura, undefined)
  assert.ok(!read(join(gooseDir(HOME), 'config.yaml')).includes(KEY))
  assert.ok(!existsSync(credentialsPath()))
})

test('callTool reads structuredContent, falls back to the JSON text block, and reports a 401 as signed out', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'prose' }, { type: 'text', text: '{"a":1}' }] } }), { status: 200 })
  assert.deepEqual(await callTool(KEY, 'x'), { a: 1 })
  globalThis.fetch = async () => new Response('{}', { status: 401 })
  await assert.rejects(callTool(KEY, 'x'), SignedOut)
  globalThis.fetch = real
})

test('redaction, PKCE and the callback', () => {
  assert.equal(redact(KEY), 'sek_live_…WXYZ')
  assert.equal(redactAll(`x ${KEY} y`), 'x sek_live_…WXYZ y')
  const { verifier, challenge } = pkce()
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
  const u = (q) => new URL(`http://127.0.0.1:1/callback?${q}`)
  assert.deepEqual(readCallback(u(`state=s&code=c&iss=${encodeURIComponent(ISSUER)}`), 's'), { code: 'c' })
  assert.ok('error' in readCallback(u('state=other&code=c'), 's'), 'another state is refused')
  assert.ok('error' in readCallback(u('state=s&code=c&iss=https://evil.test'), 's'), 'another issuer is refused')
  assert.ok('error' in readCallback(u('state=s&error=access_denied'), 's'))
  assert.equal(readCallback(new URL('http://127.0.0.1:1/favicon.ico'), 's'), null)
})

test('a GitHub remote names its repository; any other host names none', () => {
  assert.equal(parseGithubRemote('git@github.com:sekuraai/sekura-cli.git'), 'sekuraai/sekura-cli')
  assert.equal(parseGithubRemote('https://github.com/sekuraai/sekura-cli.git\n'), 'sekuraai/sekura-cli')
  assert.equal(parseGithubRemote('https://x-token@github.com/sekuraai/sekura-cli'), 'sekuraai/sekura-cli')
  assert.equal(parseGithubRemote('ssh://git@github.com/sekuraai/sekura-cli.git'), 'sekuraai/sekura-cli')
  assert.equal(parseGithubRemote('git@gitlab.com:a/b.git'), null)
})

test.after(() => { rmSync(HOME, { recursive: true, force: true }); rmSync(PROJECT, { recursive: true, force: true }) })
