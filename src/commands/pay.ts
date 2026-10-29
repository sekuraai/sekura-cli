import { Command } from 'commander'
import { openBrowser, readKey } from '../auth.js'
import { getPlans, SignedOut, type Plan } from '../api.js'
import { openableLink, paymentState, scanLink, type PaymentState } from '../payment.js'
import { cross, dot, say, tick, waitFor } from '../ui.js'

export type PayOptions = { plan?: string; timeout?: string | number; open?: boolean; intervalMs?: number }

export const PAY_EXIT = { started: 0, paid: 0, notSignedIn: 4, cancelled: 3, timeout: 2, badLink: 1 } as const

const planName = (p: Plan | undefined): string => (p?.owner && p?.name ? `${p.owner}/${p.name}` : 'the repository')

const minutes = (raw: string | number | undefined, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : fallback
}

async function planById(key: string, planId: string): Promise<Plan | undefined> {
  return (await getPlans(key)).plans.find((p) => p.id === planId)
}

function sayOpened(link: URL, opened: boolean): void {
  if (opened) say(`${tick} Opened Stripe Checkout in your browser: ${link.href}`)
  else say(`${dot} Open this link in a browser to pay: ${link.href}`)
}

function sayOutcome(state: PaymentState, plan: Plan | undefined): void {
  const repo = planName(plan)
  if (state.kind === 'started') {
    const what = plan?.plan === 'always' ? `Sekura Always is on for ${repo}, and its first scan` : `The scan of ${repo}`
    say(`${tick} Payment received. ${what} has started: scan id ${state.scanId} (${state.scanStatus}).`)
    say(`  ${scanLink(state.scanId)}`)
  } else if (state.kind === 'paid') {
    say(`${tick} Payment received for ${repo}. The scan starts within a few minutes; ask your coding tool for listScans or getScan to follow it.`)
  } else if (state.kind === 'cancelled') {
    say(`${cross} Checkout was closed without paying, so nothing was charged and ${repo} is back to how it was.`)
  }
}

export async function runPay(link: string, opts: PayOptions = {}): Promise<number> {
  const url = openableLink(link)
  if (!url) {
    say(`${cross} Not a Stripe Checkout or Sekura link, so it was not opened: ${link}`)
    return PAY_EXIT.badLink
  }
  const opened = opts.open === false ? false : openBrowser(url.href)
  sayOpened(url, opened)
  const key = readKey()
  if (!opts.plan || !key) {
    say(`${dot} ${key ? 'No plan id was given' : 'Not signed in here (npx sekura@latest login)'}, so this terminal cannot tell when the payment lands. After paying, ask your coding tool for getPlans.`)
    return PAY_EXIT.notSignedIn
  }
  const planId = opts.plan
  let start: Plan | undefined
  try { start = await planById(key, planId) } catch (e) {
    if (e instanceof SignedOut) { say(`${cross} Your Sekura key no longer works (${e.message}); run npx sekura@latest login.`); return PAY_EXIT.notSignedIn }
  }
  let last: Plan | undefined = start
  let state: PaymentState = { kind: 'waiting' }
  let cancelledSeen = 0
  const result = await waitFor('Waiting for the payment to complete in your browser (Enter to stop waiting)', async () => {
    last = await planById(key, planId)
    state = paymentState(start, last)
    if (state.kind === 'cancelled') return ++cancelledSeen >= 2
    cancelledSeen = 0
    return state.kind === 'started'
  }, { timeoutMs: minutes(opts.timeout, 9) * 60_000, ...(opts.intervalMs ? { intervalMs: opts.intervalMs } : {}) })
  const final = state as PaymentState
  if (result === 'done' || final.kind === 'paid') {
    sayOutcome(final, last)
    return final.kind === 'cancelled' ? PAY_EXIT.cancelled : PAY_EXIT.started
  }
  say(`${dot} ${result === 'skipped' ? 'Stopped waiting' : 'No payment yet'}. The Checkout link stays valid for 24 hours; the scan starts as soon as it is paid. Ask your coding tool for getPlans to check.`)
  return PAY_EXIT.timeout
}

export const payCommand = new Command('pay')
  .description('Open a Stripe Checkout link from a Sekura quote in your browser and wait until the payment lands.')
  .argument('<checkout-link>', 'the Checkout link Sekura answered with')
  .option('--plan <id>', 'the plan id from the same answer, to wait on')
  .option('--timeout <minutes>', 'how long to wait', '9')
  .option('--no-open', 'print the link instead of opening it')
  .action(async (link: string, opts: PayOptions) => { process.exitCode = await runPay(link, opts) })
