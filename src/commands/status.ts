// `sekura status`: which tools are here, which carry Sekura, and whether the
// server answers. Reads only.

import { Command } from 'commander'
import { ENDPOINT, carriesKey } from '../catalogue.js'
import { buildPlan, detectTools, stepPresent, type Scope } from '../plan.js'
import { readKey, redact } from '../auth.js'
import { getAccount, SignedOut } from '../api.js'
import { verifyEndpoint } from '../verify.js'
import { cross, dot, endpointNotice, say, tick } from '../ui.js'

export async function runStatus(opts: { scope?: Scope; cwd?: string; verify?: boolean }): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const scope = opts.scope ?? 'user'
  const detected = detectTools(cwd)
  say()
  endpointNotice()
  if (!detected.length) say('  No supported coding tool found on this machine.')
  const key = readKey()
  const plan = buildPlan({ tools: detected.map((t) => t.id), scope, skill: true, cwd, key })
  const plain = key ? buildPlan({ tools: detected.map((t) => t.id), scope, skill: true, cwd }) : plan
  plan.steps.forEach((s, i) => {
    let p = stepPresent(s)
    // An entry without the key is still connected; its tool signs in itself.
    let how = s.kind === 'tool' && p === true && carriesKey(s.target) ? ' (with your key)' : ''
    if (s.kind === 'tool' && p !== true && plain !== plan && stepPresent(plain.steps[i]) === true) { p = true; how = ' (signs in in the tool)' }
    const mark = p === true ? tick : p === 'unknown' ? dot : cross
    const noun = s.kind === 'tool' ? 'connected' : 'installed'
    const word = p === true ? noun + how : p === 'unknown' ? (s.kind === 'tool' && s.target.kind === 'command' ? 'kept by the tool itself; ask it' : 'its file has comments; look by hand') : `not ${noun}`
    const label = s.kind === 'tool' ? s.tool.name : s.kind === 'skill' ? `skill ${s.path}` : `guidance ${s.path}`
    say(`${mark} ${label}: ${word}`)
  })
  for (const s of plan.skipped) say(`${dot} ${s.tool.name}: ${s.why}`)
  if (opts.verify !== false) {
    const v = await verifyEndpoint(ENDPOINT)
    say(`${v.ok ? tick : cross} ${v.detail}`)
    if (key) {
      try { const a = await getAccount(key); say(`${tick} Signed in to Sekura as ${a.email ?? a.name ?? redact(key)}`) }
      catch (e) { say(`${cross} The saved key ${redact(key)} ${e instanceof SignedOut ? 'no longer works: run sekura login' : `could not be checked: ${(e as Error).message}`}`) }
    } else say(`${dot} Not signed in here: run sekura login to give your tools a key`)
  }
  say()
}

export const statusCommand = new Command('status')
  .description('Show which tools on this machine are connected to Sekura.')
  .option('--scope <scope>', 'user or project', 'user')
  .option('--no-verify', 'do not check that the Sekura server answers')
  .action(async (opts: { scope: Scope; verify?: boolean }) => { await runStatus(opts) })
