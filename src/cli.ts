#!/usr/bin/env node
// sekura: connect your coding tool to Sekura in one command.
//
//   npx sekura@latest init      (a bare `npx sekura@latest` runs init too)
//
// Sekura's MCP server is remote (https://sekura.ai/mcp), so this package
// runs no server: it writes the server's address into the tools on this
// machine, installs the skill that teaches an agent the quote-then-confirm
// rule, and then finishes getting started in the terminal. Once the plan is
// agreed it signs in on a sekura.ai page (or with a code, where the browser
// is on another device) and gives the resulting key to each tool, so none
// of them asks, then helps with the Terms, the GitHub App and a repository.

import { createRequire } from 'node:module'
import { ENDPOINT_FLAG, ENDPOINT_VAR, endpointFromArgv, parseOrigin } from './origin.js'

const fail = (message: string, code = 1): never => {
  process.stderr.write(`\n  ${message}\n\n`)
  process.exit(code)
}

const flag = endpointFromArgv(process.argv.slice(2))
if (flag !== null) {
  try { process.env[ENDPOINT_VAR] = parseOrigin(flag) } catch (e) { fail((e as Error).message) }
} else if (process.env[ENDPOINT_VAR]?.trim()) {
  try { parseOrigin(process.env[ENDPOINT_VAR]!) } catch (e) { fail(`${ENDPOINT_VAR}: ${(e as Error).message}`) }
}

const { Command } = await import('commander')
const { initCommand } = await import('./commands/init.js')
const { statusCommand } = await import('./commands/status.js')
const { uninstallCommand } = await import('./commands/uninstall.js')
const { loginCommand, logoutCommand } = await import('./commands/login.js')
const { DOCS } = await import('./catalogue.js')

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()
program
  .name('sekura')
  .description(`Connect your coding tool to Sekura.\n\n  npx sekura@latest init    (a bare npx sekura@latest runs init too)\n\nDocumentation: ${DOCS}`)
  .version(version)
  .option(`${ENDPOINT_FLAG} <url>`, `the Sekura server to use instead of https://sekura.ai, such as https://dev.sekura.ai or http://127.0.0.1:8787 (also ${ENDPOINT_VAR})`)
  .addCommand(initCommand, { isDefault: true })
  .addCommand(loginCommand)
  .addCommand(statusCommand)
  .addCommand(uninstallCommand)
  .addCommand(logoutCommand)

try {
  await program.parseAsync(process.argv)
} catch (e) {
  if ((e as Error)?.name === 'ExitPromptError') process.exit(130)
  fail((e as Error).message)
}
