#!/usr/bin/env node
import { main } from '../src/cli/index.ts';

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'keyless failed'}\n`);
  process.exitCode = 1;
});
