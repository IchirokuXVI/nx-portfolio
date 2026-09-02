import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { CatalogItem, CatalogSuggestion } from '@portfolio/velista/models';
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
  };
}

function suggestions(count: number): readonly CatalogSuggestion[] {
  return Array.from({ length: count }, (_unused, index) => ({
    kind: 'item' as const,
    item: item(`item-${index}`, `Product ${index}`),
  }));
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

/** The rows themselves, in the order the server put them in. */
function rows(fixture: ComponentFixture<SuggestionList>): HTMLElement[] {
  return [...panel(fixture).querySelectorAll<HTMLElement>('button.suggestion')];
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
      [
        {
          kind: 'group',
          group: {
            id: 'group-milk',
            name: { es: 'Leche', en: 'Milk' },
            itemCount: 3,
          },
          itemIds: ['item-milk-1l', 'item-milk-half'],
        },
      ],
      'below'
    );

    // Quoting one member's carton would name a product the row does not add: choosing
    // a group attaches every one of them.
    expect(sizes(fixture)).toEqual([]);
    expect(fixture.componentInstance.sizeOf(offered(fixture, 0))).toBeNull();
  });
});
