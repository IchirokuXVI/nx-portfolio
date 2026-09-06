#!/usr/bin/env node
/**
 * Compares one build's report against its chain's `baseline.json`, and refuses
 * a reading that does not look like the chain's previous one.
 *
 *   node apps/luna-shopper-backend/harvester/tools/leaflet/drift-check.mjs \
 *     --report <out.report.json> --chain <slug>
 *
 * `build-document.mjs` writes `statistics` into every report it produces:
 * products per page, how many products carry a price, a unit price only, or
 * neither, how many carry a promotion, a null size or a brand, which unit
 * price label patterns and which department headings the reading used, and
 * which of those headings this chain's `headings.mjs` cannot resolve. This
 * script prints every one of those that moved further than its band allows and
 * exits 1, so a format change that would otherwise reach the upload silently
 * is instead a red check a person reads before uploading anything.
 *
 * The owner will not check every leaflet by hand, so this is the thing that
 * does: not a proof the reading is correct, only a signal that it still looks
 * like the chain's leaflet rather than something the reading process
 * misread.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1'
);

/** A share (a fraction of products) that moved more than this many points,
 * either direction, is drift. Fifteen points is chosen to clear the ordinary
 * page to page noise a 62 page leaflet already showed between runs, while
 * still catching a format change that reassigns a whole department. */
const SHARE_BAND = 0.15;

/** A products per page mean or max that fell to half, or rose past double,
 * the baseline's is drift: a tile density change that large is a page layout
 * change, not sampling noise. */
const DENSITY_RATIO_BAND = 2;

function flagShares(current, baseline) {
  const flags = [];
  for (const key of Object.keys(baseline)) {
    const before = baseline[key] ?? 0;
    const after = current[key] ?? 0;
    if (Math.abs(after - before) > SHARE_BAND) {
      flags.push(
        `share ${key} moved from ${before} to ${after}, more than ${SHARE_BAND} points`
      );
    }
  }
  return flags;
}

function flagDensity(current, baseline) {
  const flags = [];
  for (const key of ['mean', 'max']) {
    const before = baseline[key] ?? 0;
    const after = current[key] ?? 0;
    if (before === 0) {
      if (after > 0) {
        flags.push(
          `products per page ${key} was 0 in the baseline and is now ${after}`
        );
      }
      continue;
    }
    const ratio = after / before;
    if (ratio <= 1 / DENSITY_RATIO_BAND || ratio >= DENSITY_RATIO_BAND) {
      flags.push(
        `products per page ${key} moved from ${before} to ${after}, more than doubled or halved`
      );
    }
  }
  return flags;
}

/** Anything present now that the baseline never saw: a new heading, a new
 * unrecognized heading, or a new unit price label shape. Zero tolerance,
 * because each of these three is a fact about the chain's own printed page,
 * not a number that drifts gradually. */
function flagNew(label, current, baseline) {
  const known = new Set(baseline ?? []);
  const added = (current ?? []).filter((value) => !known.has(value));
  return added.map((value) => `${label} "${value}" is not in the baseline`);
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };

  const reportPath = flag('--report');
  const chain = flag('--chain');
  if (!reportPath || !chain) {
    console.error(
      'usage: node drift-check.mjs --report <out.report.json> --chain <slug>'
    );
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
  const baselinePath = join(HERE, 'chains', chain, 'baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const current = report.statistics;
  if (!current) {
    console.error(
      `${reportPath} carries no "statistics", so there is nothing to compare. ` +
        'Build it with the current build-document.mjs, which always writes one.'
    );
    process.exit(2);
  }

  const flags = [
    ...flagShares(current.shares ?? {}, baseline.shares ?? {}),
    ...flagDensity(
      current.productsPerPage ?? {},
      baseline.productsPerPage ?? {}
    ),
    ...flagNew('heading', current.headings, baseline.headings),
    ...flagNew(
      'unrecognized heading',
      current.unrecognizedHeadings,
      baseline.unrecognizedHeadings
    ),
    ...flagNew(
      'unit price label pattern',
      current.unitPriceLabelPatterns,
      baseline.unitPriceLabelPatterns
    ),
  ];

  if (flags.length === 0) {
    console.log(
      `OK ${reportPath}: within ${chain}'s baseline on every statistic.`
    );
    process.exit(0);
  }

  console.log(
    `DRIFT ${reportPath}: ${flags.length} statistic(s) left ${chain}'s baseline band.`
  );
  for (const flagText of flags) {
    console.log('  ' + flagText);
  }
  process.exit(1);
}

main(process.argv);
