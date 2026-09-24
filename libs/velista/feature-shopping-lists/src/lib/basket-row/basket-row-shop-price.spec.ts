import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketParticipant,
  BasketProduct,
  BasketRow,
  BasketRowMark,
  BasketShelfMark,
  ProductOffer,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketRow as BasketRowComponent } from './basket-row';

/**
 * What a row says once the prices come from one shop (velista `0078`, section 5).
 *
 * The assertions are on the **key**, never on the sentence: the testing translator
 * returns a key without interpolating it, so "1.99 € at Dia" would pass whatever the
 * template did with its arguments.
 *
 * The mark is an **input** here, because the pipeline composes it and this component
 * draws it: what these tests are about is that the row draws the chosen shop's number
 * rather than the cheapest, and that a mark reaches the caption and the accessible
 * name both.
 */

function line(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 3,
    bought: 0,
    asked: 3,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    // The product this row means is the **first of its options**: a row has no
    // `pickId` any more, because that was a column on the line the basket used
    // to store (backend `0136`).
    optionIds: ['i-milk'],
    touchedBy: null,
    touchedAt: null,
    entries: [
      {
        lineId: 'zl-1',
        listId: null,
        left: 3,
        bought: 0,
        asked: 3,
        state: 'WANTED',
        awaitingApproval: false,
        demandEditable: true,
      },
    ],
    ...overrides,
  };
}

const offer = (priceScopeId: string, price: number): ProductOffer => ({
  price,
  currency: 'EUR',
  unitPrice: null,
  unitPriceLabel: null,
  observedAt: null,
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
  priceScopeId,
});

/**
 * Milk, listed at Mercadona for 0.95 and at Dia for 0.79, and read at a Mercadona
 * whose own stack prices it at 0.95 (velista `0102`: the server decides).
 */
const MILK: BasketProduct = {
  id: 'i-milk',
  name: { en: 'Milk', es: 'Leche' },
  brand: null,
  size: null,
  unit: null,
  offer: offer('s-dia', 0.79),
  offers: [offer('s-dia', 0.79), offer('s-merca', 0.95)],
  atShop: {
    priceScopeId: 's-merca',
    price: 0.95,
    currency: 'EUR',
    available: null,
  },
  categories: ['DAIRY'],
};

/** The same product with no price at the shop: what an "unlisted" mark is about. */
const DIA_ONLY: BasketProduct = {
  ...MILK,
  offers: [offer('s-dia', 0.79)],
  atShop: { priceScopeId: null, price: null, currency: null, available: null },
};

/** Oat milk, a second option, for the row that offers it instead. */
const OAT: BasketProduct = {
  ...MILK,
  id: 'i-oat',
  name: { en: 'Oat drink', es: 'Bebida de avena' },
};

async function render(options: {
  readonly atShop?: boolean;
  readonly mark?: BasketRowMark | null;
  readonly product?: BasketProduct;
  readonly shelf?: BasketShelfMark | null;
  readonly row?: BasketRow;
  readonly chosenId?: string | null;
}) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketRowComponent, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketRowComponent);
  fixture.componentRef.setInput('row', line());
  fixture.componentRef.setInput('people', new Map<string, BasketParticipant>());
  fixture.componentRef.setInput('row', options.row ?? line());
  fixture.componentRef.setInput(
    'products',
    new Map([
      ['i-milk', options.product ?? MILK],
      ['i-oat', OAT],
    ])
  );
  fixture.componentRef.setInput('lists', new Map());
  fixture.componentRef.setInput('atShop', options.atShop ?? false);
  fixture.componentRef.setInput('priceMark', options.mark ?? null);
  fixture.componentRef.setInput('shelf', options.shelf ?? null);
  fixture.componentRef.setInput('chosenId', options.chosenId ?? null);
  fixture.detectChanges();

  return fixture;
}

const caption = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.product')
    ?.textContent?.trim() ?? '';

const rowLabel = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('.body')
    ?.getAttribute('aria-label') ?? '';

describe('BasketRowComponent: prices from one shop', () => {
  it('draws the cheapest anywhere when no shop is in use', async () => {
    const fixture = await render({ atShop: false });

    expect(caption(fixture)).toBe('Milk · €0.79');
  });

  it('draws the chosen shop’s own price instead', async () => {
    const fixture = await render({ atShop: true });

    // Not 0.79. Quoting Dia's number under a heading that says Mercadona is the
    // defect this whole plan exists to remove.
    expect(caption(fixture)).toBe('Milk · €0.95');
  });

  it('says where it is cheaper, after the price', async () => {
    const fixture = await render({
      atShop: true,
      mark: { kind: 'cheaper', price: 0.79, currency: 'EUR', chain: 'Dia' },
    });

    expect(caption(fixture)).toBe('Milk · €0.95 · basket.price.cheaperAt');
    // The colour is never the only carrier: the sentence is in the accessible
    // name too (section 7).
    expect(rowLabel(fixture)).toContain('basket.price.cheaperAt');
  });

  it('says the shop does not list it, and where it is sold', async () => {
    const fixture = await render({
      atShop: true,
      // The product the mark is about: unlisted at Mercadona means there is no
      // Mercadona offer to draw, which is why the caption carries no number here.
      product: DIA_ONLY,
      mark: {
        kind: 'unlisted',
        chain: 'Mercadona',
        elsewhere: { price: 0.79, currency: 'EUR', chain: 'Dia' },
      },
    });

    // No price of its own, because there is none here: the two clauses are one
    // string, so a line break cannot fall between a price and its shop.
    expect(caption(fixture)).toBe(
      'Milk · basket.price.notListedAt · basket.price.cheaperAt'
    );
  });

  it('says only that it is unlisted when nobody else sells it either', async () => {
    const fixture = await render({
      atShop: true,
      product: DIA_ONLY,
      mark: { kind: 'unlisted', chain: 'Mercadona', elsewhere: null },
    });

    expect(caption(fixture)).toBe('Milk · basket.price.notListedAt');
  });

  /**
   * A shop that carries the product with no number on it is listed and unpriced,
   * which reads as the same blank a product nobody has priced leaves: the row has no
   * room to say "listed, price unknown", and the pick sheet is where that
   * distinction is drawn (`0062`, section 5.3).
   */
  it('draws no price for a shop that carries the product without one', async () => {
    const fixture = await render({
      atShop: true,
      product: {
        ...MILK,
        offers: [{ ...offer('s-merca', 0), price: null }],
        atShop: {
          priceScopeId: null,
          price: null,
          currency: null,
          available: true,
        },
      },
    });

    expect(caption(fixture)).toBe('Milk');
  });

  /** The settle controls never leave a row, listed or not (section 5). */
  it('keeps the status control and the reel on a line the shop does not list', async () => {
    const fixture = await render({
      atShop: true,
      mark: { kind: 'unlisted', chain: 'Mercadona', elsewhere: null },
    });

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('button.status')).not.toBeNull();
    expect(element.querySelector('lib-quantity-reel')).not.toBeNull();
  });
});

/**
 * What the shop's shelf says (velista `0102`). A mark and never a move: the row
 * keeps its controls and its number, and the words say it, never the colour alone.
 */
describe('BasketRowComponent: what the shop does not have', () => {
  const shelf = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector('.shelf')
      ?.textContent?.trim() ?? null;

  it('says it is not available at this shop, in words and to a screen reader', async () => {
    const fixture = await render({
      atShop: true,
      shelf: { kind: 'unavailable' },
    });

    expect(shelf(fixture)).toBe('basket.shelf.unavailable');
    expect(rowLabel(fixture)).toContain('basket.shelf.unavailable');
    // Still a line to buy: the shelf may be restocked.
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('button.status')).not.toBeNull();
    expect(element.querySelector('lib-quantity-reel')).not.toBeNull();
  });

  it('draws the option it offers instead, and says what it replaced', async () => {
    const fixture = await render({
      atShop: true,
      row: line({ optionIds: ['i-milk', 'i-oat'] }),
      shelf: { kind: 'instead', optionId: 'i-oat', replacedId: 'i-milk' },
      chosenId: 'i-oat',
    });

    expect(caption(fixture)).toBe('Oat drink · €0.95');
    expect(shelf(fixture)).toBe('basket.shelf.instead');
  });

  it('says nothing about a replacement somebody chose against', async () => {
    const fixture = await render({
      atShop: true,
      row: line({ optionIds: ['i-milk', 'i-oat'] }),
      shelf: { kind: 'instead', optionId: 'i-oat', replacedId: 'i-milk' },
      chosenId: 'i-milk',
    });

    expect(shelf(fixture)).toBeNull();
  });

  it('draws no shelf line on a row the shop said nothing about', async () => {
    const fixture = await render({ atShop: true });

    expect(shelf(fixture)).toBeNull();
  });
});
