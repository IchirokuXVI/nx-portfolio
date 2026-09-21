import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  GatewayError,
  LINE_SERVICE,
  SessionStore,
} from '@portfolio/velista/data-access';
import type {
  Basket,
  BasketListRef,
  BasketParticipant,
  BasketPriceScope,
  BasketProduct,
  BasketRenameResult,
  BasketRow,
  BasketRowEntry,
  BasketRowResult,
  LineSettlement,
  Page,
  ParticipantKind,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { QuantityReel } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { SettleSheet } from './settle-sheet';

/**
 * The settle sheet's two additions from plan 0049: what happened to a line, and what a
 * settle could not reach.
 *
 * Both are questions about **who may be told what**, which is why almost every test
 * here states a reader and asserts on an absence. The sheet's settling itself is
 * covered by `basket-sheet-dismissal.spec.ts` and the store's own spec; nothing here
 * repeats it.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const LINE_ID = 'c0ffee00-1111-4222-8333-444455556666';

function participant(
  id: string,
  kind: ParticipantKind,
  overrides: Partial<BasketParticipant> = {}
): BasketParticipant {
  return {
    id,
    kind,
    displayName: null,
    username: null,
    guestNumber: null,
    userId: null,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
    ...overrides,
  };
}

/**
 * A row two households ask for, which is the case the history is really about.
 *
 * Two flats both wanting milk are one row here with an entry each, so the history
 * has to ask both lines and merge the answers. A one entry row would pass a version
 * of this that asked only the first.
 */
function line(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: LINE_ID,
    content: 'Milk',
    left: 4,
    bought: 0,
    asked: 4,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [entry('l1', 'zl1', 3), entry('l2', 'zl2', 1)],
    ...overrides,
  };
}

function entry(
  listId: string | null,
  lineId: string,
  left = 1,
  over: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId,
    listId,
    left,
    bought: 0,
    asked: left,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...over,
  };
}

function ref(listId: string, name: string): BasketListRef {
  return { listId, name, zoneId: 'z1', zoneName: 'Home' };
}

function settlement(overrides: Partial<LineSettlement> = {}): LineSettlement {
  return {
    id: 's1',
    lineId: 'zl1',
    listId: 'l1',
    itemId: null,
    outcome: 'BOUGHT',
    quantity: 2,
    settledByUserId: 'u-marc',
    settledAt: new Date('2026-08-21T10:00:00.000Z'),
    revertedAt: null,
    ...overrides,
  };
}

interface World {
  /** Who is reading. The owner unless a test says otherwise. */
  readonly meKind?: ParticipantKind;
  /**
   * The covered lists this reader was served, which is the whole of the
   * redaction since backend `0136`. Both by default; `[]` is a guest.
   */
  readonly served?: readonly BasketListRef[];
  readonly lines?: readonly BasketRow[];
  readonly participants?: readonly BasketParticipant[];
  /** The settlements each zone list line answers with, by line id. */
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  /** Line ids whose settlement read is refused, as a lost `WRITE` would be. */
  readonly refuses?: readonly string[];
  /** What one page holds, so the paging test can ask for a second. */
  readonly pageSize?: number;
  /** The reader's own account name, or null for somebody with no name to give. */
  readonly ownName?: string | null;
  /** The products the lines name, for the pick pane (velista `0062`). */
  readonly products?: ReadonlyMap<string, BasketProduct>;
  /** The scopes those products' offers name, as the server described them. */
  readonly scopes?: ReadonlyMap<string, BasketPriceScope>;
  /**
   * Whether the **trip** is over, which is not the same as a finished line
   * (velista `0057`, section 6).
   *
   * A finished basket takes every control off this sheet at once, including the
   * ones a line with something still outstanding would otherwise offer.
   */
  readonly basketFinished?: boolean;
}

/** Every settlement read the sheet made, so a test can assert it asked both origins. */
const settlementReads: { lineId: string; cursor: string | null }[] = [];

function storeDouble(world: World) {
  const me = participant(
    'me',
    world.meKind ?? 'OWNER',
    world.meKind === 'GUEST'
      ? { guestNumber: 1 }
      : { userId: 'u-me', displayName: 'Ana' }
  );

  const served = world.served ?? [ref('l1', 'Weekly shop'), ref('l2', 'Flat')];
  const lists = signal(new Map(served.map((held) => [held.listId, held])));

  /**
   * The rows, with every list id this reader was not served dropped to null.
   *
   * The same gate `toBasket` applies, applied here for the same reason: a double
   * that handed the sheet a list id the basket never served would let a rename
   * field ship that the server refuses.
   */
  const rows = signal<readonly BasketRow[]>(
    (world.lines ?? [line()]).map((row) => ({
      ...row,
      entries: row.entries.map((held) =>
        held.listId !== null &&
        !served.some((ref) => ref.listId === held.listId)
          ? { ...held, listId: null }
          : held
      ),
    }))
  );
  const basket = signal<Basket | null>({
    id: BASKET_ID,
    kind: 'GENERATED',
    name: 'Saturday big shop',
    status: 'OPEN',
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
    rows: rows(),
    lists: served,
    participants: world.participants ?? [me],
    me,
    products: world.products ?? new Map(),
    scopes: world.scopes ?? new Map(),
    progress: { done: 0, unavailable: 0, total: 1 },
    pending: 1,
  });

  /** The row a key addresses: by its own, then by any entry's line id. */
  const rowFor = (key: string): BasketRow | null =>
    rows().find((row) => row.rowKey === key) ??
    rows().find((row) => row.entries.some((held) => held.lineId === key)) ??
    null;

  return {
    basket,
    // How the sheet addresses its own basket since velista `0091`: off the store,
    // never off `paramMap`, which has no id under `shopping-lists/live`. The sheet
    // builds its dismissal and its own re-keyed URL from it.
    address: signal({ basketId: BASKET_ID }),
    state: signal('ready'),
    error: signal<unknown>(null),
    shareLink: signal(null),
    busyRows: signal(new Set<string>()),
    rows,
    lists,
    participants: signal(world.participants ?? [me]),
    me: signal(me),
    participantsById: signal(new Map([[me.id, me]])),
    products: signal(world.products ?? new Map()),
    progress: signal({ done: 0, unavailable: 0, total: 1 }),
    pending: signal(1),
    present: signal([]),
    live: signal(true),
    revoked: signal(false),
    finished: signal(world.basketFinished ?? false),
    rowGone: signal(0),
    sayRowGone: jest.fn(),
    rowFor,
    open: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(null),
    revert: jest.fn().mockResolvedValue(null),
    setLeft: jest.fn().mockResolvedValue(null),
    // A rename that lands in place, renaming the held row as the store would.
    renameRow: jest.fn(
      async (
        rowKey: string,
        body: { content: string }
      ): Promise<BasketRenameResult | null> => {
        const held = rowFor(rowKey) ?? line();
        const renamed = { ...held, content: body.content };
        rows.set(
          rows().map((row) => (row.rowKey === held.rowKey ? renamed : row))
        );
        return {
          row: renamed,
          progress: { done: 0, unavailable: 0, total: 1 },
          pending: 1,
          replacedRowKey: null,
          absorbedRowKey: null,
          skippedCount: 0,
        };
      }
    ),
    suggest: jest.fn().mockResolvedValue([]),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    share: jest.fn().mockResolvedValue(null),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    removeParticipant: jest.fn().mockResolvedValue(undefined),
  };
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();
  settlementReads.length = 0;

  const store = storeDouble(world);

  const lineService = {
    listSettlements: async (
      lineId: string,
      options?: { cursor?: string }
    ): Promise<Page<LineSettlement>> => {
      settlementReads.push({ lineId, cursor: options?.cursor ?? null });

      if (world.refuses?.includes(lineId)) {
        throw new Error('forbidden');
      }

      const all = world.settlements?.[lineId] ?? [];
      const size = world.pageSize;
      if (size === undefined) {
        return { items: all, nextCursor: null };
      }

      const from = options?.cursor === undefined ? 0 : Number(options.cursor);
      const next = from + size;
      return {
        items: all.slice(from, next),
        nextCursor: next < all.length ? String(next) : null,
      };
    },
  };

  const pageMap = convertToParamMap({ basketId: BASKET_ID });
  const sheetMap = convertToParamMap({ rowKey: LINE_ID });

  await TestBed.configureTestingModule({
    imports: [SettleSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: BasketStore, useValue: store },
      { provide: LINE_SERVICE, useValue: lineService },
      // The reader's own account name, which the sheet uses for their own row in the
      // history and for the caption on a finished line (plan 0052, section 2.1).
      {
        provide: SessionStore,
        useValue: { username: signal(world.ownName ?? 'Ana') },
      },
      {
        provide: SheetNavigation,
        useValue: {
          dismiss: jest.fn().mockResolvedValue(undefined),
          leaveTo: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(sheetMap),
          snapshot: {
            paramMap: sheetMap,
            parent: { paramMap: pageMap, parent: null },
          },
          parent: {
            paramMap: of(pageMap),
            snapshot: { paramMap: pageMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SettleSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, store };
}

const text = (fixture: ComponentFixture<SettleSheet>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

/**
 * Every URL the sheet has dismissed to, in order.
 *
 * Read off `SheetNavigation`'s double rather than off the router: dismissing is a
 * pop when the sheet was opened over a page and a replace when it was not, and
 * which of the two happened is that class's business rather than this sheet's.
 */
const dismissedTo = (): string[] =>
  (
    TestBed.inject(SheetNavigation).dismiss as unknown as jest.Mock
  ).mock.calls.map(([url]) => url as string);

/** Open the history pane the way the control on the settle pane does. */
async function openHistory(fixture: ComponentFixture<SettleSheet>) {
  (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('.link')
    ?.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SettleSheet: what happened to this line', () => {
  describe('who is offered it', () => {
    it('offers it to the owner', async () => {
      const { fixture } = await render({ meKind: 'OWNER' });

      expect(fixture.nativeElement.querySelector('.link')).not.toBeNull();
      expect(text(fixture)).toContain('basket.history.open');
    });

    it('offers it to a registered participant who passes the rule', async () => {
      const { fixture } = await render({
        meKind: 'REGISTERED',
        served: [ref('l1', 'Weekly shop'), ref('l2', 'Flat')],
      });

      expect(fixture.nativeElement.querySelector('.link')).not.toBeNull();
    });

    /**
     * A guest has no account to authenticate the read with, and a settlement is zone
     * data. A control you may not use is not drawn (`0030`), so the way in is absent
     * rather than disabled.
     */
    it('does not offer it to a guest', async () => {
      const { fixture } = await render({
        meKind: 'GUEST',
        served: [],
      });

      expect(fixture.nativeElement.querySelector('.link')).toBeNull();
      expect(text(fixture)).not.toContain('basket.history.open');
    });

    /**
     * Privilege is checked per request and never cached at join (backend `0051`),
     * and the basket's served list refs are the server's answer on the most recent
     * read. Losing `WRITE` therefore takes the ref away, and the entry that named
     * that list comes back naming none: the control goes with it.
     */
    it('takes it away from a participant who has lost WRITE', async () => {
      const { fixture, store } = await render({
        meKind: 'REGISTERED',
        served: [ref('l1', 'Weekly shop'), ref('l2', 'Flat')],
      });

      expect(fixture.nativeElement.querySelector('.link')).not.toBeNull();

      // The next basket read, as the server would answer it for a reader who no
      // longer writes either list.
      store.lists.set(new Map());
      store.rows.set([
        line({ entries: [entry(null, 'zl1', 3), entry(null, 'zl2', 1)] }),
      ]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.link')).toBeNull();
    });
  });

  describe('what it draws', () => {
    it('asks every origin of the line and merges the answers, newest first', async () => {
      const { fixture } = await render({
        participants: [
          participant('me', 'OWNER', { userId: 'u-me', displayName: 'Ana' }),
          participant('p2', 'REGISTERED', {
            userId: 'u-marc',
            displayName: 'Marc',
          }),
        ],
        settlements: {
          zl1: [
            settlement({
              id: 's-old',
              settledAt: new Date('2026-08-20T10:00:00.000Z'),
            }),
          ],
          zl2: [
            settlement({
              id: 's-new',
              lineId: 'zl2',
              listId: 'l2',
              settledAt: new Date('2026-08-22T10:00:00.000Z'),
            }),
          ],
        },
      });

      await openHistory(fixture);

      expect(settlementReads.map((read) => read.lineId).sort()).toEqual([
        'zl1',
        'zl2',
      ]);
      // Interleaved by time, which is the order somebody actually shopped in, rather
      // than one origin's whole history and then the other's.
      expect(
        fixture.componentInstance['history']().map(
          (held: { id: string }) => held.id
        )
      ).toEqual(['s-new', 's-old']);
    });

    it('names the person from the basket s participants', async () => {
      const { fixture } = await render({
        participants: [
          participant('me', 'OWNER', { userId: 'u-me', displayName: 'Ana' }),
          participant('p2', 'REGISTERED', {
            userId: 'u-marc',
            displayName: 'Marc',
          }),
        ],
        settlements: { zl1: [settlement()], zl2: [] },
      });

      await openHistory(fixture);

      const [row] = fixture.componentInstance['history']();
      expect(row.who).toBe('Marc');
      expect(row.mine).toBe(false);
    });

    /**
     * A settle made from a shared basket by a guest carries no user id at all (backend
     * `0051`), and the row draws the neutral phrase for it. That is not a failure to
     * resolve a name: the person genuinely has no account to be named by.
     */
    it('says somebody rather than an id when the settle carries no user', async () => {
      const { fixture } = await render({
        settlements: {
          zl1: [settlement({ settledByUserId: null })],
          zl2: [],
        },
      });

      await openHistory(fixture);

      // On the row and not in the rendered text: the testing translator does not
      // interpolate, so `{{who}}` never reaches the DOM to be asserted on. `who: null`
      // is what makes the template choose the neutral phrase.
      expect(fixture.componentInstance['history']()[0].who).toBeNull();
      expect(fixture.componentInstance['history']()[0].mine).toBe(false);
    });

    /**
     * "They had none" is a different sentence from "got 2" and not a quantity of zero:
     * `NOT_AVAILABLE` closes the outstanding amount without buying anything, so a row
     * drawn as a purchase would report one that never happened.
     */
    it('draws a shop that had none as its own sentence', async () => {
      const { fixture } = await render({
        settlements: {
          zl1: [settlement({ outcome: 'NOT_AVAILABLE', quantity: 0 })],
          zl2: [],
        },
      });

      await openHistory(fixture);

      expect(text(fixture)).toContain('basket.history.none');
      expect(text(fixture)).not.toContain('basket.history.bought');
    });

    it('says so when the line has had nothing happen to it', async () => {
      const { fixture } = await render({ settlements: { zl1: [], zl2: [] } });

      await openHistory(fixture);

      expect(text(fixture)).toContain('basket.history.empty');
    });

    /**
     * A history silently missing one shop's purchases is worse than one that says it
     * could not load: the whole reason to open it is to reconcile two people's trips.
     * This is also the shape of a 403 on the request after `WRITE` is lost.
     */
    it('fails the pane rather than drawing half a history', async () => {
      const { fixture } = await render({
        settlements: { zl1: [settlement()] },
        refuses: ['zl2'],
      });

      await openHistory(fixture);

      expect(text(fixture)).toContain('basket.history.failed');
      expect(fixture.componentInstance['history']()).toHaveLength(0);
    });

    it('follows each origin s cursor when asked for more', async () => {
      const { fixture } = await render({
        pageSize: 1,
        settlements: {
          zl1: [settlement({ id: 's1' }), settlement({ id: 's2' })],
          zl2: [],
        },
      });

      await openHistory(fixture);
      expect(fixture.componentInstance['history']()).toHaveLength(1);
      expect(fixture.componentInstance['historyHasMore']()).toBe(true);

      fixture.componentInstance['moreHistory']();
      await fixture.whenStable();

      expect(fixture.componentInstance['history']()).toHaveLength(2);
      // Only the origin that still had a cursor is asked again: `zl2` answered
      // everything it had on the first page.
      expect(settlementReads.filter((read) => read.cursor !== null)).toEqual([
        { lineId: 'zl1', cursor: '1' },
      ]);
    });
  });
});

/**
 * What a write could not reach (velista `0090`).
 *
 * **The names are gone with the rule that produced them.** A settle used to skip an
 * origin whose access had gone, and the gateway composed a named report for a reader
 * entitled to it; coverage is recomputed on every request now, so there is no
 * `ACCESS_GONE` skip left to report (backend `0130`, section 5).
 *
 * What can still be skipped is an entry whose **line was deleted** since the
 * purchase, which has no units to put back. That is a count and not a household:
 * naming it would name a list that is not there.
 */
describe('SettleSheet: what a write could not reach', () => {
  async function settleWith(
    result: BasketRowResult,
    world: World = {}
  ): Promise<ComponentFixture<SettleSheet>> {
    const { fixture, store } = await render(world);
    store.settle.mockResolvedValue(result);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.primary')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function result(skippedCount: number): BasketRowResult {
    return {
      row: line(),
      progress: { done: 0, unavailable: 0, total: 1 },
      pending: 1,
      replacedRowKey: null,
      skippedCount,
    };
  }

  const missed = (fixture: ComponentFixture<SettleSheet>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.missed')
      ?.textContent ?? '';

  it('says how many entries it could not reach', async () => {
    const fixture = await settleWith(result(2));

    expect(missed(fixture)).toContain('basket.settle.missed');
  });

  /**
   * A guest is told the same sentence as the owner, because the fact is the
   * actor's business: something they did not do landed.
   */
  it('says the same thing to a guest', async () => {
    const fixture = await settleWith(result(1), {
      meKind: 'GUEST',
      served: [],
    });

    expect(missed(fixture)).toContain('basket.settle.missed');
  });

  /**
   * Nothing to report, so the sheet gets out of the way: the person is in a shop
   * and the next row is what they want to see.
   */
  it('closes without a word when nothing was missed', async () => {
    const fixture = await settleWith(result(0));

    expect(missed(fixture)).toBe('');
  });
});

describe('SettleSheet: a line with nothing left to settle', () => {
  /** A line settled up to its asked quantity, by somebody, in a shop that had it. */
  const done = (overrides: Partial<BasketRow> = {}) =>
    line({
      bought: 4,
      left: 0,
      asked: 4,
      state: 'DONE',
      touchedBy: 'me',
      ...overrides,
    });

  const control = (fixture: ComponentFixture<SettleSheet>, selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector);

  it('offers no settle target at all', async () => {
    const { fixture } = await render({ lines: [done()] });

    // Both of the reported controls, gone. Not disabled: a control you may not use is
    // not drawn (`0030`), and a dimmed "Got all 0" would still be a wrong sentence.
    //
    // `:not(.lists)` because velista `0055` and `0056` added a second group with the
    // same layout class, and it is drawn over a finished line **on purpose**: sending
    // a line that was already bought puts what happened onto a household's list, and
    // raising a finished line's contribution is a correction of the record rather
    // than a purchase. What this assertion is about is the settle targets, so it says
    // so rather than counting every group on the pane.
    expect(control(fixture, '.actions:not(.lists)')).toBeNull();
    expect(control(fixture, '.primary')).toBeNull();
  });

  it('says what happened instead of how many are outstanding', async () => {
    // "0 outstanding" is true and answers the wrong question: somebody opened a
    // finished line to see what they bought.
    const { fixture } = await render({ lines: [done()] });

    expect(control(fixture, '.outstanding')).toBeNull();
    expect(control(fixture, '.happened')?.textContent).toContain(
      'basket.touched.got'
    );
  });

  it('draws the same sentence the row does, so the two cannot disagree', async () => {
    // `touchedCaption` composes both. A shop that had none is a different sentence
    // from a purchase, because `NOT_AVAILABLE` closes the outstanding amount without
    // buying anything.
    const { fixture } = await render({
      lines: [done({ state: 'NOT_AVAILABLE' })],
    });

    expect(control(fixture, '.happened')?.textContent).toContain(
      'basket.touched.none'
    );
  });

  it('keeps the settle targets on a line that still has something outstanding', async () => {
    // The guard is on the numbers and not on the sheet: an ordinary line is untouched
    // by any of this.
    const { fixture } = await render({
      lines: [line({ bought: 1, left: 3, asked: 4, state: 'PARTLY' })],
    });

    expect(control(fixture, '.primary')).not.toBeNull();
  });
});

/**
 * The sheet over a trip that is finished (velista `0057`, section 6).
 *
 * A different fact from the section above, which is about one line: this takes the
 * controls off **every** line at once, the ones nobody settled included. What stays
 * is everything the sheet says, the settlement history among it, because a finished
 * basket is the receipt for a trip somebody took.
 */
describe('SettleSheet: the trip is finished', () => {
  const control = (fixture: ComponentFixture<SettleSheet>, selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector);

  it('offers no settle target on a line with everything outstanding', async () => {
    // The case a line-level check misses: nothing has been settled here, so the
    // sheet's own `finished` says draw the buttons, and the basket says no.
    const { fixture } = await render({
      lines: [line({ bought: 0, left: 4, asked: 4, state: 'PARTLY' })],
      basketFinished: true,
    });

    expect(control(fixture, '.actions:not(.lists)')).toBeNull();
    expect(control(fixture, '.primary')).toBeNull();
  });

  it('offers no way to swap the product', async () => {
    // A correction of the record is still a change to it, and the server refuses it.
    const { fixture } = await render({
      lines: [line({ optionIds: ['item-1'] })],
      products: new Map([
        [
          'item-1',
          {
            id: 'item-1',
            name: { en: 'Hacendado milk', es: 'Leche Hacendado' },
            brand: null,
            size: null,
            unit: null,
            offer: null,
            offers: [],
            categories: ['OTHER' as const],
          },
        ],
        [
          'item-2',
          {
            id: 'item-2',
            name: { en: 'Pascual milk', es: 'Leche Pascual' },
            brand: null,
            size: null,
            unit: null,
            offer: null,
            offers: [],
            categories: ['OTHER' as const],
          },
        ],
      ]),
      basketFinished: true,
    });

    expect(control(fixture, '.product-name')).not.toBeNull();
    expect(control(fixture, '.product-change')).toBeNull();
  });

  it('keeps the entries pane and takes its reels off', async () => {
    // Velista `0073`, as `0090` left it. A finished basket is the receipt for a
    // trip somebody took, so what the pane **says** is exactly what a reader opens
    // it for; every write behind it is refused by the server, so no control is
    // drawn (`0030`).
    const { fixture } = await render({ basketFinished: true });

    expect(control(fixture, 'lib-row-entries')).not.toBeNull();
    expect(
      fixture.debugElement.queryAll(By.directive(QuantityReel))
    ).toHaveLength(0);
  });

  it('still offers the history, which is what a receipt is read for', async () => {
    const { fixture } = await render({
      lines: [
        line({ bought: 4, left: 0, asked: 4, state: 'DONE', touchedBy: 'me' }),
      ],
      basketFinished: true,
    });

    expect(control(fixture, '.link')).not.toBeNull();
  });
});

/**
 * Plan 0052, section 7.2: the failure gets a sentence.
 *
 * One `basket.settle.failed` used to be drawn for every failure the screen can suffer,
 * so the backend said something specific and the screen said "That did not save."
 */
describe('SettleSheet: what a failure says', () => {
  async function failWith(error: unknown) {
    const { fixture, store } = await render();
    store.error.set(error);
    store.settle.mockResolvedValue(null);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.primary')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  it('says the line is already finished on a conflict', async () => {
    // Two people work one list in a shop, so somebody else finishing a line between
    // the sheet opening and the tap landing is the ordinary case (luna `0054`,
    // section 4).
    const fixture = await failWith(
      new GatewayError({ code: 'conflict', status: 409, correlationId: 'r1' })
    );

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.failed')
        ?.textContent
    ).toContain('basket.error.alreadyFinished');
  });

  it('does not give every failure the generic sentence', async () => {
    const fixture = await failWith(
      new GatewayError({ code: 'forbidden', status: 403, correlationId: 'r2' })
    );

    const said =
      (fixture.nativeElement as HTMLElement).querySelector('.failed')
        ?.textContent ?? '';
    expect(said).toContain('basket.error.accessChanged');
    expect(said).not.toContain('basket.error.failed');
  });

  it('puts the correlation id beside a sentence that has one', async () => {
    // The reference is a string somebody may have to quote, so it is drawn rather
    // than only logged.
    //
    // Asserted on the value the template is handed and on the presence of the element
    // that draws it, never on the rendered string: the testing translator echoes keys
    // without interpolating, so `{{correlationId}}` never reaches the text here.
    const fixture = await failWith(
      new GatewayError({ code: 'internal', status: 500, correlationId: 'r3' })
    );

    expect(fixture.componentInstance['correlationId']()).toBe('r3');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.reference')
        ?.textContent
    ).toContain('basket.error.reference');
  });

  it('says nothing before anything has failed', async () => {
    const { fixture } = await render();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.failed')
    ).toBeNull();
  });
});

/**
 * Plan 0052, section 8: a reverted settlement stays in the history, marked.
 *
 * Luna `0054` does not delete the settlements a reopen undoes, because a settlement is
 * an append (`0047` section 3). It marks them and keeps serving them, and the whole
 * reason to open this pane is to reconcile two people's trips: a purchase that was
 * taken back is part of that, and a gap where one was is not.
 */
describe('SettleSheet: a settlement that was taken back', () => {
  async function history(rows: readonly LineSettlement[]) {
    const { fixture } = await render({
      settlements: { zl1: rows, zl2: [] },
    });

    fixture.componentInstance['openPane']('history');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the row rather than dropping it', async () => {
    const fixture = await history([
      settlement({
        id: 's1',
        revertedAt: new Date('2026-08-21T11:00:00.000Z'),
      }),
    ]);

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.history-row')
    ).toHaveLength(1);
  });

  it('qualifies it quietly, and still says what happened', async () => {
    // Never a strikethrough: that reads as deleted, and this settle was not deleted.
    // It happened, and somebody undid it, which is a different fact.
    const fixture = await history([
      settlement({
        id: 's1',
        revertedAt: new Date('2026-08-21T11:00:00.000Z'),
      }),
    ]);

    const row = (fixture.nativeElement as HTMLElement).querySelector(
      '.history-row'
    );
    expect(row?.querySelector('.history-reverted')?.textContent).toContain(
      'basket.history.reverted'
    );
    expect(row?.querySelector('.history-what')?.textContent).toContain(
      'basket.history.bought'
    );
  });

  it('leaves a settlement that still stands unmarked', async () => {
    const fixture = await history([settlement({ id: 's1' })]);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.history-reverted')
    ).toBeNull();
  });
});

/**
 * The quantity pane, which is now the same control as the row (plan 0054, section 6).
 *
 * It drew its own spinbutton with a copy of `QuantityReel`'s key table beside a
 * comment saying it matched. There is one number control in this product and one
 * keyboard path through it, and a copy that no longer exists cannot drift.
 *
 * The three buttons are untouched and are asserted elsewhere. "They had none" in
 * particular has no representation on a reel at all: it is an outcome and not a
 * quantity, and a number dragged to zero must never be able to mean the shop had
 * none.
 */
describe('SettleSheet: how many did you get', () => {
  /** Open the pane the way the settle pane's own control does. */
  function openQuantity(fixture: ComponentFixture<SettleSheet>): void {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button')
    );
    const some = buttons.find((button) =>
      (button.textContent ?? '').includes('basket.settle.some')
    );
    if (some === undefined) {
      throw new Error('the settle pane offers no way to give a number');
    }
    some.click();
    fixture.detectChanges();
  }

  function reel(fixture: ComponentFixture<SettleSheet>): QuantityReel {
    return fixture.debugElement.query(By.directive(QuantityReel))
      .componentInstance as QuantityReel;
  }

  function reelEl(fixture: ComponentFixture<SettleSheet>): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      'lib-quantity-reel'
    ) as HTMLElement;
  }

  /**
   * Move the reel, and put it away afterwards.
   *
   * The close is what stops the idle timer, which would otherwise outlive the spec
   * and commit into a component that is no longer there.
   */
  function move(fixture: ComponentFixture<SettleSheet>, by: number): void {
    const key = by > 0 ? 'ArrowUp' : 'ArrowDown';
    for (let step = 0; step < Math.abs(by); step += 1) {
      reelEl(fixture).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true })
      );
    }
    fixture.detectChanges();
  }

  it('draws the reel, bounded by what is outstanding', async () => {
    // One at the bottom because zero is "they had none", which is the button below
    // and an outcome rather than a quantity.
    const { fixture } = await render();
    openQuantity(fixture);

    expect(reelEl(fixture)).not.toBeNull();
    expect(reelEl(fixture).getAttribute('aria-valuemin')).toBe('1');
    expect(reelEl(fixture).getAttribute('aria-valuemax')).toBe('4');
    expect(reelEl(fixture).getAttribute('aria-valuenow')).toBe('1');
  });

  it('names the number the same way the pane always did', async () => {
    const { fixture } = await render();
    openQuantity(fixture);

    expect(reelEl(fixture).getAttribute('aria-label')).toContain(
      'basket.settle.quantity'
    );
  });

  it('records the number under the thumb, without waiting for the idle beat', async () => {
    // "Record it" has to agree with the number above it the moment somebody reads
    // both. A button whose label lagged the control by a second would be asking
    // somebody in a shop to wait and find out.
    const { fixture, store } = await render();
    openQuantity(fixture);

    move(fixture, 2);

    const submit = (fixture.nativeElement as HTMLElement).querySelector(
      '.primary'
    ) as HTMLButtonElement;
    submit.click();
    reel(fixture).close();
    await fixture.whenStable();

    // The number under the thumb, with the `from` every write on a row carries.
    expect(store.settle).toHaveBeenCalledWith(LINE_ID, {
      outcome: 'BOUGHT',
      quantity: 3,
      from: 4,
    });
  });

  it('follows the reel when it is let go, too', async () => {
    const { fixture } = await render();
    openQuantity(fixture);

    move(fixture, 1);
    reel(fixture).close();
    fixture.detectChanges();

    expect(reelEl(fixture).getAttribute('aria-valuenow')).toBe('2');
  });
});

/**
 * The two ways on from this sheet, and who is offered them (velista `0055` section 2,
 * `0056` section 2).
 *
 * A control you may not use is not drawn (`0030`), so every case here is an absence,
 * and the absences are the whole of the test: both routes behind these buttons are
 * refused outright by the server to a guest and to a reader who has lost `WRITE`, so
 * drawing one would be an invitation that cannot be honoured.
 *
 * The label rather than the rendered sentence, because
 * `RokuTranslatorTestingModule.forTesting()` does not interpolate and the assertion
 * is about which control exists.
 */
/**
 * The list summary, under the product (velista `0073`, section 3).
 *
 * The two controls this replaced are gone: there is no "Split between lists" pane and
 * no "Change what each list asked for" sheet, and nothing they did is now impossible.
 * What this asserts is who gets the summary and that the settle buttons never wait for
 * it. What the rows themselves do is `line-lists-summary.spec.ts`.
 */
/**
 * What each household asked for and got (velista `0090`, section 9.2).
 *
 * `lib-row-entries` replaced `lib-line-lists-summary`, and the difference is not
 * cosmetic. That one took a line and fetched its origins, worked out in the
 * component what each list had contributed, and drew its own loading and failure
 * states. The basket's own row carries both numbers per entry now, so the pane
 * fetches nothing, computes nothing and has no failure of its own.
 */
describe('SettleSheet: what each household asked for and got', () => {
  const pane = (fixture: ComponentFixture<SettleSheet>) =>
    (fixture.nativeElement as HTMLElement).querySelector('lib-row-entries');

  it('draws it under the product entry for a row two households ask for', async () => {
    const { fixture } = await render();

    expect(pane(fixture)).not.toBeNull();
  });

  /**
   * A row with one entry whose list this reader was not served says nothing
   * anybody can act on — "another list asks for 4" on a row that asks for 4 — so
   * the pane is not drawn at all rather than drawn empty.
   */
  it('draws nothing for a lone entry nobody can name', async () => {
    const { fixture } = await render({
      lines: [line({ entries: [entry(null, 'zl1', 4)] })],
      served: [],
    });

    expect(pane(fixture)).toBeNull();
  });

  /** One served entry is worth a pane: it says which household is asking. */
  it('draws it for a lone entry on a served list', async () => {
    const { fixture } = await render({
      lines: [line({ entries: [entry('l1', 'zl1', 4)] })],
    });

    expect(pane(fixture)).not.toBeNull();
  });

  /**
   * **It fetches nothing.** The numbers arrived with the basket, so there is no
   * request to be slow and no failure to report: the settle buttons above never
   * wait for it, which is what the old summary needed its own states for.
   */
  it('reads the basket’s own row rather than asking the server', async () => {
    const { fixture, store } = await render();

    expect(pane(fixture)).not.toBeNull();
    expect(store.refresh).not.toHaveBeenCalled();
  });

  /**
   * A finished basket is the receipt for a trip somebody took, so what the pane
   * **says** is exactly what a reader opens it for; every write behind it is
   * refused by the server, so no control is drawn (`0030`).
   */
  it('keeps the pane and takes its reels off once the trip is over', async () => {
    const { fixture } = await render({ basketFinished: true });

    expect(pane(fixture)).not.toBeNull();
    expect(
      fixture.debugElement.queryAll(By.directive(QuantityReel))
    ).toHaveLength(0);
  });
});

/**
 * Velista `0084`: renaming a line from the basket.
 *
 * Who sees the field is the client half of backend `0113`'s rule, so most of these
 * state a reader and assert a presence or an absence. The rest are the save, the
 * merge question and where the sheet goes after a merge.
 */
describe('SettleSheet: renaming the line', () => {
  const field = (fixture: ComponentFixture<SettleSheet>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#settle-name'
    );
  const saveButton = (fixture: ComponentFixture<SettleSheet>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.save'
    );

  function type(fixture: ComponentFixture<SettleSheet>, value: string) {
    const input = field(fixture) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function press(
    fixture: ComponentFixture<SettleSheet>,
    button: HTMLButtonElement | null
  ) {
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('who sees the field', () => {
    it('is drawn for the owner, holding the line’s name', async () => {
      const { fixture } = await render();

      expect(field(fixture)?.value).toBe('Milk');
    });

    /**
     * **Every entry's list served**, which is the client half of backend `0113`'s
     * rule: it lets somebody rename exactly the rows whose every list they can
     * write, and a list this reader was not served is one they cannot.
     *
     * It replaced a `seesZoneData` read, which was one flag for the whole basket:
     * a reader who could write four of five covered lists was refused the field on
     * every row, including the four they could rename.
     */
    it('is absent on a row with an entry nobody can name', async () => {
      const { fixture } = await render({
        lines: [
          line({ entries: [entry('l1', 'zl1', 3), entry(null, 'zl2', 1)] }),
        ],
      });

      expect(field(fixture)).toBeNull();
    });

    it('is drawn for a registered participant served every entry’s list', async () => {
      const { fixture } = await render({
        meKind: 'REGISTERED',
        served: [ref('l1', 'Weekly shop'), ref('l2', 'Flat')],
      });

      expect(field(fixture)).not.toBeNull();
    });

    it('is absent for a registered participant served nothing', async () => {
      const { fixture } = await render({
        meKind: 'REGISTERED',
        served: [],
      });

      expect(field(fixture)).toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.title')
          ?.classList
      ).not.toContain('visually-hidden');
    });

    it('is absent for a guest', async () => {
      const { fixture } = await render({
        meKind: 'GUEST',
        served: [],
      });

      expect(field(fixture)).toBeNull();
    });

    it('is absent once the trip is finished', async () => {
      const { fixture } = await render({ basketFinished: true });

      expect(field(fixture)).toBeNull();
    });
  });

  describe('Save', () => {
    it('is disabled until the name changes, and for a blank name', async () => {
      const { fixture } = await render();
      expect(saveButton(fixture)?.disabled).toBe(true);

      type(fixture, 'Leche entera');
      expect(saveButton(fixture)?.disabled).toBe(false);

      type(fixture, '   ');
      expect(saveButton(fixture)?.disabled).toBe(true);

      type(fixture, ' Milk ');
      expect(saveButton(fixture)?.disabled).toBe(true);
    });

    it('sends the trimmed name, says saved on the button, and stays open', async () => {
      const { fixture, store } = await render();

      type(fixture, '  Leche entera ');
      await press(fixture, saveButton(fixture));

      expect(store.renameRow).toHaveBeenCalledWith(LINE_ID, {
        content: 'Leche entera',
      });
      expect(saveButton(fixture)?.textContent).toContain('basket.rename.saved');
      expect(dismissedTo()).toEqual([]);
    });

    it('keeps focus in the dialog when the disabled Save let go of it', async () => {
      // Found in the browser: Save disables itself once the name is saved, focus
      // fell to the page body, and Escape no longer reached the sheet.
      const { fixture } = await render();

      type(fixture, 'Leche entera');
      (document.activeElement as HTMLElement | null)?.blur();
      await press(fixture, saveButton(fixture));
      await fixture.whenStable();

      expect(document.activeElement?.id).toBe('settle-title');
    });

    it('puts Save back on the next change', async () => {
      const { fixture } = await render();

      type(fixture, 'Leche entera');
      await press(fixture, saveButton(fixture));
      type(fixture, 'Leche entera sin lactosa');

      expect(saveButton(fixture)?.textContent).not.toContain(
        'basket.rename.saved'
      );
      expect(saveButton(fixture)?.textContent).toContain('basket.rename.save');
    });
  });

  describe('the merge question', () => {
    async function asked() {
      const rendered = await render({
        lines: [
          line(),
          // The row the refusal names, keyed by its own anchor: the refusal's
          // `otherLineId` is that anchor's id, which is what a row is keyed by.
          line({
            rowKey: 'line-2',
            content: 'leche entera',
            bought: 3,
            left: 2,
            asked: 5,
            state: 'PARTLY',
            entries: [entry('l1', 'line-2', 2)],
          }),
        ],
      });
      const { fixture, store } = rendered;
      store.renameRow.mockImplementationOnce(async () => {
        store.error.set(
          new GatewayError({
            code: 'line_merge_required',
            status: 409,
            correlationId: 'm1',
            details: {
              lists: [
                {
                  listId: 'l1',
                  listName: 'Weekly shop',
                  zoneName: 'Flat 3B',
                  otherContent: 'Leche entera',
                  otherQuantity: 2,
                },
                {
                  listId: 'l2',
                  listName: 'Groceries',
                  zoneName: 'Parents',
                  otherContent: 'leche entera',
                  otherQuantity: 1,
                },
              ],
              basket: {
                otherLineId: 'line-2',
                otherContent: 'leche entera',
                otherQuantity: 5,
              },
            },
          })
        );
        return null;
      });

      type(fixture, 'Leche entera');
      await press(fixture, saveButton(fixture));
      return rendered;
    }

    const rows = (fixture: ComponentFixture<SettleSheet>) =>
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll(
          '.merge-row'
        ),
      ].map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '');

    const mergeButton = (fixture: ComponentFixture<SettleSheet>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.merge-confirm'
      );

    it('draws one row per list and one for the basket', async () => {
      const { fixture } = await asked();

      const drawn = rows(fixture);
      expect(drawn).toHaveLength(3);
      expect(drawn[0]).toContain('Weekly shop');
      expect(drawn[0]).toContain('Flat 3B');
      expect(drawn[0]).toContain('basket.rename.mergeAsks');
      expect(drawn[2]).toContain('basket.rename.mergeBasketRow');
      expect(drawn[2]).toContain('basket.rename.mergeToGet');
      // The settle pane is gone while the question is asked.
      expect(field(fixture)).toBeNull();
    });

    it('states what each other line holds, the basket row as still to get', async () => {
      const { fixture } = await asked();

      const question = fixture.componentInstance['merge']();
      expect(question?.name).toBe('Leche entera');
      expect(
        question?.rows.map((held: { quantity: number }) => held.quantity)
      ).toEqual([2, 1, 2]);
    });

    it('resends the same name with confirmMerge from Merge', async () => {
      const { fixture, store } = await asked();

      await press(fixture, mergeButton(fixture));

      expect(store.renameRow).toHaveBeenLastCalledWith(LINE_ID, {
        content: 'Leche entera',
        confirmMerge: true,
      });
    });

    it('returns to the field with the typed name from Keep editing', async () => {
      const { fixture, store } = await asked();

      const keepEditing = [
        ...(
          fixture.nativeElement as HTMLElement
        ).querySelectorAll<HTMLButtonElement>('button.quiet'),
      ].find((button) =>
        button.textContent?.includes('basket.rename.keepEditing')
      );
      await press(fixture, keepEditing ?? null);

      expect(field(fixture)?.value).toBe('Leche entera');
      expect(store.renameRow).toHaveBeenCalledTimes(1);
    });

    it('follows the survivor with leaveTo when this line was absorbed', async () => {
      const { fixture, store } = await asked();
      store.renameRow.mockImplementationOnce(async () => {
        // The earliest line survives a merge, so the answer's row is keyed by a
        // different anchor: the row the rename addressed is the one absorbed.
        const survivor = line({ rowKey: 'zl-0', content: 'Leche Entera' });
        store.rows.set([survivor]);
        return {
          row: survivor,
          progress: { done: 0, unavailable: 0, total: 1 },
          pending: 1,
          replacedRowKey: LINE_ID,
          absorbedRowKey: LINE_ID,
          skippedCount: 0,
        };
      });

      await press(fixture, mergeButton(fixture));

      const leaveTo = TestBed.inject(SheetNavigation).leaveTo as jest.Mock;
      expect(leaveTo).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/rows/zl-0/settle`
      );
    });
  });

  describe('a refusal', () => {
    async function refusedWith(error: GatewayError) {
      const { fixture, store } = await render();
      store.renameRow.mockImplementationOnce(async () => {
        store.error.set(error);
        return null;
      });
      type(fixture, 'Leche entera');
      await press(fixture, saveButton(fixture));
      return fixture;
    }

    const said = (fixture: ComponentFixture<SettleSheet>) =>
      (fixture.nativeElement as HTMLElement).querySelector('.rename .failed')
        ?.textContent ?? '';

    it('names the list when a pending line would merge into an approved one', async () => {
      const fixture = await refusedWith(
        new GatewayError({
          code: 'line_merge_needs_approval',
          status: 409,
          correlationId: 'a1',
          details: { listName: 'Weekly shop' },
        })
      );

      expect(said(fixture)).toContain('basket.error.mergeNeedsApproval');
      expect(fixture.componentInstance['renameErrorArgs']()).toEqual({
        list: 'Weekly shop',
      });
    });

    it('says it without a list when the refusal names none', async () => {
      // Backend `0113` puts the list's name only in the server's own sentence today.
      const fixture = await refusedWith(
        new GatewayError({
          code: 'line_merge_needs_approval',
          status: 409,
          correlationId: 'a2',
        })
      );

      expect(said(fixture)).toContain('list.error.mergeNeedsApproval');
    });

    it('names the list and the bound when the merged products are too many', async () => {
      const fixture = await refusedWith(
        new GatewayError({
          code: 'line_merge_too_many_products',
          status: 409,
          correlationId: 'a3',
          details: { listName: 'Weekly shop', max: 20, offered: 23 },
        })
      );

      expect(said(fixture)).toContain('basket.error.mergeTooManyProducts');
      expect(fixture.componentInstance['renameErrorArgs']()).toEqual({
        list: 'Weekly shop',
        max: 20,
      });
    });

    it('says the reader can no longer rename on forbidden', async () => {
      const fixture = await refusedWith(
        new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'a4',
        })
      );

      expect(said(fixture)).toContain('basket.error.renameForbidden');
    });
  });
});
