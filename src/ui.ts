// Output goes to stderr with plain words and no colour library, so it reads
// the same in every terminal and in a log. stdout stays empty: the person
// may pipe it.

import { DEFAULT_ORIGIN, ORIGIN, isDefaultOrigin } from './endpoint.js'

export const say = (s = ''): void => { process.stderr.write(s + '\n') }

export const tick = '  ✓'
export const cross = '  ✗'
export const dot = '  ·'

export function endpointNotice(): void {
  if (!isDefaultOrigin()) say(`  Using the Sekura server at ${ORIGIN}, not ${DEFAULT_ORIGIN}`)
}

export function banner(): void {
  say()
  say('  Sekura — connect your coding tool')
  endpointNotice()
  say('  Every scan is quoted first and started only after you agree.')
  say('  Sign in once here, and your tools will not ask again.')
  say()
}

// ── waiting on the browser ──────────────────────────────────────────────────

export type Wait = { intervalMs?: number; timeoutMs?: number; skipOnEnter?: boolean }

/** How often a wait asks, and for how long. Tests make both short. */
export const WAIT = { intervalMs: 2500, timeoutMs: 300_000 }

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/**
 * Asks `check` until it says yes, the person presses Enter, or the time is
 * up, with a one-line spinner on a terminal. Replaces "press Enter when you
 * are done": the person is in the browser, and the terminal should notice
 * by itself when they have finished.
 */
export async function waitFor(message: string, check: () => Promise<boolean>, opts: Wait = {}): Promise<'done' | 'skipped' | 'timeout'> {
  const interval = opts.intervalMs ?? WAIT.intervalMs
  const deadline = Date.now() + (opts.timeoutMs ?? WAIT.timeoutMs)
  const tty = !!process.stderr.isTTY
  const enter = opts.skipOnEnter ?? !!process.stdin.isTTY
  let skipped = false
  let wake = () => {}
  const onData = (b: Buffer) => { if (/[\r\n]/.test(String(b))) { skipped = true; wake() } }
  if (enter) { process.stdin.on('data', onData); process.stdin.resume() }
  let f = 0
  const draw = () => { process.stderr.write(`\r  ${FRAMES[f++ % FRAMES.length]} ${message}`) }
  const spin = tty ? setInterval(draw, 120) : null
  if (tty) draw(); else say(`  ${message}`)
  const pause = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r() } })
  try {
    for (;;) {
      try { if (await check()) return 'done' } catch { /* a blip; ask again */ }
      if (skipped) return 'skipped'
      const left = deadline - Date.now()
      if (left <= 0) return 'timeout'
      await pause(Math.min(interval, left))
      if (skipped) return 'skipped'
    }
  } finally {
    if (spin) clearInterval(spin)
    if (tty) process.stderr.write('\r\x1b[2K')
    if (enter) { process.stdin.off('data', onData); process.stdin.pause() }
  }
}
