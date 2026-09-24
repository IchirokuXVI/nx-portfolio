import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import { CHAINS_DIR, readLayout, readPrompt, resolveChain } from './chains.mjs';
import { finishRun, runRead } from './run.mjs';

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
  // Both next steps are whole commands, pasteable as printed.
  assert.ok(
    stdout
      .text()
      .includes(
        'npx nx run luna-shopper/leaflet-cli:read -- --out /out --check-page 1'
      )
  );
  assert.ok(
    stdout
      .text()
      .includes(
        'npx nx run luna-shopper/leaflet-cli:read -- --out /out --finish'
      )
  );
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

/** Where a run under `/out` keeps a file, spelled as the run spells it. */
const at = (...parts) => join('/out', ...parts);

/** One El Jamon row in the plan 0002 shape. */
const ROW = {
  name: 'Leche Entera',
  brand: null,
  unitSize: 1,
  sizeFormat: 'l',
  price: 0.99,
  unitPrice: null,
  unitPriceLabel: null,
  category: 'DAIRY',
  categoryPath: [],
  leaflet: {
    format: '1 L.',
    basis: 'unit',
    wasPrice: null,
    loyalty: false,
    validUntil: null,
    validityText: null,
    promotion: null,
  },
};

test('a folder of page images is read for the pages it holds, and no others', async () => {
  const { options, engine, asked, store } = harness({
    answers: [
      '{"matches":true,"differences":[]}',
      JSON.stringify([ROW]),
      '[]',
      '{"from":"2026-08-27","until":"2026-09-23","raw_text":"DEL 27 DE AGOSTO AL 23 DE SEPTIEMBRE"}',
    ],
    images: ['page_05.png', 'page_06.png'],
  });
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'sonnet',
    listPages: () => [5, 6],
  });
  assert.equal(outcome.code, 0);
  // The layout check, pages 5 and 6, then the cover. Pages 1 to 4 were never
  // asked for and never refused.
  assert.equal(asked.length, 4);
  const run = JSON.parse(store.get(at('run.json')));
  assert.deepEqual(run.pages, [5, 6]);
  assert.equal(run.pageCount, 6);
});

test('a resume keeps the pages and the dates, and never overwrites what a person filled', async () => {
  const { options, engine, asked, store, stdout } = harness({
    images: ['page_05.png', 'page_06.png'],
  });
  store.set(
    at('run.json'),
    JSON.stringify({
      chain: 'el-jamon',
      pages: [5, 6],
      startedAt: '2026-09-23T10:00:00.000Z',
      validity: { from: '2026-08-27', until: '2026-09-23' },
    })
  );
  store.set(at('import', 'page_05.json'), JSON.stringify([ROW]));
  store.set(at('import', 'page_06.json'), '[]');
  // A person corrected the start by hand and wrote a note between two runs.
  store.set(
    at('import', 'leaflet.json'),
    JSON.stringify({
      pdf: 'x',
      page_count: 6,
      fixed_sections: { 1: 'cover' },
      validity: {
        from: '2026-08-28',
        until: null,
        raw_text: 'DEL 28 DE AGOSTO',
      },
      campaign: 'Vuelta al cole',
      extraction: { tool: 'x', date: 'x' },
      notes: [
        { page: 10, message: 'one tile ends on the 14th', raw_text: null },
      ],
    })
  );
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'sonnet',
    resume: true,
    pagesSpec: '5-6',
    recordedValidity: { from: '2026-08-27', until: '2026-09-23' },
    listPages: () => [5, 6],
  });
  assert.equal(outcome.code, 0);
  // The readings were kept and both bounds were already known, so the only
  // call was the layout check. The cover was not asked.
  assert.equal(asked.length, 1);

  const leaflet = JSON.parse(store.get(at('import', 'leaflet.json')));
  assert.deepEqual(leaflet.validity, {
    from: '2026-08-28',
    until: '2026-09-23',
    raw_text: 'DEL 28 DE AGOSTO',
  });
  assert.equal(leaflet.campaign, 'Vuelta al cole');
  assert.equal(leaflet.notes.length, 1);
  assert.match(stdout.text(), /from: 2026-08-28, from leaflet.json/);
  assert.match(stdout.text(), /until: 2026-09-23, from run.json/);

  const run = JSON.parse(store.get(at('run.json')));
  assert.deepEqual(run.pages, [5, 6]);
  assert.equal(run.startedAt, '2026-09-23T10:00:00.000Z');
  assert.equal(run.resumedAt, '2026-09-15T00:00:00.000Z');
  assert.deepEqual(run.validity, { from: '2026-08-27', until: '2026-09-23' });
});

test('--valid-from and --valid-until outrank the cover, which is then not asked', async () => {
  const { options, engine, asked, store } = harness({
    answers: ['{"matches":true,"differences":[]}', '[]', '[]'],
  });
  await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'sonnet',
    statedValidity: { from: '2026-08-27', until: '2026-09-23' },
    listPages: () => [1, 2],
  });
  assert.equal(asked.length, 3);
  const leaflet = JSON.parse(store.get(at('import', 'leaflet.json')));
  assert.equal(leaflet.validity.from, '2026-08-27');
  assert.equal(leaflet.validity.until, '2026-09-23');
  const run = JSON.parse(store.get(at('run.json')));
  assert.deepEqual(run.validity, { from: '2026-08-27', until: '2026-09-23' });
});

test('a reading that is not ready prints the resume command with its pages', async () => {
  const { options, engine, stdout } = harness({
    answers: [
      '{"matches":true,"differences":[]}',
      '[]',
      '{"from":null,"until":null,"raw_text":null}',
    ],
    images: ['page_05.png', 'page_06.png'],
  });
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'sonnet',
    pagesSpec: '5',
    listPages: () => [5, 6],
    stream: async (node, args) => ({
      started: true,
      code: args.some((arg) => String(arg).endsWith('validate.mjs')) ? 1 : 0,
    }),
  });
  assert.equal(outcome.code, 1);
  assert.ok(
    stdout
      .text()
      .includes(
        'npx nx run luna-shopper/leaflet-cli:read -- --out /out --resume --engine claude --model sonnet --pages 5'
      )
  );
});

test('a renderer that renders nothing hands the run to the next one', async () => {
  const { options, engine, stdout } = harness({
    answers: [
      '{"matches":true,"differences":[]}',
      '[]',
      '[]',
      '{"from":"2026-09-01","until":"2026-09-30","raw_text":"x"}',
    ],
  });
  const magick = {
    key: 'magick',
    command: 'magick',
    label: 'magick (ImageMagick)',
  };
  const docker = {
    key: 'docker',
    command: 'docker',
    label: 'pdftoppm in Docker',
  };
  const used = [];
  const outcome = await runRead({
    ...options,
    engine,
    engineName: 'claude',
    model: 'sonnet',
    sourceIsDirectory: false,
    source: '/leaflet.pdf',
    findRenderer: async ({ skip = [] } = {}) =>
      skip.includes('magick') ? docker : magick,
    render: async ({ renderer }) => {
      used.push(renderer.key);
      if (renderer.key === 'magick') {
        const error = new Error(
          'page 1 did not render with magick: no delegate for PDF'
        );
        error.rendered = 0;
        throw error;
      }
      return [];
    },
  });
  assert.deepEqual(used, ['magick', 'docker']);
  assert.match(
    stdout.text(),
    /answered the probe and rendered no page, so the run tries the next renderer/
  );
  assert.match(
    stdout.text(),
    /Rendering 2 page\(s\) at 160 dpi with pdftoppm in Docker/
  );
  assert.equal(outcome.code, 0);
});

test('--finish reads run.json, builds, and stops at a failed drift check', async () => {
  const { options, store, started, stdout } = harness();
  store.set(at('import', 'page_05.json'), JSON.stringify([ROW]));
  store.set(at('import', 'page_06.json'), '[]');
  const outcome = await finishRun({
    chain,
    defaults: { dpi: 160, fixedSections: { 1: 'cover' } },
    outDir: '/out',
    recorded: {
      chain: 'el-jamon',
      pdf: '/leaflets/eljamon-leaflet.pdf',
      pdfIsDirectory: false,
      pages: [5, 6],
      pageCount: 40,
      dpi: 160,
      engine: 'manual',
      model: null,
      validity: { from: '2026-08-27', until: '2026-09-23' },
    },
    stripFence,
    stdout,
    writeFile: options.writeFile,
    readFile: options.readFile,
    exists: options.exists,
    now: options.now,
    stream: async (node, args) => {
      const script = args.find((arg) => String(arg).endsWith('.mjs'));
      started.push(script);
      return {
        started: true,
        code: String(script).endsWith('drift-check.mjs') ? 1 : 0,
      };
    },
  });
  assert.equal(outcome.code, 1);
  assert.deepEqual(
    started.map((path) => String(path).split(/[\\/]/).pop()),
    ['build-document.mjs', 'drift-check.mjs']
  );
  const text = stdout.text();
  assert.match(
    text,
    /Finishing \/out: el-jamon, pages 5-6 of 40, 160 dpi, read by manual/
  );
  assert.match(text, /from: 2026-08-27, from run.json/);
  assert.match(text, /The drift check refused this reading/);
  // The exact command that accepts it, printed and not run.
  assert.match(
    text,
    /build-document\.mjs --readings \/out\/import --leaflet \/out\/import\/leaflet\.json --chain el-jamon --out \/out\/el-jamon\.harvest-document\.json --update-baseline/
  );
  assert.ok(
    text.includes(
      'npx nx run luna-shopper/leaflet-cli:read -- --out /out --finish'
    )
  );
});

test('--finish refuses a page nobody wrote, before anything is built', async () => {
  const { options, started } = harness();
  options.writeFile(at('import', 'page_05.json'), '[]');
  await assert.rejects(
    finishRun({
      chain,
      defaults: { dpi: 160 },
      outDir: '/out',
      recorded: {
        chain: 'el-jamon',
        pdf: '/a.pdf',
        pages: [5, 6],
        pageCount: 40,
      },
      stripFence,
      stdout: sink(),
      writeFile: options.writeFile,
      readFile: options.readFile,
      exists: options.exists,
      stream: options.stream,
    }),
    /page 6: there is no reading at all/
  );
  assert.equal(started.length, 0);
});
