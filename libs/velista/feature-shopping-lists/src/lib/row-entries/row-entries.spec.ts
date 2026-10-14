import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  QUANTITY_REEL_IDLE_MS,
  type BasketListRef,
  type BasketProductList,
  type BasketRow,
  type BasketRowEntry,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { RowEntries, type OtherListsState } from './row-entries';

/**
 * The lists that ask for a row, and the lists that could (velista `0139`,
 * section 3).
 *
 * An entry is its list, then "zone · line", then the quantity the list asks for,
 * which is the reel where the server allows it and the number where it does not.
 * "Add it to another list" is last and closed, and is drawn only when the sheet
 * hands it a read.
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
    others?: OtherListsState | null;
    changeable?: ReadonlySet<string>;
  } = {}
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [RowEntries, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RowEntries);
  fixture.componentRef.setInput('row', held);
  fixture.componentRef.setInput('lists', options.lists ?? LISTS);
  fixture.componentRef.setInput('finished', options.finished ?? false);
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('others', options.others ?? null);
  fixture.componentRef.setInput('changeable', options.changeable ?? new Set());
  fixture.detectChanges();

  return fixture;
}

type Fixture = Awaited<ReturnType<typeof render>>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const askReels = (fixture: Fixture) => [
  ...html(fixture).querySelectorAll<HTMLElement>('.entries > .rows .ask-reel'),
];

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

/**
 * The keyboard half of the reel, which is a real path and the one a spec can
 * drive: jsdom has no `PointerEvent`, and the keys move the same pending value
 * and commit on the same idle beat.
 */
function key(reel: HTMLElement, fixture: Fixture, name: string): void {
  reel.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true })
  );
  fixture.detectChanges();
}

function letGo(fixture: Fixture): void {
  jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
  fixture.detectChanges();
}

describe('RowEntries: the lists that ask', () => {
  it('heads them with how many lists ask, and draws one row each', async () => {
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

    expect(texts(fixture, '.heading')).toEqual(['basket.sheet.askedOn']);
    expect(texts(fixture, '.entries > .rows .row-name')).toEqual([
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

    expect(texts(fixture, '.entries > .rows .row-name')).toEqual([
      'Compra semanal',
      'basket.entries.otherList',
    ]);
    expect(texts(fixture, '.row-where')).toHaveLength(1);
  });
});

describe('RowEntries: Change (velista 0140, section 1)', () => {
  const two = () =>
    row([
      entry(),
      entry({ lineId: 'zl-2', listId: 'l-basics', content: 'Leche' }),
    ]);

  it('draws Change before the quantity on the entries the sheet allows', async () => {
    const fixture = await render(two(), { changeable: new Set(['zl-2']) });

    const rows = [...html(fixture).querySelectorAll('.entries > .rows .row')];
    expect(rows.map((held) => held.querySelector('.change') !== null)).toEqual([
      false,
      true,
    ]);
    // The list, Change, the quantity.
    const change = rows[1].querySelector('.change');
    expect(change?.nextElementSibling?.classList.contains('ask-reel')).toBe(
      true
    );
    expect(change?.getAttribute('aria-label')).toBe('basket.change.oneLabel');
  });

  it('says which line was pressed', async () => {
    const fixture = await render(two(), { changeable: new Set(['zl-1']) });
    const changed: string[] = [];
    fixture.componentInstance.changed.subscribe((lineId) =>
      changed.push(lineId)
    );

    html(fixture).querySelector<HTMLButtonElement>('.change')?.click();

    expect(changed).toEqual(['zl-1']);
  });

  it('draws no "Change for all lists" with one such entry', async () => {
    const fixture = await render(two(), { changeable: new Set(['zl-1']) });

    expect(html(fixture).querySelector('.change-all')).toBeNull();
  });

  it('draws "Change for all lists" in the heading row with two such entries', async () => {
    const fixture = await render(two(), {
      changeable: new Set(['zl-1', 'zl-2']),
    });
    let all = 0;
    fixture.componentInstance.changedAll.subscribe(() => (all += 1));

    const button =
      html(fixture).querySelector<HTMLButtonElement>('.head .change-all');
    button?.click();

    expect(button?.textContent).toContain('basket.change.all');
    expect(all).toBe(1);
  });

  it('draws no Change at all when the sheet allows none', async () => {
    const fixture = await render(two());

    expect(html(fixture).querySelector('.change')).toBeNull();
    expect(html(fixture).querySelector('.change-all')).toBeNull();
  });
});

describe('RowEntries: who may change what a list asks for', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('draws the reel when the server says the owner may, on a served list', async () => {
    const fixture = await render(row([entry()]));

    expect(askReels(fixture)).toHaveLength(1);
    expect(askReels(fixture)[0].getAttribute('aria-label')).toContain(
      'basket.demand.askLabel'
    );
  });

  it('draws the number and no control when the server says the owner may not', async () => {
    const fixture = await render(row([entry({ demandEditable: false })]));

    expect(askReels(fixture)).toHaveLength(0);
    expect(html(fixture).querySelector('.row-number')?.textContent).toContain(
      '2'
    );
  });

  it('draws no control on an unserved entry of a row of several lists', async () => {
    const fixture = await render(
      row([entry(), entry({ lineId: 'zl-2', listId: null })])
    );

    expect(askReels(fixture)).toHaveLength(1);
    expect(html(fixture).querySelectorAll('.row-number')).toHaveLength(1);
  });

  it('draws it for a guest on a row with one entry, which is all a guest may change', async () => {
    const fixture = await render(row([entry({ listId: null })]), {
      lists: new Map(),
    });

    expect(askReels(fixture)).toHaveLength(1);
    expect(askReels(fixture)[0].getAttribute('aria-label')).toBe(
      'basket.demand.label'
    );
  });

  it('takes it off a finished trip', async () => {
    const fixture = await render(row([entry()]), { finished: true });

    expect(askReels(fixture)).toHaveLength(0);
  });

  it('keeps it on an entry bought outside this shopping list, at 0 and already bought (velista 0142)', async () => {
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

    expect(askReels(fixture)).toHaveLength(1);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.row-where')
        ?.textContent
    ).toContain('basket.line.alreadyBought');
  });

  it('says nothing about a buy on an entry that still asks', async () => {
    const fixture = await render(row([entry()]));

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'basket.line.alreadyBought'
    );
  });

  it('sends one demand, with where it started and where it landed', async () => {
    const fixture = await render(row([entry()]));
    const demanded = jest.fn();
    fixture.componentInstance.demanded.subscribe(demanded);

    key(askReels(fixture)[0], fixture, 'ArrowUp');
    expect(demanded).not.toHaveBeenCalled();
    letGo(fixture);

    expect(demanded).toHaveBeenCalledWith({ lineId: 'zl-1', from: 2, to: 3 });
  });
});

describe('RowEntries: Add it to another list', () => {
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

  it('is closed on every sheet, and opens on a press', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [PANTRY] },
    });

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
    expect(html(fixture).querySelectorAll('.others .ask-reel')).toHaveLength(2);
  });

  it('raises a list with the quantity it was given', async () => {
    const fixture = await render(row([entry()]), {
      others: { state: 'ready', lists: [PANTRY] },
    });
    const raised = jest.fn();
    fixture.componentInstance.raised.subscribe(raised);
    open(fixture);

    const reel = html(fixture).querySelector<HTMLElement>('.others .ask-reel');
    key(reel as HTMLElement, fixture, 'ArrowUp');
    letGo(fixture);

    expect(raised).toHaveBeenCalledWith({ list: PANTRY, to: 1 });
  });
});
