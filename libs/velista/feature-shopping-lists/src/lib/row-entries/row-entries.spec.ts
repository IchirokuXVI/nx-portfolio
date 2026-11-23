import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { ListRowsStore } from '@portfolio/velista/data-access';
import {
  QUANTITY_REEL_PX_PER_UNIT,
  QUANTITY_SNAP_POINTS,
  type BasketListRef,
  type BasketProductList,
  type BasketRow,
  type BasketRowEntry,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import { QuantityReel, QuantityStepper } from '@portfolio/velista/ui';
import { RowEntries, type OtherListsState } from './row-entries';

/**
 * What this basket bought for each list of a row, and for the lists that did
 * not ask (velista `0201`).
 *
 * An entry is its list and its ask, then "zone · line", then a stepper of what
 * was bought for it, while the sheet can settle. "Bought for another list" is
 * last and closed, and is drawn only when the sheet hands it a read.
 *
 * Assertions are on translation keys rather than on rendered English, because the
 * testing translator echoes keys.
 */

function entry(over: Partial<BasketRowEntry> = {}): BasketRowEntry {
  return {
    lineId: 'zl-1',
    listId: 'l-weekly',
    content: 'Leche',
    itemIds: ['p-milk'],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left: 2,
    bought: 0,
    asked: 2,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    version: 1,
    ...over,
  };
}

function row(entries: readonly BasketRowEntry[]): BasketRow {
  const left = entries.reduce((sum, held) => sum + held.left, 0);
  return {
    rowKey: entries[0]?.lineId ?? 'zl-1',
    content: 'Leche',
    productId: 'p-milk',
    left,
    bought: 0,
    asked: left,
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries,
  };
}

const LISTS = new Map<string, BasketListRef>([
  [
    'l-weekly',
    {
      listId: 'l-weekly',
      name: 'Compra semanal',
      zoneId: 'z1',
      zoneName: 'Casa',
    },
  ],
  [
    'l-basics',
    {
      listId: 'l-basics',
      name: 'Básicos',
      zoneId: 'z2',
      zoneName: 'Piso de la playa',
    },
  ],
]);

const PANTRY: BasketProductList = {
  listId: 'l-pantry',
  listName: 'Despensa',
  zoneId: 'z1',
  zoneName: 'Casa',
  lineId: 'zl-9',
  lineName: 'Leche',
  quantity: 0,
};

const BREAKFAST: BasketProductList = {
  listId: 'l-breakfast',
  listName: 'Desayunos',
  zoneId: 'z3',
  zoneName: 'Oficina',
  lineId: null,
  lineName: null,
  quantity: null,
};

async function render(
  held: BasketRow,
  options: {
    lists?: ReadonlyMap<string, BasketListRef>;
    finished?: boolean;
    buying?: boolean;
    locale?: string;
    others?: OtherListsState | null;
    changeable?: ReadonlySet<string>;
    compact?: boolean;
    step?: number | null;
  } = {}
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [RowEntries, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(
        new Map(
          options.compact
            ? [
                [
                  StorageKeys.listRows,
                  JSON.stringify({ version: 2, layout: 'compact' }),
                ],
              ]
            : []
        )
      ),
      // The view the entries draw by (velista `0204`).
      ListRowsStore,
      {
        provide: RokuLocaleStore,
        useValue: { locale: signal(options.locale ?? 'en') },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RowEntries);
  fixture.componentRef.setInput('row', held);
  fixture.componentRef.setInput('lists', options.lists ?? LISTS);
  fixture.componentRef.setInput('finished', options.finished ?? false);
  fixture.componentRef.setInput('buying', options.buying ?? true);
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('others', options.others ?? null);
  fixture.componentRef.setInput('changeable', options.changeable ?? new Set());
  if (options.step !== undefined) {
    fixture.componentRef.setInput('step', options.step);
    fixture.componentRef.setInput(
      'steps',
      new Map(held.entries.map((one) => [one.lineId, options.step ?? null]))
    );
  }
  fixture.detectChanges();

  return fixture;
}

type Fixture = Awaited<ReturnType<typeof render>>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const askAmounts = (fixture: Fixture) => [
  ...html(fixture).querySelectorAll<HTMLElement>(
    '.entries > .rows lib-quantity-stepper.ask-amount'
  ),
];

/** The field name each stepper of the lists that ask was given, in order. */
const stepperNames = (fixture: Fixture) =>
  fixture.debugElement
    .queryAll(By.directive(QuantityStepper))
    .filter((held) => held.nativeElement.closest('.others') === null)
    .map((held) => (held.componentInstance as QuantityStepper).fieldName());

/** The name each stepper's buttons and settled amount read, in order. */
const buttonNames = (fixture: Fixture) =>
  fixture.debugElement
    .queryAll(By.directive(QuantityStepper))
    .filter((held) => held.nativeElement.closest('.others') === null)
    .map((held) => (held.componentInstance as QuantityStepper).name());

const texts = (fixture: Fixture, selector: string) =>
  [...html(fixture).querySelectorAll(selector)].map(
    (node) => node.textContent?.trim() ?? ''
  );

const disclosure = (fixture: Fixture) =>
  html(fixture).querySelector<HTMLButtonElement>('.disclosure');

function open(fixture: Fixture): void {
  disclosure(fixture)?.click();
  fixture.detectChanges();
}

/** One press of a stepper's plus. */
function plus(stepper: HTMLElement, fixture: Fixture): void {
  stepper.querySelector<HTMLButtonElement>('button.step.plus')?.click();
  fixture.detectChanges();
}

/** The steppers of the lists that ask, as components, in order. */
const entrySteppers = (fixture: Fixture) =>
  fixture.debugElement
    .queryAll(By.directive(QuantityStepper))
    .filter((held) => held.nativeElement.closest('.others') === null)
    .map((held) => held.componentInstance as QuantityStepper);

describe('RowEntries: the lists that ask', () => {
  it('heads them with what the sheet is for, and draws one row each', async () => {
    const fixture = await render(
      row([
        entry(),
        entry({
          lineId: 'zl-2',
          listId: 'l-basics',
          content: 'Leche para el café',
        }),
      ])
    );

    expect(texts(fixture, '.heading')).toEqual(['basket.entries.heading']);
    expect(texts(fixture, '.entries > .rows .row-list')).toEqual([
      'Compra semanal',
      'Básicos',
    ]);
  });

  it('leads with the list, then the zone and the line', async () => {
    const fixture = await render(
      row([entry({ listId: 'l-basics', content: 'Leche para el café' })])
    );

    expect(texts(fixture, '.row-where')).toEqual([
      'Piso de la playa · Leche para el café',
    ]);
  });

  it('says "Another list" for a list the reader was not served, with no zone', async () => {
    const fixture = await render(
      row([entry(), entry({ lineId: 'zl-2', listId: null, left: 3 })])
    );

    expect(texts(fixture, '.entries > .rows .row-list')).toEqual([
      'Compra semanal',
      'basket.entries.otherList',
    ]);
    expect(texts(fixture, '.row-where')).toHaveLength(1);
  });
});

describe('RowEntries: each name carries its ask (velista 0201, spec 3)', () => {
  it('reads "Compra semanal · 3"', async () => {
    const fixture = await render(row([entry({ left: 3, asked: 3 })]));

    expect(texts(fixture, '.entries > .rows .row-name')).toEqual([
      'Compra semanal · 3',
    ]);
    // The ask has its own element, which is never cut.
    expect(texts(fixture, '.row-ask')).toEqual(['· 3']);
  });

  it('reads the ask by weight in its exact form with the unit, "· 1,5 kg"', async () => {
    const fixture = await render(
      {
        ...row([entry({ left: 1500, asked: 1500, unit: 'GRAM' })]),
        unit: 'GRAM',
      },
      { locale: 'es' }
    );

    expect(texts(fixture, '.row-ask')).toEqual(['· 1,5 kg']);
  });

  it('keeps the ask of the wire after a buy above it: "· 3" with 4 bought (spec 7)', async () => {
    const fixture = await render(
      row([entry({ left: 0, bought: 4, asked: 3 })])
    );

    expect(texts(fixture, '.row-ask')).toEqual(['· 3']);
    expect(entrySteppers(fixture)[0].reach()).toBe('over');
  });

  it('reads "· 0" in amber for a list made by a buy of 2 (spec 7)', async () => {
    const fixture = await render(
      row([entry({ left: 0, bought: 2, asked: 0 })])
    );

    expect(texts(fixture, '.row-ask')).toEqual(['· 0']);
    expect(entrySteppers(fixture)[0].reach()).toBe('over');
  });
});

describe('RowEntries: Lists and amounts (velista 0200)', () => {
  const two = () =>
    row([
      entry(),
      entry({ lineId: 'zl-2', listId: 'l-basics', content: 'Leche' }),
    ]);

  it('draws no swap icon and no "Change for all lists"', async () => {
    const fixture = await render(two(), {
      changeable: new Set(['zl-1', 'zl-2']),
    });

    expect(html(fixture).querySelector('lib-swap-icon')).toBeNull();
    expect(html(fixture).querySelector('.change')).toBeNull();
    expect(html(fixture).textContent).not.toContain('basket.change.all');
  });

  it('draws the button in the heading row when one entry is changeable', async () => {
    const fixture = await render(
      row([
        entry({ demandEditable: false }),
        entry({
          lineId: 'zl-2',
          listId: 'l-basics',
          demandEditable: false,
        }),
      ]),
      { changeable: new Set(['zl-2']) }
    );
    let opened = 0;
    fixture.componentInstance.listsOpened.subscribe(() => (opened += 1));

    const button =
      html(fixture).querySelector<HTMLButtonElement>('.head .lists-open');
    button?.click();

    expect(button?.textContent).toContain('basket.lists.open');
    expect(opened).toBe(1);
  });

  it('draws the button when one entry has an ask the reader may change', async () => {
    const fixture = await render(two());

    expect(html(fixture).querySelector('.head .lists-open')).not.toBeNull();
  });

  it('draws no button and no "Bought for another list" for a guest who can change neither (spec 6)', async () => {
    const fixture = await render(
      row([
        entry({ listId: null, canWrite: false, demandEditable: false }),
        entry({
          lineId: 'zl-2',
          listId: null,
          canWrite: false,
          demandEditable: false,
        }),
      ]),
      // The sheet hands a guest no read of the other lists.
      { lists: new Map(), others: null }
    );

    expect(html(fixture).querySelector('.lists-open')).toBeNull();
    expect(disclosure(fixture)).toBeNull();
    expect(html(fixture).textContent).not.toContain(
      'basket.entries.otherHeading'
    );
    // The heading is still there, and a guest still records buys.
    expect(texts(fixture, '.heading')).toEqual(['basket.entries.heading']);
    expect(askAmounts(fixture)).toHaveLength(2);
  });
});

describe('RowEntries: each list steps what was bought (velista 0201)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('draws a stepper at what was bought, from 0 the first time (spec 1)', async () => {
    const fixture = await render(row([entry({ left: 2, bought: 0 })]));

    expect(askAmounts(fixture)).toHaveLength(1);
    expect(askAmounts(fixture)[0].classList).toContain('variant-sheet-narrow');
    expect(askAmounts(fixture)[0].getAttribute('data-value')).toBe('0');
    expect(stepperNames(fixture)).toEqual(['basket.entries.boughtLabel']);
  });

  it('draws one for every entry, a list the reader was not served included (target state 4)', async () => {
    const fixture = await render(
      row([
        entry({ demandEditable: false }),
        entry({ lineId: 'zl-2', listId: null, demandEditable: false }),
      ])
    );

    expect(askAmounts(fixture)).toHaveLength(2);
  });

  it('names a guest on a row of one with the plain label', async () => {
    const fixture = await render(row([entry({ listId: null })]), {
      lists: new Map(),
    });

    expect(stepperNames(fixture)).toEqual(['basket.entries.boughtPlain']);
  });

  it('names the spinbutton with the label as given, and the buttons after the list', async () => {
    const fixture = await render(row([entry()]));
    const stepper = askAmounts(fixture)[0];

    expect(
      stepper.querySelector('[role="spinbutton"]')?.getAttribute('aria-label')
    ).toBe('basket.entries.boughtLabel');
    expect(buttonNames(fixture)).toEqual(['Compra semanal']);
  });

  it('is not a live region, because the stepper says the amount itself', async () => {
    const fixture = await render(row([entry()]));
    const section = html(fixture).querySelector('section.entries');

    expect(section?.getAttribute('aria-live')).toBeNull();
    expect(section?.getAttribute('role')).toBeNull();
  });

  it('measures each stepper against its list ask, and snaps to it beside 1000 (spec 8)', async () => {
    const fixture = await render({
      ...row([
        entry({ left: 990, asked: 990, unit: 'GRAM' }),
        entry({
          lineId: 'zl-2',
          listId: 'l-basics',
          left: 0,
          bought: 2,
          asked: 0,
          unit: 'GRAM',
        }),
      ]),
      unit: 'GRAM',
    });
    const [first, second] = entrySteppers(fixture);

    expect(first.target()).toBe(990);
    expect(first.snaps()).toEqual([1000, 990]);
    // An ask of 0 is passed too, and the stepper drops a point at 0.
    expect(second.snaps()).toEqual([1000, 0]);
  });

  it('draws the number and no control while the sheet cannot settle', async () => {
    const fixture = await render(row([entry({ bought: 2 })]), {
      buying: false,
    });

    expect(askAmounts(fixture)).toHaveLength(0);
    expect(
      html(fixture).querySelector('.row-number lib-amount-figure .number')
        ?.textContent
    ).toBe('2');
    expect(
      html(fixture).querySelector('.row-number .visually-hidden')?.textContent
    ).toContain('basket.entries.bought');
  });

  it('takes it off a finished trip', async () => {
    const fixture = await render(row([entry()]), { finished: true });

    expect(askAmounts(fixture)).toHaveLength(0);
  });

  it('keeps it on an entry bought outside this shopping list (velista 0142)', async () => {
    const fixture = await render(
      row([
        entry({
          left: 0,
          asked: 0,
          boughtElsewhere: 2,
          state: 'BOUGHT_ELSEWHERE',
        }),
      ])
    );

    expect(askAmounts(fixture)).toHaveLength(1);
    expect(texts(fixture, '.row-where')[0]).toContain(
      'basket.line.alreadyBought'
    );
  });

  it('emits one buy step per press, from what was bought, and leaves the waiting to the sheet', async () => {
    const fixture = await render(row([entry({ left: 1, bought: 1 })]));
    const bought = jest.fn();
    fixture.componentInstance.bought.subscribe(bought);

    plus(askAmounts(fixture)[0], fixture);

    expect(bought).toHaveBeenCalledTimes(1);
    expect(bought).toHaveBeenCalledWith({
      lineId: 'zl-1',
      step: { from: 1, to: 2, repeat: false },
    });
  });

  it("steps each list by its own line's step (velista 0186, decision A)", async () => {
    const weighed = entry({ left: 2000, asked: 2000, unit: 'GRAM', bought: 0 });
    const other = entry({
      lineId: 'zl-2',
      listId: 'l-basics',
      left: 2000,
      asked: 2000,
      unit: 'GRAM',
    });
    const fixture = await render({ ...row([weighed, other]), unit: 'GRAM' });
    fixture.componentRef.setInput('step', 250);
    fixture.componentRef.setInput('steps', new Map([['zl-1', 100]]));
    fixture.detectChanges();
    const bought = jest.fn();
    fixture.componentInstance.bought.subscribe(bought);

    plus(askAmounts(fixture)[0], fixture);
    plus(askAmounts(fixture)[1], fixture);

    expect(bought.mock.calls.map(([call]) => call)).toEqual([
      { lineId: 'zl-1', step: { from: 0, to: 100, repeat: false } },
      { lineId: 'zl-2', step: { from: 0, to: 25, repeat: false } },
    ]);
  });

  it('draws the run the sheet holds open for a line', async () => {
    const fixture = await render(row([entry()]));
    fixture.componentRef.setInput('pending', new Map([['zl-1', 5]]));
    fixture.detectChanges();

    expect(askAmounts(fixture)[0].getAttribute('data-value')).toBe('5');
  });
});

describe('RowEntries: Bought for another list (velista 0201, target state 7)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is not drawn without a read, which is a guest or a row with no product', async () => {
    const fixture = await render(row([entry()]), { others: null });

    expect(disclosure(fixture)).toBeNull();
  });

  it('is not drawn once the read answered no list', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [] },
    });

    expect(disclosure(fixture)).toBeNull();
  });

  it('is not drawn on a finished trip', async () => {
    const fixture = await render(row([entry()]), {
      finished: true,
      others: { state: 'ready', lists: [PANTRY] },
    });

    expect(disclosure(fixture)).toBeNull();
  });

  it('is headed "Bought for another list", closed on every sheet, and opens on a press', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [PANTRY] },
    });

    expect(disclosure(fixture)?.textContent).toContain(
      'basket.entries.otherHeading'
    );
    expect(disclosure(fixture)?.getAttribute('aria-expanded')).toBe('false');
    expect(html(fixture).querySelector('.others')).toBeNull();

    open(fixture);

    expect(disclosure(fixture)?.getAttribute('aria-expanded')).toBe('true');
    expect(html(fixture).querySelector('.others')).not.toBeNull();
  });

  it('draws a loading row while the read is out', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'loading' },
    });
    open(fixture);

    expect(texts(fixture, '.others-note')).toEqual([
      'basket.sheet.othersLoading',
    ]);
  });

  it('draws a failed row with a retry that asks again', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'failed' },
    });
    const retry = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);
    open(fixture);

    expect(texts(fixture, '.others-note')).toEqual([
      'basket.sheet.othersFailed',
    ]);
    html(fixture).querySelector<HTMLButtonElement>('.retry')?.click();

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('draws a list holding the product at zero with its line, and one without it with the zone alone', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [PANTRY, BREAKFAST] },
    });
    open(fixture);

    expect(texts(fixture, '.others .row-name')).toEqual([
      'Despensa',
      'Desayunos',
    ]);
    expect(texts(fixture, '.others .row-where')).toEqual([
      'Casa · Leche',
      'Oficina',
    ]);
  });

  it('starts each stepper at 0, with no target and no snaps input (spec 8)', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [{ ...PANTRY, quantity: 4 }] },
    });
    open(fixture);
    const stepper = fixture.debugElement
      .queryAll(By.directive(QuantityStepper))
      .find((held) => held.nativeElement.closest('.others') !== null)
      ?.componentInstance as QuantityStepper;

    expect(stepper.value()).toBe(0);
    expect(stepper.target()).toBeNull();
    // The default, so only the stop at 1000 applies.
    expect(stepper.snaps()).toEqual([1000]);
  });

  it('emits a buy step per press, starting at 0', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [PANTRY] },
    });
    const boughtOther = jest.fn();
    fixture.componentInstance.boughtOther.subscribe(boughtOther);
    open(fixture);

    const stepper = html(fixture).querySelector<HTMLElement>(
      '.others lib-quantity-stepper'
    );
    plus(stepper as HTMLElement, fixture);
    plus(stepper as HTMLElement, fixture);

    expect(boughtOther).toHaveBeenCalledTimes(2);
    expect(boughtOther).toHaveBeenNthCalledWith(1, {
      list: PANTRY,
      step: { from: 0, to: 1, repeat: false },
    });
  });
});

describe('RowEntries: the reel in the compact view (velista 0204)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function pointer(type: string, clientX: number): Event {
    const event = new MouseEvent(type, { bubbles: true, clientX });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'isPrimary', { value: true });
    Object.defineProperty(event, 'buttons', {
      value: type === 'pointerup' ? 0 : 1,
    });
    return event;
  }

  const entryReels = (fixture: Fixture) =>
    fixture.debugElement
      .queryAll(By.directive(QuantityReel))
      .filter((held) => held.nativeElement.closest('.others') === null);

  const otherReels = (fixture: Fixture) =>
    fixture.debugElement
      .queryAll(By.directive(QuantityReel))
      .filter((held) => held.nativeElement.closest('.others') !== null);

  /** The numbers of an open tape, as `value:status`. */
  const tape = (reel: HTMLElement) =>
    [...reel.querySelectorAll('.overlay > span')].map(
      (part) =>
        `${part.getAttribute('data-reel-value')}:${
          part.classList.contains('reached')
            ? 'reached'
            : part.classList.contains('over')
              ? 'over'
              : 'plain'
        }`
    );

  it('draws a reel for each list and no stepper, and the default view the reverse (spec 1)', async () => {
    const two = row([
      entry(),
      entry({ lineId: 'zl-2', listId: 'l-basics', content: 'Leche' }),
    ]);

    const compact = await render(two, { compact: true });
    expect(entryReels(compact)).toHaveLength(2);
    expect(entrySteppers(compact)).toHaveLength(0);

    const normal = await render(two);
    expect(entryReels(normal)).toHaveLength(0);
    expect(entrySteppers(normal)).toHaveLength(2);
  });

  it('gives each reel the value, unit, step, a floor of 0, the ask as its target and as a snap point', async () => {
    const fixture = await render(
      {
        ...row([entry({ left: 990, asked: 990, bought: 975, unit: 'GRAM' })]),
        unit: 'GRAM',
      },
      { compact: true, step: 25 }
    );

    const reel = entryReels(fixture)[0].componentInstance as QuantityReel;
    expect(reel.value()).toBe(975);
    expect(reel.unit()).toBe('GRAM');
    expect(reel.step()).toBe(25);
    expect(reel.min()).toBe(0);
    expect(reel.target()).toBe(990);
    expect(reel.snaps()).toEqual([...QUANTITY_SNAP_POINTS, 990]);
    expect(reel.label()).toBe('basket.entries.boughtLabel');
  });

  it('spec 4: a drag up from 975 g with an ask of 990 g and a step of 25 shows 990 green, then 1000 amber', async () => {
    const fixture = await render(
      {
        ...row([entry({ left: 990, asked: 990, bought: 975, unit: 'GRAM' })]),
        unit: 'GRAM',
      },
      { compact: true, step: 25 }
    );
    const host = entryReels(fixture)[0].nativeElement as HTMLElement;

    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(pointer('pointermove', -QUANTITY_REEL_PX_PER_UNIT));
    fixture.detectChanges();
    expect(tape(host)).toEqual(['975:plain', '990:reached', '1000:over']);

    host.dispatchEvent(pointer('pointermove', -2 * QUANTITY_REEL_PX_PER_UNIT));
    fixture.detectChanges();
    // Above a kilo the rule of velista 0195 steps by 50.
    expect(tape(host)).toEqual(['990:reached', '1000:over', '1050:over']);
  });

  it('spec 3: a reel closed from 0 at 4 emits one buy step of that line, marked closed', async () => {
    const fixture = await render(row([entry({ left: 3, asked: 3 })]), {
      compact: true,
    });
    const bought = jest.fn();
    fixture.componentInstance.bought.subscribe(bought);
    const host = entryReels(fixture)[0].nativeElement as HTMLElement;

    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(pointer('pointermove', -4 * QUANTITY_REEL_PX_PER_UNIT));
    host.dispatchEvent(pointer('pointerup', -4 * QUANTITY_REEL_PX_PER_UNIT));
    fixture.detectChanges();
    expect(bought).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();

    expect(bought).toHaveBeenCalledTimes(1);
    expect(bought).toHaveBeenCalledWith({
      lineId: 'zl-1',
      step: { from: 0, to: 4, repeat: false },
      closed: true,
    });
  });

  it('closes an open reel on a press anywhere outside it, and sends its step once', async () => {
    const fixture = await render(row([entry({ left: 3, asked: 3 })]), {
      compact: true,
    });
    const bought = jest.fn();
    fixture.componentInstance.bought.subscribe(bought);
    const host = entryReels(fixture)[0].nativeElement as HTMLElement;

    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(pointer('pointermove', -2 * QUANTITY_REEL_PX_PER_UNIT));
    host.dispatchEvent(pointer('pointerup', -2 * QUANTITY_REEL_PX_PER_UNIT));
    // A press inside the reel keeps it open.
    host.dispatchEvent(pointer('pointerdown', -2 * QUANTITY_REEL_PX_PER_UNIT));
    host.dispatchEvent(pointer('pointerup', -2 * QUANTITY_REEL_PX_PER_UNIT));
    expect(bought).not.toHaveBeenCalled();

    document.body.dispatchEvent(pointer('pointerdown', 0));
    expect(bought).toHaveBeenCalledTimes(1);
    expect(bought).toHaveBeenCalledWith({
      lineId: 'zl-1',
      step: { from: 0, to: 2, repeat: false },
      closed: true,
    });

    jest.runOnlyPendingTimers();
    expect(bought).toHaveBeenCalledTimes(1);
  });

  it('draws a reel from 0 for each list under "Bought for another list", with no target and no snaps input', async () => {
    const fixture = await render(row([entry()]), {
      compact: true,
      step: 250,
      others: { state: 'ready', lists: [PANTRY] },
    });
    const boughtOther = jest.fn();
    fixture.componentInstance.boughtOther.subscribe(boughtOther);
    open(fixture);

    const [held] = otherReels(fixture);
    const reel = held.componentInstance as QuantityReel;
    expect(reel.value()).toBe(0);
    expect(reel.min()).toBe(0);
    expect(reel.target()).toBeNull();
    // The default, so only the stop at 1000 applies.
    expect(reel.snaps()).toEqual(QUANTITY_SNAP_POINTS);
    expect(
      html(fixture).querySelector('.others lib-quantity-stepper')
    ).toBeNull();

    const host = held.nativeElement as HTMLElement;
    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(pointer('pointermove', -QUANTITY_REEL_PX_PER_UNIT));
    host.dispatchEvent(pointer('pointerup', -QUANTITY_REEL_PX_PER_UNIT));
    jest.runOnlyPendingTimers();

    expect(boughtOther).toHaveBeenCalledTimes(1);
    expect(boughtOther).toHaveBeenCalledWith({
      list: PANTRY,
      step: { from: 0, to: 1, repeat: false },
      closed: true,
    });
  });
});
