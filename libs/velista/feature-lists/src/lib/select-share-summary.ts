import type { ListPermission } from '@portfolio/velista/models';

/**
 * What somebody can do on a list, in one word, for a row that is closed (plan 0036,
 * section 5).
 *
 * Four checkboxes say what a row **can be changed to**. They are a poor way to say what
 * it **is**, which is what somebody scanning twelve rows wants, so a collapsed row shows
 * this instead and the boxes are what opening the row reveals.
 *
 * It is a pure function of the permission set, and it lives here beside the other
 * selectors rather than inside the component, because it is a rule about meaning and the
 * table below is the whole of it:
 *
 * | Effective set | Shown |
 * | --- | --- |
 * | holds `MANAGE` | `ADMIN`, alone |
 * | holds `WRITE` and `DECIDE` | both |
 * | holds `WRITE` only | `WRITE` |
 * | holds `DECIDE` only | `DECIDE` |
 * | holds `READ` only | `READ` |
 * | empty | nothing, which the row draws as "no access" in words |
 *
 * **`WRITE` and `DECIDE` together are the only pair ever shown**, because they are the
 * only two that are genuinely independent: the person who puts olive oil on the list on
 * Tuesday and the person who decides in the aisle on Saturday are two people, and
 * neither is a subset of the other. Everything else collapses to the highest thing held,
 * because everything else implies what is below it.
 *
 * `READ` is never shown beside `WRITE` or `DECIDE`. The server adds it to any non empty
 * set, so a badge every row carries says nothing about any row.
 *
 * `MANAGE` shows alone for the same reason and one more: the server expands it to all
 * four on the way in, so drawing them all would make every admin row the noisiest thing
 * on screen while saying the least. The row draws it with the label `ADMIN`, which is
 * what the app already calls this in its own copy; the enum member stays `MANAGE`
 * because `ADMIN` collides with the zone role of the same name on the wire and in the
 * database (backend plan 0036, section 2.3), and that argument does not reach a label in
 * a sheet.
 */
export function selectShareSummary(
  permissions: readonly ListPermission[]
): readonly ListPermission[] {
  const held = new Set(permissions);

  if (held.has('MANAGE')) {
    return ['MANAGE'];
  }

  const pair: ListPermission[] = [];
  if (held.has('WRITE')) {
    pair.push('WRITE');
  }
  if (held.has('DECIDE')) {
    pair.push('DECIDE');
  }
  if (pair.length > 0) {
    return pair;
  }

  return held.has('READ') ? ['READ'] : [];
}
