/**
 * One run over the fixtures the single file tool of backend plan 0098 shipped.
 *
 * They are real rows and real catalog products, so this is where the packet and
 * the walk meet field names nobody typed for the occasion. The synthetic worlds
 * in `commands.test.mjs` prove the behavior; this proves the shapes.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide, end, next, start } from './commands.mjs';
import { makeGateway } from './gateway.mjs';
import { indexPrivateLabels } from './rules.mjs';
import { makeCatalog, makeFakeSession, makeQueue } from './test-fakes.mjs';

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  );
}

const QUEUE = fixture('queue-page.json');
const SUPERMARKETS = fixture('supermarkets.json');
const CATALOG = fixture('catalog-items.json');

const VOCABULARIES = {
  categories: ['DAIRY', 'PANTRY', 'OTHER', 'SNACKS', 'BEVERAGES'],
  units: ['UNIT', 'LITER', 'GRAM', 'KILOGRAM', 'MILLILITER', 'PACK'],
};
const LABELS = indexPrivateLabels({
  Hacendado: 'Mercadona',
  'Ifa Unnia': 'El Jamón',
});

/**
 * The rows a walk can reach.
 *
 * One fixture row sits on `sm-ghost`, a chain the catalog does not hold. The
 * walk cannot reach it and no version of this library could: the queue route
 * takes `supermarketId` as a required parameter, so the only queues that can be
 * listed are the ones a registered chain names. That row is there to exercise
 * `CHAIN_NOT_REGISTERED`, which `decision.test.mjs` reaches directly.
 */
const CHAIN_IDS = new Set(
  (SUPERMARKETS.items ?? SUPERMARKETS).map((row) => row.id)
);
const REACHABLE = QUEUE.items.filter((row) => CHAIN_IDS.has(row.supermarketId));

function build() {
  const byChain = {};
  for (const row of QUEUE.items) {
    (byChain[row.supermarketId] ??= []).push(row);
  }
  const main = makeFakeSession({
    catalog: makeCatalog(CATALOG.items ?? CATALOG),
    queue: makeQueue(byChain),
    supermarkets: SUPERMARKETS.items ?? SUPERMARKETS,
    label: 'main',
  });
  const rehearsal = makeFakeSession({
    catalog: makeCatalog([]),
    supermarkets: SUPERMARKETS.items ?? SUPERMARKETS,
    label: 'rehearsal',
  });
  return {
    makeSession: ({ label }) => (label === 'main' ? main : rehearsal),
    gateways: { main: makeGateway(main), rehearsal: makeGateway(rehearsal) },
  };
}

test('a run walks every fixture row and reports what it decided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-fixtures-'));
  const world = build();

  const started = await start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: 'dev-admin',
    runDir: dir,
    model: 'claude-sonnet-5',
    makeSession: world.makeSession,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });
  assert.equal(started.remaining, REACHABLE.length);

  const seen = [];
  for (;;) {
    const row = await next({ runDir: dir, gateways: world.gateways });
    if (row.done) {
      break;
    }
    seen.push(row.entry.id);

    // Every packet the model would see carries the chain it belongs to and a
    // candidate list, whatever the row's own fields happened to be.
    assert.equal(typeof row.entry.name, 'string');
    assert.equal(row.entry.chainRegistered, true);
    assert.ok(Array.isArray(row.candidates));

    await decide({
      runDir: dir,
      entryId: row.entry.id,
      input: {
        decision: 'REVIEW',
        confidence: 0.2,
        issues: [{ code: 'X', detail: 'a person' }],
      },
      gateways: world.gateways,
      vocabularies: VOCABULARIES,
      privateLabels: LABELS,
    });
  }

  assert.deepEqual(seen.sort(), REACHABLE.map((row) => row.id).sort());

  const report = JSON.parse(readFileSync(end({ runDir: dir }).report, 'utf8'));
  assert.equal(report.decided, REACHABLE.length);
  assert.equal(report.counts.REVIEW, REACHABLE.length);
});

test('a leaflet row carrying its brand and size in the name is a REVIEW', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-fixtures-'));
  const world = build();
  await start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: 'dev-admin',
    runDir: dir,
    makeSession: world.makeSession,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  // `Aceite de oliva Hacendado 1 L`, copied into the name it would create.
  const answer = await decide({
    runDir: dir,
    entryId: 'entry-oil',
    input: {
      decision: 'CREATE',
      confidence: 0.99,
      item: {
        nameEs: 'Aceite de oliva Hacendado 1 L',
        brand: 'Hacendado',
        unitSize: 1,
        defaultUnit: 'LITER',
        category: 'PANTRY',
      },
    },
    gateways: world.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  const codes = answer.issues.map((entry) => entry.code);
  assert.ok(codes.includes('NAME_CARRIES_BRAND'));
  assert.ok(codes.includes('NAME_CARRIES_SIZE'));
});
