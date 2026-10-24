// The device authorization grant (RFC 8628), CLI side, against a stubbed
// sekura.ai: when it is used, what it sends, and the polling state machine.
// No real sleep beyond one second, no network. Run after `npm run build`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'sekura-home-'))
process.env.SEKURA_HOME = HOME
process.env.HOME = HOME
delete process.env.XDG_CONFIG_HOME
delete process.env.SEKURA_API_KEY
const { REMOTE_VARS, remoteSession, pollDeviceToken, startDeviceAuthorization, DEVICE_GRANT } = await import('../dist/device.js')
const { signIn } = await import('../dist/auth.js')
const { signInHere } = await import('../dist/guide.js')
const { ENDPOINT } = await import('../dist/catalogue.js')
for (const v of REMOTE_VARS) delete process.env[v]

const KEY = 'sek_live_DeviceKey0123456789WXYZ'
const CODE = { device_code: 'dc_secret_never_printed', user_code: 'ABCD-EFGH', verification_uri: 'https://sekura.ai/connect/device', verification_uri_complete: 'https://sekura.ai/connect/device?user_code=ABCD-EFGH', expires_in: 900, interval: 5 }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers /oauth/token from a script, and records each request. */
function stub(tokenAnswers, extra = {}) {
  const seen = []
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname
    const body = typeof init.body === 'string' && init.headers?.['content-type']?.includes('form') ? Object.fromEntries(new URLSearchParams(init.body)) : init.body ? JSON.parse(init.body) : null
    seen.push({ path, body })
    if (path === '/oauth/token') return tokenAnswers.shift()()
    if (extra[path]) return extra[path](body)
    throw new Error(`unexpected ${path}`)
  }
  return seen
}

test('a remote terminal is recognised by any of its variables, and an empty one does not count', () => {
  assert.equal(remoteSession({}), null)
  for (const v of ['SSH_CONNECTION', 'SSH_TTY', 'CODESPACES', 'REMOTE_CONTAINERS', 'GITPOD_WORKSPACE_ID']) assert.equal(remoteSession({ [v]: '1' }), v)
  assert.equal(remoteSession({ SSH_CONNECTION: '  ' }), null)
})

test('pending, then slow_down, then a key: the interval grows by five seconds', async () => {
  const waits = []
  const seen = stub([
    () => json(400, { error: 'authorization_pending' }),
    () => json(400, { error: 'slow_down' }),
    () => json(200, { access_token: KEY, token_type: 'Bearer' }),
  ])
  const key = await pollDeviceToken('client-1', CODE, { sleep: async (ms) => { waits.push(ms) }, now: () => 0 })
  assert.equal(key, KEY)
  assert.deepEqual(waits, [5000, 5000, 10000])
  assert.equal(seen.length, 3)
  assert.deepEqual(seen[0].body, { grant_type: DEVICE_GRANT, device_code: CODE.device_code, client_id: 'client-1', resource: ENDPOINT })
})

test('access_denied and expired_token stop with a clear message', async () => {
  stub([() => json(400, { error: 'access_denied' })])
  await assert.rejects(pollDeviceToken('c', CODE, { sleep: async () => {} }), /denied on sekura\.ai/)
  stub([() => json(400, { error: 'expired_token' })])
  await assert.rejects(pollDeviceToken('c', CODE, { sleep: async () => {} }), /code expired/)
  stub([() => json(400, { error: 'invalid_client', error_description: 'unknown client' })])
  await assert.rejects(pollDeviceToken('c', CODE, { sleep: async () => {} }), /unknown client/)
})

test('the code runs out on the clock even when the server keeps saying pending', async () => {
  let t = 0
  stub(Array.from({ length: 10 }, () => () => json(400, { error: 'authorization_pending' })))
  await assert.rejects(pollDeviceToken('c', { ...CODE, expires_in: 12 }, { sleep: async (ms) => { t += ms }, now: () => t }), /code expired/)
})

test('a server error or a network blink is asked again, not taken as an answer', async () => {
  stub([() => { throw new TypeError('fetch failed') }, () => json(503, {}), () => json(200, { access_token: KEY })])
  assert.equal(await pollDeviceToken('c', CODE, { sleep: async () => {} }), KEY)
})

test('the device authorization request is the contract: client_id, scope and resource, form-encoded', async () => {
  const seen = stub([], { '/oauth/device_authorization': () => json(200, CODE) })
  const c = await startDeviceAuthorization('client-9')
  assert.equal(c.user_code, 'ABCD-EFGH')
  assert.deepEqual(seen[0].body, { client_id: 'client-9', scope: 'read write', resource: ENDPOINT })
})

test('over SSH, signIn registers one client for both grants and signs in with the code', async () => {
  process.env.SSH_CONNECTION = '10.0.0.1 5000 10.0.0.2 22'
  const shown = []
  const why = []
  const seen = stub([() => json(400, { error: 'authorization_pending' }), () => json(200, { access_token: KEY })], {
    '/oauth/register': () => json(201, { client_id: 'client-2' }),
    '/oauth/device_authorization': () => json(200, CODE),
  })
  const key = await signIn({ sleep: async () => {}, onCode: (c) => shown.push(c), onDevice: (w) => why.push(w) })
  delete process.env.SSH_CONNECTION
  assert.equal(key, KEY)
  assert.deepEqual(seen[0].body.grant_types, ['authorization_code', DEVICE_GRANT])
  assert.deepEqual(seen[0].body.redirect_uris, ['http://127.0.0.1/callback'])
  assert.equal(seen[1].body.client_id, 'client-2')
  assert.deepEqual(why, ['SSH_CONNECTION is set'])
  assert.deepEqual(shown, [{ userCode: 'ABCD-EFGH', uri: CODE.verification_uri, complete: CODE.verification_uri_complete }])
})

test('--device is used on any machine; what is printed names the page and the code, never the device_code', async () => {
  let said = ''
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = (s, ...rest) => { said += String(s); return write(s, ...rest) }
  stub([() => json(200, { access_token: KEY })], {
    '/oauth/register': () => json(201, { client_id: 'client-3' }),
    '/oauth/device_authorization': () => json(200, { ...CODE, interval: 1 }),
    '/mcp': () => json(200, { jsonrpc: '2.0', id: 1, result: { structuredContent: { email: 'dev@example.test' } } }),
  })
  const s = await signInHere({ device: true })
  process.stderr.write = write
  assert.equal(s?.key, KEY)
  assert.match(said, /On any device, open https:\/\/sekura\.ai\/connect\/device and enter ABCD-EFGH/)
  assert.ok(said.includes(CODE.verification_uri_complete))
  assert.ok(!said.includes(CODE.device_code), 'the device_code is never printed')
  assert.ok(!said.includes(KEY), 'nor the key')
})

test.after(() => rmSync(HOME, { recursive: true, force: true }))
