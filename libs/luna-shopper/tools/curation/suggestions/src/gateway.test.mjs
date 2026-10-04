/**
 * The two gateway reads plan 0006 changed: a search never sends more than the
 * gateway accepts, and a product lookup tells a missing product from a failed
 * request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeGateway, toBulkCreateItem, toCreateItemBody } from './gateway.mjs';
import { SEARCH_TEXT_MAX } from './rules.mjs';

/** A session that records what it was asked and answers from `respond`. */
function recordingSession(respond) {
  const calls = [];
  return {
    calls,
    async fetch(path, init = {}) {
      calls.push({ path, query: init.query ?? null });
      return respond(path, init);
    },
  };
}

test('searchItems sends at most 120 characters, cut at a word', async () => {
  const session = recordingSession(() => ({ items: [] }));
  const gateway = makeGateway(session);
  const name = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(' ');
  assert.ok(name.length > SEARCH_TEXT_MAX);

  await gateway.searchItems(name);

  const sent = session.calls[0].query.query;
  assert.ok(sent.length <= SEARCH_TEXT_MAX, `${sent.length} characters`);
  assert.ok(name.startsWith(sent));
  assert.equal(name[sent.length], ' ');
});

test('searchItems sends a short text as it is, and nothing for no text', async () => {
  const session = recordingSession(() => ({ items: [{ id: 'i1' }] }));
  const gateway = makeGateway(session);

  assert.deepEqual(await gateway.searchItems('leche entera'), [{ id: 'i1' }]);
  assert.equal(session.calls[0].query.query, 'leche entera');
  assert.deepEqual(await gateway.searchItems(''), []);
  assert.equal(session.calls.length, 1);
});

const DECIDED_ITEM = {
  nameEs: 'Café con leche en cápsulas',
  nameEn: null,
  brand: 'Dolce Gusto',
  ean: null,
  unitSize: 160,
  defaultUnit: 'GRAM',
  categorySlugs: ['coffee'],
  categoryIds: ['c-coffee'],
};

test('the bulk create carries a pack count the decision stated, and only then (backend plan 0177)', () => {
  assert.equal(
    toBulkCreateItem({ ...DECIDED_ITEM, packCount: 16 }).packCount,
    16
  );
  // Absent is how the bulk route is told to take the row's own count. A null
  // here would create the product with none.
  assert.equal('packCount' in toBulkCreateItem(DECIDED_ITEM), false);
  assert.equal(
    'packCount' in toBulkCreateItem({ ...DECIDED_ITEM, packCount: null }),
    false
  );
});

test('both creates send both names (backend plan 0184)', () => {
  const decided = { ...DECIDED_ITEM, nameEn: 'Coffee with milk capsules' };
  const both = {
    es: 'Café con leche en cápsulas',
    en: 'Coffee with milk capsules',
  };
  assert.deepEqual(toBulkCreateItem(decided).name, both);
  assert.deepEqual(toCreateItemBody(decided).name, both);
});

test('a decision recorded before both names were required is sent as it was decided', () => {
  // The bulk route refuses that operation with `NAME_EN_MISSING`, which names
  // the row a person has to finish. Nothing here invents an English name.
  assert.deepEqual(toBulkCreateItem(DECIDED_ITEM).name, {
    es: 'Café con leche en cápsulas',
  });
});

test('the rehearsal create carries the count the real create will write', () => {
  // The decision's count wins, as it does on the bulk route.
  assert.equal(
    toCreateItemBody({ ...DECIDED_ITEM, packCount: 16 }, 6).packCount,
    16
  );
  // Otherwise the row's own, so a later row of the run is compared against
  // the product the catalog will really hold.
  assert.equal(toCreateItemBody(DECIDED_ITEM, 16).packCount, 16);
  assert.equal('packCount' in toCreateItemBody(DECIDED_ITEM, null), false);
  assert.equal('packCount' in toCreateItemBody(DECIDED_ITEM), false);
});

test('getItem answers null for a 404 and throws every other failure', async () => {
  const failing = (status) =>
    makeGateway(
      recordingSession(() => {
        const error = new Error(`GET answered ${status}`);
        error.status = status;
        throw error;
      })
    );

  assert.equal(await failing(404).getItem('i-gone'), null);
  await assert.rejects(() => failing(500).getItem('i1'), /answered 500/);
  await assert.rejects(() => failing(401).getItem('i1'), /answered 401/);

  // A network failure carries no status at all, and is not an answer either.
  const offline = makeGateway(
    recordingSession(() => {
      throw new Error('fetch failed');
    })
  );
  await assert.rejects(() => offline.getItem('i1'), /fetch failed/);

  const found = makeGateway(recordingSession(() => ({ id: 'i1' })));
  assert.deepEqual(await found.getItem('i1'), { id: 'i1' });
});
