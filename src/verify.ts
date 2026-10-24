// Is the Sekura MCP server answering? A keyless GET to the endpoint is a 401
// in JSON (the server asks for a sign-in), and the protected-resource
// document beside it is a 200. Anything else means the address this
// installer wrote will not connect, which the person should hear now rather
// than from their tool later.

import { ENDPOINT } from './catalogue.js'
import { unreachable } from './errors.js'

export type Verdict = { ok: true; detail: string } | { ok: false; detail: string }

export async function verifyEndpoint(endpoint = ENDPOINT, timeoutMs = 8000): Promise<Verdict> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(endpoint, { method: 'GET', headers: { accept: 'application/json' }, signal: ctl.signal, redirect: 'manual' })
    const type = r.headers.get('content-type') || ''
    if (r.status === 401 && type.includes('json')) return { ok: true, detail: `${endpoint} answers and asks for a key, as it should` }
    if (r.status === 200) return { ok: true, detail: `${endpoint} answers 200` }
    return { ok: false, detail: `${endpoint} answered HTTP ${r.status}, not the Sekura server; check the address, or try again in a minute` }
  } catch {
    return { ok: false, detail: `${endpoint}: ${unreachable()}` }
  } finally {
    clearTimeout(timer)
  }
}
