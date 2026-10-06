// Builds every data file of this folder from the run folder of the repair.
//
//   node build/build.mjs <path to .curation-runs/2026-10-audit-repair>
//
// It reads files only. It opens no database and calls no service. It writes the sixteen
// `aNN-*.json` and `bNN-*.json` files and `gaps.json` beside this folder.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, rowIndex } from './lib.mjs';
import { stageA } from './stage-a.mjs';
import { stageB } from './stage-b.mjs';
import { buildState, checkReplay } from './state.mjs';

const state = buildState();
const differ = checkReplay(state.afterPass1);

// The order is the order of trust: the snapshot of the start of stage B first, then the
// reads of stage A, which are the only ones that print an El Jamón row.
const rows = rowIndex([
  'stage-b/rows-snapshot.before.json',
  'a6.read.json',
  'a5.read.json',
  'a7.result.json',
  'pass2/pass2-a6-exact.result.json',
  'pass2/pass2-a6-near.result.json',
  'pass2/pass2-a9-merge.result.json',
  'stage-b/pairs.after-b3-merges.json',
  'stage-b/b1-left.end.json',
  'stage-b/b3-near-merge.result.json',
  'stage-b/b5-merge.result.json',
]);

const files = [...stageA({ ...state, rows }), ...stageB({ ...state, rows })];

const gaps = {
  replay: {
    productsBeforeStageA: state.beforeA.size,
    productsAtTheStartOfStageB: state.startB.size,
    writesThatNamedAProductTheReplayDoesNotHold: state.notFound.length,
    productsThatDifferFromTheTwoReadsOfPass1: differ.length,
  },
  files,
};
fs.writeFileSync(
  path.join(OUT, 'gaps.json'),
  JSON.stringify(gaps, null, 2) + '\n'
);
console.table(files);
console.log(gaps.replay);
