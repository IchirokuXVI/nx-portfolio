import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogItem,
  CatalogSuggestion,
  ChainPrice,
  ProductOffer,
} from '@portfolio/velista/models';
import {
  SKELETON_DELAY_MS,
  SuggestionList,
  type SuggestionHolding,
  type SuggestionHoldingChange,
} from './suggestion-list';

/** Real time past the skeleton's wait, then a render of what the timer changed. */
async function pastSkeletonDelay(
  fixture: ComponentFixture<SuggestionList>,
  ms = SKELETON_DELAY_MS + 30
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  fixture.detectChanges();
  await fixture.whenStable();
}

/**
 * The composer's product cards (velista `0101`), `placement: 'above'`.
 *
 * What a card **says** is `suggestion-card-view.spec.ts`. This is what it does:
 * which press adds, which do not, that nothing in the panel takes the focus, and
 * what opens where.
 */
function offer(price: number | null): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope',
  };
}

function chain(id: string, price: number): ChainPrice {
  return {
    chain: { id, name: { es: id, en: id } },
    offer: { ...offer(price), priceScopeId: `scope-${id}` },
  };
}

function product(
  id: string,
  overrides: Partial<CatalogItem> = {}
): CatalogItem {
  return {
    id,
    name: { es: `Producto ${id}`, en: `Product ${id}` },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    productGroupId: null,
    category: 'DAIRY',
    offer: offer(1.19),
    chainPrices: [chain('Mercadona', 1.19), chain('Dia', 1.29)],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
    ...overrides,
  };
}

function item(
  id: string,
  overrides: Partial<CatalogItem> = {}
): CatalogSuggestion {
  return { kind: 'item', item: product(id, overrides) };
}

function group(count: number, members: number): CatalogSuggestion {
  return {
    kind: 'group',
    group: { id: 'group-milk', name: { es: 'Leche', en: 'Milk' } },
    itemIds: Array.from({ length: count }, (_unused, index) => `m${index}`),
    offer: offer(0.89),
    members: Array.from({ length: members }, (_unused, index) =>
      product(`m${index}`)
    ),
    synonyms: { en: [], es: [] },
  };
}

interface Rendered {
  readonly fixture: ComponentFixture<SuggestionList>;
  readonly chose: CatalogSuggestion[];
  readonly changed: SuggestionHoldingChange[];
}

async function render(
  offered: readonly CatalogSuggestion[],
  inputs: {
    loading?: boolean;
    holdings?: readonly SuggestionHolding[];
    productLink?: ((itemId: string) => string) | null;
    query?: string | null;
    emptyFor?: string | null;
    freeText?: boolean;
    placement?: 'above' | 'page';
  } = {}
): Promise<Rendered> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SuggestionList, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(SuggestionList);
  fixture.componentRef.setInput('placement', inputs.placement ?? 'above');
  fixture.componentRef.setInput('suggestions', offered);
  fixture.componentRef.setInput('loading', inputs.loading ?? false);
  const holdings = inputs.holdings ?? [];
  fixture.componentRef.setInput(
    'holdingsOf',
    (suggestion: CatalogSuggestion) =>
      suggestion.kind === 'item' && suggestion.item.id === 'held'
        ? holdings
        : []
  );
  fixture.componentRef.setInput('productLink', inputs.productLink ?? null);
  fixture.componentRef.setInput('query', inputs.query ?? null);
  fixture.componentRef.setInput('emptyFor', inputs.emptyFor ?? null);
  fixture.componentRef.setInput('freeText', inputs.freeText ?? false);

  const chose: CatalogSuggestion[] = [];
  const changed: SuggestionHoldingChange[] = [];
  fixture.componentInstance.chose.subscribe((one) =>
    chose.push(one.suggestion)
  );
  fixture.componentInstance.holdingChanged.subscribe((one) =>
    changed.push(one)
  );

  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, chose, changed };
}

function root(fixture: ComponentFixture<SuggestionList>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function cards(fixture: ComponentFixture<SuggestionList>): HTMLElement[] {
  return [...root(fixture).querySelectorAll<HTMLElement>('.sug')];
}

function cardNames(fixture: ComponentFixture<SuggestionList>): string[] {
  return cards(fixture).map(
    (card) => card.querySelector('.sug-name')?.textContent?.trim() ?? ''
  );
}

async function press(
  fixture: ComponentFixture<SuggestionList>,
  element: Element | null
): Promise<void> {
  if (element === null) {
    throw new Error('nothing to press');
  }
  (element as HTMLElement).click();
  fixture.detectChanges();
  await fixture.whenStable();
}

/** A mousedown on the element, and whether the panel cancelled it. */
function mousedownCancelled(element: Element | null): boolean {
  if (element === null) {
    throw new Error('nothing to press');
  }
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('SuggestionList, the composer’s cards', () => {
  it('draws a card per suggestion, the server’s best answer nearest the field', async () => {
    const { fixture } = await render([item('a'), item('b'), item('c')]);

    // Read from the bottom, where the field is: the ranking climbs away from it.
    expect(cardNames(fixture)).toEqual(['Product c', 'Product b', 'Product a']);
  });

  it('is a grid of rows the field owns, not a listbox (rule 8)', async () => {
    const { fixture } = await render([item('a')]);
    const panel = root(fixture).querySelector('.panel');

    expect(panel?.getAttribute('role')).toBe('grid');
    expect(cards(fixture)[0]?.getAttribute('role')).toBe('row');
    expect(root(fixture).querySelector('[role="option"]')).toBeNull();
  });

  it('draws nothing at all for an empty answer, and no free text row', async () => {
    const { fixture } = await render([]);

    expect(root(fixture).querySelector('.panel')).toBeNull();
  });

  it('draws three skeleton cards while the catalog is being asked', async () => {
    const { fixture } = await render([], { loading: true });
    await pastSkeletonDelay(fixture);
    const panel = root(fixture).querySelector('.panel');

    expect(panel?.getAttribute('aria-busy')).toBe('true');
    expect(root(fixture).querySelectorAll('.sk')).toHaveLength(3);
  });

  describe('a search that found nothing (0108, target 1)', () => {
    it('draws no skeleton at all for an answer that lands inside the wait', async () => {
      const { fixture } = await render([], { loading: true });
      await pastSkeletonDelay(fixture, SKELETON_DELAY_MS / 3);

      expect(root(fixture).querySelectorAll('.sk')).toHaveLength(0);

      fixture.componentRef.setInput('loading', false);
      fixture.componentRef.setInput('emptyFor', 'zzzz');
      fixture.detectChanges();
      await pastSkeletonDelay(fixture);

      expect(root(fixture).querySelectorAll('.sk')).toHaveLength(0);
      expect(root(fixture).querySelector('.none')).not.toBeNull();
    });

    it('draws one row naming the words, and says they can still be added', async () => {
      const { fixture } = await render([], {
        emptyFor: 'zzzz',
        freeText: true,
      });
      const rows = root(fixture).querySelectorAll('.none');

      expect(rows).toHaveLength(1);
      expect(rows[0].querySelector('.none-h')?.textContent?.trim()).toBe(
        'list.add.card.noMatch'
      );
      expect(rows[0].querySelector('.none-p')?.textContent?.trim()).toBe(
        'list.add.card.noMatchFreeText'
      );
      // One row and nothing else: no card panel, no card, no skeleton.
      expect(root(fixture).querySelectorAll('.panel, .sug, .sk')).toHaveLength(
        0
      );
    });

    it('leaves the second line out when the words cannot be added', async () => {
      const { fixture } = await render([], { emptyFor: 'zzzz' });

      expect(root(fixture).querySelector('.none-h')).not.toBeNull();
      expect(root(fixture).querySelector('.none-p')).toBeNull();
    });

    it('says it once through the status line, and the row is not said twice', async () => {
      const { fixture } = await render([], { freeText: true });
      const status = root(fixture).querySelector('[role="status"]');

      expect(status?.textContent?.trim()).toBe('');

      fixture.componentRef.setInput('emptyFor', 'zzzz');
      fixture.detectChanges();

      // The same element, filled rather than inserted, so it is announced.
      expect(root(fixture).querySelector('[role="status"]')).toBe(status);
      expect(status?.textContent).toContain('list.add.card.noMatch');
      expect(status?.textContent).toContain('list.add.card.noMatchFreeText');
      expect(
        root(fixture).querySelector('.none')?.closest('[aria-hidden="true"]')
      ).not.toBeNull();
    });

    it('goes away when there are no longer empty words to quote', async () => {
      const { fixture } = await render([], { emptyFor: 'zzzz' });

      fixture.componentRef.setInput('emptyFor', null);
      fixture.detectChanges();

      expect(root(fixture).querySelector('.none')).toBeNull();
      expect(root(fixture).querySelector('.panel')).toBeNull();
    });
  });

  it('keeps the cards it has while a newer answer is asked for', async () => {
    const { fixture } = await render([item('a')], { loading: true });

    expect(cards(fixture)).toHaveLength(1);
    expect(root(fixture).querySelectorAll('.sk')).toHaveLength(0);
  });

  describe('the card is not the target (rule 1)', () => {
    it('adds the product when its button is pressed', async () => {
      const offered = item('a');
      const { fixture, chose } = await render([offered]);

      await press(fixture, root(fixture).querySelector('.pick'));

      expect(chose).toEqual([offered]);
    });

    it('adds nothing when the card, the chain row, the reveal or the link is pressed', async () => {
      const { fixture, chose } = await render([item('a'), group(6, 5)], {
        productLink: (id) => `/en/catalog/sheet/products/${id}`,
      });

      await press(fixture, root(fixture).querySelector('.sug-name'));
      await press(fixture, root(fixture).querySelector('.chains'));
      await press(fixture, root(fixture).querySelector('.reveal'));
      await press(fixture, root(fixture).querySelector('.group-badge'));

      expect(chose).toEqual([]);
    });

    it('names what it adds', async () => {
      const { fixture } = await render([item('a')]);

      expect(
        root(fixture).querySelector('.pick')?.getAttribute('aria-label')
      ).toContain('list.add.card.add');
    });
  });

  describe('nothing in the panel closes the keyboard (rule 2)', () => {
    it('cancels mousedown on every control and on the card itself', async () => {
      const { fixture } = await render([item('a'), group(6, 5)]);
      const panel = root(fixture);

      expect(mousedownCancelled(panel.querySelector('.pick'))).toBe(true);
      expect(mousedownCancelled(panel.querySelector('.chains'))).toBe(true);
      expect(mousedownCancelled(panel.querySelector('.reveal'))).toBe(true);
      expect(mousedownCancelled(panel.querySelector('.group-badge'))).toBe(
        true
      );
      expect(mousedownCancelled(panel.querySelector('.sug-name'))).toBe(true);
    });

    it('cancels mousedown on the stepper of a line already holding it', async () => {
      const { fixture } = await render([item('held')], {
        holdings: [
          {
            key: 'l1',
            lineId: 'l1',
            text: 'Leche entera',
            listName: null,
            quantity: 2,
            editable: true,
          },
        ],
      });

      expect(
        mousedownCancelled(root(fixture).querySelector('.already .step'))
      ).toBe(true);
    });
  });

  describe('every chain’s price', () => {
    it('opens under the chain row and closes again', async () => {
      const { fixture } = await render([item('a')]);
      const button = root(fixture).querySelector('.chains');

      expect(root(fixture).querySelector('.shops')).toBeNull();
      expect(button?.getAttribute('aria-expanded')).toBe('false');

      await press(fixture, button);
      expect(button?.getAttribute('aria-expanded')).toBe('true');
      expect(
        [...root(fixture).querySelectorAll('.shop-name')].map((one) =>
          one.textContent?.trim()
        )
      ).toEqual(['Mercadona', 'Dia']);
      expect(
        root(fixture).querySelector('.shop.best .shop-name')?.textContent
      ).toContain('Mercadona');

      await press(fixture, button);
      expect(root(fixture).querySelector('.shops')).toBeNull();
    });

    it('draws no chain row for a product no chain could be named for', async () => {
      const { fixture } = await render([item('a', { chainPrices: [] })]);

      expect(root(fixture).querySelector('.chains')).toBeNull();
    });
  });

  describe('why a group matched (0108, target 4)', () => {
    const pads: CatalogSuggestion = {
      kind: 'group',
      group: {
        id: 'cotton-pads',
        name: { es: 'Discos desmaquillantes', en: 'Cotton Pads' },
      },
      itemIds: [],
      offer: null,
      members: [],
      synonyms: {
        en: ['cotton pads', 'makeup remover pads'],
        es: ['discos desmaquillantes', 'algodón'],
      },
    };

    it('names the synonym under the name when that is what matched', async () => {
      const { fixture } = await render([pads], { query: 'alg' });

      expect(
        root(fixture).querySelector('.sug-also')?.textContent?.trim()
      ).toBe('list.add.card.alsoCalled');
    });

    it('says nothing new when the name matched', async () => {
      const { fixture } = await render([pads], { query: 'discos' });

      expect(root(fixture).querySelector('.sug-also')).toBeNull();
    });
  });

  describe('a group', () => {
    it('is collapsed like any other card, and reveals five with a count of the rest', async () => {
      const { fixture } = await render([group(6, 5)]);

      expect(root(fixture).querySelector('.inside')).toBeNull();

      await press(fixture, root(fixture).querySelector('.reveal'));

      expect(root(fixture).querySelectorAll('.inside-row')).toHaveLength(5);
      expect(
        root(fixture).querySelector('.inside-more')?.textContent
      ).toContain('list.add.card.groupMore');
    });

    it('opens the popover from its badge, and closes it on Escape', async () => {
      const { fixture } = await render([group(6, 5)]);
      const badge = root(fixture).querySelector('.group-badge');

      await press(fixture, badge);
      const dialog = document.querySelector('.pop[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(badge?.getAttribute('aria-expanded')).toBe('true');

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.querySelector('.pop[role="dialog"]')).toBeNull();
    });
  });

  describe('the lines already holding it (section 4)', () => {
    const holdings: SuggestionHolding[] = [
      {
        key: 'l1',
        lineId: 'l1',
        text: 'Leche entera',
        listName: 'Compra semanal',
        quantity: 2,
        editable: true,
      },
      {
        key: 'l2',
        lineId: 'l2',
        text: 'leche para el café',
        listName: 'Fin de semana',
        quantity: 1,
        editable: false,
      },
    ];

    it('names each line in its own words, and the list above it', async () => {
      const { fixture } = await render([item('held')], { holdings });

      expect(
        [...root(fixture).querySelectorAll('.already-line')].map((one) =>
          one.textContent?.trim()
        )
      ).toEqual(['Leche entera', 'leche para el café']);
      expect(
        [...root(fixture).querySelectorAll('.already-list')].map((one) =>
          one.textContent?.trim()
        )
      ).toEqual(['Compra semanal', 'Fin de semana']);
    });

    it('steps a line up with the app’s own stepper, from and to', async () => {
      const { fixture, changed, chose } = await render([item('held')], {
        holdings,
      });
      const steps = root(fixture)
        .querySelectorAll('.already-row')[0]
        ?.querySelectorAll('.step');

      await press(fixture, steps?.[1] ?? null);

      expect(changed).toEqual([{ holding: holdings[0], from: 2, to: 3 }]);
      expect(chose).toEqual([]);
    });

    it('disables the stepper on a line the reader may not change', async () => {
      const { fixture } = await render([item('held')], { holdings });
      const steps = root(fixture)
        .querySelectorAll('.already-row')[1]
        ?.querySelectorAll<HTMLButtonElement>('.step');

      expect([...(steps ?? [])].every((step) => step.disabled)).toBe(true);
    });

    it('draws no section on a card no line holds', async () => {
      const { fixture } = await render([item('a')], { holdings });

      expect(root(fixture).querySelector('.already')).toBeNull();
    });
  });

  it('links to the product the page names, and to nothing without a link', async () => {
    const linked = await render([item('a')], {
      productLink: (id) => `/en/catalog/sheet/products/${id}`,
    });
    expect(
      root(linked.fixture).querySelector('a.details')?.getAttribute('href')
    ).toBe('/en/catalog/sheet/products/a');

    const bare = await render([item('a')]);
    expect(root(bare.fixture).querySelector('a.details')).toBeNull();
  });

  it('opens at its last card and re-anchors on every new answer', async () => {
    const { fixture } = await render([item('a'), item('b'), item('c')]);
    const panel = root(fixture).querySelector<HTMLElement>('.panel');
    if (panel === null) {
      throw new Error('no panel');
    }
    let top = 0;
    Object.defineProperty(panel, 'scrollHeight', { get: () => 640 });
    Object.defineProperty(panel, 'scrollTop', {
      get: () => top,
      set: (value: number) => (top = value),
    });

    fixture.componentRef.setInput('suggestions', [item('d'), item('e')]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(top).toBe(640);
  });
});

describe('SuggestionList, the panel height follows the visual viewport', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

  afterEach(() => {
    if (original === undefined) {
      delete (window as { visualViewport?: unknown }).visualViewport;
    } else {
      Object.defineProperty(window, 'visualViewport', original);
    }
  });

  it('writes the visual viewport’s height onto the panel, and follows it', async () => {
    // An iOS keyboard does not shorten `100svh`, so the height has to come from
    // `window.visualViewport` (rule 3).
    const listeners: (() => void)[] = [];
    const viewport = {
      height: 508,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.push(listener),
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });

    const { fixture } = await render([item('a')]);
    const panel = root(fixture).querySelector<HTMLElement>('.panel');
    expect(panel?.style.getPropertyValue('--app-viewport')).toBe('508px');

    viewport.height = 331;
    listeners.forEach((listener) => listener());
    fixture.detectChanges();
    await fixture.whenStable();

    expect(panel?.style.getPropertyValue('--app-viewport')).toBe('331px');
  });
});

/**
 * The same cards in a page's own results (velista `0117`): the server's order from
 * the top, and no panel around them, because the page scrolls them with everything
 * else.
 */
describe('SuggestionList, in a page’s results', () => {
  it('draws the cards in the server’s order, with no panel around them', async () => {
    const { fixture } = await render([item('first'), item('second')], {
      placement: 'page',
    });

    const grid = root(fixture).querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.classList).not.toContain('panel');
    expect(
      [...root(fixture).querySelectorAll('[data-card]')].map((card) =>
        card.getAttribute('data-card')
      )
    ).toEqual([
      expect.stringContaining('first'),
      expect.stringContaining('second'),
    ]);
  });

  it('says so when the catalog found nothing for the words', async () => {
    const { fixture } = await render([], {
      placement: 'page',
      emptyFor: 'zzzz',
      freeText: true,
    });

    expect(root(fixture).textContent).toContain('list.add.card.noMatch');
  });
});
