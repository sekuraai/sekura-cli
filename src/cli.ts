#!/usr/bin/env node
// sekura: connect your coding tool to Sekura in one command.
//
//   npx sekura@latest init
//
// Sekura's MCP server is remote (https://sekura.ai/mcp), so this package
// runs no server: it writes the server's address into the tools on this
// machine, installs the skill that teaches an agent the quote-then-confirm
// rule, and then finishes getting started in the terminal. It signs in once
// on a sekura.ai page and gives the resulting key to each tool, so none of
// them asks, then helps with the GitHub App, a repository and the free scan.

import { Command } from 'commander'
import { createRequire } from 'node:module'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { uninstallCommand } from './commands/uninstall.js'
import { loginCommand, logoutCommand } from './commands/login.js'
import { DOCS } from './catalogue.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()
program
  .name('sekura')
  .description(`Connect your coding tool to Sekura.\n\n  npx sekura@latest init\n\nDocumentation: ${DOCS}`)
  .version(version)
  .addCommand(initCommand, { isDefault: false })
  .addCommand(loginCommand)
  .addCommand(statusCommand)
  .addCommand(uninstallCommand)
  .addCommand(logoutCommand)

try {
  await program.parseAsync(process.argv)
} catch (e) {
  // Ctrl-C inside a prompt is an exit, not an error.
  if ((e as Error)?.name === 'ExitPromptError') process.exit(130)
  process.stderr.write(`\n  ${(e as Error).message}\n\n`)
  process.exit(1)
}
