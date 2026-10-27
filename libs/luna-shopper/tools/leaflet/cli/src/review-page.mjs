/**
 * The review page: a leaflet's page images beside what each reading says.
 *
 * A person checks a reading by looking at the page, and a model is checked by
 * putting two readings of the same page next to each other. This builds one
 * HTML file that does both, for the pages named, so the check takes minutes
 * rather than an afternoon of opening JSON files beside PNGs:
 *
 *   node libs/luna-shopper/tools/leaflet/cli/src/review-page.mjs \
 *     --leaflet deza-2026-11 --title "Deza November Leaflet Review" \
 *     --run opus=tmp/leaflet/deza-opus --run sonnet=tmp/leaflet/deza-sonnet \
 *     --pages 4,5,6,10 --images tmp/leaflet/deza-opus/pages \
 *     --mine tmp/leaflet/my-reading.md --verdicts tmp/leaflet/verdicts.json \
 *     --out tmp/leaflet/review
 *
 * `--run label=<dir>` names a run folder of `cli.mjs`, the one that holds
 * `import/page_NN.json`. One run is a plain check of that reading; two or more
 * are compared row by row, aligned by page and row index, and a cell where the
 * readings disagree is highlighted. A difference in a number, a size, a label,
 * a basis or a promotion marks the row "check this"; a difference in wording
 * alone marks it "wording differs"; everything else is "models agree".
 *
 * `--mine` is a person's own reading as a markdown table, written before
 * looking at any model output (`| page | # | name | brand | size | price |
 * footer | basis | notes |`), and `--verdicts` is a JSON file of
 * `{ rows: { p4r3: "..." } }` with a verdict per row id. Both are optional and
 * are printed under the row they belong to.
 *
 * The page is meant to be published as a claude.ai artifact with the `db`
 * capability declared. Each row then carries a "wrong" mark and a comment box
 * whose values are saved in the artifact's database at
 * `reviews/<leaflet>/rows/<rowId>`, where the `ArtifactData` tool reads them
 * back. Without that capability the page still renders and says that marks
 * cannot be saved. Page images are copied beside the page, shrunk with
 * ImageMagick when it is installed, so the published page stays small.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The fields compared between readings, and the heading each prints under. */
export const FIELDS = [
  ['price', 'Price'],
  ['unit', 'Unit price'],
  ['label', 'Footer label'],
  ['size', 'Size'],
  ['basis', 'Basis'],
  ['brand', 'Brand'],
  ['format', 'Format'],
  ['promo', 'Promotion'],
  ['was', 'Was'],
];

/** The fields whose difference is a number to look at, not a wording. */
export const HARD = new Set([
  'price',
  'unit',
  'label',
  'size',
  'basis',
  'promo',
  'was',
]);

const pad = (n) => String(n).padStart(2, '0');

/** The id of one row on the page, which is also its document id in the store. */
export const rowId = (page, index) => `p${page}r${index + 1}`;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const norm = (v) =>
  v == null ? '' : String(v).trim().toLowerCase().replace(/\s+/g, ' ');

const money = (v) => (typeof v === 'number' ? v.toFixed(2) : '');

/** One reading's row, flattened to the strings the table prints. */
export function cellsOf(row) {
  const l = row.leaflet ?? {};
  return {
    name: row.name ?? '',
    brand: row.brand ?? '',
    size:
      row.unitSize == null
        ? ''
        : `${row.unitSize} ${row.sizeFormat ?? ''}`.trim(),
    format: l.format ?? '',
    price: money(row.price),
    unit: money(row.unitPrice),
    label: row.unitPriceLabel ?? '',
    basis: l.basis ?? '',
    promo: l.promotion
      ? `${l.promotion.type} "${l.promotion.rawText ?? ''}"`
      : '',
    was: money(l.wasPrice),
  };
}

/**
 * How the readings of one row compare.
 *
 * Answers `{ status, diffs, nameDiff }`. `diffs` names each field on which any
 * two readings disagree; `status` is `check` when one of them is a hard field,
 * `wording` when only soft fields or the name differ, `agree` otherwise. A
 * reading with no row at this index counts as disagreeing on every field. With
 * a single reading there is nothing to compare, and the status is `single`.
 */
export function compareRows(cells) {
  if (cells.length < 2) {
    return { status: 'single', diffs: [], nameDiff: false };
  }
  const present = cells.filter(Boolean);
  if (present.length < cells.length) {
    return { status: 'check', diffs: FIELDS.map(([k]) => k), nameDiff: true };
  }
  const diffs = FIELDS.map(([k]) => k).filter((k) =>
    present.some((c) => norm(c[k]) !== norm(present[0][k]))
  );
  const nameDiff = present.some((c) => norm(c.name) !== norm(present[0].name));
  const status = diffs.some((k) => HARD.has(k))
    ? 'check'
    : diffs.length || nameDiff
      ? 'wording'
      : 'agree';
  return { status, diffs, nameDiff };
}

/**
 * A person's reading out of its markdown table, keyed by page number.
 *
 * The page cell may carry the heading after the number (`4 FRUTERÍA`), which
 * is how a person writes it once per page and leaves blank below.
 */
export function parseMine(markdown) {
  const mine = {};
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\| *(\d+)[^|]*\| *(\d+) *\|(.*)\|$/);
    if (!m) {
      continue;
    }
    const c = m[3].split('|').map((x) => x.trim());
    (mine[Number(m[1])] ??= []).push({
      name: c[0] ?? '',
      brand: c[1] ?? '',
      size: c[2] ?? '',
      price: c[3] ?? '',
      footer: c[4] ?? '',
      basis: c[5] ?? '',
      notes: c[6] ?? '',
    });
  }
  return mine;
}

const PILL = {
  agree: 'models agree',
  wording: 'wording differs',
  check: 'check this',
  single: 'one reading',
};

/**
 * The whole page, from what the readings say.
 *
 * `pages` is `[{ page, heading, image, rows: [{ id, cells: [per run], mine,
 * verdict }] }]`, `runs` the labels in the order their cells come. Pure, so a
 * test can read the markup without a file system.
 */
export function buildPage({ leaflet, title, runs, pages, intro = '' }) {
  let totalRows = 0;
  let flagged = 0;
  const nav = pages.map((p) => `<a href="#p${p.page}">${p.page}</a>`).join('');
  const sections = pages
    .map((p) => {
      const rows = p.rows
        .map((row, i) => {
          totalRows += 1;
          const { status, diffs, nameDiff } = compareRows(row.cells);
          if (status === 'check') {
            flagged += 1;
          }
          const first = row.cells.find(Boolean);
          const names = runs
            .map((label, r) => {
              const c = row.cells[r];
              if (r > 0 && !nameDiff) {
                return '';
              }
              return `<b>${esc(label)}</b> ${esc(c ? c.name : 'no row')}`;
            })
            .filter(Boolean)
            .join(' ');
          const body = runs
            .map((label, r) => {
              const c = row.cells[r];
              const tds = c
                ? FIELDS.map(
                    ([k]) =>
                      `<td class="${diffs.includes(k) ? (HARD.has(k) ? 'hard' : 'soft') : ''}">${esc(c[k])}</td>`
                  ).join('')
                : `<td colspan="${FIELDS.length}" class="hard">no row</td>`;
              return `<tr><th>${esc(label)}</th>${tds}</tr>`;
            })
            .join('');
          const my = row.mine
            ? `<p class="mine"><b>Mine</b> ${esc(row.mine.name)} · brand ${esc(row.mine.brand)} · size ${esc(row.mine.size)} · price ${esc(row.mine.price)} · footer ${esc(row.mine.footer)} · basis ${esc(row.mine.basis)}${row.mine.notes ? ` · <i>${esc(row.mine.notes)}</i>` : ''}</p>`
            : '';
          const verdict = row.verdict
            ? `<p class="verdict"><b>Verdict</b> ${esc(row.verdict)}</p>`
            : '';
          return `<article class="row ${status}" id="${row.id}" data-row="${row.id}">
<header><span class="idx">${i + 1}</span><span class="pill ${status}">${PILL[status]}</span><span class="names">${names || esc(first?.name ?? '')}</span><span class="saved" aria-live="polite"></span></header>
<div class="tbl"><table><thead><tr><th>Reading</th>${FIELDS.map(([, lab]) => `<th>${lab}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
${my}${verdict}
<div class="mark"><label><input type="checkbox" class="wrong" id="w-${row.id}"> Wrong</label><textarea class="comment" id="c-${row.id}" rows="1" placeholder="Comment" aria-label="Comment on row ${i + 1} of page ${p.page}"></textarea></div>
</article>`;
        })
        .join('');
      const counts = runs
        .map(
          (label, r) =>
            `${p.rows.filter((row) => row.cells[r]).length} rows (${esc(label)})`
        )
        .join(' · ');
      return `<section class="page" id="p${p.page}"><div class="img"><h2>Page ${p.page} <small>${esc(p.heading)}</small></h2><a href="${esc(p.image)}" target="_blank" rel="noopener"><img src="${esc(p.image)}" alt="Page ${p.page} of the leaflet" loading="lazy"></a></div><div class="rows"><p class="count">${counts}</p>${rows}</div></section>`;
    })
    .join('');

  const legend =
    runs.length > 1
      ? `<div class="legend"><span class="h">number or size differs: ${flagged} rows</span><span class="s">wording differs</span><span class="o">models agree</span><span class="w">marked wrong: <span id="wrong-count">0</span></span></div>`
      : `<div class="legend"><span class="w">marked wrong: <span id="wrong-count">0</span></span></div>`;
  const filters =
    runs.length > 1
      ? `<label class="filter"><input type="checkbox" id="only-check"> Only rows to check</label><label class="filter"><input type="checkbox" id="only-wrong"> Only rows marked wrong</label>`
      : `<label class="filter"><input type="checkbox" id="only-wrong"> Only rows marked wrong</label>`;

  return `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
<div class="top">
<div><h1>${esc(title)}</h1><p>${esc(intro)} ${pages.length} pages, ${totalRows} rows. ${runs.length > 1 ? 'A highlighted cell is where the readings disagree.' : ''} Tick Wrong and write a comment on any row; both are saved as you type. Click an image to open it full size.</p><p class="dbnote" id="dbnote"></p></div>
${legend}
<div class="filters">${filters}</div>
<nav>${nav}</nav>
</div>
${sections}
<script>${SCRIPT.replace('__LEAFLET__', JSON.stringify(leaflet))}</script>
`;
}

const CSS = `
/* Layout: one section per leaflet page; the page image stays put at the left while the rows scroll on the right. */
:root { --bg:#f6f5f2; --fg:#1f1d1a; --muted:#6b665e; --line:#dcd8d0; --panel:#ffffff; --accent:#d9661a; --hard:#fde3d6; --hard-fg:#8a2f00; --soft:#fff6d6; --ok:#e3f1e5; --ok-fg:#245c2e; --wrong:#b3261e; --sans:"IBM Plex Sans",system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#171513; --fg:#ebe7e0; --muted:#a39d93; --line:#3a3630; --panel:#211f1c; --accent:#f08a3e; --hard:#4a2412; --hard-fg:#ffb48a; --soft:#3f3614; --ok:#1d3522; --ok-fg:#9ad3a5; --wrong:#ff8a80; color-scheme: dark } }
:root[data-theme="dark"] { --bg:#171513; --fg:#ebe7e0; --muted:#a39d93; --line:#3a3630; --panel:#211f1c; --accent:#f08a3e; --hard:#4a2412; --hard-fg:#ffb48a; --soft:#3f3614; --ok:#1d3522; --ok-fg:#9ad3a5; --wrong:#ff8a80; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 14px; line-height: 1.45; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg) }
h1 { font-size: 22px; font-weight: 600; margin: 0; text-wrap: balance }
h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px }
h2 small { color: var(--muted); font-weight: 400; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; margin-left: 8px }
.top { position: sticky; top: env(safe-area-inset-top, 0px); background: var(--bg); border-bottom: 1px solid var(--line); padding-block: 12px; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center }
.top p { margin: 0; color: var(--muted); max-width: 70ch }
.dbnote { font-size: 12px; min-height: 1em }
nav { display: flex; flex-wrap: wrap; gap: 6px }
nav a { font-family: var(--mono); font-size: 13px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; color: var(--fg); text-decoration: none }
nav a:hover, nav a:focus-visible { border-color: var(--accent); outline: none }
.filters { display: flex; gap: 14px; flex-wrap: wrap }
label.filter { display: flex; gap: 6px; align-items: center; cursor: pointer }
.legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--muted) }
.legend span { padding: 1px 8px; border-radius: 4px }
.legend .h { background: var(--hard); color: var(--hard-fg) }
.legend .s { background: var(--soft); color: var(--fg) }
.legend .o { background: var(--ok); color: var(--ok-fg) }
.legend .w { border: 1px solid var(--wrong); color: var(--wrong) }
.legend .w span { padding: 0 }
.page { display: grid; grid-template-columns: minmax(260px, 380px) minmax(0, 1fr); gap: 20px; padding-block: 28px; border-bottom: 1px solid var(--line) }
.img { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 110px); align-self: start }
.img img { width: 100%; height: auto; max-width: 100%; border: 1px solid var(--line); background: #fff }
.rows { min-width: 0; display: flex; flex-direction: column; gap: 10px }
.count { margin: 0; color: var(--muted); font-size: 12px }
.row { border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 8px 10px }
.row.check { border-color: var(--accent) }
.row.is-wrong { border-color: var(--wrong); box-shadow: inset 3px 0 0 var(--wrong) }
.row header { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px }
.idx { font-family: var(--mono); color: var(--muted) }
.names { min-width: 0 }
.names b { color: var(--muted); font-weight: 600; font-size: 12px; margin-right: 4px }
.saved { margin-left: auto; font-size: 11px; color: var(--muted) }
.pill { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; padding: 1px 8px; border-radius: 10px; background: var(--ok); color: var(--ok-fg) }
.pill.wording { background: var(--soft); color: var(--fg) }
.pill.check { background: var(--hard); color: var(--hard-fg) }
.pill.single { background: var(--line); color: var(--fg) }
.tbl { overflow-x: auto }
table { border-collapse: collapse; font-family: var(--mono); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap }
th, td { text-align: left; padding: 3px 10px 3px 0; border-bottom: 1px solid var(--line); vertical-align: top }
thead th { font-family: var(--sans); font-weight: 600; font-size: 11px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase }
tbody th { font-family: var(--sans); font-weight: 600; color: var(--muted) }
td.hard { background: var(--hard); color: var(--hard-fg) }
td.soft { background: var(--soft) }
.mine, .verdict { margin: 6px 0 0; font-size: 13px }
.mine b, .verdict b { color: var(--accent); font-weight: 600; margin-right: 4px }
.verdict b { color: var(--muted) }
.mark { display: flex; gap: 12px; align-items: flex-start; margin-top: 8px; flex-wrap: wrap }
.mark label { display: flex; gap: 6px; align-items: center; cursor: pointer; white-space: nowrap; padding-top: 4px }
.mark textarea { flex: 1 1 240px; min-width: 0; font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--fg); resize: vertical }
.mark textarea:focus-visible, .mark input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }
body.only-check .row.agree, body.only-check .row.wording, body.only-check .row.single { display: none }
body.only-wrong .row:not(.is-wrong) { display: none }
@media (max-width: 760px) { .page { grid-template-columns: 1fr } .img { position: static } }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth } }
`;

const SCRIPT = `
(function () {
  var LEAFLET = __LEAFLET__;
  var note = document.getElementById('dbnote');
  var wrongCount = document.getElementById('wrong-count');
  function bind(id, cls) {
    var box = document.getElementById(id);
    if (!box) return;
    try { box.checked = localStorage.getItem('review-' + id) === '1'; } catch (e) {}
    var apply = function () {
      document.body.classList.toggle(cls, box.checked);
      try { localStorage.setItem('review-' + id, box.checked ? '1' : '0'); } catch (e) {}
    };
    box.addEventListener('change', apply);
    apply();
  }
  bind('only-check', 'only-check');
  bind('only-wrong', 'only-wrong');

  function countWrong() {
    wrongCount.textContent = String(document.querySelectorAll('.row.is-wrong').length);
  }
  function applyRow(id, data) {
    var row = document.getElementById(id);
    if (!row) return;
    var w = row.querySelector('input.wrong');
    var c = row.querySelector('textarea.comment');
    w.checked = Boolean(data.wrong);
    row.classList.toggle('is-wrong', Boolean(data.wrong));
    if (document.activeElement !== c && c.value !== (data.comment || '')) c.value = data.comment || '';
  }
  document.addEventListener('change', function (ev) {
    if (ev.target.matches('input.wrong')) {
      ev.target.closest('.row').classList.toggle('is-wrong', ev.target.checked);
      countWrong();
    }
  });

  var use = window.claude && typeof window.claude.use === 'function' ? window.claude.use('db') : Promise.resolve(null);
  use.then(function (db) {
    if (!db) {
      note.textContent = 'Marks and comments cannot be saved in this view.';
      return;
    }
    var col = db.collection('reviews/' + LEAFLET + '/rows');
    col.onSnapshot(function (snap) {
      snap.docs.forEach(function (d) { applyRow(d.id, d.data() || {}); });
      countWrong();
    }, function (e) {
      note.textContent = 'Saving stopped (' + e.code + '). Reload the page to continue.';
    });
    var queues = {};
    function save(row) {
      var id = row.dataset.row;
      var status = row.querySelector('.saved');
      var data = {
        wrong: row.querySelector('input.wrong').checked,
        comment: row.querySelector('textarea.comment').value,
        updatedAt: new Date().toISOString()
      };
      status.textContent = 'saving';
      queues[id] = (queues[id] || Promise.resolve()).then(function () {
        return col.doc(id).set(data).then(function () {
          status.textContent = 'saved';
        }, function (e) {
          status.textContent = 'not saved (' + e.code + ')';
        });
      });
    }
    document.addEventListener('change', function (ev) {
      if (ev.target.matches('input.wrong')) save(ev.target.closest('.row'));
    });
    var timers = {};
    document.addEventListener('input', function (ev) {
      if (!ev.target.matches('textarea.comment')) return;
      var row = ev.target.closest('.row');
      clearTimeout(timers[row.dataset.row]);
      timers[row.dataset.row] = setTimeout(function () { save(row); }, 800);
    });
    document.addEventListener('focusout', function (ev) {
      if (!ev.target.matches('textarea.comment')) return;
      var row = ev.target.closest('.row');
      clearTimeout(timers[row.dataset.row]);
      save(row);
    });
  });
})();
`;

/** Copies one page image beside the page, shrunk when ImageMagick is there. */
export function placeImage(source, outDir, page) {
  mkdirSync(join(outDir, 'pages'), { recursive: true });
  const jpg = join(outDir, 'pages', `page_${pad(page)}.jpg`);
  const shrunk = spawnSync(
    'magick',
    [source, '-resize', '760x', '-quality', '82', jpg],
    { stdio: 'ignore' }
  );
  if (shrunk.status === 0 && existsSync(jpg)) {
    return `pages/page_${pad(page)}.jpg`;
  }
  const png = join(outDir, 'pages', `page_${pad(page)}.png`);
  copyFileSync(source, png);
  return `pages/page_${pad(page)}.png`;
}

/** `--run label=dir` and the plain flags, read off the argument list. */
export function parseArgs(argv) {
  const flags = { runs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument ${arg}.`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} needs a value.`);
    }
    i += 1;
    if (key === 'run') {
      const at = value.indexOf('=');
      if (at < 1) {
        throw new Error(`--run takes label=<dir>, not ${value}.`);
      }
      flags.runs.push({ label: value.slice(0, at), dir: value.slice(at + 1) });
    } else {
      flags[key] = value;
    }
  }
  return flags;
}

/** The pages a `--pages` value names: `4,5,10-12`. */
export function parsePages(spec) {
  const pages = [];
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) {
      throw new Error(`--pages ${spec} is not a list of pages.`);
    }
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let p = from; p <= to; p++) {
      pages.push(p);
    }
  }
  return pages;
}

function readRows(dir, page) {
  const file = join(dir, 'import', `page_${pad(page)}.json`);
  if (!existsSync(file)) {
    return null;
  }
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(rows) ? rows : null;
}

export function main(argv) {
  const flags = parseArgs(argv);
  for (const name of ['leaflet', 'pages', 'images', 'out']) {
    if (!flags[name]) {
      throw new Error(`--${name} is required.`);
    }
  }
  if (flags.runs.length === 0) {
    throw new Error('At least one --run label=<dir> is required.');
  }
  const pageNumbers = parsePages(flags.pages);
  const mine = flags.mine ? parseMine(readFileSync(flags.mine, 'utf8')) : {};
  const verdicts = flags.verdicts
    ? (JSON.parse(readFileSync(flags.verdicts, 'utf8')).rows ?? {})
    : {};
  mkdirSync(flags.out, { recursive: true });

  const pages = pageNumbers.map((page) => {
    const readings = flags.runs.map((run) => readRows(run.dir, page) ?? []);
    const count = Math.max(...readings.map((r) => r.length));
    const heading = readings.find((r) => r[0])?.[0]?.categoryPath?.[0] ?? '';
    const source = join(flags.images, `page_${pad(page)}.png`);
    if (!existsSync(source)) {
      throw new Error(`${source} is not there.`);
    }
    const rows = [];
    for (let i = 0; i < count; i++) {
      const id = rowId(page, i);
      rows.push({
        id,
        cells: readings.map((r) => (r[i] ? cellsOf(r[i]) : null)),
        mine: mine[page]?.[i] ?? null,
        verdict: verdicts[id] ?? null,
      });
    }
    return {
      page,
      heading,
      image: placeImage(source, flags.out, page),
      rows,
    };
  });

  const html = buildPage({
    leaflet: flags.leaflet,
    title: flags.title ?? `${flags.leaflet} leaflet review`,
    runs: flags.runs.map((run) => run.label),
    pages,
    intro: flags.intro ?? '',
  });
  writeFileSync(join(flags.out, 'index.html'), html);
  return {
    out: join(flags.out, 'index.html'),
    pages: pages.length,
    rows: pages.reduce((n, p) => n + p.rows.length, 0),
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(
      `Wrote ${result.out}: ${result.pages} page(s), ${result.rows} row(s).\nPublish it as an artifact with the db capability declared, with pages/ as its files.\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
