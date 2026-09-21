import { Injectable } from '@angular/core';
import {
  isOpenBasket,
  type Basket,
  type BasketLinkPreview,
  type BasketListRef,
  type BasketParticipant,
  type BasketPriceScope,
  type BasketProduct,
  type BasketProgress,
  type BasketRenameRequest,
  type BasketRenameResult,
  type BasketRevertRequest,
  type BasketRow,
  type BasketRowEntry,
  type BasketRowResult,
  type BasketRowState,
  type BasketSession,
  type BasketSettleRequest,
  type BasketShareLink,
  type CatalogSuggestion,
  type ErrorCode,
  type LiveBasketSummary,
  type ProductOffer,
} from '@portfolio/velista/models';
import { CatalogMemory } from '../catalog/catalog-memory';
import { GatewayError } from '../errors';
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
    size: 1,
    unit: 'LITER',
    // Dearer at Dia, so the Mercadona view draws no mark and the Dia view does.
    ...priced(
      offer(0.95, 0.95, 'EUR/L'),
      offer(1.05, 1.05, 'EUR/L', SCOPE_DIA)
    ),
    categories: ['DAIRY'],
  },
  {
    id: 'item-milk-pascual',
    name: { en: 'Pascual whole milk, 1 L', es: 'Leche entera Pascual, 1 L' },
    brand: 'Pascual',
    size: 1,
    unit: 'LITER',
    // Cheaper at Dia, which is the "cheaper elsewhere" mark on the Mercadona view.
    ...priced(
      offer(0.89, 0.89, 'EUR/L'),
      offer(0.79, 0.79, 'EUR/L', SCOPE_DIA)
    ),
    categories: ['DAIRY'],
  },
  {
    id: 'item-milk-central',
    name: {
      en: 'Central Lechera whole milk, 1 L',
      es: 'Leche entera Central Lechera, 1 L',
    },
    brand: 'Central Lechera Asturiana',
    size: 1,
    unit: 'LITER',
    // Priced nowhere, which is `0062` section 5.3's unpriced option among priced ones.
    ...priced(),
    categories: ['DAIRY'],
  },
  {
    id: 'item-eggs',
    name: { en: 'Free range eggs, 12', es: 'Huevos camperos, 12' },
    brand: 'Hacendado',
    size: 12,
    unit: 'UNIT',
    // Mercadona alone, so the Dia view sinks this row and says where it is sold.
    ...priced(offer(2.85, 0.24, 'EUR/ud')),
    categories: ['DAIRY'],
  },
];

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
    expiresAt: null,
    participantCount: 2,
  };

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

  async getBasket(): Promise<Basket> {
    const rows = this._rows();
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
      products: new Map(PRODUCTS.map((product) => [product.id, product])),
      // The chain reaches everybody and the shops reach only a reader served
      // them (backend `0066`, section 5), redacted here exactly as the gateway
      // redacts them: to an empty array, never to an absent key.
      scopes: new Map(
        SCOPES.map((scope) => [
          scope.priceScopeId,
          this.servesLists ? scope : { ...scope, locations: [] },
        ])
      ),
      progress: this._progress(rows),
      pending: this._pending(rows),
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
  async getLiveBasket(): Promise<Basket> {
    const basket = await this.getBasket();
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
        this._write(allocation.lineId, 'BOUGHT', allocation.quantity);
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

  async ensureShareLink(): Promise<BasketShareLink> {
    this._link ??= {
      id: 'link-1',
      secret: LIVE_SECRET,
      createdAt: new Date(),
      expiresAt: null,
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

  async addParticipant(
    _basketId: string,
    userId: string
  ): Promise<BasketParticipant> {
    const held = this._participants.find((person) => person.userId === userId);
    if (held !== undefined) {
      return held;
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

      rows.push({
        rowKey: anchor.id,
        content: anchor.content,
        left,
        bought,
        asked: bought + left,
        state: this._state(lines, left, bought),
        // The window and the skip that fills these are backend `0137`'s, which
        // this fake does not model: nothing here is ever put off for now.
        note: null,
        noteAt: null,
        // Backend `0138`'s, and null until it lands, which is what the real
        // server answers today too.
        mark: null,
        awaitingApproval: entries.some((entry) => entry.awaitingApproval),
        // First seen order, anchor first, which is what the server promises and
        // what makes `optionIds[0]` the product the row means.
        optionIds: [...new Set(live.flatMap((line) => line.optionIds))],
        touchedBy: newest?.by ?? null,
        touchedAt: newest?.at ?? null,
        entries,
      });
    }

    return rows;
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
    // `SKIPPED` is tested here, once backend `0137` writes a skip.
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
    quantity: number
  ): void {
    this._settlements.push({
      id: (this._settlementId += 1),
      lineId,
      outcome,
      quantity,
      by: this.me.id,
      at: new Date(),
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

  /** What every write answers: the row as it now stands, and the counts. */
  private async _result(rowKey: string): Promise<BasketRowResult> {
    const rows = this._rows();
    const row =
      rows.find((held) => held.rowKey === rowKey) ??
      rows.find((held) =>
        held.entries.some((entry) => entry.lineId === rowKey)
      );

    if (row === undefined) {
      throw this._refuse('not_found', 404, 'That row is no longer here');
    }

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
