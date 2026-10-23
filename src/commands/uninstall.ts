// `sekura uninstall`: take the sekura entry out of every tool it was written
// to, and the skill and guidance with it unless asked to keep them. Nothing
// else in any file is touched. Sign-ins the tool keeps in its own store (a
// keychain entry, a token) are the tool's to forget; the connection can also
// be revoked on sekura.ai under Settings → Agents and API keys.

import { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { buildPlan, describeStep, detectTools, removeStep, type Scope } from '../plan.js'
import { credentialsPath, forgetKey } from '../auth.js'
import { cross, dot, say, tick } from '../ui.js'

export async function runUninstall(opts: { yes?: boolean; keepSkill?: boolean; keepLogin?: boolean; scope?: Scope; cwd?: string }): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const scope = opts.scope ?? 'user'
  const interactive = !opts.yes && process.stdin.isTTY && process.stderr.isTTY
  const plan = buildPlan({ tools: detectTools(cwd).map((t) => t.id), scope, skill: !opts.keepSkill, cwd })
  say()
  say('  This will remove Sekura from:')
  for (const s of plan.steps) say(`${dot} ${describeStep(s).split(':')[0]}`)
  if (!opts.keepLogin) say(`${dot} the saved key, ${credentialsPath()}`)
  say('  and change nothing else.')
  say()
  if (interactive && !(await confirm({ message: 'Remove?', default: false }))) { say('  Nothing was changed.'); return 0 }
  let failed = 0
  for (const s of plan.steps) {
    const r = removeStep(s)
    if (r.status === 'removed' || r.status === 'ran') say(`${tick} ${r.where}`)
    else if (r.status === 'absent') say(`${dot} ${r.where}: nothing to remove`)
    // A file this installer never rewrites (comments) is one it never wrote
    // to either; the person is told where to look, and nothing has failed.
    else if (r.status === 'by-hand') say(`${dot} ${r.where}: ${r.why}; ${r.snippet} by hand if it is there`)
    else { failed++; say(`${cross} ${r.where}: ${'why' in r ? r.why : r.status}`) }
  }
  if (!opts.keepLogin && forgetKey()) say(`${tick} ${credentialsPath()}`)
  say()
  say('  To end the connection on Sekura\'s side too: https://sekura.ai/app/settings → Agents and API keys.')
  say()
  return failed
}

export const uninstallCommand = new Command('uninstall')
  .description('Remove Sekura from every tool on this machine, and the skill.')
  .option('-y, --yes', 'remove without asking')
  .option('--keep-skill', 'leave the skill and the guidance block in place')
  .option('--keep-login', 'leave the saved Sekura key in place')
  .option('--scope <scope>', 'user or project', 'user')
  .action(async (opts: { yes?: boolean; keepSkill?: boolean; keepLogin?: boolean; scope: Scope }) => {
    process.exitCode = (await runUninstall(opts)) ? 1 : 0
  })
