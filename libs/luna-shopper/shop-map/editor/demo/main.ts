import type {
  LiveMapHandle,
  MapMark,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  createLiveMap,
  foldWalk,
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

const LOOKS: ShopMapLook[] = ['mapper', 'shopper', 'shopper-drawn'];
let look: ShopMapLook = LOOKS.find((l) => l === params.get('look')) ?? 'mapper';
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
  onMark: (mark) => say(`Mark ${mark.text || mark.kind}`),
  onArea: (area) => say(`Area ${area.section ?? area.label ?? area.kind}`),
  onNote: (note) => say(`Note ${note.text}`),
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

// Side by side (velista plan 0128): the plain shopper look on the left and
// the drawn one on the right, on the same document with the same badges.
let second: ReturnType<typeof mountShopMap> | null = null;
function setCompare(on: boolean) {
  frame.classList.toggle('compare', on);
  $<HTMLButtonElement>('#compare').setAttribute('aria-pressed', `${on}`);
  if (on && !second) {
    second = mountShopMap($<HTMLElement>('#map2'), {
      document: baseDocument,
      look: 'shopper-drawn',
      onArea: (area) =>
        say(`Area ${area.section ?? area.label ?? area.kind} (drawn)`),
    });
    second.setBadges(badges);
    setLook('shopper');
  } else if (!on && second) {
    second.destroy();
    second = null;
  }
  handle.fitToContent();
}
$<HTMLButtonElement>('#compare').addEventListener('click', () =>
  setCompare(!second)
);

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
if (params.get('compare')) setCompare(true);

// The replay: the recorded entries of the log (1 to 5) fed to the live map
// the way the recording screen feeds it, as the model's own El Jamón replay
// does. Tracking is good in both sessions, lost at the stop and suspect over
// the turned frame of the automatic resume (entry 3), which is drawn as the
// path to check until entry 4 discards it. Every suggestion is tapped 450 s in.
type Step =
  | { kind: 'point'; logMs: number; x: number; y: number; seq: number }
  | { kind: 'mark'; mark: MapMark }
  | { kind: 'left' }
  | { kind: 'entry'; seq: number; entryKind: WalkEntry['kind'] };
const steps: Step[] = [];
for (const entry of log.slice(0, 5)) {
  steps.push({ kind: 'entry', seq: entry.seq, entryKind: entry.kind });
  for (const ev of entry.events) {
    if (ev.type === 'path') {
      for (const [logMs, x, y] of ev.points)
        steps.push({ kind: 'point', logMs, x, y, seq: entry.seq });
    } else if (ev.type === 'mark-put')
      steps.push({ kind: 'mark', mark: ev.mark });
    else if (ev.type === 'section-left') steps.push({ kind: 'left' });
  }
}
const TAP_AT_MS = 450_000;

interface Replay {
  live: LiveMapHandle;
  step: number;
  seq: number;
  events: WalkEvent[];
  pending: WalkEvent[];
  unconfirmed: [number, number][];
  trail: [number, number][];
  tapped: boolean;
  t: number;
}

function startReplay(): Replay {
  const empty: ShopMapDocumentV2 = {
    version: 2,
    areas: [],
    marks: [],
    path: [],
  };
  return {
    live: createLiveMap({
      document: empty,
      settings: { idPrefix: 'live-', idSeed: 1 },
    }),
    step: 0,
    seq: 0,
    events: [],
    pending: [],
    unconfirmed: [],
    trail: [],
    tapped: false,
    t: 0,
  };
}

function heading(a: [number, number], b: [number, number]): number {
  // The model's convention: heading h faces (-sin h, cos h).
  return (Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180) / Math.PI;
}

/** Feeds the steps up to log time `t` and draws the result. True at the end. */
function advance(r: Replay, t: number): boolean {
  const { live } = r;
  while (r.step < steps.length) {
    const s = steps[r.step];
    if (s.kind === 'point' && s.logMs > t) break;
    r.step++;
    if (s.kind === 'entry') {
      // What an entry made goes to the log when it ends; entry 3 is discarded.
      r.pending.push(...live.snapshot().events);
      if (r.seq !== 3) r.events.push(...r.pending);
      r.pending = [];
      r.seq = s.seq;
      if (s.entryKind === 'stopped') live.setTracking('lost');
      if (s.entryKind === 'resumed')
        live.setTracking(s.seq === 3 ? 'suspect' : 'good');
      if (s.entryKind === 'resumed' && s.seq === 5) r.unconfirmed = [];
      continue;
    }
    if (s.kind === 'mark') live.mark(s.mark);
    else if (s.kind === 'left') live.sectionLeft();
    else {
      if (!r.tapped && s.logMs >= TAP_AT_MS) {
        r.tapped = true;
        for (const g of live.snapshot().suggestions)
          live.acceptSuggestion(g.id);
      }
      live.push({ logMs: s.logMs, x: s.x, y: s.y });
      if (s.seq === 3) r.unconfirmed.push([s.x, s.y]);
      r.trail.push([s.x, s.y]);
    }
  }
  const snapshot = live.snapshot();
  r.pending.push(...snapshot.events);
  const events = r.seq === 3 ? r.events : [...r.events, ...r.pending];
  const doc = foldWalk([
    {
      id: 'replay',
      seq: 1,
      kind: 'edited',
      at: '2026-09-29T10:42:42.258Z',
      logFrom: 0,
      logTo: 0,
      events,
    },
  ]);
  handle.setDocument(doc);
  const at = r.trail[r.trail.length - 1];
  const before = r.trail[Math.max(0, r.trail.length - 3)];
  const person: ShopMapPerson | undefined = at
    ? { x: at[0], y: at[1], heading: before ? heading(before, at) : 0 }
    : undefined;
  handle.setLive({
    snapshot,
    person,
    ...(r.unconfirmed.length > 1 ? { unconfirmed: r.unconfirmed } : {}),
  });
  say(
    `${Math.round(Math.min(t, endMs) / 1000)} s of ${Math.round(endMs / 1000)} s, ` +
      `${snapshot.suggestions.length} suggestions` +
      (snapshot.sectionRun ? `, in section ${snapshot.sectionRun.section}` : '')
  );
  return r.step >= steps.length;
}

function showAt(t: number) {
  setLook('mapper');
  advance(startReplay(), t);
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
  const r = startReplay();
  replay.textContent = 'Stop';
  timer = window.setInterval(() => {
    r.t += 10_000;
    if (advance(r, r.t)) {
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
