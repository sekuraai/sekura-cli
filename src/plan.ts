// The plan: what `init` would do on this machine for the tools the person
// chose, built once and shown before anything is written, then applied
// step by step. `status` and `uninstall` read the same plan, so the three
// commands cannot disagree about where Sekura lives.

import { existsSync } from 'node:fs'
import { TOOLS, home, onPath, pickTarget, toolById, type Target, type Tool } from './catalogue.js'
import { apply, describe, has, remove, type Outcome } from './writers.js'
import { guidanceFiles, hasGuidance, removeGuidance, removeSkill, skillPaths, writeGuidance, writeSkill } from './skill.js'

export type Scope = 'user' | 'project'

export type Step =
  | { kind: 'tool'; tool: Tool; target: Target }
  | { kind: 'skill'; path: string }
  | { kind: 'guidance'; path: string }

export type Plan = { scope: Scope; root: string; steps: Step[]; skipped: { tool: Tool; why: string }[] }

export function detectTools(cwd = process.cwd()): Tool[] {
  const h = home()
  return TOOLS.filter((t) => t.detect(h, cwd))
}

export function buildPlan(opts: { tools: string[]; scope: Scope; skill: boolean; cwd?: string }): Plan {
  const cwd = opts.cwd ?? process.cwd()
  const root = opts.scope === 'user' ? home() : cwd
  const steps: Step[] = []
  const skipped: { tool: Tool; why: string }[] = []
  for (const id of opts.tools) {
    const tool = toolById(id)
    if (!tool) throw new Error(`no tool named ${id}; one of ${TOOLS.map((t) => t.id).join(', ')}`)
    const targets = opts.scope === 'user' ? tool.user(home()) : tool.project?.(cwd)
    if (!targets) { skipped.push({ tool, why: 'has no project-level configuration; run with --scope user' }); continue }
    const target = pickTarget(targets)
    if (!target) { skipped.push({ tool, why: 'its command is not on PATH' }); continue }
    steps.push({ kind: 'tool', tool, target })
  }
  if (opts.skill) {
    const claude = opts.tools.includes('tools-claude') || existsSync(`${home()}/.claude`) || onPath('claude')
    for (const p of skillPaths(root, claude, opts.scope)) steps.push({ kind: 'skill', path: p })
    if (opts.scope === 'project') for (const p of guidanceFiles(cwd)) steps.push({ kind: 'guidance', path: p })
  }
  return { scope: opts.scope, root, steps, skipped }
}

export function describeStep(s: Step, dryRun = false): string {
  const verb = dryRun ? 'would ' : ''
  switch (s.kind) {
    case 'tool': return `${s.tool.name}: ${describe(s.target, dryRun)}`
    case 'skill': return `skill: ${verb}write ${s.path}`
    case 'guidance': return `guidance: ${verb}add a marked Sekura section to ${s.path}`
  }
}

export function applyStep(s: Step): Outcome {
  switch (s.kind) {
    case 'tool': return apply(s.target)
    case 'skill': return writeSkill(s.path)
    case 'guidance': return writeGuidance(s.path)
  }
}

export function removeStep(s: Step): Outcome {
  switch (s.kind) {
    case 'tool': return remove(s.target)
    case 'skill': return removeSkill(s.path)
    case 'guidance': return removeGuidance(s.path)
  }
}

export function stepPresent(s: Step): boolean | 'unknown' {
  switch (s.kind) {
    case 'tool': return has(s.target)
    case 'skill': return existsSync(s.path)
    case 'guidance': return hasGuidance(s.path)
  }
}
