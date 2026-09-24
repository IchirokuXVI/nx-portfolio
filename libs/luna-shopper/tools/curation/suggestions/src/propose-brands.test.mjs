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
  BRAND_LABEL_MAX_LENGTH,
  REGISTER_MANY_LIMIT,
  REGISTER_MANY_ROUTE,
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

/**
 * The rules the gateway applies to a `brands/register-many` body, written out
 * so a proposal can be checked with no network and no Nest.
 *
 * They mirror `RegisterBrandsDto` and `RegisterBrandsEntryDto` in
 * `apps/luna-shopper-backend/gateway/src/app/catalog/catalog.dto.ts`, under the
 * gateway's validation pipe, whose `forbidNonWhitelisted` refuses any field the
 * DTO does not declare. Answers every problem found, so an empty list is a body
 * the route takes.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerManyProblems(body) {
  const problems = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return ['the body is not an object'];
  }
  for (const field of Object.keys(body)) {
    if (field !== 'brands') {
      problems.push(`unknown field ${field}`);
    }
  }
  if (!Array.isArray(body.brands)) {
    return [...problems, 'brands is not an array'];
  }
  if (body.brands.length < 1) {
    problems.push('brands is empty');
  }
  if (body.brands.length > REGISTER_MANY_LIMIT) {
    problems.push(`brands holds more than ${REGISTER_MANY_LIMIT}`);
  }
  body.brands.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`brands[${i}] is not an object`);
      return;
    }
    for (const field of Object.keys(entry)) {
      if (field !== 'label' && field !== 'privateLabelSupermarketId') {
        problems.push(`brands[${i}] has unknown field ${field}`);
      }
    }
    if (
      typeof entry.label !== 'string' ||
      entry.label.length < 1 ||
      entry.label.length > BRAND_LABEL_MAX_LENGTH
    ) {
      problems.push(`brands[${i}].label is not a label`);
    }
    const chain = entry.privateLabelSupermarketId;
    if (
      chain !== undefined &&
      chain !== null &&
      !(typeof chain === 'string' && UUID.test(chain))
    ) {
      problems.push(`brands[${i}].privateLabelSupermarketId is not a uuid`);
    }
  });
  return problems;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

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
  assert.deepEqual(answer.files, [answer.file]);
  assert.equal(answer.notesFile, join(dir, 'brands-to-register.notes.json'));
  // The fixture queue holds four rows on Mercadona, three printing Hacendado,
  // and a fifth on a chain the catalog does not hold, which no queue lists.
  assert.equal(answer.entries, 4);
  assert.equal(answer.withBrand, 3);
  assert.equal(answer.registered, 0);
  assert.equal(answer.proposed, 1);
  assert.ok(
    answer.notes.some(
      (note) =>
        /Nothing was registered/.test(note) &&
        note.includes(REGISTER_MANY_ROUTE) &&
        /brands-to-register\.json/.test(note)
    )
  );

  // The file is the route's body and holds nothing the route would refuse.
  const body = readJson(answer.file);
  assert.deepEqual(body, {
    brands: [{ label: 'Hacendado', privateLabelSupermarketId: null }],
  });
  assert.deepEqual(registerManyProblems(body), []);

  // The evidence a person reads while editing it sits beside it.
  const notes = readJson(answer.notesFile);
  assert.equal(notes.route, REGISTER_MANY_ROUTE);
  assert.ok(
    notes.chains.some(
      (entry) =>
        entry.supermarketId === 'sm-mercadona' && entry.name === 'Mercadona'
    )
  );
  assert.deepEqual(notes.brands, [
    {
      label: 'Hacendado',
      key: 'hacendado',
      printed: ['Hacendado'],
      entries: 3,
    },
  ]);
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
  // The route refuses an empty list, so there is no body to write.
  assert.equal(answer.file, null);
  assert.deepEqual(answer.files, []);
  assert.equal(existsSync(join(dir, 'brands-to-register.json')), false);
  assert.deepEqual(readJson(answer.notesFile).brands, []);
  assert.ok(answer.notes.some((note) => /no body to send/.test(note)));
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
      key: 'elpozo',
      printed: ['EL POZO', 'El Pozo', 'ELPOZO'],
      entries: 4,
    },
    {
      label: 'Deborah 48H',
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
  assert.ok(answer.notes.some((note) => /Send them in 2 requests/.test(note)));

  // One body per request, each one the route takes.
  assert.deepEqual(answer.files, [
    join(dir, 'brands-to-register.json'),
    join(dir, 'brands-to-register-2.json'),
  ]);
  const [first, second] = answer.files.map(readJson);
  assert.equal(first.brands.length, REGISTER_MANY_LIMIT);
  assert.equal(second.brands.length, 1);
  assert.deepEqual(registerManyProblems(first), []);
  assert.deepEqual(registerManyProblems(second), []);
  assert.equal(
    readJson(answer.notesFile).brands.length,
    REGISTER_MANY_LIMIT + 1
  );

  // A second, smaller proposal leaves no stale part behind to be sent.
  const again = await proposeBrands({
    runDir: dir,
    gateway: makeGateway(mainSession()),
  });
  assert.deepEqual(again.files, [join(dir, 'brands-to-register.json')]);
  assert.equal(existsSync(join(dir, 'brands-to-register-2.json')), false);
});

test('the body check refuses what the gateway refuses', () => {
  const check = (brands) => registerManyProblems({ brands });
  assert.deepEqual(
    check([
      { label: 'Mahou' },
      {
        label: 'Hacendado',
        privateLabelSupermarketId: '33333333-3333-4333-8333-333333333333',
      },
      { label: 'ELPOZO', privateLabelSupermarketId: null },
    ]),
    []
  );
  assert.notDeepEqual(check([]), []);
  assert.notDeepEqual(
    check(Array.from({ length: 201 }, (_, i) => ({ label: `B${i}` }))),
    []
  );
  assert.notDeepEqual(
    check([{ label: 'Hacendado', privateLabelSupermarketId: 'mercadona' }]),
    []
  );
  assert.notDeepEqual(check([{ label: 'x'.repeat(121) }]), []);
  assert.notDeepEqual(check([{ label: '' }]), []);
  // The shape this command used to write: every extra field is refused.
  assert.notDeepEqual(
    check([
      {
        label: 'Hacendado',
        privateLabelOf: null,
        key: 'hacendado',
        printed: ['Hacendado'],
        entries: 3,
      },
    ]),
    []
  );
  assert.notDeepEqual(
    registerManyProblems({ brands: [{ label: 'Mahou' }], route: 'x' }),
    []
  );
});

test('a label longer than the route takes is named in the notes', async () => {
  const answer = await proposeBrands({
    runDir: runDir(),
    gateway: makeGateway(
      mainSession({
        items: [
          {
            id: 'e1',
            supermarketId: 'sm-mercadona',
            name: 'Producto',
            brand: 'X'.repeat(BRAND_LABEL_MAX_LENGTH + 1),
            ean: null,
          },
        ],
      })
    ),
  });
  assert.ok(answer.notes.some((note) => /longer than the 120/.test(note)));
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
