import type {
  ShopperArea,
  ShopperView,
} from '@portfolio/luna-shopper/shop-map/model';
import { svg } from './svg';
import type { Box } from './viewport';

/**
 * The drawn shopper look (velista plan 0128): shelves with a row of products
 * along their sides, counters with a glass front, a crate for fruit and
 * vegetables, a till on a checkout and a sliding door at the entrance.
 *
 * Everything here is drawn in metres, into a group that carries the view's
 * transform, so a frame of zooming moves it with one attribute and redraws
 * nothing. The sizes are the mock's pixels at its own scale: the board draws
 * 28 css pixels to the metre (half a metre in 14, the mapper grid), so one
 * pixel of the board is {@link MOCK_PX} metres here, and the drawing grows and
 * shrinks with the map like any other object on it.
 *
 * Which area gets which drawing comes only from its kind and its section:
 * a shelf is a shelf, a counter a counter, a checkout a till and an entrance a
 * door, and an area of a fruit and vegetables section is a crate, whatever
 * its kind (see {@link isProduceSection}). Where on the area the drawing sits
 * (the aisle side of a wall shelf, the walkway side of a counter) is read from
 * the area's place in the shop.
 */

/** One css pixel of the mock's board, in metres (the board draws 28 to the metre). */
export const MOCK_PX = 1 / 28;

/** A shelf unit: the mock draws a divider every 36 px; 1.25 m is the usual gondola module. */
export const SHELF_UNIT_METRES = 1.25;

/** How far past a long side the walkway is looked for, in metres. */
export const AISLE_PROBE_METRES = 0.4;

/**
 * The first word of a section name that means fruit and vegetables, in
 * Spanish and English, without accents and in lower case. A section is a crate
 * when its name starts with one of them: `Frutería`, `Fruta y verdura`,
 * `Frutas y verduras`, `Verdulería`, `Fruit and vegetables`, `Produce`. A name
 * that only mentions fruit further on (`Zumos de fruta`, `Frutos secos`) is not.
 */
export const PRODUCE_SECTION_WORDS: readonly string[] = [
  'fruta',
  'frutas',
  'fruteria',
  'verdura',
  'verduras',
  'verduleria',
  'hortaliza',
  'hortalizas',
  'fruit',
  'fruits',
  'vegetable',
  'vegetables',
  'veg',
  'produce',
  'greengrocer',
  'greengrocery',
];

/** Whether a section is fruit and vegetables, by the first word of its name. */
export function isProduceSection(name: string | undefined): boolean {
  if (!name) return false;
  const first = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .split(/[^a-z]+/)[0];
  return PRODUCE_SECTION_WORDS.includes(first);
}

export type Drawing = 'shelf' | 'counter' | 'crate' | 'till' | 'door' | null;

/** What the drawn look draws on an area, from its kind and its section alone. */
export function drawingOf(
  area: Pick<ShopperArea, 'kind' | 'section'>
): Drawing {
  if (area.kind === 'entrance') return 'door';
  if (area.kind === 'blocked') return null;
  if (isProduceSection(area.section)) return 'crate';
  if (area.kind === 'shelf') return 'shelf';
  if (area.kind === 'counter') return 'counter';
  if (area.kind === 'checkout') return 'till';
  return null;
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Whether a point lies on the walkway, whose rings are drawn with the even odd rule. */
export function onWalkway(
  walkway: readonly (readonly [number, number])[][],
  x: number,
  y: number
): boolean {
  let inside = false;
  for (const ring of walkway) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  }
  return inside;
}

/** The two long sides of an area, top or left first. */
function longSides(a: Box): [Side, Side] {
  return a.w >= a.h ? ['top', 'bottom'] : ['left', 'right'];
}

/** Whether the walkway runs along a side: a quarter, half or three quarters along it, just outside. */
function faces(
  a: Box,
  side: Side,
  walkway: readonly (readonly [number, number])[][]
): boolean {
  const d = AISLE_PROBE_METRES;
  return [0.25, 0.5, 0.75].some((f) => {
    const x =
      side === 'left'
        ? a.x - d
        : side === 'right'
          ? a.x + a.w + d
          : a.x + a.w * f;
    const y =
      side === 'top'
        ? a.y - d
        : side === 'bottom'
          ? a.y + a.h + d
          : a.y + a.h * f;
    return onWalkway(walkway, x, y);
  });
}

/**
 * The long sides of a shelf a shopper can reach: both, unless the walkway
 * runs along only one of them, as it does beside a wall shelf.
 */
export function openLongSides(
  a: Box,
  walkway: readonly (readonly [number, number])[][]
): Side[] {
  const sides = longSides(a);
  const open = sides.filter((s) => faces(a, s, walkway));
  return open.length === 1 ? open : sides;
}

/**
 * The long side of a counter a shopper stands at: the one the walkway runs
 * along, or, when it runs along both or neither, the one farther from the
 * shop's edge.
 */
export function servedSide(
  a: Box,
  bounds: Box,
  walkway: readonly (readonly [number, number])[][]
): Side {
  const [first, second] = longSides(a);
  const open = [first, second].filter((s) => faces(a, s, walkway));
  if (open.length === 1) return open[0];
  const gapFirst = first === 'top' ? a.y - bounds.y : a.x - bounds.x;
  const gapSecond =
    first === 'top'
      ? bounds.y + bounds.h - (a.y + a.h)
      : bounds.x + bounds.w - (a.x + a.w);
  return gapFirst > gapSecond ? first : second;
}

/** The side of the shop an area is nearest to. */
function nearestEdge(a: Box, bounds: Box): Side {
  const d: [Side, number][] = [
    ['top', a.y + a.h / 2 - bounds.y],
    ['right', bounds.x + bounds.w - (a.x + a.w / 2)],
    ['bottom', bounds.y + bounds.h - (a.y + a.h / 2)],
    ['left', a.x + a.w / 2 - bounds.x],
  ];
  return d.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
}

/** A band `depth` deep inside a box along one side, `inset` in from it. */
function band(a: Box, side: Side, inset: number, depth: number): Box {
  switch (side) {
    case 'top':
      return { x: a.x, y: a.y + inset, w: a.w, h: depth };
    case 'bottom':
      return { x: a.x, y: a.y + a.h - inset - depth, w: a.w, h: depth };
    case 'left':
      return { x: a.x + inset, y: a.y, w: depth, h: a.h };
    case 'right':
      return { x: a.x + a.w - inset - depth, y: a.y, w: depth, h: a.h };
  }
}

/** Shrinks a box by `d` on every side, never below nothing. */
function shrink(a: Box, dx: number, dy = dx): Box {
  return {
    x: a.x + dx,
    y: a.y + dy,
    w: Math.max(a.w - 2 * dx, 0),
    h: Math.max(a.h - 2 * dy, 0),
  };
}

function rect(
  doc: Document,
  parent: Element,
  b: Box,
  values: Record<string, string | number>
): SVGRectElement {
  return svg(
    doc,
    'rect',
    {
      x: px4(b.x),
      y: px4(b.y),
      width: px4(b.w),
      height: px4(b.h),
      ...values,
    },
    parent
  );
}

/** Metres keep four decimals: a tenth of a millimetre. */
const px4 = (n: number) => Math.round(n * 10000) / 10000;

/** A pattern tile this long across its strip, so one tile covers any shelf. */
const ACROSS = 1000;

/**
 * The patterns and the till the drawn look uses, created once per mount in
 * `defs`, all in metres. The ids are the mount's own, so two maps on one page
 * keep theirs apart.
 */
export function drawnDefs(doc: Document, defs: Element, id: string): void {
  const m = MOCK_PX;
  // Two product rows, offset from each other as the mock's are: widths and
  // gaps in board pixels, one tile of 21 px holding three products.
  const rows: [string, [number, number, number][]][] = [
    [
      'strip-a',
      [
        [1, 0, 5],
        [2, 7, 6],
        [3, 15, 4],
      ],
    ],
    [
      'strip-b',
      [
        [2, 0, 6],
        [3, 8, 4],
        [1, 14, 5],
      ],
    ],
  ];
  for (const [name, products] of rows) {
    for (const along of ['h', 'v'] as const) {
      const h = along === 'h';
      const p = svg(
        doc,
        'pattern',
        {
          id: `${id}-${name}-${along}`,
          patternUnits: 'userSpaceOnUse',
          x: 0,
          y: 0,
          width: h ? px4(21 * m) : ACROSS,
          height: h ? ACROSS : px4(21 * m),
        },
        defs
      );
      for (const [colour, at, size] of products) {
        svg(
          doc,
          'rect',
          {
            class: `sm-product-${colour}`,
            x: h ? px4(at * m) : 0,
            y: h ? 0 : px4(at * m),
            width: h ? px4(size * m) : ACROSS,
            height: h ? ACROSS : px4(size * m),
          },
          p
        );
      }
    }
  }
  // A divider every shelf unit, 2 board pixels wide.
  for (const along of ['h', 'v'] as const) {
    const h = along === 'h';
    const p = svg(
      doc,
      'pattern',
      {
        id: `${id}-units-${along}`,
        patternUnits: 'userSpaceOnUse',
        x: 0,
        y: 0,
        width: h ? SHELF_UNIT_METRES : ACROSS,
        height: h ? ACROSS : SHELF_UNIT_METRES,
      },
      defs
    );
    svg(
      doc,
      'rect',
      {
        class: 'sm-shelf-line',
        x: h ? px4(SHELF_UNIT_METRES - 2 * m) : 0,
        y: h ? 0 : px4(SHELF_UNIT_METRES - 2 * m),
        width: h ? px4(2 * m) : ACROSS,
        height: h ? ACROSS : px4(2 * m),
      },
      p
    );
  }
  // The crate: two offset grids of 5 px dots on a 9 px tile.
  const crate = svg(
    doc,
    'pattern',
    {
      id: `${id}-crate`,
      patternUnits: 'userSpaceOnUse',
      x: 0,
      y: 0,
      width: px4(9 * m),
      height: px4(9 * m),
    },
    defs
  );
  svg(
    doc,
    'circle',
    {
      class: 'sm-product-1',
      cx: px4(4.5 * m),
      cy: px4(4.5 * m),
      r: px4(2.5 * m),
    },
    crate
  );
  for (const [cx, cy] of [
    [0, 0],
    [9, 0],
    [0, 9],
    [9, 9],
  ]) {
    svg(
      doc,
      'circle',
      { class: 'sm-crate', cx: px4(cx * m), cy: px4(cy * m), r: px4(2.5 * m) },
      crate
    );
  }
  // The till of the mock: a body with a belt, and a screen on a stand.
  const till = svg(
    doc,
    'symbol',
    { id: `${id}-till`, viewBox: '0 0 26 28' },
    defs
  );
  svg(
    doc,
    'rect',
    { class: 'sm-till', x: 1, y: 12, width: 24, height: 15, rx: 3 },
    till
  );
  svg(
    doc,
    'path',
    {
      class: 'sm-till sm-till-belt',
      d: 'M5 17h16M5 21h16',
    },
    till
  );
  svg(
    doc,
    'rect',
    { class: 'sm-till', x: 7, y: 2, width: 12, height: 8, rx: 1.5 },
    till
  );
  svg(doc, 'path', { class: 'sm-till', d: 'M13 10v2' }, till);
}

/**
 * Draws an area's drawing in metres into `parent`, a group in the view's
 * transform. The area's own rectangle, border and label are drawn by the caller.
 */
export function drawDrawing(
  doc: Document,
  parent: Element,
  area: ShopperArea,
  view: Pick<ShopperView, 'bounds' | 'walkway'>,
  id: string
): void {
  const { bounds, walkway } = view;
  const drawing = drawingOf(area);
  const m = MOCK_PX;
  // The border is 2 px inside the box; the mock's drawing starts 2 px inside it.
  const border = 2 * m;
  const across = area.w >= area.h;
  const depth = across ? area.h : area.w;
  // A shelf under the mock's 30 px keeps the mock's proportions, smaller.
  const k = Math.min(1, depth / (30 * m));
  const inner = shrink(area, border);
  if (drawing === 'shelf') {
    const sides = openLongSides(area, walkway);
    const along = across ? 'h' : 'v';
    rect(doc, parent, inner, { fill: `url(#${id}-units-${along})` });
    if (sides.length === 2) {
      const spine = across
        ? { x: inner.x, y: area.y + area.h / 2 - m, w: inner.w, h: 2 * m }
        : { x: area.x + area.w / 2 - m, y: inner.y, w: 2 * m, h: inner.h };
      rect(doc, parent, spine, { class: 'sm-shelf-line' });
    }
    sides.forEach((side, i) => {
      // The strip nearer the top or left takes the first row, as the mock does.
      const row = i === 0 ? 'strip-a' : 'strip-b';
      const b = band(
        inner,
        side,
        2 * m * k,
        (sides.length === 1 ? 6 : 5) * m * k
      );
      rect(doc, parent, b, { fill: `url(#${id}-${row}-${along})` });
    });
  } else if (drawing === 'counter') {
    const side = servedSide(area, bounds, walkway);
    const glass = band(
      shrink(inner, 2 * m),
      side,
      0,
      Math.min(9 * m, depth * 0.4)
    );
    rect(doc, parent, glass, { class: 'sm-glass', rx: px4(2 * m) });
  } else if (drawing === 'crate') {
    rect(doc, parent, shrink(inner, 2 * m), {
      fill: `url(#${id}-crate)`,
      rx: px4(4 * m),
    });
  } else if (drawing === 'till') {
    const b = shrink(inner, 1 * m);
    svg(
      doc,
      'use',
      {
        href: `#${id}-till`,
        x: px4(b.x),
        y: px4(b.y),
        width: px4(b.w),
        height: px4(b.h),
      },
      parent
    );
  } else if (drawing === 'door') {
    drawDoor(doc, parent, area, bounds);
  }
}

/** The entrance: two door leaves in the wall's gap, on the side of the shop it is nearest to. */
function drawDoor(
  doc: Document,
  parent: Element,
  area: Box,
  bounds: Box
): void {
  const m = MOCK_PX;
  const side = nearestEdge(area, bounds);
  const thick = 4 * m;
  const along = side === 'top' || side === 'bottom';
  const length = along ? area.w : area.h;
  const leaf = length * 0.45;
  const start = along ? area.x : area.y;
  const line =
    side === 'top'
      ? bounds.y
      : side === 'bottom'
        ? bounds.y + bounds.h
        : side === 'left'
          ? bounds.x
          : bounds.x + bounds.w;
  for (const from of [start, start + length - leaf]) {
    const b = along
      ? { x: from, y: line - thick / 2, w: leaf, h: thick }
      : { x: line - thick / 2, y: from, w: thick, h: leaf };
    rect(doc, parent, b, { class: 'sm-door', rx: px4(2 * m) });
  }
}

/**
 * Dark or light ink for a label on a tag of this colour, whichever reads
 * better, so a label stays readable on any custom colour in either theme.
 */
export function inkOn(hex: string): 'dark' | 'light' {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'dark';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l =
    0.2126 * lin((n >> 16) & 0xff) +
    0.7152 * lin((n >> 8) & 0xff) +
    0.0722 * lin(n & 0xff);
  // Contrast against #111420 (L 0.007) and #f7f8fc (L 0.94).
  const dark = (l + 0.05) / (0.007 + 0.05);
  const light = (0.94 + 0.05) / (l + 0.05);
  return dark >= light ? 'dark' : 'light';
}
