import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ChipRow, fitChips, type ChipRowItem } from './chip-row';

/**
 * The chip row, and the one rule it exists to keep: **one line, never two**
 * (velista `0075`, section 5).
 *
 * The fit itself is tested through {@link fitChips} rather than through a rendered
 * row, because jsdom lays nothing out: every element measures zero, so a spec that
 * rendered eight chips and counted them would be asserting that jsdom has no
 * layout. What the rendered tests cover is everything that does not need a width.
 */
describe('fitChips', () => {
  it('draws every chip when they all fit', () => {
    expect(fitChips([100, 80], 40, 400)).toBe(2);
  });

  /** Exactly the room they need, gap included: 100 + 8 + 80 is 188. */
  it('draws every chip at exactly the room they need', () => {
    expect(fitChips([100, 80], 40, 188)).toBe(2);
  });

  it('drops what does not fit and leaves room for the +N chip', () => {
    // 187 is one pixel short of the pair, so the +N chip is certain: 40 for it, then
    // 8 and 100 for the first chip is 148, and the second would make 236.
    expect(fitChips([100, 80], 40, 187)).toBe(1);
  });

  it('draws no chip at all rather than one that does not fit', () => {
    expect(fitChips([100, 80], 40, 120)).toBe(0);
  });

  /**
   * Before the first `ResizeObserver` callback there is no width, and collapsing
   * every chip into a `+N` for one frame would be a visible flash of the wrong
   * answer. Drawing too many is invisible, because the row clips.
   */
  it('draws every chip while the row is unmeasured', () => {
    expect(fitChips([100, 80], 40, 0)).toBe(2);
  });

  it('draws nothing for no chips', () => {
    expect(fitChips([], 40, 400)).toBe(0);
  });
});

describe('ChipRow', () => {
  const CHIPS: readonly ChipRowItem[] = [
    { id: 'order', label: 'A to Z', removeLabel: 'Remove: A to Z' },
    {
      id: 'lists',
      label: 'Only Groceries',
      removeLabel: 'Remove: Only Groceries',
    },
  ];

  function render(chips: readonly ChipRowItem[], count: string | null = null) {
    // Reset first, so one test may render the row twice: the count is drawn or not
    // drawn, and asserting both halves in one place is what keeps the rule legible.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ChipRow, RokuTranslatorTestingModule.forTesting()],
    });

    const fixture = TestBed.createComponent(ChipRow);
    fixture.componentRef.setInput('chips', chips);
    fixture.componentRef.setInput('count', count);
    fixture.detectChanges();
    return fixture;
  }

  it('draws one button per chip, named by what removing it does', () => {
    const fixture = render(CHIPS);

    const chips = fixture.debugElement
      .queryAll(By.css('.row .chip'))
      .map((node) => node.nativeElement as HTMLButtonElement);

    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute('aria-label')).toBe('Remove: A to Z');
    expect(chips[1].getAttribute('aria-label')).toBe('Remove: Only Groceries');
  });

  it('reports which chip was pressed', () => {
    const fixture = render(CHIPS);
    const removed: string[] = [];
    fixture.componentInstance.remove.subscribe((id) => removed.push(id));

    fixture.debugElement
      .queryAll(By.css('.row .chip'))[1]
      .nativeElement.click();

    expect(removed).toEqual(['lists']);
  });

  it('draws nothing at all for no chips', () => {
    const fixture = render([]);

    expect(fixture.debugElement.queryAll(By.css('.row .chip'))).toHaveLength(0);
    expect(fixture.debugElement.query(By.css('.row .chip-more'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.ruler .chip'))).toBeNull();
  });

  it('draws the count only when it is given one', () => {
    expect(render(CHIPS).debugElement.query(By.css('.count'))).toBeNull();

    const fixture = render(CHIPS, '7 of 12');
    expect(
      (
        fixture.debugElement.query(By.css('.count'))
          .nativeElement as HTMLElement
      ).textContent
    ).toContain('7 of 12');
  });

  /**
   * The measuring row is what makes the fit possible, and it must never be reachable:
   * it holds a second copy of every chip's words.
   */
  it('hides the measuring row from the accessibility tree and holds no buttons in it', () => {
    const fixture = render(CHIPS);

    const ruler = fixture.debugElement.query(By.css('.ruler'));
    expect(ruler.attributes['aria-hidden']).toBe('true');
    expect(ruler.queryAll(By.css('button'))).toHaveLength(0);
    // Every chip, not only the ones that fit, or there would be nothing to measure.
    expect(ruler.queryAll(By.css('.chip'))).toHaveLength(CHIPS.length + 1);
  });
});
