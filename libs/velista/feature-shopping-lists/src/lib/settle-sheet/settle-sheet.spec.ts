import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
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
  BasketLine,
  BasketParticipant,
  BasketSettleResult,
  BasketView,
  LineSettlement,
  Page,
  ParticipantKind,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
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
 * A basket line with two origins, which is the case the history is really about.
 *
 * Two households both wanting milk merge into one row here and contribute an origin
 * each, so the history has to ask both and merge the answers. A one origin line would
 * pass a version of this that asked only the first.
 */
function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: LINE_ID,
    content: 'Milk',
    quantity: 4,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    // Composed by the run, which is what a basket line ordinarily is. The two sheets
    // this one leads on to branch on it, so a test about them says otherwise.
    kind: 'DERIVED',
    targetListId: null,
    origins: [
      { id: 'o1', zoneId: 'z1', listId: 'l1', lineId: 'zl1', quantity: 3 },
      { id: 'o2', zoneId: 'z2', listId: 'l2', lineId: 'zl2', quantity: 1 },
    ],
    ...overrides,
  };
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
  /** The server's answer to the all or nothing rule on the last basket read. */
  readonly seesZoneData?: boolean;
  readonly lines?: readonly BasketLine[];
  readonly participants?: readonly BasketParticipant[];
  /** The settlements each zone list line answers with, by line id. */
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  /** Line ids whose settlement read is refused, as a lost `WRITE` would be. */
  readonly refuses?: readonly string[];
  /** What one page holds, so the paging test can ask for a second. */
  readonly pageSize?: number;
  /** The reader's own account name, or null for somebody with no name to give. */
  readonly ownName?: string | null;
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

  const lines = signal<readonly BasketLine[]>(world.lines ?? [line()]);
  const basket = signal<BasketView | null>({
    id: BASKET_ID,
    name: 'Saturday big shop',
    status: 'ACTIVE',
    generatedAt: new Date('2026-08-21T09:00:00.000Z'),
    lines: lines(),
    participants: world.participants ?? [me],
    me,
    seesZoneData: world.seesZoneData ?? true,
    products: new Map(),
    listNames: new Map(),
  });

  return {
    basket,
    state: signal('ready'),
    error: signal(null),
    shareLink: signal(null),
    busyLines: signal(new Set<string>()),
    lines,
    seesZoneData: signal(world.seesZoneData ?? true),
    listNames: signal(new Map<string, string>()),
    participants: signal(world.participants ?? [me]),
    me: signal(me),
    participantsById: signal(new Map([[me.id, me]])),
    progress: signal({ settled: 0, total: 0, spent: 0 }),
    present: signal([]),
    live: signal(true),
    revoked: signal(false),
    open: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(null),
    reopen: jest.fn().mockResolvedValue(null),
    setPick: jest.fn().mockResolvedValue(null),
    setOutstanding: jest.fn().mockResolvedValue(null),
    loadLineOrigins: jest.fn().mockResolvedValue(null),
    setOriginQuantity: jest.fn().mockResolvedValue(null),
    loadLineTargets: jest.fn().mockResolvedValue(null),
    bindLine: jest.fn().mockResolvedValue(null),
    pendingTargets: signal(new Set<string>()),
    rememberListNames: jest.fn(),
    apply: jest.fn(),
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

  const pageMap = convertToParamMap({ generatedListId: BASKET_ID });
  const sheetMap = convertToParamMap({ lineId: LINE_ID });

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
        seesZoneData: true,
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
        seesZoneData: false,
      });

      expect(fixture.nativeElement.querySelector('.link')).toBeNull();
      expect(text(fixture)).not.toContain('basket.history.open');
    });

    /**
     * Privilege is checked per request and never cached at join (backend `0051`), and
     * `seesZoneData` is the server's answer on the most recent basket read. Losing
     * `WRITE` therefore takes the control away on the next one.
     */
    it('takes it away from a participant who has lost WRITE', async () => {
      const { fixture, store } = await render({
        meKind: 'REGISTERED',
        seesZoneData: true,
      });

      expect(fixture.nativeElement.querySelector('.link')).not.toBeNull();

      (store.seesZoneData as WritableSignal<boolean>).set(false);
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
        fixture.componentInstance['history']().map((row) => row.id)
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
 * What a settle could not reach (plan 0049, section 1.2).
 *
 * The count is everybody's and the names are gated, and the gate is the **report**
 * rather than a branch here: the gateway composes `listName` for a reader entitled to
 * it and omits `skipped` entirely for one who is not. So this screen still reaches no
 * zone list store and cannot name a household it was not handed one for.
 */
describe('SettleSheet: the origins a settle missed', () => {
  async function settleWith(
    result: BasketSettleResult,
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

  it('names the lists for a reader whose report carries them', async () => {
    const fixture = await settleWith({
      line: line(),
      skippedCount: 2,
      skipped: [
        {
          listId: 'l1',
          reason: 'ACCESS_GONE',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
        },
        {
          listId: 'l2',
          reason: 'ORIGIN_DELETED',
          listName: 'Costco run',
          zoneName: null,
        },
      ],
    });

    // The count as well as the names: the count is true for everybody, and the names
    // are what make it actionable.
    expect(fixture.componentInstance['missed']()).toContain(
      'basket.settle.missed'
    );
    expect(fixture.componentInstance['missed']()).toContain(
      'basket.settle.missedNamed'
    );

    // The names themselves come off the composed phrase rather than the sentence: the
    // testing translator does not interpolate, so `{{lists}}` never reaches the copy.
    const names = fixture.componentInstance['_missedNames']();
    expect(names).toContain('Weekly shop (Flat 3B)');
    // No group where there is none, rather than an empty pair of brackets.
    expect(names).toContain('Costco run');
    expect(names).not.toContain('Costco run (');
  });

  it('leaves a guest the bare count', async () => {
    const fixture = await settleWith(
      { line: line(), skippedCount: 2 },
      { meKind: 'GUEST', seesZoneData: false }
    );

    expect(fixture.componentInstance['missed']()).toContain(
      'basket.settle.missed'
    );
    expect(fixture.componentInstance['missed']()).not.toContain(
      'basket.settle.missedNamed'
    );
    expect(fixture.componentInstance['_missedNames']()).toBeNull();
  });

  /**
   * A list deleted since the run has no name left to give, which is a different null
   * from a name withheld. The count is at least true where an empty name would read as
   * a missing word.
   */
  it('falls back to the count when the names are gone', async () => {
    const fixture = await settleWith({
      line: line(),
      skippedCount: 1,
      skipped: [
        {
          listId: 'l1',
          reason: 'ORIGIN_DELETED',
          listName: null,
          zoneName: null,
        },
      ],
    });

    expect(fixture.componentInstance['missed']()).not.toContain(
      'basket.settle.missedNamed'
    );
  });

  // Two origins on one list are one household to the person reading, and the report
  // carries an entry per origin.
  it('names one household once however many origins it lost', async () => {
    const fixture = await settleWith({
      line: line(),
      skippedCount: 2,
      skipped: [
        {
          listId: 'l1',
          reason: 'ACCESS_GONE',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
        },
        {
          listId: 'l1',
          reason: 'ACCESS_GONE',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
        },
      ],
    });

    const names = fixture.componentInstance['_missedNames']() ?? '';
    expect(names.match(/Weekly shop/g)).toHaveLength(1);
  });

  it('says nothing at all when every origin was reached', async () => {
    const fixture = await settleWith({ line: line(), skippedCount: 0 });

    expect(fixture.componentInstance['missed']()).toBeNull();
  });
});

/**
 * Plan 0052, section 7.1: a finished line is not offered two buttons that fail.
 *
 * A finished line stays tappable on purpose (`0043` section 3.2), so this sheet opens
 * on one. The plural rule picked `all_other` for a count of zero, so the primary read
 * "Got all 0", and pressing either it or "They had none" sent a settle that core
 * refuses because `outstanding === 0`.
 */
describe('SettleSheet: a line with nothing left to settle', () => {
  /** A line settled up to its asked quantity, by somebody, in a shop that had it. */
  const done = (overrides: Partial<BasketLine> = {}) =>
    line({ settled: 4, touchedBy: 'me', lastOutcome: 'BOUGHT', ...overrides });

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
      lines: [done({ lastOutcome: 'NOT_AVAILABLE' })],
    });

    expect(control(fixture, '.happened')?.textContent).toContain(
      'basket.touched.none'
    );
  });

  it('keeps the settle targets on a line that still has something outstanding', async () => {
    // The guard is on the numbers and not on the sheet: an ordinary line is untouched
    // by any of this.
    const { fixture } = await render({ lines: [line({ settled: 1 })] });

    expect(control(fixture, '.primary')).not.toBeNull();
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
describe('SettleSheet: the two sheets this one leads on to', () => {
  const entries = (fixture: ComponentFixture<SettleSheet>) =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '.actions.lists button'
      ),
    ].map((button) => button.textContent?.trim());

  /** A line somebody typed into the basket in an aisle, sent nowhere yet. */
  const added = (overrides: Partial<BasketLine> = {}) =>
    line({ kind: 'ADDED', origins: [], targetListId: null, ...overrides });

  it('offers both ways on to the owner', async () => {
    const { fixture } = await render({
      lines: [
        added({
          origins: [
            {
              id: 'o1',
              zoneId: 'z1',
              listId: 'l1',
              lineId: 'zl1',
              quantity: 1,
            },
          ],
        }),
      ],
    });

    expect(entries(fixture)).toEqual(['basket.units.open', 'basket.send.open']);
  });

  it('offers neither to a guest', async () => {
    // Both routes name households, and the server refuses the whole of each to
    // somebody who arrived on a link. A guest is never asked which household a tin
    // of tomatoes belongs to.
    const { fixture } = await render({ meKind: 'GUEST', lines: [added()] });

    expect(entries(fixture)).toEqual([]);
  });

  it('offers neither to a registered participant who does not pass the rule', async () => {
    // `seesZoneData` is the server's answer on the most recent basket read, so
    // losing `WRITE` on one source list takes both controls away on the next one.
    const { fixture } = await render({
      meKind: 'REGISTERED',
      seesZoneData: false,
      lines: [added()],
    });

    expect(entries(fixture)).toEqual([]);
  });

  it('never offers to send a line the run composed', async () => {
    // A derived line already has the lists it came from, so there is nothing to send
    // and the server refuses the bind as a validation failure.
    const { fixture } = await render();

    expect(entries(fixture)).toEqual(['basket.units.open']);
  });

  it('never offers to send a line that has already gone', async () => {
    const { fixture } = await render({
      lines: [
        added({
          targetListId: 'l1',
          origins: [
            {
              id: 'o1',
              zoneId: 'z1',
              listId: 'l1',
              lineId: 'zl1',
              quantity: 1,
            },
          ],
        }),
      ],
    });

    expect(entries(fixture)).toEqual(['basket.units.open']);
  });

  it('never offers the units sheet over a line that is on nobody’s list', async () => {
    // An added line sent nowhere has no origins and no candidates of its own, so the
    // sheet would open on two empty sections. Once it has been sent somewhere it has
    // an origin, and then it does.
    const { fixture } = await render({ lines: [added()] });

    expect(entries(fixture)).toEqual(['basket.send.open']);
  });

  it('draws neither where the field was redacted rather than null', async () => {
    // `targetListId` absent is "you may not see this" and null is "sent nowhere".
    // A falsy check would collapse them and offer the send control to exactly the
    // reader who may not use it. The guard on `seesZoneData` is what actually stops
    // that today, and this is the second half of the same rule.
    const redacted = added();
    delete (redacted as { targetListId?: string | null }).targetListId;

    const { fixture } = await render({ lines: [redacted] });

    expect(entries(fixture)).toEqual([]);
  });

  it('still offers them over a finished line, which is the point', async () => {
    // Velista `0056` section 5.2 sends a line that was already bought, and `0055`
    // raises a finished line's contribution. Neither is a purchase, so neither
    // belongs inside the block that hides the settle targets.
    const { fixture } = await render({
      lines: [line({ settled: 4, lastOutcome: 'BOUGHT' })],
    });

    expect(entries(fixture)).toEqual(['basket.units.open']);
  });
});
