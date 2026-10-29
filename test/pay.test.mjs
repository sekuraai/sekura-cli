import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'sekura-pay-home-'))
process.env.SEKURA_HOME = HOME
process.env.HOME = HOME
process.env.XDG_CONFIG_HOME = join(HOME, '.config')
delete process.env.SEKURA_ENDPOINT

const KEY = 'sek_live_PayTestKey0123456789abcdWXYZ'
let plansSeq = []
let billingSeq = []
const asked = []
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null
  const tool = body?.params?.name
  asked.push(tool)
  const next = (seq) => (seq.length > 1 ? seq.shift() : seq[0])
  const data = tool === 'getPlans' ? { plans: next(plansSeq) } : tool === 'getBilling' ? next(billingSeq) : {}
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'prose' }], structuredContent: data } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

let said = ''
const write = process.stderr.write.bind(process.stderr)
process.stderr.write = (s, ...rest) => { said += String(s); return write(s, ...rest) }

const { runPay, PAY_EXIT } = await import('../dist/commands/pay.js')
const { runBilling } = await import('../dist/commands/billing.js')
const { paymentState, openableLink, scanLink, cardLines } = await import('../dist/payment.js')

const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3'
const pending = { id: 'plan_1', owner: 'acme', name: 'api', plan: 'once', status: 'pending', selected: true, pendingFrom: 'new', lastScan: null }
const active = { ...pending, status: 'active', pendingFrom: null, nextRunAt: '2026-10-28T10:00:00Z' }
const started = { ...active, nextRunAt: null, lastScan: { id: 'scan_9', status: 'queued' } }
const quick = { open: false, intervalMs: 5, timeout: 0.01 }

test('only Stripe Checkout and Sekura links are opened', () => {
  assert.ok(openableLink(CHECKOUT))
  assert.ok(openableLink('https://sekura.ai/app/payment-methods'))
  assert.equal(openableLink('https://evil.example/c/pay/cs_1'), null)
  assert.equal(openableLink('http://checkout.stripe.com/c/pay/cs_1'), null)
  assert.equal(openableLink('not a url'), null)
})

test('a link that is not Stripe or Sekura is refused and nothing is asked', async () => {
  asked.length = 0
  assert.equal(await runPay('https://evil.example/pay', { ...quick, plan: 'plan_1' }), PAY_EXIT.badLink)
  assert.equal(asked.length, 0)
})

test('the payment state follows the plan', () => {
  assert.equal(paymentState(pending, pending).kind, 'waiting')
  assert.equal(paymentState(pending, active).kind, 'paid')
  assert.deepEqual(paymentState(pending, started), { kind: 'started', scanId: 'scan_9', scanStatus: 'queued' })
  assert.equal(paymentState(pending, { ...pending, selected: false }).kind, 'cancelled')
  const rerun = { ...started, status: 'pending', pendingFrom: 'rerun', lastScan: { id: 'scan_old', status: 'done' } }
  assert.equal(paymentState(rerun, { ...rerun, status: 'active', pendingFrom: null, nextRunAt: null }).kind, 'cancelled')
  assert.equal(paymentState(rerun, { ...rerun, status: 'active', pendingFrom: null, nextRunAt: '2026-10-28T10:00:00Z' }).kind, 'paid')
  assert.equal(paymentState(rerun, { ...rerun, status: 'active', pendingFrom: null, lastScan: { id: 'scan_new', status: 'queued' } }).kind, 'started')
})

test('without a key it opens the link and says it cannot wait', async () => {
  delete process.env.SEKURA_API_KEY
  said = ''
  assert.equal(await runPay(CHECKOUT, { ...quick, plan: 'plan_1' }), PAY_EXIT.notSignedIn)
  assert.match(said, /Open this link in a browser to pay: https:\/\/checkout\.stripe\.com/)
  assert.match(said, /cannot tell when the payment lands/)
})

test('after paying in the browser the same session shows the scan', async () => {
  process.env.SEKURA_API_KEY = KEY
  plansSeq = [[pending], [pending], [active], [started]]
  said = ''
  assert.equal(await runPay(CHECKOUT, { ...quick, timeout: 1, plan: 'plan_1' }), PAY_EXIT.started)
  assert.match(said, /Payment received\. The scan of acme\/api has started: scan id scan_9 \(queued\)/)
  assert.ok(said.includes(scanLink('scan_9')))
})

test('Checkout closed unpaid is reported, after two reads agree', async () => {
  plansSeq = [[pending], [{ ...pending, selected: false }], [{ ...pending, selected: false }]]
  said = ''
  assert.equal(await runPay(CHECKOUT, { ...quick, timeout: 1, plan: 'plan_1' }), PAY_EXIT.cancelled)
  assert.match(said, /closed without paying, so nothing was charged/)
})

test('no payment before the timeout says so and keeps the link valid', async () => {
  plansSeq = [[pending]]
  said = ''
  assert.equal(await runPay(CHECKOUT, { ...quick, plan: 'plan_1' }), PAY_EXIT.timeout)
  assert.match(said, /No payment yet/)
})

const visa = { brand: 'Visa', last4: '4242', masked: 'Visa •••• •••• •••• 4242', isDefault: true }
const master = { brand: 'Mastercard', last4: '5100', masked: 'Mastercard •••• •••• •••• 5100', isDefault: false }

test('billing lists the saved cards masked, never more', async () => {
  billingSeq = [{ card: { brand: 'Visa', last4: '4242' }, cards: [visa, master] }]
  said = ''
  assert.equal(await runBilling({}), 0)
  assert.match(said, /Visa •••• •••• •••• 4242 {2}\(default\)/)
  assert.match(said, /Mastercard •••• •••• •••• 5100/)
  assert.doesNotMatch(said, /\d{5,}/)
  assert.deepEqual(cardLines({ cards: [master] }), ['Mastercard •••• •••• •••• 5100'])
})

test('billing --open waits for the cards to change and shows the new list', async () => {
  billingSeq = [{ cards: [visa] }, { cards: [visa] }, { cards: [visa, master] }]
  said = ''
  assert.equal(await runBilling({ open: true, browser: false, intervalMs: 5, timeout: 1 }), 0)
  assert.match(said, /Open this link in a browser to add or change a card: https:\/\/sekura\.ai\/app\/payment-methods/)
  assert.match(said, /Your cards now:/)
  assert.match(said, /Mastercard •••• •••• •••• 5100/)
})
