import assert from 'node:assert/strict';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import {
  attemptPath,
  parseReading,
  readPages,
  readingPath,
} from './read-pages.mjs';
import { pageImagePath } from './render.mjs';

/** A file system that is a Map, so no test writes anything. */
function files(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    exists: (path) => store.has(path),
    readFile: (path) => store.get(path),
    writeFile: (path, text) => store.set(path, text),
  };
}

/** An engine that answers from a list, one answer per call. */
function fakeEngine(answers) {
  const asked = [];
  return {
    asked,
    name: 'fake',
    async ask(prompt, options) {
      asked.push({ prompt, options });
      const next = answers[asked.length - 1];
      if (typeof next === 'function') {
        return next();
      }
      return { text: next };
    },
  };
}

const options = (extra) => ({
  prompt: 'read this page',
  pagesDir: '/pages',
  importDir: '/import',
  stripFence,
  imagesFor: (page) => [{ mediaType: 'image/png', data: `page${page}` }],
  stderr: { write: () => undefined },
  ...extra,
});

test('one call per page, in order, each with its own image', async () => {
  const engine = fakeEngine(['[]', '[{"name":"leche"}]', '[]']);
  const fs = files();
  const { readings } = await readPages(
    options({ engine, pages: [1, 2, 3], ...fs })
  );
  assert.equal(engine.asked.length, 3);
  assert.deepEqual(
    engine.asked.map((call) => call.options.images[0].data),
    ['page1', 'page2', 'page3']
  );
  assert.deepEqual(readings.get(2), [{ name: 'leche' }]);
});

test('the chain prompt is the user prompt, verbatim, with no system half', async () => {
  const engine = fakeEngine(['[]']);
  const fs = files();
  const chainPrompt =
    'You are reading ONE page.\n\nRules:\n1. Do not invent.\n';
  await readPages(options({ engine, prompt: chainPrompt, pages: [1], ...fs }));
  assert.equal(engine.asked[0].prompt, chainPrompt);
  assert.equal(engine.asked[0].options.system, undefined);
});

test('the image is a png as base64, which is the whole contract', async () => {
  const engine = fakeEngine(['[]']);
  const fs = files({
    [pageImagePath('/pages', 1)]: Buffer.from('PNGBYTES'),
  });
  await readPages(options({ engine, pages: [1], imagesFor: null, ...fs }));
  assert.deepEqual(engine.asked[0].options.images, [
    {
      mediaType: 'image/png',
      data: Buffer.from('PNGBYTES').toString('base64'),
    },
  ]);
});

test('each page is written as it goes', async () => {
  const engine = fakeEngine(['[{"name":"a"}]', '[]']);
  const fs = files();
  await readPages(options({ engine, pages: [1, 2], ...fs }));
  assert.deepEqual(JSON.parse(fs.store.get(readingPath('/import', 1))), [
    { name: 'a' },
  ]);
  assert.ok(fs.store.has(readingPath('/import', 2)));
});

test('an unparseable answer is retried once, then recorded as empty with a named warning', async () => {
  const engine = fakeEngine([
    'Here is the page:\n\nIt has two offers.',
    'still prose',
    '[{"name":"b"}]',
  ]);
  const fs = files();
  const { readings, warnings } = await readPages(
    options({ engine, pages: [1, 2], ...fs })
  );
  // Page 1 was asked twice and page 2 once.
  assert.equal(engine.asked.length, 3);
  assert.deepEqual(readings.get(1), []);
  assert.deepEqual(readings.get(2), [{ name: 'b' }]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, 'unparseable answer');
  assert.equal(warnings[0].page, 1);
});

test('an answer nobody could read is kept, and the warning names the file', async () => {
  // A page cut off part way through and a page of prose are the same empty
  // reading, and only the raw text tells them apart.
  const truncated = '[\n  { "name": "leche entera 1 L", "price": "0';
  const engine = fakeEngine([truncated, 'I cannot read this page.']);
  const fs = files();
  const { warnings } = await readPages(options({ engine, pages: [5], ...fs }));

  const first = attemptPath('/import', 5, 1);
  const second = attemptPath('/import', 5, 2);
  assert.equal(fs.store.get(first), truncated);
  assert.equal(fs.store.get(second), 'I cannot read this page.');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, 'unparseable answer');
  assert.ok(warnings[0].message.includes(first), 'names the first attempt');
  assert.ok(warnings[0].message.includes(second), 'names the second');
  // The reading itself is still the empty array the rest of the run expects.
  assert.deepEqual(JSON.parse(fs.store.get(readingPath('/import', 5))), []);
});

test('a first answer that could not be read is kept even when the second one parsed', async () => {
  const engine = fakeEngine(['half an ans', '[{"name":"c"}]']);
  const fs = files();
  const { warnings } = await readPages(options({ engine, pages: [1], ...fs }));
  assert.equal(fs.store.get(attemptPath('/import', 1, 1)), 'half an ans');
  assert.equal(fs.store.has(attemptPath('/import', 1, 2)), false);
  assert.deepEqual(warnings, []);
});

test('the retry is enough when the second answer parses', async () => {
  const engine = fakeEngine(['not json', '[{"name":"c"}]']);
  const fs = files();
  const { readings, warnings } = await readPages(
    options({ engine, pages: [1], ...fs })
  );
  assert.deepEqual(readings.get(1), [{ name: 'c' }]);
  assert.deepEqual(warnings, []);
});

test('a fenced answer is unwrapped before it is parsed', () => {
  assert.deepEqual(parseReading('```json\n[{"name":"d"}]\n```', stripFence), [
    { name: 'd' },
  ]);
});

test('an answer that is an object and not an array is unparseable', () => {
  assert.equal(parseReading('{"name":"e"}', stripFence), null);
});

test('a page that does not answer in time is empty, warned, and not asked again', async () => {
  const never = () => new Promise(() => undefined);
  const engine = fakeEngine([never, '[{"name":"f"}]']);
  const fs = files();
  const { readings, warnings } = await readPages(
    options({
      engine,
      pages: [1, 2],
      timeoutMs: 5,
      // The timer fires at once, so nothing waits for a real 120 seconds.
      setTimer: (fn) => setTimeout(fn, 0),
      ...fs,
    })
  );
  assert.deepEqual(readings.get(1), []);
  assert.deepEqual(readings.get(2), [{ name: 'f' }]);
  // Two calls, not three: the timed out page is not retried.
  assert.equal(engine.asked.length, 2);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, 'page timeout');
  assert.match(warnings[0].message, /A longer timeout collects nothing/);
  // Nothing is kept for it: a page that never answered has no raw text.
  assert.equal(fs.store.has(attemptPath('/import', 1, 1)), false);
});

test('--resume keeps a page whose reading is already there and asks nothing', async () => {
  const engine = fakeEngine(['[{"name":"new"}]']);
  const fs = files({
    [readingPath('/import', 1)]: '[{"name":"kept"}]',
  });
  const { readings, skipped } = await readPages(
    options({ engine, pages: [1, 2], resume: true, ...fs })
  );
  assert.deepEqual(skipped, [1]);
  assert.deepEqual(readings.get(1), [{ name: 'kept' }]);
  assert.deepEqual(readings.get(2), [{ name: 'new' }]);
  assert.equal(engine.asked.length, 1);
});
