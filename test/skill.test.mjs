// The skill against the server's real tool list: every tool it names exists,
// every tool is named, the pairs are written as pairs, and nothing offers a
// free scan. The last test asks a live server (SEKURA_TOOLS_LIST_URL, with a
// read write key in SEKURA_API_KEY) and is skipped without one, so a tool
// renamed on the server fails here rather than in a user's first scan.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOOL_NAMES, QUOTE_CONFIRM, PREVIEW_ACT } from './tools.mjs'

const SKILL = readFileSync(new URL('../skills/sekura/SKILL.md', import.meta.url), 'utf8')
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

// A tool name is a camelCase word starting with one of the server's verbs;
// none of the argument names (disclosureVersion, amountCents, savedCard,
// confirmArguments, scanId, planId) does.
const NAMED = /\b(?:get|list|quote|start|preview|cancel|update|run)[A-Z][A-Za-z]*\b/g

test('there are eighteen tools, each listed once', () => {
  assert.equal(TOOL_NAMES.length, 18)
  assert.equal(new Set(TOOL_NAMES).size, 18)
})

test('every tool the skill names is one the server has, and it names all eighteen', () => {
  const named = new Set(SKILL.match(NAMED))
  const unknown = [...named].filter((n) => !TOOL_NAMES.includes(n))
  const missing = TOOL_NAMES.filter((n) => !named.has(n))
  assert.deepEqual(unknown, [], `the skill names tools the server does not have: ${unknown.join(', ')}`)
  assert.deepEqual(missing, [], `the skill leaves out: ${missing.join(', ')}`)
})

test('the skill writes each quote and preview with its confirm', () => {
  for (const [a, b] of [...QUOTE_CONFIRM, ...PREVIEW_ACT]) assert.ok(SKILL.includes(`\`${a}\` → \`${b}\``), `${a} → ${b}`)
})

test('/sekura scan and always quote first; cancel previews', () => {
  assert.match(SKILL, /`scan <owner\/repo>`: `quoteScan`/)
  assert.match(SKILL, /`always <owner\/repo>`: `quoteAlways`/)
  assert.match(SKILL, /`cancel <scan>`: `previewCancelScan`/)
  assert.match(SKILL, /`previewCancelPlan` with that repository/)
  assert.match(SKILL, /`schedule <owner\/repo>`: `updateSchedule`/)
})

test('startScan is told to carry the disclosureVersion and amountCents the quote returned', () => {
  assert.match(SKILL, /`disclosureVersion` and `amountCents`/)
  assert.match(SKILL, /`confirmArguments`/)
  assert.doesNotMatch(SKILL, /call the same tool again/, 'the old one-tool preview contract is gone')
})

test('the skill and the README give the connector price and say the free scan is web-only (CEO Q4)', () => {
  for (const [name, text] of [['skill', SKILL], ['README', README]]) {
    assert.match(text, /Sekura Once at \$199/, name)
    assert.match(text, /first scan is free only when (you start it yourself|the user starts it themselves) on the website/, name)
    assert.ok(text.includes('https://sekura.ai/app/start'), name)
    for (const m of text.matchAll(/[^.\n]*free (first )?scan[^.\n]*/gi)) assert.match(m[0], /website|Never offer|about a free scan/i, `${name}: ${m[0]}`)
  }
  assert.ok(SKILL.includes('Never offer or start a free scan through this connection.'))
  assert.ok(SKILL.includes('support@sekura.ai'))
})

const URL_ = process.env.SEKURA_TOOLS_LIST_URL?.trim()
const KEY = process.env.SEKURA_API_KEY?.trim()
const skip = !URL_ ? 'set SEKURA_TOOLS_LIST_URL (e.g. https://dev.sekura.ai/mcp) and SEKURA_API_KEY to compare with a live server'
  : !KEY ? 'SEKURA_TOOLS_LIST_URL is set but SEKURA_API_KEY is not; tools/list needs a read write key'
  : false

test('the live server lists exactly these eighteen tools', { skip }, async () => {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(r.status, 200, `${URL_} answered ${r.status}`)
  const body = await r.json()
  const names = (body.result?.tools ?? []).map((t) => t.name).sort()
  // The server lists only the tools the key's scopes open (J-5); a read-only
  // key would show eight and fail here for the wrong reason.
  assert.deepEqual(names, [...TOOL_NAMES].sort(), 'the server\'s tools/list (use a key with read and write)')
})
