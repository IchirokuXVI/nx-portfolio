/**
 * The two gateway reads plan 0006 changed: a search never sends more than the
 * gateway accepts, and a product lookup tells a missing product from a failed
 * request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeGateway } from './gateway.mjs';
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
