/**
 * The mapping from metres to css pixels: `screen = world · s + t`, with +y
 * downwards on both sides. Pure, so the zoom rules are tested without a DOM.
 */
export interface View {
  /** Css pixels per metre. */
  s: number;
  tx: number;
  ty: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The closest zoom: half a metre is 28 css pixels (editor plan 0001). */
export const MAX_PX_PER_METRE = 56;

/** Css pixels kept clear around the content when fitting. */
export const FIT_PADDING_PX = 16;

export function toScreen(v: View, x: number, y: number): [number, number] {
  return [x * v.s + v.tx, y * v.s + v.ty];
}

export function toWorld(v: View, px: number, py: number): [number, number] {
  return [(px - v.tx) / v.s, (py - v.ty) / v.s];
}

/** The scale that shows all of `bounds` in a `width` by `height` viewport. */
export function fitScale(bounds: Box, width: number, height: number): number {
  const w = Math.max(width - 2 * FIT_PADDING_PX, 1);
  const h = Math.max(height - 2 * FIT_PADDING_PX, 1);
  if (bounds.w <= 0 && bounds.h <= 0) return MAX_PX_PER_METRE;
  const s = Math.min(
    bounds.w > 0 ? w / bounds.w : Infinity,
    bounds.h > 0 ? h / bounds.h : Infinity
  );
  return Number.isFinite(s) ? s : MAX_PX_PER_METRE;
}

/**
 * The zoom range: from "everything" to half a metre in 28 css pixels. A map
 * so small that everything is closer than that zooms no further in than
 * everything.
 */
export function scaleRange(
  bounds: Box,
  width: number,
  height: number
): [number, number] {
  const fit = fitScale(bounds, width, height);
  return [Math.min(fit, MAX_PX_PER_METRE), Math.max(fit, MAX_PX_PER_METRE)];
}

/** The view that shows all of `bounds`, centred. */
export function fitView(bounds: Box, width: number, height: number): View {
  const s = fitScale(bounds, width, height);
  return {
    s,
    tx: width / 2 - (bounds.x + bounds.w / 2) * s,
    ty: height / 2 - (bounds.y + bounds.h / 2) * s,
  };
}

/**
 * Zooms by `factor` keeping the metre under the css point `(px, py)` still,
 * clamped to the range.
 */
export function zoomAt(
  v: View,
  factor: number,
  px: number,
  py: number,
  range: [number, number]
): View {
  const s = Math.min(range[1], Math.max(range[0], v.s * factor));
  const [wx, wy] = toWorld(v, px, py);
  return { s, tx: px - wx * s, ty: py - wy * s };
}

/**
 * Keeps the content reachable: the centre of the viewport never leaves the
 * content's box. An empty box keeps the view as it is.
 */
export function clampPan(
  v: View,
  bounds: Box,
  width: number,
  height: number
): View {
  if (bounds.w <= 0 && bounds.h <= 0) return v;
  const [cx, cy] = toWorld(v, width / 2, height / 2);
  const x = Math.min(bounds.x + bounds.w, Math.max(bounds.x, cx));
  const y = Math.min(bounds.y + bounds.h, Math.max(bounds.y, cy));
  return { s: v.s, tx: width / 2 - x * v.s, ty: height / 2 - y * v.s };
}
