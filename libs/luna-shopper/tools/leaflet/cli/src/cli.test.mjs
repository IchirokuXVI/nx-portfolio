import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { listChains } from './chains.mjs';
import {
  DEFAULT_ENGINE,
  DEFAULT_MODEL,
  LEAFLET_NUM_PREDICT,
  MANUAL,
  defaultOutDir,
  main,
  parseArgs,
  parseDay,
  parseNumber,
  usageText,
} from './cli.mjs';
import { parsePages } from './run.mjs';

/** Somewhere to write that is not a terminal. */
const sink = () => {
  const written = [];
  return {
    written,
    write: (text) => written.push(text),
    text: () => written.join(''),
  };
};

/** Everything `main` would otherwise touch. */
const harness = (extra = {}) => {
  const stdout = sink();
  const stderr = sink();
  const calls = [];
  return {
    stdout,
    stderr,
    calls,
    options: {
      stdout,
      stderr,
      env: {},
      isTty: false,
      exists: () => true,
      stat: () => ({ isDirectory: () => false }),
      read: async (config) => {
        calls.push(config);
        return { code: 0 };
      },
      now: () => new Date('2026-09-15T00:00:00.000Z'),
      ...extra,
    },
  };
};

test('--help prints the usage, with the -- in it', async () => {
  const { stdout, options } = harness();
  assert.equal(await main(['--help'], options), 0);
  assert.match(
    stdout.text(),
    /npx nx run luna-shopper\/leaflet-cli:read -- \[options\]/
  );
  assert.match(stdout.text(), /Keep the `--`/);
});

test('the usage lists every chain that has a folder', () => {
  const text = usageText();
  for (const slug of listChains()) {
    assert.ok(text.includes(slug), `lists ${slug}`);
  }
});

test('the usage lists manual beside the registry engines', () => {
  assert.match(usageText(), /claude, api, ollama, manual/);
  assert.match(usageText(), /a person, with any model at all/);
});

test('a missing chain lists the slugs there are', async () => {
  const { options } = harness();
  await assert.rejects(
    main(['--pdf', 'a.pdf'], options),
    new RegExp(`--chain is required.*${listChains().join(', ')}`, 's')
  );
});

test('an unknown chain lists the slugs there are', async () => {
  const { options } = harness();
  await assert.rejects(
    main(['--pdf', 'a.pdf', '--chain', 'nope'], options),
    /Unknown chain nope.*deza, dia, el-jamon, lidl.*written by hand first/s
  );
});

test('an unknown engine is refused by the registry, before anything is rendered', async () => {
  const { options, calls } = harness();
  await assert.rejects(
    main(['--pdf', 'a.pdf', '--chain', 'deza', '--engine', 'gemini'], options),
    /Unknown engine gemini/
  );
  assert.equal(calls.length, 0);
});

test('a leaflet that is not there is refused before a chain is loaded', async () => {
  const { options } = harness({ exists: () => false });
  await assert.rejects(
    main(['--pdf', 'gone.pdf', '--chain', 'deza'], options),
    /--pdf gone.pdf is not there/
  );
});

test('the default engine is claude with sonnet, and the default out directory is dated', async () => {
  const { options, calls } = harness();
  await main(['--pdf', 'a.pdf', '--chain', 'deza'], options);
  assert.equal(DEFAULT_ENGINE, 'claude');
  assert.equal(DEFAULT_MODEL, 'sonnet');
  assert.equal(calls[0].engineName, 'claude');
  assert.equal(calls[0].model, 'sonnet');
  assert.equal(calls[0].isLocal, false);
  assert.equal(calls[0].outDir, 'tmp/leaflet/deza-2026-09-15');
  assert.equal(
    defaultOutDir('dia', new Date('2026-01-02T00:00:00Z')),
    'tmp/leaflet/dia-2026-01-02'
  );
});

test('the dpi comes from the chain, and --dpi overrides it', async () => {
  const { options, calls } = harness();
  await main(['--pdf', 'a.pdf', '--chain', 'deza'], options);
  // Deza is 128 because its pages are flat 2.2 to 1 images.
  assert.equal(calls[0].dpi, 128);
  await main(['--pdf', 'a.pdf', '--chain', 'el-jamon'], options);
  assert.equal(calls[1].dpi, 160);
  await main(['--pdf', 'a.pdf', '--chain', 'deza', '--dpi', '200'], options);
  assert.equal(calls[2].dpi, 200);
});

test('--model overrides the engine default, and manual builds no engine at all', async () => {
  const { options, calls } = harness();
  await main(
    [
      '--pdf',
      'a.pdf',
      '--chain',
      'deza',
      '--engine',
      'ollama',
      '--model',
      'qwen3-vl:8b',
    ],
    options
  );
  assert.equal(calls[0].model, 'qwen3-vl:8b');
  assert.ok(calls[0].engine, 'ollama builds an engine');
  assert.equal(calls[0].isLocal, true);

  await main(
    ['--pdf', 'a.pdf', '--chain', 'deza', '--engine', MANUAL],
    options
  );
  assert.equal(calls[1].engine, null);
  assert.equal(calls[1].manual, true);
  assert.equal(calls[1].isLocal, false);
});

test('the engine is built with the ceiling a page of offers needs', async () => {
  const built = [];
  const { options } = harness({
    build: (entry, config) => {
      built.push({ entry: entry.name, ...config });
      return { name: entry.name, ask: async () => ({ text: '[]' }) };
    },
  });

  await main(
    ['--pdf', 'a.pdf', '--chain', 'el-jamon', '--engine', 'ollama'],
    options
  );
  assert.equal(built[0].entry, 'ollama');
  // 1,024 was set for a curation decision. A dense page did not fit in it and
  // came back as an unparseable answer, which is what a truncated one is.
  assert.equal(built[0].numPredict, LEAFLET_NUM_PREDICT);
  assert.equal(LEAFLET_NUM_PREDICT, 4096);

  // Manual mode builds nothing at all, so it asks for no ceiling either.
  await main(
    ['--pdf', 'a.pdf', '--chain', 'el-jamon', '--engine', MANUAL],
    options
  );
  assert.equal(built.length, 1);
});

test('the default claude engine is built with sonnet and something to start claude -p with', async () => {
  const built = [];
  const { options } = harness({
    build: (entry, config) => {
      built.push({ entry: entry.name, ...config });
      return { name: entry.name, ask: async () => ({ text: '[]' }) };
    },
  });
  await main(['--pdf', 'a.pdf', '--chain', 'el-jamon'], options);
  assert.equal(built[0].entry, 'claude');
  assert.equal(built[0].model, 'sonnet');
  // The claude entry has no default spawn, and without one its first call
  // threw, which is why no leaflet was ever read through it.
  assert.equal(typeof built[0].spawn, 'function');

  // A named engine with no --model takes that engine's own default.
  await main(
    ['--pdf', 'a.pdf', '--chain', 'el-jamon', '--engine', 'claude'],
    options
  );
  assert.equal(built[1].model, 'claude-sonnet-5');
});

test('--engine ollama is local, and the help says local vision models are unreliable on leaflets', async () => {
  const { options, calls } = harness();
  await main(
    ['--pdf', 'a.pdf', '--chain', 'deza', '--engine', 'ollama'],
    options
  );
  // The run prints the notice for every local entry, before and after.
  assert.equal(calls[0].isLocal, true);
  assert.match(usageText(), /local vision models are\s+unreliable on leaflets/);
});

/** A run.json from a first pass over pages 5 and 6. */
const RECORDED = {
  chain: 'el-jamon',
  pdf: '/leaflets/eljamon.pdf',
  pages: [5, 6],
  pageCount: 40,
  dpi: 200,
  engine: 'claude',
  model: 'sonnet',
  validity: { from: '2026-08-27', until: '2026-09-23' },
};

test('a resume reads the pages, the dpi and the dates from run.json when the flags are absent', async () => {
  const { options, calls } = harness({ readRun: () => RECORDED });
  await main(['--out', 'tmp/leaflet/x', '--resume'], options);
  assert.equal(calls[0].resume, true);
  assert.equal(calls[0].source, '/leaflets/eljamon.pdf');
  assert.equal(calls[0].pagesSpec, '5-6');
  assert.equal(calls[0].dpi, 200);
  assert.deepEqual(calls[0].recordedValidity, RECORDED.validity);

  // A flag still outranks what was recorded.
  await main(
    ['--out', 'tmp/leaflet/x', '--resume', '--pages', '7', '--dpi', '160'],
    options
  );
  assert.equal(calls[1].pagesSpec, '7');
  assert.equal(calls[1].dpi, 160);

  // A run into the same folder that is not a resume carries nothing over.
  await main(['--out', 'tmp/leaflet/x', '--pdf', 'a.pdf'], options);
  assert.equal(calls[2].pagesSpec, undefined);
  assert.equal(calls[2].dpi, 160);
  assert.equal(calls[2].recordedValidity, null);
});

test('--valid-from and --valid-until set the window on any engine', async () => {
  const { options, calls } = harness();
  for (const engine of ['claude', 'ollama', MANUAL]) {
    await main(
      [
        '--pdf',
        'a.pdf',
        '--chain',
        'el-jamon',
        '--engine',
        engine,
        '--valid-from',
        '2026-08-27',
        '--valid-until',
        '2026-09-23',
      ],
      options
    );
  }
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.deepEqual(call.statedValidity, {
      from: '2026-08-27',
      until: '2026-09-23',
    });
  }
  await assert.rejects(
    main(
      ['--pdf', 'a.pdf', '--chain', 'dia', '--valid-from', '27/08/2026'],
      options
    ),
    /--valid-from is 27\/08\/2026, and it has to be a day as YYYY-MM-DD/
  );
  await assert.rejects(
    main(
      [
        '--pdf',
        'a.pdf',
        '--chain',
        'dia',
        '--valid-from',
        '2026-09-23',
        '--valid-until',
        '2026-08-27',
      ],
      options
    ),
    /is after --valid-until/
  );
  assert.equal(parseDay('--valid-until', undefined), null);
  assert.throws(() => parseDay('--valid-until', '2026-02-30'), /YYYY-MM-DD/);
});

test('--finish takes everything from run.json and starts no read at all', async () => {
  const finished = [];
  const { options, calls } = harness({
    readRun: () => RECORDED,
    finish: async (config) => {
      finished.push(config);
      return { code: 1 };
    },
  });
  const code = await main(['--out', 'tmp/leaflet/x', '--finish'], options);
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.equal(finished[0].chain.slug, 'el-jamon');
  assert.equal(finished[0].recorded, RECORDED);
  assert.equal(finished[0].outDir, 'tmp/leaflet/x');

  const none = harness({ readRun: () => null });
  await assert.rejects(
    main(['--out', 'tmp/leaflet/y', '--finish'], none.options),
    /--finish needs --out <dir> of a run that wrote run.json, and tmp\/leaflet\/y holds none/
  );
});

test('--check-page answers one page and exits by whether its shape is right', async () => {
  const files = new Map([
    [
      join('tmp/leaflet/x', 'import', 'page_05.json'),
      '[{"name":"Leche","price":0.99}]',
    ],
  ]);
  const { options, stdout } = harness({
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path),
  });
  const code = await main(
    ['--out', 'tmp/leaflet/x', '--check-page', '5'],
    options
  );
  assert.equal(code, 1);
  assert.match(stdout.text(), /line 1, row 1 \(Leche\): brand is missing/);
  await assert.rejects(
    main(['--check-page', '5'], options),
    /--check-page needs --out/
  );
});

test('--page-timeout is a whole number of seconds, and 120 by default', async () => {
  const { options, calls } = harness();
  await main(['--pdf', 'a.pdf', '--chain', 'deza'], options);
  assert.equal(calls[0].timeoutMs, 120000);
  await main(
    ['--pdf', 'a.pdf', '--chain', 'deza', '--page-timeout', '30'],
    options
  );
  assert.equal(calls[1].timeoutMs, 30000);
  await assert.rejects(
    main(
      ['--pdf', 'a.pdf', '--chain', 'deza', '--page-timeout', 'soon'],
      options
    ),
    /--page-timeout is soon/
  );
});

test('the run code is what the command exits with', async () => {
  const { options } = harness({ read: async () => ({ code: 1 }) });
  assert.equal(await main(['--pdf', 'a.pdf', '--chain', 'deza'], options), 1);
});

test('a flag with no value is a flag', () => {
  assert.deepEqual(parseArgs(['--resume', '--chain', 'deza']), {
    resume: true,
    chain: 'deza',
  });
});

test('a loose argument is refused rather than ignored', () => {
  assert.throws(() => parseArgs(['deza']), /Unexpected argument deza/);
});

test('parseNumber refuses anything that is not a whole number', () => {
  assert.equal(parseNumber('--dpi', undefined, 160), 160);
  assert.equal(parseNumber('--dpi', '200', 160), 200);
  assert.throws(() => parseNumber('--dpi', '1.5', 160), /--dpi is 1.5/);
  assert.throws(() => parseNumber('--dpi', true, 160), /--dpi is \(nothing\)/);
});

test('--pages reads a list of pages and ranges', () => {
  assert.deepEqual(parsePages('1-4,9', 12), [1, 2, 3, 4, 9]);
  assert.deepEqual(parsePages(undefined, 3), [1, 2, 3]);
  assert.deepEqual(parsePages('2', 3), [2]);
});

test('--pages past the end of the leaflet is refused', () => {
  assert.throws(
    () => parsePages('1-4', 3),
    /--pages names 4, and the leaflet has 3/
  );
  assert.throws(() => parsePages('9-2', 12), /counts backwards/);
  assert.throws(() => parsePages('cover', 12), /not a page or a range/);
});
