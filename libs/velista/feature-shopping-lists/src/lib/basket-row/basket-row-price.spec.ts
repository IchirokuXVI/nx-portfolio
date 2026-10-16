import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketListRef,
  BasketParticipant,
  BasketProduct,
  BasketRow,
  BasketRowEntry,
  ProductOffer,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketRow as BasketRowComponent } from './basket-row';

/**
 * The name and the caption of a row (velista `0139`, sections 1 and 2; the price
 * of velista `0062`, section 4).
 *
 * A row is one product or none. A product row is named by the product and its
 * caption is the price, then the lists that ask. A row with no product is named
 * by its line, has no price, and its caption is the lists.
 */

function entry(
  lineId: string,
  listId: string | null,
  overrides: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId,
    listId,
    content: 'Leche',
    itemIds: [],
    favoriteItemId: null,
    canWrite: listId !== null,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left: 3,
    bought: 0,
    asked: 3,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    version: 1,
    ...overrides,
  };
}

function line(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 3,
    bought: 0,
    asked: 3,
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    productId: null,
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries: [entry('zl-1', null)],
    ...overrides,
  };
}

const offer = (price: number | null): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice: price,
  unitPriceLabel: 'EUR/L',
  observedAt: new Date('2026-09-01T06:00:00.000Z'),
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId: 'scope-a',
});

const product = (
  id: string,
  offerOf: ProductOffer | null
): [string, BasketProduct] => [
  id,
  {
    id,
    name: { en: 'Whole milk', es: 'Leche entera' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    offer: offerOf,
  } as BasketProduct,
];

const LISTS = new Map<string, BasketListRef>(
  [
    ['l-weekly', 'Weekly shop'],
    ['l-basics', 'Basics'],
    ['l-kitchen', 'Kitchen'],
    ['l-pantry', 'Pantry'],
  ].map(([listId, name]) => [
    listId,
    { listId, name, zoneId: 'z-home', zoneName: 'Home' },
  ])
);

async function render(
  row: BasketRow,
  products: ReadonlyMap<string, BasketProduct>,
  lists: ReadonlyMap<string, BasketListRef> = new Map()
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketRowComponent, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketRowComponent);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('products', products);
  fixture.componentRef.setInput('lists', lists);
  fixture.componentRef.setInput('busy', false);
  fixture.componentRef.setInput('notice', null);
  fixture.detectChanges();

  return fixture;
}

const host = (fixture: Awaited<ReturnType<typeof render>>) =>
  fixture.nativeElement as HTMLElement;

const text = (fixture: Awaited<ReturnType<typeof render>>, selector: string) =>
  host(fixture).querySelector(selector)?.textContent?.trim() ?? null;

/** The pieces of the caption line, in order, without the drawn separators. */
const caption = (fixture: Awaited<ReturnType<typeof render>>) => {
  const line = host(fixture).querySelector('.caption');
  return line === null
    ? null
    : [...line.children].map((piece) => piece.textContent?.trim() ?? '');
};

describe('BasketRowComponent: the name (velista 0139, sections 1 and 2)', () => {
  it('names a product row by the product, then its brand, cut to one line', async () => {
    const fixture = await render(
      line({ productId: 'i-milk' }),
      new Map([product('i-milk', offer(0.95))])
    );

    // The size is absent only because this spec's translator has no words for
    // a unit, and a key never reaches the screen.
    expect(text(fixture, '.content .name')).toBe('Whole milk Hacendado');
    expect(host(fixture).querySelector('.content.is-product')).not.toBeNull();
    expect(
      host(fixture).querySelector('.body')?.getAttribute('aria-label')
    ).toMatch(/^Whole milk Hacendado\./);
  });

  it('names a row with no product by its line, which keeps wrapping', async () => {
    const fixture = await render(line({ productId: null }), new Map());

    expect(text(fixture, '.content .name')).toBe('Milk');
    expect(host(fixture).querySelector('.content.is-product')).toBeNull();
  });

  it('names a row whose product the read could not name by its line', async () => {
    const fixture = await render(line({ productId: 'i-gone' }), new Map());

    expect(text(fixture, '.content .name')).toBe('Milk');
    expect(host(fixture).textContent).not.toContain('0.95');
  });
});

describe('BasketRowComponent: the caption (velista 0139, section 1)', () => {
  it('draws the price, then the list that asks', async () => {
    const fixture = await render(
      line({ productId: 'i-milk', entries: [entry('zl-1', 'l-weekly')] }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );

    expect(caption(fixture)).toEqual(['€0.95', 'Weekly shop']);
  });

  it('names two lists and four lists, each once, with commas', async () => {
    const two = await render(
      line({
        productId: 'i-milk',
        entries: [entry('a', 'l-weekly'), entry('b', 'l-basics')],
      }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );
    expect(caption(two)).toEqual(['€0.95', 'Weekly shop, Basics']);

    const four = await render(
      line({
        productId: 'i-milk',
        entries: [
          entry('a', 'l-weekly'),
          entry('b', 'l-basics'),
          entry('c', 'l-kitchen'),
          entry('d', 'l-weekly'),
          entry('e', 'l-pantry'),
        ],
      }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );
    expect(caption(four)).toEqual([
      '€0.95',
      'Weekly shop, Basics, Kitchen, Pantry',
    ]);
  });

  it('counts a list the reader was not served in words', async () => {
    const fixture = await render(
      line({
        productId: 'i-milk',
        entries: [entry('a', 'l-weekly'), entry('b', null)],
      }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );

    // The testing translator answers the bare key.
    expect(caption(fixture)).toEqual(['€0.95', 'basket.row.listsAndMore']);
  });

  it('says "Another list" to a guest, who is served no list', async () => {
    const fixture = await render(
      line({ productId: 'i-milk', entries: [entry('a', null)] }),
      new Map([product('i-milk', offer(0.95))])
    );

    expect(caption(fixture)).toEqual(['€0.95', 'basket.row.otherLists']);
  });

  it('draws no price and no placeholder when there is none', async () => {
    const unpriced = await render(
      line({ productId: 'i-milk', entries: [entry('a', 'l-weekly')] }),
      new Map([product('i-milk', null)]),
      LISTS
    );
    const priceless = await render(
      line({ productId: 'i-milk', entries: [entry('a', 'l-weekly')] }),
      new Map([product('i-milk', offer(null))]),
      LISTS
    );

    expect(caption(unpriced)).toEqual(['Weekly shop']);
    expect(caption(priceless)).toEqual(['Weekly shop']);
  });

  it('gives a row with no product no price, and the names of its lists', async () => {
    const fixture = await render(
      line({
        productId: null,
        entries: [entry('a', 'l-weekly'), entry('b', 'l-pantry')],
      }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );

    expect(caption(fixture)).toEqual(['Weekly shop, Pantry']);
  });

  it("draws no caption for a guest's row with no product and no list", async () => {
    const fixture = await render(line({ entries: [] }), new Map());

    expect(caption(fixture)).toBeNull();
  });
});

describe('BasketRowComponent: a row bought elsewhere (velista 0142)', () => {
  it('strikes the product name, one line, and draws no price and no control', async () => {
    const fixture = await render(
      line({
        productId: 'i-milk',
        left: 0,
        asked: 0,
        boughtElsewhere: 2,
        state: 'BOUGHT_ELSEWHERE',
        entries: [
          entry('a', 'l-weekly', {
            left: 0,
            asked: 0,
            boughtElsewhere: 2,
            state: 'BOUGHT_ELSEWHERE',
          }),
        ],
      }),
      new Map([product('i-milk', offer(0.95))]),
      LISTS
    );
    expect(text(fixture, '.is-removed .content .name')).toBe(
      'Whole milk Hacendado'
    );
    expect(
      host(fixture).querySelector('.is-removed .content.is-product')
    ).not.toBeNull();
    expect(host(fixture).querySelector('.status')).toBeNull();
    expect(host(fixture).querySelector('lib-quantity-reel')).toBeNull();
    expect(host(fixture).textContent).not.toContain('0.95');
  });
});
