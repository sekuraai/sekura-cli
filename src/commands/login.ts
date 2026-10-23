// `sekura login`: sign in here and put the key into every tool already
// connected, then the account, a repository and the free scan. For someone
// who skipped the sign-in during init, revoked the key, or wants another
// repository. `sekura logout`: forget the saved key.

import { Command } from 'commander'
import { applyStep, buildPlan, detectTools, stepPresent } from '../plan.js'
import { carriesKey } from '../catalogue.js'
import { credentialsPath, forgetKey } from '../auth.js'
import { checkAccount, howToScan, obtainKey, offerFreeScan, pickRepository, runToolLogins } from '../guide.js'
import { cross, dot, say, tick } from '../ui.js'

export async function runLogin(opts: { cwd?: string }): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  const interactive = !!(process.stdin.isTTY && process.stderr.isTTY)
  say()
  const session = await obtainKey({ interactive, ask: false })
  if (!session) { say('  Not signed in; nothing was changed.'); say(); return 1 }

  // The tools Sekura is already in (user scope), with or without a key,
  // get the entry again with this key.
  const ids = detectTools(cwd).map((t) => t.id)
  const plain = buildPlan({ tools: ids, scope: 'user', skill: false, cwd })
  const connected = plain.steps.flatMap((s) => (s.kind === 'tool' && stepPresent(s) !== false ? [s.tool.id] : []))
  const keyed = buildPlan({ tools: connected, scope: 'user', skill: false, cwd, key: session.key })
  let failed = 0
  const names: string[] = []
  if (keyed.steps.length) say()
  for (const s of keyed.steps) {
    if (s.kind !== 'tool') continue
    names.push(s.tool.name)
    if (!carriesKey(s.target)) continue
    const r = applyStep(s)
    if (r.status === 'written' || r.status === 'ran') say(`${tick} ${s.tool.name}: ${r.where}`)
    else if (r.status === 'unchanged') say(`${tick} ${s.tool.name}: already has this key`)
    else if (r.status === 'by-hand') say(`${dot} ${s.tool.name}: ${r.where}: ${r.why}; add the header by hand with the key in ${credentialsPath()}`)
    else if (r.status === 'failed') { failed++; say(`${cross} ${s.tool.name}: ${r.where}: ${r.why}`) }
  }
  await runToolLogins(keyed.steps, interactive)
  if (!names.length) say(`${dot} No tool on this machine has Sekura yet: run sekura init.`)

  say()
  await checkAccount(session, interactive)
  const repo = await pickRepository(session, cwd, interactive)
  await offerFreeScan(session, repo, interactive)
  if (names.length) { say(); howToScan(names, repo) }
  say()
  return failed
}

export const loginCommand = new Command('login')
  .description('Sign in to Sekura here, give the key to every connected tool, and pick a repository.')
  .action(async () => { process.exitCode = (await runLogin({})) ? 1 : 0 })

export const logoutCommand = new Command('logout')
  .description('Forget the Sekura key saved on this machine.')
  .action(() => {
    say()
    say(forgetKey() ? `${tick} Removed ${credentialsPath()}` : `${dot} No saved key at ${credentialsPath()}`)
    say('  Tools that were given the key keep it until you run sekura uninstall. To end it everywhere: https://sekura.ai/app/settings → Agents and API keys.')
    say()
  })
