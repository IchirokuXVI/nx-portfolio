import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
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

  it('draws the row of today by default', () => {
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
