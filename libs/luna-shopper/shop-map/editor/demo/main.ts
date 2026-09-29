import type {
  LiveMapHandle,
  MapMark,
  ShopMapDocumentV2,
  WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  createLiveMap,
  stateAt,
  walkOrderV2,
} from '@portfolio/luna-shopper/shop-map/model';
// The demo only: the fixture is not part of the model's public surface.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  elJamonDocument,
  elJamonLog,
} from '../../model/src/lib/__fixtures__/el-jamon';
import type { ShopMapLook, ShopMapPerson } from '../src';
import { mountShopMap } from '../src';
import { sampleDocument, sampleLive } from './sample';

/**
 * The editor's demo page (editor plan 0001): the El Jamón map of model plan
 * 0002 in both looks and both themes, and a replay of its walk through the
 * live map of model plan 0003. Opened from disk after
 * `npx nx build luna-shopper/shop-map/editor`. The query string sets the
 * starting state, for screenshots: `?look=shopper&theme=night&t=600`.
 */

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const frame = $<HTMLElement>('#frame');
const status = $<HTMLElement>('#status');
const say = (text: string) => (status.textContent = text);

let look: ShopMapLook = params.get('look') === 'shopper' ? 'shopper' : 'mapper';
const theme = params.get('theme');
if (theme === 'day' || theme === 'night')
  document.documentElement.dataset['theme'] = theme;

const sample = params.get('doc') === 'sample';
const baseDocument = sample ? sampleDocument : elJamonDocument;
const log: WalkEntry[] = elJamonLog;
const endMs = Math.max(...log.map((e) => e.logTo));

const handle = mountShopMap($<HTMLElement>('#map'), {
  document: baseDocument,
  look,
  onSelect: (a) =>
    say(a ? `Selected ${a.section ?? a.kind}` : 'Selection cleared'),
  onChange: (events) =>
    say(
      events
        .map((e) =>
          e.type === 'area-put'
            ? `area-put ${e.area.kind} ${e.area.w} × ${e.area.h} m`
            : e.type
        )
        .join(', ')
    ),
  onLongPress: (at, area) =>
    say(
      `Long press at ${at.x}, ${at.y}${area ? ` on ${area.section ?? area.kind}` : ''}`
    ),
  onSuggestion: (id) => say(`Suggestion ${id}`),
  onSection: (section) => say(`Section ${section}`),
});

// Badges from the walk order: the first sections still to get, two done.
const order = walkOrderV2(baseDocument).sections;
const badges: Record<string, { count: number; done: boolean }> = {};
order
  .slice(0, 8)
  .forEach(
    (s, i) => (badges[s.name] = { count: (i % 3) + 1, done: i % 4 === 1 })
  );
handle.setBadges(badges);

function setLook(next: ShopMapLook) {
  look = next;
  handle.setLook(next);
  document
    .querySelectorAll<HTMLButtonElement>('[data-look]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', `${b.dataset['look'] === next}`)
    );
}
document
  .querySelectorAll<HTMLButtonElement>('[data-look]')
  .forEach((b) =>
    b.addEventListener('click', () => setLook(b.dataset['look'] as ShopMapLook))
  );
document.querySelectorAll<HTMLButtonElement>('[data-theme-to]').forEach((b) =>
  b.addEventListener('click', () => {
    document.documentElement.dataset['theme'] = b.dataset['themeTo'] as string;
  })
);
$<HTMLInputElement>('#snap').addEventListener('change', (e) =>
  handle.setSnap((e.target as HTMLInputElement).checked)
);
setLook(look);

// The replay: every tracked point of the log in log time order, fed to the live map.
const points: [number, number, number][] = [];
const marks: MapMark[] = [];
for (const e of log) {
  if (e.kind === 'rewound' || e.kind === 'edited') continue;
  for (const ev of e.events) {
    if (ev.type === 'path') points.push(...ev.points);
    if (ev.type === 'mark-put') marks.push(ev.mark);
  }
}
points.sort((a, b) => a[0] - b[0]);
marks.sort((a, b) => a.logMs - b.logMs);

const empty: ShopMapDocumentV2 = { version: 2, areas: [], marks: [], path: [] };
let liveMap: LiveMapHandle | null = null;
let fed = 0;
let fedMarks = 0;

function heading(a: [number, number], b: [number, number]): number {
  // The model's convention: heading h faces (-sin h, cos h).
  return (Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180) / Math.PI;
}

function showAt(t: number) {
  const doc = stateAt(log, t);
  handle.setDocument(doc);
  if (!liveMap) {
    try {
      liveMap = createLiveMap({
        document: empty,
        settings: { idPrefix: 'live-' },
      });
      liveMap.setTracking('good');
    } catch {
      liveMap = null;
    }
    fed = 0;
    fedMarks = 0;
  }
  while (fed < points.length && points[fed][0] <= t) {
    const [logMs, x, y] = points[fed++];
    liveMap?.push({ logMs, x, y });
    while (fedMarks < marks.length && marks[fedMarks].logMs <= logMs)
      liveMap?.mark(marks[fedMarks++]);
  }
  const line = doc.path[doc.path.length - 1]?.points ?? [];
  const at = line[line.length - 1];
  const before = line[Math.max(0, line.length - 3)];
  const person: ShopMapPerson | undefined = at
    ? { x: at[0], y: at[1], heading: before ? heading(before, at) : 0 }
    : undefined;
  const snapshot = liveMap?.snapshot() ?? {
    walkedCells: [],
    suggestions: [],
    sectionRun: null,
    events: [],
  };
  handle.setLive({ snapshot, person });
  say(
    `${Math.round(t / 1000)} s of ${Math.round(endMs / 1000)} s` +
      (liveMap
        ? `, ${snapshot.suggestions.length} suggestions`
        : ', live map not built yet')
  );
}

let timer = 0;
const replay = $<HTMLButtonElement>('#replay');
replay.addEventListener('click', () => {
  if (timer) {
    clearInterval(timer);
    timer = 0;
    replay.textContent = 'Replay';
    handle.setLive(null);
    handle.setDocument(baseDocument);
    return;
  }
  setLook('mapper');
  liveMap = null;
  let t = 0;
  replay.textContent = 'Stop';
  timer = window.setInterval(() => {
    t = Math.min(endMs, t + 10_000);
    showAt(t);
    if (t >= endMs) {
      clearInterval(timer);
      timer = 0;
      replay.textContent = 'Replay';
    }
  }, 80);
});

if (sample && params.get('live')) handle.setLive(sampleLive);

const startAt = Number(params.get('t'));
if (Number.isFinite(startAt) && startAt > 0) showAt(startAt * 1000);

const fadedAt = Number(params.get('faded'));
if (Number.isFinite(fadedAt) && fadedAt > 0)
  handle.setFadedAfter(fadedAt * 1000, log);

// `?zoom=3` zooms in by that factor around `?at=x,y` (metres), for screenshots.
const zoom = Number(params.get('zoom'));
if (Number.isFinite(zoom) && zoom > 1) {
  const svgEl = document.querySelector('#map svg') as SVGSVGElement;
  const r = svgEl.getBoundingClientRect();
  const [ax, ay] = (params.get('px') ?? '0.5,0.5').split(',').map(Number);
  svgEl.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: -Math.log(zoom) / 0.0015,
      clientX: r.left + r.width * ax,
      clientY: r.top + r.height * ay,
      cancelable: true,
    })
  );
}

const select = params.get('select');
if (select) handle.setSelected(select);

// For the frame time measurement: the handle, reachable from a script.
(window as unknown as { shopMap: typeof handle }).shopMap = handle;
frame.dataset['ready'] = 'true';
