import type {
  AreaKind,
  MapArea,
  ShopMapDocumentV2,
  ShopperView,
  WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  shopperView,
  stateAt,
  validateShopMapV2,
} from '@portfolio/luna-shopper/shop-map/model';
import type { DrawTarget, Positioner } from './draw';
import {
  defaultLabelOf,
  defaultSizeLabel,
  drawArea,
  drawBadge,
  drawEntrance,
  drawLabel,
  drawMarkPin,
  drawNote,
  drawPerson,
  drawSizeTag,
  placeRect,
  screenBox,
  walkwayPath,
} from './draw';
import {
  areaAt,
  boxOf,
  CELL_METRES,
  cellBoxes,
  cellKey,
  cellsPath,
  contains,
  corners,
  movedBox,
  round2,
  snapBox,
  snapPoint,
  unionBox,
  walkedCellsOfPath,
} from './geometry';
import { px, svg } from './svg';
import { shopMapCss } from './theme';
import type {
  MountOptions,
  ShopMapBadge,
  ShopMapHandle,
  ShopMapLive,
  ShopMapLook,
} from './types';
import type { Box, View } from './viewport';
import {
  clampPan,
  fitView,
  scaleRange,
  toScreen,
  toWorld,
  zoomAt,
} from './viewport';

/** A long press is this long without moving more than {@link SLOP_PX}. */
export const LONG_PRESS_MS = 450;
export const SLOP_PX = 8;
/** Two taps this close in time and space are a double tap, which zooms in. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** A resize handle's touch target, in css pixels. The square drawn is 16. */
export const HANDLE_HIT_PX = 36;
/** The resize handle's drawn square, in css pixels. */
export const HANDLE_GLYPH_PX = 16;
/** How long a refused draw, move or resize stays in the refusal colour. */
const REFUSED_MS = 900;

const STYLE_ID = 'shop-map-editor-styles';
let mounts = 0;

function ensureStyle(doc: Document): () => void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = shopMapCss();
    doc.head.appendChild(style);
    style.dataset['refs'] = '0';
  }
  style.dataset['refs'] = `${Number(style.dataset['refs'] ?? 0) + 1}`;
  const owned = style;
  return () => {
    const refs = Number(owned.dataset['refs'] ?? 1) - 1;
    owned.dataset['refs'] = `${refs}`;
    if (refs <= 0) owned.remove();
  };
}

type Target =
  | { type: 'handle'; corner: number; area: MapArea }
  | { type: 'selected'; area: MapArea }
  | { type: 'area'; area: MapArea }
  | { type: 'suggestion'; id: string }
  | { type: 'floor' };

interface Pointer {
  x: number;
  y: number;
}

type Gesture =
  | {
      kind: 'pending';
      id: number;
      start: Pointer;
      target: Target;
      timer: ReturnType<typeof setTimeout> | null;
    }
  | { kind: 'draw'; id: number; from: [number, number] }
  | { kind: 'move'; id: number; area: MapArea; from: [number, number] }
  | { kind: 'resize'; id: number; area: MapArea; fixed: [number, number] }
  | { kind: 'pan'; id: number; last: Pointer }
  | {
      kind: 'pinch';
      ids: [number, number];
      view: View;
      centre: Pointer;
      distance: number;
    }
  | { kind: 'done' };

/** Whether an area reads the same, whatever order its keys were written in. */
function sameArea(a: MapArea | undefined, b: MapArea): boolean {
  if (!a) return false;
  const colour = (c: MapArea['colour']) =>
    c.mode === 'custom' ? c.value : c.mode;
  return (
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.section === b.section &&
    a.label === b.label &&
    colour(a.colour) === colour(b.colour) &&
    a.origin === b.origin
  );
}

/** A draw, move or resize in progress, drawn above the map until it is committed. */
interface Draft {
  box: Box;
  kind: AreaKind;
  /** The area it replaces, for a move or a resize. */
  replaces: MapArea | null;
  refused: boolean;
}

/**
 * Mounts the shop map canvas in `host` (editor plan 0001, section 1): one SVG
 * in either look, fitted on mount, with the gestures of section 3 in the
 * mapper look. The host draws every menu, sheet and word around it.
 */
export function mountShopMap(
  host: HTMLElement,
  options: MountOptions
): ShopMapHandle {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const id = `sm${++mounts}`;
  const releaseStyle = ensureStyle(doc);
  const labelOf = options.labelOf ?? defaultLabelOf;
  const sizeLabel = options.sizeLabel ?? defaultSizeLabel;
  const suggestionLabel = options.suggestionLabel ?? 'Shelf?';
  let idCounter = 0;
  const createId =
    options.createId ??
    (() =>
      win?.crypto?.randomUUID?.() ??
      `area-${Date.now().toString(36)}-${++idCounter}`);

  let map: ShopMapDocumentV2 = options.document;
  let look: ShopMapLook = options.look;
  let live: ShopMapLive | null = null;
  let fadedAfter: number | null = null;
  let fadedLog: readonly WalkEntry[] | undefined;
  let badges: Record<string, ShopMapBadge> = {};
  let selectedId: string | null = null;
  let snap = false;
  let drawKind: AreaKind = 'shelf';
  let shopper: ShopperView | null = null;
  let draft: Draft | null = null;
  let refusedTimer: ReturnType<typeof setTimeout> | null = null;
  let held: [number, number] | null = null;

  let view: View = { s: 56, tx: 0, ty: 0 };
  let width = 0;
  let height = 0;
  /** True until the person zooms or pans, so a growing map keeps fitting. */
  let fitted = true;
  let positioners: Positioner[] = [];
  /** The draft's own, so a move redraws the draft and nothing else. */
  let draftPositioners: Positioner[] = [];
  let frame = 0;
  let destroyed = false;

  // The canvas.
  const root = doc.createElement('div');
  root.className = 'sm-root';
  const canvas = svg(doc, 'svg', { role: 'img' }, root);
  const defs = svg(doc, 'defs', {}, canvas);
  const grid = svg(
    doc,
    'pattern',
    { id: `${id}-grid`, patternUnits: 'userSpaceOnUse' },
    defs
  );
  const gridLines = svg(doc, 'path', { class: 'sm-grid-line' }, grid);
  const dots = svg(
    doc,
    'pattern',
    { id: `${id}-dots`, patternUnits: 'userSpaceOnUse' },
    defs
  );
  const dotsBase = svg(
    doc,
    'rect',
    { class: 'sm-walkway-base', x: 0, y: 0 },
    dots
  );
  const dot = svg(doc, 'circle', { class: 'sm-walkway-dot' }, dots);
  const hatch = svg(
    doc,
    'pattern',
    {
      id: `${id}-hatch`,
      patternUnits: 'userSpaceOnUse',
      width: 12,
      height: 12,
      patternTransform: 'rotate(45)',
    },
    defs
  );
  svg(
    doc,
    'rect',
    {
      class: 'sm-sug-stripe',
      x: 0,
      y: 0,
      width: 12,
      height: 12,
      'fill-opacity': 0.2,
    },
    hatch
  );
  svg(
    doc,
    'rect',
    { class: 'sm-sug-stripe', x: 0, y: 0, width: 6, height: 12 },
    hatch
  );

  const ground = svg(doc, 'rect', { class: 'sm-ground', x: 0, y: 0 }, canvas);
  const under = svg(doc, 'g', {}, canvas);
  const gridRect = svg(
    doc,
    'rect',
    { x: 0, y: 0, fill: `url(#${id}-grid)`, 'pointer-events': 'none' },
    canvas
  );
  const over = svg(doc, 'g', {}, canvas);
  const screen = svg(doc, 'g', {}, canvas);
  const gestureLayer = svg(doc, 'g', {}, canvas);
  host.appendChild(root);

  /**
   * The closest `data-theme` on the host or an ancestor chooses the theme,
   * copied onto the root as `data-sm-theme`. A stylesheet alone cannot say
   * "closest": `[data-theme="day"] .sm-root` and `[data-theme="night"] .sm-root`
   * weigh the same, so a Day host inside a Night page drew Night.
   */
  function applyTheme(): void {
    const found = host.closest('[data-theme]')?.getAttribute('data-theme');
    const theme = found === 'day' || found === 'night' ? found : null;
    // Unchanged is left alone, so no style is recalculated for nothing.
    if (root.getAttribute('data-sm-theme') === theme) return;
    if (theme) root.setAttribute('data-sm-theme', theme);
    else root.removeAttribute('data-sm-theme');
  }
  applyTheme();
  const themeWatch = win?.MutationObserver
    ? new win.MutationObserver(applyTheme)
    : null;
  themeWatch?.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
    subtree: true,
  });

  // Bounds and hit testing.
  const shopperOf = () => (shopper ??= shopperView(map));

  function bounds(): Box {
    if (look === 'shopper') return shopperOf().bounds;
    const cells = live
      ? cellBoxes(live.snapshot.walkedCells.map((c) => cellKey(c.x, c.y)))
      : [];
    const points: [number, number][] = [];
    for (const line of map.path) for (const p of line.points) points.push(p);
    for (const m of map.marks) points.push([m.x, m.y]);
    if (live?.person) points.push([live.person.x, live.person.y]);
    for (const p of live?.unconfirmed ?? []) points.push(p);
    return unionBox(
      [...map.areas, ...cells, ...(live?.snapshot.suggestions ?? [])],
      points
    );
  }

  const range = () => scaleRange(bounds(), width, height);

  function measure(): void {
    const r = root.getBoundingClientRect();
    width = r.width;
    height = r.height;
  }

  function local(e: { clientX: number; clientY: number }): Pointer {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const selectedArea = () =>
    selectedId === null
      ? null
      : (map.areas.find((a) => a.id === selectedId) ?? null);

  function hitTest(p: Pointer): Target {
    const [wx, wy] = toWorld(view, p.x, p.y);
    if (look === 'shopper') {
      const a = areaAt(map.areas, wx, wy, (x) => x.kind === 'path');
      return a ? { type: 'area', area: a } : { type: 'floor' };
    }
    const sel = selectedArea();
    if (sel) {
      // A handle is hit by where the press lands, not by the area's size.
      // Outside the area, the whole touch target grabs the handle. Inside it,
      // only the drawn square does, and the rest is the body, so a shelf a
      // few pixels deep can still be both moved and resized at any zoom.
      const inside = contains(sel, wx, wy);
      const reach = inside ? HANDLE_GLYPH_PX / 2 : HANDLE_HIT_PX / 2;
      const cs = corners(sel);
      for (let i = 0; i < 4; i++) {
        const [sx, sy] = toScreen(view, cs[i][0], cs[i][1]);
        if (Math.abs(sx - p.x) <= reach && Math.abs(sy - p.y) <= reach) {
          return { type: 'handle', corner: i, area: sel };
        }
      }
      if (inside) return { type: 'selected', area: sel };
    }
    for (const s of live?.snapshot.suggestions ?? []) {
      if (contains(s, wx, wy)) return { type: 'suggestion', id: s.id };
    }
    const a = areaAt(map.areas, wx, wy, (x) => x.kind === 'path');
    return a ? { type: 'area', area: a } : { type: 'floor' };
  }

  // Drawing.
  function place(): void {
    frame = 0;
    if (destroyed) return;
    const { s, tx, ty } = view;
    const transform = `matrix(${s} 0 0 ${s} ${px(tx)} ${px(ty)})`;
    under.setAttribute('transform', transform);
    over.setAttribute('transform', transform);
    for (const node of [ground, gridRect]) {
      node.setAttribute('width', `${Math.max(width, 0)}`);
      node.setAttribute('height', `${Math.max(height, 0)}`);
    }
    const c = CELL_METRES * s;
    const mod = (n: number) => ((n % c) + c) % c;
    grid.setAttribute('width', `${c}`);
    grid.setAttribute('height', `${c}`);
    grid.setAttribute('x', `${px(mod(tx))}`);
    grid.setAttribute('y', `${px(mod(ty))}`);
    gridLines.setAttribute('d', `M0 0.5H${c}M0.5 0V${c}`);
    gridRect.setAttribute(
      'opacity',
      c < 6 ? '0' : c < 10 ? `${(c - 6) / 4}` : '1'
    );
    // The walkway's dots stay 10 css pixels apart at every zoom.
    const d = 10 / s;
    dots.setAttribute('width', `${d}`);
    dots.setAttribute('height', `${d}`);
    dotsBase.setAttribute('width', `${d}`);
    dotsBase.setAttribute('height', `${d}`);
    dot.setAttribute('cx', `${d / 2}`);
    dot.setAttribute('cy', `${d / 2}`);
    dot.setAttribute('r', `${1.3 / s}`);
    for (const position of positioners) position(view);
    for (const position of draftPositioners) position(view);
  }

  function schedulePlace(): void {
    if (frame || destroyed) return;
    if (win?.requestAnimationFrame) frame = win.requestAnimationFrame(place);
    else place();
  }

  function setView(next: View, byPerson: boolean): void {
    view = clampPan(next, bounds(), width, height);
    if (byPerson) fitted = false;
    schedulePlace();
  }

  function fit(): void {
    measure();
    view = fitView(bounds(), width, height);
    fitted = true;
  }

  function faded(): { areaIds: Set<string>; before: ShopMapDocumentV2 | null } {
    if (fadedAfter === null || !fadedLog)
      return { areaIds: new Set(), before: null };
    const before = stateAt([...fadedLog], fadedAfter);
    const kept = new Map(before.areas.map((a) => [a.id, a]));
    const areaIds = new Set(
      map.areas.filter((a) => !sameArea(kept.get(a.id), a)).map((a) => a.id)
    );
    return { areaIds, before };
  }

  function rebuild(): void {
    for (const layer of [under, over, screen, gestureLayer]) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    positioners = [];
    const t: DrawTarget = { doc, parent: screen, positioners };
    const mapper = look === 'mapper';
    ground.setAttribute('display', mapper ? 'inline' : 'none');
    gridRect.setAttribute('display', mapper ? 'inline' : 'none');
    const hidden = draft?.replaces?.id;
    if (mapper) drawMapper(t, hidden);
    else drawShopper(t);
    drawGesture();
    place();
  }

  function drawMapper(t: DrawTarget, hidden: string | undefined): void {
    const fade = faded();
    const cells = walkedCellsOfPath(map.path);
    for (const c of live?.snapshot.walkedCells ?? [])
      cells.add(cellKey(c.x, c.y));
    const pathAreas = map.areas.filter((a) => a.kind === 'path');
    const walkedLayer = (
      into: Element,
      of: Set<string>,
      areas: MapArea[],
      className: string
    ) => {
      const g = svg(doc, 'g', { class: className }, into);
      svg(
        doc,
        'path',
        {
          class: 'sm-walked',
          d: cellsPath(of),
          'shape-rendering': 'crispEdges',
        },
        g
      );
      for (const a of areas)
        svg(
          doc,
          'rect',
          { class: 'sm-walked', x: a.x, y: a.y, width: a.w, height: a.h },
          g
        );
    };
    if (fade.before) {
      walkedLayer(under, cells, pathAreas, 'sm-faded');
      const before = walkedCellsOfPath(fade.before.path);
      walkedLayer(
        under,
        before,
        fade.before.areas.filter((a) => a.kind === 'path'),
        ''
      );
    } else {
      walkedLayer(under, cells, pathAreas, '');
    }

    if (live?.unconfirmed?.length) {
      const pts = live.unconfirmed;
      svg(
        doc,
        'path',
        {
          class: 'sm-unconfirmed',
          d: `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}`,
          'stroke-width': CELL_METRES,
        },
        over
      );
      const ring = svg(doc, 'circle', { class: 'sm-resume', r: 10 }, screen);
      const [x0, y0] = pts[0];
      positioners.push((v) => {
        const [x, y] = toScreen(v, x0, y0);
        ring.setAttribute('cx', `${px(x)}`);
        ring.setAttribute('cy', `${px(y)}`);
      });
    }

    for (const a of map.areas) {
      if (a.kind === 'path' || a.id === hidden) continue;
      const fadedClass = fade.areaIds.has(a.id) ? ' sm-faded' : '';
      drawArea(t, a, `sm-area sm-${a.kind}${fadedClass}`, 3);
      if (a.kind === 'shelf' || a.kind === 'counter' || a.kind === 'checkout') {
        drawLabel(t, a, labelOf(a), `sm-label sm-${a.kind}${fadedClass}`);
      }
    }

    for (const s of live?.snapshot.suggestions ?? []) {
      const node = svg(
        doc,
        'rect',
        { class: 'sm-sug', fill: `url(#${id}-hatch)` },
        screen
      );
      positioners.push((v) => placeRect(node, screenBox(v, s), 1, 3));
      drawLabel(t, s, suggestionLabel, 'sm-sug-label');
    }

    for (const m of map.marks) {
      drawMarkPin(t, m, fadedAfter !== null && m.logMs > fadedAfter);
    }

    if (live?.person) drawPerson(t, live.person);

    const sel = selectedArea();
    if (sel && !draft) drawSelection(t, sel);

    if (held) {
      const node = svg(doc, 'rect', { class: 'sm-held' }, screen);
      const cell = {
        x: Math.floor(held[0] / CELL_METRES) * CELL_METRES,
        y: Math.floor(held[1] / CELL_METRES) * CELL_METRES,
        w: CELL_METRES,
        h: CELL_METRES,
      };
      positioners.push((v) => placeRect(node, screenBox(v, cell), 1, 2));
    }
  }

  function drawSelection(t: DrawTarget, box: Box): void {
    const outline = svg(doc, 'rect', { class: 'sm-selected' }, t.parent);
    t.positioners.push((v) => placeRect(outline, screenBox(v, box), -1.5, 4));
    const handles = corners(box).map(() => {
      const g = svg(doc, 'g', {}, t.parent);
      svg(
        doc,
        'rect',
        {
          class: 'sm-hit',
          x: -HANDLE_HIT_PX / 2,
          y: -HANDLE_HIT_PX / 2,
          width: HANDLE_HIT_PX,
          height: HANDLE_HIT_PX,
        },
        g
      );
      svg(
        doc,
        'rect',
        {
          class: 'sm-handle',
          x: -HANDLE_GLYPH_PX / 2,
          y: -HANDLE_GLYPH_PX / 2,
          width: HANDLE_GLYPH_PX,
          height: HANDLE_GLYPH_PX,
          rx: 3,
        },
        g
      );
      return g;
    });
    t.positioners.push((v) => {
      corners(box).forEach(([x, y], i) => {
        const [sx, sy] = toScreen(v, x, y);
        handles[i].setAttribute('transform', `translate(${px(sx)} ${px(sy)})`);
      });
    });
    drawSizeTag(t, box, sizeLabel(round2(box.w), round2(box.h)), () => height);
  }

  function drawShopper(t: DrawTarget): void {
    const sv = shopperOf();
    svg(
      doc,
      'path',
      { d: walkwayPath(sv), 'fill-rule': 'evenodd', fill: `url(#${id}-dots)` },
      under
    );
    const hasBadges = Object.keys(badges).length > 0;
    const badged = new Set<string>();
    for (const a of sv.areas) {
      if (a.kind === 'entrance') continue;
      drawArea(t, a, 'sm-area', 6);
      if (a.kind === 'blocked') continue;
      const full = map.areas.find((x) => x.id === a.id);
      const text = full ? labelOf(full) : (a.label ?? a.section ?? '');
      const dim =
        hasBadges && (a.section === undefined || !(a.section in badges));
      drawLabel(t, a, text, `sm-label${dim ? ' sm-dim' : ''}`);
    }
    for (const a of sv.areas) {
      const badge = a.section !== undefined ? badges[a.section] : undefined;
      if (!badge || badged.has(a.section as string)) continue;
      badged.add(a.section as string);
      drawBadge(t, a, badge);
    }
    for (const n of sv.notes) drawNote(t, n);
    for (const a of sv.areas) {
      if (a.kind !== 'entrance') continue;
      const full = map.areas.find((x) => x.id === a.id);
      drawEntrance(t, a, sv.bounds, full ? labelOf(full) : (a.label ?? ''));
    }
  }

  /** The draft of a gesture, redrawn on every move without rebuilding the map. */
  function drawGesture(): void {
    while (gestureLayer.firstChild)
      gestureLayer.removeChild(gestureLayer.firstChild);
    draftPositioners = [];
    if (!draft) return;
    const box = draft.box;
    const t: DrawTarget = {
      doc,
      parent: gestureLayer,
      positioners: draftPositioners,
    };
    const colour = draft.replaces?.colour ?? { mode: 'default' as const };
    const node = drawArea(
      t,
      { ...box, colour },
      `sm-area sm-${draft.kind}${draft.refused ? ' sm-refused' : ''}`,
      3
    );
    if (draft.refused) node.removeAttribute('style');
    if (draft.replaces && !draft.refused) {
      drawLabel(
        t,
        box,
        labelOf({ ...draft.replaces, ...box }),
        `sm-label sm-${draft.kind}`
      );
    }
    drawSelection(t, box);
    for (const position of draftPositioners) position(view);
  }

  // Edits.
  function refusedFor(candidate: MapArea): boolean {
    const areas = map.areas
      .filter((a) => a.id !== candidate.id)
      .concat(candidate);
    return validateShopMapV2({ ...map, areas }).some(
      (p) => p.id === candidate.id || p.otherId === candidate.id
    );
  }

  function candidateOf(d: Draft): MapArea {
    const base: MapArea = d.replaces ?? {
      id: '__draft__',
      kind: d.kind,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      colour: { mode: 'default' },
      origin: 'drawn',
    };
    return { ...base, x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h };
  }

  function updateDraft(
    box: Box,
    kind: AreaKind,
    replaces: MapArea | null
  ): void {
    const next: Draft = { box, kind, replaces, refused: false };
    next.refused = refusedFor(candidateOf(next));
    const hadDraft = draft !== null;
    draft = next;
    // The first frame of a draft hides the area it replaces and the old selection.
    if (!hadDraft) rebuild();
    else drawGesture();
  }

  function commitDraft(): void {
    const d = draft;
    if (!d) return;
    if (d.refused || d.box.w <= 0 || d.box.h <= 0) {
      if (!d.refused) {
        draft = null;
        rebuild();
        return;
      }
      if (refusedTimer) clearTimeout(refusedTimer);
      refusedTimer = setTimeout(() => {
        refusedTimer = null;
        draft = null;
        rebuild();
      }, REFUSED_MS);
      return;
    }
    const area: MapArea = d.replaces
      ? { ...d.replaces, ...d.box }
      : { ...candidateOf(d), id: createId() };
    draft = null;
    map = {
      ...map,
      areas: d.replaces
        ? map.areas.map((a) => (a.id === area.id ? area : a))
        : [...map.areas, area],
    };
    shopper = null;
    const isNew = !d.replaces;
    selectedId = area.id;
    rebuild();
    options.onChange?.([{ type: 'area-put', area }]);
    if (isNew) options.onSelect?.(area);
  }

  function clearDraft(): void {
    if (!draft) return;
    draft = null;
    rebuild();
  }

  // Gestures.
  const pointers = new Map<number, Pointer>();
  let gesture: Gesture | null = null;
  let lastTap: { at: number; p: Pointer } | null = null;

  function endPending(): void {
    if (gesture?.kind === 'pending' && gesture.timer)
      clearTimeout(gesture.timer);
  }

  function startPinch(): void {
    endPending();
    clearDraft();
    const [a, b] = [...pointers.entries()];
    gesture = {
      kind: 'pinch',
      ids: [a[0], b[0]],
      view,
      centre: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
      distance: Math.max(Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y), 1),
    };
  }

  function onDown(e: PointerEvent): void {
    if (
      e.pointerType === 'mouse' &&
      e.button !== 0 &&
      e.button !== 1 &&
      e.button !== 2
    )
      return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture?.(e.pointerId);
    // A refused draft still on screen goes at once, and a refused move or
    // resize draws its area back where it was: the full rebuild does both.
    let redraw = false;
    if (refusedTimer) {
      clearTimeout(refusedTimer);
      refusedTimer = null;
      draft = null;
      redraw = true;
    }
    if (held) {
      held = null;
      redraw = true;
    }
    if (redraw) rebuild();
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    const pansWithMouse = e.pointerType === 'mouse' && e.button !== 0;
    if (pansWithMouse) {
      gesture = { kind: 'pan', id: e.pointerId, last: p };
      return;
    }
    const target = hitTest(p);
    const g: Gesture = {
      kind: 'pending',
      id: e.pointerId,
      start: p,
      target,
      timer: null,
    };
    if (look === 'mapper') {
      g.timer = setTimeout(() => {
        if (gesture !== g) return;
        gesture = { kind: 'done' };
        const [wx, wy] = toWorld(view, p.x, p.y);
        const area =
          target.type === 'area' || target.type === 'selected'
            ? target.area
            : null;
        held = [wx, wy];
        rebuild();
        options.onLongPress?.({ x: round2(wx), y: round2(wy) }, area, {
          x: e.clientX,
          y: e.clientY,
        });
      }, LONG_PRESS_MS);
    }
    gesture = g;
  }

  function onMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      const a = pointers.get(g.ids[0]);
      const b = pointers.get(g.ids[1]);
      if (!a || !b) return;
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const distance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const [lo, hi] = range();
      const s = Math.min(hi, Math.max(lo, (g.view.s * distance) / g.distance));
      const [wx, wy] = toWorld(g.view, g.centre.x, g.centre.y);
      setView({ s, tx: centre.x - wx * s, ty: centre.y - wy * s }, true);
      return;
    }
    if ('id' in g && g.id !== e.pointerId) return;
    if (g.kind === 'pending') {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= SLOP_PX) return;
      endPending();
      const from = toWorld(view, g.start.x, g.start.y);
      if (look === 'shopper')
        gesture = { kind: 'pan', id: g.id, last: g.start };
      else if (g.target.type === 'handle') {
        const fixed = corners(g.target.area)[(g.target.corner + 2) % 4];
        gesture = { kind: 'resize', id: g.id, area: g.target.area, fixed };
      } else if (g.target.type === 'selected') {
        gesture = { kind: 'move', id: g.id, area: g.target.area, from };
      } else if (g.target.type === 'floor') {
        gesture = { kind: 'draw', id: g.id, from };
      } else gesture = { kind: 'done' };
    }
    const next = gesture;
    if (!next) return;
    const [wx, wy] = toWorld(view, p.x, p.y);
    if (next.kind === 'pan') {
      setView(
        {
          ...view,
          tx: view.tx + p.x - next.last.x,
          ty: view.ty + p.y - next.last.y,
        },
        true
      );
      next.last = p;
    } else if (next.kind === 'draw') {
      updateDraft(
        snapBox(boxOf(next.from[0], next.from[1], wx, wy), snap),
        drawKind,
        null
      );
    } else if (next.kind === 'move') {
      updateDraft(
        movedBox(next.area, wx - next.from[0], wy - next.from[1], snap),
        next.area.kind,
        next.area
      );
    } else if (next.kind === 'resize') {
      // Only the corner being dragged snaps; the one held still stays where it was.
      const [cx, cy] = snapPoint(wx, wy, snap);
      updateDraft(
        snapBox(boxOf(next.fixed[0], next.fixed[1], cx, cy), false),
        next.area.kind,
        next.area
      );
    }
  }

  function tap(
    g: Extract<Gesture, { kind: 'pending' }>,
    e: PointerEvent
  ): void {
    const now = e.timeStamp || Date.now();
    if (
      lastTap &&
      now - lastTap.at <= DOUBLE_TAP_MS &&
      Math.hypot(g.start.x - lastTap.p.x, g.start.y - lastTap.p.y) <=
        DOUBLE_TAP_PX
    ) {
      lastTap = null;
      setView(zoomAt(view, 2, g.start.x, g.start.y, range()), true);
      return;
    }
    lastTap = { at: now, p: g.start };
    const target = g.target;
    if (look === 'shopper') {
      if (target.type === 'area' && target.area.section !== undefined) {
        options.onSection?.(target.area.section);
      }
      return;
    }
    if (target.type === 'area') {
      selectedId = target.area.id;
      rebuild();
      options.onSelect?.(target.area);
    } else if (target.type === 'suggestion') {
      options.onSuggestion?.(target.id);
    } else if (target.type === 'floor' && selectedId !== null) {
      selectedId = null;
      rebuild();
      options.onSelect?.(null);
    }
  }

  function onUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch' || g.kind === 'done') {
      if (pointers.size === 0) gesture = null;
      else gesture = { kind: 'done' };
      return;
    }
    if (g.id !== e.pointerId) return;
    gesture = null;
    if (g.kind === 'pending') {
      endPending();
      if (e.type === 'pointerup') tap(g, e);
    } else if (g.kind === 'draw' || g.kind === 'move' || g.kind === 'resize') {
      if (e.type === 'pointerup') commitDraft();
      else clearDraft();
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.0015);
    const p = local(e);
    setView(zoomAt(view, factor, p.x, p.y, range()), true);
  }

  const onContextMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  const Observer = win?.ResizeObserver;
  const resize = Observer
    ? new Observer(() => {
        const [cx, cy] = toWorld(view, width / 2, height / 2);
        measure();
        if (fitted) fit();
        else
          view = clampPan(
            {
              s: view.s,
              tx: width / 2 - cx * view.s,
              ty: height / 2 - cy * view.s,
            },
            bounds(),
            width,
            height
          );
        schedulePlace();
      })
    : null;
  resize?.observe(root);

  fit();
  rebuild();

  /** After content changes, a map nobody has zoomed keeps fitting as it grows. */
  function changed(): void {
    if (fitted) fit();
    rebuild();
  }

  return {
    setDocument(next) {
      applyTheme();
      map = next;
      shopper = null;
      // The document the square was held over is gone, so is the square.
      held = null;
      if (selectedId !== null && !map.areas.some((a) => a.id === selectedId))
        selectedId = null;
      changed();
    },
    setLook(next) {
      applyTheme();
      if (next === look) return;
      look = next;
      clearDraftState();
      fit();
      rebuild();
    },
    setLive(next) {
      live = next;
      changed();
    },
    setFadedAfter(logMs, log) {
      fadedAfter = logMs;
      fadedLog = log;
      rebuild();
    },
    setBadges(next) {
      badges = { ...next };
      rebuild();
    },
    setSelected(areaId) {
      // Selecting the pressed area from inside onLongPress keeps the square.
      if (areaId !== selectedId) held = null;
      selectedId = areaId;
      rebuild();
    },
    clearHeld() {
      if (!held) return;
      held = null;
      rebuild();
    },
    setSnap(on) {
      snap = on;
    },
    setDrawKind(kind) {
      drawKind = kind;
    },
    fitToContent() {
      applyTheme();
      fit();
      schedulePlace();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      endPending();
      if (refusedTimer) clearTimeout(refusedTimer);
      if (frame && win?.cancelAnimationFrame) win.cancelAnimationFrame(frame);
      resize?.disconnect();
      themeWatch?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      root.remove();
      releaseStyle();
    },
  };

  function clearDraftState(): void {
    endPending();
    gesture = null;
    pointers.clear();
    draft = null;
    held = null;
  }
}
