export const DEFAULT_ORIGIN = 'https://sekura.ai'
export const ENDPOINT_VAR = 'SEKURA_ENDPOINT'
export const ENDPOINT_FLAG = '--endpoint'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export class BadEndpoint extends Error {
  constructor(value: string, why: string) {
    super(`${value} is not a Sekura server address: ${why}. Use https://…, or http://127.0.0.1:<port> for a server on this machine.`)
    this.name = 'BadEndpoint'
  }
}

export function parseOrigin(value: string): string {
  const raw = value.trim()
  let u: URL
  try { u = new URL(raw) } catch { throw new BadEndpoint(raw, 'it is not a URL') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new BadEndpoint(raw, `${u.protocol} is not https`)
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) throw new BadEndpoint(raw, 'http is allowed only for 127.0.0.1 or localhost')
  if (u.username || u.password) throw new BadEndpoint(raw, 'it carries a user name or password')
  if (u.search || u.hash) throw new BadEndpoint(raw, 'it carries a query or a fragment')
  if (!['', '/', '/mcp', '/mcp/'].includes(u.pathname)) throw new BadEndpoint(raw, `the path ${u.pathname} is not / or /mcp`)
  return u.origin
}

export function endpointFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') return null
    if (a === ENDPOINT_FLAG) return argv[i + 1] ?? ''
    if (a.startsWith(`${ENDPOINT_FLAG}=`)) return a.slice(ENDPOINT_FLAG.length + 1)
  }
  return null
}

export const COMMANDS = ['init', 'login', 'status', 'uninstall', 'logout', 'help'] as const
const VALUE_OPTIONS = new Set([ENDPOINT_FLAG, '--tools', '--scope'])

export function unknownCommand(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') return null
    if (VALUE_OPTIONS.has(a)) { i++; continue }
    if (a.startsWith('-')) continue
    return (COMMANDS as readonly string[]).includes(a) ? null : a
  }
  return null
}
