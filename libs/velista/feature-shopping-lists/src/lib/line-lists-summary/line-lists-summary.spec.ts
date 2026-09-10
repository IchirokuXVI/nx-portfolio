import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, GatewayError } from '@portfolio/velista/data-access';
import type {
  BasketLine,
  BasketLineOriginDetail,
  BasketListRef,
  BasketOriginCandidate,
  BasketOriginQuantityResult,
  BasketOriginSettledResult,
} from '@portfolio/velista/models';
import { QuantityReel } from '@portfolio/velista/ui';
import { LineListsSummary } from './line-lists-summary';

/**
 * The rows under the product on the settle sheet (velista `0073`, section 3).
 *
 * Every test here is one of the plan's, and they are all about the same thing: the two
 * numbers on a row are opposite acts, and the screen must never let one be sent as the
 * other. Who the summary is drawn for at all is `settle-sheet.spec.ts`.
 */

const LINE_ID = 'c0ffee00-1111-4222-8333-444455556666';

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: LINE_ID,
    content: 'Milk',
    quantity: 6,
    settled: 0,
    waitingSettled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    kind: 'DERIVED',
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    origins: [],
    ...overrides,
  } as BasketLine;
}

function origin(
  overrides: Partial<BasketLineOriginDetail> = {}
): BasketLineOriginDetail {
  return {
    originId: 'o1',
    listId: 'l1',
    lineId: 'zl1',
    zoneId: 'z1',
    listName: 'Flat',
    zoneName: 'Home',
    contributed: 4,
    listQuantity: 4,
    settledHere: 0,
    writable: true,
    fromRun: true,
    approvalStatus: 'APPROVED',
    ...overrides,
  };
}

interface World {
  readonly line?: BasketLine;
  readonly origins?: readonly BasketLineOriginDetail[];
  readonly candidates?: readonly BasketOriginCandidate[];
  readonly others?: readonly BasketListRef[];
  /** Null makes the read fail, which is the state the block draws on its own. */
  readonly reads?: boolean;
}

function storeDouble(world: World) {
  const lines = signal<readonly BasketLine[]>([world.line ?? line()]);

  return {
    lines,
    state: signal('ready'),
    error: signal<unknown>(null),
    loadLineOrigins: jest.fn(async () =>
      world.reads === false
        ? null
        : {
            lineId: LINE_ID,
            origins: world.origins ?? [],
            candidates: world.candidates ?? [],
            others: world.others ?? [],
          }
    ),
    setOriginQuantity: jest.fn(
      async (): Promise<BasketOriginQuantityResult | null> => null
    ),
    setOriginSettled: jest.fn(
      async (): Promise<BasketOriginSettledResult | null> => null
    ),
  };
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();
  const store = storeDouble(world);

  await TestBed.configureTestingModule({
    imports: [LineListsSummary, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: BasketStore, useValue: store },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineListsSummary);
  fixture.componentRef.setInput('lineId', LINE_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, store };
}

/** Every reel on the summary, in the order the rows draw them. */
const reels = (fixture: ComponentFixture<LineListsSummary>) =>
  fixture.debugElement
    .queryAll(By.directive(QuantityReel))
    .map((found) => found.componentInstance as QuantityReel);

/** Let a reel go where the caller says, the way the control's own commit does. */
function letGo(control: QuantityReel, from: number, to: number): void {
  control.committedTo.emit({ from, to });
}

const text = (fixture: ComponentFixture<LineListsSummary>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('LineListsSummary: the rows', () => {
  it('draws one row per origin, with both numbers', async () => {
    // Test 4's content half. One row per list that asked, "asked for" and "got".
    const { fixture } = await render({
      line: line({ quantity: 6, settled: 2 }),
      origins: [
        origin({ contributed: 4, settledHere: 2 }),
        origin({
          originId: 'o2',
          listId: 'l2',
          lineId: 'zl2',
          listName: 'Parents’ house',
          contributed: 2,
          settledHere: 0,
        }),
      ],
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.row')
    ).toHaveLength(2);
    expect(text(fixture)).toContain('Flat');
    expect(text(fixture)).toContain('Parents’ house');

    const found = reels(fixture);
    expect(found).toHaveLength(4);
    expect(found[0].value()).toBe(4);
    expect(found[1].value()).toBe(2);
    expect(found[2].value()).toBe(2);
    expect(found[3].value()).toBe(0);
  });

  it('names each reel by its column, so two on one row differ', async () => {
    // Section 7. "Flat, asked for" and "Flat, got", which differ before the number.
    const { fixture } = await render({ origins: [origin()] });

    const found = reels(fixture);
    expect(found[0].label()).toContain('basket.units.askedLabel');
    expect(found[1].label()).toContain('basket.units.gotLabel');
  });

  it('caps got at what the list asked for, and floors asked for at got', async () => {
    // Test 7, and the arithmetic the whole row rests on: a list cannot have got more
    // of a line than it wanted, and it cannot retroactively have wanted fewer than
    // this basket has already bought for it.
    const { fixture } = await render({
      origins: [origin({ contributed: 5, settledHere: 3 })],
    });

    const [asked, got] = reels(fixture);
    expect(asked.min()).toBe(3);
    expect(got.min()).toBe(0);
    expect(got.max()).toBe(5);
  });
});

describe('LineListsSummary: what one list got', () => {
  /** A settled answer that moves the line by the difference, as the server does. */
  const answered = (
    settled: number,
    quantity = 6
  ): BasketOriginSettledResult => ({
    line: line({ quantity, settled }),
    origin: origin({ contributed: 4, settledHere: settled }),
    skippedCount: 0,
    skipped: [],
  });

  it('sends the new number and where it started', async () => {
    const { fixture, store } = await render({
      origins: [origin({ contributed: 4, settledHere: 0 })],
    });
    store.setOriginSettled.mockResolvedValue(answered(2));

    letGo(reels(fixture)[1], 0, 2);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.setOriginSettled).toHaveBeenCalledWith(LINE_ID, {
      lineId: 'zl1',
      settled: 2,
      from: 0,
    });
  });

  it('takes the outstanding amount down by the same amount', async () => {
    // Test 5. Raising "got" is the same purchase the row's number one screen up
    // writes, so the line's settled amount moves with it. The store applies the
    // answered line, which is what the sheet above reads its number from.
    const { fixture, store } = await render({
      origins: [origin({ contributed: 4, settledHere: 0 })],
    });
    store.setOriginSettled.mockResolvedValue(answered(2));

    letGo(reels(fixture)[1], 0, 2);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.setOriginSettled.mock.results).toHaveLength(1);
    expect(reels(fixture)[1].value()).toBe(2);
  });

  it('takes a purchase back for that list and leaves the others alone', async () => {
    // Test 6. Lowering names one zone line, so the second row's numbers are
    // untouched by it: nothing here allocates across lists.
    const second = origin({
      originId: 'o2',
      listId: 'l2',
      lineId: 'zl2',
      listName: 'Parents’ house',
      contributed: 2,
      settledHere: 2,
    });
    const { fixture, store } = await render({
      line: line({ quantity: 6, settled: 4 }),
      origins: [origin({ contributed: 4, settledHere: 2 }), second],
    });
    store.setOriginSettled.mockResolvedValue({
      line: line({ quantity: 6, settled: 3 }),
      origin: origin({ contributed: 4, settledHere: 1 }),
      skippedCount: 0,
      skipped: [],
    });

    letGo(reels(fixture)[1], 2, 1);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.setOriginSettled).toHaveBeenCalledWith(LINE_ID, {
      lineId: 'zl1',
      settled: 1,
      from: 2,
    });

    const after = reels(fixture);
    expect(after[1].value()).toBe(1);
    // The second row still says what it always said.
    expect(after[2].value()).toBe(2);
    expect(after[3].value()).toBe(2);
  });

  it('redraws from the answer rather than from what it asked for', async () => {
    // Backend `0104` section 5, and the one rule a client can break silently. A
    // `NOT_AVAILABLE` close has no units to divide, so any raise takes the whole
    // close back and the row lands above where the reel was dragged.
    const { fixture, store } = await render({
      line: line({ quantity: 6, settled: 6, lastOutcome: 'NOT_AVAILABLE' }),
      origins: [origin({ contributed: 4, settledHere: 0 })],
    });
    store.setOriginSettled.mockResolvedValue({
      line: line({ quantity: 6, settled: 1 }),
      origin: origin({ contributed: 4, settledHere: 1 }),
      skippedCount: 0,
      skipped: [],
    });

    letGo(reels(fixture)[1], 0, 3);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(reels(fixture)[1].value()).toBe(1);
  });

  it('says so when the write could not reach every list', async () => {
    const { fixture, store } = await render({
      origins: [origin({ contributed: 4, settledHere: 0 })],
    });
    store.setOriginSettled.mockResolvedValue({
      ...answered(2),
      skippedCount: 1,
      skipped: [
        { listId: 'l9', reason: 'ACCESS_GONE', listName: null, zoneName: null },
      ],
    });

    letGo(reels(fixture)[1], 0, 2);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('basket.settle.missed');
  });

  it('takes the controls off a row whose access has gone, and keeps its numbers', async () => {
    const { fixture, store } = await render({
      origins: [origin({ contributed: 4, settledHere: 1 })],
    });
    store.error.set(
      new GatewayError({
        code: 'forbidden',
        status: 403,
        correlationId: 'x',
        detail: 'gone',
      })
    );
    store.setOriginSettled.mockResolvedValue(null);

    letGo(reels(fixture)[1], 1, 2);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(reels(fixture)).toHaveLength(0);
    expect(text(fixture)).toContain('basket.units.noAccess');
    expect(text(fixture)).toContain('4');
    expect(text(fixture)).toContain('1');
  });
});

describe('LineListsSummary: the lists that asked for nothing', () => {
  const other = (overrides: Partial<BasketListRef> = {}): BasketListRef => ({
    listId: 'l9',
    zoneId: 'z9',
    listName: 'Office kitchen',
    zoneName: 'The studio',
    fromRun: false,
    ...overrides,
  });

  it('holds them behind one closed control, with its count', async () => {
    // Test 9's first half, and the part of the units sheet that is not a duplicate
    // of anything: raising one of these is how an added line reaches a household.
    const { fixture } = await render({
      origins: [origin()],
      others: [other(), other({ listId: 'l8', listName: 'Cabin trip' })],
    });

    expect(text(fixture)).not.toContain('Office kitchen');
    expect(text(fixture)).toContain('basket.units.more');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.disclosure')
      ?.click();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Office kitchen');
    expect(text(fixture)).toContain('Cabin trip');
  });

  it('gives a list that asked for nothing no got number at all', async () => {
    // Section 3.2. A list that asked for nothing cannot have got any, so the column
    // is empty rather than a zero somebody could try to raise.
    const { fixture } = await render({ others: [other()] });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.disclosure')
      ?.click();
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.got-reel'))).toHaveLength(0);
    expect(fixture.debugElement.queryAll(By.css('.asked-reel'))).toHaveLength(
      1
    );
  });

  it('puts the list on the line when one is raised from zero', async () => {
    // Test 9's second half. The zone line is **omitted**, which is what makes the
    // write a creation rather than an edit (backend `0092`, section 4.2).
    const { fixture, store } = await render({ others: [other()] });
    store.setOriginQuantity.mockResolvedValue({
      line: line({ quantity: 8 }),
      origin: origin({
        originId: 'o9',
        listId: 'l9',
        lineId: 'zl9',
        listName: 'Office kitchen',
        contributed: 2,
        listQuantity: 2,
      }),
      listQuantity: 2,
    });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.disclosure')
      ?.click();
    fixture.detectChanges();

    letGo(reels(fixture)[0], 0, 2);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.setOriginQuantity).toHaveBeenCalledWith(LINE_ID, {
      listId: 'l9',
      quantity: 2,
      from: 0,
    });
  });
});

describe('LineListsSummary: the read', () => {
  it('says it could not read the lists, and offers to try again', async () => {
    // Test 10's own half. The settle buttons are the sheet's and are unaffected,
    // which `settle-sheet.spec.ts` asserts from the other side.
    const { fixture, store } = await render({ reads: false });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.summary-failed')
    ).not.toBeNull();

    store.loadLineOrigins.mockResolvedValue({
      lineId: LINE_ID,
      origins: [origin()],
      candidates: [],
      others: [],
    });
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.summary-retry')
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Flat');
  });

  it('says so when there is no list this reader can put the line on', async () => {
    const { fixture } = await render();

    expect(text(fixture)).toContain('basket.units.empty');
  });
});

describe('LineListsSummary: a finished trip', () => {
  it('keeps every number and draws no reel', async () => {
    // The row one screen up gives a finished basket the same treatment: everything
    // it says stays, because a finished basket is a receipt, and every control goes,
    // because the server refuses all of these writes on one.
    const { fixture } = await render({
      origins: [origin({ contributed: 4, settledHere: 2 })],
    });
    fixture.componentRef.setInput('finished', true);
    fixture.detectChanges();

    expect(reels(fixture)).toHaveLength(0);
    expect(text(fixture)).toContain('Flat');
    expect(text(fixture)).toContain('4');
    expect(text(fixture)).toContain('2');
  });
});
