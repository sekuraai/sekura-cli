import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { parseOrigin, endpointFromArgv, DEFAULT_ORIGIN } = await import('../dist/origin.js')

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const CLI = join(DIST, 'cli.js')

const run = (code, env) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, cwd: DIST })
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: '', ...env } })

test('an endpoint is https, or http only on this machine', () => {
  assert.equal(parseOrigin('https://dev.sekura.ai'), 'https://dev.sekura.ai')
  assert.equal(parseOrigin('https://dev.sekura.ai/mcp'), 'https://dev.sekura.ai')
  assert.equal(parseOrigin(' https://dev.sekura.ai/ '), 'https://dev.sekura.ai')
  assert.equal(parseOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787')
  assert.equal(parseOrigin('http://localhost:8787/mcp'), 'http://localhost:8787')
  for (const bad of ['http://dev.sekura.ai', 'http://127.0.0.1.evil.test', 'ftp://sekura.ai', 'sekura.ai', 'https://u:p@sekura.ai', 'https://sekura.ai/?x=1', 'https://sekura.ai/other', 'javascript:alert(1)']) {
    assert.throws(() => parseOrigin(bad), /is not a Sekura server address/, bad)
  }
  assert.equal(DEFAULT_ORIGIN, 'https://sekura.ai')
})

test('the flag is read in either spelling, and never after --', () => {
  assert.equal(endpointFromArgv(['init', '--endpoint', 'https://dev.sekura.ai']), 'https://dev.sekura.ai')
  assert.equal(endpointFromArgv(['--endpoint=http://127.0.0.1:8787', 'status']), 'http://127.0.0.1:8787')
  assert.equal(endpointFromArgv(['init', '--', '--endpoint', 'x']), null)
  assert.equal(endpointFromArgv(['init']), null)
})

test('without SEKURA_ENDPOINT everything points at https://sekura.ai', () => {
  const r = run(`const c = await import('./catalogue.js'); const a = await import('./auth.js'); console.log(JSON.stringify({ e: c.ENDPOINT, d: c.DOCS, i: a.ISSUER, p: a.credentialsPath() }))`, { SEKURA_HOME: '/h' })
  assert.equal(r.status, 0, r.stderr)
  const o = JSON.parse(r.stdout)
  assert.deepEqual([o.e, o.d, o.i], ['https://sekura.ai/mcp', 'https://sekura.ai/connect/', 'https://sekura.ai'])
  assert.ok(o.p.endsWith(join('sekura', 'credentials.json')))
})

test('SEKURA_ENDPOINT moves the sign-in, the server check, the links and the written address', () => {
  const HOME = mkdtempSync(join(tmpdir(), 'sekura-endpoint-'))
  mkdirSync(join(HOME, '.cursor'), { recursive: true })
  const code = `
    const seen = []
    globalThis.fetch = async (url, init = {}) => {
      seen.push(String(url))
      if (String(url).endsWith('/oauth/register')) return new Response(JSON.stringify({ client_id: 'c1' }), { status: 201, headers: { 'content-type': 'application/json' } })
      if (String(url).endsWith('/oauth/device_authorization')) return new Response(JSON.stringify({ device_code: 'd', user_code: 'U', verification_uri: 'x', expires_in: 60, interval: 1 }), { status: 200 })
      if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'sek_live_LocalKey0001' }), { status: 200 })
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { 'content-type': 'application/json' } })
    }
    const c = await import('./catalogue.js')
    const a = await import('./auth.js')
    const v = await import('./verify.js')
    const p = await import('./plan.js')
    const key = await a.signIn({ device: true, sleep: async () => {} })
    const verdict = await v.verifyEndpoint()
    const plan = p.buildPlan({ tools: ['tools-cursor'], scope: 'user', skill: false, key })
    p.applyStep(plan.steps[0])
    console.log(JSON.stringify({ seen, key, verdict, endpoint: c.ENDPOINT, docs: c.DOCS, path: a.credentialsPath() }))
  `
  const r = run(code, { SEKURA_HOME: HOME, HOME, SEKURA_ENDPOINT: 'http://127.0.0.1:8787' })
  assert.equal(r.status, 0, r.stderr)
  const o = JSON.parse(r.stdout)
  assert.equal(o.endpoint, 'http://127.0.0.1:8787/mcp')
  assert.equal(o.docs, 'http://127.0.0.1:8787/connect/')
  assert.ok(o.seen.length >= 4)
  for (const u of o.seen) assert.ok(u.startsWith('http://127.0.0.1:8787/'), u)
  assert.ok(o.verdict.ok)
  assert.deepEqual(JSON.parse(readFileSync(join(HOME, '.cursor', 'mcp.json'), 'utf8')).mcpServers.sekura, { url: 'http://127.0.0.1:8787/mcp', headers: { Authorization: 'Bearer sek_live_LocalKey0001' } })
  assert.ok(o.path.endsWith('credentials-127.0.0.1_8787.json'), o.path)
})

test('a key saved for sekura.ai is never sent to another endpoint', () => {
  const HOME = mkdtempSync(join(tmpdir(), 'sekura-endpoint-'))
  const prod = run(`const a = await import('./auth.js'); a.saveKey('sek_live_ProdKey0001'); console.log(a.credentialsPath())`, { SEKURA_HOME: HOME })
  assert.equal(prod.status, 0, prod.stderr)
  const dev = run(`const a = await import('./auth.js'); console.log(String(a.readKey()))`, { SEKURA_HOME: HOME, SEKURA_ENDPOINT: 'https://dev.sekura.ai' })
  assert.equal(dev.stdout.trim(), 'null')
  const copied = prod.stdout.trim().replace('credentials.json', 'credentials-dev.sekura.ai.json')
  writeFileSync(copied, readFileSync(prod.stdout.trim()))
  const forged = run(`const a = await import('./auth.js'); console.log(String(a.readKey()))`, { SEKURA_HOME: HOME, SEKURA_ENDPOINT: 'https://dev.sekura.ai' })
  assert.equal(forged.stdout.trim(), 'null', 'a file bound to another endpoint is not used')
  const back = run(`const a = await import('./auth.js'); console.log(String(a.readKey()))`, { SEKURA_HOME: HOME })
  assert.equal(back.stdout.trim(), 'sek_live_ProdKey0001')
  if (platform() !== 'win32') assert.equal(statSync(prod.stdout.trim()).mode & 0o777, 0o600)
})

test('a bad SEKURA_ENDPOINT or --endpoint stops the CLI before anything happens', () => {
  const HOME = mkdtempSync(join(tmpdir(), 'sekura-endpoint-'))
  const env = cli(['status', '--no-verify'], { SEKURA_HOME: HOME, HOME, SEKURA_ENDPOINT: 'http://dev.sekura.ai' })
  assert.equal(env.status, 1)
  assert.match(env.stderr, /SEKURA_ENDPOINT: http:\/\/dev\.sekura\.ai is not a Sekura server address: http is allowed only for 127\.0\.0\.1 or localhost/)
  const flag = cli(['status', '--no-verify', '--endpoint', 'ftp://x'], { SEKURA_HOME: HOME, HOME })
  assert.equal(flag.status, 1)
  assert.match(flag.stderr, /ftp:\/\/x is not a Sekura server address/)
  const ok = cli(['status', '--no-verify', '--endpoint', 'https://dev.sekura.ai'], { SEKURA_HOME: HOME, HOME })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stderr, /Using the Sekura server at https:\/\/dev\.sekura\.ai, not https:\/\/sekura\.ai/)
})
