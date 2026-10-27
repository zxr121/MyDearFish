/** Source-checkout CLI entry: keep runtime data in `<repo>/data`, matching a packaged `<install>/data` home. */

import { fileURLToPath } from 'node:url'

process.env.DSH_HOME ||= fileURLToPath(new URL('../data', import.meta.url))

const { runCli } = await import('../apps/cli/src/bin.ts')
await runCli()
