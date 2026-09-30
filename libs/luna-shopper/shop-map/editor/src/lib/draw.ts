import type {
  MapArea,
  MapMark,
  ShopperView,
} from '@portfolio/luna-shopper/shop-map/model';
import { darken, headingToScreenDegrees, metres } from './geometry';
import { px, svg } from './svg';
import type { ShopMapBadge, ShopMapPerson } from './types';
import type { Box, View } from './viewport';
import { toScreen } from './viewport';

/**
 * Everything drawn in css pixels: areas, labels, pins, badges and handles.
 * Each is created once per rebuild, and a positioner moves it on every zoom
 * or pan, so a frame of zooming sets attributes and creates nothing.
 */
export type Positioner = (v: View) => void;

export interface DrawTarget {
  doc: Document;
  parent: Element;
  positioners: Positioner[];
}

/** The box of a world box in css pixels. */
export function screenBox(v: View, b: Box): Box {
  const [x, y] = toScreen(v, b.x, b.y);
  return { x, y, w: b.w * v.s, h: b.h * v.s };
}

/** A rectangle whose 2 px border sits inside the box, as the mock draws it. */
export function placeRect(node: Element, b: Box, inset: number, rx: number) {
  const w = Math.max(b.w - 2 * inset, 0);
  const h = Math.max(b.h - 2 * inset, 0);
  node.setAttribute('x', `${px(b.x + inset)}`);
  node.setAttribute('y', `${px(b.y + inset)}`);
  node.setAttribute('width', `${px(w)}`);
  node.setAttribute('height', `${px(h)}`);
  node.setAttribute('rx', `${Math.min(rx, w / 2, h / 2)}`);
}

/** About how wide a label is at 12 px, without asking the layout. */
const textWidth = (text: string, size = 12) => text.length * size * 0.56;

/**
 * A label centred in a box, along its long side, hidden when the box is too
 * small to hold it at this zoom.
 */
export function drawLabel(
  t: DrawTarget,
  box: Box,
  text: string,
  className: string
): void {
  if (!text) return;
  const node = svg(t.doc, 'text', { class: className }, t.parent);
  node.textContent = text;
  // Measured once, while it is still shown; a DOM without layout answers 0.
  let measured: number | null = null;
  t.positioners.push((v) => {
    if (measured === null) {
      const length = node.getComputedTextLength?.() ?? 0;
      measured = length > 0 ? length : textWidth(text);
    }
    const b = screenBox(v, box);
    const vertical = b.h > b.w;
    const along = vertical ? b.h : b.w;
    const across = vertical ? b.w : b.h;
    const fits = across >= 14 && measured <= along - 8;
    node.setAttribute('display', fits ? 'inline' : 'none');
    if (!fits) return;
    const cx = px(b.x + b.w / 2);
    const cy = px(b.y + b.h / 2);
    node.setAttribute('x', `${cx}`);
    node.setAttribute('y', `${cy}`);
    node.setAttribute('transform', vertical ? `rotate(-90 ${cx} ${cy})` : '');
  });
}

/** A label's tag is the text plus this much on each side, and this tall. */
const TAG_PAD_PX = 6;
const TAG_HEIGHT_PX = 15;

/**
 * The drawn look's label (velista plan 0128): the text on a small tag in the
 * area's colour, so it stays readable over the drawing. A custom colour tags
 * it in that colour, with dark or light text, whichever reads better on it.
 * The tag and the text move as one group, so a frame sets two attributes.
 */
export function drawTaggedLabel(
  t: DrawTarget,
  box: Box,
  text: string,
  className: string,
  custom: { fill: string; ink: 'dark' | 'light' } | null
): void {
  if (!text) return;
  const g = svg(t.doc, 'g', { display: 'none' }, t.parent);
  const tag = svg(
    t.doc,
    'rect',
    {
      class: 'sm-label-tag',
      y: -TAG_HEIGHT_PX / 2,
      height: TAG_HEIGHT_PX,
      rx: 5,
      style: custom ? `fill:${custom.fill}` : undefined,
    },
    g
  );
  const node = svg(
    t.doc,
    'text',
    {
      class: custom ? `${className} sm-ink-${custom.ink}` : className,
      x: 0,
      y: 0,
    },
    g
  );
  node.textContent = text;
  let measured: number | null = null;
  let shown = false;
  const measure = () => {
    const length = node.getComputedTextLength?.() ?? 0;
    measured = length > 0 ? length : (measured ?? textWidth(text));
    const w = measured + 2 * TAG_PAD_PX;
    tag.setAttribute('x', `${px(-w / 2)}`);
    tag.setAttribute('width', `${px(w)}`);
  };
  /**
   * A web font that loads after the first measure changes the text's width,
   * so the tag is measured once more when the document's fonts are ready.
   * Nothing happens where `document.fonts` does not exist, or when every font
   * had loaded already.
   */
  const remeasureWhenFontsLoad = () => {
    const fonts = t.doc.fonts as FontFaceSet | undefined;
    if (!fonts?.ready || fonts.status === 'loaded') return;
    void fonts.ready.then(() => {
      if (!g.isConnected) return;
      const display = g.getAttribute('display');
      g.setAttribute('display', 'inline');
      measure();
      if (display !== null) g.setAttribute('display', display);
    });
  };
  t.positioners.push((v) => {
    const b = screenBox(v, box);
    const vertical = b.h > b.w;
    const along = vertical ? b.h : b.w;
    const across = vertical ? b.w : b.h;
    // Measured once, the first time the box is big enough to try.
    if (measured === null && across >= TAG_HEIGHT_PX) {
      g.setAttribute('display', 'inline');
      measure();
      shown = true;
      remeasureWhenFontsLoad();
    }
    const fits =
      measured !== null &&
      across >= TAG_HEIGHT_PX &&
      measured + 2 * TAG_PAD_PX <= along - 4;
    if (fits !== shown) {
      g.setAttribute('display', fits ? 'inline' : 'none');
      shown = fits;
    }
    if (!fits) return;
    const cx = px(b.x + b.w / 2);
    const cy = px(b.y + b.h / 2);
    g.setAttribute(
      'transform',
      `translate(${cx} ${cy})${vertical ? ' rotate(-90)' : ''}`
    );
  });
}

/** An area's rectangle. A custom colour is its fill with a border 40 percent darker. */
export function drawArea(
  t: DrawTarget,
  area: Pick<MapArea, 'x' | 'y' | 'w' | 'h' | 'colour'>,
  className: string,
  rx: number
): SVGRectElement {
  const node = svg(t.doc, 'rect', { class: className }, t.parent);
  if (area.colour.mode === 'custom') {
    node.setAttribute(
      'style',
      `fill:${area.colour.value};stroke:${darken(area.colour.value, 0.4)}`
    );
  }
  t.positioners.push((v) => placeRect(node, screenBox(v, area), 1, rx));
  return node;
}

/** A section or counter mark: a round pin with an arrow the way the phone pointed. */
export function drawMarkPin(t: DrawTarget, mark: MapMark, faded: boolean) {
  const g = svg(
    t.doc,
    'g',
    { class: faded ? 'sm-faded' : undefined },
    t.parent
  );
  if (mark.kind === 'note') {
    drawNoteGlyph(t.doc, g);
  } else {
    svg(t.doc, 'circle', { class: 'sm-pin', r: 13 }, g);
    svg(
      t.doc,
      'path',
      {
        class: 'sm-pin-glyph',
        d: 'M-6 0H6M1.5-4.5L6 0L1.5 4.5',
        transform: `rotate(${px(headingToScreenDegrees(mark.heading))})`,
      },
      g
    );
  }
  t.positioners.push((v) => {
    const [x, y] = toScreen(v, mark.x, mark.y);
    g.setAttribute(
      'transform',
      `translate(${px(x)} ${px(y)}) scale(${pinScale(v)})`
    );
  });
}

/** Pins are 28 css pixels from a metre in 28 pixels inwards, and shrink to 60 percent when zoomed out. */
export const pinScale = (v: View) =>
  Math.round(Math.min(1, Math.max(0.6, v.s / 28)) * 100) / 100;

/** A note pin: a rounded square with a page on it. */
export function drawNoteGlyph(doc: Document, g: Element) {
  svg(
    doc,
    'rect',
    { class: 'sm-note', x: -13, y: -13, width: 26, height: 26, rx: 7 },
    g
  );
  svg(
    doc,
    'path',
    {
      class: 'sm-note-glyph',
      d: 'M-4.5-6.5h9v13h-9z M-2.2-3H2.2M-2.2 0H2.2M-2.2 3H1',
    },
    g
  );
}

/** A note of the shopper look, placed at its point. */
export function drawNote(t: DrawTarget, at: { x: number; y: number }) {
  const g = svg(t.doc, 'g', {}, t.parent);
  drawNoteGlyph(t.doc, g);
  t.positioners.push((v) => {
    const [x, y] = toScreen(v, at.x, at.y);
    g.setAttribute(
      'transform',
      `translate(${px(x)} ${px(y)}) scale(${pinScale(v)})`
    );
  });
}

/** The walker: a dot with a view cone the way they face. */
export function drawPerson(t: DrawTarget, person: ShopMapPerson) {
  const g = svg(t.doc, 'g', {}, t.parent);
  svg(
    t.doc,
    'path',
    {
      class: 'sm-cone',
      d: 'M0 0L56-30L56 30Z',
      transform: `rotate(${px(headingToScreenDegrees(person.heading))})`,
    },
    g
  );
  svg(t.doc, 'circle', { class: 'sm-person', r: 7.5 }, g);
  t.positioners.push((v) => {
    const [x, y] = toScreen(v, person.x, person.y);
    g.setAttribute(
      'transform',
      `translate(${px(x)} ${px(y)}) scale(${pinScale(v)})`
    );
  });
}

/** A count badge on an area's top right corner, green with a tick once done. */
export function drawBadge(t: DrawTarget, area: Box, badge: ShopMapBadge) {
  const g = svg(t.doc, 'g', {}, t.parent);
  const digits = `${badge.count}`;
  const w = badge.done
    ? Math.max(30, 18 + digits.length * 7)
    : Math.max(22, digits.length * 7 + 10);
  const done = badge.done ? ' sm-done' : '';
  svg(
    t.doc,
    'rect',
    { class: `sm-badge${done}`, x: -w, y: 0, width: w, height: 22, rx: 11 },
    g
  );
  const text = svg(
    t.doc,
    'text',
    {
      class: `sm-badge-text${done}`,
      x: badge.done ? -w + 17 + digits.length * 3.5 : -w / 2,
      y: 11.5,
    },
    g
  );
  text.textContent = digits;
  if (badge.done) {
    svg(
      t.doc,
      'path',
      { class: 'sm-badge-tick', d: `M${-w + 7} 11.5l2.8 2.8l5-5.6` },
      g
    );
  }
  t.positioners.push((v) => {
    const b = screenBox(v, area);
    g.setAttribute(
      'transform',
      `translate(${px(b.x + b.w + 6)} ${px(b.y - 8)})`
    );
  });
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/** The side of the shop a box is nearest to. */
export function nearestSide(box: Box, bounds: Box): Side {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const d: [Side, number][] = [
    ['top', cy - bounds.y],
    ['right', bounds.x + bounds.w - cx],
    ['bottom', bounds.y + bounds.h - cy],
    ['left', cx - bounds.x],
  ];
  return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

const INWARD: Record<Side, number> = {
  bottom: 0,
  left: 90,
  top: 180,
  right: 270,
};

/** The entrance as a chip on its side of the shop, its arrow pointing in. */
export function drawEntrance(
  t: DrawTarget,
  area: Box,
  bounds: Box,
  text: string
) {
  const side = nearestSide(area, bounds);
  const g = svg(t.doc, 'g', {}, t.parent);
  const w = 20 + (text ? 4 + textWidth(text) : 0) + 10;
  svg(
    t.doc,
    'rect',
    {
      class: 'sm-entrance-chip',
      x: -w / 2,
      y: -14,
      width: w,
      height: 28,
      rx: 14,
    },
    g
  );
  svg(
    t.doc,
    'path',
    {
      class: 'sm-entrance-glyph',
      d: 'M0 5V-5M-4-1L0-5L4-1',
      transform: `translate(${-w / 2 + 16} 0) rotate(${INWARD[side]})`,
    },
    g
  );
  if (text) {
    const label = svg(
      t.doc,
      'text',
      { class: 'sm-entrance-text', x: -w / 2 + 26, y: 0.5 },
      g
    );
    label.textContent = text;
  }
  t.positioners.push((v) => {
    const a = screenBox(v, area);
    const s = screenBox(v, bounds);
    const cx = Math.min(
      s.x + s.w - w / 2 - 4,
      Math.max(s.x + w / 2 + 4, a.x + a.w / 2)
    );
    const cy = Math.min(s.y + s.h - 18, Math.max(s.y + 18, a.y + a.h / 2));
    g.setAttribute('transform', `translate(${px(cx)} ${px(cy)})`);
  });
}

/** The size of a selected area in metres, below it, or above when there is no room. */
export function drawSizeTag(
  t: DrawTarget,
  area: Box,
  text: string,
  height: () => number
) {
  const g = svg(t.doc, 'g', {}, t.parent);
  const w = textWidth(text, 12) + 18;
  svg(
    t.doc,
    'rect',
    { class: 'sm-tag', x: -w / 2, y: -12, width: w, height: 24, rx: 12 },
    g
  );
  const label = svg(t.doc, 'text', { class: 'sm-tag-text', x: 0, y: 0.5 }, g);
  label.textContent = text;
  t.positioners.push((v) => {
    const b = screenBox(v, area);
    const below = b.y + b.h + 32 <= height();
    const y = below ? b.y + b.h + 24 : b.y - 24;
    g.setAttribute('transform', `translate(${px(b.x + b.w / 2)} ${px(y)})`);
  });
}

export const defaultSizeLabel = (w: number, h: number) =>
  `${metres(w)} m × ${metres(h)} m`;

export const defaultLabelOf = (a: MapArea) => a.label ?? a.section ?? '';

/** The walkway rings as one path in metres, drawn with the even odd rule. */
export function walkwayPath(view: ShopperView): string {
  return view.walkway
    .map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
    .join('');
}
