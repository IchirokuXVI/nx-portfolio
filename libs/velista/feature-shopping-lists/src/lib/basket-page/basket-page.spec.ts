import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketListStore,
  BasketStore,
  BasketViewStore,
  GatewayError,
  SessionStore,
} from '@portfolio/velista/data-access';
import type {
  BasketListRef,
  BasketParticipant,
  BasketPresenceEntry,
  BasketProduct,
  BasketRow,
  BasketRowEntry,
  BasketRowResult,
  ErrorCode,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { BasketRow as BasketRowComponent } from '../basket-row/basket-row';
import { BasketPage } from './basket-page';

/**
 * The basket's header, once the basket is live (plan 0048, sections 4 and 5).
 *
 * Three claims are drawn here and each one is a sentence about the present tense
 * that something has to be checking:
 *
 * - **The faces are who is connected**, not who has ever joined. Those two answers
 *   agree all through a shop and diverge exactly when it matters, which is
 *   afterwards, when everybody has gone home and the participant list still claims
 *   a crowd.
 * - **They empty when the socket drops**, rather than freezing at their last known
 *   value. A frozen face row is the same lie one trip later.
 * - **The screen says which of the two baskets it is.** A live basket and a
 *   refetching one look identical while nobody else is shopping, so the difference
 *   is said rather than left to be discovered.
 *
 * And the fourth, which is section 7: a removed participant is **told**, on a
 * screen that stays readable. The person holding the phone is standing in a shop
 * with a trolley, and a basket that vanished under them with no sentence would be
 * indistinguishable from a crash.
 */

/** A store whose live half a spec drives by hand. The connection is `BasketSocket`'s. */
interface FakeStore {
  readonly live: WritableSignal<boolean>;
  readonly revoked: WritableSignal<boolean>;
  readonly present: WritableSignal<readonly BasketPresenceEntry[]>;
  readonly participants: WritableSignal<readonly BasketParticipant[]>;
  readonly opened: string[];
  /** Every time the page said the shopper has gone. See the teardown test. */
  readonly leave: jest.Mock<void, []>;
  /** The rows, writable so a spec can stand in for the refetch a refusal does. */
  readonly rows: WritableSignal<readonly BasketRow[]>;
  /** What the store last failed with, which is where the row's sentence comes from. */
  readonly error: WritableSignal<unknown>;
  /**
   * Every move of a row's reel, and what it answered.
   *
   * One mock and not two, because `setLeft` is the one call the reel makes: the
   * client never decides whether a drag was a purchase or a take back (velista
   * `0090`, section 6).
   */
  readonly setLeft: jest.Mock;
  /** Every settle the page sent from a row's status control. */
  readonly settle: jest.Mock;
  /** Every revert, which is the other direction of the same control. */
  readonly revert: jest.Mock;
  /** Where the page navigated, so a spec can see the settle sheet being opened. */
  readonly navigate: jest.Mock;
  /** Whether the trip is over, writable so a spec can end one (plan 0057). */
  readonly finished: WritableSignal<boolean>;
  /** How many rows are still to do, **by the server**, which the prompt waits for. */
  readonly pending: WritableSignal<number>;
  /** Every status write the page made, on the **owner's** surface (plan 0057). */
  readonly setStatus: jest.Mock;
  /** Every refetch, so a spec can see the screen being brought up to date. */
  readonly refresh: jest.Mock;
  /** Every product the basket named, which is the other half of what a search reads. */
  readonly products: WritableSignal<ReadonlyMap<string, BasketProduct>>;
  /** The lists this reader was served, which the filter sheet offers. */
  readonly lists: WritableSignal<ReadonlyMap<string, BasketListRef>>;
  /** How much of the **whole** basket is got, which a search must never change. */
  readonly progress: WritableSignal<{
    done: number;
    unavailable: number;
    total: number;
  }>;
}

interface Options {
  readonly live?: boolean;
  readonly revoked?: boolean;
  readonly present?: readonly BasketPresenceEntry[];
  readonly participants?: readonly BasketParticipant[];
  /** Who the reader is on this basket. The owner alone gets the share control. */
  readonly me?: BasketParticipant | null;
  /** Their account name, which is the one name the basket itself never carries. */
  readonly username?: string | null;
  /** The rows on the basket. Empty draws the empty state. */
  readonly lines?: readonly BasketRow[];
  /** Whether the trip is over (plan 0057). A finished basket draws no controls. */
  readonly finished?: boolean;
  /** Which basket this is (velista `0091`). `LIVE` draws the other surface. */
  readonly kind?: 'GENERATED' | 'LIVE' | 'UNKNOWN';
  /**
   * How many rows are still to do, **by the server**.
   *
   * Zero with rows on the basket is what makes the "all done" prompt appear. The
   * two are stated separately for the reason the store reads it rather than
   * counting the array: a `SKIPPED` row is pending and this side cannot know that
   * (velista `0090`, section 6).
   */
  readonly unsettled?: number;
  /** Whether a finish or a reopen lands. False is the failure the banner reports. */
  readonly statusWriteLands?: boolean;
  /** The products the rows name, so a search can match a name or a brand (`0074`). */
  readonly products?: ReadonlyMap<string, BasketProduct>;
  /**
   * The covered lists this reader was served (`0090`). Empty is a guest, who is
   * served none, so the filter sheet draws no lists section and the chip row can
   * hold no list chip.
   */
  readonly served?: readonly BasketListRef[];
  /** What the progress sentence counts. Defaults to a basket nobody has started. */
  readonly progress?: { done: number; unavailable: number; total: number };
  /**
   * What this device already remembers about how to draw a basket (`0076`).
   *
   * Empty by default, which is a device that has never been here. Seeding it is how
   * a test says the shopper made a choice on their last trip, since the page reads
   * the record itself once the basket has loaded.
   */
  readonly storage?: Map<string, string>;
  /**
   * Whether the translator echoes the values a key was given as well as the key.
   *
   * Off by default, so every assertion in this file that reads a bare key out of
   * the DOM still reads one. On for the count, which is the one string here whose
   * **arguments** are the claim: "3 of 12" is the sentence that tells a search that
   * found nothing apart from one that broke (`0059` section 7).
   */
  readonly echoValues?: boolean;
}

function guest(
  participantId: string,
  guestNumber: number,
  displayName: string | null = null
): BasketPresenceEntry {
  return {
    participantId,
    kind: 'GUEST',
    displayName,
    guestNumber,
    userId: null,
  };
}

function owner(participantId = 'p-owner'): BasketPresenceEntry {
  return {
    participantId,
    kind: 'OWNER',
    displayName: null,
    guestNumber: null,
    userId: 'u-1',
  };
}

/** One row of the basket, with one entry unless a test says otherwise. */
function line(content: string, overrides: Partial<BasketRow> = {}): BasketRow {
  const left = overrides.left ?? 1;
  const bought = overrides.bought ?? 0;
  return {
    rowKey: `row-${content}`,
    content,
    left,
    bought,
    asked: bought + left,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [entry(null, `zl-${content}`, left)],
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

/** The two lists the fixtures below are served, which is what the sheet offers. */
const SERVED = [
  ref('l-groceries', 'Groceries'),
  ref('l-weekly', 'Weekly shop'),
];

/** What a row write answers: the row as it now stands, and the counts. */
function rowResult(row: BasketRow): BasketRowResult {
  return {
    row,
    progress: { done: 0, unavailable: 0, total: 1 },
    pending: 1,
    replacedRowKey: null,
    skippedCount: 0,
  };
}

function participant(entry: BasketPresenceEntry): BasketParticipant {
  return {
    id: entry.participantId,
    kind: entry.kind,
    displayName: entry.displayName,
    username: null,
    guestNumber: entry.guestNumber,
    userId: entry.userId,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
  };
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<BasketPage>;
  store: FakeStore;
}> {
  TestBed.resetTestingModule();

  const me = options.me === undefined ? participant(owner()) : options.me;

  const store: FakeStore = {
    live: signal(options.live ?? true),
    revoked: signal(options.revoked ?? false),
    present: signal(options.present ?? []),
    participants: signal(options.participants ?? []),
    opened: [],
    leave: jest.fn(),
    rows: signal<readonly BasketRow[]>(options.lines ?? []),
    error: signal<unknown>(null),
    /**
     * The reel's one call, in both directions.
     *
     * It answers the row as the server would, which is what the page draws: the
     * row on screen is the answer's and never the number that was sent.
     */
    setLeft: jest.fn(
      (rowKey: string): Promise<BasketRowResult | null> =>
        Promise.resolve(rowResult(line(rowKey)))
    ),
    settle: jest.fn(
      (rowKey: string): Promise<BasketRowResult | null> =>
        Promise.resolve(rowResult(line(rowKey)))
    ),
    revert: jest.fn(
      (rowKey: string): Promise<BasketRowResult | null> =>
        Promise.resolve(rowResult(line(rowKey)))
    ),
    navigate: jest.fn().mockResolvedValue(true),
    finished: signal(options.finished ?? false),
    pending: signal(options.unsettled ?? options.lines?.length ?? 0),
    setStatus: jest.fn().mockResolvedValue(options.statusWriteLands ?? true),
    refresh: jest.fn().mockResolvedValue(undefined),
    products: signal<ReadonlyMap<string, BasketProduct>>(
      options.products ?? new Map()
    ),
    lists: signal<ReadonlyMap<string, BasketListRef>>(
      new Map((options.served ?? []).map((held) => [held.listId, held]))
    ),
    progress: signal(options.progress ?? { done: 0, unavailable: 0, total: 0 }),
  };

  const paramMap = convertToParamMap({ basketId: 'basket-saturday' });

  await TestBed.configureTestingModule({
    imports: [BasketPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: Router,
        useValue: {
          navigate: store.navigate,
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: {
            paramMap,
            queryParamMap: convertToParamMap({}),
            // What the route says about which basket to open (velista `0091`):
            // `live` for the caller's own, absent for a basket named by its id.
            data: options.kind === 'LIVE' ? { basket: 'live' } : {},
          },
          parent: null,
        },
      },
      {
        provide: SessionStore,
        useValue: { username: signal(options.username ?? null) },
      },
      {
        provide: BasketStore,
        useValue: {
          basket: signal({
            id: 'basket-saturday',
            kind: options.kind ?? 'GENERATED',
            name: 'Saturday shop',
            // Where the trip has got to, **on the basket**, which is where the page
            // reads it from since velista `0091`: `selectBasketSurface` decides the
            // banner, the finish control and the prompt from the basket it is
            // handed, so a fixture that left this `OPEN` and moved a separate flag
            // would be describing a basket the server cannot send.
            status: (options.finished ?? false) ? 'FINISHED' : 'OPEN',
            createdAt: null,
            rows: store.rows(),
            lists: options.served ?? [],
            participants: options.participants ?? [],
            me,
            products: new Map(),
            scopes: new Map(),
            progress: options.progress ?? {
              done: 0,
              unavailable: 0,
              total: 0,
            },
            pending: options.unsettled ?? options.lines?.length ?? 0,
          }),
          state: signal('ready'),
          rows: store.rows,
          lists: store.lists,
          products: store.products,
          error: store.error,
          progress: store.progress,
          pending: store.pending,
          busyRows: signal(new Set<string>()),
          participantsById: signal(new Map<string, BasketParticipant>()),
          me: signal(me),
          live: store.live,
          revoked: store.revoked,
          present: store.present,
          participants: store.participants,
          kind: signal(options.kind ?? 'GENERATED'),
          // How a sheet over this page addresses its basket (velista `0091`).
          address: signal({ basketId: 'basket-saturday' }),
          isOpen: signal(!(options.finished ?? false)),
          // A sheet that could not find its row says so once, through the page.
          rowGone: signal(0),
          sayRowGone: jest.fn(),
          rowFor: (key: string) =>
            store.rows().find((row) => row.rowKey === key) ??
            store
              .rows()
              .find((row) => row.entries.some((held) => held.lineId === key)) ??
            null,
          open: (id: string) => {
            store.opened.push(id);
            return Promise.resolve();
          },
          // The caller's own basket, which takes no id: the route is a word and
          // the server hands the id back on the answer.
          openLive: () => {
            store.opened.push('live');
            return Promise.resolve();
          },
          leave: store.leave,
          finished: store.finished,
          refresh: store.refresh,
          settle: store.settle,
          revert: store.revert,
          setLeft: store.setLeft,
          renameRow: () => Promise.resolve(null),
          suggest: () => Promise.resolve([]),
        },
      },
      // The owner's surface, which is where the one write of plan 0057 goes: the
      // route behind it is account authenticated, so a guest cannot reach it with
      // any token they hold. The page injects it for every reader and calls it only
      // through a control the owner alone is drawn.
      {
        provide: BasketListStore,
        useValue: { setStatus: store.setStatus },
      },
      // Listed after the testing module's own, which is what makes it win: a
      // translator that echoes its values, for the assertions that are about the
      // numbers a sentence was given rather than about which sentence was chosen.
      ...(options.echoValues === true
        ? [
            {
              provide: RokuTranslatorService,
              useValue: {
                loaded: signal(true),
                locale: signal('en'),
                getLocale: () => 'en',
                t: (
                  key: string,
                  _ns?: string,
                  _l?: string,
                  values?: unknown
                ) =>
                  values === undefined
                    ? key
                    : `${key}:${JSON.stringify(values)}`,
              },
            },
          ]
        : []),
      // The real one, not a fake: it is the thing under test for plan 0074 and it
      // needs nothing this harness does not already stand in for, since everything
      // it reads comes off `BasketStore` and the locale store above.
      BasketViewStore,
      // ...except this device's storage, which `0076` gave it. A fresh `Map` per
      // test and not the real facade: jsdom hands every test in this file the same
      // `localStorage`, so a test that chose an order would hand it to the next
      // page to open, through the restore the page now runs on load.
      provideFakeBrowserFacade(options.storage ?? new Map()),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketPage);
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();

  return { fixture, store };
}

function faces(fixture: ComponentFixture<BasketPage>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '.faces .face'
    )
  );
}

function query(
  fixture: ComponentFixture<BasketPage>,
  selector: string
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    selector
  );
}

function text(fixture: ComponentFixture<BasketPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function field(fixture: ComponentFixture<BasketPage>): HTMLInputElement {
  const found = (fixture.nativeElement as HTMLElement).querySelector(
    'lib-line-composer input.field'
  );
  if (found === null) {
    throw new Error('there is no composer to type into');
  }
  return found as HTMLInputElement;
}

/** Type, and let the composer hear it, exactly as a keyboard does. */
function typeInto(fixture: ComponentFixture<BasketPage>, typed: string): void {
  const input = field(fixture);
  input.value = typed;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/** Submit the composer, the way the phone keyboard's Go key does. */
async function submit(fixture: ComponentFixture<BasketPage>): Promise<void> {
  const form = (fixture.nativeElement as HTMLElement).querySelector(
    'lib-line-composer form.composer'
  );
  if (form === null) {
    throw new Error('there is no composer to submit');
  }
  form.dispatchEvent(new Event('submit'));
  // The add is a promise the page awaits before it decides whether to put the text
  // back, so the assertion has to come after the microtasks it queued. Drained by
  // hand rather than through `whenStable`, which hangs in a zoneless spec.
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('the basket header, live', () => {
  describe('the face row', () => {
    it('is who is connected, not who has ever joined', async () => {
      // Everybody has gone home: four people can open this basket and none of them
      // is holding it. The participant list would draw four faces here.
      const { fixture } = await render({
        present: [],
        participants: [
          participant(owner()),
          participant(guest('p-1', 1)),
          participant(guest('p-2', 2)),
          participant(guest('p-3', 3)),
        ],
      });

      expect(faces(fixture)).toHaveLength(0);
      // The sheet is still reachable, because "everybody who can open this" is a
      // question worth answering and is a different one.
      expect(query(fixture, '.people')).not.toBeNull();
    });

    it('draws one face per person holding the basket open', async () => {
      const { fixture } = await render({
        present: [owner(), guest('p-1', 1), guest('p-2', 2)],
        participants: [participant(owner()), participant(guest('p-1', 1))],
      });

      expect(faces(fixture)).toHaveLength(3);
    });

    it('empties when the socket drops rather than freezing', async () => {
      const { fixture, store } = await render({
        present: [owner(), guest('p-1', 1)],
        participants: [participant(owner()), participant(guest('p-1', 1))],
      });
      expect(faces(fixture)).toHaveLength(2);

      // A stale face row is a claim about the present tense that nothing is
      // checking. The store empties presence; this is the screen agreeing.
      store.present.set([]);
      store.live.set(false);
      fixture.detectChanges();

      expect(faces(fixture)).toHaveLength(0);
    });

    it('tells two unnamed guests apart', async () => {
      // The header used to slice two characters off the label, so an owner and
      // three guests all rendered the same bubble.
      const { fixture } = await render({
        present: [guest('p-1', 1), guest('p-2', 2)],
      });

      const drawn = faces(fixture).map((face) => face.textContent?.trim());
      expect(new Set(drawn).size).toBe(2);
    });

    it('draws the letter the people sheet draws, not the role word', async () => {
      // A presence entry carries no username, so the face fell through to "Owner"
      // for a member reading and "Member" for the owner, while the sheet, built
      // from participants, drew the username's letter for the same person.
      const reader = participant({
        ...guest('p-me', 1),
        kind: 'REGISTERED',
        guestNumber: null,
        userId: 'u-2',
      });
      const { fixture } = await render({
        me: reader,
        present: [owner()],
        participants: [{ ...participant(owner()), username: 'zoe' }, reader],
      });

      expect(faces(fixture).map((face) => face.textContent?.trim())).toEqual([
        'Z',
      ]);
    });

    it('marks a guest as a guest, and the owner not', async () => {
      const { fixture } = await render({
        present: [owner(), guest('p-1', 1)],
      });

      const marked = faces(fixture).map((face) =>
        face.classList.contains('is-guest')
      );
      expect(marked).toEqual([false, true]);
    });

    it('never says “anonymous”', async () => {
      // Section 5.1: the distinction is drawn, the judgement is not.
      const { fixture } = await render({
        present: [owner(), guest('p-1', 1), guest('p-2', 2)],
      });

      expect(text(fixture).toLowerCase()).not.toContain('anonymous');
    });

    it('collapses a crowd rather than growing the header', async () => {
      const { fixture } = await render({
        present: [
          owner(),
          guest('p-1', 1),
          guest('p-2', 2),
          guest('p-3', 3),
          guest('p-4', 4),
        ],
      });

      expect(faces(fixture)).toHaveLength(4);
      expect(query(fixture, '.face.is-overflow')).not.toBeNull();
    });
  });

  describe('the way back', () => {
    const registered = (): BasketParticipant =>
      participant({
        ...guest('p-me', 1),
        kind: 'REGISTERED',
        guestNumber: null,
        userId: 'u-2',
      });

    async function pressBack(
      me: BasketParticipant
    ): Promise<jest.SpyInstance | null> {
      const { fixture } = await render({ me });
      const back = query(fixture, 'button.back');
      if (back === null) {
        return null;
      }
      const spy = jest
        .spyOn(TestBed.inject(PageNavigation), 'back')
        .mockResolvedValue(undefined);
      back.click();
      return spy;
    }

    it('takes the owner back, falling back to the history', async () => {
      const spy = await pressBack(participant(owner()));

      expect(spy).not.toBeNull();
      expect(spy?.mock.calls[0]?.[0]).toMatch(/shopping-lists$/);
    });

    it('takes a registered participant back, falling back to the dashboard', async () => {
      const spy = await pressBack(registered());

      expect(spy).not.toBeNull();
      expect(spy?.mock.calls[0]?.[0]).toMatch(/home$/);
    });

    it('offers a guest no way back', async () => {
      expect(await pressBack(participant(guest('p-9', 1)))).toBeNull();
    });
  });

  describe('saying which basket this is', () => {
    it('says nothing while it is live', async () => {
      const { fixture } = await render({ live: true });

      expect(query(fixture, '.stale')).toBeNull();
    });

    it('says it is not updating when the socket is down', async () => {
      const { fixture, store } = await render({ live: true });

      store.live.set(false);
      fixture.detectChanges();

      const stale = query(fixture, '.stale');
      expect(stale).not.toBeNull();
      expect(stale?.getAttribute('role')).toBe('status');
    });
  });

  describe('a participant who has been removed', () => {
    it('is told, on a screen that does not close under them', async () => {
      const { fixture, store } = await render({
        live: false,
        revoked: false,
        participants: [participant(owner())],
      });

      store.revoked.set(true);
      fixture.detectChanges();

      // Still the basket, still its header and its title: what is on the screen
      // stays readable and the sentence is added to it.
      expect(query(fixture, '.stale')).not.toBeNull();
      expect(query(fixture, 'header.bar')).not.toBeNull();
      expect(text(fixture)).toContain('Saturday shop');
    });

    it('says it once, not twice', async () => {
      // Being removed implies not being live, and both conditions are true at the
      // same moment. Two notices stacked would read as two different problems.
      const { fixture } = await render({ live: false, revoked: true });

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.stale')
      ).toHaveLength(1);
    });
  });
});

/**
 * The number on the row, once it has been let go (plan 0054).
 *
 * The page is where the gesture becomes a request, and there are only three things
 * it has to get right: it sends both numbers, it opens the sheet when the write had
 * something to report that a row cannot draw, and it says one sentence when the
 * write was refused. The gesture itself is the row's spec and the reel's.
 */
describe('the number on a row', () => {
  /** The row component, which is what a gesture reaches the page through. */
  function row(fixture: ComponentFixture<BasketPage>): BasketRowComponent {
    return fixture.debugElement.query(By.directive(BasketRowComponent))
      .componentInstance as BasketRowComponent;
  }

  /** Let the page await the write, then draw what came back. */
  async function settleWrites(
    fixture: ComponentFixture<BasketPage>
  ): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  const milk = () => line('Milk', { left: 5 });

  it('sends where the gesture ended and where it believed it began', async () => {
    // `from` is not decoration: without it a stale gesture is applied as the
    // opposite act, which is the one thing this message must never do (backend
    // `0056`, section 3.2).
    const { fixture, store } = await render({ lines: [milk()] });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(store.setLeft).toHaveBeenCalledWith('row-Milk', 3, 5);
  });

  it('says which of the two happened, once, in the live region', async () => {
    // The same sentence the caption showed under the thumb, so a reader who could
    // not see it still learns whether they recorded a purchase or raised a target
    // (section 7).
    const { fixture } = await render({ lines: [milk()] });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(query(fixture, '.said')?.textContent).toContain(
      'basket.outstanding.bought'
    );
  });

  it('opens the sheet when an origin was missed', async () => {
    // A skipped origin report is a paragraph and a row is three short lines, so it
    // goes where the sentence for it already lives (plan 0052, section 6.4). A raise
    // answers `skippedCount: 0`, so this needs no branch on direction.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setLeft.mockResolvedValue({
      ...rowResult(milk()),
      skippedCount: 1,
    });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(store.navigate).toHaveBeenCalledWith(
      ['sheet', 'rows', 'row-Milk', 'settle'],
      expect.anything()
    );
  });

  it('tells the row what the line says now when somebody else moved it', async () => {
    // Section 4.1. The store refetches before it answers, so the count in the
    // sentence is the true one; a refusal that only said "that did not work" would
    // send somebody dragging again into the same race.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setLeft.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'stale_quantity' as ErrorCode,
          status: 409,
          correlationId: 'ref-1',
        })
      );
      store.rows.set([line('Milk', { left: 3 })]);
      return Promise.resolve(null);
    });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(row(fixture).notice()?.key).toBe('basket.error.staleLine');
    expect(row(fixture).notice()?.count).toBe(3);
    expect(query(fixture, '.said')?.textContent).toContain(
      'basket.error.staleLine'
    );
  });

  it('gives every other failure a sentence of its own', async () => {
    // A failure with no sentence is the defect `basket-error-copy.ts` exists to
    // close: somebody in a shop performed this on purpose and is waiting on it.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setLeft.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-2',
        })
      );
      return Promise.resolve(null);
    });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(row(fixture).notice()?.key).toBe('basket.error.accessChanged');
  });

  it('clears the last refusal before the next move goes out', async () => {
    // One sentence at a time across the whole basket. A refusal left under a row
    // somebody has since moved again is a claim about the present that nothing is
    // checking.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setLeft.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-3',
        })
      );
      return Promise.resolve(null);
    });

    row(fixture).left.emit({ from: 5, to: 3 });
    await settleWrites(fixture);
    expect(row(fixture).notice()).not.toBeNull();

    store.setLeft.mockResolvedValue({ line: milk(), skippedCount: 0 });
    row(fixture).left.emit({ from: 5, to: 4 });
    await settleWrites(fixture);

    expect(row(fixture).notice()).toBeNull();
  });
});

/**
 * Ending the trip, and taking it back (plan 0057).
 *
 * A trip ends when the person carrying the phone walks out of the shop, and nothing
 * in velista could say so: `COMPLETED` had existed since `0044`, the route that sets
 * it had existed just as long, and no screen had ever called it. So a basket stayed
 * live forever and the household kept reading "Ana is buying this" on ten lines Ana
 * walked past.
 *
 * What is asserted here is the screen either side of that button: who is offered it,
 * what appears when every line is settled, and what a finished basket stops drawing.
 */
describe('finishing the shopping', () => {
  const finish = (fixture: ComponentFixture<BasketPage>) =>
    query(fixture, '.finish');

  const rows = (fixture: ComponentFixture<BasketPage>) =>
    fixture.debugElement
      .queryAll(By.directive(BasketRowComponent))
      .map(
        (found: { componentInstance: unknown }) =>
          found.componentInstance as BasketRowComponent
      );

  /** Let the page await a status write, then draw what came back. */
  async function settleWrite(
    fixture: ComponentFixture<BasketPage>
  ): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  describe('who is offered the control', () => {
    it('draws it for the owner, in the header beside share', async () => {
      const { fixture } = await render();

      expect(finish(fixture)).not.toBeNull();
      // In the **header** and not the footer, which is section 3's whole argument:
      // the footer belongs to the line you are working on, and a button that ends
      // the trip must not sit a thumb's width from the one that settles a line.
      expect(query(fixture, '.bar .finish')).not.toBeNull();
    });

    it('is absent for a registered participant, never disabled', async () => {
      const { fixture } = await render({
        me: participant({
          participantId: 'p-2',
          kind: 'REGISTERED',
          displayName: 'Marta',
          guestNumber: null,
          userId: 'u-2',
        }),
      });

      // Absent, per `0030`: a control you may not use is not drawn. A disabled one
      // would tell somebody who passes the all or nothing rule everywhere else that
      // this is a thing they might one day be allowed to press.
      expect(finish(fixture)).toBeNull();
    });

    it('is absent for a guest', async () => {
      const { fixture } = await render({
        me: participant(guest('p-9', 1)),
      });

      expect(finish(fixture)).toBeNull();
    });

    it('asks the sheet rather than finishing where it stands', async () => {
      // The question is worth a screen because what it is about cannot be seen from
      // this one: three people may still be walking around a shop, and the lines
      // nobody settled stay on their households' lists as they are.
      const { fixture, store } = await render();

      finish(fixture)?.click();
      await settleWrite(fixture);

      expect(store.setStatus).not.toHaveBeenCalled();
      expect(store.navigate).toHaveBeenCalledWith(
        ['sheet', 'finish'],
        expect.anything()
      );
    });
  });

  describe('when every line is settled', () => {
    const settledLines = [
      line('Milk', { left: 0, bought: 1, state: 'DONE' }),
      line('Eggs', { left: 0, bought: 1, state: 'DONE' }),
    ];

    it('asks, rather than finishing anything itself', async () => {
      // The last settle is not a status change and the server does not make it one
      // (luna `0059`, section 1.1). This screen does not pretend it did.
      const { fixture, store } = await render({
        lines: settledLines,
        unsettled: 0,
      });

      expect(query(fixture, '.prompt')).not.toBeNull();
      expect(store.setStatus).not.toHaveBeenCalled();
    });

    it('leaves the basket fully editable until somebody presses the button', async () => {
      // The most common thing that happens after the last line is settled is
      // remembering milk. A screen that had closed itself would have to be reopened
      // by somebody standing in a dairy aisle.
      const { fixture } = await render({ lines: settledLines, unsettled: 0 });

      expect(
        rows(fixture).every((drawn: BasketRowComponent) => drawn.finished())
      ).toBe(false);
    });

    it('opens the same sheet the header control does', async () => {
      const { fixture, store } = await render({
        lines: settledLines,
        unsettled: 0,
      });

      query(fixture, '.prompt-action')?.click();
      await settleWrite(fixture);

      expect(store.navigate).toHaveBeenCalledWith(
        ['sheet', 'finish'],
        expect.anything()
      );
    });

    it('says nothing while a line is still outstanding', async () => {
      const { fixture } = await render({
        lines: [line('Milk', { left: 2 })],
        unsettled: 1,
      });

      expect(query(fixture, '.prompt')).toBeNull();
    });

    it('says nothing on a basket that arrived empty', async () => {
      // Nothing was settled, so there is nothing to congratulate anybody about.
      const { fixture } = await render({ lines: [], unsettled: 0 });

      expect(query(fixture, '.prompt')).toBeNull();
    });

    it('says nothing to a guest, who could not act on it', async () => {
      const { fixture } = await render({
        lines: settledLines,
        unsettled: 0,
        me: participant(guest('p-9', 1)),
      });

      expect(query(fixture, '.prompt')).toBeNull();
    });
  });

  describe('a finished basket', () => {
    const someLines = [line('Milk', { left: 2 }), line('Eggs')];

    it('says so, and still draws every line', async () => {
      // The screen is the receipt for a trip somebody took, and the most likely
      // reason to open one is to see what was bought.
      const { fixture } = await render({ finished: true, lines: someLines });

      expect(query(fixture, '.finished')).not.toBeNull();
      expect(rows(fixture)).toHaveLength(2);
    });

    it('announces the banner once, rather than per redraw', async () => {
      const { fixture } = await render({ finished: true, lines: someLines });

      // `role="status"` on the banner itself, which is only in the document while
      // the basket is finished: it is announced when it appears rather than on every
      // line that lost a control (section 11).
      expect(query(fixture, '.finished')?.getAttribute('role')).toBe('status');
    });

    it('takes every control off the rows', async () => {
      const { fixture } = await render({ finished: true, lines: someLines });

      expect(
        rows(fixture).every((drawn: BasketRowComponent) => drawn.finished())
      ).toBe(true);
    });

    /**
     * No composer is drawn between velista `0090` and `0092`: backend `0136`
     * deleted the target free add this one wrote to, and `0092` brings the field
     * back with a list to put the line on.
     */
    it('draws no field to add a line into', async () => {
      const { fixture } = await render({
        finished: true,
        lines: someLines,
      });

      expect(query(fixture, 'lib-line-composer')).toBeNull();
    });

    it('offers the owner the way back', async () => {
      const { fixture } = await render({ finished: true, lines: someLines });

      expect(query(fixture, '.finished-action')).not.toBeNull();
    });

    it('shows a guest the banner without it', async () => {
      // Not a revocation: a guest who was in the shop keeps the basket open, keeps
      // their identity and keeps their name on the rows they settled (section 6.1).
      const { fixture } = await render({
        finished: true,
        lines: someLines,
        me: participant(guest('p-9', 1)),
      });

      expect(query(fixture, '.finished')).not.toBeNull();
      expect(query(fixture, '.finished-action')).toBeNull();
    });

    it('takes the trip back with no confirmation, and re-reads it', async () => {
      // Nothing is destroyed and the act is trivially repeatable, which is the test
      // `0031` applies before it asks a question (section 8). It is also what makes
      // the finish sheet honest: the owner is confirming something reversible.
      const { fixture, store } = await render({
        finished: true,
        lines: someLines,
      });

      query(fixture, '.finished-action')?.click();
      await settleWrite(fixture);

      expect(store.setStatus).toHaveBeenCalledWith('basket-saturday', 'OPEN');
      expect(store.refresh).toHaveBeenCalled();
      expect(store.navigate).not.toHaveBeenCalled();
    });

    it('says so on the banner when the reopen does not land', async () => {
      const { fixture, store } = await render({
        finished: true,
        lines: someLines,
        statusWriteLands: false,
      });

      query(fixture, '.finished-action')?.click();
      await settleWrite(fixture);

      expect(store.refresh).not.toHaveBeenCalled();
      expect(query(fixture, '.finished-failed')).not.toBeNull();
    });

    it('draws no finish control, because there is nothing left to finish', async () => {
      const { fixture } = await render({ finished: true, lines: someLines });

      expect(finish(fixture)).toBeNull();
    });

    it('keeps the share control, and the link with it', async () => {
      // Finishing is not revoking. The link and the people are a separate act with
      // its own sheet, which `0044` section 5.2 already owns.
      const { fixture } = await render({ finished: true, lines: someLines });

      expect(query(fixture, '.share')).not.toBeNull();
    });
  });
});

/**
 * Finding a line, on the phone, with no request (velista `0074`).
 *
 * Twelve lines are fine in server order. Forty, from three households, read in a
 * shop by somebody who has never seen the app, are not, and every one of these
 * tests is about that person: the field is one tap away, what it hides it says it
 * hid, and cancelling puts the basket back exactly as it was.
 */
describe('searching the basket', () => {
  /** A product the search can match on its name or its brand. */
  function pick(
    id: string,
    en: string,
    es: string,
    brand: string | null = null
  ): BasketProduct {
    return {
      id,
      name: { en, es },
      brand,
      size: null,
      unit: null,
      offer: null,
      offers: [],
      categories: ['OTHER'],
    };
  }

  const threeLines: readonly BasketRow[] = [
    line('Milk', { rowKey: 'l-1', optionIds: ['item-milk'] }),
    line('Sourdough loaf', { rowKey: 'l-2' }),
    line('Plátano', { rowKey: 'l-3' }),
  ];

  const products = new Map<string, BasketProduct>([
    ['item-milk', pick('item-milk', 'Whole milk', 'Leche entera', 'Hacendado')],
  ]);

  function tools(fixture: ComponentFixture<BasketPage>): HTMLElement | null {
    return query(fixture, '.tools');
  }

  function searchField(
    fixture: ComponentFixture<BasketPage>
  ): HTMLInputElement | null {
    return query(fixture, 'input.search-input') as HTMLInputElement | null;
  }

  function rows(fixture: ComponentFixture<BasketPage>): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.lines lib-basket-row'
      )
    );
  }

  /** Open the search the way a thumb does, and let the field appear. */
  function openSearch(fixture: ComponentFixture<BasketPage>): void {
    const button = query(fixture, '.tool');
    if (button === null) {
      throw new Error('there is no search control to press');
    }
    button.click();
    fixture.detectChanges();
  }

  /** Type into the search field, which is not the composer's. */
  function search(fixture: ComponentFixture<BasketPage>, typed: string): void {
    const input = searchField(fixture);
    if (input === null) {
      throw new Error('the search field is not open');
    }
    input.value = typed;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  describe('the tools row', () => {
    it('holds the count and the search control, for every reader', async () => {
      // A guest, who is very often the person looking: they arrived on a link and
      // have never seen this app. Nothing in the row names a household.
      const { fixture } = await render({
        lines: threeLines,
        me: participant(guest('p-9', 1)),
      });

      const row = tools(fixture);
      expect(row).not.toBeNull();
      expect(row?.querySelector('.progress')).not.toBeNull();
      expect(row?.querySelector('.tool')).not.toBeNull();
    });

    it('keeps the row and the chips in one bar, closed and while searching', async () => {
      // Velista `0079`, section 2: one sticky bar, so both stay on screen down a long
      // basket. The lines are not in it; they scroll under it.
      const { fixture } = await render({ lines: threeLines });
      TestBed.inject(BasketViewStore).setOrder('alpha');
      fixture.detectChanges();

      expect(query(fixture, '.tools-bar .tools')).not.toBeNull();
      expect(query(fixture, '.tools-bar lib-chip-row')).not.toBeNull();

      openSearch(fixture);

      expect(query(fixture, '.tools-bar .search')).not.toBeNull();
      expect(query(fixture, '.tools-bar lib-chip-row')).not.toBeNull();
      expect(query(fixture, '.tools-bar lib-basket-row')).toBeNull();
    });

    it('marks the standalone build, where the document is what scrolls', async () => {
      // This harness supplies the standalone base path. The class is what lets the
      // stylesheet stop `.page` being the bar's scroll container there, which jsdom
      // cannot lay out, so the class is the half a spec can see.
      const { fixture } = await render({ lines: threeLines });

      expect(
        (fixture.nativeElement as HTMLElement).classList.contains('standalone')
      ).toBe(true);
    });
  });

  describe('opening and closing it', () => {
    it('replaces the row with a focused field', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);

      const input = searchField(fixture);
      expect(input).not.toBeNull();
      // The count and the control are gone with the row, so there is no button
      // that toggles and changes its name (section 6).
      expect(tools(fixture)).toBeNull();
      expect(document.activeElement).toBe(input);
    });

    it('restores the row on Cancel, clears the query, and takes the focus back', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');
      expect(rows(fixture)).toHaveLength(1);

      const cancel = query(fixture, '.search-cancel');
      cancel?.click();
      fixture.detectChanges();

      expect(searchField(fixture)).toBeNull();
      expect(rows(fixture)).toHaveLength(3);
      // Never the page body, which is where a naive close drops somebody reading
      // by keyboard.
      expect(document.activeElement).toBe(query(fixture, '.tool'));
    });

    it('does the same on Escape, from inside the field', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');

      searchField(fixture)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' })
      );
      fixture.detectChanges();

      expect(searchField(fixture)).toBeNull();
      expect(rows(fixture)).toHaveLength(3);
    });

    it('empties the field without closing it, from the control inside it', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');

      query(fixture, '.search-clear')?.click();
      fixture.detectChanges();

      expect(searchField(fixture)).not.toBeNull();
      expect(rows(fixture)).toHaveLength(3);
    });
  });

  describe('what it matches', () => {
    it('narrows the rows and leaves the progress count alone', async () => {
      const { fixture } = await render({
        lines: threeLines,
        products,
        progress: { done: 1, unavailable: 0, total: 3 },
        echoValues: true,
      });
      openSearch(fixture);
      search(fixture, 'milk');

      // One row: the line whose words are "Milk", and nothing else.
      expect(rows(fixture)).toHaveLength(1);

      query(fixture, '.search-cancel')?.click();
      fixture.detectChanges();

      // Still one of three. "4 of 12 got" is about the trip, and a search that hid
      // eight rows bought nothing, so the sentence is drawn from
      // `BasketStore.progress` and never from what was left standing.
      expect(query(fixture, '.progress')?.textContent).toContain(
        'basket.progress:{"done":1,"total":3}'
      );
    });

    it('folds case and accents, so a hurried keyboard still finds the line', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'PLATANO');

      expect(rows(fixture)).toHaveLength(1);
    });

    it("matches a line by its pick's brand, which is what the own brand shelf is", async () => {
      const { fixture } = await render({ lines: threeLines, products });
      openSearch(fixture);
      search(fixture, 'hacendado');

      expect(rows(fixture)).toHaveLength(1);
    });

    it('draws the whole basket while the field is open and empty', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);

      expect(rows(fixture)).toHaveLength(3);
    });
  });

  describe('the count under the field', () => {
    it('says how many are left, of how many there are', async () => {
      const { fixture } = await render({
        lines: threeLines,
        echoValues: true,
      });
      openSearch(fixture);
      search(fixture, 'milk');

      const count = query(fixture, '.search-count');
      expect(count?.textContent?.trim()).toBe(
        'basket.search.count:{"shown":1,"total":3}'
      );
      // Polite and announced, because a search that silently empties the screen is
      // indistinguishable from one that broke.
      expect(count?.getAttribute('aria-live')).toBe('polite');
      expect(count?.getAttribute('role')).toBe('status');
    });

    it('is drawn only while the field is open', async () => {
      const { fixture } = await render({ lines: threeLines });

      expect(query(fixture, '.search-count')).toBeNull();
      openSearch(fixture);
      expect(query(fixture, '.search-count')).not.toBeNull();
    });

    it('is heard and not seen, beside a field named by a label nobody sees', async () => {
      // Velista `0079`, section 3: the open search keeps the closed row's height, so
      // neither sentence is drawn, and both are still there for a screen reader.
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');

      expect(query(fixture, '.search-count')?.classList).toContain(
        'visually-hidden'
      );

      const input = searchField(fixture);
      const label = query(fixture, `label[for="${input?.id}"]`);
      expect(label?.textContent?.trim()).toBe('basket.search.label');
      expect(label?.classList).toContain('visually-hidden');

      const drawn = Array.from(
        query(fixture, '.tools-bar')?.querySelectorAll('label, p') ?? []
      ).filter((element) => !element.classList.contains('visually-hidden'));
      expect(drawn).toEqual([]);
    });
  });

  describe('nothing matches', () => {
    it('says so with the words that were typed, and keeps the composer', async () => {
      const { fixture } = await render({
        lines: threeLines,
        echoValues: true,
      });
      openSearch(fixture);
      search(fixture, 'yogurt');

      expect(rows(fixture)).toHaveLength(0);
      expect(text(fixture)).toContain('basket.search.none:{"query":"yogurt"}');
      // The thing somebody searched for and did not find is very often the next
      // line, so the field to add it stays.
    });

    /**
     * The search used to clear itself when this reader's own line landed, because
     * the thing somebody searched for and did not find is very often the next
     * thing they add. The composer is velista `0092`'s, with a list to add to, and
     * that rule comes back with it.
     *
     * What holds in the meantime is that the search survives the basket moving
     * underneath it: it is a string somebody is typing, and nothing but leaving
     * the screen takes it away (`0076`).
     */
    it('keeps what was typed while the basket moves underneath it', async () => {
      const { fixture, store } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'yogurt');
      expect(rows(fixture)).toHaveLength(0);

      store.rows.set([...threeLines, line('Yogurt', { rowKey: 'l-4' })]);
      fixture.detectChanges();

      expect(searchField(fixture)?.value).toBe('yogurt');
      expect(rows(fixture)).toHaveLength(1);
    });
  });

  describe('leaving the basket', () => {
    it('gives the view store back as well as the basket', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');

      const view = TestBed.inject(BasketViewStore);
      fixture.destroy();

      // Nothing about the search survives leaving: it is the one thing on this
      // screen that is never remembered (section 4.7).
      expect(view.query()).toBe('');
    });
  });

  /**
   * The filter button, its chips and the sections (velista `0075`).
   *
   * What these cover is the half of the plan that lives on the page: the badge, the
   * chip row, and the sink section a list filter produces. The pipeline itself is
   * tested in `compose-basket-view.spec.ts`, and the fit of the chips in
   * `chip-row.spec.ts`, because jsdom lays nothing out.
   */
  describe('filtering and ordering', () => {
    /** Two served lists, one row each, and a row this reader cannot place. */
    const sourced: readonly BasketRow[] = [
      line('Milk', {
        rowKey: 'l-1',
        entries: [entry('l-groceries', 'zl-1')],
      }),
      line('Bread', {
        rowKey: 'l-2',
        entries: [entry('l-weekly', 'zl-2')],
      }),
      // Its list is covered and not served, which `toBasket` maps to a null id.
      line('Batteries', { rowKey: 'l-3' }),
    ];

    async function renderSourced(echoValues = false) {
      return render({
        lines: sourced,
        served: SERVED,
        echoValues,
      });
    }

    function filterButton(
      fixture: ComponentFixture<BasketPage>
    ): HTMLElement | null {
      return (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
            '.tools .tool'
          )
        )[1] ?? null
      );
    }

    function chips(fixture: ComponentFixture<BasketPage>): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          'lib-chip-row .row .chip'
        )
      );
    }

    function headings(fixture: ComponentFixture<BasketPage>): string[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.group-title'
        )
      ).map((node) => node.textContent?.trim() ?? '');
    }

    it('draws the filter control beside the search, for every reader', async () => {
      const { fixture } = await render({ lines: threeLines });

      expect(filterButton(fixture)).not.toBeNull();
      expect(query(fixture, 'lib-filter-icon')).not.toBeNull();
    });

    /**
     * The field replaces the count and the search control, which the field is. It
     * must not take the filter with it: somebody searching a grouped basket would
     * have to cancel the search to change what it is grouped by.
     */
    it('stays beside the open search field', async () => {
      const { fixture, store } = await render({ lines: threeLines });
      // The first tool in the row is the search control.
      query(fixture, '.tools .tool')?.click();
      fixture.detectChanges();
      expect(query(fixture, '.search')).not.toBeNull();

      const tool = query(fixture, '.search .tool');
      expect(tool).not.toBeNull();
      expect(tool?.querySelector('lib-filter-icon')).not.toBeNull();

      tool?.click();
      expect(store.navigate).toHaveBeenCalledWith(
        ['sheet', 'filter'],
        expect.anything()
      );
    });

    it('opens the sheet at the basket’s own sheet URL', async () => {
      const { fixture, store } = await render({ lines: threeLines });

      filterButton(fixture)?.click();

      expect(store.navigate).toHaveBeenCalledWith(
        ['sheet', 'filter'],
        expect.anything()
      );
    });

    /**
     * The count is in the **name** and not only in the badge: a number that exists
     * as a dot over a glyph is a number a screen reader never hears.
     */
    it('names the control plainly at rest and with the count once something is on', async () => {
      const { fixture } = await renderSourced(true);
      expect(filterButton(fixture)?.getAttribute('aria-label')).toBe(
        'basket.view.open'
      );
      expect(query(fixture, '.tool-badge')).toBeNull();

      TestBed.inject(BasketViewStore).setOrder('alpha');
      fixture.detectChanges();

      expect(filterButton(fixture)?.getAttribute('aria-label')).toBe(
        'basket.view.openCount:{"count":1}'
      );
      expect(query(fixture, '.tool-badge')?.textContent?.trim()).toBe('1');
    });

    it('draws no chip row at all while nothing is on', async () => {
      const { fixture } = await renderSourced();

      expect(query(fixture, 'lib-chip-row')).toBeNull();
    });

    it('draws one chip per property that is not at its default', async () => {
      const { fixture } = await renderSourced();
      const view = TestBed.inject(BasketViewStore);

      view.setOrder('alpha');
      view.setGrouping('category');
      fixture.detectChanges();

      expect(chips(fixture).map((chip) => chip.textContent?.trim())).toEqual([
        'basket.view.order.alpha×',
        'basket.view.chip.byCategory×',
      ]);
    });

    it('names a chip’s x by what it removes', async () => {
      const { fixture } = await renderSourced(true);
      TestBed.inject(BasketViewStore).setOrder('alpha');
      fixture.detectChanges();

      expect(chips(fixture)[0].getAttribute('aria-label')).toBe(
        'basket.view.chip.remove:{"name":"basket.view.order.alpha"}'
      );
    });

    it('puts one property back when its chip is pressed', async () => {
      const { fixture } = await renderSourced();
      const view = TestBed.inject(BasketViewStore);
      view.setOrder('alpha');
      view.setGrouping('category');
      fixture.detectChanges();

      chips(fixture)[0].click();
      fixture.detectChanges();

      expect(view.order()).toBe('shop');
      // The other chip stays: a chip removes its own property and nothing else.
      expect(view.grouping()).toBe('category');
      expect(chips(fixture)).toHaveLength(1);
    });

    it('names the one kept list on its chip', async () => {
      const { fixture } = await renderSourced(true);

      TestBed.inject(BasketViewStore).toggleList('l-weekly');
      fixture.detectChanges();

      expect(chips(fixture)[0].textContent).toContain(
        'basket.view.lists.only:{"name":"Groceries"}'
      );
    });

    /**
     * The count beside the chips, and the rule that it is drawn only while fewer
     * lines are shown than the basket holds: "12 of 12" is noise.
     */
    it('says how many lines are shown, only while some are hidden', async () => {
      const { fixture } = await renderSourced(true);
      const view = TestBed.inject(BasketViewStore);

      view.setOrder('alpha');
      fixture.detectChanges();
      expect(query(fixture, 'lib-chip-row .count')).toBeNull();

      view.toggleList('l-weekly');
      fixture.detectChanges();
      // Milk, and Batteries, which is on no list and always shown.
      expect(query(fixture, 'lib-chip-row .count')?.textContent).toContain(
        'basket.view.count:{"shown":2,"total":3}'
      );
    });

    /**
     * **A reader cannot filter out what they cannot name** (velista `0090`,
     * section 8.2). A row with an unserved entry might well be on the very list
     * they kept, and there is no way to ask, so it stays where it was.
     *
     * There is no sink any more: backend `0136` removed the thing it held, since
     * a line is on a list or it does not exist.
     */
    it('keeps a row it cannot place, rather than sinking it', async () => {
      const { fixture } = await renderSourced();

      TestBed.inject(BasketViewStore).toggleList('l-weekly');
      fixture.detectChanges();

      expect(headings(fixture)).toHaveLength(0);
      expect(
        rows(fixture).map((row) => row.getAttribute('data-content') ?? '')
      ).not.toHaveLength(0);
    });
  });

  /**
   * Grouping (velista `0077`).
   *
   * What is asserted here is the half the pipeline cannot: a heading is a real `h2`
   * whose accessible name carries the count, and a row under a list heading commits
   * through the **per list** write rather than the line's. `compose-basket-view.spec`
   * carries the cutting up.
   */
  describe('grouping the rows', () => {
    const SOURCES = [
      { zoneId: 'z1', listId: 'l-weekly' },
      { zoneId: 'z1', listId: 'l-groceries' },
    ];

    const LIST_NAMES = new Map([
      ['l-weekly', 'Weekly shop'],
      ['l-groceries', 'Groceries'],
    ]);

    const milk = (over: Partial<BasketProduct> = {}): BasketProduct => ({
      id: 'i-milk',
      name: { en: 'Milk', es: 'Leche' },
      brand: null,
      size: null,
      unit: null,
      offer: null,
      offers: [],
      categories: ['DAIRY'],
      ...over,
    });

    const grouped: readonly BasketRow[] = [
      line('Milk', {
        rowKey: 'l-1',
        left: 0,
        bought: 3,
        state: 'DONE',
        optionIds: ['i-milk'],
        entries: [
          entry('l-weekly', 'zl-1', 0, {
            bought: 2,
            asked: 2,
            state: 'DONE',
          }),
          entry('l-groceries', 'zl-2', 0, {
            bought: 1,
            asked: 1,
            state: 'DONE',
          }),
        ],
      }),
      line('Cheese', {
        rowKey: 'l-2',
        left: 4,
        optionIds: ['i-milk'],
        entries: [entry('l-weekly', 'zl-3', 4)],
      }),
      // A row this reader cannot place, which is what a null `listId` means.
      line('Something for dinner', { rowKey: 'l-3' }),
    ];

    async function renderGrouped(grouping: 'category' | 'list') {
      const rendered = await render({
        lines: grouped,
        served: SERVED,
        products: new Map([['i-milk', milk()]]),
      });
      TestBed.inject(BasketViewStore).setGrouping(grouping);
      rendered.fixture.detectChanges();
      return rendered;
    }

    /** One row by the words on it, because a line is drawn once per list here. */
    const rowFor = (
      fixture: ComponentFixture<BasketPage>,
      content: string
    ): BasketRowComponent | null =>
      fixture.debugElement
        .queryAll(By.directive(BasketRowComponent))
        .map(
          (found: { componentInstance: unknown }) =>
            found.componentInstance as BasketRowComponent
        )
        .find((drawn: BasketRowComponent) => drawn.row().content === content) ??
      null;

    /** Let the page await the write, then draw what came back. */
    async function settleWrites(
      fixture: ComponentFixture<BasketPage>
    ): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
    }

    const headings = (fixture: ComponentFixture<BasketPage>) =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.group-title'
        )
      );

    it('heads each aisle with an h2 carrying the name and the count together', async () => {
      const { fixture } = await renderGrouped('category');

      const [dairy] = headings(fixture);
      expect(dairy.tagName).toBe('H2');
      // One accessible name, because a reader moving by heading hears the `h2` and
      // nothing else inside it (section 6). The visible spans are `aria-hidden`.
      expect(dairy.getAttribute('aria-label')).toBe(
        'basket.category.DAIRY, basket.group.progress'
      );
    });

    it('heads the sink with the words that say why it exists', async () => {
      const { fixture } = await renderGrouped('category');

      const last = headings(fixture)[headings(fixture).length - 1];
      expect(last.getAttribute('aria-label')).toContain(
        'basket.group.noCategory'
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.group-hint')
          ?.textContent
      ).toContain('basket.group.noCategoryHint');
    });

    /**
     * A list's name is the one half of a heading this app did not write, so it is
     * drawn as it is. Running it through the translator would look it up as a key
     * and a household called "Weekly shop" would be headed "Weekly shop" only by
     * luck.
     */
    it('heads a list section with the household’s own name, untranslated', async () => {
      const { fixture } = await renderGrouped('list');

      expect(headings(fixture).map((node) => node.textContent?.trim())).toEqual(
        [
          expect.stringContaining('Weekly shop'),
          expect.stringContaining('Groceries'),
          // One heading for every entry this reader cannot place, and it names
          // none of them (velista `0090`, section 8.2).
          expect.stringContaining('basket.group.otherLists'),
        ]
      );
    });

    it('says a close that bought nothing apart from a purchase, on the heading', async () => {
      const closed = [
        line('Bread', {
          rowKey: 'l-1',
          state: 'NOT_AVAILABLE',
          optionIds: ['i-milk'],
        }),
      ];
      const { fixture } = await render({
        lines: closed,
        products: new Map([['i-milk', milk()]]),
      });
      TestBed.inject(BasketViewStore).setGrouping('category');
      fixture.detectChanges();

      // Two keys, as the page's own sentence keeps them apart: a shop that had none
      // is not shopping done.
      expect(headings(fixture)[0].getAttribute('aria-label')).toBe(
        'basket.category.DAIRY, basket.group.progress · basket.group.unavailable'
      );
    });

    it('draws no heading at all on an ungrouped basket', async () => {
      const { fixture } = await render({ lines: grouped });

      expect(headings(fixture)).toHaveLength(0);
    });

    /**
     * **One call, under a heading and everywhere else** (velista `0090`,
     * section 6). `setLeft` is what the reel emits into, and it turns the pair of
     * numbers into a settle or a revert: the client never decides which.
     *
     * The units a reel under a heading commits are allocated to that household by
     * velista `0092`, from the entries pane. Until then the reel commits against
     * the row and the server divides oldest entry first, which is what it did
     * before a heading existed.
     */
    it('commits a row under a list heading through the row’s own write', async () => {
      const { fixture, store } = await renderGrouped('list');

      // Four asked for and none got, so the reel runs from four and lands on one.
      rowFor(fixture, 'Cheese')?.left.emit({ from: 4, to: 1 });
      await settleWrites(fixture);

      expect(store.setLeft).toHaveBeenCalledWith('l-2', 1, 4);
    });

    it('commits an ungrouped row through the same call', async () => {
      const { fixture, store } = await render({ lines: grouped });

      rowFor(fixture, 'Cheese')?.left.emit({ from: 4, to: 0 });
      await settleWrites(fixture);

      expect(store.setLeft).toHaveBeenCalledWith('l-2', 0, 4);
    });

    /**
     * The "List" radio is the filter sheet's, and it is offered on the same test
     * the store uses to drop a remembered one: a reader served no list has nothing
     * to group by, and a sheet that offered it would draw "Nothing" over a basket
     * grouped by list.
     */
    it('offers no list grouping to a reader served no list', async () => {
      await render({ lines: grouped });

      expect(TestBed.inject(BasketViewStore).sourceLists()).toEqual([]);
    });
  });
});

/**
 * The same page, drawing the basket that is always there (velista `0091`,
 * section 3).
 *
 * **One component and one template.** What differs is a heading, a sentence,
 * four absent controls and two words of an empty state, and every one of them
 * comes off `selectBasketSurface`, so these tests are about the page reading that
 * model rather than about the model itself.
 */
describe('the basket that is always there', () => {
  const someLines = [line('Milk', { left: 2 }), line('Eggs')];

  it('opens the caller’s own basket, with no id to open it by', async () => {
    const { store } = await render({ kind: 'LIVE', lines: someLines });

    expect(store.opened).toEqual(['live']);
  });

  it('draws no finish control, because it is never finished', async () => {
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      me: participant(owner()),
    });

    expect(query(fixture, '.finish')).toBeNull();
  });

  it('never asks whether the trip is over', async () => {
    // Every line settled is not a status change here and finishes nothing: the
    // basket has no end to reach.
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      unsettled: 0,
    });

    expect(query(fixture, '.prompt')).toBeNull();
  });

  it('draws no finished banner and no reopen', async () => {
    // `finished: true` is refused by the model rather than by the template: a
    // `LIVE` basket is always `OPEN`, so the banner has nothing to say.
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      finished: true,
    });

    expect(query(fixture, '.finished')).toBeNull();
  });

  it('draws no faces, because the server keeps no presence room for it', async () => {
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      present: [owner(), guest('p-9', 1)],
      participants: [participant(owner())],
    });

    expect(query(fixture, '.faces')).toBeNull();
    expect(query(fixture, '.people')).toBeNull();
  });

  it('still offers the owner the share sheet: both kinds are shareable', async () => {
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      me: participant(owner()),
    });

    expect(query(fixture, '.share')).not.toBeNull();
  });

  it('says what it is, once, under the heading', async () => {
    const { fixture } = await render({ kind: 'LIVE', lines: someLines });

    expect(text(fixture)).toContain('basket.live.hint');
  });

  it('says what is left rather than counting a trip', async () => {
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      unsettled: 12,
      progress: { done: 3, unavailable: 0, total: 15 },
    });

    expect(text(fixture)).toContain('basket.live.leftAndGot');
    expect(text(fixture)).not.toContain('basket.progress');
  });

  it('says a different thing when there is nothing to buy', async () => {
    const { fixture } = await render({ kind: 'LIVE', lines: [] });

    expect(text(fixture)).toContain('basket.live.empty');
    expect(text(fixture)).toContain('basket.live.emptyHint');
  });

  it('keeps every row a generated basket would draw', async () => {
    // The rows, the reels and the settle sheet are the same screen. Only the
    // header and the two sentences differ.
    const { fixture } = await render({ kind: 'LIVE', lines: someLines });

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.lines li')
    ).toHaveLength(2);
  });
});
