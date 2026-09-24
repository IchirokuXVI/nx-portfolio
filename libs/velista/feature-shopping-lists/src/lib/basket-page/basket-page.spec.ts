import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
  type NavigationExtras,
  type Params,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BASKET_SERVICE,
  BasketChangeStore,
  BasketListStore,
  BasketStore,
  BasketTargetStore,
  BasketViewStore,
  GatewayError,
  SessionStore,
} from '@portfolio/velista/data-access';
import type {
  BasketAccessEnded,
  BasketListRef,
  BasketParticipant,
  BasketPresenceEntry,
  BasketProduct,
  BasketRow,
  BasketRowEntry,
  BasketRowResult,
  BasketShop,
  CatalogSuggestion,
  ErrorCode,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BehaviorSubject, of } from 'rxjs';
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
  /**
   * Why the reader is off the basket, once they are (velista `0094`).
   *
   * Null while they are still on it, which is every spec that is not about the
   * ended state. `UNKNOWN` and `REMOVED` draw one sentence and `EXPIRED` draws
   * another.
   */
  readonly accessEnded: WritableSignal<BasketAccessEnded | null>;
  /**
   * How the read has got on, writable so a spec can put the page on the state a
   * refusal leaves it in.
   *
   * Ready everywhere else, which is what nearly every test on this page wants.
   */
  readonly state: WritableSignal<string>;
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
  /** The device's shop, which `BasketStore.readAtShop` sets (velista `0102`). */
  readonly readAt: WritableSignal<string | null>;
  readonly readAtShop: jest.Mock;
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
  /**
   * The sentence a sheet handed the page on its way out (velista `0092`,
   * section 6.2).
   *
   * Writable, because what a spec is asserting is that the page **says** it: the
   * sheet that composed it is gone by then, so a spec stands in for it.
   */
  readonly handedOver: WritableSignal<{ text: string; seq: number } | null>;
  readonly handOver: jest.Mock;
  /** Whether an add is out, which the composer's button waits on. */
  readonly adding: WritableSignal<boolean>;
  /** Every line added from the dock, and what it answered. */
  readonly addLine: jest.Mock;
}

interface Options {
  /** `?search=1`, the open search (velista `0109`). */
  readonly search?: boolean;
  readonly live?: boolean;
  readonly revoked?: boolean;
  /** Why the reader lost the basket, for the two endings of velista `0094`. */
  readonly accessEnded?: BasketAccessEnded | null;
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
   * The ids of the reader's baskets being shopped, newest first, which is where the
   * basket tab sends them (velista `0105`). Empty by default, so this basket is an
   * older one and keeps its way back.
   */
  readonly activeBasketIds?: readonly string[];
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
  /**
   * How many changes are new to this viewer (velista `0093`, section 5).
   *
   * Zero by default, which is a basket nobody has changed under the reader, and
   * draws no banner. The number is the **server's**: the page never counts it
   * and never takes it down after a tap.
   */
  readonly unseenChanges?: number;
  /**
   * The shop this device reads the basket at, already answered (velista `0102`),
   * or none. What the usual filter of velista `0104` needs to have anything to do.
   */
  readonly readAtShop?: BasketShop;
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

/**
 * Somebody with an account who is not the owner (velista `0092`, section 7.1).
 *
 * The composer's rule turns on holding an account rather than on being the
 * owner, so this is the reader that tells the two conditions apart: they get the
 * field where a guest does not, and they lose it when the basket covers no list
 * they may write.
 */
function registered(participantId = 'p-dana'): BasketPresenceEntry {
  return {
    participantId,
    kind: 'REGISTERED',
    displayName: 'Dana',
    guestNumber: null,
    userId: 'u-2',
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
    usual: null,
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
    // Nobody in these fixtures is on the basket with a link unless a spec says
    // so: an expiry is what makes the visit notice appear, and it would
    // otherwise be drawn over every test on this page.
    expiresAt: null,
  };
}

/** Somebody a link let in, whose time on the basket runs out (velista `0094`). */
function visitor(
  entry: BasketPresenceEntry,
  endsInMinutes: number
): BasketParticipant {
  return {
    ...participant(entry),
    shareLinkId: 'sl1',
    expiresAt: new Date(Date.now() + endsInMinutes * 60 * 1000),
  };
}

/**
 * A route's query as the router keeps it: observable, merged into by a navigation, and
 * replaced by a navigation to a whole URL.
 */
function queryOnRoute(initial: Params) {
  const queryParamMap = new BehaviorSubject(convertToParamMap(initial));
  let params: Params = initial;

  return {
    queryParamMap,
    set(next: Params): void {
      params = next;
      queryParamMap.next(convertToParamMap(next));
    },
    /** `queryParamsHandling: 'merge'`, where a null takes a parameter off. */
    merged(extra: Params | null | undefined): Params {
      const next: Params = { ...params };
      for (const [key, value] of Object.entries(extra ?? {})) {
        if (value === null || value === undefined) {
          delete next[key];
        } else {
          next[key] = value;
        }
      }
      return next;
    },
  };
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<BasketPage>;
  store: FakeStore;
}> {
  TestBed.resetTestingModule();

  const me = options.me === undefined ? participant(owner()) : options.me;
  // The device's shop (velista `0102`), read at once by this double.
  const readAt = signal<string | null>(options.readAtShop?.id ?? null);

  const store: FakeStore = {
    live: signal(options.live ?? true),
    revoked: signal(options.revoked ?? false),
    accessEnded: signal<BasketAccessEnded | null>(options.accessEnded ?? null),
    state: signal<string>('ready'),
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
    readAt,
    readAtShop: jest.fn((locationId: string | null) => {
      readAt.set(locationId);
      return Promise.resolve();
    }),
    products: signal<ReadonlyMap<string, BasketProduct>>(
      options.products ?? new Map()
    ),
    lists: signal<ReadonlyMap<string, BasketListRef>>(
      new Map((options.served ?? []).map((held) => [held.listId, held]))
    ),
    progress: signal(options.progress ?? { done: 0, unavailable: 0, total: 0 }),
    handedOver: signal<{ text: string; seq: number } | null>(null),
    handOver: jest.fn(),
    adding: signal(false),
    // An add answers the row it landed on, exactly as the store folds it: the row
    // on screen is the answer's and never the words that were typed.
    addLine: jest.fn(
      (body: { content: string }): Promise<BasketRowResult | null> =>
        Promise.resolve(
          rowResult({ ...line('zl-added'), content: body.content })
        )
    ),
  };

  const paramMap = convertToParamMap({ basketId: 'basket-saturday' });

  // The URL's query, which holds whether the search is open (velista `0109`). The
  // router below moves it the way the real one would, so opening the search, Cancel
  // and the phone's back button all reach the page through the route, as they do in
  // the app.
  const url = queryOnRoute(options.search === true ? { search: '1' } : {});
  store.navigate.mockImplementation(
    (commands: readonly unknown[], extras?: NavigationExtras) => {
      if (commands.length === 0) {
        url.set(url.merged(extras?.queryParams));
      }
      return Promise.resolve(true);
    }
  );

  await TestBed.configureTestingModule({
    imports: [BasketPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: Router,
        useValue: {
          navigate: store.navigate,
          navigateByUrl: jest.fn((to: string) => {
            url.set(
              Object.fromEntries(new URL(to, 'http://velista').searchParams)
            );
            return Promise.resolve(true);
          }),
          // What `ListSearchNavigation.close` builds its fallback from.
          createUrlTree: (_: unknown, extras?: NavigationExtras) =>
            url.merged(extras?.queryParams),
          serializeUrl: (params: Params) =>
            `/shopping-lists/basket-saturday${
              Object.keys(params).length === 0
                ? ''
                : `?${new URLSearchParams(params)}`
            }`,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          queryParamMap: url.queryParamMap,
          snapshot: {
            paramMap,
            get queryParamMap() {
              return url.queryParamMap.value;
            },
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
            // The shop the read was made at, which names it (velista `0102`).
            shop: options.readAtShop ?? null,
            progress: options.progress ?? {
              done: 0,
              unavailable: 0,
              total: 0,
            },
            pending: options.unsettled ?? options.lines?.length ?? 0,
            unseenChangeCount: options.unseenChanges ?? 0,
            newestUnseenChangeId:
              (options.unseenChanges ?? 0) > 0 ? 'chg-newest' : null,
          }),
          state: store.state,
          rows: store.rows,
          lists: store.lists,
          products: store.products,
          // The device's shop (velista `0102`), read at once by this double.
          readAt: store.readAt,
          shopRead: store.readAt,
          readAtShop: store.readAtShop,
          error: store.error,
          progress: store.progress,
          pending: store.pending,
          busyRows: signal(new Set<string>()),
          participantsById: signal(new Map<string, BasketParticipant>()),
          me: signal(me),
          live: store.live,
          revoked: store.revoked,
          accessEnded: store.accessEnded,
          present: store.present,
          participants: store.participants,
          kind: signal(options.kind ?? 'GENERATED'),
          // How a sheet over this page addresses its basket (velista `0091`).
          address: signal({ basketId: 'basket-saturday' }),
          isOpen: signal(!(options.finished ?? false)),
          // A sheet that could not find its row says so once, through the page.
          rowGone: signal(0),
          sayRowGone: jest.fn(),
          // A sentence a sheet composed on its way out, for this page to say in
          // the one live region this screen has (velista `0092`, section 6.2).
          handedOver: store.handedOver,
          handOver: store.handOver,
          // What the composer needs: whether an add is out, and the add itself.
          adding: store.adding,
          addLine: store.addLine,
          chosen: signal(new Map<string, string>()),
          choose: jest.fn(),
          itemIdFor: () => undefined,
          skip: jest.fn().mockResolvedValue(null),
          unskip: jest.fn().mockResolvedValue(null),
          setDemand: jest.fn().mockResolvedValue(null),
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
        useValue: {
          setStatus: store.setStatus,
          active: signal((options.activeBasketIds ?? []).map((id) => ({ id }))),
        },
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
      // The real one, beside `BasketViewStore`: the route provides both, it
      // reads the faked `BasketStore` above and a `BrowserFacade`
      // `provideVelistaTesting` already supplies, and its whole job is to answer
      // where the composer's next line goes (velista `0092`, section 7.2).
      BasketTargetStore,
      // The fourth store the route provides (velista `0093`). The page never
      // draws an entry from it and still lets it go on the way out, so the
      // instance has to exist; the banner's count comes off the basket read.
      BasketChangeStore,
      // The one thing it reaches past `BasketStore` for. This file fakes the
      // store rather than the gateway, so the real token behind it is not
      // provided anywhere; the sheet is what exercises these two calls.
      {
        provide: BASKET_SERVICE,
        useValue: {
          changes: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
          acknowledgeChanges: jest.fn().mockResolvedValue(undefined),
        },
      },
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
      me: BasketParticipant,
      options: Options = {}
    ): Promise<jest.SpyInstance | null> {
      const { fixture } = await render({ ...options, me });
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

    /**
     * The basket tab's own baskets (velista `0105`). The bottom bar is on screen
     * with that tab lit, so the bar is the way out and a chevron would be a second.
     */
    describe('on the basket the tab opens', () => {
      it('draws no chevron on the permanent basket', async () => {
        expect(
          await pressBack(participant(owner()), { kind: 'LIVE' })
        ).toBeNull();
      });

      it('draws no chevron on the newest basket being shopped', async () => {
        expect(
          await pressBack(participant(owner()), {
            activeBasketIds: ['basket-saturday', 'basket-older'],
          })
        ).toBeNull();
      });

      it('keeps the chevron on an older basket opened from the history', async () => {
        const spy = await pressBack(participant(owner()), {
          activeBasketIds: ['basket-newer', 'basket-saturday'],
        });

        expect(spy).not.toBeNull();
        expect(spy?.mock.calls[0]?.[0]).toMatch(/shopping-lists$/);
      });
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

    expect(store.setLeft).toHaveBeenCalledWith('row-Milk', 3, 5, {});
  });

  describe('the price scope (velista 0095, section 6)', () => {
    const priced = new Map<string, BasketProduct>([
      [
        'item-milk',
        {
          id: 'item-milk',
          name: { en: 'Whole milk', es: 'Leche entera' },
          brand: null,
          size: null,
          unit: null,
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
          offers: [],
          atShop: null,
          categories: ['DAIRY'],
        },
      ],
    ]);
    const pricedMilk = () =>
      line('Milk', { left: 5, optionIds: ['item-milk'] });

    it('the reel names the scope of the price the row draws', async () => {
      const { fixture, store } = await render({
        lines: [pricedMilk()],
        products: priced,
      });

      row(fixture).left.emit({ from: 5, to: 3 });
      await settleWrites(fixture);

      expect(store.setLeft).toHaveBeenCalledWith('row-Milk', 3, 5, {
        priceScopeId: 's-dia',
      });
    });

    it('the status control names it too, and never an amount', async () => {
      const { fixture, store } = await render({
        lines: [pricedMilk()],
        products: priced,
      });

      row(fixture).settle.emit();
      await settleWrites(fixture);

      const [, body] = store.settle.mock.calls[0];
      expect(body).toEqual({
        outcome: 'BOUGHT',
        quantity: 5,
        from: 5,
        priceScopeId: 's-dia',
      });
    });

    it('names no scope for a row that draws no price', async () => {
      const { fixture, store } = await render({ lines: [milk()] });

      row(fixture).settle.emit();
      await settleWrites(fixture);

      expect(store.settle.mock.calls[0][1]).not.toHaveProperty('priceScopeId');
    });
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

    it('scrolls in its own column in both run modes, with the composer after it', () => {
      // velista 0106. The app is a frame that never scrolls, so `.page` is the tools
      // bar's scroll container standalone and mounted alike, and the composer is the
      // next item of the host rather than a row pinned to the document's foot, which
      // is the strip the bottom bar covered. jsdom cannot lay any of this out, so the
      // stylesheet is the half a spec can see.
      const css = readFileSync(join(__dirname, 'basket-page.scss'), 'utf8')
        // Comments out, because the stylesheet says what it used to do.
        .replace(/\/\/.*$/gm, '');

      expect(css).not.toContain('.standalone');
      expect(css).not.toMatch(/position:\s*sticky/);
      expect(css).toMatch(/\.composer-dock\s*\{[^}]*flex:\s*none/);
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

    it('opens by pushing search=1, merged into the query', async () => {
      const { fixture, store } = await render({ lines: threeLines });
      openSearch(fixture);

      expect(store.navigate).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { search: '1' },
        queryParamsHandling: 'merge',
      });
      expect(store.navigate.mock.calls[0][1]).not.toHaveProperty('replaceUrl');
    });

    it('closes and clears the query when back takes search=1 off (velista 0109)', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'milk');
      expect(rows(fixture)).toHaveLength(1);

      // The phone's back button: the entry opening pushed is popped, which the page
      // hears as the route's query losing the parameter.
      await TestBed.inject(Router).navigateByUrl(
        '/shopping-lists/basket-saturday'
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(searchField(fixture)).toBeNull();
      expect(TestBed.inject(BasketViewStore).query()).toBe('');
      expect(rows(fixture)).toHaveLength(3);
    });

    it('closes from Cancel through PageNavigation.back, to the basket without search', async () => {
      const { fixture } = await render({ lines: threeLines, search: true });

      query(fixture, '.search-cancel')?.click();

      // Nothing of this app is behind a spec's first entry, which is the cold load of
      // a URL with search=1: the fallback replaces and never leaves the app.
      expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith(
        '/shopping-lists/basket-saturday',
        { replaceUrl: true }
      );
    });

    it('keeps search=1 on the filter sheet, so closing it comes back to the search', async () => {
      const { fixture, store } = await render({
        lines: threeLines,
        search: true,
      });

      query(fixture, '.search .tool')?.click();

      expect(store.navigate).toHaveBeenCalledWith(['sheet', 'filter'], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { search: '1' },
      });
    });

    it('draws the field open and empty on a cold load with search=1', async () => {
      const { fixture } = await render({ lines: threeLines, search: true });

      expect(searchField(fixture)?.value).toBe('');
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

      expect(store.setLeft).toHaveBeenCalledWith('l-2', 1, 4, {});
    });

    it('commits an ungrouped row through the same call', async () => {
      const { fixture, store } = await render({ lines: grouped });

      rowFor(fixture, 'Cheese')?.left.emit({ from: 4, to: 0 });
      await settleWrites(fixture);

      expect(store.setLeft).toHaveBeenCalledWith('l-2', 0, 4, {});
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
 * How long this reader has, and what they are told when it runs out (velista
 * `0094`, sections 5 and 2).
 *
 * The clock is pinned throughout, because everything here is a comparison
 * against it, and `whenStable` is never awaited under fake timers: that hangs,
 * which is the house rule for every spec in this repo that pins the clock.
 */
describe('a visit that ends', () => {
  /** The owner, named, so the "ask Marta" half of the sentence has a name. */
  const namedOwner = (): BasketParticipant => ({
    ...participant(owner()),
    username: 'Marta',
  });

  const notice = (fixture: ComponentFixture<BasketPage>) =>
    query(fixture, 'lib-visit-notice .words')?.textContent?.trim() ?? null;

  const dismiss = (fixture: ComponentFixture<BasketPage>) =>
    query(fixture, 'lib-visit-notice .dismiss') as HTMLButtonElement | null;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.setSystemTime(new Date('2026-09-22T10:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tells an account holder when it ends and whom to ask', async () => {
    const me = visitor(registered(), 240);
    const { fixture } = await render({
      me,
      participants: [namedOwner(), me],
    });

    expect(notice(fixture)).toBe('basket.visit.account');
  });

  it('asks nobody by name when the basket carries none for the owner', async () => {
    // A basket generated before luna `0054` backfilled usernames. "Ask Owner"
    // would be worse than not naming anybody.
    const me = visitor(registered(), 240);
    const { fixture } = await render({
      me,
      participants: [participant(owner()), me],
    });

    expect(notice(fixture)).toBe('basket.visit.accountNameless');
  });

  it('tells a guest the time and nothing else', async () => {
    // Rule C2: a guest is never shown register, and being kept takes an
    // account, so the "ask to be added" half is not said to them at all.
    const me = visitor(guest('p-9', 1), 240);
    const { fixture } = await render({ me, participants: [namedOwner(), me] });

    expect(notice(fixture)).toBe('basket.visit.guest');
  });

  it('says nothing at all to the owner or to a named person', async () => {
    const owned = await render({ participants: [participant(owner())] });
    expect(notice(owned.fixture)).toBeNull();

    const named = participant(registered());
    const invited = await render({
      me: named,
      participants: [namedOwner(), named],
    });
    expect(notice(invited.fixture)).toBeNull();
  });

  it('remembers a dismissal, for that basket, on that device', async () => {
    const me = visitor(registered(), 240);
    const { fixture } = await render({
      me,
      participants: [namedOwner(), me],
    });

    dismiss(fixture)?.click();
    fixture.detectChanges();

    expect(notice(fixture)).toBeNull();
  });

  it('insists under half an hour, and cannot be dismissed', async () => {
    const me = visitor(registered(), 10);
    const { fixture } = await render({
      me,
      participants: [namedOwner(), me],
    });

    expect(notice(fixture)).toBe('basket.visit.ending');
    expect(dismiss(fixture)).toBeNull();
  });

  it('comes back at the threshold, even on a basket nobody touched', async () => {
    // The whole reason there is a timer rather than a computed over the clock:
    // nothing else on this screen moves while somebody reads it, so a derived
    // value would cross the threshold silently.
    const me = visitor(registered(), 45);
    const { fixture } = await render({
      me,
      participants: [namedOwner(), me],
    });

    dismiss(fixture)?.click();
    fixture.detectChanges();
    expect(notice(fixture)).toBeNull();

    jest.advanceTimersByTime(16 * 60 * 1000);
    fixture.detectChanges();

    expect(notice(fixture)).toBe('basket.visit.ending');
  });

  it('clears its timer when the page goes', async () => {
    // Asserted against **this** timer's own handle rather than against the
    // pending count, which is not this page's alone: the composer debounces and
    // the acknowledger dwells, and both are running here too.
    //
    // The warning is set for thirty minutes before an end that is forty five
    // minutes out, so it is the one timer armed for exactly a quarter of an
    // hour.
    const warningWait = 15 * 60 * 1000;
    const realSetTimeout = globalThis.setTimeout;
    const armed: unknown[] = [];

    const setSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      wait?: number
    ) => {
      const handle = realSetTimeout(handler, wait);
      if (wait === warningWait) {
        armed.push(handle);
      }
      return handle;
    }) as never);
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');

    try {
      const me = visitor(registered(), 45);
      const { fixture } = await render({
        me,
        participants: [namedOwner(), me],
      });
      expect(armed).toHaveLength(1);

      fixture.destroy();

      // A route provider's `DestroyRef` never fires in this app, so a timer set
      // anywhere but the component would still be pending here.
      expect(clearSpy.mock.calls.flat()).toContain(armed[0]);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  describe('after it has ended', () => {
    const title = (fixture: ComponentFixture<BasketPage>) =>
      query(fixture, '.notice .notice-title')?.textContent?.trim() ?? null;
    const body = (fixture: ComponentFixture<BasketPage>) =>
      query(fixture, '.notice .notice-body')?.textContent?.trim() ?? null;

    /** The store answering a refusal: the state, and the reason behind it. */
    const ended = async (reason: BasketAccessEnded, me: BasketParticipant) => {
      const rendered = await render({
        me,
        participants: [namedOwner(), me],
        accessEnded: reason,
      });
      rendered.store.state.set('revoked');
      rendered.fixture.detectChanges();
      return rendered.fixture;
    };

    it('says the time ran out, and whom to ask, to an account holder', async () => {
      const fixture = await ended('EXPIRED', visitor(registered(), 240));

      expect(title(fixture)).toBe('basket.ended.title');
      expect(body(fixture)).toBe('basket.ended.bodyAccount');
    });

    it('asks a guest for a new link and never for an account', async () => {
      const fixture = await ended('EXPIRED', visitor(guest('p-9', 1), 240));

      expect(body(fixture)).toBe('basket.ended.bodyGuest');
    });

    it('says it was taken back when somebody was removed', async () => {
      const fixture = await ended('REMOVED', participant(registered()));

      expect(title(fixture)).toBe('basket.revoked.title');
      expect(body(fixture)).toBe('basket.revoked.body');
    });

    it('says the same when the refusal named no reason', async () => {
      // `UNKNOWN` is the socket being swept: the eviction event carries no
      // reason, so the ordinary sentence is the honest one.
      const fixture = await ended('UNKNOWN', visitor(registered(), 240));

      expect(title(fixture)).toBe('basket.revoked.title');
      expect(body(fixture)).toBe('basket.revoked.body');
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
  });

  it('keeps the way into the people sheet, which it can still answer', async () => {
    // Velista `0094` section 7. The faces are a claim about who is here right
    // now and a `LIVE` basket has no presence room to make it from, but it can
    // be shared and can have named people on it, so the sheet has something to
    // say and the header keeps the door to it. This used to be gated on
    // presence, which left the basket that is always there with no way in at
    // all.
    const { fixture } = await render({
      kind: 'LIVE',
      lines: someLines,
      participants: [participant(owner())],
    });

    expect(query(fixture, '.people')).not.toBeNull();
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

/**
 * What changed while the shopper was not looking (velista `0093`).
 *
 * Three things this page owns and each is a different mistake. The **banner**
 * is the server's count and sits under the sticky bar rather than inside it, so
 * the bar keeps its height. The **counts** leave a `REMOVED` row out, in one
 * selector, so the tools bar and the chip row cannot disagree. And the prompt
 * does not congratulate anybody over a basket of rows that have all left.
 */
describe('what changed on the lists', () => {
  const banner = (fixture: ComponentFixture<BasketPage>) =>
    (fixture.nativeElement as HTMLElement).querySelector('lib-changes-banner');

  it('says how many are new to this viewer', async () => {
    const { fixture } = await render({
      lines: [line('zl-1')],
      unseenChanges: 3,
    });

    expect(banner(fixture)).not.toBeNull();
    expect(banner(fixture)?.textContent).toContain('basket.changes.banner');
  });

  it('draws nothing at all when the server says nothing is new', async () => {
    const { fixture } = await render({ lines: [line('zl-1')] });

    expect(banner(fixture)).toBeNull();
  });

  it('sits under the tools bar and outside it, so the bar keeps its height', async () => {
    // Inside the sticky bar the banner would push the search and the chips
    // down a phone every time a line moved on somebody else's list (velista
    // `0079`, sections 2 and 3).
    const { fixture } = await render({
      lines: [line('zl-1')],
      unseenChanges: 1,
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('lib-list-tools lib-changes-banner')).toBeNull();
    const tools = host.querySelector('lib-list-tools');
    expect(
      tools?.compareDocumentPosition(banner(fixture) as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('opens the sheet at the basket’s own sheet URL', async () => {
    const { fixture, store } = await render({
      lines: [line('zl-1')],
      unseenChanges: 2,
    });

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'lib-changes-banner button'
      ) as HTMLButtonElement
    ).click();

    expect(store.navigate).toHaveBeenCalledWith(
      ['sheet', 'changes'],
      expect.anything()
    );
  });

  it('is drawn on a finished basket too, because what changed is still worth reading', async () => {
    const { fixture } = await render({
      lines: [line('zl-1')],
      finished: true,
      unseenChanges: 1,
    });

    expect(banner(fixture)).not.toBeNull();
  });

  it('is drawn on no basket that failed to load', async () => {
    // The whole rows branch is behind `ready`, and the banner is inside it:
    // a count over a basket nobody can see is a sentence about nothing.
    const { fixture } = await render({ revoked: true, unseenChanges: 4 });

    expect(banner(fixture)).toBeNull();
  });

  it('leaves a REMOVED row out of the tools bar’s two numbers', async () => {
    const { fixture } = await render({
      lines: [
        line('zl-1'),
        { ...line('zl-2'), state: 'REMOVED', entries: [] },
        line('zl-3'),
      ],
      echoValues: true,
    });

    // The bar draws its pair only while the field is open, which is where the
    // numbers can be read at all.
    const tool = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('.tool');
    tool?.click();
    fixture.detectChanges();

    // Two countable rows of three drawn: a row somebody took off the basket is
    // information about it rather than a thing to buy, and counting it on one
    // side alone is what produces "3 of 2".
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.search-count')
        ?.textContent
    ).toContain('{"shown":2,"total":2}');
  });

  it('still draws the removed row, so nobody wonders where the line went', async () => {
    const { fixture } = await render({
      lines: [line('zl-1'), { ...line('zl-2'), state: 'REMOVED', entries: [] }],
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('lib-basket-row')
    ).toHaveLength(2);
  });

  it('leaves the progress sentence exactly as the server counted it', async () => {
    // Never recounted here (velista `0060`, section 4). The server's progress
    // already excludes a `REMOVED` row, and a second count on this side is how
    // one screen comes to disagree with itself.
    const { fixture } = await render({
      lines: [line('zl-1'), { ...line('zl-2'), state: 'REMOVED', entries: [] }],
      progress: { done: 1, unavailable: 0, total: 1 },
      unsettled: 0,
      echoValues: true,
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.progress')
        ?.textContent
    ).toContain('"total":1');
  });

  it('asks nothing of a basket whose rows have all left', async () => {
    // "All done?" over a basket holding nothing but rows that left its coverage
    // would congratulate somebody for shopping nobody did.
    const { fixture } = await render({
      lines: [{ ...line('zl-1'), state: 'REMOVED', entries: [] }],
      unsettled: 0,
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.prompt')
    ).toBeNull();
  });
});

/**
 * The composer, back with a list to put things on (velista `0092`, section 7).
 *
 * Two things are worth asserting and the rest is the list page's composer
 * unchanged.
 *
 * **Who gets one**, which is the rule velista `0053` section 2 is reversed by: a
 * guest was given the field because an added line had no target and changed
 * nothing shared. Every line has a target now, so the safety argument is gone and
 * the control goes with it. A sentence explaining that would be an invitation to
 * register, which the product rule forbids, so the dock is simply absent.
 *
 * **That the add names a list**, because a line with no list is a line with
 * nowhere to be.
 */
describe('the composer and the list it adds to', () => {
  const served = [
    {
      listId: 'l-weekly',
      name: 'Weekly shop',
      zoneId: 'z1',
      zoneName: 'Flat',
    },
    {
      listId: 'l-parents',
      name: 'Groceries',
      zoneId: 'z2',
      zoneName: 'Home',
    },
  ];

  const dock = (fixture: ComponentFixture<BasketPage>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.composer-dock');

  const chip = (fixture: ComponentFixture<BasketPage>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.target');

  describe('who gets one', () => {
    it('draws it for the owner with a list to write', async () => {
      const { fixture } = await render({ served: [served[0]] });
      expect(dock(fixture)).not.toBeNull();
    });

    it('draws it for a registered participant with a list to write', async () => {
      const { fixture } = await render({
        me: participant(registered()),
        served: [served[0]],
      });

      expect(dock(fixture)).not.toBeNull();
    });

    it('draws nothing at all for a guest', async () => {
      // No dock, no field and **no sentence about it**: velista `0038` section
      // 2.1 refuses to draw an invitation that cannot be accepted, and the
      // product rule that a guest is never pushed to register forbids the
      // explanation.
      const { fixture } = await render({
        me: participant(guest('p-guest-1', 1)),
        served: [],
      });

      expect(dock(fixture)).toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'lib-line-composer'
        )
      ).toBeNull();
    });

    it('draws nothing for an account holder with nowhere to put a line', async () => {
      // Not a second way of saying the condition above. A registered co shopper
      // on somebody else's basket may hold `WRITE` on none of its lists.
      const { fixture } = await render({
        me: participant(registered()),
        served: [],
      });

      expect(dock(fixture)).toBeNull();
    });

    it('draws nothing on a finished trip', async () => {
      const { fixture } = await render({ finished: true, served: [served[0]] });
      expect(dock(fixture)).toBeNull();
    });
  });

  describe('the target', () => {
    it('is text when the basket covers one list this reader writes', async () => {
      // Nothing to pick between, so nobody is asked a question with one answer.
      const { fixture } = await render({ served: [served[0]] });

      expect(chip(fixture)?.tagName.toLowerCase()).toBe('p');
      expect(chip(fixture)?.textContent).toContain('basket.add.to');
    });

    it('is a button when there is more than one', async () => {
      const { fixture } = await render({ served });

      expect(chip(fixture)?.tagName.toLowerCase()).toBe('button');
      expect(chip(fixture)?.textContent).toContain('basket.add.choose');
    });

    it('holds the submit while none is chosen, and not the field', async () => {
      // A person in an aisle types the thing they just remembered and chooses
      // where it goes second, rather than losing it to a sheet.
      const { fixture } = await render({ served });
      const composer = (fixture.nativeElement as HTMLElement).querySelector(
        'lib-line-composer'
      );

      expect(
        composer?.querySelector<HTMLButtonElement>('.send')?.disabled
      ).toBe(true);
      expect(
        composer?.querySelector<HTMLInputElement>('input[type="text"]')
          ?.disabled
      ).toBeFalsy();
    });
  });

  describe('adding a line', () => {
    it('names the list, and sends the words and the amount', async () => {
      const { fixture, store } = await render({ served: [served[0]] });

      const page = fixture.componentInstance as unknown as {
        add(entry: { content: string; quantity: number }): Promise<void>;
      };
      await page.add({ content: 'Batteries', quantity: 2 });

      expect(store.addLine).toHaveBeenCalledWith({
        targetListId: 'l-weekly',
        content: 'Batteries',
        quantity: 2,
      });
    });

    it('sends a suggestion’s product set as itemIds', async () => {
      const { fixture, store } = await render({ served: [served[0]] });

      const page = fixture.componentInstance as unknown as {
        add(entry: {
          content: string;
          quantity: number;
          itemIds?: readonly string[];
        }): Promise<void>;
      };
      await page.add({
        content: 'Milk',
        quantity: 1,
        itemIds: ['i-1', 'i-2'],
      });

      expect(store.addLine).toHaveBeenCalledWith(
        expect.objectContaining({ itemIds: ['i-1', 'i-2'] })
      );
    });

    it('sends nothing without a target', async () => {
      // The submit is disabled without one, so this is the belt: an add with no
      // list is a line with nowhere to be.
      const { fixture, store } = await render({ served });

      const page = fixture.componentInstance as unknown as {
        add(entry: { content: string; quantity: number }): Promise<void>;
      };
      await page.add({ content: 'Batteries', quantity: 1 });

      expect(store.addLine).not.toHaveBeenCalled();
    });

    it('says what arrived, once, in the screen’s own region', async () => {
      const { fixture } = await render({ served: [served[0]] });

      const page = fixture.componentInstance as unknown as {
        add(entry: { content: string; quantity: number }): Promise<void>;
      };
      await page.add({ content: 'Batteries', quantity: 1 });
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.said')
          ?.textContent
      ).toContain('basket.added.announced');
    });

    it('says what went wrong, and keeps the words', async () => {
      const { fixture, store } = await render({ served: [served[0]] });
      store.addLine.mockResolvedValueOnce(null);

      const page = fixture.componentInstance as unknown as {
        add(entry: { content: string; quantity: number }): Promise<void>;
      };
      await page.add({ content: 'Batteries', quantity: 1 });
      fixture.detectChanges();

      // Losing six characters is nothing; losing the item somebody just
      // remembered in an aisle is the failure this screen cannot afford.
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.said')
          ?.textContent
      ).toContain('basket.error');
    });
  });

  describe('a sentence a sheet handed over', () => {
    it('says it in the one region this screen has', async () => {
      // A demand taken to zero takes the row out of the basket, the sheet over it
      // dismisses itself, and this page is what is left with a live region
      // (velista `0092`, section 6.2).
      const { fixture, store } = await render({ served: [served[0]] });

      store.handedOver.set({
        text: 'Sourdough loaf is no longer asked for.',
        seq: 1,
      });
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.said')
          ?.textContent
      ).toContain('Sourdough loaf is no longer asked for.');
    });
  });
});

/**
 * **Nothing on the basket removes a row** (velista `0092`, section 2).
 *
 * A basket has nothing of its own to remove: it holds no lines, and a row is the
 * covered lines that share a name. Removing one is an act on a **list**, on the
 * list page, behind that page's own rule; a `REMOVED` row is how the basket shows
 * that somebody did it, and drawing that row is velista `0093`.
 *
 * So this scans the scope's own templates rather than asserting about one screen.
 * A delete control is the kind of thing that arrives by analogy with the list
 * page, in a component nobody thought to write a test for, and the honest guard
 * is the one that reads every file.
 */
describe('no control on the basket removes a row', () => {
  const scope = join(__dirname, '..');

  function templates(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((held) => {
      const path = join(dir, held.name);
      if (held.isDirectory()) {
        return templates(path);
      }
      return held.isFile() && held.name.endsWith('.html') ? [path] : [];
    });
  }

  it('draws no delete or trash glyph anywhere in the scope', () => {
    const offenders = templates(scope).filter((path) => {
      const html = readFileSync(path, 'utf8');
      return /<lib-trash-icon|<lib-delete-icon/.test(html);
    });

    expect(offenders).toEqual([]);
  });

  it('calls no store method that would take a row away', () => {
    // The store has none of these and never had: the names are asserted so that
    // adding one is a red spec rather than a quiet capability.
    const offenders = templates(scope).filter((path) => {
      const html = readFileSync(path, 'utf8');
      return /\b(removeRow|deleteRow|hideRow|dropRow)\s*\(/.test(html);
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * The lines a suggestion card names on the basket (velista `0101`, section 4): one
 * per entry of each row holding the product, the list above it, and the settle
 * sheet's demand write when one is stepped.
 */
describe('BasketPage: the lines a suggestion card names (velista 0101)', () => {
  const MILK: CatalogSuggestion = {
    kind: 'item',
    item: {
      id: 'item-milk',
      name: { es: 'Leche entera', en: 'Whole milk' },
      brand: 'Hacendado',
      size: 1,
      unit: 'LITER',
      productGroupId: null,
      category: 'DAIRY',
      offer: null,
      chainPrices: [],
      imageUrl: null,
      packCount: null,
      unitBasis: null,
    },
  };

  interface CardSurface {
    holdingsOf(): (suggestion: CatalogSuggestion) => readonly {
      lineId: string;
      text: string;
      listName: string | null;
      quantity: number;
      editable: boolean;
    }[];
    productLink(): ((itemId: string) => string) | null;
    changeHolding(change: {
      holding: { lineId: string };
      from: number;
      to: number;
    }): Promise<void>;
  }

  const milk = () =>
    line('Milk', {
      optionIds: ['item-milk'],
      entries: [
        entry('l-groceries', 'zl-1', 2),
        entry('l-hidden', 'zl-2', 1, { demandEditable: false }),
      ],
    });

  it('names each entry, with the list above it where this reader was served it', async () => {
    const { fixture } = await render({
      lines: [milk(), line('Bread')],
      served: SERVED,
    });
    const page = fixture.componentInstance as unknown as CardSurface;

    expect(
      page
        .holdingsOf()(MILK)
        .map((held) => [
          held.lineId,
          held.text,
          held.listName,
          held.quantity,
          held.editable,
        ])
    ).toEqual([
      ['zl-1', 'Milk', 'Groceries', 2, true],
      ['zl-2', 'Milk', null, 1, false],
    ]);
  });

  it('sends the settle sheet’s demand write for the stepped entry', async () => {
    const { fixture } = await render({ lines: [milk()], served: SERVED });
    const page = fixture.componentInstance as unknown as CardSurface;
    const store = TestBed.inject(BasketStore) as unknown as {
      setDemand: jest.Mock;
    };

    await page.changeHolding({ holding: { lineId: 'zl-1' }, from: 2, to: 3 });

    expect(store.setDemand).toHaveBeenCalledWith('row-Milk', {
      lineId: 'zl-1',
      quantity: 3,
      from: 2,
    });
  });

  it('links to the product for an account, and to nothing for a guest', async () => {
    const owned = await render({ lines: [milk()] });
    // Over this basket and not the catalog tab (velista `0107`), so closing the
    // sheet lands back here.
    expect(
      (
        owned.fixture.componentInstance as unknown as CardSurface
      ).productLink()?.('item-milk')
    ).toMatch(/\/shopping-lists\/basket-saturday\/sheet\/products\/item-milk$/);

    const visiting = await render({
      lines: [milk()],
      me: participant(guest('p-1', 1)),
    });
    expect(
      (
        visiting.fixture.componentInstance as unknown as CardSurface
      ).productLink()
    ).toBeNull();
  });
});

/**
 * Only what I usually buy here, on the page (velista `0104`).
 *
 * The message under a kept row, and the empty state when the filter hides every
 * row, with the one button that turns it off.
 */
describe('BasketPage: what you usually buy here', () => {
  const MERCADONA: BasketShop = {
    id: 'loc-mayor',
    supermarketId: 'sm-merca',
    chain: { en: 'Mercadona', es: 'Mercadona' },
    label: null,
    address: 'Calle Mayor 3',
    city: 'Córdoba',
    postalCode: '14001',
    inProfile: true,
  };

  function usual(
    content: string,
    state: 'NEVER_BOUGHT' | 'NO_SHOP_KNOWN' | 'ELSEWHERE' | 'HERE',
    bought = 0,
    of = 0
  ): BasketRow {
    return line(content, { usual: { state, bought, of } });
  }

  function drawnRows(fixture: ComponentFixture<BasketPage>) {
    return fixture.debugElement
      .queryAll(By.directive(BasketRowComponent))
      .map((node) => node.componentInstance as BasketRowComponent);
  }

  it('hands a kept row its message only while the switch is on', async () => {
    const { fixture } = await render({
      lines: [usual('Eggs', 'HERE', 2, 6), usual('Milk', 'ELSEWHERE', 0, 6)],
      readAtShop: MERCADONA,
    });

    expect(drawnRows(fixture).map((drawn) => drawn.usual())).toEqual([
      null,
      null,
    ]);

    TestBed.inject(BasketViewStore).setUsual(true);
    fixture.detectChanges();

    expect(drawnRows(fixture).map((drawn) => drawn.row().content)).toEqual([
      'Eggs',
    ]);
    expect(drawnRows(fixture)[0].usual()).toEqual({ bought: 2, of: 6 });
  });

  it('says why it hid everything, and turns itself off from the button', async () => {
    const { fixture } = await render({
      lines: [
        usual('Milk', 'ELSEWHERE', 0, 6),
        usual('Bread', 'NO_SHOP_KNOWN', 0, 3),
      ],
      readAtShop: MERCADONA,
    });
    const view = TestBed.inject(BasketViewStore);

    view.setUsual(true);
    fixture.detectChanges();

    expect(drawnRows(fixture)).toHaveLength(0);
    expect(text(fixture)).toContain('basket.view.usual.emptyTitle');
    expect(text(fixture)).toContain('basket.view.usual.emptyNote');
    expect(text(fixture)).not.toContain('basket.view.none');

    const button = fixture.debugElement.query(By.css('.empty-action'));
    (button.nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(view.usual()).toBe(false);
    expect(drawnRows(fixture)).toHaveLength(2);
  });
});
