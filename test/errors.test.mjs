import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { reach, refusal, serverTrouble, unreachable } = await import('../dist/errors.js')
const { unknownCommand } = await import('../dist/origin.js')
const { unknownTools } = await import('../dist/commands/init.js')

const CLI = join(fileURLToPath(new URL('../dist/', import.meta.url)), 'cli.js')

test('a network failure reads as a plain sentence, not a stack', async () => {
  await assert.rejects(reach('http://127.0.0.1:1/', {}), (e) => e.message === unreachable())
  assert.match(unreachable(), /could not be reached\. Check your internet connection/)
})

test('a 5xx is a server problem with the support address; a 4xx names the reason', () => {
  assert.match(refusal({}, 502), /had a problem answering \(HTTP 502\).*support@sekura\.ai/)
  assert.equal(refusal({}, 503), serverTrouble(503))
  assert.match(refusal({ error_description: 'client unknown' }, 400), /refused the sign-in: client unknown\. Run the command again/)
  assert.match(refusal({ error: 'invalid_grant' }, 400), /refused the sign-in: invalid_grant\./)
  assert.match(refusal({}, 400), /refused the sign-in: HTTP 400\./)
})

test('an unknown command is caught before commander; options and their values are skipped', () => {
  assert.equal(unknownCommand(['scan', 'o/r']), 'scan')
  assert.equal(unknownCommand(['init', '--tools', 'claude']), null)
  assert.equal(unknownCommand(['--endpoint', 'http://localhost:3000', 'login']), null)
  assert.equal(unknownCommand(['--version']), null)
  assert.equal(unknownCommand([]), null)
})

test('the CLI answers an unknown command with the commands, the price and the free scan', () => {
  const r = spawnSync(process.execPath, [CLI, 'scan', 'owner/repo'], { encoding: 'utf8', env: { PATH: '' } })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Unknown command scan\. Commands: init, login, status, uninstall, logout\./)
  assert.match(r.stderr, /Sekura Once, \$199, quoted first/)
  assert.match(r.stderr, /sekura\.ai\/app\/start/)
})

test('unknown --tools names are listed; known ones pass with or without the prefix', () => {
  assert.deepEqual(unknownTools(['claude', 'tools-cursor', 'nope']), ['nope'])
  assert.deepEqual(unknownTools([]), [])
})
