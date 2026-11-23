import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { join } from 'node:path';
import { compile } from 'sass';
import { LineList } from './line-list';

function vm(id: string): LineRowVm {
  return {
    id,
    content: `Line ${id}`,
    quantity: 1,
    approvalStatus: 'APPROVED',
    settled: false,
    indicators: [],
    claimedBy: null,
    captionKey: null,
    write: 'none',
    overwrittenBy: null,
    interactive: true,
    adjustable: true,
    decidable: false,
    restorable: false,
    editor: null,
  };
}

const LINES = ['a', 'b', 'c'].map(vm);

function render(): ComponentFixture<LineList> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LineList, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(LineList);
  fixture.componentRef.setInput('lines', LINES);
  fixture.detectChanges();

  return fixture;
}

function rows(fixture: ComponentFixture<LineList>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.line')
  );
}

/**
 * The rows in the order they are given, each under its id, with nothing to drag
 * (velista `0189`, section 6: the reorder mode went, and the grip and the drag with it).
 */
describe('LineList', () => {
  it('draws one row per line, in order, each under its id', () => {
    const fixture = render();

    expect(rows(fixture).map((row) => row.dataset['lineId'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('draws no grip and moves no row under a pointer', () => {
    const fixture = render();

    expect(fixture.nativeElement.querySelector('.grip-handle')).toBeNull();
    for (const row of rows(fixture)) {
      expect(row.style.transform).toBe('');
    }
  });

  it('marks the line a link asked for, and only that one', () => {
    const fixture = render();
    fixture.componentRef.setInput('markedId', 'b');
    fixture.detectChanges();

    expect(
      rows(fixture).map((row) => row.classList.contains('marked'))
    ).toEqual([false, true, false]);
  });
});

/** Velista `0191`: the layout the device chose reaches every row. */
describe('LineList layout (velista 0191)', () => {
  function drawn(layout?: 'default' | 'compact') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LineList, RokuTranslatorTestingModule.forTesting()],
    });
    const fixture = TestBed.createComponent(LineList);
    fixture.componentRef.setInput('lines', LINES);
    if (layout !== undefined) {
      fixture.componentRef.setInput('layout', layout);
    }
    fixture.detectChanges();
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        'lib-line-row .row'
      )
    );
  }

  it('draws the row of the default view by default (velista 0202)', () => {
    const drawnRows = drawn();

    expect(drawnRows).toHaveLength(LINES.length);
    expect(drawnRows.some((row) => row.classList.contains('compact'))).toBe(
      false
    );
  });

  it('passes compact to every row', () => {
    const drawnRows = drawn('compact');

    expect(drawnRows).toHaveLength(LINES.length);
    expect(drawnRows.every((row) => row.classList.contains('compact'))).toBe(
      true
    );
  });
});

/**
 * Velista `0207`: the question about the extra already bought is held beside the
 * row, not in it. The row is a button, whose content a screen reader does not see,
 * so each item carries a mark of its own for the popover to be inserted after, and
 * the item carries the colour of the popover's hairline while it flashes.
 */
describe('LineList: where the question about the extra is held (velista 0207)', () => {
  it('gives each item a mark outside the row, hidden from a screen reader', () => {
    const fixture = render();
    for (const item of rows(fixture)) {
      const mark = item.querySelector<HTMLElement>(
        ':scope > [data-ask-anchor]'
      );
      expect(mark).not.toBeNull();
      expect(mark?.getAttribute('aria-hidden')).toBe('true');
      expect(mark?.closest('[role="button"]')).toBeNull();
    }
  });

  it('marks the asked item, and flashes only it', () => {
    const fixture = render();
    fixture.componentRef.setInput('askedId', 'b');
    fixture.componentRef.setInput('flashing', true);
    fixture.detectChanges();

    expect(rows(fixture).map((row) => row.className)).toEqual([
      'line',
      'line asked flash',
      'line',
    ]);
  });

  it('pulses the hairline on the row wash clock, and holds it still under reduced motion (spec 12)', () => {
    const css = compile(join(__dirname, 'line-list.scss')).css;
    const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
      selector: match[1].replace(/\s+/g, ' ').trim(),
      body: match[2],
    }));
    const flash = rules
      .filter((one) => one.selector === '.line.asked.flash')
      .map((one) => one.body);

    expect(flash[0]).toMatch(
      /--anchored-popover-accent:\s*var\(--line-list-ask-accent\);/
    );
    expect(flash[0]).toMatch(/animation:\s*ask-accent 2200ms linear both;/);
    // The reduced motion frame: nothing animates, the hairline held in the accent.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.line\.asked\.flash\s*\{[^}]*--anchored-popover-accent:\s*var\(--app-action-quiet-fg\);[^}]*animation:\s*none;/
    );
  });
});
