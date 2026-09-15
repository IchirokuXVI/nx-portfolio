import assert from 'node:assert/strict';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import { CHAINS_DIR, readLayout, readPrompt, resolveChain } from './chains.mjs';
import { runRead } from './run.mjs';

const chain = resolveChain('el-jamon', CHAINS_DIR);
const layout = readLayout(chain);
const prompt = readPrompt(chain);

/** Two page objects and their boxes, which is all the byte scan reads. */
const TWO_PAGE_PDF = [
  '%PDF-1.4',
  '3 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj',
  '4 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj',
].join('\n');

const sink = () => {
  const written = [];
  return {
    written,
    write: (text) => written.push(text),
    text: () => written.join(''),
  };
};

/** A run whose every process, file and clock is a function. */
function harness({
  answers = [],
  images = ['page_01.png', 'page_02.png'],
} = {}) {
  const stdout = sink();
  const stderr = sink();
  const store = new Map();
  const asked = [];
  const started = [];
  let answer = 0;
  return {
    stdout,
    stderr,
    store,
    asked,
    started,
    engine: {
      name: 'fake',
      async ask(text, options) {
        asked.push({ text, options });
        return { text: answers[answer++] ?? '[]' };
      },
    },
    options: {
      chain,
      defaults: { dpi: 160, fixedSections: { 1: 'cover' } },
      source: '/pages',
      sourceIsDirectory: true,
      outDir: '/out',
      dpi: 160,
      prompt,
      layout,
      stripFence,
      stdout,
      stderr,
      run: async () => ({ started: false, code: -1, stdout: '', stderr: '' }),
      stream: async (node, args) => {
        started.push(args.find((arg) => arg.endsWith('.mjs')) ?? args[0]);
        return { started: true, code: 0 };
      },
      findRenderer: async () => null,
      mkdir: () => undefined,
      writeFile: (path, text) => store.set(path, text),
      readFile: (path) => {
        if (store.has(path)) {
          return store.get(path);
        }
        // A PDF the byte scan can count, so the census needs nothing installed.
        if (String(path).endsWith('.pdf')) {
          return Buffer.from(TWO_PAGE_PDF, 'latin1');
        }
        return Buffer.from(`bytes of ${path}`);
      },
      exists: (path) =>
        store.has(path) ||
        // El Jamon has a baseline, so the drift check is run rather than
        // skipped. Dia and LIDL have none, which is the other case.
        String(path).endsWith('baseline.json') ||
        images.some((name) => String(path).endsWith(name)),
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    },
  };
}

/** `pagesInDirectory` reads the real disk, so a directory that is not there
 * answers no pages at all, which is the case this asserts. */
test('a directory with no page images is refused before anything is asked', async () => {
  const { options, engine, asked } = harness();
  await assert.rejects(
    runRead({ ...options, engine, engineName: 'fake', source: '/nowhere' }),
    /holds no page_NN.png/
  );
  assert.equal(asked.length, 0);
});

test('with no renderer the run stops and prints one install line per renderer', async () => {
  const { options, engine, stdout } = harness();
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'fake',
    sourceIsDirectory: false,
    source: '/leaflet.pdf',
  });
  assert.equal(outcome.code, 2);
  assert.match(stdout.text(), /No PDF renderer was found/);
  assert.match(stdout.text(), /Poppler/);
  assert.match(stdout.text(), /ImageMagick/);
  assert.match(stdout.text(), /PyMuPDF/);
});

test('--dry-run does the census and prints the layout, and asks no model', async () => {
  const { options, engine, stdout, asked, started } = harness();
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'fake',
    sourceIsDirectory: false,
    source: '/leaflet.pdf',
    dryRun: true,
  });
  assert.equal(outcome.code, 0);
  assert.match(stdout.text(), /Census of \/leaflet.pdf/);
  assert.ok(stdout.text().includes(layout));
  assert.match(stdout.text(), /no page was rendered and no page was read/);
  assert.equal(asked.length, 0);
  assert.equal(started.length, 0);
});

test('the local engine notice is printed before the run as well as after', async () => {
  const { options, engine, stdout } = harness();
  await runRead({
    ...options,
    engine,
    engineName: 'ollama',
    model: 'gemma4:12b',
    isLocal: true,
    sourceIsDirectory: false,
    source: '/leaflet.pdf',
    dryRun: true,
  });
  const before = stdout.text().indexOf('Census of');
  const notice = stdout.text().indexOf('measured on the El Jamon leaflet');
  assert.ok(notice >= 0 && notice < before, 'the notice comes first');
});

test('a run that is not local prints no notice at all', async () => {
  const { options, engine, stdout } = harness();
  await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'claude-sonnet-5',
    isLocal: false,
    sourceIsDirectory: false,
    source: '/leaflet.pdf',
    dryRun: true,
  });
  assert.doesNotMatch(stdout.text(), /measured on the El Jamon leaflet/);
});

test('manual mode writes PROMPT.md and stops before any model and any script', async () => {
  const { options, store, asked, started, stdout } = harness();
  const outcome = await runRead({
    ...options,
    engine: null,
    engineName: 'manual',
    manual: true,
    listPages: () => [1, 2],
  });
  assert.equal(outcome.handedOff, true);
  assert.equal(asked.length, 0);
  assert.equal(started.length, 0);
  const written = [...store.keys()].map((path) => String(path));
  assert.ok(written.some((path) => path.endsWith('PROMPT.md')));
  assert.ok(written.some((path) => path.endsWith('run.json')));
  assert.match(stdout.text(), /--resume --engine manual/);
});

test('a layout mismatch stops the run before a page is read', async () => {
  const { options, engine, asked, started, stdout } = harness({
    answers: ['{"matches":false,"differences":["the price badge is gone"]}'],
  });
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'fake',
    listPages: () => [1, 2],
  });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.layoutMismatch, true);
  // One call, the layout check, and nothing after it.
  assert.equal(asked.length, 1);
  assert.equal(started.length, 0);
  assert.match(stdout.text(), /the price badge is gone/);
});

test('a whole run reaches the three scripts and reports', async () => {
  const { options, engine, asked, started, stdout } = harness({
    answers: [
      '{"matches":true,"differences":[]}',
      '[{"name":"Leche","price":0.99,"unit_price":0.99,"unit_price_per":"l"}]',
      '[]',
      '{"from":"2026-09-01","until":"2026-09-30","raw_text":"DEL 1 AL 30"}',
    ],
  });
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'fake',
    listPages: () => [1, 2],
  });
  // The layout check, two pages, then the cover for the validity.
  assert.equal(asked.length, 4);
  assert.deepEqual(
    started.map((path) => String(path).split(/[\\/]/).pop()),
    ['build-document.mjs', 'drift-check.mjs', 'validate.mjs']
  );
  assert.match(stdout.text(), /from: 2026-09-01/);
  assert.match(stdout.text(), /harvest\/imports\/upload/);
  assert.equal(outcome.code, 0);
});
