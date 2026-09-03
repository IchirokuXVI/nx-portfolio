import type { Line } from '@portfolio/velista/models';
import { SEED_USER_ID } from '../zones/static-zone-data';

/**
 * Seeded lines, so **every state in `0043` section 3.2 is reachable with no backend**.
 *
 * The same argument the zone and group fixtures make, and it is strongest here: this
 * screen has a state for two people editing one row at the same time, and producing
 * that against a live gateway means two accounts, two browsers and timing. Against
 * this it is one call to `LineMemory.failNextWrite` or one bumped version.
 *
 * ## What replaced the ticks
 *
 * `0012` seeded a `status` per line and these fixtures were built around it: seven
 * lines "ready" on the weekly list, a whole list "finished". There is no trip status
 * any more, so the four states here are the ones a quantity and a history produce
 * (velista plan 0043, section 3.2), and each has a helper named after it:
 *
 * - **wanted**: `quantity > 0`. The ordinary line.
 * - **settled**: `quantity = 0` with a purchase on record. The bought indicator.
 * - **neverWanted**: `quantity = 0` with none. Somebody typed it and it has not been
 *   needed yet, and it draws **nothing**, which is the distinction the whole
 *   `boughtCount` field exists to make.
 * - **missing**: still wanted, and the last trip could not find it.
 *
 * ## The counts agree with `SEED_LISTS`, deliberately
 *
 * `list-weekly` is seeded there as twelve lines with six wanted, so it is twelve lines
 * with six wanted here. The header draws its progress from the cached list summary
 * while the lines are still arriving (rule L2), and a fixture where the two disagree
 * would make the header visibly correct itself on load, which is a bug the real app
 * does not have and a developer would spend an afternoon on.
 *
 * ## Positions have gaps
 *
 * Because they do on the server: `position` is assigned on insert and a delete leaves a
 * hole rather than renumbering the rest. A fixture with contiguous positions would make
 * a partial reorder look like it worked, which is the exact failure rule L4 exists to
 * prevent (`0012`, section 4.5).
 *
 * ## What each list is for
 *
 * - `list-weekly`, in the group the caller **owns** and which they created, so it is
 *   the only one where the client knows up front that they may write. It carries every
 *   row state at once: settled, never wanted, missing last trip, missing **and** wanted
 *   again, waiting for approval, and turned down.
 * - `list-cleaning`, fully stocked. Every line at zero with a purchase behind it, which
 *   is the state that has no empty message and no work left, and it was created by
 *   somebody else.
 * - `list-sunday`, in a group where the caller is an ordinary member and holds `READ`
 *   and nothing else, which is the read only screen of plan 0030 acceptance 1.
 * - `list-pantry`, the same group, where the caller holds `WRITE` and not `DECIDE`. It
 *   carries an approved line the caller may not touch at all, an unapproved one of their
 *   own they may edit and delete, and a rejected one, which is the whole of what `WRITE`
 *   reaches. Its rows open and its reels do not move.
 * - `list-market`, the same group, where the caller holds `DECIDE` and not `WRITE`. It
 *   carries an approved line with a quantity worth dragging down, plus one line waiting
 *   and one turned down, for the decision buttons and the restore.
 * - `list-freezer`, the same group, where the caller holds all four without being group
 *   staff. Short on purpose: it exists for the share sheet, not for its lines.
 *
 * ## Products, and why only some lines have them
 *
 * `itemIds` was null on every seeded line while the catalog was out of scope. A few
 * carry products now, because the line page's second history section is **absent**
 * rather than empty without one (section 5.3) and both shapes have to be reachable.
 * Most lines still carry none, which is honest: free text stays first class and is what
 * most lines are.
 */
export const SEED_LINES: Readonly<Record<string, readonly Line[]>> = {
  'list-weekly': [
    // Wanted again, and the shop had none last time. The combined row of the mock,
    // and the one that proves the two indicators are a list rather than a value.
    missing('ln-w-01', 'list-weekly', 'Sourdough loaf', 2, 1, { boughtCount: 3 }),
    // Settled, with a set of products behind it, so the line page has both its
    // histories and the "which one did you buy" step has something to ask.
    settled('ln-w-02', 'list-weekly', 'Milk', 2, {
      boughtCount: 4,
      itemIds: ['item-milk-hacendado', 'item-milk-pascual'],
    }),
    settled('ln-w-03', 'list-weekly', 'Coffee beans', 3, { boughtCount: 2 }),
    // One purchase only, which is what keeps the estimate off the sheet: two
    // purchases define one interval and that is a coincidence, not a rate.
    settled('ln-w-04', 'list-weekly', 'Olive oil', 5, { boughtCount: 1 }),
    wanted('ln-w-05', 'list-weekly', 'Tomatoes', 6, 6),
    settled('ln-w-06', 'list-weekly', 'Chickpeas', 8, { boughtCount: 5 }),
    settled('ln-w-07', 'list-weekly', 'Greek yoghurt', 9, { boughtCount: 3 }),
    // Zero and never bought. It draws **no** indicator at all, which is the whole
    // reason `boughtCount` is on the wire: without it this row and the settled ones
    // above are indistinguishable.
    neverWanted('ln-w-08', 'list-weekly', 'Washing up liquid', 11),
    // Missing last trip and never bought at all, so it is the not available
    // indicator with no bought one beside it.
    missing('ln-w-09', 'list-weekly', 'Oranges', 8, 12),
    // Somebody else put this on and it has not been decided. `DECIDE` holders see two
    // buttons on it; everybody else sees the violet edge and the caption.
    wanted('ln-w-10', 'list-weekly', 'Ice cream', 1, 14, {
      approvalStatus: 'PENDING',
      createdByUserId: 'user-marta',
      approvedByUserId: null,
    }),
    // Turned down and **still on the list**, sorted last by the page rather than
    // removed, because a line vanishing with no explanation is worse (`0012`, 3.4).
    wanted('ln-w-11', 'list-weekly', 'Energy drinks', 6, 15, {
      approvalStatus: 'REJECTED',
      createdByUserId: 'user-marta',
      approvedByUserId: SEED_USER_ID,
    }),
    wanted('ln-w-12', 'list-weekly', 'Kitchen roll', 2, 17),
  ],
  'list-cleaning': [
    settled('ln-c-01', 'list-cleaning', 'Bleach', 1, { createdByUserId: 'user-toni' }),
    settled('ln-c-02', 'list-cleaning', 'Sponges', 2, { createdByUserId: 'user-toni' }),
    settled('ln-c-03', 'list-cleaning', 'Floor cleaner', 4, {
      createdByUserId: 'user-toni',
    }),
    settled('ln-c-04', 'list-cleaning', 'Bin bags', 5, {
      createdByUserId: 'user-toni',
    }),
  ],
  // `WRITE` and no `DECIDE` (see `SEED_LIST_ACCESS`). Rosa decides on this one, so
  // every row here opens and no reel on it moves.
  'list-pantry': [
    settled('ln-p-01', 'list-pantry', 'Rice', 1, { createdByUserId: 'user-mum' }),
    // Approved and therefore untouchable by `WRITE`: no edit, no delete, no reel.
    wanted('ln-p-02', 'list-pantry', 'Olive oil', 1, 2, {
      createdByUserId: 'user-mum',
    }),
    // The caller's own, still waiting. `WRITE` may edit it and delete it.
    wanted('ln-p-03', 'list-pantry', 'Tinned tomatoes', 4, 3, {
      approvalStatus: 'PENDING',
      approvedByUserId: null,
    }),
    // Turned down, and editing it puts it back to PENDING (backend plan 0036,
    // section 4.2), which is the thing that makes a rejection a conversation.
    wanted('ln-p-04', 'list-pantry', 'Crisps', 1, 5, {
      approvalStatus: 'REJECTED',
      approvedByUserId: 'user-rosa',
    }),
  ],
  // `DECIDE` and no `WRITE`. No composer, no edit entry on an unapproved row, and the
  // reel is live on every approved one.
  'list-market': [
    // Three, where the shop has one. Dragging this to 1 is the ordinary gesture now,
    // and it writes one delta of -2 rather than the remainder split `0037` used to do.
    wanted('ln-m-01', 'list-market', 'Tinned tomatoes', 3, 1, {
      createdByUserId: 'user-dad',
    }),
    settled('ln-m-02', 'list-market', 'Bread', 2, { createdByUserId: 'user-dad' }),
    wanted('ln-m-03', 'list-market', 'Coffee', 1, 4, {
      approvalStatus: 'PENDING',
      createdByUserId: 'user-rosa',
      approvedByUserId: null,
    }),
    wanted('ln-m-04', 'list-market', 'Biscuits', 2, 5, {
      approvalStatus: 'REJECTED',
      createdByUserId: 'user-rosa',
      approvedByUserId: 'user-dad',
    }),
  ],
  // All four, without being group staff. Two lines, because this list is here for the
  // share sheet rather than for anything on it.
  'list-freezer': [
    wanted('ln-f-01', 'list-freezer', 'Peas', 2, 1),
    settled('ln-f-02', 'list-freezer', 'Fish fingers', 2),
  ],
  'list-sunday': [
    settled('ln-s-01', 'list-sunday', 'Leg of lamb', 1, {
      createdByUserId: 'user-mum',
    }),
    settled('ln-s-02', 'list-sunday', 'Rosemary', 2, {
      createdByUserId: 'user-mum',
    }),
    wanted('ln-s-03', 'list-sunday', 'Potatoes', 3, 3, { createdByUserId: 'user-mum' }),
    wanted('ln-s-04', 'list-sunday', 'Carrots', 5, 4, { createdByUserId: 'user-mum' }),
    wanted('ln-s-05', 'list-sunday', 'Gravy', 1, 6, { createdByUserId: 'user-mum' }),
    wanted('ln-s-06', 'list-sunday', 'Red wine', 2, 7, { createdByUserId: 'user-mum' }),
    wanted('ln-s-07', 'list-sunday', 'Mint sauce', 1, 8, {
      createdByUserId: 'user-mum',
    }),
    wanted('ln-s-08', 'list-sunday', 'Cream', 1, 10, { createdByUserId: 'user-mum' }),
    wanted('ln-s-09', 'list-sunday', 'Apple pie', 1, 11, {
      createdByUserId: 'user-dad',
    }),
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
    // Free text, which is what most lines are and stays first class (section 6).
    itemIds: [],
    // Following no group, which is every line backend `0048` created and therefore
    // the honest default here (backend plan 0070, section 10). A seeded subscription
    // would draw provenance headings over a fixture nothing syncs.
    productGroupId: null,
    groupItemIds: [],
    approvalStatus: 'APPROVED',
    // Nothing has ever happened to it, which is the honest default and the one that
    // draws no indicator. The helpers below are what say otherwise.
    boughtCount: 0,
    lastSettlementOutcome: null,
    // And nobody out buying it. A seeded claim would be a name the fixtures cannot
    // resolve on a screen nobody is shopping from.
    claimed: false,
    claimedByUserId: null,
    createdByUserId: SEED_USER_ID,
    approvedByUserId: SEED_USER_ID,
    version: 1,
    ...overrides,
  };
}

/** The ordinary line: the household wants some. */
function wanted(
  id: string,
  listId: string,
  content: string,
  quantity: number,
  position: number,
  overrides: Partial<Line> = {}
): Line {
  return line(id, listId, content, quantity, position, overrides);
}

/**
 * Bought, and therefore at zero.
 *
 * Takes no quantity, because a settled line has exactly one: zero is what settled
 * **means**, and letting a caller pass something else would let a fixture claim a
 * state the model does not have.
 */
function settled(
  id: string,
  listId: string,
  content: string,
  position: number,
  overrides: Partial<Line> = {}
): Line {
  return line(id, listId, content, 0, position, {
    boughtCount: 1,
    lastSettlementOutcome: 'BOUGHT',
    ...overrides,
  });
}

/**
 * At zero and never bought: somebody typed it and it has not been needed yet.
 *
 * The row draws nothing. It is here because it is the state most easily lost in a
 * refactor: it looks exactly like a settled line to anything testing the quantity
 * alone, which is why the count is on the wire at all.
 */
function neverWanted(
  id: string,
  listId: string,
  content: string,
  position: number,
  overrides: Partial<Line> = {}
): Line {
  return line(id, listId, content, 0, position, overrides);
}

/**
 * Still wanted, and the last trip could not find it.
 *
 * The quantity is untouched by a missing product, which is the point: not having
 * found something is not the same as no longer needing it.
 */
function missing(
  id: string,
  listId: string,
  content: string,
  quantity: number,
  position: number,
  overrides: Partial<Line> = {}
): Line {
  return line(id, listId, content, quantity, position, {
    lastSettlementOutcome: 'NOT_AVAILABLE',
    ...overrides,
  });
}
