// The account steps, the one question, the placeholder plan and the next
// step per tool, against a stubbed Sekura and a throwaway home. Waits run
// in milliseconds. Run after `npm run build`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'sekura-home-'))
const PROJECT = mkdtempSync(join(tmpdir(), 'sekura-project-'))
process.env.SEKURA_HOME = HOME
process.env.HOME = HOME
process.env.PATH = mkdtempSync(join(tmpdir(), 'sekura-empty-path-'))
delete process.env.XDG_CONFIG_HOME
delete process.env.SEKURA_API_KEY

const { TOOLS, PENDING_KEY, nextStep, NEXT, toolById } = await import('../dist/catalogue.js')
const { buildPlan, describeStep, applyStep } = await import('../dist/plan.js')
const { waitFor } = await import('../dist/ui.js')
const { waitForAccount, waitForRepository } = await import('../dist/guide.js')
const { runInit, summary } = await import('../dist/commands/init.js')

const FAST = { intervalMs: 5, timeoutMs: 400, skipOnEnter: false }
const KEY = 'sek_live_GuideKey0123456789WXYZ'

/** Sekura, answering each tool from a queue (the last answer repeats). */
function sekura(answers) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    const name = body?.params?.name
    calls.push({ url: String(url), name })
    const q = answers[name]
    if (!q) throw new Error(`unexpected ${url} ${name}`)
    const data = q.length > 1 ? q.shift() : q[0]
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: data } }), { status: 200 })
  }
  return calls
}

test('waitFor asks until yes, and gives up at the timeout', async () => {
  let n = 0
  assert.equal(await waitFor('x', async () => ++n === 3, FAST), 'done')
  assert.equal(n, 3)
  assert.equal(await waitFor('x', async () => false, { ...FAST, timeoutMs: 30 }), 'timeout')
  let m = 0
  assert.equal(await waitFor('x', async () => { if (++m < 2) throw new Error('blip'); return true }, FAST), 'done', 'a failed ask is asked again')
})

test('the account wait continues as soon as the Terms and the email are done', async () => {
  const calls = sekura({ getAccount: [{ termsAccepted: false, emailVerified: true }, { termsAccepted: true, emailVerified: false }, { termsAccepted: true, emailVerified: true }] })
  const s = { key: KEY, account: { termsAccepted: false } }
  assert.equal(await waitForAccount(s, FAST), true)
  assert.equal(calls.length, 3)
  assert.equal(s.account.termsAccepted, true)
})

test('the GitHub App wait continues when the wanted repository appears, or any when there were none', async () => {
  const none = { installations: [] }
  const other = { installations: [{ account: 'acme', repositories: [{ fullName: 'acme/web' }] }] }
  const both = { installations: [{ account: 'acme', repositories: [{ fullName: 'acme/web' }, { fullName: 'acme/API' }] }] }
  sekura({ listRepositories: [none, other] })
  const any = await waitForRepository({ key: KEY, account: null }, null, FAST)
  assert.equal(any.found, true)
  assert.deepEqual(any.repos.map((r) => r.fullName), ['acme/web'])
  sekura({ listRepositories: [other, other, both] })
  const want = await waitForRepository({ key: KEY, account: null }, 'acme/api', FAST)
  assert.equal(want.found, true, 'matched without regard to case')
  sekura({ listRepositories: [other] })
  const gone = await waitForRepository({ key: KEY, account: null }, 'acme/api', { ...FAST, timeoutMs: 40 })
  assert.equal(gone.found, false)
  assert.equal(gone.repos.length, 1, 'the last listing is still returned')
})

test('the one question says what will happen', () => {
  assert.equal(summary({ names: ['Claude Code', 'Cursor', 'OpenAI Codex'], scope: 'user', skill: true, signIn: 'sign-in' }),
    'Connect Claude Code, Cursor and OpenAI Codex for every project, with the skill, and sign in to Sekura?')
  assert.equal(summary({ names: ['Cursor'], scope: 'project', skill: false, signIn: null }), 'Connect Cursor for this project only, without the skill?')
  assert.equal(summary({ names: ['Cursor', 'Zed'], scope: 'user', skill: true, signIn: 'saved' }), 'Connect Cursor and Zed for every project, with the skill, with your saved Sekura key?')
})

test('the plan before the sign-in shows a placeholder for the key, and a placeholder is never written', () => {
  const plan = buildPlan({ tools: ['tools-cursor', 'tools-goose'], scope: 'user', skill: false, cwd: PROJECT, key: PENDING_KEY })
  const cursor = plan.steps.find((s) => s.tool?.id === 'tools-cursor')
  assert.ok(describeStep(cursor).includes('Bearer <your key, after sign-in>'), describeStep(cursor))
  const r = applyStep(cursor)
  assert.equal(r.status, 'failed')
  assert.ok(!existsSync(join(HOME, '.cursor', 'mcp.json')), 'nothing was written')
  assert.equal(applyStep(plan.steps.find((s) => s.tool?.id === 'tools-goose')).status, 'failed')
})

test('a dry run never signs in and never needs a key', async () => {
  mkdirSync(join(HOME, '.cursor'), { recursive: true })
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('no network in a dry run') }
  const r = await runInit({ dryRun: true, scope: 'user', tools: 'cursor', cwd: PROJECT, verify: false })
  assert.equal(r.written, 0)
  assert.deepEqual(calls, [])
  assert.ok(!existsSync(join(HOME, '.cursor', 'mcp.json')))
})

test('every tool has a next step; one with nothing specific gets the plain line', () => {
  for (const t of TOOLS) assert.ok(nextStep(t).length > 10, t.id)
  assert.match(nextStep(toolById('tools-cursor')), /restart Cursor \(or reload MCP servers in Settings → MCP\)/)
  assert.match(nextStep(toolById('tools-claude')), /start a new Claude Code session, then type \/sekura/)
  assert.match(nextStep(toolById('tools-copilot')), /reload the VS Code window/)
  assert.match(nextStep(toolById('tools-codex')), /start a new codex session/)
  assert.equal(nextStep(toolById('tools-jetbrains')), NEXT('JetBrains Junie'))
})

test('nothing the CLI ships mentions a free scan', () => {
  const dist = new URL('../dist/', import.meta.url)
  const files = readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.js'))
  assert.ok(files.length > 5)
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(String(f), dist), 'utf8'), /free (first )?scan/i, String(f))
})

test.after(() => { rmSync(HOME, { recursive: true, force: true }); rmSync(PROJECT, { recursive: true, force: true }) })
