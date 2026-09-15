import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import {
  askValidity,
  buildLeafletJson,
  extractionTool,
  formatReport,
  formatValidity,
  outputPaths,
  parseValidity,
  runScripts,
  validityWarning,
} from './document.mjs';
import { localEngineShortNotice } from './notice.mjs';

const chain = { slug: 'deza', baselinePath: '/chains/deza/baseline.json' };

/** A stream that records the children it was asked to start. */
function streamer(codes = {}) {
  const calls = [];
  const stream = async (node, args) => {
    const script = args.find((arg) => arg.endsWith('.mjs'));
    const name = script ? script.split(/[\\/]/).pop() : args[0];
    calls.push({ name, args });
    return { started: true, code: codes[name] ?? 0 };
  };
  return { stream, calls };
}

const quiet = { write: () => undefined };

test('leaflet.json carries the fields the README names', () => {
  const leaflet = buildLeafletJson({
    pdf: '../deza.pdf',
    pageCount: 62,
    fixedSections: { 1: 'cover' },
    validity: {
      from: '2026-09-01',
      until: '2026-09-30',
      raw_text: 'DEL 1 AL 30',
    },
    tool: 'ollama gemma4:12b',
    date: '2026-09-15T10:00:00.000Z',
  });
  assert.deepEqual(Object.keys(leaflet), [
    'pdf',
    'page_count',
    'fixed_sections',
    'validity',
    'campaign',
    'extraction',
    'notes',
  ]);
  assert.equal(leaflet.page_count, 62);
  assert.equal(leaflet.extraction.tool, 'ollama gemma4:12b');
});

test('a null validity bound survives into the file as null', () => {
  const leaflet = buildLeafletJson({
    pdf: 'a.pdf',
    pageCount: 2,
    validity: { from: null, until: '2026-09-30', raw_text: 'HASTA EL 30' },
    tool: 'x',
    date: 'now',
  });
  assert.equal(leaflet.validity.from, null);
  assert.equal(leaflet.validity.until, '2026-09-30');
  assert.match(formatValidity(leaflet), /from: null \(the page printed none\)/);
  assert.match(formatValidity(leaflet), /needs both bounds/);
  assert.equal(validityWarning(leaflet).name, 'validity');
});

test('every filled validity field is printed for the operator to confirm', () => {
  const leaflet = buildLeafletJson({
    pdf: 'a.pdf',
    pageCount: 2,
    validity: {
      from: '2026-09-02',
      until: '2026-09-08',
      raw_text: 'DEL 02/09 AL 08/09',
    },
    tool: 'x',
    date: 'now',
  });
  const printed = formatValidity(leaflet);
  assert.match(printed, /from: 2026-09-02/);
  assert.match(printed, /until: 2026-09-08/);
  assert.match(printed, /raw_text: DEL 02\/09 AL 08\/09/);
  assert.equal(validityWarning(leaflet), null);
});

test('the engine warning goes into extraction.tool, which is what reaches the document', () => {
  const notice = localEngineShortNotice('ollama', 'gemma4:12b');
  const tool = extractionTool({
    engine: 'ollama',
    model: 'gemma4:12b',
    slug: 'el-jamon',
    notice,
  });
  assert.match(
    tool,
    /^ollama gemma4:12b via luna-shopper\/leaflet-cli, chains\/el-jamon\/prompt.txt\./
  );
  assert.ok(tool.includes(notice));
});

test('an engine with no notice says only who read it', () => {
  const tool = extractionTool({ engine: 'manual', model: null, slug: 'dia' });
  assert.equal(
    tool,
    'manual via luna-shopper/leaflet-cli, chains/dia/prompt.txt'
  );
});

test('the cover is asked once and an unreadable answer is all nulls', async () => {
  const asked = [];
  const engine = {
    async ask(prompt, options) {
      asked.push({ prompt, options });
      return { text: 'I could not read the dates.' };
    },
  };
  const validity = await askValidity({
    engine,
    images: [{ mediaType: 'image/png', data: 'cover' }],
    stripFence,
  });
  assert.equal(asked.length, 1);
  assert.deepEqual(validity, { from: null, until: null, raw_text: null });
});

test('a fenced validity answer is read', () => {
  assert.deepEqual(
    parseValidity(
      '```json\n{"from":"2026-09-01","until":null,"raw_text":"x"}\n```',
      stripFence
    ),
    { from: '2026-09-01', until: null, raw_text: 'x' }
  );
});

test('the three scripts run in order, with the arguments the README documents', async () => {
  const { stream, calls } = streamer();
  const outcome = await runScripts({
    slug: 'deza',
    importDir: '/out/import',
    outDir: '/out',
    chain,
    stream,
    exists: () => true,
    stdout: quiet,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ['build-document.mjs', 'drift-check.mjs', 'validate.mjs']
  );
  const build = calls[0].args;
  assert.ok(build.includes('--readings') && build.includes('/out/import'));
  assert.ok(
    build.includes('--leaflet') &&
      build.includes(join('/out/import', 'leaflet.json'))
  );
  assert.ok(build.includes('--chain') && build.includes('deza'));
  assert.ok(
    build.includes('--out') &&
      build.includes(outputPaths('/out', 'deza').document)
  );
  assert.ok(calls[1].args.includes(outputPaths('/out', 'deza').report));
  // validate.mjs is the one that needs the flag, or Node reads the contract's
  // .ts file as a missing file rather than a missing flag.
  assert.equal(calls[2].args[0], '--experimental-strip-types');
  assert.equal(outcome.validated, 'valid');
});

test('--update-baseline is never passed', async () => {
  const { stream, calls } = streamer();
  await runScripts({
    slug: 'deza',
    importDir: '/out/import',
    outDir: '/out',
    chain,
    stream,
    exists: () => true,
    stdout: quiet,
  });
  for (const call of calls) {
    assert.ok(!call.args.includes('--update-baseline'));
  }
});

test('a drift refusal stops the run before validate', async () => {
  const { stream, calls } = streamer({ 'drift-check.mjs': 1 });
  const outcome = await runScripts({
    slug: 'deza',
    importDir: '/out/import',
    outDir: '/out',
    chain,
    stream,
    exists: () => true,
    stdout: quiet,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ['build-document.mjs', 'drift-check.mjs']
  );
  assert.equal(outcome.drift, 'refused');
  assert.equal(outcome.validated, 'not run');
});

test('a chain with no baseline skips the drift check and says so', async () => {
  const { stream, calls } = streamer();
  const outcome = await runScripts({
    slug: 'dia',
    importDir: '/out/import',
    outDir: '/out',
    chain: { slug: 'dia', baselinePath: '/chains/dia/baseline.json' },
    stream,
    exists: () => false,
    stdout: quiet,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ['build-document.mjs', 'validate.mjs']
  );
  assert.equal(outcome.drift, 'skipped');
});

test('the report counts the offers, names every warning and prints the upload call', () => {
  const report = formatReport({
    slug: 'deza',
    pagesRead: 62,
    warnings: [
      {
        name: 'unit price with no basis',
        page: 4,
        product: 'Aceite',
        message: 'no basis',
      },
    ],
    outcome: {
      built: true,
      drift: 'within the baseline',
      validated: 'valid',
      document: '/out/deza.harvest-document.json',
      report: '/out/deza.harvest-document.report.json',
    },
    exists: () => true,
    readFile: () =>
      JSON.stringify({
        products: 296,
        withPrice: 285,
        withUnitPriceOnly: 11,
        withNeither: 0,
        warnings: [{ page: 1, message: 'x' }],
      }),
  });
  assert.match(report, /pages read: 62/);
  assert.match(report, /offers: 296/);
  assert.match(report, /with a price: 285/);
  assert.match(report, /with a unit price only: 11/);
  assert.match(report, /with neither: 0/);
  assert.match(report, /\[unit price with no basis\] page 4, Aceite/);
  assert.match(report, /\/out\/deza.harvest-document.json/);
  assert.match(report, /harvest\/imports\/upload/);
  assert.match(report, /Nothing was uploaded/);
});

test('a refused report names no upload call at all', () => {
  const report = formatReport({
    slug: 'deza',
    pagesRead: 62,
    outcome: {
      built: true,
      drift: 'refused',
      validated: 'not run',
      document: '/out/deza.harvest-document.json',
      report: '/out/deza.harvest-document.report.json',
    },
    exists: () => false,
  });
  assert.doesNotMatch(report, /harvest\/imports\/upload/);
  assert.match(report, /refused this reading/);
});

test('the local engine notice ends the run when there was one', () => {
  const notice = localEngineShortNotice('ollama', 'gemma4:12b');
  const report = formatReport({
    slug: 'deza',
    pagesRead: 1,
    outcome: {
      built: false,
      drift: 'not run',
      validated: 'not run',
      document: '/out/d.json',
      report: '/out/d.report.json',
    },
    exists: () => false,
    notice,
  });
  assert.ok(report.includes(notice));
});
