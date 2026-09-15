import assert from 'node:assert/strict';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import {
  checkLayout,
  checkPages,
  formatMismatch,
  layoutPrompt,
  parseVerdict,
} from './layout-check.mjs';

const engineAnswering = (text) => {
  const asked = [];
  return {
    asked,
    async ask(prompt, options) {
      asked.push({ prompt, options });
      return { text };
    },
  };
};

test('the check looks at the first three pages, and no more', () => {
  assert.deepEqual(checkPages([1, 2, 3, 4, 5]), [1, 2, 3]);
  assert.deepEqual(checkPages([7]), [7]);
});

test('the chain description is what the model is asked against', () => {
  const prompt = layoutPrompt('The badge is orange.');
  assert.ok(prompt.includes('The badge is orange.'));
  assert.match(prompt, /"matches": true/);
});

test('a matching leaflet carries on', async () => {
  const engine = engineAnswering('{"matches":true,"differences":[]}');
  const verdict = await checkLayout({
    engine,
    layout: 'x',
    images: [{ mediaType: 'image/png', data: 'a' }],
    stripFence,
  });
  assert.equal(engine.asked.length, 1);
  assert.deepEqual(verdict, { ok: true, differences: [], unreadable: false });
});

test('a mismatch stops the run and names what differs', async () => {
  const engine = engineAnswering(
    '```json\n{"matches":false,"differences":["the decimal separator is a comma now","there is a loyalty badge"]}\n```'
  );
  const verdict = await checkLayout({
    engine,
    layout: 'x',
    images: [],
    stripFence,
  });
  assert.equal(verdict.ok, false);
  const printed = formatMismatch('deza', verdict.differences);
  assert.match(printed, /the decimal separator is a comma now/);
  assert.match(printed, /there is a loyalty badge/);
  assert.match(printed, /chains\/deza\/layout.md/);
});

test('a false verdict with no difference named is not a stop', async () => {
  // A small model that says no and cannot say what would stop every run of a
  // leaflet that is perfectly ordinary, and the sanity pass and the drift check
  // both still run afterwards.
  const engine = engineAnswering('{"matches":false,"differences":[]}');
  const verdict = await checkLayout({
    engine,
    layout: 'x',
    images: [],
    stripFence,
  });
  assert.equal(verdict.ok, true);
});

test('an answer that cannot be read carries on and says so', async () => {
  const engine = engineAnswering('The pages look right to me.');
  const verdict = await checkLayout({
    engine,
    layout: 'x',
    images: [],
    stripFence,
  });
  assert.deepEqual(verdict, { ok: true, differences: [], unreadable: true });
  assert.equal(parseVerdict('The pages look right to me.', stripFence), null);
});
