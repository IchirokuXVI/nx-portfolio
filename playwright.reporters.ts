import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * The reporter list an e2e suite runs with, given the one `nxE2EPreset` picked.
 *
 * The preset configures `html`, plus `blob` on CI. Neither prints to stdout, so
 * Playwright prepends a terminal reporter of its own, and on CI that fallback is
 * `dot` (see `printsToStdio` in `playwright/lib/runner/reporters.js`). The dot
 * reporter writes one character per finished test and only breaks the line every
 * 80 characters, while the GitHub Actions runner surfaces a log line only once it
 * sees a newline. A suite of fewer than 80 results therefore prints its opening
 * "Running N tests using 1 worker" line and then nothing whatsoever until the run
 * ends, which makes a job that is working look exactly like a job that is wedged.
 * That is how a two hour run was read as a hang with no evidence either way.
 *
 * `list` is the fix: in a non TTY it prints a complete line per finished test, so
 * the log always names the test that was running when a run died. It goes in
 * front of the preset's reporters rather than replacing them, leaving the html
 * and blob artifacts exactly as they were.
 *
 * CI only. Locally Playwright's fallback is `line`, which rewrites one status
 * line in place and is pleasanter to watch than `list`.
 *
 * A suite that configured a bare string reporter is returned untouched: that form
 * always names a reporter that prints to stdout, so it never had the problem.
 */
export function withProgressReporter(
  configured: PlaywrightTestConfig['reporter']
): PlaywrightTestConfig['reporter'] {
  if (!process.env['CI'] || !Array.isArray(configured)) return configured;

  return [['list'], ...configured];
}
