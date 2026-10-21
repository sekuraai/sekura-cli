// Writing one `sekura` entry into a tool's configuration, and taking it out
// again, without touching anything else in the file.
//
// A JSON file is parsed, the entry set under its key, and the file written
// back with the indent it had. A file that does not parse is never rewritten:
// Zed's settings.json and OpenCode's opencode.jsonc may carry comments, and a
// rewrite that dropped them would cost the person their own configuration to
// save them a copy-paste. Such a file is reported with the lines to add by
// hand. A TOML file (Codex) is edited as text: the table is appended when
// absent, replaced when present, and the rest of the file is left byte for
// byte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SERVER_NAME, type Target } from './catalogue.js'

export type Outcome =
  | { status: 'written' | 'unchanged' | 'removed' | 'absent' | 'ran'; where: string }
  | { status: 'by-hand'; where: string; why: string; snippet: string }
  | { status: 'failed'; where: string; why: string }

const describeJson = (t: Extract<Target, { kind: 'json' }>) => JSON.stringify({ [t.key]: { [SERVER_NAME]: t.entry } }, null, 2)

/** What applying the target would do, for the review before any write. */
export function describe(t: Target, dryRun = false): string {
  const verb = dryRun ? 'would ' : ''
  switch (t.kind) {
    case 'json': return `${verb}write ${t.path}: ${t.key}.${SERVER_NAME} = ${JSON.stringify(t.entry)}`
    case 'toml': return `${verb}write ${t.path}: [${t.table}] ${t.lines.join('; ')}`
    case 'command': return `${verb}run ${t.bin} ${t.add.join(' ')}`
    case 'link': return `by hand: ${t.note} ${t.href}`
  }
}

function detectIndent(text: string): string | number {
  const m = /\n([ \t]+)"/.exec(text)
  return m ? m[1] : 2
}

function readJson(path: string): { data: Record<string, unknown>; indent: string | number; trailingNewline: boolean } | { invalid: string } {
  if (!existsSync(path)) return { data: {}, indent: 2, trailingNewline: true }
  const text = readFileSync(path, 'utf8')
  if (!text.trim()) return { data: {}, indent: 2, trailingNewline: true }
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { invalid: 'its top level is not an object' }
    return { data, indent: detectIndent(text), trailingNewline: text.endsWith('\n') }
  } catch {
    return { invalid: 'it is not plain JSON (comments or trailing commas, which this tool allows and this installer will not rewrite)' }
  }
}

export function applyJson(t: Extract<Target, { kind: 'json' }>): Outcome {
  const r = readJson(t.path)
  if ('invalid' in r) return { status: 'by-hand', where: t.path, why: r.invalid, snippet: describeJson(t) }
  const servers = (r.data[t.key] && typeof r.data[t.key] === 'object' ? r.data[t.key] : {}) as Record<string, unknown>
  const current = servers[SERVER_NAME]
  if (current && JSON.stringify(current) === JSON.stringify(t.entry)) return { status: 'unchanged', where: t.path }
  servers[SERVER_NAME] = t.entry
  r.data[t.key] = servers
  mkdirSync(dirname(t.path), { recursive: true })
  writeFileSync(t.path, JSON.stringify(r.data, null, r.indent) + (r.trailingNewline ? '\n' : ''))
  return { status: 'written', where: t.path }
}

export function removeJson(t: Extract<Target, { kind: 'json' }>): Outcome {
  const r = readJson(t.path)
  if ('invalid' in r) return { status: 'by-hand', where: t.path, why: r.invalid, snippet: `remove ${t.key}.${SERVER_NAME}` }
  const servers = r.data[t.key] as Record<string, unknown> | undefined
  if (!servers || !(SERVER_NAME in servers)) return { status: 'absent', where: t.path }
  delete servers[SERVER_NAME]
  writeFileSync(t.path, JSON.stringify(r.data, null, r.indent) + (r.trailingNewline ? '\n' : ''))
  return { status: 'removed', where: t.path }
}

/** Does this JSON file carry our entry as it should be? */
export function hasJson(t: Extract<Target, { kind: 'json' }>): boolean | 'unreadable' {
  const r = readJson(t.path)
  if ('invalid' in r) return 'unreadable'
  const servers = r.data[t.key] as Record<string, unknown> | undefined
  return !!servers && JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(t.entry)
}

// ── TOML, as text ───────────────────────────────────────────────────────────

const tomlBlock = (t: Extract<Target, { kind: 'toml' }>) => `[${t.table}]\n${t.lines.join('\n')}\n`

/** The span of `[table]` up to the next header or the end, or null. */
function tomlSpan(text: string, table: string): [number, number] | null {
  const header = new RegExp(`^\\[${table.replace(/\./g, '\\.')}\\]\\s*$`, 'm')
  const m = header.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const next = /^\s*\[/m.exec(rest)
  return [m.index, next ? m.index + m[0].length + next.index : text.length]
}

export function applyToml(t: Extract<Target, { kind: 'toml' }>): Outcome {
  const text = existsSync(t.path) ? readFileSync(t.path, 'utf8') : ''
  const block = tomlBlock(t)
  const span = tomlSpan(text, t.table)
  if (span) {
    const current = text.slice(span[0], span[1]).trim()
    if (current === block.trim()) return { status: 'unchanged', where: t.path }
    const out = text.slice(0, span[0]) + block + (text.slice(span[1]).startsWith('\n') ? '' : '\n') + text.slice(span[1])
    writeFileSync(t.path, out)
    return { status: 'written', where: t.path }
  }
  mkdirSync(dirname(t.path), { recursive: true })
  const sep = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(t.path, text + sep + block)
  return { status: 'written', where: t.path }
}

export function removeToml(t: Extract<Target, { kind: 'toml' }>): Outcome {
  if (!existsSync(t.path)) return { status: 'absent', where: t.path }
  const text = readFileSync(t.path, 'utf8')
  const span = tomlSpan(text, t.table)
  if (!span) return { status: 'absent', where: t.path }
  writeFileSync(t.path, (text.slice(0, span[0]) + text.slice(span[1])).replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n'))
  return { status: 'removed', where: t.path }
}

export function hasToml(t: Extract<Target, { kind: 'toml' }>): boolean {
  if (!existsSync(t.path)) return false
  const text = readFileSync(t.path, 'utf8')
  const span = tomlSpan(text, t.table)
  return !!span && text.slice(span[0], span[1]).trim() === tomlBlock(t).trim()
}

// ── commands ────────────────────────────────────────────────────────────────

export function runCommand(bin: string, args: string[]): Outcome {
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const where = `${bin} ${args.join(' ')}`
  if (r.error) return { status: 'failed', where, why: r.error.message }
  if (r.status !== 0) return { status: 'failed', where, why: (r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').slice(-3).join(' ') }
  return { status: 'ran', where }
}

// ── one door for the three kinds ────────────────────────────────────────────

export function apply(t: Target): Outcome {
  switch (t.kind) {
    case 'json': return applyJson(t)
    case 'toml': return applyToml(t)
    case 'command': return runCommand(t.bin, t.add)
    case 'link': return { status: 'by-hand', where: t.href, why: t.note, snippet: '' }
  }
}

export function remove(t: Target): Outcome {
  switch (t.kind) {
    case 'json': return removeJson(t)
    case 'toml': return removeToml(t)
    case 'command': return runCommand(t.bin, t.remove)
    case 'link': return { status: 'absent', where: t.href }
  }
}

/** Present, absent, or unknowable (a command's own store, or a file with comments). */
export function has(t: Target): boolean | 'unknown' {
  switch (t.kind) {
    case 'json': { const r = hasJson(t); return r === 'unreadable' ? 'unknown' : r }
    case 'toml': return hasToml(t)
    case 'command': return 'unknown'
    case 'link': return 'unknown'
  }
}
