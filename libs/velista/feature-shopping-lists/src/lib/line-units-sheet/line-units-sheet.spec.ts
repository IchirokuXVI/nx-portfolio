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
    ...overrides,
  };
}

function answer(
  origins: readonly BasketLineOriginDetail[],
  candidates: readonly BasketOriginCandidate[] = []
): BasketLineOrigins {
  return { lineId: LINE_ID, origins, candidates };
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
    loadLineTargets: jest.fn().mockResolvedValue(null),
    bindLine: jest.fn().mockResolvedValue(null),
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
async function openOthers(fixture: Sheet) {
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

      const rows = fixture.componentInstance['rows']();
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
        fixture.componentInstance['rows']().map((row) => row.zoneName)
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

  describe('the lists that are not in', () => {
    it('is closed until somebody opens it', async () => {
      const { fixture } = await render({
        reads: [answer([origin()], [candidate()])],
      });

      expect(fixture.componentInstance['othersOpen']()).toBe(false);
      expect(reels(fixture)).toHaveLength(1);

      await openOthers(fixture);

      expect(fixture.componentInstance['othersOpen']()).toBe(true);
      expect(reels(fixture)).toHaveLength(2);
    });

    /**
     * Served rather than filtered out (backend 0057, section 3.2), and drawn with the
     * reason and no control: `0030` keeps the control absent, and the fact is one about
     * a list this reader is entitled to.
     */
    it('explains a candidate that cannot be adopted, and gives it no reel', async () => {
      const { fixture } = await render({
        reads: [
          answer(
            [origin()],
            [
              candidate({ lineId: 'zl-a', unavailable: 'CLAIMED' }),
              candidate({ lineId: 'zl-b', unavailable: 'NOT_APPROVED' }),
              candidate({ lineId: 'zl-c', unavailable: 'SETTLED' }),
            ]
          ),
        ],
      });

      await openOthers(fixture);

      expect(
        fixture.componentInstance['others']().map((row) => row.reason)
      ).toEqual([
        'basket.units.claimed',
        'basket.units.notApproved',
        'basket.units.settled',
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

      const [row] = fixture.componentInstance['others']();
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
      expect(fixture.componentInstance['rows']()[0].contributed).toBe(4);
    });

    /** A candidate has put nothing in, so adopting it is a write from zero. */
    it('adopts a candidate from zero, and moves it into the line', async () => {
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

      await openOthers(fixture);
      await release(fixture, 1, 2);

      expect(writes).toEqual([
        { listId: 'l3', lineId: 'zl3', quantity: 2, from: 0 },
      ]);
      expect(
        fixture.componentInstance['rows']().map((row) => row.lineId)
      ).toEqual(['zl1', 'zl3']);
      expect(fixture.componentInstance['others']()).toHaveLength(0);
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
      expect(fixture.componentInstance['rows']()).toHaveLength(0);
      expect(fixture.componentInstance['others']()).toHaveLength(1);
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
      expect(fixture.componentInstance['rows']()[0].notice).toEqual({
        key: 'basket.error.staleLine',
        values: { count: 5 },
      });
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

      const [row] = fixture.componentInstance['rows']();
      expect(row.notice).toEqual({
        key: 'basket.error.belowSettled',
        values: { count: 2 },
      });
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

      const [row] = fixture.componentInstance['rows']();
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

      expect(fixture.componentInstance['rows']()[0].notice).toEqual({
        key: 'basket.error.failed',
        values: {},
      });
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

      expect(fixture.componentInstance['rows']()[0].reason).toBe(
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
