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
function item(id: string, name: string): CatalogItem {
  return {
    id,
    name: { es: name, en: name },
    brand: null,
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
