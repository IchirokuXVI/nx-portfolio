#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Prove the integration suites that ran actually executed specs (plan 0015,
 * section 3.3).
 *
 * `passWithNoTests` is kept on every `test-integration` target, and that is the
 * right default: a service with no integration specs yet is legitimate, and
 * failing the pipeline over it would push people to delete the target. The cost
 * is a hole. A `testMatch` typo, a spec renamed out of the pattern, or a whole
 * directory moved empties a suite, Jest reports success, and the pipeline stays
 * green while nothing is being tested. That is the same class of lie as a silent
 * skip, which is what this plan exists to stop.
 *
 * So the guard lives here instead: each `test-integration` target writes a Jest
 * JSON summary, and this script asserts that every service KNOWN to have specs
 * produced one with at least one executed test. A service not in that list is
 * ignored, so adding a target ahead of its specs still works; the moment specs
 * exist, add it here and the count is enforced from then on.
 *
 * Usage (the projects that were actually run, comma or space separated — Nx
 * `affected` narrows the set, so the ones that did not run are skipped):
 *
 *   node apps/luna-shopper-backend/tools/ci/assert-integration-ran.js \
 *     luna-shopper-backend-auth,luna-shopper-backend-core
 */

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Services that own integration specs today. Being on this list means "if you
 * ran, you must have executed at least one test".
 */
const EXPECTED_TO_HAVE_SPECS = new Set([
  'luna-shopper-backend-auth',
  'luna-shopper-backend-core',
  'luna-shopper-backend-catalog',
]);

/** Where the targets write their summaries; matches `outputFile` in project.json. */
const SUMMARY_DIR = join(
  process.cwd(),
  'test-output',
  'luna-shopper-backend',
  'integration'
);

function parseProjects(argv) {
  return argv
    .flatMap((arg) => arg.split(/[,\s]+/))
    .map((name) => name.trim())
    .filter(Boolean);
}

function main() {
  const ran = parseProjects(process.argv.slice(2));
  if (ran.length === 0) {
    console.error(
      'assert-integration-ran: no projects given. Pass the projects that were ' +
        'run, e.g. `... assert-integration-ran.js luna-shopper-backend-auth,luna-shopper-backend-core`.'
    );
    process.exit(2);
  }

  const problems = [];
  let checked = 0;

  for (const project of ran) {
    if (!EXPECTED_TO_HAVE_SPECS.has(project)) {
      console.log(`- ${project}: not expected to have integration specs, skipped`);
      continue;
    }

    const summaryPath = join(SUMMARY_DIR, `${project}.json`);
    if (!existsSync(summaryPath)) {
      problems.push(
        `${project}: no Jest summary at ${summaryPath}. The target either did ` +
          'not run or is missing its `json`/`outputFile` options.'
      );
      continue;
    }

    let summary;
    try {
      summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    } catch (error) {
      problems.push(`${project}: could not read ${summaryPath} (${error.message}).`);
      continue;
    }

    const total = Number(summary.numTotalTests ?? 0);
    const suites = Number(summary.numTotalTestSuites ?? 0);
    const passed = Number(summary.numPassedTests ?? 0);
    const failed = Number(summary.numFailedTests ?? 0);

    // Executed, not total: Jest counts a skipped test in `numTotalTests`, so a
    // suite the gate skipped wholesale still reports a healthy looking total.
    // Passed plus failed is the number that actually ran.
    const executed = passed + failed;

    if (executed < 1) {
      problems.push(
        `${project}: the integration run executed 0 of ${total} test(s) across ` +
          `${suites} suite(s). Either the suite was empty (a testMatch typo, or ` +
          'the *.integration.spec.ts files moved out from under it) or every spec ' +
          'was skipped. Both report a pass that tested nothing.'
      );
      continue;
    }

    checked += 1;
    console.log(
      `- ${project}: ${executed} of ${total} test(s) executed across ${suites} suite(s), ${failed} failed`
    );
  }

  if (problems.length > 0) {
    console.error('\nassert-integration-ran: the integration layer did not run.');
    for (const problem of problems) {
      console.error(`  * ${problem}`);
    }
    process.exit(1);
  }

  console.log(
    `assert-integration-ran: ${checked} service(s) executed integration specs.`
  );
}

main();
