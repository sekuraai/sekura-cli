// Signing in on a machine that has no browser of its own: over SSH, in a
// devcontainer or Codespace, on a remote dev box. The loopback redirect in
// auth.ts cannot work there, because the browser that approves runs on
// another machine and 127.0.0.1 is not this one. So the OAuth device
// authorization grant (RFC 8628): sekura.ai hands out a short code, the
// person enters it at sekura.ai/connect/device on any device, and this
// process asks the token endpoint until the answer is a key.
//
// The client is the one auth.ts registers for both grants, so a person
// sees one "Sekura CLI" client whichever way they signed in. The
// device_code is the secret half of the pair and is never printed; only the
// user_code is meant for eyes.

import { ENDPOINT } from './catalogue.js'
import { ORIGIN, SITE } from './endpoint.js'
import { reach, refusal } from './errors.js'

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

const ISSUER = ORIGIN

/** The variables that say this terminal is not on the machine with the
 *  browser. The first one set is named, so the person hears why. */
export const REMOTE_VARS = ['SSH_CONNECTION', 'SSH_TTY', 'CODESPACES', 'REMOTE_CONTAINERS', 'GITPOD_WORKSPACE_ID'] as const

export function remoteSession(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const v of REMOTE_VARS) if (env[v]?.trim()) return v
  return null
}

export type DeviceCode = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: new URLSearchParams(o).toString(),
})

export async function startDeviceAuthorization(clientId: string): Promise<DeviceCode> {
  const r = await reach(`${ISSUER}/oauth/device_authorization`, form({ client_id: clientId, scope: 'read write', resource: ENDPOINT }))
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) throw new Error(refusal(data, r.status))
  if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string' || typeof data.verification_uri !== 'string') {
    throw new Error(`${SITE} answered the device sign-in without a code`)
  }
  return data as unknown as DeviceCode
}

export type Poll = {
  /** Waits; injectable so a test does not sleep for real. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Asks the token endpoint every `interval` seconds until the person has
 * approved, declined, or let the code expire (RFC 8628 §3.4-3.5). Returns
 * the key.
 */
export async function pollDeviceToken(clientId: string, code: DeviceCode, opts: Poll = {}): Promise<string> {
  const sleep = opts.sleep ?? realSleep
  const now = opts.now ?? Date.now
  // The RFC's default when the server names none.
  let interval = Math.max(1, code.interval ?? 5) * 1000
  const deadline = now() + Math.max(1, code.expires_in) * 1000
  for (;;) {
    await sleep(interval)
    if (now() >= deadline) throw new Error('the code expired before it was approved; run the command again for a new one')
    let r: Response
    try {
      r = await fetch(`${ISSUER}/oauth/token`, form({ grant_type: DEVICE_GRANT, device_code: code.device_code, client_id: clientId, resource: ENDPOINT }))
    } catch {
      continue // the network blinked; the code is still good until it expires
    }
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (r.ok) {
      const key = String(data.access_token ?? '')
      if (!key) throw new Error(`${SITE} answered without a key`)
      return key
    }
    if (r.status >= 500) continue
    switch (data.error) {
      case 'authorization_pending': continue
      case 'slow_down': interval += 5000; continue
      case 'access_denied': throw new Error(`the sign-in was denied on ${SITE}`)
      case 'expired_token': throw new Error('the code expired before it was approved; run the command again for a new one')
      default: throw new Error(refusal(data, r.status))
    }
  }
}

/** What the person is shown: the page, the code, and the page with the code in it. */
export type DeviceShown = { userCode: string; uri: string; complete?: string; expiresIn?: number }

export async function deviceSignIn(clientId: string, opts: Poll & { onCode?: (c: DeviceShown) => void } = {}): Promise<string> {
  const code = await startDeviceAuthorization(clientId)
  opts.onCode?.({ userCode: code.user_code, uri: code.verification_uri, complete: code.verification_uri_complete, expiresIn: code.expires_in })
  return pollDeviceToken(clientId, code, opts)
}
