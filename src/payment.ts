import { ENDPOINT } from './catalogue.js'
import type { Billing, Plan, SavedCard } from './api.js'

export const SEKURA_ORIGIN = new URL(ENDPOINT).origin

const OPENABLE_HOSTS = new Set(['checkout.stripe.com', 'billing.stripe.com', new URL(ENDPOINT).host])

export function openableLink(raw: string): URL | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
  return OPENABLE_HOSTS.has(url.host) ? url : null
}

export const paymentMethodsLink = (): string => `${SEKURA_ORIGIN}/app/payment-methods`

export const scanLink = (scanId: string): string => `${SEKURA_ORIGIN}/app/scans/${encodeURIComponent(scanId.startsWith('ss-') ? scanId : `ss-${scanId}`)}`

export type PaymentState =
  | { kind: 'waiting' }
  | { kind: 'paid' }
  | { kind: 'started'; scanId: string; scanStatus: string }
  | { kind: 'cancelled' }

const newScanOf = (start: Plan | undefined, now: Plan) =>
  now.lastScan && now.lastScan.id !== start?.lastScan?.id ? now.lastScan : null

export function paymentState(start: Plan | undefined, now: Plan | undefined): PaymentState {
  if (!now) return start ? { kind: 'cancelled' } : { kind: 'waiting' }
  if (now.status === 'active') {
    const scan = newScanOf(start, now)
    if (scan) return { kind: 'started', scanId: scan.id, scanStatus: scan.status }
    const backAsItWas = start?.status === 'pending' && (start.pendingFrom === 'rerun' || start.pendingFrom === 'upgrade') && !now.nextRunAt && !now.pendingFrom
    return backAsItWas && start.plan === now.plan ? { kind: 'cancelled' } : { kind: 'paid' }
  }
  if (now.status === 'pending' && start?.selected && !now.selected) return { kind: 'cancelled' }
  if (now.status === 'canceled') return { kind: 'cancelled' }
  return { kind: 'waiting' }
}

export const cardLines = (b: Billing): string[] =>
  (b.cards ?? []).map((c: SavedCard) => `${c.masked}${c.isDefault ? '  (default)' : ''}`)

export const cardsFingerprint = (b: Billing): string =>
  (b.cards ?? []).map((c) => `${c.masked}:${c.isDefault ? 1 : 0}`).join('|')
