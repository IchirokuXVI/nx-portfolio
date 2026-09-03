import { signal, type WritableSignal } from '@angular/core';
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
  GeneratedListStore,
  SessionStore,
} from '@portfolio/velista/data-access';
import type {
  BasketAddLineRequest,
  BasketLine,
  BasketParticipant,
  BasketPresenceEntry,
  BasketSettleResult,
  CatalogSuggestion,
  ErrorCode,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
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
  /** Every refetch, so a spec can see the screen being brought up to date. */
  readonly refresh: jest.Mock;
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
    refresh: jest.fn().mockResolvedValue(undefined),
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
          }),
          state: signal('ready'),
          lines: store.lines,
          error: store.error,
          progress: signal({ done: 0, unavailable: 0, total: 0 }),
          busyLines: signal(new Set<string>()),
          participantsById: signal(new Map<string, BasketParticipant>()),
          listNames: signal(new Map<string, string>()),
          seesZoneData: signal(true),
          me: signal(me),
          live: store.live,
          revoked: store.revoked,
          present: store.present,
          participants: store.participants,
          takesLines: store.takesLines,
          adding: signal(false),
          lastAdded: store.lastAdded,
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
