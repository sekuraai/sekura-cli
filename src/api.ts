// The few Sekura tools the CLI calls itself, over the same MCP endpoint the
// coding tools use. The server is stateless JSON-RPC over POST and answers
// in plain JSON, so no session and no MCP library: one request per call.
// Only tools that read are called here; every scan is quoted and agreed in
// the coding tool.

import { ENDPOINT } from './catalogue.js'

export class SignedOut extends Error {
  constructor(detail: string) { super(detail); this.name = 'SignedOut' }
}

let nextId = 1

export async function callTool<T = Record<string, unknown>>(key: string, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await r.json().catch(() => null)) as Record<string, any> | null
  if (r.status === 401) throw new SignedOut(body?.error_description || 'the key is no longer valid')
  if (!r.ok || !body) throw new Error(`Sekura answered ${r.status} to ${name}${body?.error_description ? `: ${body.error_description}` : ''}`)
  if (body.error) throw new Error(`Sekura ${name}: ${body.error.message ?? JSON.stringify(body.error)}`)
  const result = body.result ?? {}
  if (result.isError) throw new Error(`Sekura ${name}: ${result.content?.[0]?.text ?? 'failed'}`)
  if (result.structuredContent) return result.structuredContent as T
  // Older answers carry the data as JSON in the second text block.
  for (const c of result.content ?? []) {
    if (c?.type !== 'text') continue
    try { return JSON.parse(c.text) as T } catch { /* the prose block */ }
  }
  throw new Error(`Sekura ${name}: no data in the answer`)
}

export type Account = {
  name?: string
  email?: string
  termsAccepted?: boolean
  emailVerified?: boolean
  installations?: number
  links?: { dashboard?: string; start?: string; settings?: string; scans?: string }
}

export type Repository = { fullName: string; private?: boolean; empty?: boolean }

export type Repositories = {
  installations: { account?: string; error?: string | null; repositories: Repository[]; truncated?: boolean }[]
  installUrl?: string
}

export const getAccount = (key: string) => callTool<Account>(key, 'getAccount')
export const listRepositories = (key: string) => callTool<Repositories>(key, 'listRepositories')
