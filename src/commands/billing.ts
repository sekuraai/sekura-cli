import { Command } from 'commander'
import { openBrowser, readKey } from '../auth.js'
import { getBilling, SignedOut, type Billing } from '../api.js'
import { cardLines, cardsFingerprint, paymentMethodsLink } from '../payment.js'
import { cross, dot, say, tick, waitFor } from '../ui.js'

export type BillingOptions = { open?: boolean; timeout?: string | number; intervalMs?: number; browser?: boolean }

function sayCards(b: Billing, heading: string): void {
  const lines = cardLines(b)
  if (!lines.length) { say(`${dot} No saved card. Your first payment on a Stripe Checkout page saves the card you use there.`); return }
  say(`${tick} ${heading}`)
  for (const l of lines) say(`    ${l}`)
}

export async function runBilling(opts: BillingOptions = {}): Promise<number> {
  const key = readKey()
  if (!key) { say(`${cross} Not signed in here: run npx sekura@latest login first.`); return 4 }
  let before: Billing
  try { before = await getBilling(key) } catch (e) {
    say(`${cross} ${e instanceof SignedOut ? `Your Sekura key no longer works (${e.message}); run npx sekura@latest login.` : `Sekura could not be asked: ${(e as Error).message}`}`)
    return 1
  }
  if (!opts.open) { sayCards(before, 'Saved cards:'); return 0 }
  const link = paymentMethodsLink()
  const opened = opts.browser === false ? false : openBrowser(link)
  say(opened ? `${tick} Opened your payment methods in the browser: ${link}` : `${dot} Open this link in a browser to add or change a card: ${link}`)
  const was = cardsFingerprint(before)
  let now = before
  const minutes = Number(opts.timeout)
  const result = await waitFor('Waiting for your cards to change (Enter when you are done)', async () => {
    now = await getBilling(key)
    return cardsFingerprint(now) !== was
  }, { timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 60) : 5) * 60_000, ...(opts.intervalMs ? { intervalMs: opts.intervalMs } : {}) })
  if (result !== 'done') {
    try { now = await getBilling(key) } catch { now = before }
  }
  sayCards(now, cardsFingerprint(now) !== was ? 'Your cards now:' : 'No change seen. Saved cards:')
  return 0
}

export const billingCommand = new Command('billing')
  .description('Show your saved cards, masked; with --open, change them in the browser and show the new list.')
  .option('--open', 'open the page where cards are added or changed, then wait for the change')
  .option('--timeout <minutes>', 'how long to wait with --open', '5')
  .option('--no-browser', 'print the link instead of opening it')
  .action(async (opts: BillingOptions) => { process.exitCode = await runBilling(opts) })
