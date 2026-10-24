// Signing in to Sekura from the terminal, once, so the tools do not have to.
//
// OAuth 2.1 against sekura.ai, the way the tools themselves do it: a client
// registered on the spot (public, no secret), PKCE S256, and a loopback
// redirect on a port picked per run (RFC 8252; sekura.ai accepts any port
// on 127.0.0.1 for a client that registered a loopback URI). What comes back
// is an ordinary `sek_live_` key with no expiry, listed and revocable under
// Settings → Agents and API keys, bound to the MCP address (RFC 8707).
// Where the browser is on another machine (SSH, a container, --device, or
// none to open here), the same client signs in with a code instead
// (device.ts, RFC 8628).
//
// The key is kept in ~/.config/sekura/credentials.json, readable by the
// person only, so a rerun of `init` or `login` does not sign in again.
// SEKURA_API_KEY in the environment wins over the file.

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { ENDPOINT, home, onPath } from './catalogue.js'
import { DEFAULT_ORIGIN, ORIGIN, SITE } from './endpoint.js'
import { DEVICE_GRANT, deviceSignIn, remoteSession, type DeviceShown, type Poll } from './device.js'

export const ISSUER = ORIGIN

// ── the stored key ─────────────────────────────────────────────────────────

export type Credentials = { key: string; email?: string; createdAt: string; endpoint?: string }

const credentialsFile = (): string => (ORIGIN === DEFAULT_ORIGIN ? 'credentials.json' : `credentials-${SITE.replace(/[^A-Za-z0-9.-]/g, '_')}.json`)

export const credentialsPath = (): string => join(process.env.XDG_CONFIG_HOME || join(home(), '.config'), 'sekura', credentialsFile())

export function readKey(): string | null {
  const env = process.env.SEKURA_API_KEY?.trim()
  if (env) return env
  try {
    const c = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Credentials
    if ((c.endpoint ?? `${DEFAULT_ORIGIN}/mcp`) !== ENDPOINT) return null
    return typeof c.key === 'string' && c.key ? c.key : null
  } catch { return null }
}

export function saveKey(key: string, email?: string): string {
  const p = credentialsPath()
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
  writeFileSync(p, JSON.stringify({ key, ...(email ? { email } : {}), createdAt: new Date().toISOString(), endpoint: ENDPOINT }, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(p, 0o600) } catch { /* Windows */ }
  return p
}

export function forgetKey(): boolean {
  const p = credentialsPath()
  if (!existsSync(p)) return false
  rmSync(p)
  return true
}

/** A key as it may be shown: the prefix and the last four characters. */
export function redact(key: string): string {
  const m = /^(sek_[a-z]+_)/.exec(key)
  return `${m ? m[1] : ''}…${key.slice(-4)}`
}

/** Every key in a piece of text, redacted. */
export const redactAll = (s: string): string => s.replace(/sek_[a-z]+_[A-Za-z0-9]+/g, (k) => redact(k))

// ── PKCE ───────────────────────────────────────────────────────────────────

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

// ── the browser ────────────────────────────────────────────────────────────

/** Whether this machine has a browser to open. On Linux that takes a
 *  display and xdg-open; a bare server or container has neither, and the
 *  spawn's failure would only arrive after the URL was promised. */
export function hasBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform() === 'darwin' || platform() === 'win32') return true
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY) && onPath('xdg-open')
}

/** Opens a URL in the default browser; false when there is none to ask. */
export function openBrowser(url: string): boolean {
  if (!hasBrowser()) return false
  const [cmd, args] = platform() === 'darwin' ? ['open', [url]]
    : platform() === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch { return false }
}

// ── the loopback callback ──────────────────────────────────────────────────

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;max-width:32em;margin:4em auto;padding:0 1em"><h1 style="font-size:1.4em">${title}</h1><p>${body}</p>`

export type Callback = { code: string } | { error: string }

/** What one request to the callback means, given the state this run sent. */
export function readCallback(url: URL, state: string): Callback | null {
  if (url.pathname !== '/callback') return null
  if (url.searchParams.get('state') !== state) return { error: 'the sign-in came back with another state; start again' }
  const iss = url.searchParams.get('iss')
  if (iss !== null && iss !== ISSUER) return { error: `the sign-in came back from ${iss}, not ${ISSUER}` }
  const err = url.searchParams.get('error')
  if (err) return { error: url.searchParams.get('error_description') || err }
  const code = url.searchParams.get('code')
  return code ? { code } : { error: 'the sign-in came back without a code' }
}

/** Listens on 127.0.0.1, on a port the system picks, for one callback. */
export async function listen(state: string, timeoutMs: number): Promise<{ redirectUri: string; result: Promise<Callback>; close: () => void }> {
  let settle!: (c: Callback) => void
  const result = new Promise<Callback>((r) => { settle = r })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = readCallback(new URL(req.url ?? '/', 'http://127.0.0.1'), state)
    if (!r) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('code' in r
      ? PAGE('Signed in to Sekura', 'You can close this tab and go back to the terminal.')
      : PAGE('Sekura could not sign you in', r.error.replace(/</g, '&lt;')))
    settle(r)
  })
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok()) })
  const port = (server.address() as { port: number }).port
  const timer = setTimeout(() => settle({ error: 'no answer from the browser in time' }), timeoutMs)
  timer.unref()
  let closed = false
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); server.close(); server.closeAllConnections?.() }
  return { redirectUri: `http://127.0.0.1:${port}/callback`, result, close }
}

// ── the flow ───────────────────────────────────────────────────────────────

async function post(path: string, body: string, type: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${ISSUER}${path}`, { method: 'POST', headers: { 'content-type': type, accept: 'application/json' }, body })
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) throw new Error(`${SITE} refused the sign-in (${path}): ${data.error_description || data.error || r.status}`)
  return data
}

/** One public client for both ways in: the loopback redirect and the
 *  device code. sekura.ai accepts any port on the registered loopback URI. */
export async function register(): Promise<string> {
  const reg = await post('/oauth/register', JSON.stringify({
    client_name: `Sekura CLI (${hostname().slice(0, 60)})`,
    redirect_uris: ['http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', DEVICE_GRANT],
    response_types: ['code'],
  }), 'application/json')
  const clientId = String(reg.client_id ?? '')
  if (!clientId) throw new Error(`${SITE} did not register the CLI`)
  return clientId
}

export type SignInOptions = Poll & {
  open?: boolean
  timeoutMs?: number
  /** Told the address before the browser is asked to open it, so it can be
   *  printed for a browser that does not open. */
  onUrl?: (url: string) => void
  /** true: the device code, whatever the machine. Unset: the device code
   *  when this terminal is remote or has no browser to open. */
  device?: boolean
  onCode?: (c: DeviceShown) => void
  /** Told why the device code is used instead of the browser. */
  onDevice?: (why: string) => void
}

/** Signs in and returns the key. */
export async function signIn(opts: SignInOptions = {}): Promise<string> {
  const clientId = await register()
  const remote = remoteSession()
  const why = opts.device ? '--device' : remote ? `${remote} is set` : opts.open !== false && !hasBrowser() ? 'there is no browser to open here' : null
  if (why) {
    opts.onDevice?.(why)
    return deviceSignIn(clientId, opts)
  }
  const state = b64url(randomBytes(16))
  const { verifier, challenge } = pkce()
  const cb = await listen(state, opts.timeoutMs ?? 300_000)
  try {
    const url = new URL(`${ISSUER}/oauth/authorize`)
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: clientId, redirect_uri: cb.redirectUri, state,
      code_challenge: challenge, code_challenge_method: 'S256', scope: 'read write', resource: ENDPOINT,
    })) url.searchParams.set(k, v)
    opts.onUrl?.(url.href)
    if (opts.open !== false && !openBrowser(url.href)) {
      cb.close()
      opts.onDevice?.('the browser did not open')
      return deviceSignIn(clientId, opts)
    }
    const r = await cb.result
    if ('error' in r) throw new Error(`Sekura sign-in: ${r.error}`)
    const tok = await post('/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code', code: r.code, code_verifier: verifier,
      client_id: clientId, redirect_uri: cb.redirectUri, resource: ENDPOINT,
    }).toString(), 'application/x-www-form-urlencoded')
    const key = String(tok.access_token ?? '')
    if (!key) throw new Error(`${SITE} answered without a key`)
    return key
  } finally {
    cb.close()
  }
}
