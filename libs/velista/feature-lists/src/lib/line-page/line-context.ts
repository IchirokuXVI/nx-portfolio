import { effect, inject, untracked, type Signal } from '@angular/core';
import {
  LineStore,
  ListStore,
  MemberNames,
  ZoneStore,
} from '@portfolio/velista/data-access';
import { listErrorEffect } from '../list-error-copy';

/**
 * Read what a page about one line needs, when nothing has read it yet (velista
 * `0135`, section 4).
 *
 * The line page, the history page and the products page all draw a line out of
 * `LineStore`, its list out of `ListStore` and its group out of `ZoneStore`. The
 * list page fills all three, so each of these pages was blank on a cold arrival
 * at its own URL: a shared link, a reload, a back from a page pushed over it.
 *
 * **Only what is not held is asked for.** A list the store already holds is left
 * alone, so arriving from the list page costs no request and drops nothing back
 * to a skeleton.
 *
 * Called from a constructor. It watches the route's ids, because the router
 * reuses a page for another line of another list.
 *
 * **The list is held live for as long as the page shows it** (velista `0169`). Its
 * line and list events reach `LineStore` through the zone room, so these pages are
 * live like the list page, and a reconnect has to read the list again for them too.
 * `LineStore` reads a held list at once and only marks the others stale, and the
 * read below runs once per list id, so without the hold a rename or a tick made
 * while the socket was down would stay off screen until the person left the page.
 */
export function loadLineContext(
  zoneId: Signal<string>,
  listId: Signal<string>
): void {
  const lines = inject(LineStore);
  const lists = inject(ListStore);
  const zones = inject(ZoneStore);
  const names = inject(MemberNames);

  effect(() => {
    const zone = zoneId();
    untracked(() => {
      if (zones.zoneById(zone) === undefined) {
        void zones.loadZone(zone);
      }
      if (lists.stateOf(zone) === 'idle') {
        void lists.load(zone);
      }
      // The names of the people of the group, for "Added by" and the history.
      void names.ensure(zone);
    });
  });

  effect((onCleanup) => {
    const list = listId();
    untracked(() => {
      if (lines.stateOf(list) === 'idle') {
        void lines.load(list);
      }
    });
    onCleanup(lines.hold(list));
  });
}

/**
 * Where a page about one line stands, from the store alone.
 *
 * - `loading`: the list was not read to the point where it can say.
 * - `failed`: the read of the lines did not answer.
 * - `gone`: the read of the lines was refused, or the list does not exist. The
 *   list page's `listErrorEffect` decides it, so the line pages and the list page
 *   say the same sentence for the same answer (velista 0156).
 * - `missing`: the list is read to its end and the line is not on it. That is a
 *   deleted line, or a line of another list, and only a backend read could tell
 *   the two apart, so the copy claims neither.
 * - `ready`: the line is held.
 *
 * Only a list read to its end can say a line is not on it, which is the rule
 * `watchLineGone` follows. Before that, a line that is absent has not arrived.
 */
export type LinePageStatus =
  | 'loading'
  | 'failed'
  | 'gone'
  | 'missing'
  | 'ready';

export function linePageStatus(
  lines: LineStore,
  listId: string,
  lineId: string
): LinePageStatus {
  if (lines.linesIn(listId).some((line) => line.id === lineId)) {
    return 'ready';
  }

  const state = lines.stateOf(listId);
  if (state === 'failed') {
    return listErrorEffect(lines.errorOf(listId), 'lines.read') === 'gone'
      ? 'gone'
      : 'failed';
  }
  return state === 'loaded' && lines.isComplete(listId) ? 'missing' : 'loading';
}
