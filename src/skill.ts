// The skill and the guidance block: what teaches an agent the rule that
// every Sekura scan is quoted first and started only after the person agrees.
//
// The skill is the one in sekuraai/sekura-plugins (the Claude Code plugin's
// skills/sekura/SKILL.md), shipped inside this package so an install that
// cannot reach GitHub still gets it. Written under ~/.agents/skills/ (the
// Agent Skills location several tools read) and, where Claude Code is
// present, under ~/.claude/skills/. In project scope the same two paths
// under the project, plus a marked block in AGENTS.md (and CLAUDE.md when
// one exists): reruns replace only what sits between the markers.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOCS, ENDPOINT, SERVER_NAME } from './catalogue.js'
import type { Outcome } from './writers.js'

const here = dirname(fileURLToPath(import.meta.url))
/** The packaged skill: dist/ sits beside skills/ in the published package. */
export const SKILL_SOURCE = join(here, '..', 'skills', SERVER_NAME, 'SKILL.md')
/** LF whatever the checkout did: a Windows clone with autocrlf would otherwise
 *  install a skill whose every line ends in \r, and a rerun would rewrite it. */
export const skillText = (): string => readFileSync(SKILL_SOURCE, 'utf8').replace(/\r\n/g, '\n')

export function skillPaths(root: string, claude: boolean, scope: 'user' | 'project'): string[] {
  const out = [join(root, '.agents', 'skills', SERVER_NAME, 'SKILL.md')]
  if (claude || (scope === 'project' && existsSync(join(root, '.claude')))) out.push(join(root, '.claude', 'skills', SERVER_NAME, 'SKILL.md'))
  return out
}

export function writeSkill(path: string): Outcome {
  const text = skillText()
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return { status: 'unchanged', where: path }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return { status: 'written', where: path }
}

export function removeSkill(path: string): Outcome {
  if (!existsSync(path)) return { status: 'absent', where: path }
  rmSync(dirname(path), { recursive: true, force: true })
  return { status: 'removed', where: path }
}

// ── the guidance block ──────────────────────────────────────────────────────

const START = '<!-- sekura:start -->'
const END = '<!-- sekura:end -->'

export const GUIDANCE = `${START}
## Sekura

Sekura (the \`${SERVER_NAME}\` MCP server, ${ENDPOINT}) scans a GitHub repository for
vulnerabilities and proves each finding. Every scan or plan is quoted first: show
the user the preview as it stands, with the price and the authorization sentence,
and call the tool again only after they have agreed in the conversation. The
\`${SERVER_NAME}\` skill (.agents/skills/${SERVER_NAME}/SKILL.md) has the tool names and the rules.
Documentation: ${DOCS}
${END}
`

export function guidanceFiles(cwd: string): string[] {
  const out = [join(cwd, 'AGENTS.md')]
  if (existsSync(join(cwd, 'CLAUDE.md'))) out.push(join(cwd, 'CLAUDE.md'))
  return out
}

export function writeGuidance(path: string): Outcome {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const a = text.indexOf(START), b = text.indexOf(END)
  if (a >= 0 && b > a) {
    const current = text.slice(a, b + END.length + 1)
    if (current === GUIDANCE) return { status: 'unchanged', where: path }
    writeFileSync(path, text.slice(0, a) + GUIDANCE + text.slice(b + END.length).replace(/^\n/, ''))
    return { status: 'written', where: path }
  }
  const sep = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(path, text + sep + GUIDANCE)
  return { status: 'written', where: path }
}

export function removeGuidance(path: string): Outcome {
  if (!existsSync(path)) return { status: 'absent', where: path }
  const text = readFileSync(path, 'utf8')
  const a = text.indexOf(START), b = text.indexOf(END)
  if (a < 0 || b < a) return { status: 'absent', where: path }
  const out = (text.slice(0, a) + text.slice(b + END.length).replace(/^\n/, '')).replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n')
  if (!out.trim()) rmSync(path)
  else writeFileSync(path, out)
  return { status: 'removed', where: path }
}

export function hasGuidance(path: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8').includes(GUIDANCE)
}
