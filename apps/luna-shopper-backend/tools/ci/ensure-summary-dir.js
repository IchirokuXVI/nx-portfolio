'use strict';

const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Jest `globalSetup` for the integration configs (plan 0015, section 3.3).
 *
 * The `test-integration` targets write a Jest JSON summary that CI reads to prove
 * the suite actually executed specs. Jest's `--outputFile` is a bare
 * `writeFileSync` with no `mkdir`, so without this the very first run in a clean
 * checkout dies at the end of an otherwise passing suite. Creating the directory
 * here rather than in the workflow keeps `nx run <svc>:test-integration` working
 * on its own, which is the whole point of the wrapper targets.
 *
 * The path is resolved against the process cwd (the workspace root under Nx),
 * exactly as Jest resolves `outputFile`, so the two cannot disagree.
 */
module.exports = async function ensureSummaryDir() {
  mkdirSync(resolve(process.cwd(), 'test-output/luna-shopper-backend/integration'), {
    recursive: true,
  });
};
