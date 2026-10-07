import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type { CatalogProduct, ProductOffer } from '@portfolio/velista/models';
import {
  ProductRow,
  type ProductRowAdd,
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
  observedAt: new Date('2026-09-20T10:00:00.000Z'),
  sourceKind: 'OFFICIAL_API',
  stale: false,
  priceScopeId: 'scope-m',
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
    expect(view.price).toBe('€8.45');
    expect(view.caption).toBe('Mercadona');
    expect(view.stale).toBe(false);
  });

  it('draws the price per litre instead of the chain while one chain is chosen', () => {
    const view = productRowView(OIL, options({ chainChosen: true }));

    expect(view.price).toBe('€8.45');
    expect(view.caption).toBe('catalog.unit.LITER {"price":"€8.45"}');
  });

  it('says no price in words, and draws neither a price nor a caption', () => {
    const view = productRowView(
      { ...OIL, offer: null, unitBasis: null },
      options()
    );

    expect(view.price).toBeNull();
    expect(view.caption).toBeNull();
    expect(view.label).toContain('catalog.row.noPrice');
  });

  it('keeps a stale price, and marks it stale', () => {
    const view = productRowView(
      { ...OIL, offer: { ...OFFER, stale: true } },
      options()
    );

    expect(view.price).toBe('€8.45');
    expect(view.stale).toBe(true);
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

  describe('summary, the detail line of a row whose stepper is open', () => {
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

  it('is one button named for the product, the size and the price', async () => {
    const fixture = await render(productRowView(OIL, options()));

    const buttons = host(fixture).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toContain('€8.45');
    expect(host(fixture).querySelector('.caption')?.textContent).toContain(
      'Mercadona'
    );
  });

  it('draws the unit price under the price with a chain chosen', async () => {
    const fixture = await render(
      productRowView(OIL, options({ chainChosen: true }))
    );

    expect(host(fixture).querySelector('.caption')?.textContent).toContain(
      'catalog.unit.LITER'
    );
  });

  it('writes no price as words rather than a dash', async () => {
    const fixture = await render(
      productRowView({ ...OIL, offer: null, unitBasis: null }, options())
    );

    expect(host(fixture).querySelector('.price')).toBeNull();
    expect(host(fixture).querySelector('.no-price')?.textContent).toContain(
      'catalog.row.noPrice'
    );
  });

  it('draws a stale price as stale, with no badge beside it', async () => {
    const fixture = await render(
      productRowView({ ...OIL, offer: { ...OFFER, stale: true } }, options())
    );

    const price = host(fixture).querySelector('.price');
    expect(price?.classList.contains('is-stale')).toBe(true);
    expect(price?.children).toHaveLength(2);
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

  it('says which product was pressed', async () => {
    const fixture = await render(productRowView(OIL, options()));
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    host(fixture).querySelector('button')?.click();

    expect(opened).toEqual(['item-oil']);
  });

  /**
   * The plus (velista `0134`, section 4.1): a sibling of the product button that
   * adds one, then shows the count, then opens a stepper in the row.
   */
  describe('the plus', () => {
    const LIST = 'Weekly shop';

    function adding(overrides: Partial<ProductRowAdd> = {}): ProductRowAdd {
      return { count: 0, floor: 1, open: false, list: LIST, ...overrides };
    }

    /** The values the last call for a key was given. */
    function valuesOf(key: string): unknown {
      const calls = asked.mock.calls.filter((call) => call[0] === key);
      return calls[calls.length - 1]?.[3];
    }

    function plus(
      fixture: ComponentFixture<ProductRow>
    ): HTMLButtonElement | null {
      return host(fixture).querySelector<HTMLButtonElement>('button.add');
    }

    function steps(fixture: ComponentFixture<ProductRow>): HTMLButtonElement[] {
      return [
        ...host(fixture).querySelectorAll<HTMLButtonElement>(
          'lib-quantity-stepper button'
        ),
      ];
    }

    function spinbutton(fixture: ComponentFixture<ProductRow>): Element | null {
      return host(fixture).querySelector('[role="spinbutton"]');
    }

    function record(fixture: ComponentFixture<ProductRow>): {
      opened: string[];
      added: string[];
      counted: string[];
      stepped: number[];
    } {
      const heard = {
        opened: [] as string[],
        added: [] as string[],
        counted: [] as string[],
        stepped: [] as number[],
      };
      const row = fixture.componentInstance;
      row.opened.subscribe((id) => heard.opened.push(id));
      row.added.subscribe((id) => heard.added.push(id));
      row.counted.subscribe((id) => heard.counted.push(id));
      row.stepped.subscribe((by) => heard.stepped.push(by));
      return heard;
    }

    it('draws no plus on a row that offers none, which is every other user of the row', async () => {
      const fixture = await render(productRowView(OIL, options()));

      expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
      expect(plus(fixture)).toBeNull();
      expect(host(fixture).querySelector('lib-quantity-stepper')).toBeNull();
      expect(
        host(fixture).querySelector('.row')?.classList.contains('has-add')
      ).toBe(false);
    });

    it('draws a plus named for the product and the list while the list holds none', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());

      const button = plus(fixture);
      expect(button).not.toBeNull();
      expect(button?.classList.contains('has-count')).toBe(false);
      expect(button?.querySelector('lib-plus-icon')).not.toBeNull();
      expect(button?.getAttribute('aria-label')).toBe('catalog.add.label');
      expect(valuesOf('catalog.add.label')).toEqual({
        name: 'Extra virgin olive oil',
        list: LIST,
      });
    });

    it('adds one on a press, and does not open the product', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());
      const heard = record(fixture);

      plus(fixture)?.click();

      expect(heard.added).toEqual(['item-oil']);
      expect(heard.opened).toEqual([]);
      expect(heard.counted).toEqual([]);
    });

    it('still opens the product from its own button', async () => {
      const fixture = await render(productRowView(OIL, options()), adding());
      const heard = record(fixture);

      host(fixture).querySelector<HTMLButtonElement>('button.open')?.click();

      expect(heard.opened).toEqual(['item-oil']);
      expect(heard.added).toEqual([]);
    });

    it('draws the count in place of the plus once the list holds some', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 3 })
      );

      const button = plus(fixture);
      expect(button?.classList.contains('has-count')).toBe(true);
      expect(button?.textContent?.trim()).toBe('3');
      expect(button?.querySelector('lib-plus-icon')).toBeNull();
      expect(button?.getAttribute('aria-label')).toBe('catalog.add.count');
      expect(valuesOf('catalog.add.count')).toEqual({
        name: 'Extra virgin olive oil',
        count: 3,
        list: LIST,
      });
      // The price keeps its place until the stepper opens.
      expect(host(fixture).querySelector('.price')).not.toBeNull();
    });

    it('asks for the stepper on a press on the count, and adds nothing', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 3 })
      );
      const heard = record(fixture);

      plus(fixture)?.click();

      expect(heard.counted).toEqual(['item-oil']);
      expect(heard.added).toEqual([]);
      expect(heard.opened).toEqual([]);
    });

    it('draws the stepper when open, and moves the price into the detail line', async () => {
      const view = productRowView(OIL, options());
      const fixture = await render(view, adding({ count: 2, open: true }));

      const stepper = host(fixture).querySelector('lib-quantity-stepper');
      expect(stepper).not.toBeNull();
      expect(stepper?.classList.contains('is-accent')).toBe(true);
      expect(stepper?.classList.contains('is-compact')).toBe(true);
      expect(stepper?.querySelector('.value')?.textContent).toBe('2');
      expect(plus(fixture)).toBeNull();

      expect(host(fixture).querySelector('.price')).toBeNull();
      expect(host(fixture).querySelector('.no-price')).toBeNull();
      expect(host(fixture).querySelector('.caption')).toBeNull();
      expect(host(fixture).querySelector('.detail')?.textContent).toBe(
        view.summary
      );
    });

    it('names the stepper for the product and the list', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );

      expect(spinbutton(fixture)?.getAttribute('aria-label')).toBe(
        'catalog.add.stepper'
      );
      expect(valuesOf('catalog.add.stepper')).toEqual({
        name: 'Extra virgin olive oil',
        list: LIST,
      });
    });

    it('keeps the plus while open is set on a row the list holds none of', async () => {
      // An open stepper with nothing to count would be a stepper at zero.
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 0, open: true })
      );

      expect(host(fixture).querySelector('lib-quantity-stepper')).toBeNull();
      expect(plus(fixture)).not.toBeNull();
      expect(host(fixture).querySelector('.price')).not.toBeNull();
    });

    it('draws no detail line under an open stepper with neither a detail nor a price', async () => {
      const fixture = await render(
        productRowView(
          {
            ...OIL,
            brand: null,
            size: 1,
            unit: 'UNIT',
            offer: null,
            unitBasis: null,
          },
          options()
        ),
        adding({ count: 1, open: true })
      );

      expect(host(fixture).querySelector('.detail')).toBeNull();
      expect(host(fixture).querySelector('.no-price')).toBeNull();
    });

    it('says one more on the stepper plus', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );
      const heard = record(fixture);

      steps(fixture)[1]?.click();

      expect(heard.stepped).toEqual([1]);
      expect(heard.opened).toEqual([]);
    });

    it('says one fewer on the stepper minus', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );
      const heard = record(fixture);

      steps(fixture)[0]?.click();

      expect(heard.stepped).toEqual([-1]);
    });

    it('says one fewer at the floor too, which is how a product is taken back', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 1, floor: 1, open: true })
      );
      const heard = record(fixture);

      expect(spinbutton(fixture)?.getAttribute('aria-valuemin')).toBe('0');
      expect(steps(fixture)[0]?.disabled).toBe(false);
      steps(fixture)[0]?.click();

      expect(heard.stepped).toEqual([-1]);
    });

    it('puts the lowest value one under the floor of a line that was there before the visit', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 4, floor: 4, open: true })
      );
      const heard = record(fixture);

      expect(spinbutton(fixture)?.getAttribute('aria-valuemin')).toBe('3');
      steps(fixture)[0]?.click();

      expect(heard.stepped).toEqual([-1]);
    });

    it('says one step for each press when the count follows the press', async () => {
      const view = productRowView(OIL, options());
      const fixture = await render(view, adding({ count: 2, open: true }));
      const heard = record(fixture);

      steps(fixture)[0]?.click();
      fixture.componentRef.setInput('add', adding({ count: 1, open: true }));
      fixture.detectChanges();
      steps(fixture)[1]?.click();

      expect(heard.stepped).toEqual([-1, 1]);
    });

    it('says a step down and then a step up when both land before the count moves', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );
      const heard = record(fixture);

      steps(fixture)[0]?.click();
      fixture.detectChanges();
      steps(fixture)[1]?.click();
      fixture.detectChanges();

      expect(heard.stepped).toEqual([-1, 1]);
    });

    it('draws the count it is given again after a press the list did not take', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );
      const heard = record(fixture);

      // The write fails, so the count the row is given never moves.
      steps(fixture)[1]?.click();
      fixture.detectChanges();

      expect(heard.stepped).toEqual([1]);
      expect(host(fixture).querySelector('.value')?.textContent).toBe('2');
      expect(spinbutton(fixture)?.getAttribute('aria-valuenow')).toBe('2');
    });

    it('draws the new count only once the list has taken the press', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding({ count: 2, open: true })
      );

      steps(fixture)[1]?.click();
      fixture.detectChanges();
      expect(host(fixture).querySelector('.value')?.textContent).toBe('2');

      fixture.componentRef.setInput('add', adding({ count: 3, open: true }));
      fixture.detectChanges();

      expect(host(fixture).querySelector('.value')?.textContent).toBe('3');
    });

    it('never draws a button inside the product button', async () => {
      const states: ProductRowAdd[] = [
        adding(),
        adding({ count: 2 }),
        adding({ count: 2, open: true }),
      ];

      for (const state of states) {
        const fixture = await render(productRowView(OIL, options()), state);
        const open = host(fixture).querySelector('button.open');

        expect(host(fixture).querySelector('button button')).toBeNull();
        expect(open?.querySelector('lib-quantity-stepper')).toBeNull();
        const control =
          plus(fixture) ?? host(fixture).querySelector('lib-quantity-stepper');
        expect(control).not.toBeNull();
        expect(control?.closest('button.open')).toBeNull();
        expect(control?.parentElement).toBe(open?.parentElement);
      }
    });
  });
});
