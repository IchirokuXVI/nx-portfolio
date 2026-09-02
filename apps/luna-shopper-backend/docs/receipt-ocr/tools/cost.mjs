#!/usr/bin/env node
/**
 * What one receipt costs to read, per model.
 *
 *   node cost.mjs <ticketDir> [--width 3000 --height 4000]
 *
 * Gemini numbers are **measured**: they come from the `usageMetadata` the API
 * returned, recorded in the ticket's `usage.json`.
 *
 * Claude numbers are **computed**, because this machine has no Anthropic
 * credential and the readings were made through the Claude Code harness rather
 * than a billed API call. The image half follows the documented rule (a visual
 * token is a 28x28 patch, so an image costs ceil(w/28) * ceil(h/28), after
 * downscaling to the model's tier limits); the text half is estimated. Treat
 * them as the right order of magnitude, not as an invoice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** USD per million tokens. Sources cited in ../README.md. */
const RATES = {
  'claude-opus-5': { in: 5.0, out: 25.0, tier: 'high' },
  'claude-haiku-4-5': { in: 1.0, out: 5.0, tier: 'standard' },
  'gemini-3.7-flash': { in: 0.75, out: 3.75 },
  'gemini-3.6-flash': { in: 0.75, out: 3.75 },
  'gemini-3.5-flash': { in: 1.5, out: 9.0 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  'gemini-3-flash-preview': { in: 0.5, out: 3.0 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
};

/** Long-edge and visual-token ceilings per resolution tier. */
const TIERS = {
  high: { longEdge: 2576, maxTokens: 4784 },
  standard: { longEdge: 1568, maxTokens: 1568 },
};

const PATCH = 28;

/**
 * Visual tokens for an image on one tier, after the downscale the API applies.
 *
 * Two ceilings, applied in order: the long edge first, then the token count.
 * Our receipt photos are 12 megapixels, so both models land on their token cap
 * and the photo's exact dimensions stop mattering. That is worth knowing before
 * anyone "optimizes" by cropping.
 */
function visualTokens(width, height, tier) {
  const { longEdge, maxTokens } = TIERS[tier];
  let scale = Math.min(1, longEdge / Math.max(width, height));

  const tokensAt = (s) =>
    Math.ceil((width * s) / PATCH) * Math.ceil((height * s) / PATCH);

  if (tokensAt(scale) > maxTokens) {
    scale = Math.sqrt((maxTokens * PATCH * PATCH) / (width * height));
    while (tokensAt(scale) > maxTokens) scale *= 0.995;
  }
  return tokensAt(scale);
}

const usd = (n) => `$${n.toFixed(5)}`;

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node cost.mjs <ticketDir> [--width W --height H]');
  process.exit(2);
}
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const width = argOf('--width', 3000);
const height = argOf('--height', 4000);

/** Output tokens for the Claude readings, estimated from the JSON they produced. */
function estimateOutputTokens(file) {
  if (!existsSync(file)) return 500;
  return Math.round(readFileSync(file, 'utf8').length / 3.5);
}

const usagePath = join(dir, 'usage.json');
const usage = existsSync(usagePath)
  ? JSON.parse(readFileSync(usagePath, 'utf8'))
  : {};

// The prompt is the same for every model, so one measured Gemini input count
// minus its image share is the best estimate available for the Claude text half.
const PROMPT_TOKENS = 430;

const rows = [];

for (const [model, entry] of Object.entries(usage)) {
  const rate = RATES[model];
  if (!rate || entry.error) {
    rows.push({
      model,
      note: entry.error ? `HTTP ${entry.error}` : 'no rate on file',
    });
    continue;
  }
  const inTok = entry.inputTokens ?? 0;
  const outTok = (entry.outputTokens ?? 0) + (entry.thoughtsTokens ?? 0);
  rows.push({
    model,
    measured: true,
    ms: entry.ms,
    inTok,
    outTok,
    cost: (inTok * rate.in + outTok * rate.out) / 1e6,
  });
}

for (const model of ['claude-opus-5', 'claude-haiku-4-5']) {
  const file = join(dir, `${model}.json`);
  if (!existsSync(file)) continue;
  const rate = RATES[model];
  const inTok = visualTokens(width, height, rate.tier) + PROMPT_TOKENS;
  const outTok = estimateOutputTokens(file);
  rows.push({
    model,
    measured: false,
    inTok,
    outTok,
    cost: (inTok * rate.in + outTok * rate.out) / 1e6,
  });
}

rows.sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));

console.log(
  `${'model'.padEnd(24)} ${'in'.padStart(6)} ${'out'.padStart(6)} ${'latency'.padStart(9)} ${'per ticket'.padStart(11)} ${'per 1000'.padStart(9)}  source`
);
console.log('-'.repeat(88));
for (const r of rows) {
  if (r.note) {
    console.log(`${r.model.padEnd(24)} ${r.note}`);
    continue;
  }
  console.log(
    `${r.model.padEnd(24)} ${String(r.inTok).padStart(6)} ${String(r.outTok).padStart(6)} ` +
      `${(r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '-').padStart(9)} ` +
      `${usd(r.cost).padStart(11)} ${`$${(r.cost * 1000).toFixed(2)}`.padStart(9)}  ` +
      `${r.measured ? 'measured' : 'computed'}`
  );
}
