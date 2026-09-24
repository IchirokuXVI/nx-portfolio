/**
 * A PDF into one PNG per page, by shelling out to whatever is installed.
 *
 * There is no way to rasterize a PDF in plain Node, and these libraries carry
 * zero npm dependencies by rule, so the tool looks for `pdftoppm` (Poppler),
 * then `magick` (ImageMagick), then a Python that can import PyMuPDF, then a
 * running Docker, in that order, and uses the first it finds. When it finds none
 * the run stops here and prints the one line that installs each.
 *
 * **Docker is the renderer of a machine that has nothing else** (plan 0003). It
 * runs `pdftoppm` inside `alpine` with `poppler-utils`, over two mounted folders,
 * which is what backend plan 0150 did by hand with `render.sh`. It says so before
 * Docker pulls the image, and it renders every wanted page in one container,
 * because the package install is most of what a container costs.
 *
 * **A renderer that is there but cannot render a PDF is passed over.**
 * ImageMagick answers its version without Ghostscript and then fails on every
 * page, so a renderer that fails before it has written a single page hands the
 * run to the next one. See `findRenderer`'s `skip`.
 *
 * Two rules the renderer keeps:
 *
 * - **The dpi is a chain property.** It comes from `chains/<slug>/headings.mjs`
 *   and `--dpi` overrides it. Deza is 128 because its pages are flat 2.2 to 1
 *   images, and the other three are 160.
 * - **A page is never split.** A cut through a tile loses the tile, and the
 *   leaflet plan's section 7 measured what quartering costs: the digits did not
 *   improve at all and the promotion types got worse.
 *
 * A leaflet that arrives as images skips all of it. `--pdf <directory>` reads
 * `page_NN.png` out of that directory, which is how LIDL is read: its own flyer
 * endpoint already serves every page as a 2400 pixel image.
 *
 * Every process this file starts goes through an injected `run`, so the probe
 * and the render loop both run under `node --test` with nothing installed.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { runCommand } from './child.mjs';

/** What a caller that wants no per page progress line passes. */
const noop = () => undefined;

/** One page of a rendered leaflet, `page_01.png` upwards. */
export const pageName = (page) => `page_${String(page).padStart(2, '0')}.png`;

/** Where one page's image goes. */
export const pageImagePath = (dir, page) => join(dir, pageName(page));

/**
 * The Python commands tried for PyMuPDF, in order.
 *
 * `tmp/.venv-ocr` is first because the manual procedure this command replaces
 * already creates it, so an operator who read a leaflet by hand has it.
 */
export const PYTHON_CANDIDATES = [
  'tmp/.venv-ocr/Scripts/python.exe',
  'tmp/.venv-ocr/bin/python',
  'python',
  'python3',
];

/** One line of Python that renders one page. Kept to one line on purpose:
 * `-c` takes it as a single argument and a block would need indentation. */
const PY_RENDER =
  'import sys, fitz; ' +
  'doc = fitz.open(sys.argv[1]); ' +
  'doc[int(sys.argv[3]) - 1].get_pixmap(dpi=int(sys.argv[4])).save(sys.argv[2])';

/** One line of Python that answers the whole census: pages, page sizes in
 * points, and whether each page carries a text layer. */
export const PY_CENSUS =
  'import sys, json, fitz; ' +
  'doc = fitz.open(sys.argv[1]); ' +
  'print(json.dumps({"pages": doc.page_count, ' +
  '"sizes": [[round(p.rect.width), round(p.rect.height)] for p in doc], ' +
  '"text": [bool(p.get_text().strip()) for p in doc]}))';

/** The image the Docker renderer runs, pinned as `render.sh` pinned it. */
export const DOCKER_IMAGE = 'alpine:3.20';

/**
 * The four renderers, in the order they are tried.
 *
 * `probe` is the command and arguments that say whether the tool is there.
 * `install` is the one line that installs it, printed when none is found.
 */
export const RENDERERS = [
  {
    key: 'pdftoppm',
    label: 'pdftoppm (Poppler)',
    install:
      'Poppler: winget install oschwartz10612.Poppler, or apt install poppler-utils, or brew install poppler',
  },
  {
    key: 'magick',
    label: 'magick (ImageMagick)',
    install:
      'ImageMagick: winget install ImageMagick.ImageMagick, or apt install imagemagick, or brew install imagemagick. A PDF also needs Ghostscript',
  },
  {
    key: 'pymupdf',
    label: 'Python with PyMuPDF',
    install:
      'PyMuPDF: python -m venv tmp/.venv-ocr, then tmp/.venv-ocr/Scripts/pip install pymupdf',
  },
  {
    key: 'docker',
    label: `pdftoppm in Docker (${DOCKER_IMAGE} with poppler-utils)`,
    install:
      'Docker: install Docker Desktop, or apt install docker.io, and start it. Nothing else is needed: the pages render in a container',
  },
];

/** What to print when nothing is installed: one line per renderer. */
export function installLines(renderers = RENDERERS) {
  return [
    'No PDF renderer was found, so the pages cannot be made into images.',
    'Install one of these, or hand the pages over already rendered with --pdf <directory of page_NN.png>:',
    ...renderers.map((entry) => `  ${entry.install}`),
  ].join('\n');
}

/**
 * The first renderer that answers, or null.
 *
 * `pymupdf` is two questions rather than one: which Python, and whether that
 * Python can import fitz. A Python with no PyMuPDF is not a renderer, so the
 * probe asks for the import and not for the interpreter. `docker` is asked for
 * `docker version`, which exits non-zero when the client is installed and the
 * daemon is not running, and a Docker with no daemon renders nothing either.
 *
 * `skip` names the renderers already tried on this run, so a renderer that
 * answered the probe and then failed on the first page is not chosen again.
 */
export async function findRenderer({
  run = runCommand,
  renderers = RENDERERS,
  pythons = PYTHON_CANDIDATES,
  skip = [],
  cwd,
} = {}) {
  for (const entry of renderers) {
    if (skip.includes(entry.key)) {
      continue;
    }
    if (entry.key === 'docker') {
      const answer = await run('docker', ['version'], { cwd });
      if (answer.started && answer.code === 0) {
        return { ...entry, command: 'docker' };
      }
      continue;
    }
    if (entry.key === 'pymupdf') {
      for (const python of pythons) {
        const answer = await run(python, ['-c', 'import fitz'], { cwd });
        if (answer.started && answer.code === 0) {
          return { ...entry, command: python };
        }
      }
      continue;
    }
    const args = entry.key === 'magick' ? ['-version'] : ['-v'];
    const answer = await run(entry.key, args, { cwd });
    // pdftoppm answers its version on stderr and exits non-zero on some
    // builds, so the question is whether the process started at all.
    if (answer.started) {
      return { ...entry, command: entry.key };
    }
  }
  return null;
}

/** A word the container's `sh` reads as one argument, whatever it holds. */
const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

/** Who the rendered images should belong to on the host, or null where the
 * question means nothing: Windows has no uid, and root owns them already. */
export function hostOwner(proc = process) {
  const uid = proc.getuid?.();
  const gid = proc.getgid?.();
  return typeof uid === 'number' && uid !== 0 ? `${uid}:${gid}` : null;
}

/**
 * The one `docker run` that renders every wanted page.
 *
 * The PDF's folder is mounted read only at `/in` and the pages folder at `/out`,
 * so nothing else on the host is visible to the container. Each page is its own
 * `pdftoppm -singlefile`, joined with `&&`, so the first page that fails stops
 * the rest and the pages before it are kept, exactly as one child per page
 * would leave them. On a host with a uid the images are handed back to it,
 * because a container writes as root.
 */
export function dockerRenderArgs({
  pdf,
  outDir,
  pages,
  dpi,
  owner = hostOwner(),
}) {
  const source = resolve(pdf);
  const inside = shellQuote(`/in/${basename(source)}`);
  const steps = [
    'apk add --no-cache poppler-utils >/dev/null',
    ...pages.map(
      (page) =>
        `pdftoppm -png -r ${dpi} -f ${page} -l ${page} -singlefile ${inside} /out/${pageName(page).replace(/\.png$/, '')}`
    ),
  ];
  if (owner) {
    steps.push(
      `chown ${owner} ${pages.map((page) => `/out/${pageName(page)}`).join(' ')}`
    );
  }
  return [
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${dirname(source)}:/in:ro`,
      '-v',
      `${resolve(outDir)}:/out`,
      DOCKER_IMAGE,
      'sh',
      '-c',
      steps.join(' && '),
    ],
  ];
}

/** The arguments that render one page with one renderer. */
export function renderArgs(renderer, { pdf, out, page, dpi }) {
  if (renderer.key === 'docker') {
    return dockerRenderArgs({ pdf, outDir: dirname(out), pages: [page], dpi });
  }
  if (renderer.key === 'pdftoppm') {
    return [
      renderer.command,
      [
        '-png',
        '-r',
        String(dpi),
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        pdf,
        out.replace(/\.png$/, ''),
      ],
    ];
  }
  if (renderer.key === 'magick') {
    // ImageMagick counts pages from zero inside the brackets.
    return [
      renderer.command,
      ['-density', String(dpi), `${pdf}[${page - 1}]`, out],
    ];
  }
  return [
    renderer.command,
    ['-c', PY_RENDER, pdf, out, String(page), String(dpi)],
  ];
}

/** A render failure that says how many pages this renderer wrote first, which
 * is what decides whether the run may try the next renderer. */
function renderFailure(message, rendered) {
  const error = new Error(message);
  error.rendered = rendered;
  return error;
}

/**
 * Every wanted page in one container, with the pull said out loud first.
 *
 * `docker run` pulls a missing image by itself and says so only on its own
 * stderr, which this run captures. So the image is looked for first, and a pull
 * is announced before it happens.
 */
async function renderInDocker({
  renderer,
  pdf,
  outDir,
  dpi,
  pages,
  run,
  cwd,
  exists,
  onPage,
  say,
}) {
  const present = await run('docker', ['image', 'inspect', DOCKER_IMAGE], {
    cwd,
  });
  if (!present.started || present.code !== 0) {
    say(
      `${DOCKER_IMAGE} is not on this machine, so Docker pulls it now (a few MB, once).`
    );
  }
  say(
    'The container installs poppler-utils from the Alpine package index, which needs the network.'
  );
  const [command, args] = dockerRenderArgs({ pdf, outDir, pages, dpi });
  const answer = await run(command, args, { cwd });
  const done = pages.filter((page) => exists(pageImagePath(outDir, page)));
  if (!answer.started || answer.code !== 0 || done.length < pages.length) {
    const first = pages.find((page) => !done.includes(page)) ?? pages[0];
    throw renderFailure(
      `page ${first} did not render with ${renderer.label}: ${(answer.stderr || answer.stdout || '').trim() || `exit ${answer.code}`}`,
      done.length
    );
  }
  return done.map((page) => {
    const path = pageImagePath(outDir, page);
    onPage(page, path);
    return path;
  });
}

/**
 * Every wanted page to a PNG, one child per page.
 *
 * One child per page rather than one for the whole document, because a page
 * that fails is then named by number and the other thirty nine still render,
 * and because `--resume` can skip a page whose image is already there. Docker
 * keeps both properties in one container: see `dockerRenderArgs`.
 *
 * A failure carries `rendered`, the number of pages this renderer wrote before
 * it, and a renderer that wrote none is one the run may pass over.
 */
export async function renderPages({
  renderer,
  pdf,
  outDir,
  dpi,
  pages,
  run = runCommand,
  cwd,
  exists = existsSync,
  onPage = noop,
  say = noop,
}) {
  if (renderer.key === 'docker') {
    return renderInDocker({
      renderer,
      pdf,
      outDir,
      dpi,
      pages,
      run,
      cwd,
      exists,
      onPage,
      say,
    });
  }
  const rendered = [];
  for (const page of pages) {
    const out = pageImagePath(outDir, page);
    const [command, args] = renderArgs(renderer, { pdf, out, page, dpi });
    const answer = await run(command, args, { cwd });
    if (!answer.started || answer.code !== 0) {
      throw renderFailure(
        `page ${page} did not render with ${renderer.label}: ${(answer.stderr || answer.stdout || '').trim() || `exit ${answer.code}`}`,
        rendered.length
      );
    }
    rendered.push(out);
    onPage(page, out);
  }
  return rendered;
}

/** The page numbers a directory of images already holds. */
export function pagesInDirectory(dir, readdir = readdirSync) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdir(dir)
    .map((name) => /^page_(\d+)\.png$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}
