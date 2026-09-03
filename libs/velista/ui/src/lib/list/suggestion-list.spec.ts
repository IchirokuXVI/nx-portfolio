import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogItem,
  CatalogSuggestion,
  ProductGroup,
  ProductOffer,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import { SuggestionList } from './suggestion-list';

/**
 * The two things `placement` decides, which are the two things a panel drawn over
 * somebody's shopping list has to get right: it is opaque, and it opens at the row
 * nearest the field.
 *
 * Both were defects rather than omissions. The panel was transparent, so the lines
 * underneath read straight through the suggestions, and it opened at its first row,
 * which left the free text row, the one that is always there and always works, below
 * the fold of a scrolling list.
 */
function item(
  id: string,
  name: string,
  size: CatalogItem['size'] = null,
  unit: CatalogItem['unit'] = 'UNIT'
): CatalogItem {
  return {
    id,
    name: { es: name, en: name },
    brand: null,
    size,
    unit,
    productGroupId: null,
    // Unpriced by default, which is what staging and production are: the tests
    // that want a price say so, and every other one asserts the row a cluster
    // with the harvester off draws.
    offer: null,
  };
}

/** An offer carrying one number, for the rows that quote one. */
function offer(
  price: number | null,
  currency: string | null = 'EUR'
): ProductOffer {
  return {
    price,
    currency,
    unitPrice: null,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    priceScopeId: 'scope-cordoba',
  };
}

/** A group row, priced or not. */
function groupRow(
  name: string,
  itemIds: readonly string[],
  priced: ProductOffer | null = null
): CatalogSuggestion {
  const group: ProductGroup = {
    id: `group-${name}`,
    name: { es: name, en: name },
  };
  return { kind: 'group', group, itemIds, offer: priced };
}

function suggestions(count: number): readonly CatalogSuggestion[] {
  return Array.from({ length: count }, (_unused, index) => ({
    kind: 'item' as const,
    item: item(`item-${index}`, `Product ${index}`),
  }));
}

/** The names in a set of suggestions, for asserting the caller's own array is intact. */
function offeredNames(offered: readonly CatalogSuggestion[]): string[] {
  return offered.map((suggestion) =>
    suggestion.kind === 'item'
      ? suggestion.item.name.en
      : suggestion.group.name.en
  );
}

/**
 * Give an element a scroll position, which jsdom otherwise reports as zero on
 * everything because it lays nothing out.
 */
function fakeScroll(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
): void {
  let top = metrics.scrollTop;

  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
}

async function render(
  offered: readonly CatalogSuggestion[],
  placement: 'below' | 'above',
  asWritten: string | null = null
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [SuggestionList, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(SuggestionList);
  fixture.componentRef.setInput('suggestions', offered);
  fixture.componentRef.setInput('placement', placement);
  fixture.componentRef.setInput('asWritten', asWritten);
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function panel(fixture: ComponentFixture<SuggestionList>): HTMLElement {
  const found = (
    fixture.nativeElement as HTMLElement
  ).querySelector<HTMLElement>('ul.suggestions');
  if (found === null) {
    throw new Error('nothing was drawn');
  }
  return found;
}

/** The rows themselves, top to bottom as they are drawn. */
function rows(fixture: ComponentFixture<SuggestionList>): HTMLElement[] {
  return [...panel(fixture).querySelectorAll<HTMLElement>('button.suggestion')];
}

/** The name on every row, top to bottom, which is what pins the drawn order. */
function names(fixture: ComponentFixture<SuggestionList>): string[] {
  return rows(fixture).map(
    (row) =>
      row.querySelector<HTMLElement>('.suggestion-name')?.textContent?.trim() ??
      ''
  );
}

/**
 * Every note element drawn, in row order, and **one entry per row that has one**.
 *
 * The count matters as much as the text: a priced row and an unpriced one are the
 * same one line, so a change that put a price under the note rather than after it
 * would show up here as an extra element rather than as different words.
 */
function notes(fixture: ComponentFixture<SuggestionList>): string[] {
  return [
    ...panel(fixture).querySelectorAll<HTMLElement>('.suggestion-note'),
  ].map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** Every size drawn, as the translation key the testing translator hands back. */
function sizes(fixture: ComponentFixture<SuggestionList>): string[] {
  return [
    ...panel(fixture).querySelectorAll<HTMLElement>('.suggestion-size'),
  ].map((element) => element.textContent?.trim() ?? '');
}

/** One of the suggestions handed in, for asserting on `sizeOf` directly. */
function offered(
  fixture: ComponentFixture<SuggestionList>,
  index: number
): CatalogSuggestion {
  const found = fixture.componentInstance.suggestions()[index];
  if (found === undefined) {
    throw new Error(`no suggestion at ${index}`);
  }
  return found;
}

describe('SuggestionList, where it goes is the caller’s', () => {
  it('is a panel over the page when it is placed above its field', async () => {
    const fixture = await render(suggestions(3), 'above');

    // The class is what carries the surface, the hairline and the elevation. Those
    // are tokens and belong to the theme, so what is asserted here is that the panel
    // treatment is applied at all.
    expect(panel(fixture).classList).toContain('above');
  });

  it('stays on the page’s own ground when it is placed below', async () => {
    const fixture = await render(suggestions(3), 'below');

    // The line page's search sits under the chips with nothing in the way, so it has
    // nothing to cover and nothing to be opaque against.
    expect(panel(fixture).classList).not.toContain('above');
  });

  it('opens at its last row, so the free text row is the one on screen', async () => {
    const fixture = await render(suggestions(20), 'above', 'olive oil');
    const drawn = panel(fixture);
    fakeScroll(drawn, { scrollHeight: 640, clientHeight: 240, scrollTop: 0 });

    // A second set of results, one keystroke later. The panel re-anchors rather than
    // staying wherever the list it replaced happened to be scrolled to: a position
    // from a query nobody is typing any more is not a place anybody chose to be.
    fixture.componentRef.setInput('suggestions', suggestions(18));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(drawn.scrollTop).toBe(640);
  });

  it('leaves an inline list at the top of the ranking', async () => {
    const fixture = await render(suggestions(20), 'below');
    const drawn = panel(fixture);
    fakeScroll(drawn, { scrollHeight: 640, clientHeight: 240, scrollTop: 0 });

    fixture.componentRef.setInput('suggestions', suggestions(18));
    fixture.detectChanges();
    await fixture.whenStable();

    // Scrolling a list that grows downward to its end would hide the top of the
    // server's ranking behind the worst answers in it.
    expect(drawn.scrollTop).toBe(0);
  });
});

/**
 * Which end of the server's ranking sits nearest the field, which is decided by the
 * placement and by nothing else.
 *
 * The panel over the composer opens at its **last** row, so the row nearest the field
 * is the one everybody sees first and the list climbs away from there. Drawn top to
 * bottom, that put the server's best answer at the far end of a list that usually
 * needs scrolling, which is the defect this pins. The ranking itself is untouched: it
 * is the same order, read the way the panel is read.
 */
describe('SuggestionList, which end of the ranking is nearest the field', () => {
  it('climbs away from the field when it is placed above, best answer first', async () => {
    const fixture = await render(suggestions(3), 'above', 'olive oil');

    // Read from the bottom: the free text row, then the server's first suggestion
    // directly above it, then the rest of the ranking climbing away.
    expect(names(fixture)).toEqual([
      'Product 2',
      'Product 1',
      'Product 0',
      'list.add.asWritten',
    ]);
  });

  it('keeps the free text row last when there is nothing to offer above it', async () => {
    const fixture = await render([], 'above', 'olive oil');

    expect(names(fixture)).toEqual(['list.add.asWritten']);
  });

  it('reads straight down when it is placed below, where the field is above it', async () => {
    const fixture = await render(suggestions(3), 'below');

    expect(names(fixture)).toEqual(['Product 0', 'Product 1', 'Product 2']);
  });

  it('leaves the caller’s array alone rather than reversing it in place', async () => {
    // `reverse` mutates, and the array handed in belongs to whoever fetched it. A
    // component that reversed it in place would flip the caller's own copy once per
    // render and settle on whichever parity the last pass left behind.
    const offered = suggestions(3);
    const fixture = await render(offered, 'above');

    expect(names(fixture)).toEqual(['Product 2', 'Product 1', 'Product 0']);
    expect(fixture.componentInstance.suggestions()).toBe(offered);
    expect(offeredNames(offered)).toEqual([
      'Product 0',
      'Product 1',
      'Product 2',
    ]);
  });
});

/**
 * How big the packet is, which is the field that stops the list drawing the same row
 * three times.
 *
 * The catalog holds **one record per size**, so a search for "leche" answers with the
 * same name and the same brand once per carton. Every field a row drew was identical
 * across those records, and the result read as a search returning duplicates rather
 * than as three genuinely different cartons.
 *
 * The rendered text is the translation **key**, because the testing translator returns
 * keys rather than copy. That is the useful assertion anyway: which unit was named is
 * the part a spec should pin, and the number that goes in it is asserted through
 * `sizeOf` rather than read back out of interpolated text.
 */
describe('SuggestionList, how big the packet is', () => {
  it('tells two records of the same product apart by their size alone', async () => {
    // The case reported against the composer: one product, two rows, and until the
    // size was drawn nothing on screen distinguished them.
    const fixture = await render(
      [
        { kind: 'item', item: item('item-milk-1l', 'Whole milk', 1, 'LITER') },
        {
          kind: 'item',
          item: item('item-milk-half', 'Whole milk', 0.5, 'LITER'),
        },
      ],
      'above'
    );

    // Both rows carry a size, which is the half the DOM can prove: the number inside
    // it is interpolated by the translator, and the testing one returns the key.
    expect(rows(fixture)).toHaveLength(2);
    expect(sizes(fixture)).toEqual([
      'list.add.size.LITER',
      'list.add.size.LITER',
    ]);

    // The half that actually distinguishes them, asserted where it is decided rather
    // than read back out of interpolated text.
    const component = fixture.componentInstance;
    expect(component.sizeOf(offered(fixture, 0))).toEqual({
      key: 'list.add.size.LITER',
      args: { size: '1' },
    });
    expect(component.sizeOf(offered(fixture, 1))).toEqual({
      key: 'list.add.size.LITER',
      args: { size: '0.5' },
    });
  });

  it('says nothing when the catalog does not know the size', async () => {
    // An ordinary state for a harvested product, and the row has to draw nothing
    // rather than guess a packet nobody measured.
    const fixture = await render(
      [{ kind: 'item', item: item('item-bread', 'Sliced bread') }],
      'below'
    );

    expect(sizes(fixture)).toEqual([]);
  });

  it('draws a mass or a volume below one, which is where most sizes are', async () => {
    // The rule that a naive "greater than one" check would get exactly backwards:
    // 0.35 kg beside 1 kg is the commonest way two records of one product differ.
    const fixture = await render(
      [{ kind: 'item', item: item('item-rice', 'Rice', 0.35, 'KILOGRAM') }],
      'below'
    );

    expect(sizes(fixture)).toEqual(['list.add.size.KILOGRAM']);
    expect(fixture.componentInstance.sizeOf(offered(fixture, 0))).toEqual({
      key: 'list.add.size.KILOGRAM',
      args: { size: '0.35' },
    });
  });

  it('draws a count worth having and suppresses a count of one', async () => {
    // Twelve eggs is worth a row's width. One of a thing is what every product is,
    // so it would appear on half the catalog and distinguish nothing.
    const fixture = await render(
      [
        { kind: 'item', item: item('item-eggs', 'Eggs', 12, 'UNIT') },
        { kind: 'item', item: item('item-lettuce', 'Lettuce', 1, 'UNIT') },
      ],
      'below'
    );

    expect(sizes(fixture)).toEqual(['list.add.size.UNIT']);
  });

  it('never puts a size on a group, which is sizes rather than one of them', async () => {
    const fixture = await render(
      [groupRow('Milk', ['item-milk-1l', 'item-milk-half'])],
      'below'
    );

    // Quoting one member's carton would name a product the row does not add: choosing
    // a group attaches every one of them.
    expect(sizes(fixture)).toEqual([]);
    expect(fixture.componentInstance.sizeOf(offered(fixture, 0))).toBeNull();
  });
});

/**
 * What a product costs, on the three screens that search the catalog (velista
 * `0063`).
 *
 * The numbers were on the wire from backend `0048` and dropped at the mapper, so
 * every typeahead in the app answered with a catalog and no prices.
 *
 * The rule the whole block turns on: **a row with a price and a row without are
 * the same shape.** No layout may depend on a price existing, because in staging
 * and production the harvester is off and no row has one.
 */
describe('SuggestionList, what the row says it costs', () => {
  const priced = (
    id: string,
    name: string,
    brand: string | null,
    price: number | null
  ): CatalogSuggestion => ({
    kind: 'item',
    item: { ...item(id, name, 1, 'LITER'), brand, offer: offer(price) },
  });

  it('puts the price after the brand on the note line, joined by the separator', async () => {
    const fixture = await render(
      [priced('item-milk-1l', 'Whole milk', 'Hacendado', 1.05)],
      'below'
    );

    // A brand and a formatted number are both plain data, so the note is safe to
    // read off the DOM: nothing on an item row goes through a key.
    expect(notes(fixture)).toEqual([
      `Hacendado · ${formatMoney(1.05, 'EUR', 'en')}`,
    ]);
    expect(notes(fixture)[0]).toContain('1.05');
  });

  it('draws the brand alone where nothing has been harvested', async () => {
    // Every row in staging and production, and the assertion that this plan left
    // those two clusters looking exactly as they looked before it.
    const fixture = await render(
      [
        {
          kind: 'item',
          item: { ...item('item-milk-1l', 'Whole milk'), brand: 'Hacendado' },
        },
      ],
      'below'
    );

    expect(notes(fixture)).toEqual(['Hacendado']);
  });

  /**
   * A scope can carry a product with no number on it, which maps to an offer
   * whose price is null rather than to no offer. It draws the same nothing, and
   * that is one branch rather than a scattering of them.
   */
  it('draws the brand alone for an offer that carries no number', async () => {
    const fixture = await render(
      [priced('item-milk-1l', 'Whole milk', 'Hacendado', null)],
      'below'
    );

    expect(notes(fixture)).toEqual(['Hacendado']);
  });

  it('draws the money alone for a product with no brand', async () => {
    const fixture = await render(
      [priced('item-oil', 'Olive oil', null, 1.19)],
      'below'
    );

    expect(notes(fixture)).toEqual([formatMoney(1.19, 'EUR', 'en')]);
  });

  /**
   * **No empty state, no placeholder, no dash.** A product with neither a brand
   * nor a price says nothing at all, and the note element is absent rather than
   * present and blank.
   */
  it('draws no note element at all for a row with neither', async () => {
    const fixture = await render(
      [{ kind: 'item', item: item('item-bread', 'Sliced bread') }],
      'below'
    );

    expect(rows(fixture)).toHaveLength(1);
    expect(notes(fixture)).toEqual([]);
  });

  /**
   * The packet size lives at the row's end and is the only field telling two
   * otherwise identical records apart, so the price may never be put beside it.
   */
  it('leaves the size badge exactly where it was', async () => {
    const withPrice = await render(
      [priced('item-milk-1l', 'Whole milk', 'Hacendado', 1.05)],
      'below'
    );
    const without = await render(
      [{ kind: 'item', item: item('item-milk-1l', 'Whole milk', 1, 'LITER') }],
      'below'
    );

    expect(sizes(withPrice)).toEqual(['list.add.size.LITER']);
    expect(sizes(without)).toEqual(sizes(withPrice));
  });
});

/**
 * A group row's price, which is labelled where an item's is bare (section 6.6).
 *
 * A group adds several products and no single price among them is what the row
 * costs, so a bare number under one would read like an item's and mean something
 * else. "Best price" says the number is the floor rather than the total.
 */
describe('SuggestionList, the best price on a group row', () => {
  it('follows the "adds N" note on one line, in that order', async () => {
    const fixture = await render(
      [groupRow('Milk', ['item-milk-1l', 'item-milk-half'], offer(1.05))],
      'below'
    );

    // Both halves are copy, so the testing translator hands back the keys and
    // the order is what the DOM can prove. The number is asserted below, off
    // the method, because the key interpolates and the testing translator does
    // not.
    expect(notes(fixture)).toEqual(['list.add.groupAdds · list.add.bestPrice']);
  });

  it('says the number in the reader’s language, under the label key', async () => {
    const fixture = await render(
      [groupRow('Milk', ['item-milk-1l'], offer(1.05))],
      'below'
    );

    expect(fixture.componentInstance.bestPriceOf(offered(fixture, 0))).toEqual({
      key: 'list.add.bestPrice',
      args: { price: formatMoney(1.05, 'EUR', 'en') },
    });
  });

  it('draws the note it draws today for a group with no priced member', async () => {
    const fixture = await render([groupRow('Oil', ['item-oil-1l'])], 'below');

    expect(notes(fixture)).toEqual(['list.add.groupAdds']);
    expect(
      fixture.componentInstance.bestPriceOf(offered(fixture, 0))
    ).toBeNull();
  });

  /**
   * Section 6.6's one line rule, asserted rather than described: a priced group
   * row and an unpriced one have the **same** note element and the same count of
   * them, so the two rows are the same height.
   */
  it('is one note element whether the group is priced or not', async () => {
    const withPrice = await render(
      [groupRow('Milk', ['item-milk-1l'], offer(1.05))],
      'below'
    );
    const without = await render([groupRow('Milk', ['item-milk-1l'])], 'below');

    expect(notes(withPrice)).toHaveLength(1);
    expect(notes(without)).toHaveLength(notes(withPrice).length);
  });

  /**
   * The order is the server's ranking and nothing here re-sorts it. The fixture's
   * cheapest row is deliberately not its first, so a change that let a price
   * influence the order would move it.
   */
  it('lets no price touch the order the server sent', async () => {
    const fixture = await render(
      [
        groupRow('Milk', ['item-milk-1l'], offer(1.05)),
        {
          kind: 'item',
          item: {
            ...item('item-milk-6', 'Six pack', 6, 'LITER'),
            offer: offer(5.45),
          },
        },
        {
          kind: 'item',
          item: {
            ...item('item-milk-half', 'Half litre', 0.5, 'LITER'),
            offer: offer(0.69),
          },
        },
      ],
      'below'
    );

    expect(names(fixture)).toEqual(['Milk', 'Six pack', 'Half litre']);
  });
});
