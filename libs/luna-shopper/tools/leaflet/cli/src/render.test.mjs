import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PYTHON_CANDIDATES,
  RENDERERS,
  findRenderer,
  installLines,
  pageImagePath,
  pageName,
  renderArgs,
  renderPages,
} from './render.mjs';

/** A probe that says yes to the named commands and no to everything else. */
function probeFor(present) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    const ok = present.includes(command);
    return { started: ok, code: ok ? 0 : -1, stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('the probe takes pdftoppm first', async () => {
  const { run } = probeFor(['pdftoppm', 'magick', 'python']);
  const chosen = await findRenderer({ run });
  assert.equal(chosen.key, 'pdftoppm');
  assert.equal(chosen.command, 'pdftoppm');
});

test('the probe takes magick when there is no pdftoppm', async () => {
  const { run } = probeFor(['magick', 'python']);
  const chosen = await findRenderer({ run });
  assert.equal(chosen.key, 'magick');
});

test('the probe takes a Python that can import fitz, and names which one', async () => {
  const { run, calls } = probeFor(['python3']);
  const chosen = await findRenderer({ run });
  assert.equal(chosen.key, 'pymupdf');
  assert.equal(chosen.command, 'python3');
  // Every earlier candidate was asked for the import, not for the interpreter.
  const asked = calls.filter(([, args]) => args[1] === 'import fitz');
  assert.deepEqual(
    asked.map(([command]) => command),
    PYTHON_CANDIDATES.slice(0, PYTHON_CANDIDATES.indexOf('python3') + 1)
  );
});

test('a Python with no PyMuPDF is not a renderer', async () => {
  const run = async (command, args) => ({
    // The interpreter is there and the import fails, which is the case that
    // matters: a bare python renders nothing.
    started: command === 'python' && args[1] === 'import fitz',
    code: 1,
    stdout: '',
    stderr: 'ModuleNotFoundError',
  });
  assert.equal(await findRenderer({ run }), null);
});

test('with nothing installed the run gets one install line per renderer', async () => {
  const { run } = probeFor([]);
  assert.equal(await findRenderer({ run }), null);
  const text = installLines();
  for (const entry of RENDERERS) {
    assert.ok(text.includes(entry.install), `names ${entry.key}`);
  }
});

test('a page image is page_NN.png from 01', () => {
  assert.equal(pageName(1), 'page_01.png');
  assert.equal(pageName(40), 'page_40.png');
  assert.ok(pageImagePath('/out', 7).endsWith('page_07.png'));
});

test('every renderer is asked for one whole page at the chain dpi', () => {
  for (const key of ['pdftoppm', 'magick', 'pymupdf']) {
    const renderer = { key, command: key };
    const [, args] = renderArgs(renderer, {
      pdf: 'a.pdf',
      out: '/out/page_05.png',
      page: 5,
      dpi: 128,
    });
    const joined = args.join(' ');
    assert.ok(joined.includes('128'), `${key} passes the dpi`);
    // Nothing crops, splits or tiles: one page in, one image out.
    assert.ok(
      !joined.includes('crop') && !joined.includes('tile'),
      `${key} never splits a page`
    );
  }
});

test('pdftoppm is given -singlefile so the name is the one it was asked for', () => {
  const [command, args] = renderArgs(
    { key: 'pdftoppm', command: 'pdftoppm' },
    { pdf: 'a.pdf', out: '/out/page_05.png', page: 5, dpi: 160 }
  );
  assert.equal(command, 'pdftoppm');
  assert.ok(args.includes('-singlefile'));
  assert.equal(args.at(-1), '/out/page_05');
});

test('magick counts pages from zero', () => {
  const [, args] = renderArgs(
    { key: 'magick', command: 'magick' },
    { pdf: 'a.pdf', out: '/out/page_05.png', page: 5, dpi: 160 }
  );
  assert.ok(args.includes('a.pdf[4]'));
});

test('rendering writes one image per wanted page, in order', async () => {
  const seen = [];
  const run = async (command, args) => {
    seen.push(args.at(-1));
    return { started: true, code: 0, stdout: '', stderr: '' };
  };
  const out = await renderPages({
    renderer: { key: 'pymupdf', command: 'python', label: 'Python' },
    pdf: 'a.pdf',
    outDir: '/out',
    dpi: 160,
    pages: [1, 2, 3],
    run,
  });
  assert.equal(out.length, 3);
  assert.deepEqual(seen, ['160', '160', '160']);
  assert.ok(out[2].endsWith('page_03.png'));
});

test('a page that fails to render is named by number', async () => {
  const run = async (command, args) => ({
    started: true,
    code: args.includes('2') ? 1 : 0,
    stdout: '',
    stderr: 'broken xref',
  });
  await assert.rejects(
    renderPages({
      renderer: { key: 'pymupdf', command: 'python', label: 'Python' },
      pdf: 'a.pdf',
      outDir: '/out',
      dpi: 160,
      pages: [1, 2],
      run,
    }),
    /page 2 did not render.*broken xref/
  );
});
