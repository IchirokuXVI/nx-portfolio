import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, GatewayError } from '@portfolio/velista/data-access';
import type {
  BasketLine,
  BasketLineOriginDetail,
  BasketLineOrigins,
  BasketListRef,
  BasketOriginCandidate,
  BasketOriginQuantityRequest,
  BasketOriginQuantityResult,
  BasketParticipant,
  BasketView,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { QuantityReel } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { LineUnitsSheet } from './line-units-sheet';

/**
 * The sheet that changes what each list asked for (plan 0055).
 *
 * Almost every test here is about one of two things: the arithmetic a reader is
 * deciding on, and what happens to a row whose write was refused. Both are the reasons
 * the sheet exists, and both are invisible in the markup unless something asserts them.
 *
 * `RokuTranslatorTestingModule.forTesting()` does not interpolate, so nothing here
 * asserts on a rendered sentence. The assertions are on the view model and on the keys.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const LINE_ID = 'c0ffee00-1111-4222-8333-444455556666';

/** The settle sheet, which is where every way out of this one goes. */
const SETTLE_URL = `/velista/en/shopping-lists/${BASKET_ID}/sheet/lines/${LINE_ID}/settle`;

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: LINE_ID,
    content: 'Milk',
    quantity: 3,
    settled: 0,
    waitingSettled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    kind: 'DERIVED',
    targetListId: null,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    origins: [
      { id: 'o1', zoneId: 'z1', listId: 'l1', lineId: 'zl1', quantity: 2 },
      { id: 'o2', zoneId: 'z2', listId: 'l2', lineId: 'zl2', quantity: 1 },
    ],
    ...overrides,
  };
}

function origin(
  overrides: Partial<BasketLineOriginDetail> = {}
): BasketLineOriginDetail {
  return {
    originId: 'o1',
    listId: 'l1',
    lineId: 'zl1',
    zoneId: 'z1',
    listName: 'Weekly shop',
    zoneName: 'Flat 3B',
    contributed: 2,
    listQuantity: 2,
    settledHere: 0,
    writable: true,
    fromRun: true,
    approvalStatus: 'APPROVED',
    ...overrides,
  };
}

function candidate(
  overrides: Partial<BasketOriginCandidate> = {}
): BasketOriginCandidate {
  return {
    listId: 'l3',
    lineId: 'zl3',
    zoneId: 'z3',
    listName: 'Office',
    zoneName: 'The office',
    listQuantity: 4,
    content: 'Milk',
    matchedOnText: false,
    unavailable: null,
    fromRun: false,
    ...overrides,
  };
}

/** A list holding no such line, which raising creates one on (backend `0092`). */
function other(overrides: Partial<BasketListRef> = {}): BasketListRef {
  return {
    listId: 'l4',
    zoneId: 'z4',
    listName: 'Cabin trip',
    zoneName: 'Weekend away',
    fromRun: false,
    ...overrides,
  };
}

function answer(
  origins: readonly BasketLineOriginDetail[],
  candidates: readonly BasketOriginCandidate[] = [],
  others: readonly BasketListRef[] = []
): BasketLineOrigins {
  return { lineId: LINE_ID, origins, candidates, others };
}

interface World {
  readonly line?: BasketLine;
  /**
   * What each origins read answers, in order, the last repeating.
   *
   * A list rather than one value because the failures this sheet has to draw are
   * defined by what the **second** read says: a stale write refetches, and the sentence
   * names the number that read came back with.
   */
  readonly reads?: readonly (BasketLineOrigins | null)[];
  /** What the contribution write does: a result, a refusal, or nothing in particular. */
  readonly write?: BasketOriginQuantityResult | GatewayError;
}

function refusal(code: string): GatewayError {
  return new GatewayError({
    code: code as GatewayError['code'],
    status: 409,
    correlationId: 'ref-1',
  });
}

/** Every origins read the sheet made, and every contribution it wrote. */
const originReads: string[] = [];
const writes: BasketOriginQuantityRequest[] = [];

function storeDouble(world: World) {
  const me: BasketParticipant = {
    id: 'me',
    kind: 'OWNER',
    displayName: 'Ana',
    username: 'ana',
    guestNumber: null,
    userId: 'u-me',
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
  };

  const lines = signal<readonly BasketLine[]>([world.line ?? line()]);
  const error = signal<unknown>(null);
  const reads = world.reads ?? [answer([origin()])];
  let read = 0;

  const basket = signal<BasketView | null>({
    id: BASKET_ID,
    name: 'Saturday big shop',
    status: 'ACTIVE',
    generatedAt: new Date('2026-08-21T09:00:00.000Z'),
    lines: lines(),
    participants: [me],
    me,
    seesZoneData: true,
    products: new Map(),
    scopes: new Map(),
    listNames: new Map(),
  });

  return {
    basket,
    state: signal('ready'),
    error,
    shareLink: signal(null),
    busyLines: signal(new Set<string>()),
    lines,
    seesZoneData: signal(true),
    listNames: signal(new Map<string, string>()),
    participants: signal([me]),
    me: signal(me),
    participantsById: signal(new Map([[me.id, me]])),
    progress: signal({ settled: 0, total: 0, spent: 0 }),
    present: signal([]),
    live: signal(true),
    revoked: signal(false),
    pendingTargets: signal(new Set<string>()),
    open: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(null),
    reopen: jest.fn().mockResolvedValue(null),
    setPick: jest.fn().mockResolvedValue(null),
    setOutstanding: jest.fn().mockResolvedValue(null),
    rememberListNames: jest.fn(),
    apply: jest.fn(),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    share: jest.fn().mockResolvedValue(null),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    removeParticipant: jest.fn().mockResolvedValue(undefined),

    loadLineOrigins: jest.fn(async (lineId: string) => {
      originReads.push(lineId);
      const answered = reads[Math.min(read, reads.length - 1)];
      read += 1;
      if (answered === null) {
        error.set(refusal('conflict'));
      }
      return answered;
    }),

    setOriginQuantity: jest.fn(
      async (_lineId: string, body: BasketOriginQuantityRequest) => {
        writes.push(body);
        if (world.write instanceof GatewayError) {
          error.set(world.write);
          return null;
        }
        error.set(null);
        return world.write ?? null;
      }
    ),
  };
}

async function render(world: World = {}, basePath = '/velista') {
  TestBed.resetTestingModule();
  originReads.length = 0;
  writes.length = 0;

  const store = storeDouble(world);
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const pageMap = convertToParamMap({ generatedListId: BASKET_ID });
  const sheetMap = convertToParamMap({ lineId: LINE_ID });

  await TestBed.configureTestingModule({
    imports: [LineUnitsSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath }),
      { provide: BasketStore, useValue: store },
      { provide: SheetNavigation, useValue: sheets },
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

  const fixture = TestBed.createComponent(LineUnitsSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, store, sheets };
}

type Sheet = ComponentFixture<LineUnitsSheet>;

/** The reels actually on screen, which is the set of rows a reader may move. */
function reels(fixture: Sheet) {
  return fixture.debugElement
    .queryAll(By.directive(QuantityReel))
    .map((found) => found.componentInstance as QuantityReel);
}

/** Let go of one reel where it ended up, which is what the sheet commits on. */
async function release(fixture: Sheet, index: number, to: number) {
  const reel = reels(fixture)[index];
  reel.committedTo.emit({ from: reel.value(), to });
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Open the section of lists that are not in the line. */
async function openRest(fixture: Sheet) {
  (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('.disclosure')
    ?.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('LineUnitsSheet: changing what each list asked for', () => {
  describe('opening it', () => {
    it('reads the line s origins', async () => {
      const { fixture } = await render();

      expect(originReads).toEqual([LINE_ID]);
      expect(fixture.componentInstance['state']()).toBe('loaded');
    });

    it('draws each list with what it put in and what it asks for now', async () => {
      const { fixture } = await render({
        reads: [
          answer([
            origin(),
            origin({
              originId: 'o2',
              listId: 'l2',
              lineId: 'zl2',
              zoneId: 'z2',
              listName: 'Groceries',
              zoneName: 'Parents',
              contributed: 1,
              listQuantity: 5,
            }),
          ]),
        ],
      });

      const rows = fixture.componentInstance['asked']();
      expect(rows.map((row) => row.label)).toEqual([
        'Weekly shop',
        'Groceries',
      ]);
      expect(rows.map((row) => row.contributed)).toEqual([2, 1]);
      expect(rows.map((row) => row.listQuantity)).toEqual([2, 5]);
    });

    /**
     * The same rule the skip report uses. A reader with one list called Food is not made
     * to read which house it is in, and a reader with two has no other way to tell.
     */
    it('names the zone only where two rows share a list name', async () => {
      const { fixture } = await render({
        reads: [
          answer(
            [
              origin({ listName: 'Food', zoneName: 'Flat 3B' }),
              origin({
                originId: 'o2',
                listId: 'l2',
                lineId: 'zl2',
                listName: 'Food',
                zoneName: 'Parents',
              }),
              origin({
                originId: 'o3',
                listId: 'l3',
                lineId: 'zl3',
                listName: 'Office',
                zoneName: 'The office',
              }),
            ],
            []
          ),
        ],
      });

      expect(
        fixture.componentInstance['asked']().map((row) => row.zoneName)
      ).toEqual(['Flat 3B', 'Parents', null]);
    });

    it('says so when the read fails, and asks again on retry', async () => {
      const { fixture } = await render({ reads: [null, answer([origin()])] });

      expect(fixture.componentInstance['state']()).toBe('failed');

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.secondary')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(originReads).toHaveLength(2);
      expect(fixture.componentInstance['state']()).toBe('loaded');
    });
  });

  describe('the total at the top', () => {
    it('is what the basket will buy', async () => {
      const { fixture } = await render({
        line: line({ quantity: 5, settled: 2 }),
      });

      expect(fixture.componentInstance['total']()).toBe(3);
    });

    /**
     * Section 4.1: a line raised above what the households asked for keeps the
     * difference, and without this second sentence the arithmetic on the screen does not
     * add up and reads as a defect.
     */
    it('reports the part of the line no list asked for', async () => {
      const { fixture } = await render({
        line: line({ quantity: 20, settled: 0 }),
        reads: [answer([origin({ contributed: 3 })])],
      });

      expect(fixture.componentInstance['listsWant']()).toBe(3);
      expect(fixture.componentInstance['extra']()).toBe(17);
    });

    it('follows a thumb that is still down', async () => {
      const { fixture } = await render({
        line: line({ quantity: 3, settled: 0 }),
        reads: [answer([origin({ contributed: 2 })])],
      });

      expect(fixture.componentInstance['total']()).toBe(3);

      reels(fixture)[0].preview.emit(5);
      fixture.detectChanges();

      // Three outstanding, and a reel three above where its origin sits.
      expect(fixture.componentInstance['total']()).toBe(6);
      expect(fixture.componentInstance['listsWant']()).toBe(5);

      reels(fixture)[0].preview.emit(null);
      fixture.detectChanges();

      expect(fixture.componentInstance['total']()).toBe(3);
    });
  });

  describe('the lists that asked for nothing', () => {
    it('is closed until somebody opens it', async () => {
      const { fixture } = await render({
        reads: [answer([origin()], [candidate()])],
      });

      expect(fixture.componentInstance['restOpen']()).toBe(false);
      expect(reels(fixture)).toHaveLength(1);

      await openRest(fixture);

      expect(fixture.componentInstance['restOpen']()).toBe(true);
      expect(reels(fixture)).toHaveLength(2);
    });

    /**
     * Section 4.3: the lists holding this line at zero, then the lists holding no such
     * line, in that order and with no heading between them. An origin at zero asked for
     * nothing, which is the same answer as a list that never did.
     */
    it('puts the zero origins and the candidates before the rest', async () => {
      const { fixture } = await render({
        reads: [
          answer(
            [
              origin(),
              origin({
                originId: 'o0',
                listId: 'l0',
                lineId: 'zl0',
                listName: 'Emptied',
                contributed: 0,
              }),
            ],
            [candidate()],
            [other()]
          ),
        ],
      });

      expect(
        fixture.componentInstance['asked']().map((row) => row.label)
      ).toEqual(['Weekly shop']);
      expect(
        fixture.componentInstance['rest']().map((row) => row.label)
      ).toEqual(['Emptied', 'Office', 'Cabin trip']);
    });

    /**
     * Served rather than filtered out (backend 0057, section 3.2), and drawn with the
     * reason and no control: `0030` keeps the control absent, and the fact is one about
     * a list this reader is entitled to.
     */
    it('explains a candidate that cannot be taken, and gives it no reel', async () => {
      // Two reasons where `0055` drew three: backend `0092` section 3.2 made a pending
      // line and a line at zero adoptable, so neither is answered any more. A reason
      // this build cannot read arrives as `UNAVAILABLE` and says only that.
      const { fixture } = await render({
        reads: [
          answer(
            [origin()],
            [
              candidate({ lineId: 'zl-a', unavailable: 'CLAIMED' }),
              candidate({ lineId: 'zl-b', unavailable: 'REJECTED' }),
              candidate({ lineId: 'zl-c', unavailable: 'UNAVAILABLE' }),
            ]
          ),
        ],
      });

      await openRest(fixture);

      expect(
        fixture.componentInstance['rest']().map((row) => row.reason)
      ).toEqual([
        'basket.units.claimed',
        'basket.units.rejected',
        'basket.units.cannotTake',
      ]);
      // Only the origin's, since none of the three may be moved.
      expect(reels(fixture)).toHaveLength(1);
    });

    /** The run's last resort match, marked so the reader confirms it. */
    it('marks a candidate matched on the words alone', async () => {
      const { fixture } = await render({
        reads: [
          answer(
            [origin()],
            [candidate({ matchedOnText: true, content: 'whole milk' })]
          ),
        ],
      });

      const [row] = fixture.componentInstance['rest']();
      expect(row.matchedOnText).toBe('whole milk');
    });
  });

  describe('committing one row', () => {
    it('sends the contribution it last read as from', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ contributed: 2 })])],
        write: {
          line: line(),
          origin: origin({ contributed: 4, listQuantity: 4 }),
          listQuantity: 4,
        },
      });

      await release(fixture, 0, 4);

      expect(writes).toEqual([
        { listId: 'l1', lineId: 'zl1', quantity: 4, from: 2 },
      ]);
      expect(fixture.componentInstance['asked']()[0].contributed).toBe(4);
    });

    /** A candidate has asked for nothing, so raising it is a write from zero. */
    it('adopts a candidate from zero, and keeps the row where it is', async () => {
      // Section 5: the row takes the answered numbers and stays put. Moving it up to
      // the first group under somebody's thumb would take the control they are
      // holding out from under them, and the next read is what re-groups.
      const adopted = origin({
        originId: 'o3',
        listId: 'l3',
        lineId: 'zl3',
        zoneId: 'z3',
        listName: 'Office',
        zoneName: 'The office',
        contributed: 2,
        listQuantity: 6,
      });
      const { fixture } = await render({
        reads: [answer([origin()], [candidate()])],
        write: { line: line(), origin: adopted, listQuantity: 6 },
      });

      await openRest(fixture);
      await release(fixture, 1, 2);

      expect(writes).toEqual([
        { listId: 'l3', lineId: 'zl3', quantity: 2, from: 0 },
      ]);
      expect(
        fixture.componentInstance['asked']().map((row) => row.label)
      ).toEqual(['Weekly shop']);
      const rest = fixture.componentInstance['rest']();
      expect(rest.map((row) => row.label)).toEqual(['Office']);
      expect(rest[0].contributed).toBe(2);
      expect(rest[0].listQuantity).toBe(6);
    });

    /**
     * Zero takes the list off the line (backend 0057, section 5.3). Whether it is
     * adoptable again is a question about claims and approvals only the server can
     * answer, so the sheet re-reads rather than moving the row across by hand.
     */
    it('re-reads when the origin was dropped', async () => {
      const { fixture } = await render({
        reads: [answer([origin()]), answer([], [candidate({ lineId: 'zl1' })])],
        write: { line: line(), origin: null, listQuantity: 0 },
      });

      await release(fixture, 0, 0);

      expect(originReads).toHaveLength(2);
      expect(fixture.componentInstance['asked']()).toHaveLength(0);
      expect(fixture.componentInstance['rest']()).toHaveLength(1);
    });

    it('does nothing when the gesture ended where it started', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ contributed: 2 })])],
      });

      await release(fixture, 0, 2);

      expect(writes).toEqual([]);
    });
  });

  describe('a write that is refused', () => {
    /**
     * Section 6, and `0054` section 4.1's sentence. The store has already refetched the
     * basket; the origins are a second read, and the number in the sentence is what that
     * read came back with rather than anything the client believed.
     */
    it('names the number this list is actually at, and stays open', async () => {
      const { fixture, sheets } = await render({
        reads: [
          answer([origin({ contributed: 2 })]),
          answer([origin({ contributed: 5 })]),
        ],
        write: refusal('stale_quantity'),
      });

      await release(fixture, 0, 4);

      expect(originReads).toHaveLength(2);
      expect(fixture.componentInstance['asked']()[0].notices).toEqual([
        {
          key: 'basket.error.staleLine',
          values: { count: 5 },
          tone: 'refusal',
        },
      ]);
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    /**
     * The reel returns to the floor rather than to where it started, because the floor is
     * where the reader was heading. The next `from` is still the real contribution.
     */
    it('names the floor and puts the reel on it', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ contributed: 5, settledHere: 2 })])],
        write: refusal('below_settled'),
      });

      await release(fixture, 0, 1);

      const [row] = fixture.componentInstance['asked']();
      expect(row.notices).toEqual([
        {
          key: 'basket.error.belowSettled',
          values: { count: 2 },
          tone: 'refusal',
        },
      ]);
      expect(row.shown).toBe(2);
      expect(row.contributed).toBe(5);
    });

    it('sends the read contribution as from even after a floor was drawn', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ contributed: 5, settledHere: 2 })])],
        write: refusal('below_settled'),
      });

      await release(fixture, 0, 1);
      await release(fixture, 0, 3);

      expect(writes.map((write) => write.from)).toEqual([5, 5]);
    });

    /** The row keeps its numbers and loses its control, in place (section 6). */
    it('takes the reel off a row whose access has gone', async () => {
      const { fixture, sheets } = await render({
        reads: [answer([origin({ contributed: 2 })])],
        write: new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'ref-1',
        }),
      });

      await release(fixture, 0, 4);

      const [row] = fixture.componentInstance['asked']();
      expect(row.reason).toBe('basket.units.noAccess');
      expect(row.contributed).toBe(2);
      expect(reels(fixture)).toHaveLength(0);
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    /** Everything with no reading of its own still says something (section 6). */
    it('falls back to one sentence for anything else', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ contributed: 2 })])],
      });

      await release(fixture, 0, 4);

      expect(fixture.componentInstance['asked']()[0].notices).toEqual([
        { key: 'basket.error.failed', values: {}, tone: 'refusal' },
      ]);
    });
  });

  /**
   * The third collection, which replaced the send sheet (velista `0068`).
   *
   * Raising one of these is what "send this line to that list" now means, and the
   * whole of what makes it a different write is one absent field.
   */
  describe('a list that holds no such line', () => {
    it('draws the entry for a line that is on nobody’s list, and counts every list', async () => {
      // The line the sheet is most worth opening for: somebody who added batteries
      // and wants three for the flat and two for their parents.
      const { fixture } = await render({
        line: line({ kind: 'ADDED', origins: [], quantity: 1 }),
        reads: [
          answer(
            [],
            [],
            [other(), other({ listId: 'l5', listName: 'Weekly shop' })]
          ),
        ],
      });

      expect(fixture.componentInstance['asked']()).toHaveLength(0);
      expect(fixture.componentInstance['rest']()).toHaveLength(2);
      expect(fixture.componentInstance['empty']()).toBe(false);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.disclosure')
          ?.textContent
      ).toContain('basket.units.more');
    });

    it('names no zone line, which is what makes the write create one', async () => {
      // The server adds the line through the ordinary add and answers the id it
      // landed on, which is not always the one a fresh add would have made.
      const created = origin({
        originId: 'o4',
        listId: 'l4',
        lineId: 'zl-created',
        zoneId: 'z4',
        listName: 'Cabin trip',
        zoneName: 'Weekend away',
        contributed: 2,
        listQuantity: 2,
        fromRun: false,
      });
      const { fixture } = await render({
        line: line({ kind: 'ADDED', origins: [] }),
        reads: [answer([], [], [other()])],
        write: { line: line(), origin: created, listQuantity: 2 },
      });

      await openRest(fixture);
      await release(fixture, 0, 2);

      expect(writes).toEqual([{ listId: 'l4', quantity: 2, from: 0 }]);
      const [row] = fixture.componentInstance['rest']();
      expect(row.contributed).toBe(2);
      // It became an origin and stayed where it was, carrying the line it was
      // answered rather than the one it asked for.
      expect(row.sourceLineId).toBe('zl-created');
    });

    it('says so when units bought before it arrived came home with it', async () => {
      // Section 6. "The flat now knows about batteries and needs none" is a strange
      // enough outcome that it is said in words on the answer that created the row.
      // Not in the refusal's colour: the write succeeded.
      const created = origin({
        originId: 'o4',
        listId: 'l4',
        lineId: 'zl-created',
        listName: 'Cabin trip',
        contributed: 4,
        listQuantity: 0,
        settledHere: 4,
        fromRun: false,
      });
      const { fixture } = await render({
        line: line({ kind: 'ADDED', origins: [], settled: 4 }),
        reads: [answer([], [], [other()])],
        write: {
          line: line({ settled: 4, waitingSettled: 0 }),
          origin: created,
          listQuantity: 0,
        },
      });

      await openRest(fixture);
      await release(fixture, 0, 4);

      expect(fixture.componentInstance['rest']()[0].notices).toEqual([
        {
          key: 'basket.units.cameHome',
          values: { name: 'Cabin trip', count: 4 },
          tone: 'news',
        },
      ]);
    });

    it('says how many are still waiting when this list took fewer than were', async () => {
      // Section 6's second sentence. Four were bought before the line reached any
      // list, this one asked for two, and the shopper is told the other two are
      // still unplaced so they know a second list would take them.
      const created = origin({
        originId: 'o4',
        listId: 'l4',
        lineId: 'zl-created',
        listName: 'Cabin trip',
        contributed: 2,
        listQuantity: 0,
        settledHere: 2,
        fromRun: false,
      });
      const { fixture } = await render({
        line: line({
          kind: 'ADDED',
          origins: [],
          settled: 4,
          waitingSettled: 4,
        }),
        reads: [answer([], [], [other()])],
        write: {
          line: line({ settled: 4, waitingSettled: 2 }),
          origin: created,
          listQuantity: 0,
        },
      });

      await openRest(fixture);
      await release(fixture, 0, 2);

      expect(fixture.componentInstance['rest']()[0].notices).toEqual([
        {
          key: 'basket.units.cameHome',
          values: { name: 'Cabin trip', count: 2 },
          tone: 'news',
        },
        {
          key: 'basket.units.stillWaiting',
          values: { count: 2 },
          tone: 'news',
        },
      ]);
    });

    it('says nothing about waiting units on an edit of a row already there', async () => {
      // Both sentences are about the write that **put a list on the line**. Repeating
      // "some are still waiting" on every drag would turn a fact into wallpaper, and
      // a row that has always been bought against received nothing to report.
      const { fixture } = await render({
        line: line({ waitingSettled: 3 }),
        reads: [answer([origin({ contributed: 2 })])],
        write: {
          line: line({ waitingSettled: 3 }),
          origin: origin({ contributed: 4 }),
          listQuantity: 4,
        },
      });

      await release(fixture, 0, 4);

      expect(fixture.componentInstance['asked']()[0].notices).toEqual([]);
    });

    it('says the list already has it when the raise lands on a line that is there', async () => {
      // The stale case a create meets, and not the one an edit meets: nothing moved
      // underneath the reader's arithmetic, so the sentence is about the list.
      const { fixture } = await render({
        line: line({ kind: 'ADDED', origins: [] }),
        reads: [answer([], [], [other()])],
        write: refusal('stale_quantity'),
      });

      await openRest(fixture);
      await release(fixture, 0, 1);

      expect(fixture.componentInstance['rest']()[0].notices).toEqual([
        { key: 'basket.units.alreadyHere', values: {}, tone: 'refusal' },
      ]);
      // And it read again, because the sheet was wrong about that list.
      expect(originReads).toHaveLength(2);
    });
  });

  describe('what a row says about the list behind it', () => {
    it('says what a list asks for on its own before anybody raises it', async () => {
      const { fixture } = await render({
        reads: [answer([origin()], [candidate({ listQuantity: 5 })])],
      });

      await openRest(fixture);

      expect(fixture.componentInstance['rest']()[0].listCaption).toEqual({
        key: 'basket.units.listAsks',
        values: { count: 5 },
      });
    });

    it('says what a raised list asks for now, only once the two have drifted', async () => {
      // Asked for minus bought is what the list should be asking for. A row where
      // they agree says nothing, because there is nothing to reconcile.
      const { fixture } = await render({
        reads: [
          answer([
            origin({ contributed: 3, settledHere: 1, listQuantity: 2 }),
            origin({
              originId: 'o2',
              listId: 'l2',
              lineId: 'zl2',
              listName: 'Groceries',
              contributed: 3,
              settledHere: 1,
              listQuantity: 5,
            }),
          ]),
        ],
      });

      const rows = fixture.componentInstance['asked']();
      const agreeing = rows.find((row) => row.label === 'Weekly shop');
      const drifted = rows.find((row) => row.label === 'Groceries');
      expect(agreeing?.listCaption).toBeNull();
      expect(drifted?.listCaption).toEqual({
        key: 'basket.units.listNow',
        values: { count: 5 },
      });
    });

    it('says a list has not agreed to the line yet', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ approvalStatus: 'PENDING' })])],
      });

      expect(fixture.componentInstance['asked']()[0].pending).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'basket.units.pending'
      );
    });

    it('draws what this basket bought for the list, on every row', async () => {
      // Read only, from every collection: nothing on this sheet buys anything, and
      // this column never moves from it.
      const { fixture } = await render({
        reads: [answer([origin({ settledHere: 2 })])],
      });

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.row-bought')
          ?.textContent
      ).toContain('2');
    });
  });

  describe('the order the rows come in', () => {
    it('puts the run’s own lists first, then by zone and by list', async () => {
      // The server sorts nothing and says so: the order is a fact about the person
      // reading, and somebody in an aisle almost always means one of the lists the
      // basket came from.
      const { fixture } = await render({
        reads: [
          answer([
            origin({
              originId: 'oa',
              listId: 'la',
              lineId: 'zla',
              listName: 'Shared shelf',
              zoneName: 'Housemates',
              fromRun: false,
            }),
            origin({
              originId: 'ob',
              listId: 'lb',
              lineId: 'zlb',
              listName: 'Groceries',
              zoneName: 'Parents',
              fromRun: true,
            }),
            origin({
              originId: 'oc',
              listId: 'lc',
              lineId: 'zlc',
              listName: 'Weekly shop',
              zoneName: 'Flat 3B',
              fromRun: true,
            }),
          ]),
        ],
      });

      expect(
        fixture.componentInstance['asked']().map((row) => row.label)
      ).toEqual(['Weekly shop', 'Groceries', 'Shared shelf']);
    });
  });

  describe('a row nobody may move', () => {
    /**
     * `writable` is the server's answer about the owner's access, which is what
     * authorizes every write made from this basket. The information stays and the control
     * goes, which is `0030` intact.
     */
    it('draws its numbers and no reel', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ writable: false, contributed: 2 })])],
      });

      expect(fixture.componentInstance['asked']()[0].reason).toBe(
        'basket.units.noAccess'
      );
      expect(reels(fixture)).toHaveLength(0);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.row-number')
          ?.textContent
      ).toContain('2');
    });
  });

  describe('every reel it draws', () => {
    it('is named for its list and bounded by what the wire accepts', async () => {
      const { fixture } = await render({
        reads: [answer([origin({ listName: 'Weekly shop' })])],
      });

      const [reel] = reels(fixture);
      expect(reel.label()).toBe('Weekly shop');
      expect(reel.min()).toBe(0);
      expect(reel.max()).toBe(9999);
    });
  });

  describe('leaving it', () => {
    /**
     * This sheet opens over the settle sheet, so back has to land there rather than on
     * the basket (`0031`). The whole URL and never a relative climb.
     */
    it('dismisses onto the settle sheet', async () => {
      const { fixture, sheets } = await render();

      fixture.componentInstance['close']();
      await fixture.whenStable();

      expect(sheets.dismiss).toHaveBeenCalledWith(SETTLE_URL);
    });

    it('names it in the standalone build too', async () => {
      const { fixture, sheets } = await render({}, '');

      fixture.componentInstance['close']();
      await fixture.whenStable();

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/en/shopping-lists/${BASKET_ID}/sheet/lines/${LINE_ID}/settle`
      );
    });
  });
});
