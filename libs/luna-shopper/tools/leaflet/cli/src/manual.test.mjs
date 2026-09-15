import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import { CHAINS_DIR, readLayout, readPrompt, resolveChain } from './chains.mjs';
import {
  RUN_FILE,
  collectManualReadings,
  promptFile,
  readRunFile,
  writeRunFile,
} from './manual.mjs';
import { readingPath } from './read-pages.mjs';

const chain = resolveChain('el-jamon', CHAINS_DIR);
const prompt = readPrompt(chain);
const layout = readLayout(chain);

const written = (pages) =>
  promptFile({
    slug: 'el-jamon',
    prompt,
    layout,
    census: 'Census of a.pdf\n  pages: 40',
    pages,
    pagesDir: '/out/pages',
    importDir: '/out/import',
    outDir: '/out',
  });

test('PROMPT.md carries chains/<slug>/prompt.txt byte for byte', () => {
  assert.ok(written([1, 2]).includes(prompt));
});

test('PROMPT.md carries the chain layout and the census', () => {
  const text = written([1]);
  assert.ok(text.includes(layout));
  assert.ok(text.includes('Census of a.pdf'));
});

test('PROMPT.md names one absolute path per rendered page', () => {
  const text = written([1, 2, 40]);
  for (const page of [1, 2, 40]) {
    const name = `page_${String(page).padStart(2, '0')}.png`;
    const line = text.split('\n').find((row) => row.includes(name));
    assert.ok(line, `names ${name}`);
    const path = line.slice(line.indexOf(' ') + 1).trim();
    assert.ok(isAbsolute(path), `${path} is absolute`);
  }
  // And a page that was not rendered is not named.
  assert.ok(!text.includes('page_03.png'));
});

test('PROMPT.md says where each answer goes, and names the pick up command', () => {
  const text = written([1]);
  assert.ok(text.includes('page_01.json'));
  assert.match(text, /--out \/out --resume --engine manual/);
  assert.match(text, /empty array for a page with no priced product/);
});

test('PROMPT.md names the three fields that matter most', () => {
  const text = written([1]);
  for (const field of ['loyalty', 'promotion.type', 'basis']) {
    assert.ok(text.includes(field), `names ${field}`);
  }
});

test('the first pass records the chain and the pdf, and the pick up reads them', () => {
  const store = new Map();
  writeRunFile(
    '/out',
    { chain: 'el-jamon', pdf: '/leaflets/a.pdf' },
    (path, text) => store.set(path, text)
  );
  assert.ok(store.has(join('/out', RUN_FILE)));
  const back = readRunFile('/out', {
    exists: (path) => store.has(path),
    readFile: (path) => store.get(path),
  });
  assert.equal(back.chain, 'el-jamon');
  assert.equal(back.pdf, '/leaflets/a.pdf');
});

test('there is nothing to pick up when no run was recorded', () => {
  assert.equal(readRunFile('/out', { exists: () => false }), null);
});

/** A reading directory that is a Map. */
const readings = (entries) => {
  const store = new Map(Object.entries(entries));
  return {
    exists: (path) => store.has(path),
    readFile: (path) => store.get(path),
  };
};

test('a valid set of readings goes through', () => {
  const fs = readings({
    [readingPath('/import', 1)]: '[{"name":"a"}]',
    [readingPath('/import', 2)]: '[]',
  });
  const out = collectManualReadings({
    pages: [1, 2],
    importDir: '/import',
    stripFence,
    ...fs,
  });
  assert.deepEqual(out.get(1), [{ name: 'a' }]);
  assert.deepEqual(out.get(2), []);
});

test('a page holding prose is named by page and stops the run', () => {
  const fs = readings({
    [readingPath('/import', 1)]: '[]',
    [readingPath('/import', 2)]: '```\nThe page has three offers.\n```',
  });
  assert.throws(
    () =>
      collectManualReadings({
        pages: [1, 2],
        importDir: '/import',
        stripFence,
        ...fs,
      }),
    /page 2: the reading is not a JSON array.*never edits a reading/s
  );
});

test('a missing page stops the run and names itself', () => {
  const fs = readings({ [readingPath('/import', 1)]: '[]' });
  assert.throws(
    () =>
      collectManualReadings({
        pages: [1, 2],
        importDir: '/import',
        stripFence,
        ...fs,
      }),
    /page 2: there is no reading at all/
  );
});

test('a missing page that --pages excluded is not missing', () => {
  const fs = readings({ [readingPath('/import', 1)]: '[]' });
  const out = collectManualReadings({
    pages: [1],
    importDir: '/import',
    stripFence,
    ...fs,
  });
  assert.equal(out.size, 1);
});
