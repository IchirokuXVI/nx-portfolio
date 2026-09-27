import type {
  StreamName,
  WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';

/** The streams a mode can read, in the order ties at one `t` are pushed. */
const REPLAYED: readonly StreamName[] = [
  'motion',
  'game',
  'absolute',
  'steps',
  'location',
  'pose',
];

/**
 * Every row of a walk, in `t` order across streams, as the live engine would have
 * seen them arrive. Used when the person switches the live mode halfway through a
 * recording, so the new mode's track starts from the beginning of the walk rather
 * than from the switch.
 *
 * Each stream is already in `t` order (section 2), so this is a k way merge, with
 * ties broken by the order above.
 */
export function replayRows(
  walk: Pick<WalkFile, 'streams'>,
  push: (stream: StreamName, row: number[] | number) => void
): void {
  const lists = REPLAYED.map((name) => ({
    name,
    rows: (walk.streams[name] ?? []) as (number[] | number)[],
    at: 0,
  })).filter((list) => list.rows.length > 0);

  const timeOf = (row: number[] | number) =>
    typeof row === 'number' ? row : row[0];

  for (;;) {
    let next: (typeof lists)[number] | null = null;
    for (const list of lists) {
      if (list.at >= list.rows.length) {
        continue;
      }
      if (
        next === null ||
        timeOf(list.rows[list.at]) < timeOf(next.rows[next.at])
      ) {
        next = list;
      }
    }
    if (next === null) {
      return;
    }
    push(next.name, next.rows[next.at]);
    next.at++;
  }
}
