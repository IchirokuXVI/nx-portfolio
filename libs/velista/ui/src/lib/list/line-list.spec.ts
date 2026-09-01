import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { LineRowVm } from '@portfolio/velista/models';
import { LineList } from './line-list';

/** A row's height, and the gap under it, as the stubbed geometry lays them out. */
const ROW_HEIGHT = 60;
const ROW_STEP = 64;

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
    actions: [],
    editScope: null,
    decidable: false,
    restorable: false,
    editor: null,
  };
}

const LINES = ['a', 'b', 'c', 'd', 'e'].map(vm);

/**
 * jsdom lays nothing out, so every rect is zero and the whole calculation degenerates.
 * The rows are given the geometry a phone would give them instead: five 60px rows, 4px
 * apart. That is the input the index maths actually reads, so stubbing it is stubbing
 * the browser and not the component.
 */
function render(): ComponentFixture<LineList> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LineList, RokuTranslatorTestingModule.forTesting()],
  });

  const fixture = TestBed.createComponent(LineList);
  fixture.componentRef.setInput('lines', LINES);
  fixture.componentRef.setInput('reordering', true);
  fixture.detectChanges();

  rows(fixture).forEach((row, index) => {
    row.getBoundingClientRect = () =>
      ({
        top: index * ROW_STEP,
        height: ROW_HEIGHT,
        bottom: index * ROW_STEP + ROW_HEIGHT,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: index * ROW_STEP,
        toJSON: () => ({}),
      }) as DOMRect;
  });

  return fixture;
}

function rows(fixture: ComponentFixture<LineList>): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.line')
  );
}

/** A pointer event jsdom will construct, since it has no `PointerEvent`. */
function pointer(type: string, clientY: number): PointerEvent {
  const event = new MouseEvent(type, {
    clientY,
    bubbles: true,
  }) as unknown as { pointerId: number };
  event.pointerId = 1;

  return event as unknown as PointerEvent;
}

/** Take hold of row `index`'s grip, at the vertical middle of that row. */
function grab(fixture: ComponentFixture<LineList>, index: number): number {
  const grip = rows(fixture)[index].querySelector(
    '.grip-handle'
  ) as HTMLElement;
  grip.setPointerCapture = () => undefined;

  const startY = index * ROW_STEP + ROW_HEIGHT / 2;
  grip.dispatchEvent(pointer('pointerdown', startY));
  fixture.detectChanges();

  return startY;
}

function moveTo(fixture: ComponentFixture<LineList>, clientY: number): void {
  fixture.nativeElement.dispatchEvent(pointer('pointermove', clientY));
  fixture.detectChanges();
}

function release(
  fixture: ComponentFixture<LineList>,
  type = 'pointerup'
): void {
  fixture.nativeElement.dispatchEvent(pointer(type, 0));
  fixture.detectChanges();
}

/**
 * Plan 0012 gave the list a manual order and a grip to set it with, and the grip
 * answered its two arrows and nothing else: the drag it draws went to the browser,
 * which read it as a scroll. Reaching the bottom of a dozen lines meant a dozen taps.
 *
 * These are about the index the drag lands on, because that is the part a refactor can
 * quietly get wrong and a screenshot cannot check. The transforms are asserted with it,
 * since a landing index the rows do not agree with is a list that snaps somewhere the
 * finger never went.
 */
describe('LineList reordering by drag', () => {
  it('follows the finger and lifts the row it is on', () => {
    const fixture = render();
    const startY = grab(fixture, 0);

    moveTo(fixture, startY + 40);

    expect(rows(fixture)[0].style.transform).toBe('translateY(40px)');
    expect(rows(fixture)[0].classList.contains('lifted')).toBe(true);
    expect(rows(fixture)[1].classList.contains('shifting')).toBe(true);
  });

  it('opens a gap by moving the row it has passed the other way', () => {
    // Past the second row's midpoint, so the drag is now asking to be second.
    const fixture = render();
    const startY = grab(fixture, 0);

    moveTo(fixture, startY + 70);

    expect(rows(fixture)[1].style.transform).toBe(`translateY(-${ROW_STEP}px)`);
    // Untouched: the drag has not reached them.
    expect(rows(fixture)[2].style.transform).toBe('');
  });

  it('asks for the index it landed on, once, when the finger comes off', () => {
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    const startY = grab(fixture, 0);
    moveTo(fixture, startY + 70);
    moveTo(fixture, startY + 140);
    release(fixture);

    // One request for the whole move, not one per row it crossed.
    expect(moves).toEqual([{ lineId: 'a', to: 2 }]);
  });

  it('reads an upward drag the same way', () => {
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    const startY = grab(fixture, 3);
    moveTo(fixture, startY - 70);
    release(fixture);

    expect(moves).toEqual([{ lineId: 'd', to: 2 }]);
    expect(rows(fixture)[2].style.transform).toBe('');
  });

  it('cannot be dragged past the ends of the list', () => {
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    const startY = grab(fixture, 4);
    moveTo(fixture, startY + 900);
    release(fixture);

    // Already last. A drag off the bottom of the screen asks for nothing.
    expect(moves).toEqual([]);
  });

  it('asks for nothing when the row lands where it started', () => {
    // The ending of an accidental drag, and of a deliberate one thought better of.
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    const startY = grab(fixture, 1);
    moveTo(fixture, startY + 20);
    moveTo(fixture, startY + 2);
    release(fixture);

    expect(moves).toEqual([]);
  });

  it('asks for nothing when the browser takes the gesture over', () => {
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    const startY = grab(fixture, 0);
    moveTo(fixture, startY + 140);
    release(fixture, 'pointercancel');

    expect(moves).toEqual([]);
  });

  it('drops every transform as soon as the drag ends', () => {
    // The container answers by reordering the lines. A row still carrying its offset
    // would be drawn a row away from where its new index puts it.
    const fixture = render();
    const startY = grab(fixture, 0);
    moveTo(fixture, startY + 140);
    release(fixture);

    for (const row of rows(fixture)) {
      expect(row.style.transform).toBe('');
      expect(row.classList.contains('lifted')).toBe(false);
      expect(row.classList.contains('shifting')).toBe(false);
    }
  });

  it('ignores a pointer that never took hold of a grip', () => {
    const fixture = render();
    const moves: { lineId: string; to: number }[] = [];
    fixture.componentInstance.reorderTo.subscribe((move) => moves.push(move));

    moveTo(fixture, 400);
    release(fixture);

    expect(moves).toEqual([]);
    expect(rows(fixture)[0].style.transform).toBe('');
  });
});
