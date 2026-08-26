#!/usr/bin/env node
/**
 * Composes one mock folder into a single self contained `index.html`.
 *
 * Why this exists: the published mock and the committed artboards had drifted apart.
 * The old `index.html` pulled each artboard into an `<iframe src="./File.dc.html">`,
 * which works from disk and cannot work once published (an artifact is one page, and
 * a relative file fetch has nothing to fetch), and it dropped the sticky notes
 * entirely, so the published canvas carried commentary the repo did not have.
 *
 * The fix is to stop keeping two things in step. This script inlines the artboards
 * and renders the notes from `canvas.json`, and the file it writes is BOTH the
 * offline copy in the repo and the file that gets published. Same bytes, so drift
 * is not something to remember to avoid, it is something that cannot happen.
 *
 * Usage:
 *   node apps/velista/plans/mocks/build-index.mjs home
 *   node apps/velista/plans/mocks/build-index.mjs entry
 *
 * The output has no `<!doctype>`, `<html>`, `<head>` or `<body>` tag on purpose: the
 * Artifact tool supplies that skeleton at publish time, and a browser opening the
 * file straight from disk supplies it too. A `<title>` at the top names the page in
 * both places.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const folder = process.argv[2];
if (!folder) {
  console.error('usage: build-index.mjs <folder>   (for example: home)');
  process.exit(1);
}

const dir = join(here, folder);
const canvas = JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8'));

/** Turns `Main.dc.html` into `ab-Main`, which scopes that artboard's own CSS. */
const idFor = (file) => 'ab-' + file.replace(/\.dc\.html$/, '').replace(/\W/g, '');

/**
 * Rewrites an artboard's `<helmet>` CSS so it cannot reach the other artboards.
 *
 * Every artboard ships the same four rules except `DayTheme`, which recolours `a`
 * for the light theme. Inlining six of those into one document would let whichever
 * came last win, and the Day artboard's links would repaint the Night ones. So each
 * rule is prefixed with its own artboard's id. `body` rules are dropped, because in
 * a composed page the body is this page's, not the artboard's.
 */
function scopeCss(css, id) {
  return css
    .split('}')
    .map((chunk) => {
      const at = chunk.indexOf('{');
      if (at === -1) return '';
      const selector = chunk.slice(0, at).trim();
      const body = chunk.slice(at + 1).trim();
      if (!selector || !body) return '';
      if (selector === 'body') return '';
      const scoped = selector
        .split(',')
        .map((one) => `#${id} ${one.trim()}`)
        .join(', ');
      return `${scoped} { ${body} }`;
    })
    .filter(Boolean)
    .join('\n');
}

const escapeHtml = (text) =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const fontLinks = new Set();
const styles = [];
const boards = [];

for (const board of canvas.artboards) {
  const id = idFor(board.file);
  const raw = readFileSync(join(dir, board.file), 'utf8');

  const inner = raw.match(/<x-dc>([\s\S]*)<\/x-dc>/);
  if (!inner) throw new Error(`${board.file}: no <x-dc> block`);
  let content = inner[1];

  const helmet = content.match(/<helmet>([\s\S]*?)<\/helmet>/);
  if (helmet) {
    content = content.replace(helmet[0], '');
    for (const link of helmet[1].matchAll(/<link\b[^>]*>/g)) fontLinks.add(link[0]);
    for (const style of helmet[1].matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      styles.push(scopeCss(style[1], id));
    }
  }

  boards.push({ ...board, id, content: content.trim() });
}

// Annotations sit above the artboards in canvas coordinates, so the origin is
// wherever the topmost, leftmost thing happens to be rather than 0,0.
const notes = canvas.annotations ?? [];
const NOTE_HEIGHT_GUESS = 170;
const minX = Math.min(...boards.map((b) => b.x), ...notes.map((n) => n.x));
const minY = Math.min(...boards.map((b) => b.y), ...notes.map((n) => n.y));
const width = Math.max(...boards.map((b) => b.x + b.w), ...notes.map((n) => n.x + n.w)) - minX;
const height =
  Math.max(
    ...boards.map((b) => b.y + b.h),
    ...notes.map((n) => n.y + NOTE_HEIGHT_GUESS)
  ) - minY;

const boardHtml = boards
  .map(
    (b) => `      <figure class="board" style="left: ${b.x - minX}px; top: ${b.y - minY}px; width: ${b.w}px;">
        <figcaption>${escapeHtml(b.title)}</figcaption>
        <div class="frame" id="${b.id}" style="width: ${b.w}px; height: ${b.h}px;">
${b.content
  .split('\n')
  .map((line) => (line.trim() ? '          ' + line : line))
  .join('\n')}
        </div>
      </figure>`
  )
  .join('\n');

const noteHtml = notes
  .map(
    (n) => `      <aside class="note" style="left: ${n.x - minX}px; top: ${n.y - minY}px; width: ${n.w}px;">${n.text
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('')}</aside>`
  )
  .join('\n');

const page = `<title>${canvas.title}</title>
${[...fontLinks].join('\n')}
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 0 56px;
    background: #11141f;
    color: #f7f8fc;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  header { padding: 0 28px; max-width: 860px; }
  h1 {
    margin: 0 0 8px;
    font-family: 'Marcellus', Georgia, serif;
    font-weight: 400;
    font-size: 32px;
    letter-spacing: 0.03em;
  }
  .lede { margin: 0; font-size: 14px; line-height: 1.6; color: #98a0bb; }
  .lede code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #c2c8db; }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 22px 28px 14px;
    font-size: 13px;
    color: #98a0bb;
  }
  .controls button {
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: #c2c8db;
    font: inherit;
    cursor: pointer;
  }
  .controls button[aria-pressed='true'] { border-color: #ffb454; color: #ffb454; }

  /* The canvas scrolls inside itself so the page body never scrolls sideways. */
  .viewport { overflow-x: auto; overflow-y: hidden; padding: 0 28px 28px; }
  .canvas { position: relative; transform-origin: top left; }
  .board { position: absolute; margin: 0; }
  figcaption {
    margin-bottom: 9px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #98a0bb;
  }
  .frame {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    background: #0a0c14;
    overflow: hidden;
    position: relative;
  }
  .note {
    position: absolute;
    padding: 14px 16px;
    border: 1px solid rgba(255, 180, 84, 0.28);
    border-radius: 10px;
    background: rgba(255, 180, 84, 0.07);
    color: #e4e7f1;
    font-size: 12.5px;
    line-height: 1.55;
  }
  .note p { margin: 0 0 7px; }
  .note p:last-child { margin-bottom: 0; }
${styles.filter(Boolean).join('\n')}
</style>

<header>
  <h1>${escapeHtml(canvas.title)}</h1>
  <p class="lede">${canvas.lede}</p>
</header>

<div class="controls">
  <span>Scale</span>
  <button type="button" data-scale="1" aria-pressed="true">100%</button>
  <button type="button" data-scale="0.66" aria-pressed="false">66%</button>
  <button type="button" data-scale="0.4" aria-pressed="false">40%</button>
</div>

<div class="viewport">
  <div class="canvas" id="canvas" style="width: ${width}px; height: ${height}px;">
${boardHtml}
${noteHtml}
  </div>
</div>

<script>
  // The only script on the page. It scales the canvas for reading on a laptop and
  // does nothing else: these are artboards, not an editor.
  (function () {
    var canvas = document.getElementById('canvas');
    var w = ${width};
    var h = ${height};
    var buttons = document.querySelectorAll('.controls button');
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var scale = parseFloat(button.dataset.scale);
        canvas.style.transform = 'scale(' + scale + ')';
        canvas.style.width = w * scale + 'px';
        canvas.style.height = h * scale + 'px';
        buttons.forEach(function (other) {
          other.setAttribute('aria-pressed', String(other === button));
        });
      });
    });
  })();
</script>
`;

writeFileSync(join(dir, 'index.html'), page, 'utf8');
console.log(
  `${folder}/index.html: ${boards.length} artboards, ${notes.length} notes, ${Math.round(page.length / 1024)} KB`
);
