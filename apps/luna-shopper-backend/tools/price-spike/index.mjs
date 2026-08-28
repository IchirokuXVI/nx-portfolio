#!/usr/bin/env node
/**
 * Luna Shopper price feasibility spike.
 *
 *   node apps/luna-shopper-backend/tools/price-spike/index.mjs "leche pascual"
 *   node ... "leche pascual" --wh mad1,bcn1,svq1
 *   node ... "leche pascual" --pc 28001,08001,41001
 *   node ... "leche pascual" --strategy catalog --json
 *
 * Fans the term out across every chain adapter, normalises the results into
 * one shape, and prints what each chain could and could not answer.
 */
import { ADAPTERS, MERCADONA_WAREHOUSES, mercadona, resolveWarehouse } from './adapters.mjs';

const argv = process.argv.slice(2);
const term = argv.find((a) => !a.startsWith('--')) ?? 'leche pascual';
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const asJson = argv.includes('--json');
const strategy = flag('strategy', 'algolia');

const eur = (n) => (n === null || Number.isNaN(n) ? '—' : `${n.toFixed(2)} €`);

async function warehouses() {
  const pc = flag('pc');
  if (pc) {
    const codes = await Promise.all(pc.split(',').map((c) => resolveWarehouse(c.trim())));
    return [...new Set(codes.filter(Boolean))];
  }
  return flag('wh', MERCADONA_WAREHOUSES.join(',')).split(',');
}

async function run() {
  const whs = await warehouses();
  const rows = [];
  const skipped = [];

  for (const adapter of ADAPTERS) {
    if (adapter.status !== 'live') {
      skipped.push({ chain: adapter.label, status: adapter.status, reason: adapter.reason });
      continue;
    }
    // Only Mercadona is warehouse-scoped today; other live adapters get one call.
    const scopes = adapter === mercadona ? whs : [null];
    for (const scope of scopes) {
      const started = Date.now();
      try {
        const found = await adapter.search(term, scope, { strategy });
        rows.push(...found.map((r) => ({ ...r, ms: Date.now() - started })));
      } catch (err) {
        skipped.push({ chain: adapter.label, status: 'error', reason: err.message });
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ term, warehouses: whs, rows, skipped }, null, 2));
    return;
  }

  console.log(`\n  "${term}" — ${rows.length} rows across ${whs.length} price scopes\n`);
  if (rows.length) {
    const width = Math.min(46, Math.max(...rows.map((r) => (r.name ?? '').length)));
    for (const r of rows.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))) {
      const name = (r.name ?? '').slice(0, width).padEnd(width);
      console.log(
        `  ${r.chain.padEnd(10)} ${String(r.scope ?? '-').padEnd(6)} ${name}  ` +
          `${eur(r.price).padStart(9)}  ${r.unitPrice ? `(${eur(r.unitPrice)}/${r.unit})` : ''}`
      );
    }
  }

  // The same SKU priced differently across scopes is the whole question.
  const bySku = new Map();
  for (const r of rows) {
    const key = `${r.chain}:${r.sku}`;
    if (!bySku.has(key)) bySku.set(key, new Map());
    bySku.get(key).set(r.scope, r.price);
  }
  const varying = [...bySku.entries()].filter(
    ([, scopes]) => new Set([...scopes.values()]).size > 1
  );
  console.log(
    varying.length
      ? `\n  Price varies by scope for ${varying.length} SKU(s):\n` +
          varying
            .map(
              ([key, scopes]) =>
                `    ${key}  ` + [...scopes].map(([s, p]) => `${s}=${eur(p)}`).join('  ')
            )
            .join('\n')
      : '\n  No intra-chain price variation in this sample.'
  );

  if (skipped.length) {
    console.log('\n  Not covered:');
    for (const s of skipped) console.log(`    ${s.chain} [${s.status}] — ${s.reason}`);
  }
  console.log();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
