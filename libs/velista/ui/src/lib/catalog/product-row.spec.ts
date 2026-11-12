import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogProduct,
  HoldingRow,
  ProductOffer,
  QuantityStep,
} from '@portfolio/velista/models';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ProductRow,
  type ProductRowAdd,
  type ProductRowGroup,
  type ProductRowLineStep,
  type ProductRowShop,
  type ProductRowView,
} from './product-row';
import { productRowView, type ProductRowOptions } from './product-row-view';

/** Echoes the key and its arguments, so a spec can see which sentence was chosen. */
function translate(key: string, args?: Record<string, unknown>): string {
  return args === undefined ? key : `${key} ${JSON.stringify(args)}`;
}

const OFFER: ProductOffer = {
  price: 8.45,
  currency: 'EUR',
  unitPrice: 8.45,
  unitPriceLabel: 'EUR/L',
  comparablePrice: null,
  comparableBasis: null,
  observedAt: new Date('2026-09-20T10:00:00.000Z'),
  sourceKind: 'OFFICIAL_API',
  stale: false,
  priceScopeId: 'scope-m',
  piecePrice: null,
};

const OIL: CatalogProduct = {
  id: 'item-oil',
  name: { es: 'Aceite de oliva virgen extra', en: 'Extra virgin olive oil' },
  brand: 'Hacendado',
  imageUrl: null,
  size: 1,
  unit: 'LITER',
  categories: [
    {
      id: 'cat-oils',
      parentId: 'cat-oils-sauces-and-spices',
      slug: 'oils',
      name: { en: 'Oils', es: 'Aceites' },
    },
  ],
  offer: OFFER,
  unitBasis: 'LITER',
  approxWeight: null,
};

function options(
  overrides: Partial<ProductRowOptions> = {}
): ProductRowOptions {
  return {
    locale: 'en',
    translate,
    chainOf: (scope) => (scope === 'scope-m' ? 'Mercadona' : null),
    chainChosen: false,
    ...overrides,
  };
}

describe('productRowView', () => {
  it('draws the price with the chain that charges it', () => {
    const view = productRowView(OIL, options());

    expect(view.name).toBe('Extra virgin olive oil');
    expect(view.detail).toBe('Hacendado · list.add.size.LITER {"size":"1"}');
    expect(view.price).toEqual({ amount: '€8.45', per: null });
    expect(view.chains).toEqual({
      lead: 'Mercadona',
      marks: [{ id: 'scope-m', initial: 'M' }],
      more: 0,
      label: 'list.add.card.soldAt {"chain":"Mercadona"}',
    });
    expect(view.stale).toBe(false);
    expect(view.caption).toBeNull();
  });

  it('leaves the chain line out while one chain is chosen, where every card would name it', () => {
    const view = productRowView(OIL, options({ chainChosen: true }));

    expect(view.price).toEqual({ amount: '€8.45', per: null });
    expect(view.chains).toBeNull();
  });

  describe('the price per litre or kilo (velista 0101, rule 5)', () => {
    it('is drawn when it differs from the price', () => {
      const view = productRowView(
        { ...OIL, size: 0.75, offer: { ...OFFER, price: 6.34 } },
        options()
      );

      expect(view.unitPrice).toEqual({
        amount: '€8.45',
        per: 'catalog.per.LITER',
      });
    });

    it('is not drawn when it is the same number, a one litre bottle', () => {
      expect(productRowView(OIL, options()).unitPrice).toBeNull();
    });

    it('is not drawn without a basis to name, rather than guessing one', () => {
      const view = productRowView(
        { ...OIL, offer: { ...OFFER, price: 6.34 }, unitBasis: null },
        options()
      );

      expect(view.unitPrice).toBeNull();
    });
  });

  describe('under the unit price order, the figure that placed the row (velista 0181)', () => {
    const comparable = options({ unitPriceFigure: 'comparable' });
    const LIDL: CatalogProduct = {
      ...OIL,
      size: 0.5,
      unit: 'KILOGRAM',
      unitBasis: null,
      offer: {
        ...OFFER,
        price: 0.99,
        unitPrice: null,
        unitPriceLabel: null,
        comparablePrice: 1.98,
        comparableBasis: 'KILOGRAM',
      },
    };

    it('prints the pair of a LIDL offer, whose chain printed no unit price', () => {
      expect(productRowView(LIDL, comparable).unitPrice).toEqual({
        amount: '€1.98',
        per: 'catalog.per.KILOGRAM',
      });
    });

    it('prints no unit price line for the same offer under another order', () => {
      expect(productRowView(LIDL, options()).unitPrice).toBeNull();
    });

    it('prints the pair of a Mercadona offer and not the chain figure', () => {
      const view = productRowView(
        {
          ...OIL,
          size: 0.75,
          offer: {
            ...OFFER,
            price: 6.34,
            unitPrice: 8.4,
            comparablePrice: 8.45,
            comparableBasis: 'LITER',
          },
        },
        comparable
      );

      expect(view.unitPrice).toEqual({
        amount: '€8.45',
        per: 'catalog.per.LITER',
      });
    });

    it('prints the pair of a stale offer too, and keeps its age', () => {
      const stale: CatalogProduct = {
        ...LIDL,
        offer: { ...LIDL.offer!, stale: true },
      };
      const view = productRowView(stale, {
        ...comparable,
        now: new Date('2026-10-08T10:00:00.000Z'),
      });

      expect(view.stale).toBe(true);
      expect(view.unitPrice).toEqual({
        amount: '€1.98',
        per: 'catalog.per.KILOGRAM',
      });
      expect(view.seen).toBe('18 days ago');
    });

    it('still says only the age of a stale offer under another order', () => {
      const view = productRowView(
        { ...LIDL, offer: { ...LIDL.offer!, stale: true } },
        options({ now: new Date('2026-10-08T10:00:00.000Z') })
      );

      expect(view.unitPrice).toBeNull();
      expect(view.seen).toBe('18 days ago');
    });

    it('prints nothing for an offer with no pair', () => {
      expect(
        productRowView({ ...OIL, size: 0.75 }, comparable).unitPrice
      ).toBeNull();
    });

    it('prints nothing that repeats the headline of a product sold by the kilo', () => {
      const view = productRowView(
        {
          ...OIL,
          size: null,
          unit: 'KILOGRAM',
          unitBasis: 'KILOGRAM',
          offer: {
            ...OFFER,
            price: 2.49,
            unitPrice: 2.49,
            comparablePrice: 2.49,
            comparableBasis: 'KILOGRAM',
          },
        },
        comparable
      );

      expect(view.price?.per).toBe('catalog.per.KILOGRAM');
      expect(view.unitPrice).toBeNull();
    });
  });

  it('says no price in words, and draws neither a price nor a chain', () => {
    const view = productRowView(
      { ...OIL, offer: null, unitBasis: null },
      options()
    );

    expect(view.price).toBeNull();
    expect(view.unitPrice).toBeNull();
    expect(view.chains).toBeNull();
    expect(view.label).toContain('catalog.row.noPrice');
  });

  it('keeps a stale price, marks it stale, and says how old it is in place of the unit price', () => {
    const view = productRowView(
      { ...OIL, offer: { ...OFFER, stale: true, price: 6.34 } },
      options({ now: new Date('2026-10-08T10:00:00.000Z') })
    );

    expect(view.price).toEqual({ amount: '€6.34', per: null });
    expect(view.stale).toBe(true);
    expect(view.seen).toBe('18 days ago');
    expect(view.unitPrice).toBeNull();
  });

  describe('a piece whose weight varies (velista 0179)', () => {
    /** The weight in the words the app ships, every other key echoed. */
    function weighed(key: string, args?: Record<string, unknown>): string {
      const size = String(args?.['size'] ?? '');
      switch (key) {
        case 'list.add.weight.KILOGRAM':
          return `~${size}\u00a0kg`;
        case 'list.add.weight.GRAM':
          return `~${size}\u00a0g`;
        default:
          return translate(key, args);
      }
    }

    const CHEESE_OFFER: ProductOffer = {
      ...OFFER,
      price: 13.42,
      unitPrice: 13.42,
      unitPriceLabel: 'EUR/kg',
      comparablePrice: null,
      comparableBasis: null,
      piecePrice: 20.94,
    };

    const CHEESE: CatalogProduct = {
      ...OIL,
      id: 'item-cheese',
      name: { es: 'Queso curado', en: 'Cured cheese' },
      brand: null,
      size: null,
      unit: 'KILOGRAM',
      approxWeight: 1560,
      offer: CHEESE_OFFER,
      unitBasis: 'KILOGRAM',
    };

    it('draws the weight, the piece price and the price per kilo of a kilo piece', () => {
      const es = productRowView(
        CHEESE,
        options({ locale: 'es', translate: weighed })
      );
      expect(es.detail).toBe('~1,56\u00a0kg');
      expect(es.price).toEqual({ amount: '20,94\u00a0€', per: null });
      expect(es.unitPrice).toEqual({
        amount: '13,42\u00a0€',
        per: 'catalog.per.KILOGRAM',
      });

      const en = productRowView(CHEESE, options({ translate: weighed }));
      expect(en.detail).toBe('~1.56\u00a0kg');
      expect(en.price).toEqual({ amount: '€20.94', per: null });
      expect(en.unitPrice).toEqual({
        amount: '€13.42',
        per: 'catalog.per.KILOGRAM',
      });
      // What a kilo costs is in the name too, so a screen reader hears both
      // numbers the card draws.
      expect(en.label).toBe(
        'Cured cheese, ~1.56\u00a0kg, €20.94, €13.42 catalog.per.KILOGRAM'
      );
    });

    it('says the weight of a piece under a kilo in grams', () => {
      const view = productRowView(
        { ...CHEESE, approxWeight: 395 },
        options({ locale: 'es', translate: weighed })
      );
      expect(view.detail).toBe('~395\u00a0g');
    });

    it('still draws the price per kilo of a piece of exactly a kilo', () => {
      const view = productRowView(
        {
          ...CHEESE,
          approxWeight: 1000,
          offer: { ...CHEESE_OFFER, price: 10, unitPrice: 10, piecePrice: 10 },
        },
        options({ translate: weighed })
      );
      expect(view.detail).toBe('~1\u00a0kg');
      expect(view.price).toEqual({ amount: '€10.00', per: null });
      expect(view.unitPrice).toEqual({
        amount: '€10.00',
        per: 'catalog.per.KILOGRAM',
      });
    });

    it('says no price for a kilo piece with a price and no piece price', () => {
      const view = productRowView(
        { ...CHEESE, offer: { ...CHEESE_OFFER, piecePrice: null } },
        options({ translate: weighed })
      );
      expect(view.price).toBeNull();
      expect(view.label).toContain('catalog.row.noPrice');
    });

    it('draws a product sold by the kilo with its "/ kg" and no unit price line', () => {
      const view = productRowView(
        {
          ...CHEESE,
          approxWeight: null,
          offer: { ...CHEESE_OFFER, piecePrice: null },
        },
        options({ locale: 'es', translate: weighed })
      );
      expect(view.detail).toBeNull();
      expect(view.price).toEqual({
        amount: '13,42\u00a0€',
        per: 'catalog.per.KILOGRAM',
      });
      expect(view.unitPrice).toBeNull();
      expect(view.label).toContain('13,42\u00a0€ catalog.per.KILOGRAM');
    });

    it('draws a piece priced as one as a pack, with its weight', () => {
      const view = productRowView(
        {
          ...CHEESE,
          unit: 'UNIT',
          approxWeight: 580,
          offer: { ...OFFER, price: 6.5, unitPrice: 6.5, piecePrice: null },
          unitBasis: 'UNIT',
        },
        options({ locale: 'es', translate: weighed })
      );
      expect(view.detail).toBe('~580\u00a0g');
      expect(view.price).toEqual({ amount: '6,50\u00a0€', per: null });
      expect(view.unitPrice).toBeNull();
    });

    it('leaves the one litre bottle as it was', () => {
      const view = productRowView(OIL, options({ translate: weighed }));
      expect(view.price).toEqual({ amount: '€8.45', per: null });
      expect(view.unitPrice).toBeNull();
    });
  });

  it('puts the pack after the brand and the size (velista 0162)', () => {
    const view = productRowView({ ...OIL, packCount: 4 }, options());

    expect(view.detail).toBe(
      'Hacendado · list.add.size.LITER {"size":"1"} · list.add.card.pack {"count":4}'
    );
  });

  it('names the product, then the size, then the price', () => {
    const view = productRowView(OIL, options());

    expect(view.label).toBe(
      'Extra virgin olive oil, list.add.size.LITER {"size":"1"}, €8.45'
    );
  });

  it('names a product that has only a Spanish name for an English reader', () => {
    // Harvested products carry Spanish only, and a blank name is not a row.
    const view = productRowView(
      { ...OIL, name: { es: 'Arroz redondo', en: '' } },
      options()
    );

    expect(view.name).toBe('Arroz redondo');
  });

  it('says nothing about a count of one, which every product is', () => {
    const view = productRowView(
      { ...OIL, brand: null, size: 1, unit: 'UNIT' },
      options()
    );

    expect(view.detail).toBeNull();
  });

  describe('summary, the detail line in the sheet of what a visit added', () => {
    it('says the price with the chain that charges it', () => {
      const view = productRowView(OIL, options());

      expect(view.summary).toBe(
        'Hacendado · list.add.size.LITER {"size":"1"} · ' +
          'catalog.row.priceAt {"price":"€8.45","chain":"Mercadona"}'
      );
    });

    it('says the price alone while one chain is chosen', () => {
      const view = productRowView(OIL, options({ chainChosen: true }));

      expect(view.summary).toBe(
        'Hacendado · list.add.size.LITER {"size":"1"} · €8.45'
      );
    });

    it('says the price alone when the read did not resolve the chain', () => {
      const view = productRowView(OIL, options({ chainOf: () => null }));

      expect(view.summary).toBe(
        'Hacendado · list.add.size.LITER {"size":"1"} · €8.45'
      );
    });

    it('is the detail alone with no price', () => {
      const view = productRowView(
        { ...OIL, offer: null, unitBasis: null },
        options()
      );

      expect(view.summary).toBe(view.detail);
      expect(view.summary).toBe('Hacendado · list.add.size.LITER {"size":"1"}');
    });

    it('is the price alone with no detail', () => {
      const view = productRowView(
        { ...OIL, brand: null, size: 1, unit: 'UNIT' },
        options({ chainChosen: true })
      );

      expect(view.summary).toBe('€8.45');
    });

    it('is null with neither a detail nor a price', () => {
      const view = productRowView(
        {
          ...OIL,
          brand: null,
          size: 1,
          unit: 'UNIT',
          offer: null,
          unitBasis: null,
        },
        options()
      );

      expect(view.summary).toBeNull();
    });
  });
});

describe('ProductRow', () => {
  /** Every translator call of the render, to read the values a name was given. */
  let asked: jest.SpyInstance;

  async function render(
    row: ProductRowView,
    add: ProductRowAdd | null = null
  ): Promise<ComponentFixture<ProductRow>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductRow, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();
    asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

    const fixture = TestBed.createComponent(ProductRow);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('add', add);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function host(fixture: ComponentFixture<ProductRow>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  describe('in the catalog that chooses (velista 0140)', () => {
    async function choosing(checked: boolean) {
      const fixture = await render(productRowView(OIL, options()));
      fixture.componentRef.setInput('choice', { name: 'pick', checked });
      fixture.detectChanges();
      return fixture;
    }

    it('is a radio named for the product, with no button that opens it and no plus', async () => {
      const fixture = await choosing(false);

      const radio = host(fixture).querySelector<HTMLInputElement>('input.pick');
      expect(radio?.type).toBe('radio');
      expect(radio?.name).toBe('pick');
      expect(radio?.getAttribute('aria-label')).toContain('€8.45');
      expect(host(fixture).querySelectorAll('button')).toHaveLength(0);
      expect(host(fixture).querySelector('label.open .name')?.textContent).toBe(
        OIL.name.en
      );
    });

    it('says it was chosen and opens nothing', async () => {
      const fixture = await choosing(false);
      const chosen: string[] = [];
      const opened: string[] = [];
      fixture.componentInstance.chosen.subscribe((id) => chosen.push(id));
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      host(fixture).querySelector<HTMLInputElement>('input.pick')?.click();

      expect(chosen).toEqual([OIL.id]);
      expect(opened).toEqual([]);
    });

    it('marks the chosen card with a class hook and checks its radio', async () => {
      const fixture = await choosing(true);

      expect(host(fixture).querySelector('.row.is-chosen')).not.toBeNull();
      expect(
        host(fixture).querySelector<HTMLInputElement>('input.pick')?.checked
      ).toBe(true);
    });
  });

  it('is one button named for the product, the size and the price', async () => {
    const fixture = await render(productRowView(OIL, options()));

    const buttons = host(fixture).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toContain('€8.45');
  });

  it('draws the name, the detail and the chain line as text in one chain’s case', async () => {
    const fixture = await render(productRowView(OIL, options()));

    const open = host(fixture).querySelector('button.open');
    expect(open?.querySelector('.name')?.textContent?.trim()).toBe(
      'Extra virgin olive oil'
    );
    expect(open?.querySelector('.detail')?.textContent).toContain('Hacendado');
    const chains = open?.querySelector('.chains');
    expect(chains?.tagName).toBe('SPAN');
    expect(chains?.querySelector('.mark')?.textContent).toBe('M');
    expect(chains?.querySelector('.lead')?.textContent).toBe('Mercadona');
    expect(host(fixture).querySelector('.chains-press')).toBeNull();
  });

  it('draws the price per litre under the price when it differs, and nothing when it does not', async () => {
    const differs = await render(
      productRowView(
        { ...OIL, size: 0.75, offer: { ...OFFER, price: 6.34 } },
        options()
      )
    );
    expect(host(differs).querySelector('.price .unit')?.textContent).toContain(
      'catalog.per.LITER'
    );

    const same = await render(productRowView(OIL, options()));
    expect(host(same).querySelector('.price .unit')).toBeNull();
  });

  it('writes no price as words rather than a dash', async () => {
    const fixture = await render(
      productRowView({ ...OIL, offer: null, unitBasis: null }, options())
    );

    expect(host(fixture).querySelector('.amount')).toBeNull();
    expect(host(fixture).querySelector('.no-price')?.textContent).toContain(
      'catalog.row.noPrice'
    );
  });

  it('draws a stale price muted, with its age beside a clock and no badge', async () => {
    const fixture = await render(
      productRowView(
        { ...OIL, offer: { ...OFFER, stale: true } },
        options({ now: new Date('2026-10-08T10:00:00.000Z') })
      )
    );

    const price = host(fixture).querySelector('.price');
    expect(price?.classList.contains('is-stale')).toBe(true);
    const seen = price?.querySelector('.seen');
    expect(seen?.textContent).toContain('18 days ago');
    expect(seen?.querySelector('lib-clock-icon')).not.toBeNull();
    expect(price?.children).toHaveLength(2);
  });

  it('draws the comparable figure of a stale price, with its age under it', async () => {
    const fixture = await render(
      productRowView(
        {
          ...OIL,
          size: 0.75,
          offer: {
            ...OFFER,
            stale: true,
            price: 6.34,
            comparablePrice: 8.45,
            comparableBasis: 'LITER',
          },
        },
        options({
          now: new Date('2026-10-08T10:00:00.000Z'),
          unitPriceFigure: 'comparable',
        })
      )
    );

    const price = host(fixture).querySelector('.price');
    const lines = Array.from(price?.querySelectorAll('.unit') ?? []);
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('€8.45');
    expect(lines[1].classList.contains('seen')).toBe(true);
    expect(lines[1].textContent).toContain('18 days ago');
  });

  it('draws the carton when there is no picture, and the picture when there is', async () => {
    const without = await render(productRowView(OIL, options()));
    expect(host(without).querySelector('lib-product-icon')).not.toBeNull();

    const withImage = await render(
      productRowView(
        { ...OIL, imageUrl: 'https://img.test/oil.png' },
        options()
      )
    );
    expect(host(withImage).querySelector('img')?.getAttribute('src')).toBe(
      'https://img.test/oil.png'
    );
  });

  it('opens the photo large on a press on it, and not the product', async () => {
    const fixture = await render(
      productRowView(
        { ...OIL, imageUrl: 'https://img.test/oil.png' },
        options()
      )
    );
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    // A button in a button is no control at all, so the photo is beside it.
    expect(host(fixture).querySelector('.open lib-product-picture')).toBeNull();
    const zoom = host(fixture).querySelector<HTMLElement>(
      '.cell > lib-product-picture button.zoom'
    );
    expect(zoom).not.toBeNull();

    zoom?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(opened).toEqual([]);
    expect(host(fixture).querySelector('dialog img')?.getAttribute('alt')).toBe(
      OIL.name.en
    );
  });

  it('says which product was pressed', async () => {
    const fixture = await render(productRowView(OIL, options()));
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    host(fixture).querySelector('button')?.click();

    expect(opened).toEqual(['item-oil']);
  });

  /**
   * The plus (velista `0134`, section 4.1): a sibling of the product button that
   * adds one, and stays a plus. Under the row sit the lines of the chosen list
   * that hold the product, each with its name and its own stepper.
   */
  describe('the plus', () => {
    const LIST = 'Weekly shop';

    function held(overrides: Partial<HoldingRow> = {}): HoldingRow {
      return {
        lineId: 'line-oil',
        name: 'Extra virgin olive oil',
        quantity: 2,
        editable: true,
        pending: false,
        ...overrides,
      };
    }

    /** The line under the product's own name, and one somebody typed. */
    const OWN = held();
    const TYPED = held({
      lineId: 'line-fry',
      name: 'Oil for the fryer',
      quantity: 5,
    });

    function adding(lines: readonly HoldingRow[] = []): ProductRowAdd {
      return { list: LIST, lines };
    }

    /** The values every call for a key was given, with no repeats. */
    function valuesOf(key: string): unknown[] {
      const seen = new Map<string, unknown>();
      for (const call of asked.mock.calls) {
        if (call[0] === key) {
          seen.set(JSON.stringify(call[3]), call[3]);
        }
      }
      return [...seen.values()];
    }

    function plus(
      fixture: ComponentFixture<ProductRow>
    ): HTMLButtonElement | null {
      return host(fixture).querySelector<HTMLButtonElement>('button.add');
    }

    function heldLines(fixture: ComponentFixture<ProductRow>): HTMLElement[] {
      return [...host(fixture).querySelectorAll<HTMLElement>('li.held-line')];
    }

    function heldLine(
      fixture: ComponentFixture<ProductRow>,
      lineId: string
    ): HTMLElement {
      return host(fixture).querySelector(
        `li.held-line[data-line="${lineId}"]`
      ) as HTMLElement;
    }

    /** A line's two stepper buttons: the minus, then the plus. */
    function steps(
      fixture: ComponentFixture<ProductRow>,
      lineId: string
    ): HTMLButtonElement[] {
      return [
        ...heldLine(fixture, lineId).querySelectorAll<HTMLButtonElement>(
          'lib-quantity-stepper button'
        ),
      ];
    }

    /** A line's stepper, whose host carries the amount it draws (velista 0188, L). */
    function stepper(
      fixture: ComponentFixture<ProductRow>,
      lineId: string
    ): Element | null {
      return heldLine(fixture, lineId).querySelector('lib-quantity-stepper');
    }

    /** What a line's stepper draws, in base units. */
    function amountOf(
      fixture: ComponentFixture<ProductRow>,
      lineId: string
    ): string | null | undefined {
      return stepper(fixture, lineId)?.getAttribute('data-value');
    }

    /** Whether a stepper button is at an end or off: drawn, focusable, and deaf. */
    function off(button: HTMLButtonElement | undefined): boolean {
      return button?.getAttribute('aria-disabled') === 'true';
    }

    function record(fixture: ComponentFixture<ProductRow>): {
      opened: string[];
      added: string[];
      lineStepped: ProductRowLineStep[];
    } {
      const heard = {
        opened: [] as string[],
        added: [] as string[],
        lineStepped: [] as ProductRowLineStep[],
      };
      const row = fixture.componentInstance;
      row.opened.subscribe((id) => heard.opened.push(id));
      row.added.subscribe((added) => heard.added.push(added.id));
      row.lineStepped.subscribe((step) => heard.lineStepped.push(step));
      return heard;
    }

    it('draws no plus on a row that offers none, which is every other user of the row', async () => {
      const fixture = await render(productRowView(OIL, options()));

      expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
      expect(plus(fixture)).toBeNull();
      expect(host(fixture).querySelector('.held')).toBeNull();
      expect(host(fixture).querySelector('lib-quantity-stepper')).toBeNull();
      expect(
        host(fixture).querySelector('.row')?.classList.contains('has-control')
      ).toBe(false);
    });

    it('draws a plus named for the product and the list', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());

      const button = plus(fixture);
      expect(button).not.toBeNull();
      expect(button?.querySelector('lib-plus-icon')).not.toBeNull();
      expect(button?.getAttribute('aria-label')).toBe('catalog.add.label');
      expect(valuesOf('catalog.add.label')).toEqual([
        { name: 'Extra virgin olive oil', list: LIST },
      ]);
      expect(
        host(fixture).querySelector('.row')?.classList.contains('has-control')
      ).toBe(true);
    });

    it('adds one on a press, and does not open the product', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());
      const heard = record(fixture);

      plus(fixture)?.click();

      expect(heard.added).toEqual(['item-oil']);
      expect(heard.opened).toEqual([]);
      expect(heard.lineStepped).toEqual([]);
    });

    it('still opens the product from its own button', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());
      const heard = record(fixture);

      host(fixture).querySelector<HTMLButtonElement>('button.open')?.click();

      expect(heard.opened).toEqual(['item-oil']);
      expect(heard.added).toEqual([]);
    });

    it('stays a plus once the list holds the product, and adds one more', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );
      const heard = record(fixture);

      const button = plus(fixture);
      expect(button?.querySelector('lib-plus-icon')).not.toBeNull();
      // No number on the plus: it could not say which line it counted.
      expect(button?.textContent?.trim()).toBe('');
      expect(button?.getAttribute('aria-label')).toBe('catalog.add.label');

      button?.click();

      expect(heard.added).toEqual(['item-oil']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('draws no block of lines while the list holds none', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());

      expect(host(fixture).querySelector('.held')).toBeNull();
      expect(heldLines(fixture)).toHaveLength(0);
      expect(host(fixture).querySelector('lib-quantity-stepper')).toBeNull();
    });

    it('heads the lines with the name of the list', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN])
      );

      expect(host(fixture).querySelector('.held-title')?.textContent).toContain(
        'catalog.held.title'
      );
      expect(valuesOf('catalog.held.title')).toEqual([{ list: LIST }]);
    });

    it('draws one row for each line that holds the product, with its own quantity', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );

      expect(heldLines(fixture).map((one) => one.dataset['line'])).toEqual([
        'line-oil',
        'line-fry',
      ]);
      expect(
        heldLines(fixture).map(
          (one) => one.querySelector('.held-name')?.textContent
        )
      ).toEqual(['Extra virgin olive oil', 'Oil for the fryer']);
      expect(
        heldLines(fixture).map(
          (one) => one.querySelector('lib-amount-figure .number')?.textContent
        )
      ).toEqual(['2', '5']);
      expect(
        heldLines(fixture).map((one) =>
          one.querySelector('lib-quantity-stepper')?.getAttribute('data-value')
        )
      ).toEqual(['2', '5']);
    });

    it('keeps the price in the row while the lines are drawn under it', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN])
      );

      const open = host(fixture).querySelector('button.open');
      expect(open?.querySelector('.price .amount')?.textContent).toBe('€8.45');
      expect(open?.querySelector('.chains')?.textContent).toContain(
        'Mercadona'
      );
    });

    it('names the amount of each stepper for its line and the list', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );

      expect(
        stepper(fixture, 'line-oil')
          ?.querySelector('[role="group"]')
          ?.getAttribute('aria-label')
      ).toBe('amount.group');
      expect(valuesOf('amount.inList')).toEqual([
        { name: 'Extra virgin olive oil', list: LIST },
        { name: 'Oil for the fryer', list: LIST },
      ]);
    });

    it('names the amount as the host words it', async () => {
      await render(productRowView(OIL, options()), {
        list: LIST,
        lines: [{ ...held(), stepperName: 'Oil on Weekly, Home' }],
      });

      expect(valuesOf('amount.group')).toEqual([
        { name: 'Oil on Weekly, Home' },
      ]);
      expect(valuesOf('amount.inList')).toEqual([]);
    });

    it('draws each stepper as a row, with no tint while the line holds some', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, held({ lineId: 'line-zero', quantity: 0 })])
      );

      for (const lineId of ['line-oil', 'line-zero']) {
        const one = stepper(fixture, lineId);
        expect(one?.classList.contains('variant-row')).toBe(true);
        expect(one?.classList.contains('is-accent')).toBe(false);
      }
    });

    it('says one more for the line whose plus was pressed', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );
      const heard = record(fixture);

      steps(fixture, 'line-fry')[1]?.click();

      expect(heard.lineStepped).toEqual([
        { lineId: 'line-fry', step: { from: 5, to: 6, repeat: false } },
      ]);
      // A step on a line is not an add, and it does not open the product.
      expect(heard.added).toEqual([]);
      expect(heard.opened).toEqual([]);
    });

    it('says one fewer for the line whose minus was pressed', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );
      const heard = record(fixture);

      steps(fixture, 'line-oil')[0]?.click();

      expect(heard.lineStepped).toEqual([
        { lineId: 'line-oil', step: { from: 2, to: 1, repeat: false } },
      ]);
    });

    it('says one fewer at one too, which is how a line goes to zero', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ quantity: 1 })])
      );
      const heard = record(fixture);

      expect(off(steps(fixture, 'line-oil')[0])).toBe(false);
      steps(fixture, 'line-oil')[0]?.click();

      expect(heard.lineStepped).toEqual([
        { lineId: 'line-oil', step: { from: 1, to: 0, repeat: false } },
      ]);
    });

    it('has no minus to press on a line at zero', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ quantity: 0 })])
      );
      const heard = record(fixture);

      expect(off(steps(fixture, 'line-oil')[0])).toBe(true);
      expect(off(steps(fixture, 'line-oil')[1])).toBe(false);
      steps(fixture, 'line-oil')[0]?.click();

      expect(heard.lineStepped).toEqual([]);
    });

    it('says a step down and then a step up when both land before the quantity moves', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN])
      );
      const heard = record(fixture);

      steps(fixture, 'line-oil')[0]?.click();
      fixture.detectChanges();
      steps(fixture, 'line-oil')[1]?.click();
      fixture.detectChanges();

      expect(heard.lineStepped).toEqual([
        { lineId: 'line-oil', step: { from: 2, to: 1, repeat: false } },
        { lineId: 'line-oil', step: { from: 2, to: 3, repeat: false } },
      ]);
    });

    it('draws the quantity it is given again after a press the list did not take', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN])
      );
      const heard = record(fixture);

      // The write fails, so the quantity the row is given never moves.
      steps(fixture, 'line-oil')[1]?.click();
      fixture.detectChanges();

      expect(heard.lineStepped).toEqual([
        { lineId: 'line-oil', step: { from: 2, to: 3, repeat: false } },
      ]);
      expect(amountOf(fixture, 'line-oil')).toBe('2');
    });

    it('draws the new quantity only once the list has taken the press', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );

      steps(fixture, 'line-oil')[1]?.click();
      fixture.detectChanges();
      expect(amountOf(fixture, 'line-oil')).toBe('2');

      fixture.componentRef.setInput(
        'add',
        adding([held({ quantity: 3 }), TYPED])
      );
      fixture.detectChanges();

      expect(amountOf(fixture, 'line-oil')).toBe('3');
      // The other line did not move.
      expect(amountOf(fixture, 'line-fry')).toBe('5');
    });

    it('disables the stepper of a line the person may not change, and still shows how many', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ editable: false }), TYPED])
      );
      const heard = record(fixture);

      expect(steps(fixture, 'line-oil').map(off)).toEqual([true, true]);
      expect(amountOf(fixture, 'line-oil')).toBe('2');
      // The line beside it is the person's to change.
      expect(steps(fixture, 'line-fry').map(off)).toEqual([false, false]);

      for (const button of steps(fixture, 'line-oil')) {
        button.click();
      }

      expect(heard.lineStepped).toEqual([]);
    });

    it('says a line waits for approval only when it does', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ pending: true }), TYPED])
      );

      expect(
        heldLine(fixture, 'line-oil').querySelector('.held-pending')
          ?.textContent
      ).toContain('catalog.added.pending');
      expect(
        heldLine(fixture, 'line-fry').querySelector('.held-pending')
      ).toBeNull();
    });

    it('takes the lines away again when the list holds the product no more', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN])
      );

      fixture.componentRef.setInput('add', adding());
      fixture.detectChanges();

      expect(host(fixture).querySelector('.held')).toBeNull();
      expect(plus(fixture)).not.toBeNull();
    });

    it('never draws a button inside the product button', async () => {
      const states: ProductRowAdd[] = [
        adding(),
        adding([OWN]),
        adding([OWN, TYPED]),
      ];

      for (const state of states) {
        const fixture = await render(productRowView(OIL, options()), state);
        const open = host(fixture).querySelector('button.open');

        expect(host(fixture).querySelector('button button')).toBeNull();
        expect(open?.querySelector('lib-quantity-stepper')).toBeNull();
        expect(plus(fixture)?.closest('.open')).toBeNull();
        expect(plus(fixture)?.closest('.row')).toBe(open?.closest('.row'));

        const block = host(fixture).querySelector('.held');
        expect(block === null).toBe(state.lines.length === 0);
        if (block !== null) {
          expect(block.closest('button')).toBeNull();
          expect(block.closest('.open')).toBeNull();
        }
      }
    });
  });
});

/**
 * The card's other modes and the parts the search adds (velista `0162`, sections
 * 2 and 4): the verb pill and the tick in the control slot, the compact size with
 * its stepper, a group, every shop's price and the synonym line.
 */
describe('ProductRow, the one card', () => {
  async function card(
    inputs: Record<string, unknown>,
    row: ProductRowView = productRowView(OIL, options())
  ): Promise<ComponentFixture<ProductRow>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductRow, RokuTranslatorTestingModule.forTesting()],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductRow);
    fixture.componentRef.setInput('row', row);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function el(fixture: ComponentFixture<ProductRow>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the verb pill in the slot, inside the one button that names it', async () => {
    const fixture = await card({
      verb: 'basket.change.verb',
      verbLabel: 'basket.change.verbLabel',
    });

    const open = el(fixture).querySelector('button.open');
    expect(open?.querySelector('.verb')?.textContent).toContain(
      'basket.change.verb'
    );
    expect(open?.getAttribute('aria-label')).toBe('basket.change.verbLabel');
    expect(el(fixture).querySelectorAll('button')).toHaveLength(1);
  });

  it('draws a tick in the slot for a set, held back until the page decides', async () => {
    const fixture = await card({
      choice: { name: 'set', checked: false, multiple: true },
    });
    const chosen: string[] = [];
    fixture.componentInstance.chosen.subscribe((id) => chosen.push(id));

    const tick = el(fixture).querySelector<HTMLInputElement>(
      'label.open input.pick-many'
    );
    expect(tick?.type).toBe('checkbox');
    tick?.click();

    expect(chosen).toEqual([OIL.id]);
    expect(tick?.checked).toBe(false);
  });

  it('opens the product as a link where the host has its URL', async () => {
    const fixture = await card({ link: '/en/catalog/product/item-oil' });

    const link = el(fixture).querySelector('a.open');
    expect(link?.getAttribute('href')).toBe('/en/catalog/product/item-oil');
    expect(link?.getAttribute('aria-label')).toContain('€8.45');
    expect(el(fixture).querySelector('button.open')).toBeNull();
  });

  it('opens nothing on a page that cannot open the product: no button, no link, no tab stop', async () => {
    const fixture = await card({ openable: false });
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    const open = el(fixture).querySelector<HTMLElement>('.open');
    expect(open?.tagName).toBe('SPAN');
    expect(open?.classList.contains('is-inert')).toBe(true);
    expect(open?.querySelector('.name')?.textContent).toBe(OIL.name.en);
    expect(open?.hasAttribute('tabindex')).toBe(false);
    expect(el(fixture).querySelector('button.open, a.open')).toBeNull();

    open?.click();
    expect(opened).toEqual([]);
  });

  it('keeps the link where the host has a URL, even when it is not openable otherwise', async () => {
    const fixture = await card({
      openable: false,
      link: '/en/catalog/product/item-oil',
    });

    expect(el(fixture).querySelector('a.open')).not.toBeNull();
    expect(el(fixture).querySelector('.open.is-inert')).toBeNull();
  });

  describe('one control in the slot, by precedence', () => {
    const STEPPER = { value: 1, name: 'Extra virgin olive oil' };
    const ADD = { list: 'Weekly', lines: [] };

    it('draws the radio alone when a choice and a stepper are both set', async () => {
      const fixture = await card({
        choice: { name: 'pick', checked: false },
        stepper: STEPPER,
        add: ADD,
      });

      expect(el(fixture).querySelector('input.pick')).not.toBeNull();
      expect(el(fixture).querySelector('lib-quantity-stepper')).toBeNull();
      expect(el(fixture).querySelector('button.add')).toBeNull();
      expect(
        el(fixture).querySelector('.row')?.classList.contains('has-control')
      ).toBe(false);
    });

    it('draws the plus alone when the plus and a stepper are both set', async () => {
      const fixture = await card({ stepper: STEPPER, add: ADD });

      expect(el(fixture).querySelector('button.add')).not.toBeNull();
      expect(el(fixture).querySelector('lib-quantity-stepper')).toBeNull();
    });
  });

  it('draws the glyph in place of a photo that does not load', async () => {
    const fixture = await card(
      {},
      productRowView(
        { ...OIL, imageUrl: 'https://img.test/gone.png' },
        options()
      )
    );

    el(fixture).querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el(fixture).querySelector('img')).toBeNull();
    expect(el(fixture).querySelector('lib-product-icon')).not.toBeNull();
  });

  describe('compact, for a list inside a sheet (velista 0163)', () => {
    it('draws the compact size, with a radio in the slot', async () => {
      const fixture = await card({
        compact: true,
        choice: { name: 'change', checked: true },
      });

      expect(
        el(fixture).querySelector('.row')?.classList.contains('compact')
      ).toBe(true);
      expect(
        el(fixture).querySelector<HTMLInputElement>('label.open input.pick')
          ?.checked
      ).toBe(true);
    });

    it('draws a stepper in the slot, and says each press', async () => {
      const fixture = await card({
        compact: true,
        stepper: { value: 2, name: 'Extra virgin olive oil', min: 1 },
      });
      const stepped: QuantityStep[] = [];
      fixture.componentInstance.stepped.subscribe((step) => stepped.push(step));

      const control = el(fixture).querySelector('.cell > lib-quantity-stepper');
      expect(control?.classList.contains('variant-row')).toBe(true);
      expect(control?.getAttribute('data-value')).toBe('2');
      expect(
        control?.querySelector('[role="group"]')?.getAttribute('aria-label')
      ).toBe('amount.group');
      expect(
        el(fixture).querySelector('.row')?.classList.contains('has-control')
      ).toBe(true);
      const [minus, plus] = [
        ...el(fixture).querySelectorAll<HTMLButtonElement>(
          'lib-quantity-stepper button'
        ),
      ];
      plus?.click();
      minus?.click();

      expect(stepped).toEqual([
        { from: 2, to: 3, repeat: false },
        { from: 2, to: 1, repeat: false },
      ]);
      expect(el(fixture).querySelector('button.add')).toBeNull();
    });

    it('draws a caption under the detail', async () => {
      const fixture = await card(
        { compact: true },
        { ...productRowView(OIL, options()), caption: 'Chosen now' }
      );

      expect(el(fixture).querySelector('.what .caption')?.textContent).toBe(
        'Chosen now'
      );
    });

    it('draws words with nothing to open, beside its stepper', async () => {
      const fixture = await card({
        compact: true,
        openable: false,
        stepper: { value: 1, name: 'Extra virgin olive oil' },
      });

      expect(el(fixture).querySelector('button.open')).toBeNull();
      expect(
        el(fixture).querySelector('.open.is-inert .name')?.textContent
      ).toBe('Extra virgin olive oil');
      expect(
        el(fixture).querySelectorAll('lib-quantity-stepper button')
      ).toHaveLength(2);
    });

    it('leaves the price column empty where the detail carries the price', async () => {
      const priced = await card({ compact: true, priceShown: false });
      expect(el(priced).querySelector('.price')).toBeNull();
      // The detail says the price there, so it wraps rather than being cut.
      expect(
        el(priced).querySelector('.row')?.classList.contains('price-in-detail')
      ).toBe(true);

      const unpriced = await card(
        { compact: true, priceShown: false },
        { ...productRowView(OIL, options()), price: null }
      );
      expect(el(unpriced).querySelector('.no-price')).toBeNull();
    });
  });

  describe('every shop’s price (the search)', () => {
    const SHOPS: ProductRowShop[] = [
      {
        id: 'c-m',
        name: 'Mercadona',
        price: { amount: '€8.45', per: null },
        note: null,
        best: true,
      },
      {
        id: 'c-e',
        name: 'El Jamón',
        price: { amount: '€9.10', per: '/ kg' },
        note: 'seen 3 days ago',
        best: false,
      },
    ];

    it('makes the chain line a button that opens them under the card', async () => {
      const fixture = await card({ shops: SHOPS });
      const toggled: string[] = [];
      fixture.componentInstance.expandToggled.subscribe((part) =>
        toggled.push(part)
      );

      const line = el(fixture).querySelector<HTMLButtonElement>(
        'button.chains-press'
      );
      expect(line?.closest('.open')).toBeNull();
      expect(line?.getAttribute('aria-expanded')).toBe('false');
      expect(line?.getAttribute('aria-label')).toContain(
        'list.add.card.soldAt'
      );
      expect(el(fixture).querySelector('.open .chains')).toBeNull();
      line?.click();
      expect(toggled).toEqual(['shops']);

      fixture.componentRef.setInput('expanded', 'shops');
      fixture.detectChanges();

      const rows = [...el(fixture).querySelectorAll('ul.shops li.shop')];
      expect(
        rows.map((row) => row.querySelector('.shop-name')?.textContent)
      ).toEqual(['Mercadona', 'El Jamón']);
      expect(rows[0]?.classList.contains('best')).toBe(true);
      expect(rows[1]?.querySelector('.shop-note')?.textContent).toBe(
        'seen 3 days ago'
      );
      // What a price is per is drawn small after its number (velista 0179).
      expect(
        rows[0]?.querySelector('.shop-price')?.firstElementChild?.textContent
      ).toBe('€8.45');
      expect(rows[0]?.querySelector('.shop-price .per')).toBeNull();
      expect(rows[1]?.querySelector('.shop-price .per')?.textContent).toBe(
        '/ kg'
      );
      expect(line?.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('a group (the search)', () => {
    const GROUP: ProductRowGroup = {
      members: [
        { id: 'm1', name: 'Natural yogurt', brand: 'Danone', price: '€1.00' },
        { id: 'm2', name: 'Greek yogurt', brand: null, price: null },
      ],
      reveal: '4 products',
      more: 'and 2 more',
    };
    const ROW: ProductRowView = {
      id: 'group-g1',
      name: 'Yogur natural',
      detail: 'Adds its 4 products',
      caption: null,
      imageUrl: null,
      price: { amount: '€1.00', per: null },
      unitPrice: null,
      seen: null,
      stale: false,
      chains: null,
      label: 'Yogur natural, Group, from €1.00',
      summary: null,
    };

    it('draws the crate, the word, the detail and "from" over the best price', async () => {
      const fixture = await card({ group: GROUP }, ROW);

      expect(
        el(fixture).querySelector('.crate lib-basket-icon')
      ).not.toBeNull();
      expect(el(fixture).querySelector('lib-product-picture')).toBeNull();
      expect(el(fixture).querySelector('.group-word')?.textContent).toContain(
        'list.add.card.groupBadge'
      );
      expect(el(fixture).querySelector('.detail')?.textContent).toBe(
        'Adds its 4 products'
      );
      const price = el(fixture).querySelector('.price');
      expect(price?.firstElementChild?.textContent).toContain(
        'list.add.card.from'
      );
      expect(price?.querySelector('.amount')?.textContent).toBe('€1.00');
    });

    it('opens its products on a press on the card or on the reveal, never a page', async () => {
      const fixture = await card({ group: GROUP }, ROW);
      const toggled: string[] = [];
      const opened: string[] = [];
      fixture.componentInstance.expandToggled.subscribe((part) =>
        toggled.push(part)
      );
      fixture.componentInstance.opened.subscribe((id) => opened.push(id));

      el(fixture).querySelector<HTMLButtonElement>('button.open')?.click();
      el(fixture).querySelector<HTMLButtonElement>('button.reveal')?.click();

      expect(toggled).toEqual(['members', 'members']);
      expect(opened).toEqual([]);
    });

    it('reveals what a group is, its members and the count of the rest', async () => {
      const fixture = await card({ group: GROUP, expanded: 'members' }, ROW);

      const inside = el(fixture).querySelector('#group-g1-inside');
      expect(inside?.querySelector('.inside-help')?.textContent).toContain(
        'list.add.card.groupHelpBody'
      );
      expect(
        [...(inside?.querySelectorAll('.inside-name') ?? [])].map(
          (name) => name.textContent
        )
      ).toEqual(['Natural yogurt', 'Greek yogurt']);
      expect(inside?.querySelector('.inside-more')?.textContent).toBe(
        'and 2 more'
      );
      expect(
        el(fixture).querySelector('button.open')?.getAttribute('aria-expanded')
      ).toBe('true');
    });

    it('draws nothing under a group with no members, and its press opens nothing', async () => {
      const empty = { members: [], reveal: null, more: null };
      const fixture = await card({ group: empty, expanded: 'members' }, ROW);
      const toggled: string[] = [];
      fixture.componentInstance.expandToggled.subscribe((part) =>
        toggled.push(part)
      );

      expect(el(fixture).querySelector('.inside')).toBeNull();
      el(fixture).querySelector<HTMLButtonElement>('button.open')?.click();
      expect(toggled).toEqual([]);
    });

    it('draws no "no price" for a group nobody prices', async () => {
      const fixture = await card({ group: GROUP }, { ...ROW, price: null });

      expect(el(fixture).querySelector('.no-price')).toBeNull();
      expect(el(fixture).querySelector('.amount')).toBeNull();
    });
  });

  it('draws the synonym that matched under the detail', async () => {
    const fixture = await card({ alsoCalled: 'Also called: algodón' });

    expect(el(fixture).querySelector('.what .also')?.textContent).toBe(
      'Also called: algodón'
    );
  });

  it('is a row of cells inside a grid, and nothing of the kind outside one', async () => {
    const inGrid = await card({ grid: true, add: { list: 'L', lines: [] } });
    expect(el(inGrid).querySelector('.row')?.getAttribute('role')).toBe('row');
    expect(
      [...el(inGrid).querySelectorAll('.row > .cell')].map((cell) =>
        cell.getAttribute('role')
      )
    ).toEqual(['gridcell', 'gridcell']);

    const alone = await card({});
    expect(
      el(alone).querySelector('[role="row"], [role="gridcell"]')
    ).toBeNull();
  });
});

describe('ProductRow, its layers', () => {
  const scss = readFileSync(join(__dirname, 'product-row.scss'), 'utf8');

  it('keeps the z-index of its parts inside the card', () => {
    // The picture and the plus sit over the press area with `z-index: 1`. Without a
    // stacking context on the host, that 1 met the sticky band of the catalog page at
    // the same level and the card was drawn over the search (velista 0162).
    expect(scss).toMatch(/z-index:\s*1;/);

    const host = /:host\s*\{([^}]*)\}/.exec(scss)?.[1] ?? '';
    expect(host).toMatch(/isolation:\s*isolate;/);
  });
});

/** Velista `0185`, C1 and decisions D and G: a product already on the list. */
describe('ProductRow, a product already on the list', () => {
  const LINE: HoldingRow = {
    lineId: 'line-oil',
    name: 'Extra virgin olive oil',
    quantity: 2,
    editable: true,
    pending: false,
  };

  async function render(add: ProductRowAdd): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductRow, RokuTranslatorTestingModule.forTesting()],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductRow);
    fixture.componentRef.setInput('row', productRowView(OIL, options()));
    fixture.componentRef.setInput('add', add);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('switches the plus off, keeps its name, and describes it by the sentence', async () => {
    const host = await render({
      list: 'Weekly shop',
      lines: [LINE],
      onList: { lineId: 'line-oil', path: '/en/zones/z1/lists/l1' },
    });

    const plus = host.querySelector<HTMLButtonElement>('button.add');
    // Inert but focusable (decision G, the owner's on 2026-11-12).
    expect(plus?.getAttribute('aria-disabled')).toBe('true');
    expect(plus?.hasAttribute('disabled')).toBe(false);
    expect(plus?.getAttribute('aria-label')).toBe('catalog.add.label');
    const sentence = host.querySelector('.held-onlist');
    expect(sentence).not.toBeNull();
    expect(plus?.getAttribute('aria-describedby')).toBe(sentence?.id);
    expect(
      sentence?.querySelector('lib-info-icon')?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(sentence?.textContent).toContain('catalog.held.alreadyOn');
    // In place of the heading of the lines.
    expect(host.querySelector('.held-title')).toBeNull();
  });

  it('keeps focus on the plus when an add lands and switches it off, and a second press adds nothing', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductRow, RokuTranslatorTestingModule.forTesting()],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductRow);
    fixture.componentRef.setInput('row', productRowView(OIL, options()));
    fixture.componentRef.setInput('add', { list: 'Weekly shop', lines: [] });
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const pressed: string[] = [];
    fixture.componentInstance.added.subscribe((event) =>
      pressed.push(event.id)
    );
    try {
      const plus = (fixture.nativeElement as HTMLElement).querySelector(
        'button.add'
      ) as HTMLButtonElement;
      plus.focus();
      plus.click();
      expect(pressed).toEqual([OIL.id]);

      // The add landed: the line is on the list, and the plus switches off.
      fixture.componentRef.setInput('add', {
        list: 'Weekly shop',
        lines: [LINE],
        onList: { lineId: 'line-oil', path: '/en/zones/z1/lists/l1' },
      });
      fixture.detectChanges();

      expect(document.activeElement).toBe(plus);
      expect(plus.getAttribute('aria-disabled')).toBe('true');
      expect(plus.hasAttribute('disabled')).toBe(false);
      plus.click();
      expect(pressed).toEqual([OIL.id]);
    } finally {
      (fixture.nativeElement as HTMLElement).remove();
    }
  });

  it('links to the list at that line, and keeps the line and its stepper working', async () => {
    const host = await render({
      list: 'Weekly shop',
      lines: [LINE],
      onList: { lineId: 'line-oil', path: '/en/zones/z1/lists/l1' },
    });

    const link = host.querySelector<HTMLAnchorElement>('a.held-onlist-link');
    expect(link?.textContent?.trim()).toBe('catalog.held.openLine');
    expect(link?.getAttribute('href')).toBe(
      '/en/zones/z1/lists/l1?line=line-oil'
    );
    const steps = host.querySelectorAll<HTMLButtonElement>(
      'li.held-line lib-quantity-stepper button.step'
    );
    expect(steps).toHaveLength(2);
    expect(
      [...steps].some((step) => step.getAttribute('aria-disabled') === 'true')
    ).toBe(false);
  });

  it('keeps the plus and the heading for a product on no line asked for', async () => {
    const host = await render({
      list: 'Weekly shop',
      lines: [{ ...LINE, quantity: 0 }],
    });

    expect(host.querySelector<HTMLButtonElement>('button.add')?.disabled).toBe(
      false
    );
    expect(
      host.querySelector('button.add')?.hasAttribute('aria-disabled')
    ).toBe(false);
    expect(
      host.querySelector('button.add')?.hasAttribute('aria-describedby')
    ).toBe(false);
    expect(host.querySelector('.held-title')).not.toBeNull();
    expect(host.querySelector('.held-onlist')).toBeNull();
  });
});
