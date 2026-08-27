import type { Line } from '@portfolio/velista/models';
import { SEED_USER_ID } from '../zones/static-zone-data';

/**
 * Seeded lines, so **every state in `0012` section 3 is reachable with no backend**.
 *
 * The same argument the zone and group fixtures make, and it is strongest here: this
 * screen has a state for two people editing one row at the same time, and producing
 * that against a live gateway means two accounts, two browsers and timing. Against
 * this it is one call to `LineMemory.failNextWrite` or one bumped version.
 *
 * ## The counts agree with `SEED_LISTS`, deliberately
 *
 * `list-weekly` is seeded there as twelve lines with seven ready, so it is twelve lines
 * with seven ready here. The header draws its progress from the cached list summary
 * while the lines are still arriving (rule L2), and a fixture where the two disagree
 * would make the header visibly correct itself on load, which is a bug the real app
 * does not have and a developer would spend an afternoon on.
 *
 * ## Positions have gaps
 *
 * Because they do on the server: `position` is assigned on insert and a delete leaves a
 * hole rather than renumbering the rest. A fixture with contiguous positions would make
 * a partial reorder look like it worked, which is the exact failure rule L4 exists to
 * prevent (section 4.5).
 *
 * ## What each list is for
 *
 * - `list-weekly`, in the group the caller **owns** and which they created, so it is
 *   the only one where the client knows up front that they may write. It carries every
 *   row state at once: ready, not in the shop, waiting for approval, and turned down.
 * - `list-cleaning`, finished. Every line ready, which is the state that has no empty
 *   message and no work left, and it was created by somebody else.
 * - `list-sunday`, in a group where the caller is an ordinary member, which is the
 *   arrangement a `forbidden` on the first write is reachable from.
 */
export const SEED_LINES: Readonly<Record<string, readonly Line[]>> = {
  'list-weekly': [
    ready('ln-w-01', 'list-weekly', 'Sourdough loaf', 2, 1),
    ready('ln-w-02', 'list-weekly', 'Milk', 1, 2),
    ready('ln-w-03', 'list-weekly', 'Coffee beans', 1, 3),
    ready('ln-w-04', 'list-weekly', 'Olive oil', 1, 5),
    ready('ln-w-05', 'list-weekly', 'Tomatoes', 6, 6),
    ready('ln-w-06', 'list-weekly', 'Chickpeas', 3, 8),
    ready('ln-w-07', 'list-weekly', 'Greek yoghurt', 4, 9),
    todo('ln-w-08', 'list-weekly', 'Washing up liquid', 1, 11),
    // On the shelf and not there. Struck through with a caption, and pointedly not a
    // third checkbox state: there is no such thing (section 7).
    line('ln-w-09', 'list-weekly', 'Oranges', 8, 12, {
      status: 'NOT_AVAILABLE',
    }),
    // Somebody else put this on and it has not been decided. Staff see two buttons on
    // it; everybody else sees the violet edge and the caption.
    line('ln-w-10', 'list-weekly', 'Ice cream', 1, 14, {
      approvalStatus: 'PENDING',
      createdByUserId: 'user-marta',
      approvedByUserId: null,
    }),
    // Turned down and **still on the list**, sorted last by the page rather than
    // removed, because a line vanishing with no explanation is worse (section 3.4).
    line('ln-w-11', 'list-weekly', 'Energy drinks', 6, 15, {
      approvalStatus: 'REJECTED',
      createdByUserId: 'user-marta',
      approvedByUserId: SEED_USER_ID,
    }),
    todo('ln-w-12', 'list-weekly', 'Kitchen roll', 2, 17),
  ],
  'list-cleaning': [
    ready('ln-c-01', 'list-cleaning', 'Bleach', 1, 1, 'user-toni'),
    ready('ln-c-02', 'list-cleaning', 'Sponges', 6, 2, 'user-toni'),
    ready('ln-c-03', 'list-cleaning', 'Floor cleaner', 1, 4, 'user-toni'),
    ready('ln-c-04', 'list-cleaning', 'Bin bags', 2, 5, 'user-toni'),
  ],
  'list-sunday': [
    ready('ln-s-01', 'list-sunday', 'Leg of lamb', 1, 1, 'user-mum'),
    ready('ln-s-02', 'list-sunday', 'Rosemary', 1, 2, 'user-mum'),
    todo('ln-s-03', 'list-sunday', 'Potatoes', 3, 3, 'user-mum'),
    todo('ln-s-04', 'list-sunday', 'Carrots', 5, 4, 'user-mum'),
    todo('ln-s-05', 'list-sunday', 'Gravy', 1, 6, 'user-mum'),
    todo('ln-s-06', 'list-sunday', 'Red wine', 2, 7, 'user-mum'),
    todo('ln-s-07', 'list-sunday', 'Mint sauce', 1, 8, 'user-mum'),
    todo('ln-s-08', 'list-sunday', 'Cream', 1, 10, 'user-mum'),
    todo('ln-s-09', 'list-sunday', 'Apple pie', 1, 11, 'user-dad'),
  ],
};

function line(
  id: string,
  listId: string,
  content: string,
  quantity: number,
  position: number,
  overrides: Partial<Line> = {}
): Line {
  return {
    id,
    listId,
    content,
    quantity,
    position,
    // Null on every seeded line, because the catalog is out of scope and nothing this
    // screen writes sets one either (section 9).
    itemId: null,
    approvalStatus: 'APPROVED',
    status: 'PENDING',
    createdByUserId: SEED_USER_ID,
    approvedByUserId: SEED_USER_ID,
    version: 1,
    ...overrides,
  };
}

function ready(
  id: string,
  listId: string,
  content: string,
  quantity: number,
  position: number,
  createdByUserId: string = SEED_USER_ID
): Line {
  return line(id, listId, content, quantity, position, {
    status: 'READY',
    createdByUserId,
  });
}

function todo(
  id: string,
  listId: string,
  content: string,
  quantity: number,
  position: number,
  createdByUserId: string = SEED_USER_ID
): Line {
  return line(id, listId, content, quantity, position, { createdByUserId });
}
