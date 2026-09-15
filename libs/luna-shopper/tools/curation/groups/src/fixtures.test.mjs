/**
 * One run over the fixtures the single file tool of backend plan 0099 shipped.
 *
 * They are real catalog products and real product groups, so this is where the
 * packet and the walk meet field names nobody typed for the occasion. The
 * synthetic worlds in `commands.test.mjs` prove the behavior; this proves the
 * shapes.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  apply,
  buildOperations,
  decide,
  end,
  next,
  start,
} from './commands.mjs';
import { makeGateway } from './gateway.mjs';
import { deriveUnitFamilies } from './rules.mjs';
import { readJsonl } from './run-dir.mjs';
import { makeCatalog, makeFakeSession } from './test-fakes.mjs';

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  );
}

const ITEMS = fixture('ungrouped-items.json').items;
const GROUPS = fixture('product-groups.json').items;

const UNITS = ['UNIT', 'LITER', 'GRAM', 'KILOGRAM', 'MILLILITER', 'PACK'];
const FAMILIES = deriveUnitFamilies(UNITS);

const MAIN_URL = 'http://localhost:3000';
const REHEARSAL_URL = 'http://localhost:43000';

const MILK_GROUP_ID = GROUPS[0].id;
const OIL_GROUP_ID = GROUPS[1].id;

function build() {
  const mainCatalog = makeCatalog({ items: ITEMS, groups: GROUPS });
  const rehearsalCatalog = makeCatalog({});
  const main = makeFakeSession({ catalog: mainCatalog, label: 'main' });
  const rehearsal = makeFakeSession({
    catalog: rehearsalCatalog,
    label: 'rehearsal',
  });
  return {
    mainCatalog,
    rehearsalCatalog,
    makeSession: ({ label }) => (label === 'main' ? main : rehearsal),
    gateways: { main: makeGateway(main), rehearsal: makeGateway(rehearsal) },
  };
}

function startIn(dir, world) {
  return start({
    mainUrl: MAIN_URL,
    rehearsalUrl: REHEARSAL_URL,
    mainUser: 'dev-admin',
    runDir: dir,
    model: 'claude-sonnet-5',
    makeSession: world.makeSession,
    units: UNITS,
  });
}

test('a run walks every fixture product and reports what it decided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-fixtures-'));
  const world = build();

  const started = await startIn(dir, world);
  assert.equal(started.remaining, ITEMS.length);

  const seen = [];
  for (;;) {
    const row = await next({ runDir: dir, gateways: world.gateways });
    if (row.done) {
      break;
    }
    seen.push(row.item.id);

    // Every packet the model would see carries the product as the catalog holds
    // it, and a candidate list, whatever the row's own fields happened to be.
    assert.equal(typeof row.item.nameEs, 'string');
    assert.ok(UNITS.includes(row.item.defaultUnit));
    assert.ok(Array.isArray(row.candidates));

    await decide({
      runDir: dir,
      itemId: row.item.id,
      input: {
        decision: 'REVIEW',
        confidence: 0.2,
        issues: [{ code: 'X', detail: 'a person' }],
      },
      gateways: world.gateways,
      unitFamilies: FAMILIES,
    });
  }

  assert.deepEqual(seen.sort(), ITEMS.map((row) => row.id).sort());

  const report = JSON.parse(readFileSync(end({ runDir: dir }).report, 'utf8'));
  assert.equal(report.decided, ITEMS.length);
  assert.equal(report.counts.REVIEW, ITEMS.length);
});

test('the milk finds the milk group and the rice finds nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-fixtures-'));
  const world = build();
  await startIn(dir, world);

  const milk = await next({ runDir: dir, gateways: world.gateways });
  assert.equal(milk.item.nameEs, 'Leche semidesnatada Hacendado 1 L');
  assert.deepEqual(
    milk.candidates.map((c) => c.groupId),
    [MILK_GROUP_ID]
  );

  await decide({
    runDir: dir,
    itemId: milk.item.id,
    input: { decision: 'ASSIGN', groupId: MILK_GROUP_ID, confidence: 0.97 },
    gateways: world.gateways,
    unitFamilies: FAMILIES,
  });

  const rice = await next({ runDir: dir, gateways: world.gateways });
  assert.equal(rice.item.nameEs, 'Arroz redondo SOS 1 kg');
  assert.deepEqual(rice.candidates, []);
});

/**
 * The whole shape of a run, ending in the request `apply` would post: the
 * fixture's milk joins the group the catalog already holds, the rice invents
 * one, and the olive oil joins the group the directory already had.
 */
test('a fixture run builds the request the bulk route names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-fixtures-'));
  const world = build();
  await startIn(dir, world);

  const decisions = {
    '22222222-2222-4222-8222-222222222201': {
      decision: 'ASSIGN',
      groupId: MILK_GROUP_ID,
      confidence: 0.97,
    },
    '22222222-2222-4222-8222-222222222202': {
      decision: 'CREATE_GROUP',
      confidence: 0.95,
      group: {
        nameEs: 'Arroz redondo',
        nameEn: 'Round rice',
        slug: 'arroz-redondo',
        referenceUnit: 'KILOGRAM',
        synonyms: { es: ['arroz'], en: ['rice'] },
      },
    },
    '22222222-2222-4222-8222-222222222204': {
      decision: 'ASSIGN',
      groupId: OIL_GROUP_ID,
      confidence: 0.96,
    },
  };

  for (;;) {
    const row = await next({ runDir: dir, gateways: world.gateways });
    if (row.done) {
      break;
    }
    await decide({
      runDir: dir,
      itemId: row.item.id,
      input: decisions[row.item.id] ?? {
        decision: 'REVIEW',
        confidence: 0.3,
        issues: [{ code: 'UNCLEAR', detail: 'a person decides this one' }],
      },
      gateways: world.gateways,
      unitFamilies: FAMILIES,
    });
  }

  const records = readJsonl(join(dir, 'decisions.jsonl')).filter(
    (line) => !line.header
  );
  const operations = buildOperations(records);

  assert.deepEqual(
    operations.map((op) => op.op),
    ['createGroup', 'assignItem', 'assignItem', 'assignItem']
  );
  assert.equal(operations[0].slug, 'arroz-redondo');
  assert.equal(operations[0].referenceUnit, 'KILOGRAM');
  assert.equal(
    operations.filter((op) => op.groupRef === operations[0].ref).length,
    1
  );
  for (const op of operations.slice(1)) {
    assert.deepEqual(op.expect, { productGroupId: null });
  }

  const sent = [];
  const answer = await apply({
    mainUrl: MAIN_URL,
    file: join(dir, 'decisions.jsonl'),
    session: {
      async fetch(path, init) {
        sent.push({ path, body: init.body });
        return {
          applied: true,
          error: null,
          results: operations.map((op) => ({ op: op.op, applied: true })),
          createdGroups: [{ ref: operations[0].ref, groupId: 'g-new' }],
        };
      },
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(answer.applied, true);
  assert.equal(answer.operations, operations.length);
});
