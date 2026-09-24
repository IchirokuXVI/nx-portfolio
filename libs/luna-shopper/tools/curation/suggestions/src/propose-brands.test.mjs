/**
 * `propose-brands` (plan 0006): the queue read with no model, and the brands
 * it prints that the registry does not hold, written as a file for a person.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from './cli.mjs';
import {
  REGISTER_MANY_LIMIT,
  proposeBrands,
  start,
  tallyPrintedBrands,
} from './commands.mjs';
import { makeGateway } from './gateway.mjs';
import { indexBrands } from './rules.mjs';
import { makeCatalog, makeFakeSession, makeQueue } from './test-fakes.mjs';

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  );
}

const QUEUE = fixture('queue-page.json');
const SUPERMARKETS = fixture('supermarkets.json');

function runDir() {
  return mkdtempSync(join(tmpdir(), 'curation-brands-'));
}

function byChain(items) {
  const pages = {};
  for (const row of items) {
    (pages[row.supermarketId] ??= []).push(row);
  }
  return pages;
}

function mainSession({ items = QUEUE.items, brands = [] } = {}) {
  return makeFakeSession({
    catalog: makeCatalog([]),
    queue: makeQueue(byChain(items)),
    supermarkets: SUPERMARKETS.items ?? SUPERMARKETS,
    brands,
    label: 'main',
  });
}

test('propose-brands writes the fixture queue brands with an empty registry', async () => {
  const dir = runDir();
  const session = mainSession();

  const answer = await proposeBrands({
    runDir: dir,
    mainUrl: 'http://localhost:3000',
    makeSession: () => session,
  });

  assert.equal(answer.file, join(dir, 'brands-to-register.json'));
  // The fixture queue holds four rows on Mercadona, three printing Hacendado,
  // and a fifth on a chain the catalog does not hold, which no queue lists.
  assert.equal(answer.entries, 4);
  assert.equal(answer.withBrand, 3);
  assert.equal(answer.registered, 0);
  assert.equal(answer.proposed, 1);
  assert.ok(answer.notes.some((note) => /Nothing was registered/.test(note)));

  assert.deepEqual(JSON.parse(readFileSync(answer.file, 'utf8')), {
    brands: [
      {
        label: 'Hacendado',
        privateLabelOf: null,
        key: 'hacendado',
        printed: ['Hacendado'],
        entries: 3,
      },
    ],
  });
  // No run was started and nothing was written anywhere but the file.
  assert.equal(existsSync(join(dir, 'state.json')), false);
  assert.equal(
    session.calls.some((call) => call.method === 'POST'),
    false
  );
});

test('propose-brands leaves out every brand the registry already holds', async () => {
  const dir = runDir();
  const session = mainSession({ brands: fixture('brands.json').items });

  const answer = await proposeBrands({
    runDir: dir,
    mainUrl: 'http://localhost:3000',
    makeSession: () => session,
  });

  assert.equal(answer.proposed, 0);
  assert.deepEqual(JSON.parse(readFileSync(answer.file, 'utf8')), {
    brands: [],
  });
});

test('the tally groups spellings by key, counts entries and suggests a label', () => {
  const row = (id, brand) => ({ id, supermarketId: 'sm-1', brand });
  const registered = indexBrands([
    { id: 'b1', key: 'pascual', label: 'Pascual' },
  ]);

  const brands = tallyPrintedBrands(
    [
      row('e1', 'EL POZO'),
      row('e2', 'El Pozo'),
      row('e3', 'ELPOZO'),
      row('e4', 'EL POZO'),
      row('e5', 'DEBORAH 48H'),
      row('e6', 'PASCUAL'),
      row('e7', null),
      row('e8', '  '),
    ],
    registered
  );

  assert.deepEqual(brands, [
    {
      label: 'El Pozo',
      privateLabelOf: null,
      key: 'elpozo',
      printed: ['EL POZO', 'El Pozo', 'ELPOZO'],
      entries: 4,
    },
    {
      label: 'Deborah 48H',
      privateLabelOf: null,
      key: 'deborah48h',
      printed: ['DEBORAH 48H'],
      entries: 1,
    },
  ]);
});

test('propose-brands reads the run a directory holds, and says when to split', async () => {
  const dir = runDir();
  const items = Array.from({ length: REGISTER_MANY_LIMIT + 1 }, (_, i) => ({
    id: `e${i}`,
    supermarketId: 'sm-mercadona',
    name: `Producto ${i}`,
    brand: `Marca ${i}`,
    ean: null,
  }));
  const session = mainSession({ items });
  const rehearsal = makeFakeSession({
    catalog: makeCatalog([]),
    label: 'rehearsal',
  });
  const sessions = ({ label }) => (label === 'main' ? session : rehearsal);

  await start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: 'dev-admin',
    runDir: dir,
    allowEmptyRegistry: true,
    makeSession: sessions,
    vocabularies: { categories: ['OTHER'], units: ['UNIT'] },
  });

  // No url: the run directory names the gateway, the user and the chains.
  let asked = null;
  const answer = await proposeBrands({
    runDir: dir,
    makeSession: (options) => {
      asked = options;
      return session;
    },
  });

  assert.equal(asked.baseUrl, 'http://localhost:3000');
  assert.equal(asked.username, 'dev-admin');
  assert.equal(answer.proposed, REGISTER_MANY_LIMIT + 1);
  assert.ok(answer.notes.some((note) => /send them in 2 requests/.test(note)));
});

test('propose-brands reaches the CLI, and needs a url when the directory holds no run', async () => {
  await assert.rejects(() => run(['propose-brands']), /--run-dir is required/);
  await assert.rejects(
    () => run(['propose-brands', '--run-dir', runDir()]),
    /holds no run, so propose-brands needs --main-url/
  );
});

test('the gateway a caller hands in is used as it is', async () => {
  const dir = runDir();
  const answer = await proposeBrands({
    runDir: dir,
    gateway: makeGateway(mainSession()),
  });
  assert.equal(answer.proposed, 1);
});
