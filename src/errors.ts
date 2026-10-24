import { SITE } from './endpoint.js'
import { SUPPORT } from './offer.js'

export const unreachable = (): string => `${SITE} could not be reached. Check your internet connection and try again.`

export const serverTrouble = (status: number): string => `${SITE} had a problem answering (HTTP ${status}). Try again in a minute; if it keeps happening, write to ${SUPPORT}.`

export async function reach(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init) } catch { throw new Error(unreachable()) }
}

export function refusal(data: Record<string, unknown>, status: number): string {
  if (status >= 500) return serverTrouble(status)
  const why = typeof data.error_description === 'string' ? data.error_description : typeof data.error === 'string' ? data.error : `HTTP ${status}`
  return `${SITE} refused the sign-in: ${why}. Run the command again; if it keeps happening, write to ${SUPPORT}.`
}
