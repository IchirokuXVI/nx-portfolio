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
  BasketViewStore,
  GatewayError,
  LINE_SERVICE,
  provideFakeCategoryStore,
  provideFakeShopSectionsStore,
  SessionStore,
} from '@portfolio/velista/data-access';
import type {
  Basket,
  BasketListRef,
  BasketParticipant,
  BasketPriceScope,
  BasketProduct,
  BasketProductList,
  BasketRow,
  BasketRowEntry,
  BasketRowResult,
  LineSettlement,
  Page,
  ParticipantKind,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
  StorageKeys,
} from '@portfolio/velista/platform';
import { QuantityReel } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { HeldBuy } from '../held-buy';
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
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    productId: null,
    touchedBy: null,
    touchedAt: null,
    usual: null,
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
    content: 'Milk',
    itemIds: [],
    favoriteItemId: null,
    canWrite: listId !== null,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left,
    bought: 0,
    asked: left,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    version: 1,
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
  /**
   * Which product somebody already said they got, by row key (velista `0092`,
   * section 5).
   *
   * In memory for the visit and stored nowhere, so a spec seeds it here rather
   * than through anything that outlives the page.
   */
  readonly chosen?: ReadonlyMap<string, string>;
  /** The shop the rows were read at, which the device chose (velista `0102`). */
  readonly readAt?: string;
  /**
   * What the read of the lists that could take the product answers (velista
   * `0139`, section 3): the lists, or null for a read that failed.
   */
  readonly productLists?: readonly BasketProductList[] | null;
  /**
   * Whether a buy here asks where the person is first (velista `0141`). Off by
   * default, as on a device that answered "Don't ask again", so every other test
   * here writes its buy at once.
   */
  readonly asks?: boolean;
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
    shop: null,
    lockedShopId: null,
    readAt: world.readAt ?? null,
    progress: { done: 0, unavailable: 0, total: 1 },
    pending: 1,
  });

  /** The row a key addresses: by its own, then by any entry's line id. */
  const rowFor = (key: string): BasketRow | null =>
    rows().find((row) => row.rowKey === key) ??
    rows().find((row) => row.entries.some((held) => held.lineId === key)) ??
    null;

  /**
   * Which product was said to be got, for this visit (velista `0092`,
   * section 5).
   *
   * The double keeps the **real** rule rather than returning whatever was
   * chosen, because the rule is the thing three controls depend on: a choice
   * only counts while it is still one of the row's own options, and a row with
   * exactly one option needs no choice at all.
   */
  const itemIdFor = (key: string): string | undefined =>
    rowFor(key)?.productId ?? undefined;

  // The shop the rows are read at (velista `0102`), which a world may name.
  const readAt = signal<string | null>(world.readAt ?? null);

  return {
    readAt,
    shopRead: readAt,
    readAtShop: jest.fn((locationId: string | null) => {
      readAt.set(locationId);
      return Promise.resolve();
    }),
    itemIdFor,
    productLists: jest.fn(async () =>
      world.productLists === undefined ? [] : world.productLists
    ),
    lineLeft: (result: BasketRowResult, lineId: string) =>
      !result.entries.some((held) => held.lineId === lineId),
    skip: jest.fn().mockResolvedValue(null),
    unskip: jest.fn().mockResolvedValue(null),
    setDemand: jest.fn().mockResolvedValue(null),
    addLine: jest.fn().mockResolvedValue(null),
    adding: signal(false),
    handedOver: signal(null),
    handOver: jest.fn(),
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
      ): Promise<BasketRowResult | null> => {
        const held = rowFor(rowKey) ?? line();
        const renamed = {
          ...held,
          content: body.content,
          entries: held.entries.map((one) => ({
            ...one,
            content: body.content,
          })),
        };
        rows.set(
          rows().map((row) => (row.rowKey === held.rowKey ? renamed : row))
        );
        return { entries: renamed.entries, skippedCount: 0 };
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
      // The real one, as the filter sheet spec uses it: it reads the faked
      // `BasketStore` above and a `BrowserFacade` `provideVelistaTesting` already
      // supplies. The sheet asks it one thing, which shop the screen is pricing
      // at, and the honest answer for a spec that has not chosen one is its own.
      BasketViewStore,
      provideFakeBrowserFacade(
        new Map(world.asks ? [] : [[StorageKeys.shopAskOff, 'true']])
      ),
      // The buy the shop question holds, which the basket page provides.
      HeldBuy,
      provideFakeCategoryStore(),
      provideFakeShopSectionsStore(),
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

  return {
    fixture,
    store,
    held: TestBed.inject(HeldBuy),
    sheets: TestBed.inject(SheetNavigation) as unknown as {
      dismiss: jest.Mock;
      leaveTo: jest.Mock;
    },
  };
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

/**
 * Let one of the entries pane's reels settle at a new number, as a thumb letting
 * go of it does. `which` is the reel's class: `got-reel` or `ask-reel`.
 *
 * Through the reel's own output rather than keys and timers, so the spec says
 * what the sheet does with a commit and leaves the reel's gesture to its spec.
 */
async function commitReel(
  fixture: ComponentFixture<SettleSheet>,
  which: 'ask-reel',
  change: { from: number; to: number },
  index = 0
) {
  const reels = fixture.debugElement.queryAll(
    By.css(`lib-quantity-reel.${which}`)
  );
  (reels[index].componentInstance as QuantityReel).committedTo.emit(change);
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Press the primary button, "Got all N", which buys everything left. */
async function gotOne(fixture: ComponentFixture<SettleSheet>) {
  (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('.actions .primary')
    ?.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Press "They had none", which every reader who may settle is offered. */
async function pressNone(fixture: ComponentFixture<SettleSheet>) {
  [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.actions button'),
  ]
    .find((button) => (button.textContent ?? '').includes('basket.settle.none'))
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

    await pressNone(fixture);

    return fixture;
  }

  function result(skippedCount: number): BasketRowResult {
    return { entries: line().entries, skippedCount };
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
    expect(dismissedTo()).toHaveLength(1);
  });

  /** A missed entry is told after the primary button too. */
  it('says it after "Got all" too', async () => {
    const { fixture, store } = await render();
    store.settle.mockResolvedValue(result(1));

    await gotOne(fixture);

    expect(missed(fixture)).toContain('basket.settle.missed');
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

    expect(control(fixture, '.actions')?.textContent).toContain(
      'basket.settle.none'
    );
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

  it('offers no "Got all" on a product row either', async () => {
    const { fixture } = await render({
      lines: [line({ productId: 'item-1' })],
      basketFinished: true,
    });

    expect(control(fixture, '.primary')).toBeNull();
    expect(control(fixture, '.disclosure')).toBeNull();
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

    await pressNone(fixture);

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
 * The two reels on the entries pane, and the sheet around them.
 *
 * There is no "Got all" and no "Got some" on this sheet. The row on the basket
 * page buys the whole line, and the "got" reel buys part of it. Both reels commit
 * on release with no confirmation, and a write from either **leaves the sheet
 * open**, because somebody adjusting a number wants to see where it landed. The
 * buttons that close the line ("They had none") still close the sheet.
 */
describe('SettleSheet: the buttons and the quantity of each list', () => {
  function landed(): BasketRowResult {
    return { entries: line().entries, skippedCount: 0 };
  }

  it('offers "Got all" first, and no "Got some"', async () => {
    const { fixture } = await render();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.actions .primary')
        ?.textContent?.trim()
    ).toBe('basket.sheet.gotAll');
    expect(text(fixture)).not.toContain('basket.settle.some');
  });

  it('still closes on "They had none"', async () => {
    const { fixture, store } = await render();
    store.settle.mockResolvedValue(landed());

    await pressNone(fixture);

    expect(dismissedTo()).toHaveLength(1);
  });

  it('changes what a list asks for when its quantity settles, with no button', async () => {
    const { fixture, store } = await render();
    store.setDemand.mockResolvedValue(landed());

    await commitReel(fixture, 'ask-reel', { from: 3, to: 5 });

    expect(store.setDemand).toHaveBeenCalledWith({
      lineId: 'zl1',
      quantity: 5,
      from: 3,
    });
    expect(dismissedTo()).toEqual([]);
  });

  it('stays open when a list asks for none and another still asks', async () => {
    const { fixture, store } = await render();
    store.setDemand.mockResolvedValue({ entries: [], skippedCount: 0 });

    await commitReel(fixture, 'ask-reel', { from: 3, to: 0 });

    expect(store.handOver).not.toHaveBeenCalled();
    expect(dismissedTo()).toEqual([]);
  });

  it('closes, and hands the page a sentence, when the row left the basket', async () => {
    const { fixture, store } = await render();
    store.setDemand.mockImplementation(async () => {
      store.rows.set([]);
      return { entries: [], skippedCount: 0 };
    });

    await commitReel(fixture, 'ask-reel', { from: 3, to: 0 });

    expect(store.handOver).toHaveBeenCalledWith('basket.demand.nothingLeft');
    expect(dismissedTo()).toHaveLength(1);
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

  /** A guest sees the lists and the quantities (velista `0139`, section 3). */
  it('draws a lone entry nobody can name as "Another list"', async () => {
    const { fixture } = await render({
      lines: [line({ entries: [entry(null, 'zl1', 4)] })],
      served: [],
    });

    expect(pane(fixture)).not.toBeNull();
    expect(text(fixture)).toContain('basket.entries.otherList');
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

    it('follows its lines to the key of the survivor when the merge regroups them', async () => {
      const { fixture, store } = await asked();
      store.renameRow.mockImplementationOnce(async () => {
        // The earliest line survives a merge, so the row that holds this sheet's
        // lines is keyed by a different anchor once the basket is read again.
        // This sheet's line is among its entries, as a key always is.
        const survivor = line({
          rowKey: 'zl-0',
          content: 'Leche Entera',
          entries: [entry('l1', 'zl-0', 1), entry('l1', LINE_ID, 3)],
        });
        store.rows.set([survivor]);
        return { entries: survivor.entries, skippedCount: 0 };
      });
      // A real navigation moves the sheet's key onto the survivor's, which ends
      // the following. The double stands in for that by keying the row as the
      // sheet now is, so it follows once.
      const leaveTo = TestBed.inject(SheetNavigation).leaveTo as jest.Mock;
      leaveTo.mockImplementation(async () => {
        store.rows.set(
          store.rows().map((held) => ({ ...held, rowKey: LINE_ID }))
        );
      });

      await press(fixture, mergeButton(fixture));
      // The sheet follows its row from an effect, which the next tick runs.
      TestBed.tick();
      await fixture.whenStable();

      expect(leaveTo).toHaveBeenCalledTimes(1);
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

/**
 * Not today, and taking it back (velista `0092`, section 3.1).
 *
 * The button and the state it is offered from, which is what `0030` makes worth
 * asserting: a control the server refuses is not drawn, so where it appears and
 * where it does not is the rule rather than a decoration on one.
 */
describe('SettleSheet: putting a row off for now', () => {
  const buttons = (fixture: ComponentFixture<SettleSheet>) => [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.actions button'),
  ];

  const press = async (
    fixture: ComponentFixture<SettleSheet>,
    label: string
  ) => {
    const found = buttons(fixture).find((button) =>
      (button.textContent ?? '').includes(label)
    );
    found?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    return found;
  };

  it('offers it on a row nobody has touched', async () => {
    const { fixture } = await render();
    expect(text(fixture)).toContain('basket.skip.action');
  });

  it('offers it on a partly bought row', async () => {
    const { fixture } = await render({
      lines: [line({ state: 'PARTLY', bought: 1, left: 3 })],
    });

    expect(text(fixture)).toContain('basket.skip.action');
  });

  it('offers it to a guest, who may skip like anybody else', async () => {
    // A smaller act than a settle, which every participant already may
    // (backend `0130`, section 5). Nothing about it is zone data.
    const { fixture } = await render({ meKind: 'GUEST', served: [] });
    expect(text(fixture)).toContain('basket.skip.action');
  });

  it('does not offer it on a row the shop had none of', async () => {
    // Already closed for today. The server refuses it, and a control it refuses
    // is not drawn.
    const { fixture } = await render({
      lines: [line({ state: 'NOT_AVAILABLE', left: 4 })],
    });

    expect(text(fixture)).not.toContain('basket.skip.action');
  });

  it('does not offer it on a finished trip', async () => {
    const { fixture } = await render({ basketFinished: true });
    expect(text(fixture)).not.toContain('basket.skip.action');
  });

  it('calls the store and says nothing about a list', async () => {
    const { fixture, store } = await render();
    await press(fixture, 'basket.skip.action');

    // One argument, which is the row. A skip carries no `from` and no
    // quantity: it has no number to be stale about and buys nothing.
    expect(store.skip).toHaveBeenCalledWith(LINE_ID);
    expect(store.settle).not.toHaveBeenCalled();
  });

  it('leads with taking it back on a skipped row, and keeps the buying actions', async () => {
    const { fixture } = await render({ lines: [line({ state: 'SKIPPED' })] });

    const labels = buttons(fixture).map((button) => button.textContent ?? '');
    expect(labels[0]).toContain('basket.skip.undo');
    // A person who skipped the bread and then found it buys it, so the other
    // actions stay under it rather than being replaced by the undo.
    expect(labels.join(' ')).toContain('basket.settle.none');
  });

  it('does not offer the skip again on a row that is already skipped', async () => {
    const { fixture } = await render({ lines: [line({ state: 'SKIPPED' })] });
    // Two buttons with two names, never one toggle (section 11).
    expect(text(fixture)).not.toContain('basket.skip.action');
  });

  it('takes it back through the store', async () => {
    const { fixture, store } = await render({
      lines: [line({ state: 'SKIPPED' })],
    });
    await press(fixture, 'basket.skip.undo');

    expect(store.unskip).toHaveBeenCalledWith(LINE_ID);
  });
});

/**
 * Which did you get? (velista `0092`, section 5.)
 *
 * The pane that used to split a row between products asks one question now, and
 * the answer travels with the settle. What matters here is the **nothing stored**
 * half: a choice reaches the server as `itemId` on a purchase and by no other
 * route, which is why every assertion about it ends on a settle body.
 */
describe('SettleSheet: a product row (velista 0139, section 3)', () => {
  const MILK: BasketProduct = {
    id: 'i-whole',
    name: { en: 'Whole milk', es: 'Leche entera' },
    brand: 'Hacendado',
    size: null,
    unit: null,
    imageUrl: null,
    offer: {
      price: 0.92,
      currency: 'EUR',
      unitPrice: null,
      unitPriceLabel: null,
      observedAt: null,
      sourceKind: 'OFFICIAL_WEB',
      stale: false,
      priceScopeId: 's-dia',
    },
    offers: [],
    atShop: null,
    productGroupId: null,
    categories: [],
    sectionIds: null,
  };
  const products = new Map([[MILK.id, MILK]]);
  const milkRow = (over: Partial<BasketRow> = {}) =>
    line({ productId: MILK.id, ...over });

  const el = (fixture: ComponentFixture<SettleSheet>) =>
    fixture.nativeElement as HTMLElement;

  const disclosure = (fixture: ComponentFixture<SettleSheet>) =>
    el(fixture).querySelector<HTMLButtonElement>('.disclosure');

  async function openOthers(fixture: ComponentFixture<SettleSheet>) {
    disclosure(fixture)?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const PANTRY: BasketProductList = {
    listId: 'l-pantry',
    listName: 'Pantry',
    zoneId: 'z1',
    zoneName: 'Home',
    lineId: 'zl9',
    lineName: 'Leche',
    quantity: 0,
  };
  const BREAKFAST: BasketProductList = {
    listId: 'l-breakfast',
    listName: 'Breakfast',
    zoneId: 'z2',
    zoneName: 'Office',
    lineId: null,
    lineName: null,
    quantity: null,
  };

  async function raise(
    fixture: ComponentFixture<SettleSheet>,
    to: number,
    index = 0
  ) {
    const reels = fixture.debugElement.queryAll(
      By.css('.others lib-quantity-reel')
    );
    (reels[index].componentInstance as QuantityReel).committedTo.emit({
      from: 0,
      to,
    });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('is titled by the product, with the price of one and how many are left', async () => {
    const { fixture } = await render({ lines: [milkRow()], products });

    expect(el(fixture).querySelector('.title')?.textContent?.trim()).toBe(
      'Whole milk Hacendado'
    );
    expect(el(fixture).querySelector('.subtitle')?.textContent?.trim()).toBe(
      'basket.sheet.each · basket.sheet.toGet'
    );
  });

  it('draws no price for a row with no product, and says how many are left', async () => {
    const { fixture } = await render();

    expect(el(fixture).querySelector('.title')?.textContent?.trim()).toBe(
      'Milk'
    );
    expect(el(fixture).querySelector('.subtitle')?.textContent?.trim()).toBe(
      'basket.sheet.toGet'
    );
  });

  it('says what was got on one quiet line, only once something was', async () => {
    const none = await render({ lines: [milkRow()], products });
    expect(text(none.fixture)).not.toContain('basket.sheet.gotAt');

    const some = await render({
      lines: [milkRow({ bought: 2, left: 2, state: 'PARTLY' })],
      products,
    });
    expect(text(some.fixture)).toContain('basket.sheet.gotAt');
  });

  it('offers "Got all N" and buys what is left, with the row\'s product, then closes', async () => {
    const { fixture, store } = await render({ lines: [milkRow()], products });
    store.settle.mockResolvedValue({ entries: [], skippedCount: 0 });

    expect(el(fixture).querySelector('.primary')?.textContent?.trim()).toBe(
      'basket.sheet.gotAll'
    );
    await gotOne(fixture);

    expect(store.settle).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({
        outcome: 'BOUGHT',
        quantity: 4,
        from: 4,
        itemId: MILK.id,
      })
    );
    expect(dismissedTo()).toHaveLength(1);
  });

  it('says "Got the other N" once some of it is bought', async () => {
    const { fixture } = await render({
      lines: [milkRow({ bought: 2, left: 2, state: 'PARTLY' })],
      products,
    });

    expect(el(fixture).querySelector('.primary')?.textContent?.trim()).toBe(
      'basket.sheet.gotOther'
    );
  });

  it('names no product on the buy of a row with none', async () => {
    const { fixture, store } = await render();
    store.settle.mockResolvedValue({ entries: [], skippedCount: 0 });

    await gotOne(fixture);

    expect(
      (store.settle as unknown as jest.Mock).mock.calls[0][1]
    ).not.toHaveProperty('itemId');
  });

  it('has no product pane to ask which was got', async () => {
    const { fixture } = await render({ lines: [milkRow()], products });

    expect(text(fixture)).not.toContain('basket.product.title');
    expect(el(fixture).querySelector('.product-change')).toBeNull();
  });

  describe('Add it to another list', () => {
    it('is closed, and reads the lists of the product once', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: [PANTRY],
      });

      expect(disclosure(fixture)?.getAttribute('aria-expanded')).toBe('false');
      expect(store.productLists).toHaveBeenCalledTimes(1);
      expect(store.productLists).toHaveBeenCalledWith(MILK.id);
    });

    it('opens on the lists, the one at zero with its line', async () => {
      const { fixture } = await render({
        lines: [milkRow()],
        products,
        productLists: [PANTRY, BREAKFAST],
      });
      await openOthers(fixture);

      expect(
        [...el(fixture).querySelectorAll('.others .row-where')].map((node) =>
          node.textContent?.trim()
        )
      ).toEqual(['Home · Leche', 'Office']);
    });

    it('draws the loading row while the read is out', async () => {
      const { fixture, store } = await render({ lines: [milkRow()], products });
      store.productLists.mockReturnValue(new Promise(() => undefined));
      // Ask again on a read that never answers.
      (
        fixture.componentInstance as unknown as {
          retryOthers(): void;
        }
      ).retryOthers();
      fixture.detectChanges();
      await openOthers(fixture);

      expect(text(fixture)).toContain('basket.sheet.othersLoading');
    });

    it('draws a failed row, and its retry reads again', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: null,
      });
      await openOthers(fixture);

      expect(text(fixture)).toContain('basket.sheet.othersFailed');

      store.productLists.mockResolvedValue([PANTRY]);
      el(fixture).querySelector<HTMLButtonElement>('.retry')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.productLists).toHaveBeenCalledTimes(2);
      expect(text(fixture)).toContain('Pantry');
    });

    it('leaves out a list the row already draws', async () => {
      // The server decides the lists with no picks, so a list whose line
      // counts as the product only by its price comes back too (backend
      // `0201`, "What the build decided", point 14).
      const { fixture } = await render({
        lines: [milkRow()],
        products,
        productLists: [
          { ...PANTRY, listId: 'l1', listName: 'Groceries' },
          BREAKFAST,
        ],
      });
      await openOthers(fixture);

      expect(
        [...el(fixture).querySelectorAll('.others .row-where')].map((node) =>
          node.textContent?.trim()
        )
      ).toEqual(['Office']);
    });

    it('is not drawn when every list it answers is already drawn', async () => {
      const { fixture } = await render({
        lines: [milkRow()],
        products,
        productLists: [{ ...PANTRY, listId: 'l1' }],
      });

      expect(disclosure(fixture)).toBeNull();
    });

    it('is not drawn when the read answers no list', async () => {
      const { fixture } = await render({
        lines: [milkRow()],
        products,
        productLists: [],
      });

      expect(disclosure(fixture)).toBeNull();
    });

    it('raises a list that holds the product at zero through its line', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: [PANTRY, BREAKFAST],
      });
      store.setDemand.mockResolvedValue({
        entries: [entry('l-pantry', 'zl9', 2)],
        skippedCount: 0,
      });
      await openOthers(fixture);

      await raise(fixture, 2);

      expect(store.setDemand).toHaveBeenCalledWith({
        lineId: 'zl9',
        quantity: 2,
        from: 0,
      });
      // It asks now, so it leaves the lists that could.
      expect(
        [...el(fixture).querySelectorAll('.others .row-name')].map((node) =>
          node.textContent?.trim()
        )
      ).toEqual(['Breakfast']);
    });

    it('draws a line that asks for the product in another row at its own quantity', async () => {
      // The read uses no picks, so a line that holds the product but counts as
      // another one comes back asking for 3. A reel drawn at 0 would send 3 to 1
      // and take two units off that line.
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: [{ ...PANTRY, quantity: 3 }],
      });
      store.setDemand.mockResolvedValue({
        entries: [entry('l-pantry', 'zl9', 4)],
        skippedCount: 0,
      });
      await openOthers(fixture);

      const reel = fixture.debugElement.query(
        By.css('.others lib-quantity-reel')
      ).componentInstance as QuantityReel;
      expect(reel.value()).toBe(3);

      reel.committedTo.emit({ from: 3, to: 4 });
      await fixture.whenStable();

      expect(store.setDemand).toHaveBeenCalledWith({
        lineId: 'zl9',
        quantity: 4,
        from: 3,
      });
    });

    it('adds a line named by the product to a list that does not hold it', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: [BREAKFAST],
      });
      store.addLine.mockResolvedValue({
        entries: [entry('l-breakfast', 'zl10', 1)],
        skippedCount: 0,
      });
      await openOthers(fixture);

      await raise(fixture, 1);

      expect(store.addLine).toHaveBeenCalledWith({
        targetListId: 'l-breakfast',
        content: 'Whole milk',
        quantity: 1,
        itemIds: [MILK.id],
        named: false,
      });
      expect(disclosure(fixture)).toBeNull();
    });

    it('keeps the list and says so when the add is refused', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        productLists: [BREAKFAST],
      });
      await openOthers(fixture);

      await raise(fixture, 1);

      expect(el(fixture).querySelector('.failed')).not.toBeNull();
      expect(text(fixture)).toContain('Breakfast');
      expect(store.addLine).toHaveBeenCalledTimes(1);
    });

    it('is never offered to a guest, who is not read for', async () => {
      const { fixture, store } = await render({
        lines: [milkRow()],
        products,
        meKind: 'GUEST',
        served: [],
        productLists: [PANTRY],
      });

      expect(disclosure(fixture)).toBeNull();
      expect(store.productLists).not.toHaveBeenCalled();
    });

    it('is not offered on a row with no product, which keeps its rename', async () => {
      const { fixture, store } = await render({ productLists: [PANTRY] });

      expect(disclosure(fixture)).toBeNull();
      expect(store.productLists).not.toHaveBeenCalled();
      expect(el(fixture).querySelector('#settle-name')).not.toBeNull();
    });

    it('offers no rename on a product row, which the catalog names', async () => {
      const { fixture } = await render({ lines: [milkRow()], products });

      expect(el(fixture).querySelector('#settle-name')).toBeNull();
    });
  });

  describe('the price scope (velista 0095, section 6)', () => {
    const PRICED: BasketProduct = {
      ...MILK,
      id: 'i-priced',
      offer: {
        price: 0.95,
        currency: 'EUR',
        unitPrice: null,
        unitPriceLabel: null,
        observedAt: null,
        sourceKind: 'OFFICIAL_WEB',
        stale: false,
        priceScopeId: 's-dia',
      },
    };
    const priced = new Map([[PRICED.id, PRICED]]);

    async function press(
      selector: 'got' | ((button: HTMLButtonElement) => boolean)
    ): Promise<Record<string, unknown>> {
      const { fixture, store } = await render({
        lines: [line({ productId: PRICED.id })],
        products: priced,
      });
      if (selector === 'got') {
        await gotOne(fixture);
      } else {
        [
          ...(
            fixture.nativeElement as HTMLElement
          ).querySelectorAll<HTMLButtonElement>('.actions button'),
        ]
          .find(selector)
          ?.click();
        await fixture.whenStable();
      }
      return (store.settle as unknown as jest.Mock).mock.calls[0][1];
    }

    it('names the scope of the price the row draws, and never an amount', async () => {
      const body = await press('got');

      expect(body['priceScopeId']).toBe('s-dia');
      expect(
        Object.keys(body).filter(
          (key) => key !== 'priceScopeId' && /price|cents|amount/i.test(key)
        )
      ).toEqual([]);
    });

    it('names no scope on a close', async () => {
      const body = await press((button) =>
        (button.textContent ?? '').includes('basket.settle.none')
      );

      expect(body['outcome']).toBe('NOT_AVAILABLE');
      expect(body).not.toHaveProperty('priceScopeId');
    });
  });

  /**
   * Buying at one shop (velista `0102`). Every settle made while a shop is chosen
   * names the shop and the scope of the price bought there; "any of your shops"
   * names no shop, ever, because the cheapest price's scope is not where the person
   * stood.
   */
  describe('the shop a settle names (velista 0102)', () => {
    const AT_SHOP: BasketProduct = {
      ...MILK,
      id: 'i-at-shop',
      offer: {
        price: 0.79,
        currency: 'EUR',
        unitPrice: null,
        unitPriceLabel: null,
        observedAt: null,
        sourceKind: 'OFFICIAL_WEB',
        stale: false,
        priceScopeId: 's-dia',
      },
      atShop: {
        priceScopeId: 's-merca-store',
        price: 0.95,
        currency: 'EUR',
        available: true,
      },
    };
    const SCOPES = new Map([
      [
        's-merca',
        {
          priceScopeId: 's-merca',
          supermarketName: { en: 'Mercadona', es: 'Mercadona' },
          locations: [
            {
              id: 'loc-merca',
              label: null,
              address: 'Calle Mayor 3',
              city: 'Córdoba',
              postalCode: '14001',
            },
          ],
        },
      ],
    ]);

    async function press(
      readAt: string | undefined,
      selector: 'got' | ((button: HTMLButtonElement) => boolean)
    ): Promise<Record<string, unknown>> {
      const { fixture, store } = await render({
        lines: [line({ productId: AT_SHOP.id })],
        products: new Map([[AT_SHOP.id, AT_SHOP]]),
        scopes: SCOPES,
        ...(readAt === undefined ? {} : { readAt }),
      });
      if (selector === 'got') {
        await gotOne(fixture);
      } else {
        [
          ...(
            fixture.nativeElement as HTMLElement
          ).querySelectorAll<HTMLButtonElement>('.actions button'),
        ]
          .find(selector)
          ?.click();
        await fixture.whenStable();
      }
      return (store.settle as unknown as jest.Mock).mock.calls[0][1];
    }

    it('carries the shop and the scope of the price bought there', async () => {
      const body = await press('loc-merca', 'got');

      expect(body['supermarketLocationId']).toBe('loc-merca');
      expect(body['priceScopeId']).toBe('s-merca-store');
    });

    it('carries no shop in "any of your shops" mode', async () => {
      const body = await press(undefined, 'got');

      expect(body).not.toHaveProperty('supermarketLocationId');
      expect(body['priceScopeId']).toBe('s-dia');
    });

    it('names the shop on "they had none" too, and no scope', async () => {
      const body = await press('loc-merca', (button) =>
        (button.textContent ?? '').includes('basket.settle.none')
      );

      expect(body['outcome']).toBe('NOT_AVAILABLE');
      expect(body['supermarketLocationId']).toBe('loc-merca');
      expect(body).not.toHaveProperty('priceScopeId');
    });
  });
});

/**
 * Velista `0142`: the sheet over a row somebody bought outside this shopping
 * list.
 *
 * The lists that ask, each with its quantity, and nothing else: nothing buys,
 * skips or takes back. A list can ask for the product again where the server
 * allows it.
 */
describe('SettleSheet: a row bought outside this shopping list (velista 0142)', () => {
  const elsewhere = (demandEditable = true) =>
    line({
      left: 0,
      bought: 0,
      asked: 0,
      boughtElsewhere: 2,
      state: 'BOUGHT_ELSEWHERE',
      note: 'BOUGHT_ON_ANOTHER_BASKET',
      noteAt: new Date('2026-10-04T10:00:00.000Z'),
      entries: [
        entry('l1', 'zl1', 0, {
          asked: 0,
          boughtElsewhere: 2,
          state: 'BOUGHT_ELSEWHERE',
          demandEditable,
        }),
      ],
    });

  const reels = (fixture: ComponentFixture<SettleSheet>, which: string) =>
    fixture.debugElement.queryAll(By.css(`lib-quantity-reel.${which}`));

  const element = (fixture: ComponentFixture<SettleSheet>) =>
    fixture.nativeElement as HTMLElement;

  it('draws the lists that ask, each at 0 and already bought, and nothing else', async () => {
    const { fixture } = await render({ lines: [elsewhere()] });

    expect(element(fixture).querySelector('lib-row-entries')).not.toBeNull();
    expect(text(fixture)).toContain('basket.line.alreadyBought');
    expect(element(fixture).querySelector('.subtitle')).toBeNull();
    expect(element(fixture).querySelector('.happened')).toBeNull();
    expect(element(fixture).querySelector('.disclosure')).toBeNull();
    expect(element(fixture).querySelector('.rename')).toBeNull();
    expect(text(fixture)).not.toContain('basket.history.open');
  });

  it('offers nothing that buys, skips or takes back', async () => {
    const { fixture, store } = await render({ lines: [elsewhere()] });

    expect(element(fixture).querySelector('.actions')).toBeNull();
    expect(text(fixture)).not.toContain('basket.settle.none');
    expect(text(fixture)).not.toContain('basket.skip.action');
    expect(store.revert).not.toHaveBeenCalled();
  });

  it('raises the quantity where demandEditable is true', async () => {
    const { fixture, store } = await render({ lines: [elsewhere(true)] });

    expect(reels(fixture, 'ask-reel')).toHaveLength(1);

    await commitReel(fixture, 'ask-reel', { from: 0, to: 1 });

    expect(store.setDemand).toHaveBeenCalledWith({
      lineId: 'zl1',
      quantity: 1,
      from: 0,
    });
  });

  it('draws no quantity control where demandEditable is false', async () => {
    const { fixture } = await render({ lines: [elsewhere(false)] });

    expect(reels(fixture, 'ask-reel')).toHaveLength(0);
  });

  it('keeps every control on a row that outside buys only lowered', async () => {
    const { fixture } = await render({
      lines: [line({ boughtElsewhere: 1, note: 'BOUGHT_ON_ANOTHER_BASKET' })],
    });

    expect(text(fixture)).toContain('basket.settle.none');
    expect(text(fixture)).toContain('basket.sheet.gotAll');
    expect(text(fixture)).not.toContain('basket.line.alreadyBought');
  });
});

/**
 * The first buy of a trip asks where you are (velista `0141`, section 1). The
 * sheet's buttons hold their buy and replace this sheet with the question; the
 * buy is written when the answer releases it, with the shop the answer chose.
 */
describe('SettleSheet: the first buy asks where you are', () => {
  it('holds "Got all" and leaves for the question, writing nothing yet', async () => {
    const { fixture, store, held, sheets } = await render({ asks: true });

    await gotOne(fixture);

    expect(store.settle).not.toHaveBeenCalled();
    expect(sheets.leaveTo).toHaveBeenCalledWith(
      `/velista/en/shopping-lists/${BASKET_ID}/sheet/shop`
    );
    expect(sheets.dismiss).not.toHaveBeenCalled();
    // It waits in the holder: the release is what writes it.
    await held.release();
    expect(store.settle).toHaveBeenCalledTimes(1);
  });

  it('writes the held buy on release, with the shop chosen by then', async () => {
    const { fixture, store, held } = await render({ asks: true });
    await gotOne(fixture);

    TestBed.inject(BasketViewStore).setShop('loc-tejares');
    await held.release();

    expect(store.settle).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({
        outcome: 'BOUGHT',
        supermarketLocationId: 'loc-tejares',
      })
    );
  });

  it('holds "They had none" too, and writes it with no shop when none was chosen', async () => {
    const { fixture, store, held } = await render({ asks: true });

    await pressNone(fixture);
    expect(store.settle).not.toHaveBeenCalled();

    await held.release();

    const [, body] = store.settle.mock.calls[0];
    expect(body.outcome).toBe('NOT_AVAILABLE');
    expect(body.supermarketLocationId).toBeUndefined();
  });

  it('writes at once on a device that said "Don\'t ask again"', async () => {
    const { fixture, store, held } = await render();

    await gotOne(fixture);

    expect(store.settle).toHaveBeenCalledTimes(1);
    // Nothing waits in the holder.
    await held.release();
    expect(store.settle).toHaveBeenCalledTimes(1);
  });
});
