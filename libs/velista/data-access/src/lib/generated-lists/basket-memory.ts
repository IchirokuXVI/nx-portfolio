import { Injectable } from '@angular/core';
import {
  basketTakesLines,
  type BasketAddLineRequest,
  type BasketLine,
  type BasketLineOrigin,
  type BasketLineOriginDetail,
  type BasketLineOrigins,
  type BasketLinkPreview,
  type BasketOriginCandidate,
  type BasketOriginQuantityRequest,
  type BasketOriginQuantityResult,
  type BasketOutstandingRequest,
  type BasketParticipant,
  type BasketPriceScope,
  type BasketProduct,
  type BasketSession,
  type BasketSettleRequest,
  type BasketSettleResult,
  type BasketShare,
  type BasketShareLink,
  type BasketSplitRequest,
  type BasketSplitResult,
  type BasketView,
  type CatalogSuggestion,
  type LineApprovalStatus,
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

/**
 * When two lines of one basket are the same line (backend `0094`, section 5).
 *
 * > Two basket lines merge when their normalized content is equal and their
 * > products are equal or one of them has none.
 *
 * A basket cannot merge by name alone, which is the whole reason this rule
 * exists: a split makes siblings that share a name on purpose, and folding them
 * together would put two products on a row that may hold one. The "or one of them
 * has none" half is what makes a typed "Milk" land on the Milk that is already
 * there, and what lets a group added line, which carries options and no pick, be
 * the row a later choice lands on.
 *
 * `candidates` is every **other** line of the basket. The caller excludes the
 * line being placed, which is what stops a share merging back into the row it
 * came from.
 */
function findBasketMergeTarget(
  candidates: readonly BasketLine[],
  incoming: { content: string; pickId: string | null }
): BasketLine | null {
  const name = normalizeContent(incoming.content);
  const matches = candidates
    .filter((line) => normalizeContent(line.content) === name)
    .filter(
      (line) =>
        line.pickId === incoming.pickId ||
        line.pickId === null ||
        incoming.pickId === null
    )
    // Earliest first, so case 3 below is a `[0]` rather than a second sort.
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

  if (matches.length === 0) {
    return null;
  }
  // 1. A line with the same product. An exact identity beats every fallback,
  //    including a product free row that happens to sit above it.
  const sameProduct = matches.find((line) => line.pickId === incoming.pickId);
  if (sameProduct) {
    return sameProduct;
  }
  // 2. The incoming names no product, so the row that names none is the honest
  //    home for it: choosing one of the named rows would choose a product.
  if (incoming.pickId === null) {
    const noProduct = matches.find((line) => line.pickId === null);
    if (noProduct) {
      return noProduct;
    }
  }
  // 3. Otherwise the earliest by position, which is the survivor rule asked one
  //    step early.
  return matches[0];
}

/** Two option lists as one, in the first's order, with no repeats. */
function unionOf(
  held: readonly string[],
  incoming: readonly string[]
): readonly string[] {
  return [...new Set([...held, ...incoming])];
}

/** The basket every read here is about. */
const BASKET_ID = 'basket-saturday';

/** The one scope the mock prices against: Mercadona's Córdoba warehouse. */
const SCOPE_MERCADONA = 'scope-mercadona-cordoba';

/**
 * A price on a product, for the pick sheet to have something to compare.
 *
 * The pick on the milk line is Hacendado, which is **not** the cheapest here on
 * purpose: the sheet's whole point is showing that the default was chosen by
 * insertion order and the cheaper option is one tap away (velista `0062`,
 * section 5.2). The third milk carries no price, which is the mix section 5.3
 * draws, and the eggs are priced so the row caption has a number on it.
 */
const offer = (
  price: number,
  unitPrice: number | null,
  unitPriceLabel: string | null
): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice,
  unitPriceLabel,
  observedAt: new Date('2026-09-01T06:00:00.000Z'),
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId: SCOPE_MERCADONA,
});

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
    offer: offer(0.95, 0.95, 'EUR/L'),
  },
  {
    id: 'item-milk-pascual',
    name: { en: 'Pascual whole milk, 1 L', es: 'Leche entera Pascual, 1 L' },
    brand: 'Pascual',
    size: 1,
    unit: 'LITER',
    offer: offer(0.89, 0.89, 'EUR/L'),
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
    offer: null,
  },
  {
    id: 'item-eggs',
    name: { en: 'Free range eggs, 12', es: 'Huevos camperos, 12' },
    brand: 'Hacendado',
    size: 12,
    unit: 'UNIT',
    offer: offer(2.85, 0.24, 'EUR/ud'),
  },
];

/** The scope those offers name, with its shops for a reader who passes the rule. */
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
    ],
  },
];

/**
 * The zone lists this fake knows about, named.
 *
 * One table rather than names repeated on every origin, candidate and target,
 * because the three surfaces have to agree about what a list is called: a sheet
 * that adopted "Office kitchen" and then drew "Studio" on the row would be a bug
 * that only ever appears in development.
 *
 * The first two are the run's own sources, which is what `fromRun` means on a
 * target and what makes the other three candidates worth having: a line the run
 * matched in two households and could have matched in three.
 */
const LISTS: Readonly<
  Record<string, { zoneId: string; listName: string; zoneName: string }>
> = {
  'list-weekly': {
    zoneId: 'zone-flat',
    listName: 'Weekly shop',
    zoneName: 'Flat 3B',
  },
  'list-groceries': {
    zoneId: 'zone-parents',
    listName: 'Groceries',
    zoneName: 'Parents’ house',
  },
  'list-office': {
    zoneId: 'zone-office',
    listName: 'Office kitchen',
    zoneName: 'The studio',
  },
  'list-shared': {
    zoneId: 'zone-share',
    listName: 'Shared shelf',
    zoneName: 'Housemates',
  },
  'list-cabin': {
    zoneId: 'zone-cabin',
    listName: 'Cabin trip',
    zoneName: 'Weekend away',
  },
};

/**
 * What the zone side of one origin holds, which the basket read never carries.
 *
 * Two numbers the units sheet cannot be written against without: what the
 * household's own line asks for, and how many of this line this basket has already
 * bought against it, which is the floor a contribution may not go under.
 */
interface OriginFacts {
  listQuantity: number;
  settledHere: number;
  /**
   * The zone line's own approval, which the basket read carries even less than the
   * two numbers above: a line raised onto a list that vets its lines is waiting,
   * and the row that raised it is the only thing standing there to say so.
   *
   * Defaulted to `APPROVED` by {@link BasketMemory._facts}, because every line this
   * fake starts with is one a run already drew from a list that had accepted it.
   */
  approvalStatus: LineApprovalStatus;
}

/**
 * The lists holding the same thing that the run did **not** take, for `line-milk`.
 *
 * Three, and they are three because the sheet draws three different things: one
 * that can be adopted, one another basket is already carrying, and one the
 * household said no to. A fake with only the first would let a screen ship that
 * draws every candidate as a reel.
 *
 * The two refusals are the two backend `0092` section 3.2 left standing. A pending
 * line and a line at zero are both adoptable now, so neither appears here.
 */
const MILK_CANDIDATES: readonly BasketOriginCandidate[] = [
  {
    listId: 'list-office',
    lineId: 'zl-office-milk',
    zoneId: LISTS['list-office'].zoneId,
    listName: LISTS['list-office'].listName,
    zoneName: LISTS['list-office'].zoneName,
    listQuantity: 2,
    content: 'Milk',
    matchedOnText: false,
    unavailable: null,
    fromRun: false,
  },
  {
    listId: 'list-shared',
    lineId: 'zl-shared-milk',
    zoneId: LISTS['list-shared'].zoneId,
    listName: LISTS['list-shared'].listName,
    zoneName: LISTS['list-shared'].zoneName,
    listQuantity: 1,
    content: 'Whole milk',
    // Matched on the words alone, which is the run's last resort and the one class
    // of match that can be wrong. The sheet says so rather than presenting it as an
    // identity.
    matchedOnText: true,
    unavailable: 'CLAIMED',
    fromRun: false,
  },
  {
    listId: 'list-cabin',
    lineId: 'zl-cabin-milk',
    zoneId: LISTS['list-cabin'].zoneId,
    listName: LISTS['list-cabin'].listName,
    zoneName: LISTS['list-cabin'].zoneName,
    listQuantity: 4,
    content: 'Milk',
    matchedOnText: false,
    unavailable: 'REJECTED',
    fromRun: false,
  },
];

/** Which lists the run drew from, which is what the sheet draws first. */
const SOURCE_LIST_IDS: readonly string[] = ['list-weekly', 'list-groceries'];

/**
 * The one list that does not accept a raised line on its own.
 *
 * So a raise can answer `PENDING` and `APPROVED` without a second fake, which is
 * the whole of what the row's "waiting for the list to agree" caption and the
 * basket row's own "waiting for that list to approve it" need to be developed
 * against.
 */
const APPROVES_BY_HAND = 'list-groceries';

/**
 * A list whose add lands on a line the read never offered (backend `0092`, 4.2).
 *
 * The name fold: `line.add` answers the line it landed on, and after `0091` that
 * can be an existing line the candidate read did not match, because the names fold
 * together on the list and the products do not. The sheet has to take the answered
 * line rather than the one it asked for, and this is the fixture that proves it
 * does without a backend.
 */
const FOLDS_ONTO: Readonly<Record<string, string>> = {
  'list-cabin': 'zl-cabin-existing',
};

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
 * A shared basket, in memory, for development and for specs (rule D5's fixture
 * half).
 *
 * ## What it models that a kinder fake would not
 *
 * A fake that is more permissive than the server lets a bug through, so this one
 * keeps the three rules the screen's correctness actually rests on:
 *
 * - **The reader decides what comes back.** {@link seesZoneData} is a knob, and
 *   when it is false the answer genuinely lacks `origins` and `sources` rather
 *   than carrying them behind a flag. A page that read them anyway would render
 *   correctly against a fake that always sent them and leak on the real one.
 * - **A settle is cumulative and capped.** Settling twice finishes a line;
 *   settling more than is outstanding settles what is outstanding.
 * - **A share must name one of the line's own options**, refused as a 400
 *   otherwise, because that check is the only thing stopping this route
 *   repointing a line at any product in the catalog.
 * - **A split merges by content and product**, with the survivor and the tie
 *   break of backend `0094` section 5. A fake that merged by name alone would
 *   fold two siblings that share a name on purpose, and would pass a sheet the
 *   server refuses.
 *
 * ## What it does not model
 *
 * Revocation, which needs a second actor, and the participant credential, which
 * is `BasketApi`'s business and not this interface's: no method here takes one.
 */
@Injectable()
export class BasketMemory implements BasketServiceI {
  /**
   * Whether the reader passes the all or nothing rule.
   *
   * Public and mutable so a spec, or a developer poking at the screen, can look
   * at the guest's view and the owner's without a second fake.
   */
  seesZoneData = true;

  /** Who this fake answers as. Guests get the redacted view whatever this says. */
  me: BasketParticipant = OWNER;

  /**
   * Where this basket has got to, so a developer can look at a finished one.
   *
   * Public and mutable for {@link seesZoneData}'s reason: the screen draws no
   * composer over a finished basket, and that branch is otherwise unreachable
   * without a second fake.
   */
  status = 'ACTIVE';

  /** The catalog behind the composer's dropdown. See {@link suggest}. */
  private readonly _catalog = new CatalogMemory();

  /** How many lines have been typed into this basket, for their ids. */
  private _added = 0;

  /** How many siblings a split has made here, for their ids. */
  private _split = 0;

  /** How many lines this fake has created on a household's list, for their ids. */
  private _bound = 0;

  /**
   * The zone side of every origin, keyed by origin id.
   *
   * Beside {@link _lines} rather than on the origins themselves, because the basket
   * read genuinely does not carry these two numbers: they cost a join per list and
   * are asked for by one sheet about one line. A fake that put them on the row would
   * let a screen ship that reads them off a line the server never fills them on.
   */
  private _originFacts = new Map<string, OriginFacts>([
    ['o-1', { listQuantity: 2, settledHere: 0, approvalStatus: 'APPROVED' }],
    ['o-2', { listQuantity: 1, settledHere: 0, approvalStatus: 'APPROVED' }],
    // Two of the eggs have been bought against this list, which is the floor a
    // contribution may not go under. It is here so `below_settled` is reachable
    // without arranging a purchase first.
    ['o-3', { listQuantity: 12, settledHere: 2, approvalStatus: 'APPROVED' }],
    // The bread was closed by a shop that had none, which settles the line and buys
    // nothing, so nothing has been bought against this origin.
    ['o-4', { listQuantity: 1, settledHere: 0, approvalStatus: 'APPROVED' }],
  ]);

  private _lines: BasketLine[] = [
    {
      id: 'line-milk',
      content: 'Milk',
      quantity: 3,
      settled: 0,
      waitingSettled: 0,
      pickId: 'item-milk-hacendado',
      optionIds: [
        'item-milk-hacendado',
        'item-milk-pascual',
        'item-milk-central',
      ],
      position: 0,
      // Null on all three, because the run composed them: a derived line was put
      // there by the generation and not by a person (luna `0055`, section 4).
      createdBy: null,
      touchedBy: null,
      touchedAt: null,
      lastOutcome: null,
      // Composed by the run, so it is `DERIVED` and can never be sent to a list: it
      // already has the two it came from. Its `targetListId` is null rather than
      // absent because this reader passes the rule; `_project` is what takes it away
      // from one who does not.
      kind: 'DERIVED',
      targetListId: null,
      origins: [
        {
          id: 'o-1',
          zoneId: 'zone-flat',
          listId: 'list-weekly',
          lineId: 'zl-1',
          quantity: 2,
        },
        {
          id: 'o-2',
          zoneId: 'zone-parents',
          listId: 'list-groceries',
          lineId: 'zl-2',
          quantity: 1,
        },
      ],
    },
    {
      id: 'line-eggs',
      content: 'Eggs',
      quantity: 12,
      settled: 2,
      waitingSettled: 0,
      pickId: 'item-eggs',
      optionIds: ['item-eggs'],
      position: 1,
      createdBy: null,
      touchedBy: REGISTERED.id,
      touchedAt: new Date('2026-09-01T10:20:00.000Z'),
      lastOutcome: 'BOUGHT',
      kind: 'DERIVED',
      targetListId: null,
      origins: [
        {
          id: 'o-3',
          zoneId: 'zone-flat',
          listId: 'list-weekly',
          lineId: 'zl-3',
          quantity: 12,
        },
      ],
    },
    {
      id: 'line-bread',
      content: 'Sourdough loaf',
      quantity: 1,
      settled: 1,
      waitingSettled: 0,
      pickId: null,
      optionIds: [],
      position: 2,
      createdBy: null,
      touchedBy: GUEST.id,
      touchedAt: new Date('2026-09-01T10:45:00.000Z'),
      // The shop had none: same numbers as a purchase, opposite meaning.
      lastOutcome: 'NOT_AVAILABLE',
      kind: 'DERIVED',
      targetListId: null,
      origins: [
        {
          id: 'o-4',
          zoneId: 'zone-flat',
          listId: 'list-weekly',
          lineId: 'zl-4',
          quantity: 1,
        },
      ],
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
      generatedListId: BASKET_ID,
      participantId: joined.id,
      secret: `secret-${joined.id}`,
      socketToken: 'socket-token',
      socketTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async getBasket(): Promise<BasketView> {
    return {
      id: BASKET_ID,
      name: 'Saturday big shop',
      status: this.status,
      generatedAt: new Date('2026-09-01T08:00:00.000Z'),
      lines: this._lines.map((line) => this._project(line)),
      participants: this._participants.map((person) =>
        this.seesZoneData ? person : this._withoutDevice(person)
      ),
      me: this.me,
      seesZoneData: this.seesZoneData,
      products: new Map(PRODUCTS.map((product) => [product.id, product])),
      // The chain reaches everybody and the shops reach only a reader who
      // passes the rule (backend `0066`, section 5), redacted here exactly as
      // the gateway redacts them: to an empty array, never to an absent key.
      scopes: new Map(
        SCOPES.map((scope) => [
          scope.priceScopeId,
          this.seesZoneData ? scope : { ...scope, locations: [] },
        ])
      ),
      listNames: this.seesZoneData
        ? new Map([
            ['list-weekly', 'Weekly shop · Flat 3B'],
            ['list-groceries', 'Groceries · Parents’ house'],
          ])
        : new Map(),
      ...(this.seesZoneData
        ? {
            sources: [
              { zoneId: 'zone-flat', listId: 'list-weekly' },
              { zoneId: 'zone-parents', listId: 'list-groceries' },
            ],
          }
        : {}),
    };
  }

  async settle(
    _generatedListId: string,
    lineId: string,
    body: BasketSettleRequest
  ): Promise<BasketSettleResult> {
    this._requireLive();
    const line = this._lines.find((row) => row.id === lineId);
    if (!line) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'Line not found',
      });
    }

    const remaining = Math.max(0, line.quantity - line.settled);
    if (remaining === 0) {
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: 'memory',
        detail: 'This line is already finished',
      });
    }

    // NOT_AVAILABLE closes the outstanding amount and claims nothing was bought,
    // which is why it ignores any number it was given.
    const advance =
      body.outcome === 'NOT_AVAILABLE'
        ? remaining
        : Math.min(remaining, body.quantity ?? remaining);

    const settled: BasketLine = {
      ...line,
      settled: line.settled + advance,
      // A purchase on a line no list has yet is written anyway and waits for one
      // (backend `0093`, section 2). Only a purchase: `NOT_AVAILABLE` says the shop
      // had none, which is about the product rather than about units, so it adds
      // nothing to what is waiting for a home.
      waitingSettled:
        line.waitingSettled +
        (this._unplaced(line) && body.outcome === 'BOUGHT' ? advance : 0),
      pickId: body.itemId ?? line.pickId,
      touchedBy: this.me.id,
      touchedAt: new Date(),
      lastOutcome: body.outcome,
    };
    this._lines = this._lines.map((row) => (row.id === lineId ? settled : row));

    return {
      line: this._project(settled),
      skippedCount: 0,
      // Absent for a reader who may not have it, exactly as the server answers.
      ...(this.seesZoneData ? { skipped: [] } : {}),
    };
  }

  /**
   * Take a finished line back to fully outstanding (luna `0054`, section 3).
   *
   * The whole line and never a number of units, which is what makes `settled: 0` the
   * whole of it here. `lastOutcome` goes with it: it is what the row's caption and its
   * status glyph both read to tell a purchase from a shop that had none, and leaving
   * the old one behind would caption an outstanding line with what somebody did to it
   * before it was reopened.
   *
   * A line with nothing settled is a **conflict** rather than a validation failure,
   * matching what luna `0054` section 4 does to the settle: there is nothing to undo,
   * and the state is the reason.
   */
  async reopen(
    _generatedListId: string,
    lineId: string
  ): Promise<BasketSettleResult> {
    this._requireLive();
    const line = this._lines.find((row) => row.id === lineId);
    if (!line) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'Line not found',
      });
    }

    if (line.settled === 0) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
        detail: 'This line has nothing settled against it',
      });
    }

    const reopened: BasketLine = {
      ...line,
      settled: 0,
      // A reverted waiting row is history and not a fact about any list, so it is in
      // no total any more and is never re-homed (backend `0093`, section 3.2).
      waitingSettled: 0,
      touchedBy: this.me.id,
      touchedAt: new Date(),
      lastOutcome: null,
    };
    this._lines = this._lines.map((row) =>
      row.id === lineId ? reopened : row
    );

    return {
      line: this._project(reopened),
      skippedCount: 0,
      // Absent for a reader who may not have it, exactly as the server answers.
      ...(this.seesZoneData ? { skipped: [] } : {}),
    };
  }

  /**
   * Say how many of a line are still to get (velista `0054`).
   *
   * The three outcomes are the plan's three, and the fake keeps all of them because
   * they are what the row's caption has to tell apart: **above** the current amount
   * the basket asks for more and nothing is bought, **below** it the difference was
   * bought, and **equal** is a gesture that ended where it began, which succeeds and
   * writes nothing.
   *
   * The `from` check is not decoration either. It is the one rule that stops two
   * phones in one shop silently inverting each other's gesture, and a fake that
   * applied the number anyway would let a screen ship with no refetch on it.
   */
  async setOutstanding(
    _generatedListId: string,
    lineId: string,
    body: BasketOutstandingRequest
  ): Promise<BasketSettleResult> {
    const line = this._require(lineId);
    this._requireLive();

    const current = Math.max(0, line.quantity - line.settled);
    if (body.from !== current) {
      throw new GatewayError({
        code: 'stale_quantity',
        status: 409,
        correlationId: 'memory',
        // The number travels inside the translated message on the wire, and the
        // client derives its own rather than parsing one: it refetches and reads
        // the line. This detail is developer text, like every other one here.
        detail: `This line has ${current} outstanding now`,
      });
    }

    const wanted = Math.max(0, Math.round(body.outstanding));
    if (wanted === current) {
      // A success that changes nothing. Refusing it would make a control that
      // snapped back to where it started report a failure.
      return this._settleResult(line);
    }

    const moved: BasketLine =
      wanted > current
        ? // The basket asks for more. Nothing is bought and no outcome is written:
          // raising what is still to get is not a purchase.
          { ...line, quantity: line.quantity + (wanted - current) }
        : {
            ...line,
            settled: line.settled + (current - wanted),
            // Lowering the number is a purchase by another name, so it waits for a
            // list exactly as the settle sheet's does (backend `0093`, section 2).
            waitingSettled:
              line.waitingSettled +
              (this._unplaced(line) ? current - wanted : 0),
            touchedBy: this.me.id,
            touchedAt: new Date(),
            lastOutcome: 'BOUGHT',
          };

    this._lines = this._lines.map((row) => (row.id === lineId ? moved : row));
    return this._settleResult(moved);
  }

  /**
   * Every list this reader may write, in three collections (backend `0092`).
   *
   * Refused outright to a guest and to a reader who does not pass the rule, rather
   * than answered empty. A redacted version of this answer would be an empty sheet,
   * which reads as "no household wants this" and is a worse lie than a refusal.
   *
   * An `ADDED` line answers empty on the first two collections and **every list on
   * the third**, which is the case velista `0068` exists for: a line somebody typed
   * in an aisle is the one that most needs the sheet, and the old fake answering it
   * empty is what let a screen ship with no way in for it.
   */
  async getLineOrigins(
    _generatedListId: string,
    lineId: string
  ): Promise<BasketLineOrigins> {
    this._requireZoneReader();
    const line = this._require(lineId);

    const origins = (line.origins ?? []).map((origin) => this._detail(origin));
    const taken = new Set(origins.map((origin) => origin.listId));

    // Only milk has any, which is enough: it is the line the run matched in two
    // households and could have matched in three. A candidate already adopted stops
    // being one, which the filter keeps true after a write rather than only on the
    // first read.
    const candidates =
      lineId === 'line-milk'
        ? MILK_CANDIDATES.filter((candidate) => !taken.has(candidate.listId))
        : [];
    const matching = new Set(candidates.map((candidate) => candidate.listId));

    return {
      lineId,
      origins,
      candidates,
      // The partition the contract states: every list this fake knows that is
      // neither an origin nor a candidate. Composed rather than listed, so a list
      // cannot appear in two collections at once however the write moves it.
      others: Object.keys(LISTS)
        .filter((listId) => !taken.has(listId) && !matching.has(listId))
        .map((listId) => ({
          listId,
          zoneId: LISTS[listId].zoneId,
          listName: LISTS[listId].listName,
          zoneName: LISTS[listId].zoneName,
          fromRun: SOURCE_LIST_IDS.includes(listId),
        })),
    };
  }

  /**
   * Set what one list asked for through this line (velista `0055`, widened by
   * backend `0092`).
   *
   * **It never buys anything**, which is the rule the whole sheet rests on:
   * `settled` and `lastOutcome` are copied through untouched whichever way the
   * number goes. Moving a household's share up is not a purchase, and moving it
   * down is not a refund.
   *
   * The line's own quantity follows the delta and is floored at what has been
   * settled, because a basket cannot ask for fewer than it has already bought.
   *
   * ## Three cases, decided by what exists
   *
   * An origin is **edited**, a candidate is **adopted**, and a list holding no
   * matching line has one **created** on it. The fake keeps all three because the
   * sheet's arithmetic differs between them: adoption takes over the demand the list
   * already had before it adds any (backend `0092`, section 4.1), and creation
   * starts under that list's own approval rule.
   */
  async setOriginQuantity(
    _generatedListId: string,
    lineId: string,
    body: BasketOriginQuantityRequest
  ): Promise<BasketOriginQuantityResult> {
    this._requireZoneReader();
    this._requireLive();
    const line = this._require(lineId);

    const origins = line.origins ?? [];
    const held =
      origins.find((origin) => origin.listId === body.listId) ?? null;
    // Only milk has candidates, and the read says so, so the write has to agree:
    // asking any other line about them would make a list that holds no such line
    // look like one that does, and creation would never be reached.
    const candidate =
      held === null && lineId === 'line-milk'
        ? (MILK_CANDIDATES.find((option) => option.listId === body.listId) ??
          null)
        : null;

    const current = held?.quantity ?? 0;
    if (body.from !== current) {
      throw new GatewayError({
        code: 'stale_quantity',
        status: 409,
        correlationId: 'memory',
        detail: `This list is contributing ${current} now`,
      });
    }

    const facts =
      held === null
        ? {
            listQuantity: candidate?.listQuantity ?? 0,
            settledHere: 0,
            approvalStatus: 'APPROVED' as LineApprovalStatus,
          }
        : this._facts(held.id);

    const wanted = Math.max(0, Math.round(body.quantity));
    if (wanted < facts.settledHere) {
      throw new GatewayError({
        code: 'below_settled',
        status: 409,
        correlationId: 'memory',
        detail: `${facts.settledHere} have already been bought for this list`,
      });
    }

    // A reel let go where it started costs nothing, and a zone line is never
    // created for none of something (backend `0092`, section 4.2).
    if (held === null && wanted === 0) {
      return { line: this._project(line), origin: null, listQuantity: 0 };
    }

    const creating = held === null && candidate === null;
    const delta = wanted - current;
    const listQuantity = creating
      ? // The list had no line, so what it asks for is what was raised.
        wanted
      : held === null
        ? // Adoption takes over the demand that is already there: up to what the
          // list asks for, nothing moves, and above it the difference is new.
          Math.max(facts.listQuantity, wanted)
        : Math.max(0, facts.listQuantity + delta);

    // Upserted, so all three cases are one path: an adoption arrives carrying the
    // ids the sheet was handed, and a creation is answered the ids of the line the
    // add landed on, which is not always a new one.
    const originId = held?.id ?? `o-raised-${(this._bound += 1)}`;
    const zoneLineId = creating
      ? // The name fold: the add can land on a line the read never offered, and the
        // answer is what the sheet has to keep (backend `0092`, section 4.2).
        (FOLDS_ONTO[body.listId] ?? `zl-raised-${this._bound}`)
      : (held?.lineId ?? body.lineId ?? '');
    const next: BasketLineOrigin = {
      id: originId,
      zoneId:
        held?.zoneId ?? candidate?.zoneId ?? LISTS[body.listId]?.zoneId ?? '',
      listId: body.listId,
      lineId: zoneLineId,
      quantity: wanted,
    };

    const kept =
      wanted === 0
        ? origins.filter((origin) => origin.listId !== body.listId)
        : held === null
          ? [...origins, next]
          : origins.map((origin) =>
              origin.listId === body.listId ? next : origin
            );

    // Purchases made before the line reached any list come home with it, oldest
    // first and only up to what this list asked for (backend `0093`, section 3).
    // Only on the write that **puts a list on the line**: an edit of an origin that
    // was already there has nothing waiting to claim.
    const cameHome = held === null ? Math.min(line.waitingSettled, wanted) : 0;

    if (wanted === 0) {
      this._originFacts.delete(originId);
    } else {
      this._originFacts.set(originId, {
        listQuantity,
        settledHere: facts.settledHere + cameHome,
        // A created line starts under the list's own rule, and an adopted or
        // edited one keeps whatever it already had.
        approvalStatus: creating
          ? body.listId === APPROVES_BY_HAND
            ? 'PENDING'
            : 'APPROVED'
          : facts.approvalStatus,
      });
    }

    const moved: BasketLine = {
      ...line,
      // Floored at what has been settled: a basket cannot ask for fewer than it has
      // already bought, whatever the households behind it now want. The basket line
      // moves by the whole delta even on an adoption, because the basket will buy
      // all of what the list asked for.
      quantity: Math.max(line.settled, line.quantity + delta),
      // What is left unplaced. Units that fit nowhere stay waiting, and the next
      // list the line reaches gets them.
      waitingSettled: line.waitingSettled - cameHome,
      origins: kept,
    };
    this._lines = this._lines.map((row) => (row.id === lineId ? moved : row));

    return {
      line: this._project(moved),
      // Null and not omitted: the list came off the line, and the sheet has to drop
      // the row rather than leave it drawn at its old number.
      origin: wanted === 0 ? null : this._detail(next),
      listQuantity,
    };
  }

  /**
   * Give units of a line to other products, which splits it (backend `0094`).
   *
   * ## Why this fake carries the whole rule and not a sketch of it
   *
   * The pane's specs and the e2e that shops walk this without a backend, and a
   * fake that merged by name alone would pass a sheet the server refuses: a
   * split makes siblings that **share a name on purpose**, so folding them
   * together would put two products on a row that may hold one. So the merge
   * rule of section 5 is here in full, tie break and survivor included.
   *
   * What is deliberately **not** here is the origin allocation of section 3.1.
   * The units move and the origins do not, because a fake basket's origins are a
   * fixture rather than a ledger and every screen this fake serves reads them for
   * a caption. Splitting them would make the units sheet disagree with itself for
   * no screen's benefit.
   */
  async splitLine(
    _generatedListId: string,
    lineId: string,
    body: BasketSplitRequest
  ): Promise<BasketSplitResult> {
    this._requireLive();
    const line = this._lines.find((row) => row.id === lineId);
    if (!line) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'Line not found',
      });
    }

    const outstanding = Math.max(0, line.quantity - line.settled);
    if (body.from !== outstanding) {
      // Two phones splitting one line must not double it, so the number the pane
      // opened with has to be the number it still is (backend `0056`, section
      // 3.2). The store refetches on this code and the pane says so beside it.
      throw new GatewayError({
        code: 'stale_quantity',
        status: 409,
        correlationId: 'memory',
        detail: 'This line has changed since it was read',
      });
    }

    const shares = this._checkShares(body.shares, line);
    if (shares.length === 0) {
      // Every stepper was at zero, which is what a pane sends when nothing was
      // touched. Nothing is written, rather than an error for a gesture that said
      // nothing.
      return {
        line: this._project(line),
        created: [],
        merged: [],
        removed: [],
      };
    }

    const asked = shares.reduce((sum, share) => sum + share.quantity, 0);
    if (asked > outstanding) {
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: 'memory',
        detail: 'That is more than this line still has to get',
      });
    }

    return this._applySplit(line, shares, outstanding - asked);
  }

  /**
   * Zeroes out, and the two refusals the pane must never be able to send.
   *
   * The line's own product is refused rather than ignored, because it is the
   * balance: naming it as a share says two things about one number.
   */
  private _checkShares(
    shares: readonly BasketShare[],
    line: BasketLine
  ): BasketShare[] {
    const kept: BasketShare[] = [];
    for (const share of shares) {
      if (!Number.isInteger(share.quantity) || share.quantity < 0) {
        throw new GatewayError({
          code: 'validation_failed',
          status: 400,
          correlationId: 'memory',
          detail: 'A quantity must be a whole number',
        });
      }
      if (share.quantity === 0) {
        continue;
      }
      if (share.itemId === line.pickId) {
        throw new GatewayError({
          code: 'validation_failed',
          status: 400,
          correlationId: 'memory',
          detail: 'That product is the one this line already names',
        });
      }
      if (!line.optionIds.includes(share.itemId)) {
        // `resolvePick`'s rule, unchanged: a swap is only ever to an option, so
        // this write cannot repoint a line at any product in the catalog.
        throw new GatewayError({
          code: 'validation_failed',
          status: 400,
          correlationId: 'memory',
          detail: 'That product is not one of this line’s options',
        });
      }
      kept.push({ itemId: share.itemId, quantity: share.quantity });
    }
    return kept;
  }

  /**
   * The write itself: one sibling per product with no row yet, a raise for one
   * that has, and the original keeping the balance.
   *
   * The order of the loop is the order of the shares, which is what makes the
   * siblings sit under the original in the order the pane listed them: each one
   * takes the midpoint between the last row placed and the line that follows.
   */
  private _applySplit(
    line: BasketLine,
    shares: readonly BasketShare[],
    balance: number
  ): BasketSplitResult {
    const now = new Date();
    // With nothing settled and nothing left over the original is **reassigned**
    // rather than deleted (section 2.2), so its id, its position and its "who put
    // this here" survive. Taken by the first share with nowhere better to go.
    const emptied = balance === 0 && line.settled === 0;
    let reassigned = false;

    const created: BasketLine[] = [];
    const merged: BasketLine[] = [];
    // Every row a later share may land on. The original is not in it until it has
    // been reassigned: before that it is the row being split, and a product free
    // one would match the merge rule and take a share straight back.
    let candidates = this._lines.filter((row) => row.id !== line.id);

    let original = line;
    const nextPosition = this._positionsAfter(line);

    for (const share of shares) {
      const target = findBasketMergeTarget(candidates, {
        content: line.content,
        pickId: share.itemId,
      });

      if (!target && emptied && !reassigned) {
        reassigned = true;
        original = {
          ...original,
          pickId: share.itemId,
          quantity: share.quantity,
          touchedBy: this.me.id,
          touchedAt: now,
        };
        candidates = [...candidates, original];
        continue;
      }

      if (target) {
        const raised: BasketLine = {
          ...target,
          // A survivor with no product takes the incoming one, which is what
          // makes a group added line the row a later choice lands on.
          pickId: target.pickId ?? share.itemId,
          quantity: target.quantity + share.quantity,
          optionIds: unionOf(target.optionIds, line.optionIds),
          touchedBy: this.me.id,
          touchedAt: now,
        };
        candidates = candidates.map((row) =>
          row.id === raised.id ? raised : row
        );
        this._lines = this._lines.map((row) =>
          row.id === raised.id ? raised : row
        );
        const already = merged.findIndex((row) => row.id === raised.id);
        if (already === -1) {
          merged.push(raised);
        } else {
          merged[already] = raised;
        }
        continue;
      }

      const sibling: BasketLine = {
        ...line,
        id: `line-split-${(this._split += 1)}`,
        pickId: share.itemId,
        quantity: share.quantity,
        settled: 0,
        waitingSettled: 0,
        position: nextPosition(),
        // The original's, and not the actor's: the person who put milk here put
        // this milk here (section 3).
        createdBy: line.createdBy,
        touchedBy: this.me.id,
        touchedAt: now,
        lastOutcome: null,
        // Deliberately none. The units moved and this fake's origins did not; see
        // the note on {@link splitLine}.
        origins: [],
      };
      created.push(sibling);
      candidates = [...candidates, sibling];
    }

    const removed: string[] = [];
    if (emptied && !reassigned) {
      // Every share found a row of its own, so the original kept nothing. It is
      // folded away rather than left as a row of zero, which is how moving every
      // unit back off a sibling ends.
      removed.push(original.id);
      this._lines = this._lines.filter((row) => row.id !== original.id);
    } else if (!reassigned) {
      original = {
        ...original,
        quantity: original.settled + balance,
        touchedBy: this.me.id,
        touchedAt: now,
      };
    }

    if (removed.length === 0) {
      this._lines = this._lines.map((row) =>
        row.id === original.id ? original : row
      );
    }
    this._lines = [...this._lines, ...created].sort(
      (a, b) => a.position - b.position
    );

    const folded = removed.includes(original.id);
    return {
      // A folded original is gone, so the row this answer is about is the one its
      // units went to. The client removes the old id and redraws that one.
      line: this._project(
        folded ? (merged[0] ?? created[0] ?? original) : original
      ),
      created: created.map((row) => this._project(row)),
      merged: merged.map((row) => this._project(row)),
      removed,
    };
  }

  /**
   * Where each sibling goes: the midpoint between the last row placed and the
   * line that follows the original, so they sit directly under it in share order
   * and nothing else moves.
   */
  private _positionsAfter(line: BasketLine): () => number {
    const after = this._lines.find((row) => row.position > line.position);
    const ceiling = after ? after.position : line.position + 1;
    let previous = line.position;
    return () => {
      previous = (previous + ceiling) / 2;
      return previous;
    };
  }

  /**
   * Put a line in the basket, as whoever this fake is answering as.
   *
   * Two of the server's rules are kept, because they are the two the screen's
   * correctness rests on:
   *
   * - **A finished basket takes nothing**, with a code of its own rather than a
   *   validation failure, so the page can say "this basket is finished" instead of
   *   "that did not work" (luna `0055`, section 3.3).
   * - **The line is created with no origins at all**, which is not the same as the
   *   redaction {@link _project} performs: it is an `ADDED` line and it genuinely
   *   came from nowhere, so the row draws no "from" caption for **anybody**,
   *   including a reader who passes the rule. A fake that gave it the basket's
   *   origins would hide exactly that.
   */
  async addLine(
    _generatedListId: string,
    body: BasketAddLineRequest
  ): Promise<BasketLine> {
    // The same refusal every other write here gets, and by the same route since
    // velista `0057`. It used to throw a plain conflict, on the grounds that
    // `ERROR_CODES` did not carry `generated_list_finished` and that nothing
    // branched on telling the two apart. Both halves have since stopped being true:
    // the code is in `problem.ts`, luna `0059` section 3.1 widened the set of writes
    // that raise it from three to nine with the add among them, and `BasketStore`
    // now refetches on exactly this code so a field drawn over a basket somebody
    // just finished goes away with the rest of the controls.
    this._requireLive();

    const line: BasketLine = {
      id: `line-added-${(this._added += 1)}`,
      content: body.content,
      quantity: body.quantity ?? 1,
      settled: 0,
      waitingSettled: 0,
      pickId: body.itemId ?? null,
      optionIds: [...(body.options ?? [])],
      position: this._lines.length,
      // Written once, here, and never afterwards. It is the whole of what the row's
      // "added by" caption reads.
      createdBy: this.me.id,
      touchedBy: null,
      touchedAt: null,
      lastOutcome: null,
      // The one thing that makes this line sendable later (velista `0056`): a person
      // typed it, so no household's list is behind it and one may be put there.
      kind: 'ADDED',
      // Null and not a list: nothing shared has been touched yet, which is what makes
      // the gesture safe to hand to somebody who arrived on a forwarded link.
      targetListId: null,
      // Present and empty rather than absent, for a reader who may see origins:
      // "you may not see this" and "this line came from nowhere" are different
      // answers and the row draws different things for them.
      origins: [],
    };

    this._lines = [...this._lines, line];
    // Projected on the way out rather than assembled per reader, so the redaction
    // has one home: `origins` and `targetListId` are both stripped by the same rule.
    return this._project(line);
  }

  /**
   * The catalog, searched through the basket.
   *
   * Delegated to {@link CatalogMemory} rather than given a fixture of its own,
   * because the gateway route answers the account route's body field for field and
   * two fixtures would be two places for the ranking rule to drift. The scope is
   * ignored here for the reason that fake already records: there is one catalog and
   * no prices, so honouring a scope would mean inventing one.
   */
  async suggest(
    _generatedListId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]> {
    return this._catalog.suggest(query);
  }

  async listParticipants(): Promise<readonly BasketParticipant[]> {
    return this._participants.map((person) =>
      this.seesZoneData ? person : this._withoutDevice(person)
    );
  }

  async refreshSocketToken(): Promise<BasketSession> {
    return {
      generatedListId: BASKET_ID,
      participantId: this.me.id,
      secret: null,
      socketToken: 'socket-token',
      socketTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async ensureShareLink(): Promise<BasketShareLink> {
    // "Ensure" and not "create": a basket that already has a live link gets that
    // one back rather than a second.
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
    _generatedListId: string,
    cascade = false
  ): Promise<{ revoked: number }> {
    const minted = this._participants.filter(
      (person) => person.shareLinkId !== null
    );
    this._link = null;

    if (!cascade) {
      // The whole point of the default: the link stops spreading and everybody
      // already shopping keeps working.
      return { revoked: 0 };
    }
    this._participants = this._participants.filter(
      (person) => person.shareLinkId === null
    );
    return { revoked: minted.length };
  }

  async revokeParticipant(
    _generatedListId: string,
    participantId: string
  ): Promise<void> {
    this._participants = this._participants.filter(
      (person) => person.id !== participantId
    );
  }

  /** The line, or the 404 every route here answers for one that is not there. */
  private _require(lineId: string): BasketLine {
    const line = this._lines.find((row) => row.id === lineId);
    if (!line) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'Line not found',
      });
    }
    return line;
  }

  /**
   * Refuse a write to a basket whose trip is over.
   *
   * Its own code rather than a conflict, because the screen can explain it: the
   * owner finished this trip, so it cannot be edited any more.
   *
   * **Every write goes through it**, since velista `0057`: settling, reopening a
   * line, moving the number, swapping a pick, changing what a list asked for,
   * binding a line to one, and adding one. It used to guard three, and luna `0059`
   * section 3.1 widened the server's set to nine, so a fake that guarded three would
   * be kinder than the real thing on exactly the six writes a guest can still be
   * holding a control for when the owner presses Finish. That is the race the
   * refusal exists for, and `BasketStore` refetches on this code so the controls
   * that refused are gone by the time the sentence is drawn.
   */
  private _requireLive(): void {
    if (!basketTakesLines(this.status)) {
      throw new GatewayError({
        code: 'generated_list_finished',
        status: 409,
        correlationId: 'memory',
        detail: 'This basket is finished, so it cannot be changed',
      });
    }
  }

  /**
   * Refuse the four zone surfaces to anybody the server would refuse them to.
   *
   * A guest and a registered participant who does not pass the all or nothing rule
   * get the same 403, which is the honest fake: the server refuses the whole read
   * rather than redacting it, because a redacted answer here would be an empty sheet
   * and would read as "no household wants this".
   */
  private _requireZoneReader(): void {
    if (!this.seesZoneData || this.me.kind === 'GUEST') {
      throw new GatewayError({
        code: 'forbidden',
        status: 403,
        correlationId: 'memory',
        detail: 'You do not have access to every list behind this basket',
      });
    }
  }

  /**
   * Whether a purchase on this line has no list to be recorded against.
   *
   * The condition backend `0093` writes a waiting row on, and it is about the line
   * rather than about the person: a line the run composed has origins from the
   * start, and a line somebody typed in an aisle has none until somebody raises one.
   */
  private _unplaced(line: BasketLine): boolean {
    return (line.origins ?? []).length === 0;
  }

  /** The zone side of one origin, or zeroes for one this fake never recorded. */
  private _facts(originId: string): OriginFacts {
    return (
      this._originFacts.get(originId) ?? {
        listQuantity: 0,
        settledHere: 0,
        // Approved, which is what a line the run drew from always was, and the
        // quiet direction for one this fake has lost track of: a caption saying a
        // household is still deciding is worse when it is not.
        approvalStatus: 'APPROVED',
      }
    );
  }

  /** One origin as the units sheet reads it: the row, named, with its floor. */
  private _detail(origin: BasketLineOrigin): BasketLineOriginDetail {
    const list = LISTS[origin.listId];
    const facts = this._facts(origin.id);

    return {
      originId: origin.id,
      listId: origin.listId,
      lineId: origin.lineId,
      zoneId: origin.zoneId,
      // Null where the list no longer has a name to give, which is what a list
      // deleted since the run looks like, and what the sheet falls back for.
      listName: list?.listName ?? null,
      zoneName: list?.zoneName ?? null,
      contributed: origin.quantity,
      listQuantity: facts.listQuantity,
      settledHere: facts.settledHere,
      writable: true,
      fromRun: SOURCE_LIST_IDS.includes(origin.listId),
      approvalStatus: facts.approvalStatus,
    };
  }

  /** The shape both settle paths answer, redacted the way the server redacts it. */
  private _settleResult(line: BasketLine): BasketSettleResult {
    return {
      line: this._project(line),
      skippedCount: 0,
      // Absent for a reader who may not have it, exactly as the server answers.
      ...(this.seesZoneData ? { skipped: [] } : {}),
    };
  }

  /**
   * Strip what this reader may not see, by **omission**.
   *
   * Deleting the key rather than nulling it, because that is what the server
   * does and the difference is what the screen branches on.
   */
  private _project(line: BasketLine): BasketLine {
    if (this.seesZoneData) {
      return line;
    }
    // `targetListId` goes with `origins`, for the same reason: which household
    // list a line was sent to is a household this reader may not be told about. It
    // is stripped rather than nulled, because null is a real answer here, meaning a
    // line that has been sent nowhere, and the send control is offered over that.
    const { origins: _origins, targetListId: _targetListId, ...rest } = line;
    return rest;
  }

  private _withoutDevice(person: BasketParticipant): BasketParticipant {
    const { device: _device, ...rest } = person;
    return rest;
  }
}
