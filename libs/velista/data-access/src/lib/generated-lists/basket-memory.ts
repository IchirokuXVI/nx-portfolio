import { Injectable } from '@angular/core';
import type {
  BasketLine,
  BasketLinkPreview,
  BasketParticipant,
  BasketProduct,
  BasketSession,
  BasketSettleRequest,
  BasketSettleResult,
  BasketShareLink,
  BasketView,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { BasketServiceI } from './basket-service';

/** The one link this fake knows. Anything else is dead, like most links are. */
const LIVE_SECRET = '9f2k4tqvb1xz8mq7';

/** The basket every read here is about. */
const BASKET_ID = 'basket-saturday';

const PRODUCTS: readonly BasketProduct[] = [
  {
    id: 'item-milk-hacendado',
    name: { en: 'Hacendado whole milk, 1 L', es: 'Leche entera Hacendado, 1 L' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
  },
  {
    id: 'item-milk-pascual',
    name: { en: 'Pascual whole milk, 1 L', es: 'Leche entera Pascual, 1 L' },
    brand: 'Pascual',
    size: 1,
    unit: 'LITER',
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
  },
  {
    id: 'item-eggs',
    name: { en: 'Free range eggs, 12', es: 'Huevos camperos, 12' },
    brand: 'Hacendado',
    size: 12,
    unit: 'UNIT',
  },
];

const OWNER: BasketParticipant = {
  id: 'p-owner',
  kind: 'OWNER',
  displayName: 'Ana',
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
      touchedBy: null,
      touchedAt: null,
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
      touchedBy: REGISTERED.id,
      touchedAt: new Date('2026-09-01T10:20:00.000Z'),
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
      touchedBy: GUEST.id,
      touchedAt: new Date('2026-09-01T10:45:00.000Z'),
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
      status: 'ACTIVE',
      generatedAt: new Date('2026-09-01T08:00:00.000Z'),
      lines: this._lines.map((line) => this._project(line)),
      participants: this._participants.map((person) =>
        this.seesZoneData ? person : this._withoutDevice(person)
      ),
      me: this.me,
      seesZoneData: this.seesZoneData,
      products: new Map(PRODUCTS.map((product) => [product.id, product])),
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
    };
    this._lines = this._lines.map((row) => (row.id === lineId ? settled : row));

    return {
      line: this._project(settled),
      skippedCount: 0,
      // Absent for a reader who may not have it, exactly as the server answers.
      ...(this.seesZoneData ? { skipped: [] } : {}),
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
    const { origins: _origins, ...rest } = line;
    return rest;
  }

  private _withoutDevice(person: BasketParticipant): BasketParticipant {
    const { device: _device, ...rest } = person;
    return rest;
  }
}
