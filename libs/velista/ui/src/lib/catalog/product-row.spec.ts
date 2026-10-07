import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogProduct,
  HoldingRow,
  ProductOffer,
} from '@portfolio/velista/models';
import {
  ProductRow,
  type ProductRowAdd,
  type ProductRowLineStep,
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

    function spinbutton(
      fixture: ComponentFixture<ProductRow>,
      lineId: string
    ): Element | null {
      return heldLine(fixture, lineId).querySelector('[role="spinbutton"]');
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
      row.added.subscribe((id) => heard.added.push(id));
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
        host(fixture).querySelector('.row')?.classList.contains('has-add')
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
        host(fixture).querySelector('.row')?.classList.contains('has-add')
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
          (one) => one.querySelector('.value')?.textContent
        )
      ).toEqual(['2', '5']);
      expect(
        heldLines(fixture).map((one) =>
          one
            .querySelector('[role="spinbutton"]')
            ?.getAttribute('aria-valuenow')
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
      expect(open?.querySelector('.caption')?.textContent).toContain(
        'Mercadona'
      );
    });

    it('names each stepper for its line and the list', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );

      expect(spinbutton(fixture, 'line-oil')?.getAttribute('aria-label')).toBe(
        'catalog.held.stepper'
      );
      expect(valuesOf('catalog.held.stepper')).toEqual([
        { line: 'Extra virgin olive oil', list: LIST },
        { line: 'Oil for the fryer', list: LIST },
      ]);
    });

    it('draws each stepper small, and in the quiet colour while the line holds some', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, held({ lineId: 'line-zero', quantity: 0 })])
      );

      const some = heldLine(fixture, 'line-oil').querySelector(
        'lib-quantity-stepper'
      );
      const none = heldLine(fixture, 'line-zero').querySelector(
        'lib-quantity-stepper'
      );
      expect(some?.classList.contains('is-compact')).toBe(true);
      expect(some?.classList.contains('is-accent')).toBe(true);
      expect(none?.classList.contains('is-compact')).toBe(true);
      expect(none?.classList.contains('is-accent')).toBe(false);
    });

    it('says one more for the line whose plus was pressed', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );
      const heard = record(fixture);

      steps(fixture, 'line-fry')[1]?.click();

      expect(heard.lineStepped).toEqual([{ lineId: 'line-fry', by: 1 }]);
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

      expect(heard.lineStepped).toEqual([{ lineId: 'line-oil', by: -1 }]);
    });

    it('says one fewer at one too, which is how a line goes to zero', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ quantity: 1 })])
      );
      const heard = record(fixture);

      expect(
        spinbutton(fixture, 'line-oil')?.getAttribute('aria-valuemin')
      ).toBe('0');
      expect(steps(fixture, 'line-oil')[0]?.disabled).toBe(false);
      steps(fixture, 'line-oil')[0]?.click();

      expect(heard.lineStepped).toEqual([{ lineId: 'line-oil', by: -1 }]);
    });

    it('has no minus to press on a line at zero', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ quantity: 0 })])
      );
      const heard = record(fixture);

      expect(steps(fixture, 'line-oil')[0]?.disabled).toBe(true);
      expect(steps(fixture, 'line-oil')[1]?.disabled).toBe(false);
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
        { lineId: 'line-oil', by: -1 },
        { lineId: 'line-oil', by: 1 },
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

      expect(heard.lineStepped).toEqual([{ lineId: 'line-oil', by: 1 }]);
      expect(
        heldLine(fixture, 'line-oil').querySelector('.value')?.textContent
      ).toBe('2');
      expect(
        spinbutton(fixture, 'line-oil')?.getAttribute('aria-valuenow')
      ).toBe('2');
    });

    it('draws the new quantity only once the list has taken the press', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([OWN, TYPED])
      );

      steps(fixture, 'line-oil')[1]?.click();
      fixture.detectChanges();
      expect(
        heldLine(fixture, 'line-oil').querySelector('.value')?.textContent
      ).toBe('2');

      fixture.componentRef.setInput(
        'add',
        adding([held({ quantity: 3 }), TYPED])
      );
      fixture.detectChanges();

      expect(
        heldLine(fixture, 'line-oil').querySelector('.value')?.textContent
      ).toBe('3');
      // The other line did not move.
      expect(
        heldLine(fixture, 'line-fry').querySelector('.value')?.textContent
      ).toBe('5');
    });

    it('disables the stepper of a line the person may not change, and still shows how many', async () => {
      const fixture = await render(
        productRowView(OIL, options()),
        adding([held({ editable: false }), TYPED])
      );
      const heard = record(fixture);

      expect(steps(fixture, 'line-oil').map((one) => one.disabled)).toEqual([
        true,
        true,
      ]);
      expect(
        heldLine(fixture, 'line-oil').querySelector('.value')?.textContent
      ).toBe('2');
      // The line beside it is the person's to change.
      expect(steps(fixture, 'line-fry').map((one) => one.disabled)).toEqual([
        false,
        false,
      ]);

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
        expect(plus(fixture)?.closest('button.open')).toBeNull();
        expect(plus(fixture)?.parentElement).toBe(open?.parentElement);

        const block = host(fixture).querySelector('.held');
        expect(block === null).toBe(state.lines.length === 0);
        if (block !== null) {
          expect(block.closest('button')).toBeNull();
          expect(block.parentElement).toBe(open?.parentElement);
        }
      }
    });
  });
});
