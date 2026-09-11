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
  BasketStore,
  BasketViewStore,
  GatewayError,
  GeneratedListStore,
  SessionStore,
  type BasketSplitSaid,
} from '@portfolio/velista/data-access';
import type {
  BasketAddLineRequest,
  BasketLine,
  BasketParticipant,
  BasketPresenceEntry,
  BasketProduct,
  BasketSettleResult,
  CatalogSuggestion,
  ErrorCode,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { BasketLineRow } from '../basket-line-row/basket-line-row';
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
  readonly takesLines: WritableSignal<boolean>;
  readonly lastAdded: WritableSignal<BasketLine | null>;
  /** The most recent split, which shares the add's region (velista `0069`). */
  readonly lastSplit: WritableSignal<BasketSplitSaid | null>;
  readonly opened: string[];
  /** Every add the page asked for, in order, so a spec can read what it sent. */
  readonly added: BasketAddLineRequest[];
  /** Every query the page searched for, after its own debounce and floor. */
  readonly searched: string[];
  /** Every time the page said the shopper has gone. See the teardown test. */
  readonly leave: jest.Mock<void, []>;
  /** The rows, writable so a spec can stand in for the refetch a refusal does. */
  readonly lines: WritableSignal<readonly BasketLine[]>;
  /** What the store last failed with, which is where the row's sentence comes from. */
  readonly error: WritableSignal<unknown>;
  /** Every move of a row's number, and what it answered (plan 0054). */
  readonly setOutstanding: jest.Mock;
  /** Where the page navigated, so a spec can see the settle sheet being opened. */
  readonly navigate: jest.Mock;
  /** Whether the trip is over, writable so a spec can end one (plan 0057). */
  readonly finished: WritableSignal<boolean>;
  /** How many lines nobody settled, which is what the prompt waits for. */
  readonly unsettled: WritableSignal<number>;
  /** Every status write the page made, on the **owner's** surface (plan 0057). */
  readonly setStatus: jest.Mock;
  /** Every per list purchase the page made, which is `0077`'s row under a heading. */
  readonly setOriginSettled: jest.Mock;
  /** Every refetch, so a spec can see the screen being brought up to date. */
  readonly refresh: jest.Mock;
  /** Every product the basket named, which is the other half of what a search reads. */
  readonly products: WritableSignal<ReadonlyMap<string, BasketProduct>>;
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
  /** Whether the basket still takes lines. False is a finished one. */
  readonly takesLines?: boolean;
  /** What the add answers. Null is a refusal, which puts the text back. */
  readonly addAnswers?: BasketLine | null;
  /** What the catalog offers under the field. */
  readonly suggestions?: readonly CatalogSuggestion[];
  /** The rows on the basket. Empty draws the empty state. */
  readonly lines?: readonly BasketLine[];
  /** Whether the trip is over (plan 0057). A finished basket draws no controls. */
  readonly finished?: boolean;
  /**
   * How many lines nobody settled. Defaults to all of them, which is a fresh trip.
   *
   * Zero with lines on the basket is what makes the "all done" prompt appear, and
   * the two are stated separately here for the same reason the real store derives
   * one from the other rather than counting the array: the question the prompt asks
   * is about what is left, not about how many rows there are.
   */
  readonly unsettled?: number;
  /** Whether a finish or a reopen lands. False is the failure the banner reports. */
  readonly statusWriteLands?: boolean;
  /** The products the lines pick, so a search can match a name or a brand (`0074`). */
  readonly products?: ReadonlyMap<string, BasketProduct>;
  /**
   * The lists the run drew from (`0075`). Absent is a guest, who has none, so the
   * filter sheet draws no lists section and the chip row can hold no list chip.
   */
  readonly sources?: readonly { zoneId: string; listId: string }[];
  /** Those lists by name, for the list chip and the sheet's checkboxes. */
  readonly listNames?: ReadonlyMap<string, string>;
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

/** The line an add answers with, which is all the page does with the answer. */
function line(
  content: string,
  overrides: Partial<BasketLine> = {}
): BasketLine {
  return {
    id: `line-${content}`,
    content,
    quantity: 1,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: 'p-owner',
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...overrides,
  };
}

function participant(entry: BasketPresenceEntry): BasketParticipant {
  return {
    id: entry.participantId,
    kind: entry.kind,
    displayName: entry.displayName,
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
    takesLines: signal(options.takesLines ?? true),
    lastAdded: signal<BasketLine | null>(null),
    lastSplit: signal<BasketSplitSaid | null>(null),
    opened: [],
    added: [],
    searched: [],
    leave: jest.fn(),
    lines: signal<readonly BasketLine[]>(options.lines ?? []),
    error: signal<unknown>(null),
    // A raise and a lower both answer a settle result, so the default is the one
    // neither has anything to report about (backend `0056`, section 3).
    setOutstanding: jest.fn(
      (lineId: string): Promise<BasketSettleResult | null> =>
        Promise.resolve({
          line: line(lineId),
          skippedCount: 0,
        })
    ),
    navigate: jest.fn().mockResolvedValue(true),
    finished: signal(options.finished ?? false),
    unsettled: signal(options.unsettled ?? options.lines?.length ?? 0),
    setStatus: jest.fn().mockResolvedValue(options.statusWriteLands ?? true),
    // The whole line comes back, exactly as the real write answers it: the row has
    // to redraw from the server's answer and never from the number it sent.
    setOriginSettled: jest.fn(
      (lineId: string): Promise<BasketOriginSettledResult | null> =>
        Promise.resolve({
          line: line(lineId),
          origin: null,
          skippedCount: 0,
          skipped: [],
        })
    ),
    refresh: jest.fn().mockResolvedValue(undefined),
    products: signal<ReadonlyMap<string, BasketProduct>>(
      options.products ?? new Map()
    ),
    progress: signal(options.progress ?? { done: 0, unavailable: 0, total: 0 }),
  };

  const paramMap = convertToParamMap({ generatedListId: 'basket-saturday' });

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
            data: {},
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
            name: 'Saturday shop',
            generatedAt: null,
            products: new Map(),
            scopes: new Map(),
            // What the run drew from, which is what the filter sheet offers and what
            // the list filter and its chip are about (`0075`). Absent by default, so
            // every test in this file that predates it still renders a guest's sheet.
            sources: options.sources,
          }),
          state: signal('ready'),
          lines: store.lines,
          products: store.products,
          error: store.error,
          progress: store.progress,
          busyLines: signal(new Set<string>()),
          participantsById: signal(new Map<string, BasketParticipant>()),
          listNames: signal(options.listNames ?? new Map<string, string>()),
          seesZoneData: signal(true),
          me: signal(me),
          live: store.live,
          revoked: store.revoked,
          present: store.present,
          participants: store.participants,
          takesLines: store.takesLines,
          adding: signal(false),
          lastAdded: store.lastAdded,
          lastSplit: store.lastSplit,
          open: (id: string) => {
            store.opened.push(id);
            return Promise.resolve();
          },
          leave: store.leave,
          // Session local, and empty unless a spec says otherwise: no field of a line
          // carries whether the list it was sent to has accepted it (`0056`).
          pendingTargets: signal(new Set<string>()),
          finished: store.finished,
          unsettled: store.unsettled,
          refresh: store.refresh,
          settle: () => Promise.resolve(null),
          reopen: () => Promise.resolve(null),
          setOutstanding: store.setOutstanding,
          setOriginSettled: store.setOriginSettled,
          addLine: (body: BasketAddLineRequest) => {
            store.added.push(body);
            const answer =
              options.addAnswers === undefined
                ? line(body.content)
                : options.addAnswers;
            if (answer !== null) {
              store.lastAdded.set(answer);
            }
            return Promise.resolve(answer);
          },
          suggest: (query: string) => {
            store.searched.push(query);
            return Promise.resolve(options.suggestions ?? []);
          },
        },
      },
      // The owner's surface, which is where the one write of plan 0057 goes: the
      // route behind it is account authenticated, so a guest cannot reach it with
      // any token they hold. The page injects it for every reader and calls it only
      // through a control the owner alone is drawn.
      {
        provide: GeneratedListStore,
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

  /**
   * Plan 0053: the composer at the bottom of the basket.
   *
   * The claims worth a test are the ones a template mistake would quietly break:
   * that it is drawn for **everybody** rather than for a reader who passes a rule,
   * that it is absent on a basket the server would refuse, that it never offers a
   * microphone, and that a refused add does not swallow what somebody typed while
   * standing in an aisle.
   */
  describe('adding a line in the aisle', () => {
    it('is drawn for a guest, who holds no account at all', async () => {
      // The inversion of `0030`, and the one row of this screen's table with no
      // reader-shaped condition on it: a line added here has no target list, so
      // there is no permission to read and no branch to write.
      const { fixture } = await render({
        me: participant(guest('p-1', 1)),
      });

      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
      // And still no share control, which is the owner's alone. The two are
      // independent, which is the whole point of asserting them together.
      expect(query(fixture, '.share')).toBeNull();
    });

    it('is absent on a finished basket, never disabled', async () => {
      // The server refuses the add, and a field that cannot submit is the
      // invitation plan 0038 section 2.1 refuses to draw.
      const { fixture } = await render({ takesLines: false });

      expect(query(fixture, 'lib-line-composer')).toBeNull();
    });

    it('never offers a microphone', async () => {
      // A recording goes to the list scoped assistant, which a basket has no
      // equivalent of: offering a microphone with nowhere to send its audio is
      // worse than offering nothing (section 3).
      const { fixture } = await render();

      expect(query(fixture, 'lib-mic-icon')).toBeNull();
      expect(query(fixture, 'lib-plus-icon')).not.toBeNull();
    });

    it('sends what was typed, with its quantity', async () => {
      const { fixture, store } = await render();

      typeInto(fixture, 'Batteries');
      await submit(fixture);

      expect(store.added).toEqual([{ content: 'Batteries', quantity: 1 }]);
      // Free text stays first class: nothing is attached, and no product is
      // insisted on (section 4).
      expect(store.added[0].itemId).toBeUndefined();
      expect(store.added[0].options).toBeUndefined();
    });

    it('leaves the typed text in the field when the add fails', async () => {
      // Losing six characters is nothing; losing the item somebody just remembered
      // in an aisle is the failure this screen cannot afford (section 7).
      const { fixture } = await render({ addAnswers: null });

      typeInto(fixture, 'Batteries');
      await submit(fixture);

      expect(field(fixture).value).toBe('Batteries');
    });

    it('clears the field when the add lands', async () => {
      // The other half of the one above, and the reason it is a separate test: a
      // composer that never cleared would pass the restore assertion for free.
      const { fixture } = await render();

      typeInto(fixture, 'Batteries');
      await submit(fixture);

      expect(field(fixture).value).toBe('');
    });

    it('announces the new line politely, and says nothing before one arrives', async () => {
      const { fixture } = await render();

      const region = query(fixture, '.composer-dock [aria-live]');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(region?.textContent?.trim()).toBe('');

      typeInto(fixture, 'Batteries');
      await submit(fixture);

      expect(
        query(fixture, '.composer-dock [aria-live]')?.textContent?.trim()
      ).not.toBe('');
    });

    it('announces a split once, in the same region the add uses', async () => {
      const { fixture, store } = await render();

      store.lastSplit.set({ content: 'Milk', rows: 2 });
      fixture.detectChanges();

      // The same node, because there is one thing to say about this basket at a
      // time: a second region would talk over the first (velista `0069`).
      expect(
        query(fixture, '.composer-dock [aria-live]')?.textContent?.trim()
      ).toContain('basket.product.split');
    });

    describe('the typeahead', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('asks for nothing under three characters', async () => {
        const { fixture, store } = await render();

        typeInto(fixture, 'ba');
        jest.advanceTimersByTime(1000);

        expect(store.searched).toEqual([]);
      });

      it('asks once for a run of keystrokes, and for the last of them', async () => {
        // The debounce and the sequence number are the container's, exactly as they
        // are on the list page: somebody who has used velista's list screen must
        // not have to learn a second search.
        const { fixture, store } = await render();

        typeInto(fixture, 'bat');
        typeInto(fixture, 'batt');
        typeInto(fixture, 'batte');
        jest.advanceTimersByTime(1000);

        expect(store.searched).toEqual(['batte']);
      });
    });
  });

  it('opens the basket it was routed to', async () => {
    const { store } = await render();

    expect(store.opened).toEqual(['basket-saturday']);
  });

  it('lets the basket go when the screen is destroyed', async () => {
    // The one test standing between this screen and a participant socket that
    // outlives it. Both the store and the socket are provided by the basket route,
    // and a route's environment injector is cached on the route config: Angular
    // destroys it only under `withExperimentalAutoCleanupInjectors()`, which this app
    // does not enable. So every `DestroyRef` inside those two services is silent, and
    // the connection stayed up, holding the room, for the rest of the page's life.
    // A component's destruction is real, so the assertion belongs here rather than in
    // a service spec where `TestBed` teardown would flatter it.
    const { fixture, store } = await render();

    expect(store.leave).not.toHaveBeenCalled();

    fixture.destroy();

    expect(store.leave).toHaveBeenCalledTimes(1);
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
  function row(fixture: ComponentFixture<BasketPage>): BasketLineRow {
    return fixture.debugElement.query(By.directive(BasketLineRow))
      .componentInstance as BasketLineRow;
  }

  /** Let the page await the write, then draw what came back. */
  async function settleWrites(
    fixture: ComponentFixture<BasketPage>
  ): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  const milk = () => line('Milk', { quantity: 5 });

  it('sends where the gesture ended and where it believed it began', async () => {
    // `from` is not decoration: without it a stale gesture is applied as the
    // opposite act, which is the one thing this message must never do (backend
    // `0056`, section 3.2).
    const { fixture, store } = await render({ lines: [milk()] });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(store.setOutstanding).toHaveBeenCalledWith('line-Milk', 3, 5);
  });

  it('says which of the two happened, once, in the live region', async () => {
    // The same sentence the caption showed under the thumb, so a reader who could
    // not see it still learns whether they recorded a purchase or raised a target
    // (section 7).
    const { fixture } = await render({ lines: [milk()] });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
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
    store.setOutstanding.mockResolvedValue({
      line: milk(),
      skippedCount: 1,
    });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(store.navigate).toHaveBeenCalledWith(
      ['sheet', 'lines', 'line-Milk', 'settle'],
      expect.anything()
    );
  });

  it('tells the row what the line says now when somebody else moved it', async () => {
    // Section 4.1. The store refetches before it answers, so the count in the
    // sentence is the true one; a refusal that only said "that did not work" would
    // send somebody dragging again into the same race.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setOutstanding.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'stale_quantity' as ErrorCode,
          status: 409,
          correlationId: 'ref-1',
        })
      );
      store.lines.set([line('Milk', { quantity: 3 })]);
      return Promise.resolve(null);
    });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
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
    store.setOutstanding.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-2',
        })
      );
      return Promise.resolve(null);
    });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
    await settleWrites(fixture);

    expect(row(fixture).notice()?.key).toBe('basket.error.accessChanged');
  });

  it('clears the last refusal before the next move goes out', async () => {
    // One sentence at a time across the whole basket. A refusal left under a row
    // somebody has since moved again is a claim about the present that nothing is
    // checking.
    const { fixture, store } = await render({ lines: [milk()] });
    store.setOutstanding.mockImplementation(() => {
      store.error.set(
        new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-3',
        })
      );
      return Promise.resolve(null);
    });

    row(fixture).outstanding.emit({ from: 5, to: 3 });
    await settleWrites(fixture);
    expect(row(fixture).notice()).not.toBeNull();

    store.setOutstanding.mockResolvedValue({ line: milk(), skippedCount: 0 });
    row(fixture).outstanding.emit({ from: 5, to: 4 });
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
      .queryAll(By.directive(BasketLineRow))
      .map((found) => found.componentInstance as BasketLineRow);

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
      line('Milk', { quantity: 1, settled: 1, lastOutcome: 'BOUGHT' }),
      line('Eggs', { quantity: 1, settled: 1, lastOutcome: 'BOUGHT' }),
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

      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
      expect(rows(fixture).every((row) => row.finished())).toBe(false);
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
        lines: [line('Milk', { quantity: 2 })],
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
    const someLines = [line('Milk', { quantity: 2 }), line('Eggs')];

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

      expect(rows(fixture).every((row) => row.finished())).toBe(true);
    });

    it('draws no field to add a line into', async () => {
      const { fixture, store } = await render({
        finished: true,
        lines: someLines,
      });
      store.takesLines.set(false);
      fixture.detectChanges();

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

      expect(store.setStatus).toHaveBeenCalledWith('basket-saturday', 'ACTIVE');
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
    };
  }

  const threeLines: readonly BasketLine[] = [
    line('Milk', { id: 'l-1', pickId: 'item-milk' }),
    line('Sourdough loaf', { id: 'l-2' }),
    line('Plátano', { id: 'l-3' }),
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
        '.lines lib-basket-line-row'
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
      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
    });

    it('clears the query when the line is added, so the new row is seen landing', async () => {
      const { fixture } = await render({ lines: threeLines });
      openSearch(fixture);
      search(fixture, 'yogurt');
      expect(rows(fixture)).toHaveLength(0);

      typeInto(fixture, 'Yogurt');
      await submit(fixture);

      expect(searchField(fixture)?.value).toBe('');
      expect(rows(fixture)).toHaveLength(3);
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
    /** Two lists, one line each, and a line nobody has accepted yet. */
    const sourced: readonly BasketLine[] = [
      line('Milk', {
        id: 'l-1',
        origins: [
          {
            id: 'o-1',
            zoneId: 'z1',
            listId: 'l-groceries',
            lineId: 'zl-1',
            quantity: 1,
          },
        ],
      }),
      line('Bread', {
        id: 'l-2',
        origins: [
          {
            id: 'o-2',
            zoneId: 'z1',
            listId: 'l-weekly',
            lineId: 'zl-2',
            quantity: 1,
          },
        ],
      }),
      line('Batteries', { id: 'l-3', origins: [] }),
    ];

    const SOURCES = [
      { zoneId: 'z1', listId: 'l-groceries' },
      { zoneId: 'z1', listId: 'l-weekly' },
    ];

    const LIST_NAMES = new Map([
      ['l-groceries', 'Groceries'],
      ['l-weekly', 'Weekly shop'],
    ]);

    async function renderSourced(echoValues = false) {
      return render({
        lines: sourced,
        sources: SOURCES,
        listNames: LIST_NAMES,
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

    it('sinks the line on no list under its own heading', async () => {
      const { fixture } = await renderSourced();

      expect(headings(fixture)).toEqual([]);

      TestBed.inject(BasketViewStore).toggleList('l-weekly');
      fixture.detectChanges();

      expect(headings(fixture)).toEqual(['basket.group.noList']);
      expect(text(fixture)).toContain('basket.group.noListHint');
      expect(rows(fixture)).toHaveLength(2);
    });

    /** "4 of 12 got" is about the trip. Hiding rows buys nothing. */
    it('keeps the progress sentence counting the whole basket', async () => {
      const { fixture } = await renderSourced(true);
      TestBed.inject(BasketViewStore).toggleList('l-weekly');
      fixture.detectChanges();

      expect(text(fixture)).toContain('"total":3');
    });

    /**
     * The two empty states say different things, and the filter's cannot quote a
     * query: there is none.
     */
    it('says the filter matched nothing, rather than quoting an empty search', async () => {
      const { fixture } = await render({
        lines: [sourced[1]],
        sources: SOURCES,
        listNames: LIST_NAMES,
      });

      TestBed.inject(BasketViewStore).toggleList('l-weekly');
      fixture.detectChanges();

      expect(text(fixture)).toContain('basket.view.none');
      expect(text(fixture)).not.toContain('basket.search.none');
      // The thing somebody was looking for is very often the next line.
      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
    });

    it('gives the whole view state back on leaving', async () => {
      const { fixture } = await renderSourced();
      const view = TestBed.inject(BasketViewStore);
      view.setOrder('alpha');
      view.toggleList('l-weekly');

      fixture.destroy();

      expect(view.order()).toBe('shop');
      expect(view.lists()).toBeNull();
    });

    /**
     * The page is what pairs the restore with the load (`0076`, section 3), and it
     * does it **after** `open` resolves rather than beside it: the scopes and the
     * source lists a remembered value is checked against arrive with the basket.
     */
    it('opens on what this device remembered last time', async () => {
      const { fixture } = await render({
        lines: sourced,
        sources: SOURCES,
        listNames: LIST_NAMES,
        storage: new Map([
          [
            StorageKeys.basketView,
            JSON.stringify({
              version: 1,
              order: { value: 'alpha', until: null },
            }),
          ],
        ]),
      });

      expect(TestBed.inject(BasketViewStore).order()).toBe('alpha');
      // And the chip row says so, because a list drawn in an order nobody can see a
      // reason for looks broken to the next person handed the phone.
      expect(chips(fixture)[0]?.textContent).toContain(
        'basket.view.order.alpha'
      );
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
      categories: ['DAIRY'],
      ...over,
    });

    const grouped: readonly BasketLine[] = [
      line('Milk', {
        id: 'l-1',
        quantity: 3,
        settled: 3,
        lastOutcome: 'BOUGHT',
        pickId: 'i-milk',
        origins: [
          {
            id: 'o-1',
            zoneId: 'z1',
            listId: 'l-weekly',
            lineId: 'zl-1',
            quantity: 2,
            settled: 2,
          },
          {
            id: 'o-2',
            zoneId: 'z1',
            listId: 'l-groceries',
            lineId: 'zl-2',
            quantity: 1,
            settled: 1,
          },
        ],
      }),
      line('Cheese', {
        id: 'l-2',
        pickId: 'i-milk',
        origins: [
          {
            id: 'o-3',
            zoneId: 'z1',
            listId: 'l-weekly',
            lineId: 'zl-3',
            quantity: 4,
            settled: 0,
          },
        ],
      }),
      line('Something for dinner', { id: 'l-3', origins: [] }),
    ];

    async function renderGrouped(grouping: 'category' | 'list') {
      const rendered = await render({
        lines: grouped,
        sources: SOURCES,
        listNames: LIST_NAMES,
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
    ): BasketLineRow | null =>
      fixture.debugElement
        .queryAll(By.directive(BasketLineRow))
        .map((found) => found.componentInstance as BasketLineRow)
        .find((row) => row.line().content === content) ?? null;

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
          expect.stringContaining('basket.group.noList'),
        ]
      );
    });

    it('says a close that bought nothing apart from a purchase, on the heading', async () => {
      const closed = [
        line('Bread', {
          id: 'l-1',
          quantity: 1,
          settled: 1,
          lastOutcome: 'NOT_AVAILABLE',
          pickId: 'i-milk',
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
     * The write this plan's section 4.1 turns on. A reel under a list heading counts
     * what is still to get for **that list**, and the write takes what has been got,
     * so the two numbers are subtracted from what the list asked for on the way past.
     * `from` is that list's settled count as the screen last read it, never the
     * line's.
     */
    it('commits a row under a list heading through the per list write', async () => {
      const { fixture, store } = await renderGrouped('list');

      // Four asked for and none got, so the reel runs from four and lands on one.
      rowFor(fixture, 'Cheese')?.outstanding.emit({ from: 4, to: 1 });
      await settleWrites(fixture);

      expect(store.setOriginSettled).toHaveBeenCalledWith('l-2', {
        lineId: 'zl-3',
        settled: 3,
        from: 0,
      });
      expect(store.setOutstanding).not.toHaveBeenCalled();
    });

    it('commits an ungrouped row through the line’s own write, as it always has', async () => {
      const { fixture, store } = await render({ lines: grouped });

      rowFor(fixture, 'Cheese')?.outstanding.emit({ from: 1, to: 0 });
      await settleWrites(fixture);

      expect(store.setOutstanding).toHaveBeenCalledWith('l-2', 0, 1);
      expect(store.setOriginSettled).not.toHaveBeenCalled();
    });

    /**
     * The "List" radio is the filter sheet's, and it is offered on the same test the
     * store uses to drop a remembered one: a reader with no source lists has nothing
     * to group by, and a sheet that offered it would draw "Nothing" over a basket
     * grouped by list.
     */
    it('offers no list grouping to a reader with no source lists', async () => {
      await render({ lines: grouped });

      expect(TestBed.inject(BasketViewStore).sourceLists()).toEqual([]);
    });
  });
});
