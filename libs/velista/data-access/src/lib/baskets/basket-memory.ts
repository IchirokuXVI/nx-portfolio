import { Injectable } from '@angular/core';
import {
  isOpenBasket,
  LINK_VISIT_HOURS,
  type Basket,
  type BasketAddLineRequest,
  type BasketChange,
  type BasketChangeKind,
  type BasketChangeMark,
  type BasketChangePage,
  type BasketDemandRequest,
  type BasketLinkPreview,
  type BasketListRef,
  type BasketParticipant,
  type BasketPriceScope,
  type BasketProduct,
  type BasketProductAtShop,
  type BasketProgress,
  type BasketRenameRequest,
  type BasketRenameResult,
  type BasketRevertRequest,
  type BasketRow,
  type BasketRowEntry,
  type BasketRowNote,
  type BasketRowResult,
  type BasketRowState,
  type BasketSession,
  type BasketSettleRequest,
  type BasketShareLink,
  type CatalogSuggestion,
  type ErrorCode,
  type LineApprovalStatus,
  type LiveBasketSummary,
  type ProductOffer,
} from '@portfolio/velista/models';
import { CatalogMemory } from '../catalog/catalog-memory';
import { GatewayError } from '../errors';
import type { BasketChangeContext } from '../mapping/basket-change-mappers';
import type { BasketServiceI } from './basket-service';

/** The one link this fake knows. Anything else is dead, like most links are. */
const LIVE_SECRET = '9f2k4tqvb1xz8mq7';

/**
 * The accents `normalizeContent` strips, as the range U+0300 to U+036F.
 *
 * Built from code points rather than written as a literal, because a literal
 * would hold the combining marks themselves and they are invisible: a checkout,
 * an editor or a patch that dropped one would leave a regular expression that
 * still compiles and quietly matches the wrong thing.
 */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g'
);

/**
 * A line's words as the merge rule compares them, which is the server's
 * `normalizeContent` (backend `0091`).
 *
 * Copied rather than imported, because the only home for it is a Nest service in
 * core: importing it would put a backend edge into an Angular library. Four
 * transformations and no cleverness, so the copy is cheap to keep honest.
 */
function normalizeContent(content: string): string {
  return content
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** The basket every read here is about. */
const BASKET_ID = 'basket-saturday';

/**
 * The caller's own permanent basket (velista `0091`).
 *
 * A second id rather than the same one, because the two are two baskets on the
 * server and a fake that answered one id for both would let a screen pass while
 * addressing the wrong one.
 */
const LIVE_BASKET_ID = 'basket-live';

/**
 * The two scopes the mock prices against, which are two chains.
 *
 * Two rather than one since velista `0078`: a screen that shows one shop's prices
 * and says where a product is cheaper cannot be looked at against a basket priced
 * at a single shop. Mercadona carries two locations and Dia one, which is also
 * what makes the shop picker worth opening in this mode.
 */
const SCOPE_MERCADONA = 'scope-mercadona-cordoba';
const SCOPE_DIA = 'scope-dia-cordoba';

/**
 * A price on a product, for the row and the price mark to have something to
 * compare.
 *
 * The first option on the milk row is Hacendado, which is **not** the cheapest
 * here on purpose: the row's whole point is showing that the default was chosen
 * by insertion order and a cheaper option exists (velista `0062`, section 5.2).
 * The third milk carries no price, which is the mix section 5.3 draws, and the
 * eggs are priced so the row caption has a number on it.
 */
const offer = (
  price: number,
  unitPrice: number | null,
  unitPriceLabel: string | null,
  priceScopeId: string = SCOPE_MERCADONA
): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice,
  unitPriceLabel,
  observedAt: new Date('2026-09-01T06:00:00.000Z'),
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId,
});

/**
 * Every scope's offer, cheapest first, and the cheapest of them again.
 *
 * The pair backend `0109` answers with, built here out of one list so the two
 * cannot disagree: `offer` is the first entry by construction rather than a
 * second literal somebody has to keep in step with the first.
 */
const priced = (
  ...offers: readonly ProductOffer[]
): Pick<BasketProduct, 'offer' | 'offers'> => {
  const sorted = [...offers].sort(
    (left, right) => (left.price ?? Infinity) - (right.price ?? Infinity)
  );
  return { offer: sorted[0] ?? null, offers: sorted };
};

const PRODUCTS: readonly BasketProduct[] = [
  {
    id: 'item-milk-hacendado',
    name: {
      en: 'Hacendado whole milk, 1 L',
      es: 'Leche entera Hacendado, 1 L',
    },
    brand: 'Hacendado',
    productGroupId: 'group-milk',
    size: 1,
    unit: 'LITER',
    // Dearer at Dia, so the Mercadona view draws no mark and the Dia view does.
    ...priced(
      offer(0.95, 0.95, 'EUR/L'),
      offer(1.05, 1.05, 'EUR/L', SCOPE_DIA)
    ),
    atShop: null,
    imageUrl: null,
    categories: ['DAIRY'],
  },
  {
    id: 'item-milk-pascual',
    name: { en: 'Pascual whole milk, 1 L', es: 'Leche entera Pascual, 1 L' },
    brand: 'Pascual',
    productGroupId: 'group-milk',
    size: 1,
    unit: 'LITER',
    // Cheaper at Dia, which is the "cheaper elsewhere" mark on the Mercadona view.
    ...priced(
      offer(0.89, 0.89, 'EUR/L'),
      offer(0.79, 0.79, 'EUR/L', SCOPE_DIA)
    ),
    atShop: null,
    imageUrl: null,
    categories: ['DAIRY'],
  },
  {
    id: 'item-milk-central',
    name: {
      en: 'Central Lechera whole milk, 1 L',
      es: 'Leche entera Central Lechera, 1 L',
    },
    brand: 'Central Lechera Asturiana',
    productGroupId: 'group-milk',
    size: 1,
    unit: 'LITER',
    // Priced nowhere, which is `0062` section 5.3's unpriced option among priced ones.
    ...priced(),
    atShop: null,
    imageUrl: null,
    categories: ['DAIRY'],
  },
  {
    id: 'item-eggs',
    name: { en: 'Free range eggs, 12', es: 'Huevos camperos, 12' },
    brand: 'Hacendado',
    productGroupId: 'group-eggs',
    size: 12,
    unit: 'UNIT',
    // Mercadona alone, so the Dia view sinks this row and says where it is sold.
    ...priced(offer(2.85, 0.24, 'EUR/ud')),
    atShop: null,
    imageUrl: null,
    categories: ['DAIRY'],
  },
];

/**
 * One product at the scope a shop is priced at (velista `0102`).
 *
 * The price that scope quotes and nothing about availability: this fake stores no
 * shop's shelf, and unknown is what most real shops answer too.
 */
function atShopOf(
  product: BasketProduct,
  scope: BasketPriceScope
): BasketProductAtShop {
  const here = product.offers.find(
    (candidate) => candidate.priceScopeId === scope.priceScopeId
  );
  const price = here?.price ?? null;
  return {
    priceScopeId: price === null ? null : scope.priceScopeId,
    price,
    currency: price === null ? null : (here?.currency ?? null),
    available: null,
  };
}

/** The scopes those offers name, with their shops for a reader served them. */
const SCOPES: readonly BasketPriceScope[] = [
  {
    priceScopeId: SCOPE_MERCADONA,
    supermarketName: { en: 'Mercadona', es: 'Mercadona' },
    locations: [
      {
        id: 'loc-tejares',
        label: null,
        address: 'Ronda de los Tejares 32',
        city: 'Córdoba',
        postalCode: '14008',
      },
      {
        id: 'loc-barcelona',
        label: null,
        address: 'Avenida de Barcelona 4',
        city: 'Córdoba',
        postalCode: '14001',
      },
    ],
  },
  {
    priceScopeId: SCOPE_DIA,
    supermarketName: { en: 'Dia', es: 'Dia' },
    locations: [
      {
        id: 'loc-dia-victoria',
        label: null,
        address: 'Paseo de la Victoria 21',
        city: 'Córdoba',
        postalCode: '14004',
      },
    ],
  },
];

/**
 * The lists this fake holds, named.
 *
 * One table rather than names repeated wherever a list appears, because the
 * heading of a section and the caption on an entry have to agree about what a
 * list is called.
 */
const LISTS: readonly BasketListRef[] = [
  {
    listId: 'list-weekly',
    name: 'Weekly shop',
    zoneId: 'zone-flat',
    zoneName: 'Flat 3B',
  },
  {
    listId: 'list-groceries',
    name: 'Groceries',
    zoneId: 'zone-parents',
    zoneName: 'Parents’ house',
  },
];

/**
 * The lists this basket covers but the reader is **not** served.
 *
 * It exists so the "Other lists" heading and the unplaceable entry are reachable
 * without a second fake: a basket whose every entry could be named would let a
 * screen ship that has never drawn the one caption it cannot put a name on.
 */
const UNSERVED_LIST_ID = 'list-office';

/**
 * How long a skip stands before the row is ordinary again (backend `0137`).
 *
 * Twelve hours, by the **server's** clock. It is here because this class stands
 * in for the server; nothing above it counts hours, and the note the row carries
 * afterwards is a field the server sets rather than a deadline a screen watches.
 */
const SKIP_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * How long a link accepts joins, and how long a visit it let in lasts (backend
 * `0140`).
 *
 * By the **server's** clock, like {@link SKIP_WINDOW_MS}, which is why this
 * class holds the number and multiplies it out rather than a screen doing so.
 * The same count of hours as {@link LINK_VISIT_HOURS}, expressed in the units
 * this file works in.
 */
const LINK_VISIT_MS = LINK_VISIT_HOURS * 60 * 60 * 1000;

/** A moment {@link LINK_VISIT_MS} after another, which is every expiry here. */
function visitEnd(from: Date): Date {
  return new Date(from.getTime() + LINK_VISIT_MS);
}

const OWNER: BasketParticipant = {
  id: 'p-owner',
  kind: 'OWNER',
  displayName: 'Ana',
  username: 'ana',
  guestNumber: null,
  userId: 'u-ana',
  joinedAt: new Date('2026-09-01T08:00:00.000Z'),
  lastSeenAt: new Date('2026-09-01T10:30:00.000Z'),
  shareLinkId: null,
  // The owner's visit never ends: they arrived by owning the basket rather than
  // by a link (backend `0140`, section 4).
  expiresAt: null,
};

const REGISTERED: BasketParticipant = {
  id: 'p-marc',
  kind: 'REGISTERED',
  displayName: 'Marc',
  username: 'marc',
  guestNumber: null,
  userId: 'u-marc',
  joinedAt: new Date('2026-09-01T10:05:00.000Z'),
  lastSeenAt: new Date('2026-09-01T10:31:00.000Z'),
  shareLinkId: 'link-1',
  // A signed in person a link let in, so their time runs out like a guest's.
  // Seeded rather than null on purpose: this is the row the owner is offered
  // "Keep on this list" over, and a fake with no visitor in it would ship a
  // control nobody had seen drawn.
  expiresAt: visitEnd(new Date('2026-09-01T10:05:00.000Z')),
};

const GUEST: BasketParticipant = {
  id: 'p-guest-2',
  kind: 'GUEST',
  displayName: null,
  // No account, so no username. `Guest 2` is what the screen calls them.
  username: null,
  guestNumber: 2,
  userId: null,
  joinedAt: new Date('2026-09-01T10:41:00.000Z'),
  lastSeenAt: new Date('2026-09-01T10:42:00.000Z'),
  shareLinkId: 'link-1',
  expiresAt: visitEnd(new Date('2026-09-01T10:41:00.000Z')),
};

/**
 * One covered list line, which is what this fake actually stores.
 *
 * The whole point of the rewrite: backend `0136` deleted the basket's own line
 * table, so a basket is a rule saying which lists it covers and the rows are read
 * out of those lists on every request. A fake that stored rows would let a screen
 * ship against a shape the server no longer serves.
 */
interface StoredLine {
  readonly id: string;
  readonly listId: string;
  content: string;
  /** What the household asks for now, which is the entry's `left`. */
  quantity: number;
  /** The products this line names, first one first. */
  optionIds: readonly string[];
  /** Whether the household has agreed to it yet. */
  approved: boolean;
  /** Whether the basket's owner may change what this list asks for. */
  demandEditable: boolean;
  /** Set when the line leaves the coverage, which is what makes a row `REMOVED`. */
  deleted: boolean;
  /**
   * When this basket last put the line off for now, or null (backend `0137`).
   *
   * On the line and not on the row, because the server keeps it per line and a
   * row is a group read out of lines on every request. Within the window the row
   * is `SKIPPED`; past it the row is ordinary again and carries the note.
   */
  skippedAt: Date | null;
}

/**
 * One change to a covered list, as backend `0138` records it.
 *
 * Keyed by the **line** and never by the basket, exactly as the server's table
 * is: one write to a list serves every basket that covers it. What a basket
 * contributes is the coverage the change is read through, which is why the read
 * below resolves a line id into a row key and the record does not store one.
 */
interface StoredChange {
  readonly id: string;
  readonly kind: BasketChangeKind;
  /** The line it is about. Resolved to a row key on every read. */
  readonly lineId: string;
  readonly contentBefore: string | null;
  readonly contentAfter: string | null;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly approvalBefore: LineApprovalStatus | null;
  readonly approvalAfter: LineApprovalStatus | null;
  /** Served only where the reader holds `WRITE`, which {@link servesLists} decides. */
  readonly listId: string | null;
  /** A participant of this basket, or null for somebody this reader may not know. */
  readonly actorParticipantId: string | null;
  readonly at: Date;
}

/**
 * One standing act of this basket on one line.
 *
 * A settlement and not a number on the line, because that is what the server
 * keeps: `bought` is a **sum** over the standing `BOUGHT` rows, and a close is a
 * row of its own that holds no units. Modelling it any other way would make a
 * revert impossible to write honestly.
 */
interface Settlement {
  readonly id: number;
  readonly lineId: string;
  readonly outcome: 'BOUGHT' | 'NOT_AVAILABLE';
  /** Zero on a close, which buys nothing. */
  readonly quantity: number;
  readonly by: string;
  readonly at: Date;
  /**
   * The scope the settle named (velista `0095`, section 6). The real gateway reads a
   * price there; this twin keeps the scope so a spec can see what was sent.
   */
  readonly priceScopeId?: string;
  reverted: boolean;
}

/**
 * A shared basket, in memory, for development and for specs (rule D5's fixture
 * half).
 *
 * ## What it models that a kinder fake would not
 *
 * A fake that is more permissive than the server lets a bug through, so this one
 * keeps the rules the screen's correctness actually rests on:
 *
 * - **A basket stores no rows.** It holds lists with lines and the settlements
 *   this basket wrote, and {@link _rows} derives the rows on every read by the
 *   table of backend `0130` section 4, in that order. It is the one place in this
 *   scope allowed to do that arithmetic, because it stands in for the server.
 * - **The reader decides what comes back.** {@link servesLists} is a knob, and
 *   when it is false the answer genuinely carries no list refs, so every entry is
 *   unplaceable. A page that named a list anyway would render correctly against a
 *   kinder fake and leak on the real one.
 * - **Every write names the number it started from.** A `from` that no longer
 *   matches is refused with `stale_quantity` rather than applied to a number that
 *   moved underneath it.
 * - **A settle is not capped at what the row asks for.** Buying three of a row
 *   that says two records three, which is what backend `0136` does and what the
 *   explicit quantity on every `BOUGHT` exists for.
 *
 * ## What it does not model
 *
 * Revocation, which needs a second actor, and the participant credential, which
 * is `BasketApi`'s business and not this interface's: no method here takes one.
 */
@Injectable()
export class BasketMemory implements BasketServiceI {
  /**
   * Whether the reader is served the covered lists' names.
   *
   * Public and mutable so a spec, or a developer poking at the screen, can look at
   * the guest's view and the owner's without a second fake. It replaced
   * `seesZoneData`, which was one flag for a question that is now per entry.
   */
  servesLists = true;

  /** Who this fake answers as. */
  me: BasketParticipant = OWNER;

  /**
   * Where this basket has got to, so a developer can look at a finished one.
   *
   * Public and mutable for {@link servesLists}'s reason: the screen draws no
   * controls over a finished basket, and that branch is otherwise unreachable
   * without a second fake.
   */
  status = 'OPEN';

  /**
   * What this fake believes the time is.
   *
   * A knob rather than `Date.now`, because the one thing a skip does that no
   * other write does is **expire**: twelve hours later the row is ordinary again
   * and carries a note saying when it was put off. A spec that could not move
   * the clock could only test the half of the feature that happens immediately.
   *
   * It is the server's clock and not the browser's, which is the rule the screen
   * follows too: nothing above this class counts hours.
   */
  now: () => Date = () => new Date();

  /** The catalog behind the composer's dropdown. See {@link suggest}. */
  private readonly _catalog = new CatalogMemory();

  /** How many settlements this fake has written, for their ids. */
  private _settlementId = 0;

  /**
   * The covered lines, oldest first.
   *
   * The order is the anchor rule: a row's anchor is its oldest entry, so the
   * first line of a merge key is the one whose id keys the row.
   */
  private _lines: StoredLine[] = [
    {
      id: 'zl-1',
      listId: 'list-weekly',
      content: 'Milk',
      quantity: 2,
      optionIds: [
        'item-milk-hacendado',
        'item-milk-pascual',
        'item-milk-central',
      ],
      approved: true,
      demandEditable: true,
      deleted: false,
      skippedAt: null,
    },
    {
      id: 'zl-2',
      listId: 'list-groceries',
      content: 'Milk',
      quantity: 1,
      optionIds: ['item-milk-hacendado'],
      // Waiting for the household to agree, so the row draws the caption and
      // stays buyable (backend `0130`, section 3).
      approved: false,
      demandEditable: true,
      deleted: false,
      skippedAt: null,
    },
    {
      id: 'zl-3',
      listId: 'list-weekly',
      content: 'Eggs',
      quantity: 10,
      optionIds: ['item-eggs'],
      approved: true,
      demandEditable: true,
      deleted: false,
      skippedAt: null,
    },
    {
      id: 'zl-4',
      listId: 'list-weekly',
      content: 'Sourdough loaf',
      quantity: 1,
      optionIds: [],
      approved: true,
      demandEditable: true,
      deleted: false,
      skippedAt: null,
    },
    {
      // A list the reader is not served, so this entry can be named by nobody and
      // lands under "Other lists". Its row is one the search and the filter both
      // have to keep.
      id: 'zl-5',
      listId: UNSERVED_LIST_ID,
      content: 'Eggs',
      quantity: 2,
      optionIds: ['item-eggs'],
      approved: true,
      // The owner of this basket cannot change what a list they do not write asks
      // for, which is the one field no client can compute.
      demandEditable: false,
      deleted: false,
      skippedAt: null,
    },
    {
      // A line that left its list while somebody was shopping, which is the one
      // way to get a `REMOVED` row (velista `0093`, section 4). Seeded rather
      // than left to a write, because no write on this surface deletes a list
      // line: it happens on the list page or on somebody else's phone, so the
      // screen could otherwise ship having never drawn the row.
      //
      // It counts toward no number. `_progress` already excludes the state, and
      // `countableBasketRows` is what keeps it out of the tools bar.
      id: 'zl-6',
      listId: 'list-weekly',
      content: 'Olive oil',
      quantity: 1,
      optionIds: [],
      approved: true,
      demandEditable: true,
      deleted: true,
      skippedAt: null,
    },
  ];

  /**
   * What this basket has said about those lines.
   *
   * Two of the eggs are bought, so that row starts `PARTLY`, and the bread was
   * closed by a shop that had none, which is `NOT_AVAILABLE` with nothing bought.
   * Both are states a screen cannot be developed against without arranging a
   * purchase first.
   */
  private _settlements: Settlement[] = [
    {
      id: 0,
      lineId: 'zl-3',
      outcome: 'BOUGHT',
      quantity: 2,
      by: REGISTERED.id,
      at: new Date('2026-09-01T10:20:00.000Z'),
      reverted: false,
    },
    {
      id: 1,
      lineId: 'zl-4',
      outcome: 'NOT_AVAILABLE',
      quantity: 0,
      by: GUEST.id,
      at: new Date('2026-09-01T10:45:00.000Z'),
      reverted: false,
    },
  ];

  private _link: BasketShareLink | null = {
    id: 'link-1',
    secret: LIVE_SECRET,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    // Seeded **live** rather than at the fixed date above plus twelve hours,
    // which is long past. The share sheet has three link states and the ended
    // one is reached by pressing Revoke and then Make a new link; a seed that
    // opened on the ended state would hide the one this sheet is mostly about.
    expiresAt: visitEnd(new Date()),
    participantCount: 2,
  };

  /**
   * What changed on the covered lists, **newest first** (backend `0138`).
   *
   * Seeded rather than empty, for the reason the settlements above are: the
   * marks, the banner and the changes sheet are otherwise unreachable without
   * arranging an edit on another phone first, and a screen nobody can see is a
   * screen that ships wrong.
   *
   * One of each kind the sentences of velista `0093` section 6 cover, so a
   * developer scrolling the sheet reads every branch of the table.
   */
  private _changes: StoredChange[] = [
    {
      id: 'chg-5',
      kind: 'ADDED',
      lineId: 'zl-4',
      contentBefore: null,
      contentAfter: 'Sourdough loaf',
      quantityBefore: null,
      quantityAfter: 1,
      approvalBefore: null,
      approvalAfter: 'APPROVED',
      listId: 'list-weekly',
      actorParticipantId: REGISTERED.id,
      at: new Date('2026-09-01T09:40:00.000Z'),
    },
    {
      id: 'chg-4',
      kind: 'QUANTITY_CHANGED',
      lineId: 'zl-3',
      contentBefore: 'Eggs',
      contentAfter: 'Eggs',
      quantityBefore: 6,
      quantityAfter: 10,
      approvalBefore: null,
      approvalAfter: null,
      listId: 'list-weekly',
      actorParticipantId: OWNER.id,
      at: new Date('2026-09-01T09:30:00.000Z'),
    },
    {
      id: 'chg-3',
      kind: 'DELETED',
      lineId: 'zl-6',
      contentBefore: 'Olive oil',
      contentAfter: null,
      quantityBefore: 1,
      quantityAfter: null,
      approvalBefore: null,
      approvalAfter: null,
      listId: 'list-weekly',
      actorParticipantId: REGISTERED.id,
      at: new Date('2026-09-01T09:20:00.000Z'),
    },
    {
      // Somebody this reader cannot name, which is the case the sheet draws as
      // "Someone": the actor is on no participant row of this basket.
      id: 'chg-2',
      kind: 'RENAMED',
      lineId: 'zl-2',
      contentBefore: 'Leche',
      contentAfter: 'Milk',
      quantityBefore: 1,
      quantityAfter: 1,
      approvalBefore: null,
      approvalAfter: null,
      listId: 'list-groceries',
      actorParticipantId: null,
      at: new Date('2026-09-01T09:10:00.000Z'),
    },
    {
      id: 'chg-1',
      kind: 'APPROVAL_CHANGED',
      lineId: 'zl-2',
      contentBefore: 'Leche',
      contentAfter: 'Leche',
      quantityBefore: 1,
      quantityAfter: 1,
      approvalBefore: 'APPROVED',
      approvalAfter: 'PENDING',
      listId: 'list-groceries',
      actorParticipantId: GUEST.id,
      at: new Date('2026-09-01T09:00:00.000Z'),
    },
  ];

  /**
   * The newest change this viewer has acknowledged, or null for none.
   *
   * A **cursor over the log** and not a time, which is the whole shape of the
   * real thing: the acknowledgement names the newest change the client drew, so
   * everything above it in the list stays unseen however long ago it happened.
   *
   * Public and mutable for {@link servesLists}'s reason, so a spec can put a
   * viewer at any point in the log without replaying the acknowledgement.
   */
  seenThrough: string | null = null;

  private _participants: BasketParticipant[] = [OWNER, REGISTERED, GUEST];

  // --- What a link reaches ---------------------------------------------------

  async previewLink(secret: string): Promise<BasketLinkPreview> {
    // Every dead link answers identically, which is the rule rather than a
    // shortcut: a link that never existed and one that was revoked must not be
    // distinguishable (backend `0051`, section 3.1).
    if (secret !== LIVE_SECRET || this._link === null) {
      return { joinable: false };
    }
    return {
      joinable: true,
      name: 'Saturday big shop',
      participantCount: this._participants.length,
    };
  }

  async join(secret: string, displayName?: string): Promise<BasketSession> {
    if (secret !== LIVE_SECRET || this._link === null) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'This link is no longer accepting people',
      });
    }

    const guestNumber =
      this._participants.filter((person) => person.kind === 'GUEST').length + 1;
    const joined: BasketParticipant = {
      id: `p-guest-${guestNumber}`,
      kind: 'GUEST',
      // Absent and empty both mean "they skipped it", which is a first class
      // outcome: they become Guest N and nothing about their view is degraded.
      displayName: displayName?.trim() ? displayName.trim() : null,
      // This fake joins everybody as a guest, and a guest has no account to take a
      // username from. The signed in join, which is where luna `0054` fills it, is
      // not modelled here.
      username: null,
      guestNumber,
      userId: null,
      joinedAt: new Date(),
      lastSeenAt: new Date(),
      shareLinkId: this._link.id,
      // Twelve hours from **their own** join and not from the link's making
      // (backend `0140`, section 4): the last person through a link that is
      // nearly over still gets a whole visit.
      expiresAt: visitEnd(new Date()),
    };
    this._participants = [...this._participants, joined];

    return {
      basketId: BASKET_ID,
      participantId: joined.id,
      secret: `secret-${joined.id}`,
      socketToken: 'socket-token',
      socketTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  // --- The participant surface ----------------------------------------------

  async getBasket(_basketId?: string, locationId?: string): Promise<Basket> {
    const rows = this._rows();
    // The scope the chosen shop is priced at (velista `0102`), as the gateway
    // answers it: this fake's shops each belong to one scope, so its stack is
    // one deep. A shop it does not know reads at no shop, as a gateway that
    // could not name the shop does.
    const at =
      locationId === undefined
        ? undefined
        : SCOPES.find((scope) =>
            scope.locations.some((location) => location.id === locationId)
          );
    return {
      id: BASKET_ID,
      kind: 'GENERATED',
      name: 'Saturday big shop',
      status: isOpenBasket(this.status) ? 'OPEN' : 'FINISHED',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
      rows,
      // Empty for a reader served none, which is what makes every entry
      // unplaceable rather than what hides a caption behind a flag.
      lists: this.servesLists ? LISTS : [],
      participants: this._participants.map((person) =>
        this.servesLists ? person : this._withoutDevice(person)
      ),
      me: this.me,
      products: new Map(
        PRODUCTS.map((product) => [
          product.id,
          at === undefined
            ? product
            : { ...product, atShop: atShopOf(product, at) },
        ])
      ),
      // The chain and its shops reach every participant, a guest included,
      // since backend `0163` section 4: a guest picks the shop they are
      // standing in from the same list the owner sees.
      scopes: new Map(SCOPES.map((scope) => [scope.priceScopeId, scope])),
      // Nobody started this basket at a shop, so nothing is locked here.
      shop: null,
      lockedShopId: null,
      readAt: null,
      progress: this._progress(rows),
      pending: this._pending(rows),
      // The server's count and the server's id, both read off the log this
      // fake keeps. Capped at 99 like the gateway's, where the cap means
      // "this many or more".
      unseenChangeCount: Math.min(this._unseen().length, 99),
      newestUnseenChangeId: this._unseen()[0]?.id ?? null,
    };
  }

  /**
   * The caller's own permanent basket (velista `0091`).
   *
   * The same lines and the same people as {@link getBasket}, because it stands
   * in for a server that reads both from the same lists. What differs is the
   * header, and it differs in exactly the three ways backend `0130` says: no
   * name, a `LIVE` kind, and a status that is always open. A developer who wants
   * the other surface opens a basket by id, which is what the app does.
   */
  async getLiveBasket(locationId?: string): Promise<Basket> {
    const basket = await this.getBasket(undefined, locationId);
    return {
      ...basket,
      id: LIVE_BASKET_ID,
      kind: 'LIVE',
      name: null,
      status: 'OPEN',
    };
  }

  async getLiveSummary(): Promise<LiveBasketSummary> {
    const rows = this._rows();
    return {
      id: LIVE_BASKET_ID,
      progress: this._progress(rows),
      pending: this._pending(rows),
    };
  }

  async settle(
    _basketId: string,
    rowKey: string,
    body: BasketSettleRequest
  ): Promise<BasketRowResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    this._requireFrom(body.from, row.left);

    if (body.outcome === 'NOT_AVAILABLE') {
      // A close holds no units and names no entry: the shop had none of it, for
      // everybody who asked.
      this._write(row.entries[0]?.lineId ?? rowKey, 'NOT_AVAILABLE', 0);
      return this._result(rowKey);
    }

    const quantity = body.quantity ?? row.left;
    if (quantity <= 0) {
      throw this._refuse('validation_failed', 400, 'Nothing to buy');
    }

    const allocations =
      body.allocations !== undefined && body.allocations.length > 0
        ? body.allocations
        : this._divide(row, quantity);

    for (const allocation of allocations) {
      if (allocation.quantity > 0) {
        this._write(
          allocation.lineId,
          'BOUGHT',
          allocation.quantity,
          body.priceScopeId
        );
      }
    }

    return this._result(rowKey);
  }

  async revert(
    _basketId: string,
    rowKey: string,
    body: BasketRevertRequest
  ): Promise<BasketRowResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    const lineIds = new Set(row.entries.map((entry) => entry.lineId));

    if (body.target === 'CLOSE') {
      const close = this._standing()
        .filter(
          (act) => lineIds.has(act.lineId) && act.outcome === 'NOT_AVAILABLE'
        )
        .pop();
      if (close === undefined) {
        throw this._refuse('validation_failed', 400, 'Nothing to take back');
      }
      close.reverted = true;
      return this._result(rowKey);
    }

    this._requireFrom(body.from, row.bought);

    // Newest first, which is the order a person takes a purchase back in: the
    // one they just made is the one they meant.
    let left = body.units;
    const bought = this._standing()
      .filter((act) => lineIds.has(act.lineId) && act.outcome === 'BOUGHT')
      .reverse();
    for (const act of bought) {
      if (left <= 0) {
        break;
      }
      if (act.quantity <= left) {
        left -= act.quantity;
        act.reverted = true;
        continue;
      }
      // Part of one settlement comes back, which the server does by splitting it.
      act.reverted = true;
      this._settlements.push({
        id: (this._settlementId += 1),
        lineId: act.lineId,
        outcome: 'BOUGHT',
        quantity: act.quantity - left,
        by: this.me.id,
        at: act.at,
        reverted: false,
      });
      left = 0;
    }

    return this._result(rowKey);
  }

  /**
   * Put a row off for now (backend `0137`).
   *
   * Stamped on every live entry of the row, because a skip covers the row: a
   * shopper walking past the bread is walking past both households' bread.
   *
   * **Refused on a row with nothing left to get**, which is what stands in for
   * the `from` every other write carries: a row already bought or already closed
   * is not one anybody is walking past.
   */
  async skip(_basketId: string, rowKey: string): Promise<BasketRowResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    if (row.left === 0) {
      throw this._refuse(
        'conflict',
        409,
        'There is nothing left to get on this row'
      );
    }

    const at = this.now();
    for (const line of this._livesOf(row)) {
      line.skippedAt = at;
    }

    return this._result(rowKey);
  }

  /** Take the skip back. The same fact, unset. */
  async unskip(_basketId: string, rowKey: string): Promise<BasketRowResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    for (const line of this._livesOf(row)) {
      line.skippedAt = null;
    }

    return this._result(rowKey);
  }

  /**
   * Change what one list asks for (backend `0131`, velista `0092` section 6).
   *
   * Three refusals, and each stands for a rule the screen rests on: a `from`
   * that moved is `stale_quantity`, an entry the owner may not change is
   * `forbidden`, and a quantity that is not a whole number is a validation
   * failure. A kinder fake would let a screen ship that never drew any of them.
   *
   * A row whose every entry asks for nothing, and which nothing was bought of,
   * **leaves the basket**. The answer's row is null there, which is what
   * `toBasketRowResult` reads out of the server's emptied row.
   */
  async setDemand(
    _basketId: string,
    rowKey: string,
    body: BasketDemandRequest
  ): Promise<BasketRowResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    const entry = row.entries.find((held) => held.lineId === body.lineId);
    const line = this._lines.find((held) => held.id === body.lineId);
    if (entry === undefined || line === undefined) {
      throw this._refuse('validation_failed', 400, 'That line is not here');
    }
    if (!entry.demandEditable) {
      throw this._refuse(
        'forbidden',
        403,
        'This list does not allow its quantity to be changed from here'
      );
    }
    if (!Number.isInteger(body.quantity) || body.quantity < 0) {
      throw this._refuse(
        'validation_failed',
        400,
        'quantity must be a whole number'
      );
    }
    this._requireFrom(body.from, entry.left);

    line.quantity = body.quantity;
    return this._result(rowKey);
  }

  /**
   * Add a line onto one of the covered lists (backend `0136`, velista `0092`
   * section 7).
   *
   * **It merges**, because the list's own add does (backend `0091`): a line
   * whose normalized content matches one the target list already holds raises
   * that line rather than making a second. So the answer can be a row that was
   * already on the screen, under a key the caller never named, which is exactly
   * what the store has to fold correctly.
   *
   * A list this reader was not served is refused, which is the redaction being a
   * rule rather than a caption: a target you were not told about is one you may
   * not write.
   */
  async addLine(
    _basketId: string,
    body: BasketAddLineRequest
  ): Promise<BasketRowResult> {
    this._requireLive();
    const content = body.content.trim();
    if (content === '') {
      throw this._refuse('validation_failed', 400, 'A line needs a name');
    }
    if (!LISTS.some((ref) => ref.listId === body.targetListId)) {
      throw this._refuse('forbidden', 403, 'You cannot write that list');
    }

    const quantity = Math.max(1, Math.trunc(body.quantity));
    const key = normalizeContent(content);
    const held = this._lines.find(
      (line) =>
        !line.deleted &&
        line.listId === body.targetListId &&
        normalizeContent(line.content) === key
    );

    if (held !== undefined) {
      held.quantity += quantity;
      return this._result(held.id);
    }

    const line: StoredLine = {
      id: `zl-${this._lines.length + 1}-${key.replace(/\s+/g, '-')}`,
      listId: body.targetListId,
      content,
      quantity,
      optionIds: body.itemIds === undefined ? [] : [...body.itemIds],
      // Every list this fake serves auto approves, which is the ordinary case.
      // The `zl-2` fixture is where a screen meets a line waiting for one.
      approved: true,
      demandEditable: true,
      deleted: false,
      skippedAt: null,
    };
    this._lines.push(line);
    return this._result(line.id);
  }

  async renameRow(
    _basketId: string,
    rowKey: string,
    body: BasketRenameRequest
  ): Promise<BasketRenameResult> {
    this._requireLive();
    const row = this._requireRow(rowKey);
    const content = body.content.trim();
    if (content === '') {
      throw this._refuse('validation_failed', 400, 'A line needs a name');
    }

    const name = normalizeContent(content);
    const folds = this._rows().find(
      (other) =>
        other.rowKey !== rowKey && normalizeContent(other.content) === name
    );

    if (folds !== undefined && body.confirmMerge !== true) {
      throw this._refuse(
        'line_merge_required',
        409,
        'That name is already on this basket'
      );
    }

    for (const line of this._lines) {
      if (row.entries.some((entry) => entry.lineId === line.id)) {
        line.content = content;
      }
    }

    // The earliest line survives, so after a fold the row is keyed by whichever
    // of the two came first, which may not be the one the request named.
    const survivor = this._rows().find(
      (other) => normalizeContent(other.content) === name
    );
    if (survivor === undefined) {
      throw this._refuse('not_found', 404, 'That row is no longer here');
    }

    const result = await this._result(survivor.rowKey);
    return {
      ...result,
      replacedRowKey: survivor.rowKey === rowKey ? null : rowKey,
      absorbedRowKey: survivor.rowKey === rowKey ? null : rowKey,
    };
  }

  async suggest(
    _basketId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]> {
    return this._catalog.suggest(query);
  }

  // --- Presence and the socket ----------------------------------------------

  /**
   * What changed on the covered lists, newest first (velista `0093`).
   *
   * Resolved through the same {@link BasketChangeContext} the real client
   * resolves through, so the fake cannot be kinder than the gateway: a name, a
   * list and a merge survivor's text all come from the basket the caller holds,
   * and a reader served no list refs is genuinely served no list here.
   *
   * One page of five, which is every change this fake knows, so `nextCursor` is
   * always null. Paging is the server's arithmetic and there is nothing here to
   * learn from a second page of a five row log.
   */
  async changes(
    _basketId: string,
    context: BasketChangeContext,
    _cursor?: string
  ): Promise<BasketChangePage> {
    const unseen = new Set(this._unseen().map((change) => change.id));
    // Once, and handed down: resolving a line id into a row key is a walk of
    // the groups, and doing it per change would be that walk five times.
    const rows = this._rows();

    return {
      items: this._changes.map((change) =>
        this._toChange(change, context, unseen, rows)
      ),
      nextCursor: null,
    };
  }

  /**
   * Move this viewer's cursor to the change they drew (velista `0093`).
   *
   * **Forward only.** A `through` at or before the cursor writes nothing, which
   * is why the route is a `POST` rather than a `PUT`: it moves a cursor rather
   * than stating where one is, and a cursor that could move backwards would
   * make a slow request un-see what a fast one had seen.
   */
  async acknowledgeChanges(_basketId: string, through: string): Promise<void> {
    const asked = this._changes.findIndex((change) => change.id === through);
    if (asked === -1) {
      // A change this log does not know. Nothing to move to, and nothing to
      // refuse over: the cursor stays where it is.
      return;
    }

    const held = this._changes.findIndex(
      (change) => change.id === this.seenThrough
    );
    // Newest first, so a **lower** index is newer. A cursor already at or past
    // the change asked for does not move.
    if (held === -1 || asked < held) {
      this.seenThrough = through;
    }
  }

  async listParticipants(): Promise<readonly BasketParticipant[]> {
    return this._participants.map((person) =>
      this.servesLists ? person : this._withoutDevice(person)
    );
  }

  async refreshSocketToken(): Promise<BasketSession> {
    return {
      basketId: BASKET_ID,
      participantId: this.me.id,
      secret: null,
      socketToken: `socket-token-${Date.now()}`,
      socketTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  // --- The owner's share sheet ----------------------------------------------

  /**
   * Hand back the working link, or mint one (backend `0140`, section 4).
   *
   * A link whose time is up is replaced rather than returned, which is what
   * makes "Make a new link" one press on the sheet: the client never revokes
   * first, so an ended link has to be swept aside here.
   */
  async ensureShareLink(): Promise<BasketShareLink> {
    const now = new Date();
    if (this._link !== null && this._link.expiresAt > now) {
      return this._link;
    }

    this._link = {
      id: 'link-1',
      secret: LIVE_SECRET,
      createdAt: now,
      expiresAt: visitEnd(now),
      participantCount: 0,
    };
    return this._link;
  }

  async getShareLink(): Promise<BasketShareLink | null> {
    return this._link;
  }

  async revokeShareLink(
    _basketId: string,
    cascade = false
  ): Promise<{ revoked: number }> {
    this._link = null;
    if (!cascade) {
      // Nobody new can join and everybody already shopping keeps working, which
      // is the default and the reason the flag is explicit.
      return { revoked: 0 };
    }

    const thrownOut = this._participants.filter(
      (person) => person.shareLinkId !== null
    );
    this._participants = this._participants.filter(
      (person) => person.shareLinkId === null
    );
    return { revoked: thrownOut.length };
  }

  async revokeParticipant(
    _basketId: string,
    participantId: string
  ): Promise<void> {
    this._participants = this._participants.filter(
      (person) => person.id !== participantId
    );
  }

  /**
   * Put somebody on the basket by name, or **keep** somebody a link let in
   * (backend `0140`, section 6).
   *
   * The promotion is the second half and is the same call: a row that is
   * already here keeps its id, loses its link and loses its expiry, which is
   * what makes the person's past attributions survive being kept. A row that is
   * already a named person is left exactly as it is.
   */
  async addParticipant(
    _basketId: string,
    userId: string
  ): Promise<BasketParticipant> {
    const held = this._participants.find((person) => person.userId === userId);
    if (held !== undefined) {
      const kept: BasketParticipant = {
        ...held,
        shareLinkId: null,
        expiresAt: null,
      };
      this._participants = this._participants.map((person) =>
        person.id === held.id ? kept : person
      );
      return kept;
    }

    const added: BasketParticipant = {
      id: `p-${userId}`,
      kind: 'REGISTERED',
      displayName: null,
      username: userId,
      guestNumber: null,
      userId,
      joinedAt: new Date(),
      lastSeenAt: null,
      shareLinkId: null,
      expiresAt: null,
    };
    this._participants = [...this._participants, added];
    return added;
  }

  async leaveBasket(): Promise<void> {
    this._participants = this._participants.filter(
      (person) => person.id !== this.me.id
    );
  }

  // --- Deriving the rows -----------------------------------------------------

  /**
   * The rows, read out of the lines on every call (backend `0130`, section 4).
   *
   * Grouped by merge key, anchored by the oldest line, and stated in the order
   * the plan's table states them. It is the one arithmetic this scope is allowed,
   * because this class stands in for the server.
   *
   * The merge key is the normalized content, which is what the server groups by.
   * A deleted line still forms a row, because a row every entry has left is
   * `REMOVED` and that is information about the basket rather than nothing.
   */
  private _rows(): readonly BasketRow[] {
    const groups = new Map<string, StoredLine[]>();
    for (const line of this._lines) {
      const key = normalizeContent(line.content);
      const held = groups.get(key);
      if (held === undefined) {
        groups.set(key, [line]);
      } else {
        held.push(line);
      }
    }

    const rows: BasketRow[] = [];
    for (const lines of groups.values()) {
      const live = lines.filter((line) => !line.deleted);
      const anchor = live[0] ?? lines[0];
      const entries = live.map((line) => this._entry(line));
      const bought = entries.reduce((sum, entry) => sum + entry.bought, 0);
      const left = entries.reduce((sum, entry) => sum + entry.left, 0);
      const newest = this._newestOn(lines);

      // **A row nothing asks for and nothing was bought of is not a thing to
      // buy**, so it leaves the view (backend `0136`). That is what a demand
      // taken to zero produces, and it is the one way a write empties a basket
      // of a row: a row bought to zero has `bought`, so it stays as `DONE`.
      //
      // A `REMOVED` row is the other way round and stays: its lines left the
      // coverage, which is information about the basket rather than nothing.
      if (live.length > 0 && left === 0 && bought === 0) {
        continue;
      }

      rows.push({
        rowKey: anchor.id,
        content: anchor.content,
        left,
        bought,
        asked: bought + left,
        state: this._state(lines, left, bought),
        // What a skip leaves behind once its window has passed (backend `0137`).
        // Inside the window the state says it and there is no note; outside it
        // the row is ordinary again and the note is the only trace.
        note: this._note(lines, bought),
        noteAt:
          this._note(lines, bought) === null ? null : this._skippedAt(lines),
        // Filled below, once every row exists: a mark is decided by the
        // unseen changes that resolve to this row, and resolving one needs
        // the row it names to have been built.
        mark: null,
        awaitingApproval: entries.some((entry) => entry.awaitingApproval),
        // First seen order, anchor first, which is what the server promises and
        // what makes `optionIds[0]` the product the row means.
        optionIds: [...new Set(live.flatMap((line) => line.optionIds))],
        touchedBy: newest?.by ?? null,
        touchedAt: newest?.at ?? null,
        entries,
        // Nothing here knows which chain a purchase was made at, so no row says
        // where it is usually bought, which the usual filter keeps (velista 0104).
        usual: null,
      });
    }

    return this._marked(rows);
  }

  /**
   * Put this viewer's marks on the rows the unseen changes touched.
   *
   * A second pass rather than a field written while the rows are built, because
   * a change names a **line** and a row is a group: the row a line is in is not
   * known until every group exists.
   *
   * Three rules, in this order. A row whose lines all left the coverage is
   * `REMOVED`, whatever the change said, because that is what the reader has to
   * be told about it. Otherwise an `ADDED` change makes an `ADDED` row, and
   * everything else makes a `CHANGED` one. A row with no unseen change keeps its
   * null and draws no tag.
   */
  private _marked(rows: readonly BasketRow[]): readonly BasketRow[] {
    const marks = new Map<string, BasketChangeMark>();
    for (const change of this._unseen()) {
      const key = this._rowKeyOf(change.lineId, rows);
      if (key === null || marks.has(key)) {
        continue;
      }
      const row = rows.find((candidate) => candidate.rowKey === key);
      marks.set(
        key,
        row?.state === 'REMOVED'
          ? 'REMOVED'
          : change.kind === 'ADDED'
            ? 'ADDED'
            : 'CHANGED'
      );
    }

    return rows.map((row) => {
      const mark = marks.get(row.rowKey) ?? null;
      return mark === row.mark ? row : { ...row, mark };
    });
  }

  /** The row one line ended up in, by the anchor rule, or null when it is gone. */
  private _rowKeyOf(lineId: string, rows: readonly BasketRow[]): string | null {
    const line = this._lines.find((held) => held.id === lineId);
    if (line === undefined) {
      return null;
    }

    const key = normalizeContent(line.content);
    const row = rows.find(
      (candidate) => normalizeContent(candidate.content) === key
    );
    return row?.rowKey ?? null;
  }

  /**
   * The changes this viewer has not acknowledged, newest first.
   *
   * Everything above the cursor in the log. A cursor naming a change the log
   * does not hold counts everything as unseen, which is the safe direction: a
   * mark too many costs a tag, and a mark too few loses the one thing the
   * reader opened the screen to find out.
   */
  private _unseen(): readonly StoredChange[] {
    const held = this._changes.findIndex(
      (change) => change.id === this.seenThrough
    );
    return held === -1 ? this._changes : this._changes.slice(0, held);
  }

  /** One stored change, resolved against the basket the caller holds. */
  private _toChange(
    change: StoredChange,
    context: BasketChangeContext,
    unseen: ReadonlySet<string>,
    rows: readonly BasketRow[]
  ): BasketChange {
    const rowKey = this._rowKeyOf(change.lineId, rows);
    // Redacted here rather than by the caller, exactly as the gateway redacts
    // it: a reader served no refs is served no list id at all, so there is
    // nothing for the sheet to resolve and nothing for it to leak.
    const listId = this.servesLists ? change.listId : null;

    return {
      id: change.id,
      kind: change.kind,
      rowKey,
      contentBefore: change.contentBefore,
      contentAfter: change.contentAfter,
      quantityBefore: change.quantityBefore,
      quantityAfter: change.quantityAfter,
      approvalBefore: change.approvalBefore,
      approvalAfter: change.approvalAfter,
      rowContent: rowKey === null ? null : context.contentFor(rowKey),
      actor:
        change.actorParticipantId === null
          ? null
          : {
              participantId: change.actorParticipantId,
              userId: null,
              name: context.nameFor(change.actorParticipantId, null),
            },
      list: listId === null ? null : context.listFor(listId),
      at: change.at,
      unseen: unseen.has(change.id),
    };
  }

  /** One entry, with the numbers read off the line and the settlements. */
  private _entry(line: StoredLine): BasketRowEntry {
    const bought = this._standing()
      .filter((act) => act.lineId === line.id && act.outcome === 'BOUGHT')
      .reduce((sum, act) => sum + act.quantity, 0);

    return {
      lineId: line.id,
      // Null for a list this reader was not served, which is the whole of the
      // redaction: the client knows how much and never where.
      listId:
        this.servesLists && LISTS.some((ref) => ref.listId === line.listId)
          ? line.listId
          : null,
      left: line.quantity,
      bought,
      asked: bought + line.quantity,
      state: this._entryState(line, bought),
      awaitingApproval: !line.approved,
      demandEditable: line.demandEditable,
    };
  }

  /**
   * A row's state, by the table of backend `0130` section 4, in its order.
   *
   * `SKIPPED` is absent because backend `0137` produces it and this fake does not
   * model a skip. Its place in the order is kept by the comment, so the day it
   * arrives it goes where the table says rather than wherever it fits.
   */
  private _state(
    lines: readonly StoredLine[],
    left: number,
    bought: number
  ): BasketRowState {
    if (lines.every((line) => line.deleted)) {
      return 'REMOVED';
    }
    // Above `NOT_AVAILABLE` and above the two bought states, which is where the
    // table puts it: a skip is the newest thing said about a row that still has
    // something left to get, and it covers the row.
    if (this._skipStands(lines) && left > 0) {
      return 'SKIPPED';
    }
    const newest = this._newestOn(lines);
    if (newest?.outcome === 'NOT_AVAILABLE') {
      return 'NOT_AVAILABLE';
    }
    if (left === 0 && bought > 0) {
      return 'DONE';
    }
    if (left > 0 && bought > 0) {
      return 'PARTLY';
    }
    return 'WANTED';
  }

  /** One entry's own state, by the same table over that line alone. */
  private _entryState(line: StoredLine, bought: number): BasketRowState {
    const newest = this._newestOn([line]);
    if (newest?.outcome === 'NOT_AVAILABLE') {
      return 'NOT_AVAILABLE';
    }
    if (line.quantity === 0 && bought > 0) {
      return 'DONE';
    }
    if (line.quantity > 0 && bought > 0) {
      return 'PARTLY';
    }
    return 'WANTED';
  }

  /**
   * Whether a skip on these lines is still inside its window.
   *
   * The newest skip across the group, because a skip covers the row: a second
   * one on either entry starts the window again.
   */
  private _skipStands(lines: readonly StoredLine[]): boolean {
    const at = this._skippedAt(lines);
    return at !== null && this.now().getTime() - at.getTime() < SKIP_WINDOW_MS;
  }

  /** The newest skip across these lines, or null if none was skipped. */
  private _skippedAt(lines: readonly StoredLine[]): Date | null {
    const times = lines
      .filter((line) => !line.deleted && line.skippedAt !== null)
      .map((line) => (line.skippedAt as Date).getTime());
    return times.length === 0 ? null : new Date(Math.max(...times));
  }

  /**
   * The note a row carries, which is `SKIPPED_EARLIER` and nothing else.
   *
   * Set once the window has passed and while nothing has been bought since: the
   * purchase is what ends a skip, so the note goes with it (backend `0137`).
   * The fake reads `bought` rather than comparing timestamps, which is the same
   * answer here because every fixture purchase predates every skip a spec makes.
   */
  private _note(
    lines: readonly StoredLine[],
    bought: number
  ): BasketRowNote | null {
    const at = this._skippedAt(lines);
    if (at === null || bought > 0) {
      return null;
    }
    return this.now().getTime() - at.getTime() < SKIP_WINDOW_MS
      ? null
      : 'SKIPPED_EARLIER';
  }

  /** The newest standing act of this basket on any of these lines. */
  private _newestOn(lines: readonly StoredLine[]): Settlement | undefined {
    const ids = new Set(lines.map((line) => line.id));
    return this._standing()
      .filter((act) => ids.has(act.lineId))
      .pop();
  }

  /** Every act that has not been taken back, oldest first. */
  private _standing(): Settlement[] {
    return this._settlements
      .filter((act) => !act.reverted)
      .sort(
        (left, right) =>
          left.at.getTime() - right.at.getTime() || left.id - right.id
      );
  }

  /**
   * Counted over rows that are not `REMOVED`, which is the server's rule.
   *
   * Here rather than by `basketRowsProgress`, although the two agree by
   * construction: that function is the client's, and this class answers as the
   * server. A fake that called the client's counter could not catch the day they
   * disagree, which is the one thing a spec over this is for.
   */
  private _progress(rows: readonly BasketRow[]): BasketProgress {
    const counted = rows.filter((row) => row.state !== 'REMOVED');
    return {
      done: counted.filter((row) => row.state === 'DONE').length,
      unavailable: counted.filter((row) => row.state === 'NOT_AVAILABLE')
        .length,
      total: counted.length,
    };
  }

  /** `total - done - unavailable`. A `SKIPPED` row is pending. */
  private _pending(rows: readonly BasketRow[]): number {
    const progress = this._progress(rows);
    return progress.total - progress.done - progress.unavailable;
  }

  // --- Writing ---------------------------------------------------------------

  /** Append one act of this basket on one line. */
  private _write(
    lineId: string,
    outcome: 'BOUGHT' | 'NOT_AVAILABLE',
    quantity: number,
    priceScopeId?: string
  ): void {
    this._settlements.push({
      id: (this._settlementId += 1),
      lineId,
      outcome,
      quantity,
      by: this.me.id,
      at: new Date(),
      ...(priceScopeId === undefined ? {} : { priceScopeId }),
      reverted: false,
    });

    if (outcome === 'BOUGHT') {
      const line = this._lines.find((held) => held.id === lineId);
      if (line !== undefined) {
        // What the household still asks for goes down by what was bought for it,
        // never below zero: buying three of a line that says two is allowed, and
        // the extra unit is recorded rather than subtracted twice.
        line.quantity = Math.max(0, line.quantity - quantity);
      }
    }
  }

  /**
   * Which entry gets what, when the caller did not say.
   *
   * Oldest entry first, up to what it still asks for, which is what the server
   * does with an absent `allocations`. Anything over the row's whole demand lands
   * on the anchor, because the extra unit is real and has to be recorded
   * somewhere.
   */
  private _divide(
    row: BasketRow,
    quantity: number
  ): readonly { lineId: string; quantity: number }[] {
    const shares: { lineId: string; quantity: number }[] = [];
    let left = quantity;

    for (const entry of row.entries) {
      if (left <= 0) {
        break;
      }
      const share = Math.min(entry.left, left);
      if (share > 0) {
        shares.push({ lineId: entry.lineId, quantity: share });
        left -= share;
      }
    }

    if (left > 0) {
      const anchor = row.entries[0];
      if (anchor !== undefined) {
        const held = shares.find((share) => share.lineId === anchor.lineId);
        if (held === undefined) {
          shares.push({ lineId: anchor.lineId, quantity: left });
        } else {
          held.quantity += left;
        }
      }
    }

    return shares;
  }

  /** The stored lines behind a row's live entries. */
  private _livesOf(row: BasketRow): StoredLine[] {
    const ids = new Set(row.entries.map((entry) => entry.lineId));
    return this._lines.filter((line) => ids.has(line.id));
  }

  /**
   * What every write answers: the row as it now stands, and the counts.
   *
   * **A row that is no longer there answers null rather than a 404.** A demand
   * taken to zero on a row nothing was bought of takes the row out of the view,
   * and that is the write succeeding: the list now asks for nothing, which is
   * what was asked for. A 404 here would report a failure to somebody whose
   * change landed.
   */
  private async _result(rowKey: string): Promise<BasketRowResult> {
    const rows = this._rows();
    const row =
      rows.find((held) => held.rowKey === rowKey) ??
      rows.find((held) =>
        held.entries.some((entry) => entry.lineId === rowKey)
      ) ??
      null;

    return {
      row,
      progress: this._progress(rows),
      pending: this._pending(rows),
      replacedRowKey: null,
      skippedCount: 0,
    };
  }

  // --- Internals -------------------------------------------------------------

  /**
   * The row a key addresses: by its own key, then by any entry's line id.
   *
   * The second lookup is the server's rule and not a convenience (backend `0136`):
   * a row whose anchor was just bought to zero must not turn the next tap on the
   * same row into a not found.
   */
  private _requireRow(rowKey: string): BasketRow {
    const rows = this._rows();
    const row =
      rows.find((held) => held.rowKey === rowKey) ??
      rows.find((held) =>
        held.entries.some((entry) => entry.lineId === rowKey)
      );

    if (row === undefined) {
      throw this._refuse('not_found', 404, 'No such row on this basket');
    }
    return row;
  }

  /**
   * Refuse a write whose starting number has moved.
   *
   * Two phones in one shop moving one row is the ordinary case, and a gesture
   * whose meaning depends on where it started must be refused rather than
   * reinterpreted (velista `0054`).
   */
  private _requireFrom(from: number, actual: number): void {
    if (from !== actual) {
      throw this._refuse(
        'stale_quantity',
        409,
        'Somebody else changed this line'
      );
    }
  }

  private _requireLive(): void {
    if (!isOpenBasket(this.status)) {
      throw this._refuse('basket_finished', 409, 'This basket is finished');
    }
  }

  private _refuse(
    code: ErrorCode,
    status: number,
    detail: string
  ): GatewayError {
    return new GatewayError({
      code,
      status,
      correlationId: 'memory',
      detail,
    });
  }

  /** Guests do not inspect each other (plan 0051, section 5.2). */
  private _withoutDevice(person: BasketParticipant): BasketParticipant {
    const { device: _device, ...rest } = person;
    return rest;
  }
}
