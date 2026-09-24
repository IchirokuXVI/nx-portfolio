import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import {
  DOCKER_IMAGE,
  PYTHON_CANDIDATES,
  RENDERERS,
  dockerRenderArgs,
  findRenderer,
  hostOwner,
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

test('the probe takes Docker last, and only with a daemon that answers', async () => {
  const { run, calls } = probeFor(['docker']);
  const chosen = await findRenderer({ run });
  assert.equal(chosen.key, 'docker');
  assert.deepEqual(calls.at(-1), ['docker', ['version']]);

  // A client with no daemon starts, exits non-zero, and renders nothing.
  const down = async (command) => ({
    started: command === 'docker',
    code: command === 'docker' ? 1 : -1,
    stdout: '',
    stderr: 'Cannot connect to the Docker daemon',
  });
  assert.equal(await findRenderer({ run: down }), null);
});

test('a renderer already tried on this run is skipped', async () => {
  const { run } = probeFor(['magick', 'docker']);
  assert.equal((await findRenderer({ run })).key, 'magick');
  assert.equal((await findRenderer({ run, skip: ['magick'] })).key, 'docker');
});

test('the Docker renderer runs pdftoppm in alpine over two mounted folders', () => {
  const [command, args] = dockerRenderArgs({
    pdf: '/leaflets/eljamon-leaflet.pdf',
    outDir: '/out/pages',
    pages: [5, 6],
    dpi: 160,
    owner: '1000:1000',
  });
  assert.equal(command, 'docker');
  assert.deepEqual(args.slice(0, 2), ['run', '--rm']);
  assert.ok(
    args.includes(`${dirname(resolve('/leaflets/eljamon-leaflet.pdf'))}:/in:ro`)
  );
  assert.ok(args.includes(`${resolve('/out/pages')}:/out`));
  assert.ok(args.includes(DOCKER_IMAGE));
  assert.equal(DOCKER_IMAGE, 'alpine:3.20');
  assert.deepEqual(args.slice(-3, -1), ['sh', '-c']);
  assert.equal(
    args.at(-1),
    [
      'apk add --no-cache poppler-utils >/dev/null',
      "pdftoppm -png -r 160 -f 5 -l 5 -singlefile '/in/eljamon-leaflet.pdf' /out/page_05",
      "pdftoppm -png -r 160 -f 6 -l 6 -singlefile '/in/eljamon-leaflet.pdf' /out/page_06",
      'chown 1000:1000 /out/page_05.png /out/page_06.png',
    ].join(' && ')
  );
  // Windows has no uid, so nothing is handed back there.
  const [, windows] = dockerRenderArgs({
    pdf: 'a.pdf',
    outDir: '/out',
    pages: [1],
    dpi: 128,
    owner: null,
  });
  assert.doesNotMatch(windows.at(-1), /chown/);
  assert.equal(hostOwner({}), null);
  assert.equal(hostOwner({ getuid: () => 0, getgid: () => 0 }), null);
  assert.equal(
    hostOwner({ getuid: () => 1000, getgid: () => 100 }),
    '1000:100'
  );
});

test('a PDF name with a quote in it stays one word inside the container', () => {
  const [, args] = dockerRenderArgs({
    pdf: "/x/it's.pdf",
    outDir: '/out',
    pages: [1],
    dpi: 160,
    owner: null,
  });
  assert.ok(args.at(-1).includes(`-singlefile '/in/it'\\''s.pdf'`));
});

/** A docker that answers `image inspect` as told and renders the pages. */
function fakeDocker({ imagePresent, fail = false }) {
  const calls = [];
  const written = new Set();
  const run = async (command, args) => {
    calls.push(args[0] === 'image' ? 'inspect' : args[0]);
    if (args[0] === 'image') {
      return {
        started: true,
        code: imagePresent ? 0 : 1,
        stdout: '',
        stderr: '',
      };
    }
    if (!fail) {
      for (const match of args.at(-1).matchAll(/\/out\/(page_\d+)(?= |$)/g)) {
        written.add(`${match[1]}.png`);
      }
    }
    return {
      started: true,
      code: fail ? 1 : 0,
      stdout: '',
      stderr: fail ? 'no such file' : '',
    };
  };
  const exists = (path) => written.has(String(path).split(/[\\/]/).pop());
  return { run, exists, calls };
}

const DOCKER = {
  key: 'docker',
  command: 'docker',
  label: 'pdftoppm in Docker',
};

test('Docker says it is pulling the image before it pulls, and renders every page in one container', async () => {
  const said = [];
  const { run, exists, calls } = fakeDocker({ imagePresent: false });
  const out = await renderPages({
    renderer: DOCKER,
    pdf: '/leaflets/a.pdf',
    outDir: '/out',
    dpi: 160,
    pages: [5, 6],
    run,
    exists,
    say: (line) => said.push(line),
  });
  assert.deepEqual(calls, ['inspect', 'run']);
  assert.match(
    said[0],
    /alpine:3.20 is not on this machine, so Docker pulls it now/
  );
  assert.equal(out.length, 2);
  assert.ok(out[1].endsWith('page_06.png'));
});

test('Docker announces no pull when the image is already there', async () => {
  const said = [];
  const { run, exists } = fakeDocker({ imagePresent: true });
  await renderPages({
    renderer: DOCKER,
    pdf: '/leaflets/a.pdf',
    outDir: '/out',
    dpi: 160,
    pages: [1],
    run,
    exists,
    say: (line) => said.push(line),
  });
  assert.ok(said.every((line) => !/pulls/.test(line)));
});

test('a Docker render that wrote nothing names the page and says it wrote none', async () => {
  const { run, exists } = fakeDocker({ imagePresent: true, fail: true });
  await assert.rejects(
    renderPages({
      renderer: DOCKER,
      pdf: '/leaflets/a.pdf',
      outDir: '/out',
      dpi: 160,
      pages: [5, 6],
      run,
      exists,
    }),
    (error) =>
      /page 5 did not render.*no such file/.test(error.message) &&
      error.rendered === 0
  );
});
