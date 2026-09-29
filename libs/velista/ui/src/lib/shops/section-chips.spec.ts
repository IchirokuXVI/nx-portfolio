import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { SectionChips, type SectionChip } from './section-chips';

/** The widths a browser would measure, which jsdom never does. */
const CHIP_WIDTH = 60;
const MORE_WIDTH = 30;

/**
 * Room for the `+X` button and five chips: 30 + 5 × (4 + 60) = 350. A sixth chip
 * would need 414.
 */
const LINE_WIDTH = 350;

const NINE: readonly SectionChip[] = [
  'Fruit and veg',
  'Butcher',
  'Bakery',
  'Charcuterie',
  'Dairy',
  'Frozen',
  'Drinks',
  'Household',
  'Pets',
].map((name, at) => ({ id: `section-${at}`, name }));

let observed: ((entries: ResizeObserverEntry[]) => void) | null = null;
const realObserver = globalThis.ResizeObserver;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  observed = null;
  // The line's width arrives through a ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver = class {
    constructor(callback: (entries: ResizeObserverEntry[]) => void) {
      observed = callback;
    }
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;

  // Every ruler chip is 60 wide and the `+X` ruler 30, whatever it says.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.classList.contains('more')
      ? MORE_WIDTH
      : this.classList.contains('chip')
        ? CHIP_WIDTH
        : 0;
    return {
      width,
      height: 24,
      top: 0,
      left: 0,
      right: width,
      bottom: 24,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  globalThis.ResizeObserver = realObserver;
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

async function render(
  sections: readonly SectionChip[]
): Promise<ComponentFixture<SectionChips>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SectionChips, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(SectionChips);
  fixture.componentRef.setInput('sections', sections);
  fixture.detectChanges();
  await fixture.whenStable();

  observed?.([{ contentRect: { width: LINE_WIDTH } } as ResizeObserverEntry]);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const line = (fixture: ComponentFixture<SectionChips>) =>
  (fixture.nativeElement as HTMLElement).querySelector('.line') as HTMLElement;

const drawn = (fixture: ComponentFixture<SectionChips>) =>
  [...line(fixture).querySelectorAll('.chip')].map((chip) =>
    chip.textContent?.trim()
  );

/**
 * A shop's sections under its row (velista `0124`, target 4). `+X` counts only
 * what is not drawn, and the count is measured, never fixed.
 */
describe('SectionChips', () => {
  it('draws five of nine where five fit, and +4 for the other four', async () => {
    const fixture = await render(NINE);

    expect(drawn(fixture)).toEqual([
      'Fruit and veg',
      'Butcher',
      'Bakery',
      'Charcuterie',
      'Dairy',
    ]);
    const more = line(fixture).querySelector('.more') as HTMLButtonElement;
    expect(more.textContent?.trim()).toBe('+4');
    // Named for everything it opens: "Show all 9 sections".
    expect(more.getAttribute('aria-label')).toBe('shops.sections.more');
  });

  it('draws every section and no count when they all fit', async () => {
    const fixture = await render(NINE.slice(0, 3));

    expect(drawn(fixture)).toHaveLength(3);
    expect(line(fixture).querySelector('.more')).toBeNull();
  });

  it('opens onto every section, wrapped, ending in Show fewer, and closes again', async () => {
    const fixture = await render(NINE);

    (line(fixture).querySelector('.more') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(line(fixture).classList).toContain('is-open');
    expect(drawn(fixture)).toHaveLength(9);
    const fewer = line(fixture).querySelector('.fewer') as HTMLButtonElement;
    expect(fewer.textContent?.trim()).toBe('shops.sections.fewer');

    fewer.click();
    fixture.detectChanges();
    expect(drawn(fixture)).toHaveLength(5);
  });

  it('closes when the list changes', async () => {
    const fixture = await render(NINE);
    (line(fixture).querySelector('.more') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentRef.setInput('sections', [...NINE]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(line(fixture).classList).not.toContain('is-open');
    expect(drawn(fixture)).toHaveLength(5);
  });
});
