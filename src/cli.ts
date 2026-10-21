#!/usr/bin/env node
// sekura: connect your coding tool to Sekura in one command.
//
//   npx sekura@latest init
//
// Sekura's MCP server is remote (https://sekura.ai/mcp), so this package
// runs no server and holds no credential: it writes the server's address
// into the tools on this machine, installs the skill that teaches an agent
// the quote-then-confirm rule, and gets out of the way. Signing in happens
// in the tool, on a sekura.ai page, the first time it uses Sekura.

import { Command } from 'commander'
import { createRequire } from 'node:module'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { uninstallCommand } from './commands/uninstall.js'
import { DOCS } from './catalogue.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()
program
  .name('sekura')
  .description(`Connect your coding tool to Sekura.\n\n  npx sekura@latest init\n\nDocumentation: ${DOCS}`)
  .version(version)
  .addCommand(initCommand, { isDefault: false })
  .addCommand(statusCommand)
  .addCommand(uninstallCommand)

try {
  await program.parseAsync(process.argv)
} catch (e) {
  // Ctrl-C inside a prompt is an exit, not an error.
  if ((e as Error)?.name === 'ExitPromptError') process.exit(130)
  process.stderr.write(`\n  ${(e as Error).message}\n\n`)
  process.exit(1)
}
