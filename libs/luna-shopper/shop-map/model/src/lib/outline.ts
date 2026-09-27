import type { ShopMapDocument } from './types';

/** A building outline in metres: `[east, north]` from any origin. */
export interface MetricOutline {
  points: [number, number][];
}

export interface FittedOutline {
  outline: NonNullable<ShopMapDocument['outline']>;
  size: ShopMapDocument['size'];
}

/** Rounds to a whole number without ever answering `-0`. */
export function wholeCells(value: number): number {
  return Math.round(value) + 0;
}

/**
 * Turns an outline in metres into cells, rotated so its longest wall runs
 * along the grid's x axis, and the `size` that holds it. Points come out as
 * whole cells from the top left, with y growing downwards like the grid.
 *
 * `bearing` is the compass direction, in degrees clockwise from north, that
 * the grid's x axis points in the real world. It is for orientation only.
 */
export function fitOutline(
  outline: MetricOutline,
  cellMetres: number
): FittedOutline {
  const points = outline.points;
  if (points.length < 3) {
    throw new RangeError('An outline needs at least three points');
  }
  if (!(cellMetres > 0)) {
    throw new RangeError(`Metres per cell must be positive, got ${cellMetres}`);
  }

  let longest = -1;
  let theta = 0;
  for (let i = 0; i < points.length; i++) {
    const [e0, n0] = points[i];
    const [e1, n1] = points[(i + 1) % points.length];
    const length = Math.hypot(e1 - e0, n1 - n0);
    if (length > longest) {
      longest = length;
      theta = Math.atan2(n1 - n0, e1 - e0);
    }
  }
  // A wall has no direction: fold its angle into (-90, 90] degrees so the
  // same outline always turns the same way.
  if (theta > Math.PI / 2) theta -= Math.PI;
  if (theta <= -Math.PI / 2) theta += Math.PI;

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const turned = points.map(([e, n]) => [
    e * cos + n * sin,
    -e * sin + n * cos,
  ]);
  const minU = Math.min(...turned.map(([u]) => u));
  const maxV = Math.max(...turned.map(([, v]) => v));
  const cells = turned.map(
    ([u, v]) =>
      [
        wholeCells((u - minU) / cellMetres),
        wholeCells((maxV - v) / cellMetres),
      ] as [number, number]
  );

  const degrees = 90 - (theta * 180) / Math.PI;
  const bearing = Math.round((((degrees % 360) + 360) % 360) * 100) / 100;
  return {
    outline: { points: cells, bearing },
    size: {
      cols: Math.max(1, ...cells.map(([x]) => x)),
      rows: Math.max(1, ...cells.map(([, y]) => y)),
    },
  };
}
