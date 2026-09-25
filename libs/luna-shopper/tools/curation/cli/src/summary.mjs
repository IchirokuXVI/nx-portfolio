/**
 * What a run prints when it ends (plan 0005).
 *
 * The run used to end on `report: <path>` and nothing else, so everything an
 * operator had to act on was in a JSON file they had to open. This is that
 * part of the file, as text: how many rows went which way, the brands to
 * register, and the command that applies the run, ready to paste.
 *
 * Pure functions of what `end` answered and what `report.json` holds, so the
 * text is tested without a run.
 */

/** How the operator runs the orchestrator. The `--` keeps Nx off the flags. */
export const CURATE = 'npx nx run luna-shopper/curation-cli:curate --';

/** How many unregistered brands the summary names before it points at the file. */
export const BRANDS_SHOWN = 20;

/** A path as a shell reads it: forward slashes, and quoted when it has a space. */
function shellPath(path) {
  const text = String(path).replace(/\\/g, '/');
  return /\s/.test(text) ? `"${text}"` : text;
}

/**
 * The `--apply` command for one decisions file.
 *
 * No `--implementation` and no `--main-url`: the first is read from the run
 * directory and the second from the file's header. The user is named when the
 * run was made as somebody else, and a password is never printed. The operator
 * types their own in the place this marks.
 */
export function applyCommandLine({
  file,
  mainUser = null,
  passwordGiven = false,
}) {
  return [
    CURATE,
    '--apply',
    shellPath(file),
    ...(mainUser ? ['--main-user', mainUser] : []),
    ...(passwordGiven ? ['--main-password', '<password>'] : []),
  ].join(' ');
}

/** The `--resume` command for one run directory. */
export function resumeCommandLine({ runDir, passwordGiven = false }) {
  return [
    CURATE,
    '--resume',
    shellPath(runDir),
    ...(passwordGiven ? ['--main-password', '<password>'] : []),
  ].join(' ');
}

/** How many of the recorded reviews are rows that failed rather than judgments. */
export function failedRowCount(report) {
  return (report?.reviews ?? []).filter((review) =>
    (review.issues ?? []).some((entry) => entry?.code === 'ROW_FAILED')
  ).length;
}

/**
 * The summary, as the lines the operator reads last.
 *
 * `counts` is what `end` answered, whichever decider it was, so the decision
 * kinds are the decider's own names in the decider's own order. Everything but
 * REVIEW is something `--apply` sends, so a run of reviews only says there is
 * nothing to apply rather than printing a command that would send nothing.
 */
export function summaryText({
  runDir,
  reportPath,
  counts = {},
  report = null,
  mainUser = null,
  passwordGiven = false,
  stopped = false,
  failed = false,
}) {
  const lines = ['', 'summary'];
  const kinds = Object.entries(counts ?? {});
  const decided = kinds.reduce((sum, [, count]) => sum + (count ?? 0), 0);
  lines.push(
    `  decided ${decided} rows${kinds.length > 0 ? `: ${kinds.map(([kind, count]) => `${kind} ${count}`).join(', ')}` : ''}`
  );
  const failedRows = failedRowCount(report);
  if (failedRows > 0) {
    lines.push(
      `  ${failedRows} of the reviews are rows that failed (ROW_FAILED), and the report names the error of each`
    );
  }

  const brands = report?.unregisteredBrands ?? [];
  if (brands.length > 0) {
    const shown = brands.slice(0, BRANDS_SHOWN);
    lines.push(
      brands.length > shown.length
        ? `  unregistered brands: ${brands.length}, the first ${shown.length} below. All of them are in ${reportPath} under unregisteredBrands.`
        : `  unregistered brands: ${brands.length}. They are also in ${reportPath} under unregisteredBrands.`
    );
    for (const brand of shown) {
      lines.push(
        `    ${brand.spelling ?? brand.key} (${brand.key}): ${brand.rows} ${brand.rows === 1 ? 'row' : 'rows'}`
      );
    }
  }

  lines.push(`  report: ${reportPath}`);

  const toApply = kinds
    .filter(([kind]) => kind !== 'REVIEW')
    .reduce((sum, [, count]) => sum + (count ?? 0), 0);
  if (toApply === 0) {
    lines.push(
      decided === 0
        ? '  nothing to apply: no row was decided'
        : '  nothing to apply: every decided row is a REVIEW'
    );
  } else {
    lines.push('  apply it with:');
    lines.push(
      `    ${applyCommandLine({ file: `${String(runDir).replace(/\\/g, '/')}/decisions.jsonl`, mainUser, passwordGiven })}`
    );
  }

  if (stopped || failed) {
    lines.push(
      '  the walk did not reach the end of the queue. Continue it with:'
    );
    lines.push(`    ${resumeCommandLine({ runDir, passwordGiven })}`);
  }
  return `${lines.join('\n')}\n`;
}
