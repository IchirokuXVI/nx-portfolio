import { Injectable } from '@angular/core';
import {
  basketTakesLines,
  type BasketAddLineRequest,
  type BasketBindResult,
  type BasketLine,
  type BasketLineOrigin,
  type BasketLineOriginDetail,
  type BasketLineOrigins,
  type BasketLineTarget,
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
  type BasketShareLink,
  type BasketView,
  type CatalogSuggestion,
  type ProductOffer,
} from '@portfolio/velista/models';
import { CatalogMemory } from '../catalog/catalog-memory';
import { GatewayError } from '../errors';
import type { BasketServiceI } from './basket-service';

/** The one link this fake knows. Anything else is dead, like most links are. */
const LIVE_SECRET = '9f2k4tqvb1xz8mq7';

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
}

/**
 * The lists holding the same thing that the run did **not** take, for `line-milk`.
 *
 * Three, and they are three because the sheet draws three different things: one
 * that can be adopted, one another basket is already carrying, and one still
 * waiting for its own list to accept it. A fake with only the first would let a
 * screen ship that draws every candidate as a button.
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
    unavailable: 'NOT_APPROVED',
  },
];

/**
 * Where a line may be sent, with the run's own sources first.
 *
 * More than the two sources on purpose: the picker's whole job is that the list
 * somebody means is usually one of the run's and occasionally is not, and a fake
 * offering only the two would let a screen ship with no ordering at all.
 */
const TARGET_LIST_IDS: readonly string[] = [
  'list-weekly',
  'list-groceries',
  'list-office',
  'list-shared',
];

/** Which of those the run drew from, which is what the picker draws first. */
const SOURCE_LIST_IDS: readonly string[] = ['list-weekly', 'list-groceries'];

/**
 * The one list that does not accept a sent line on its own.
 *
 * So `bindLine` can answer `pendingApproval` both ways without a second fake, which
 * is the whole of what the row's "waiting for that list to approve it" caption
 * needs to be developed against.
 */
const APPROVES_BY_HAND = 'list-groceries';

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
 * - **A pick must be one of the line's own options**, refused as a 400 otherwise,
 *   because that check is the only thing stopping this route repointing a line at
 *   any product in the catalog.
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
    ['o-1', { listQuantity: 2, settledHere: 0 }],
    ['o-2', { listQuantity: 1, settledHere: 0 }],
    // Two of the eggs have been bought against this list, which is the floor a
    // contribution may not go under. It is here so `below_settled` is reachable
    // without arranging a purchase first.
    ['o-3', { listQuantity: 12, settledHere: 2 }],
    // The bread was closed by a shop that had none, which settles the line and buys
    // nothing, so nothing has been bought against this origin.
    ['o-4', { listQuantity: 1, settledHere: 0 }],
  ]);

  private _lines: BasketLine[] = [
    {
      id: 'line-milk',
      content: 'Milk',
      quantity: 3,
      settled: 0,
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
            touchedBy: this.me.id,
            touchedAt: new Date(),
            lastOutcome: 'BOUGHT',
          };

    this._lines = this._lines.map((row) => (row.id === lineId ? moved : row));
    return this._settleResult(moved);
  }

  /**
   * Which lists are on this line, and which could be (velista `0055`).
   *
   * Refused outright to a guest and to a reader who does not pass the rule, rather
   * than answered empty. A redacted version of this answer would be an empty sheet,
   * which reads as "no household wants this" and is a worse lie than a refusal.
   *
   * An `ADDED` line answers empty on both sides, which is not a redaction and is the
   * truth about it: nobody's list asked for it, and the run never looked.
   */
  async getLineOrigins(
    _generatedListId: string,
    lineId: string
  ): Promise<BasketLineOrigins> {
    this._requireZoneReader();
    const line = this._require(lineId);

    const origins = (line.origins ?? []).map((origin) => this._detail(origin));
    const taken = new Set(origins.map((origin) => origin.listId));

    return {
      lineId,
      origins,
      // Only milk has any, which is enough: it is the line the run matched in two
      // households and could have matched in three. A candidate already adopted
      // stops being one, which the filter keeps true after a write rather than only
      // on the first read.
      candidates:
        lineId === 'line-milk'
          ? MILK_CANDIDATES.filter((candidate) => !taken.has(candidate.listId))
          : [],
    };
  }

  /**
   * Set what one list contributes to this line (velista `0055`).
   *
   * **It never buys anything**, which is the rule the whole sheet rests on:
   * `settled` and `lastOutcome` are copied through untouched whichever way the
   * number goes. Moving a household's share up is not a purchase, and moving it
   * down is not a refund.
   *
   * The line's own quantity follows the delta and is floored at what has been
   * settled, because a basket cannot ask for fewer than it has already bought.
   */
  async setOriginQuantity(
    _generatedListId: string,
    lineId: string,
    body: BasketOriginQuantityRequest
  ): Promise<BasketOriginQuantityResult> {
    this._requireZoneReader();
    const line = this._require(lineId);

    const origins = line.origins ?? [];
    const held =
      origins.find((origin) => origin.listId === body.listId) ?? null;
    const candidate =
      held === null
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
        ? { listQuantity: candidate?.listQuantity ?? 0, settledHere: 0 }
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

    const delta = wanted - current;
    const listQuantity = Math.max(0, facts.listQuantity + delta);

    // Upserted, so adoption and an ordinary edit are one path: a candidate arrives
    // carrying the ids the sheet was handed, and the origin it becomes keeps them.
    const originId = held?.id ?? `o-adopted-${body.listId}`;
    const next: BasketLineOrigin = {
      id: originId,
      zoneId:
        held?.zoneId ?? candidate?.zoneId ?? LISTS[body.listId]?.zoneId ?? '',
      listId: body.listId,
      lineId: held?.lineId ?? body.lineId,
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

    if (wanted === 0) {
      this._originFacts.delete(originId);
    } else {
      this._originFacts.set(originId, {
        listQuantity,
        settledHere: facts.settledHere,
      });
    }

    const moved: BasketLine = {
      ...line,
      // Floored at what has been settled: a basket cannot ask for fewer than it has
      // already bought, whatever the households behind it now want.
      quantity: Math.max(line.settled, line.quantity + delta),
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
   * The lists this line could be sent to (velista `0056`).
   *
   * The run's own sources are marked, because the list somebody means in an aisle is
   * almost always one of them. The other two are what make this a picker rather than
   * a confirmation.
   */
  async getLineTargets(): Promise<readonly BasketLineTarget[]> {
    this._requireZoneReader();

    return TARGET_LIST_IDS.map((listId) => ({
      listId,
      zoneId: LISTS[listId].zoneId,
      listName: LISTS[listId].listName,
      zoneName: LISTS[listId].zoneName,
      fromRun: SOURCE_LIST_IDS.includes(listId),
    }));
  }

  /**
   * Send a line to a shopping list (velista `0056`).
   *
   * Three refusals, and they are three codes rather than one because they are three
   * sentences: a `DERIVED` line is not that kind of line, a bound one has already
   * gone, and a finished basket is a trip that is over. A fake answering one code
   * for all three would let a screen ship saying the wrong thing twice.
   *
   * `createdBy` is carried through untouched. It is written once, at the add, and
   * sending the line somewhere does not make somebody else the person who put it
   * there.
   */
  async bindLine(
    _generatedListId: string,
    lineId: string,
    listId: string
  ): Promise<BasketBindResult> {
    this._requireZoneReader();
    const line = this._require(lineId);
    this._requireLive();

    if (line.kind !== 'ADDED') {
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: 'memory',
        detail: 'Only a line added here can be sent to a shopping list',
      });
    }
    if (line.targetListId != null) {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
        detail: 'This line has already been sent to a shopping list',
      });
    }

    const zoneId = LISTS[listId]?.zoneId ?? 'zone-unknown';
    // What is **outstanding**, which may be zero on a line already bought. Sending
    // one of those is still worth doing: it puts what happened onto the list.
    const quantity = Math.max(0, line.quantity - line.settled);
    const originId = `o-bound-${(this._bound += 1)}`;
    const createdLineId = `zl-bound-${this._bound}`;

    const bound: BasketLine = {
      ...line,
      targetListId: listId,
      origins: [
        ...(line.origins ?? []),
        { id: originId, zoneId, listId, lineId: createdLineId, quantity },
      ],
    };
    this._originFacts.set(originId, {
      listQuantity: quantity,
      settledHere: 0,
    });
    this._lines = this._lines.map((row) => (row.id === lineId ? bound : row));

    return {
      line: this._project(bound),
      listId,
      zoneId,
      createdLineId,
      quantity,
      // One list that does not accept a sent line on its own, so both answers are
      // reachable without a second fake.
      pendingApproval: listId === APPROVES_BY_HAND,
    };
  }

  async setPick(
    _generatedListId: string,
    lineId: string,
    itemId: string
  ): Promise<BasketLine> {
    const line = this._lines.find((row) => row.id === lineId);
    if (!line) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: 'memory',
        detail: 'Line not found',
      });
    }
    if (!line.optionIds.includes(itemId)) {
      // The check that stops a swap repointing a line at any product at all.
      throw new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: 'memory',
        detail: 'That product is not one of this line’s options',
      });
    }

    const swapped: BasketLine = {
      ...line,
      pickId: itemId,
      touchedBy: this.me.id,
      touchedAt: new Date(),
    };
    this._lines = this._lines.map((row) => (row.id === lineId ? swapped : row));
    return this._project(swapped);
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
    if (!basketTakesLines(this.status)) {
      // A 409, which is the status the server answers. Its code there is
      // `generated_list_finished`, which this app's hand-synced `ERROR_CODES` does
      // not carry, so it reads as a plain conflict exactly as a real one would.
      // That is the honest fake: the screen draws no composer over a finished
      // basket at all, so the refusal is a race rather than a state with a
      // sentence, and nothing branches on telling it apart.
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: 'memory',
        detail: 'This basket is finished, so nothing more can be added to it',
      });
    }

    const line: BasketLine = {
      id: `line-added-${(this._added += 1)}`,
      content: body.content,
      quantity: body.quantity ?? 1,
      settled: 0,
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
   * basket is finished, so it cannot be changed. `addLine` predates the code being
   * in this app's `ERROR_CODES` and still throws a plain conflict, which reads the
   * same to a screen that draws no composer over a finished basket at all.
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

  /** The zone side of one origin, or zeroes for one this fake never recorded. */
  private _facts(originId: string): OriginFacts {
    return (
      this._originFacts.get(originId) ?? { listQuantity: 0, settledHere: 0 }
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
