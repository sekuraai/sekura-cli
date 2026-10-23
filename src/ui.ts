// Output goes to stderr with plain words and no colour library, so it reads
// the same in every terminal and in a log. stdout stays empty: the person
// may pipe it.

export const say = (s = ''): void => { process.stderr.write(s + '\n') }

export const tick = '  ✓'
export const cross = '  ✗'
export const dot = '  ·'

export function banner(): void {
  say()
  say('  Sekura — connect your coding tool')
  say('  Every scan is quoted first and started only after you agree.')
  say('  Sign in once here, and your tools will not ask again.')
  say()
}
