// Is the Sekura MCP server answering? A keyless GET to the endpoint is a 401
// in JSON (the server asks for a sign-in), and the protected-resource
// document beside it is a 200. Anything else means the address this
// installer wrote will not connect, which the person should hear now rather
// than from their tool later.

import { ENDPOINT } from './catalogue.js'

export type Verdict = { ok: true; detail: string } | { ok: false; detail: string }

export async function verifyEndpoint(endpoint = ENDPOINT, timeoutMs = 8000): Promise<Verdict> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(endpoint, { method: 'GET', headers: { accept: 'application/json' }, signal: ctl.signal, redirect: 'manual' })
    const type = r.headers.get('content-type') || ''
    if (r.status === 401 && type.includes('json')) return { ok: true, detail: `${endpoint} answers 401 (sign-in required), as it should before you sign in` }
    if (r.status === 200) return { ok: true, detail: `${endpoint} answers 200` }
    return { ok: false, detail: `${endpoint} answered ${r.status} ${type || ''}`.trim() }
  } catch (e) {
    return { ok: false, detail: `${endpoint} could not be reached: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}
