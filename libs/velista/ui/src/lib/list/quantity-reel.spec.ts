import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  QUANTITY_REEL_IDLE_MS,
  QUANTITY_REEL_PX_PER_UNIT,
} from '@portfolio/velista/models';
import { QuantityReel } from './quantity-reel';

/**
 * The gesture, which is the one thing in velista plan 0043 that a static frame cannot
 * approve and a reading cannot verify.
 *
 * Every case here is section 4 or section 8 stated as an assertion, and the two that
 * matter most are about **when a request is sent** rather than about what is drawn:
 * one delta per settled adjustment, and nothing at all for a gesture that ended where
 * it began. Those are the properties that keep a moving control from racing itself
 * over the wire, and they are invisible on screen.
 *
 * jsdom has no `PointerEvent` and no pointer capture, so both are stood in for: the
 * events are `MouseEvent`s carrying the two fields the component reads, and the
 * capture call is optional at the call site precisely so this runs.
 */
function pointer(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

async function render(
  value: number,
  options: { readonly?: boolean } = {}
): Promise<{
  fixture: ComponentFixture<QuantityReel>;
  host: HTMLElement;
  deltas: number[];
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [QuantityReel],
  }).compileComponents();

  const fixture = TestBed.createComponent(QuantityReel);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('label', 'How many Milk');
  if (options.readonly !== undefined) {
    fixture.componentRef.setInput('readonly', options.readonly);
  }
  fixture.detectChanges();

  const deltas: number[] = [];
  fixture.componentInstance.committed.subscribe((delta) => deltas.push(delta));

  return { fixture, host: fixture.nativeElement as HTMLElement, deltas };
}

/** One whole drag: down, move by `units`, up. Leftwards is more (section 4). */
function drag(host: HTMLElement, units: number): void {
  host.dispatchEvent(pointer('pointerdown', 0));
  host.dispatchEvent(
    pointer('pointermove', -units * QUANTITY_REEL_PX_PER_UNIT)
  );
  host.dispatchEvent(pointer('pointerup', -units * QUANTITY_REEL_PX_PER_UNIT));
}

function key(host: HTMLElement, name: string): void {
  host.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

describe('QuantityReel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('the drag', () => {
    it('takes a line from 2 to 5 in one uninterrupted drag', async () => {
      // Acceptance: "One uninterrupted drag takes a line from 2 to 5." Three units at
      // 40px is 120px, which is well inside the ~280px of comfortable thumb travel a
      // 390px phone has.
      const { fixture, host, deltas } = await render(2);

      drag(host, 3);
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(5);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([3]);
    });

    it('follows the finger one to one, with no acceleration', async () => {
      const { fixture, host } = await render(0);

      host.dispatchEvent(pointer('pointerdown', 0));
      for (const units of [1, 2, 3, 7]) {
        host.dispatchEvent(
          pointer('pointermove', -units * QUANTITY_REEL_PX_PER_UNIT)
        );
        fixture.detectChanges();
        expect(fixture.componentInstance.shown()).toBe(units);
      }
    });

    it('goes the other way when the finger goes the other way', async () => {
      const { fixture, host, deltas } = await render(6);

      drag(host, -4);
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(2);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([-4]);
    });

    it('snaps to the nearest whole number rather than sitting between two', async () => {
      const { fixture, host } = await render(1);

      host.dispatchEvent(pointer('pointerdown', 0));
      // Just over halfway to the next one.
      host.dispatchEvent(
        pointer('pointermove', -(QUANTITY_REEL_PX_PER_UNIT * 0.6))
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(2);
    });

    it('cannot be driven below zero however far the finger goes', async () => {
      // Zero is the floor and the end of the gesture, not a refusal: a line at zero is
      // the household saying it is stocked.
      const { fixture, host, deltas } = await render(2);

      drag(host, -20);
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(0);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([-2]);
    });
  });

  describe('the overlay, and when the delta goes out', () => {
    it('stays up after the thumb lifts, then closes', async () => {
      const { fixture, host } = await render(2);

      drag(host, 1);
      fixture.detectChanges();
      expect(fixture.componentInstance.open()).toBe(true);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      fixture.detectChanges();
      expect(fixture.componentInstance.open()).toBe(false);
    });

    it('sends nothing until it closes', async () => {
      const { fixture, host, deltas } = await render(2);

      drag(host, 3);
      fixture.detectChanges();

      // The number is on screen and nothing has been sent: the close is the commit.
      expect(fixture.componentInstance.shown()).toBe(5);
      expect(deltas).toEqual([]);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([3]);
    });

    it('continues from the snapped number when a second drag lands inside the beat', async () => {
      const { fixture, host, deltas } = await render(2);

      drag(host, 2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS / 2);
      drag(host, 1);
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(5);
      expect(deltas).toEqual([]);

      // **One** request for the whole run, not one per drag. This is the property that
      // keeps a thumb going back for more from becoming a burst of writes.
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([3]);
    });

    it('sends nothing at all when the run ends where it began', async () => {
      const { host, deltas } = await render(4);

      drag(host, 2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS / 2);
      drag(host, -2);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      // A delta of zero is a 400, and a gesture that changed nothing is not an
      // adjustment to report.
      expect(deltas).toEqual([]);
    });
  });

  /** Section 7: a gesture is never the only way to do anything. */
  describe('the keyboard', () => {
    it('steps by one on the arrows, in the direction the role requires', async () => {
      const { fixture, host, deltas } = await render(2);

      key(host, 'ArrowUp');
      key(host, 'ArrowRight');
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(4);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([2]);
    });

    it('steps by five on the page keys', async () => {
      const { fixture, host, deltas } = await render(1);

      key(host, 'PageUp');
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(6);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([5]);
    });

    it('commits a run of presses as one delta', async () => {
      const { host, deltas } = await render(0);

      for (let i = 0; i < 4; i += 1) {
        key(host, 'ArrowUp');
      }

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      // Holding an arrow down must not become a request per repeat.
      expect(deltas).toEqual([4]);
    });

    it('floors at zero like the drag does', async () => {
      const { fixture, host, deltas } = await render(1);

      key(host, 'PageDown');
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(0);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([-1]);
    });

    it('commits at once when focus leaves, rather than making somebody wait', async () => {
      const { host, deltas } = await render(2);

      key(host, 'ArrowUp');
      host.dispatchEvent(new FocusEvent('blur'));

      expect(deltas).toEqual([1]);
    });
  });

  describe('a caller who may not change it', () => {
    it('reads as readonly and does not move', async () => {
      const { fixture, host, deltas } = await render(3, { readonly: true });

      drag(host, 4);
      key(host, 'ArrowUp');
      fixture.detectChanges();

      expect(host.getAttribute('aria-readonly')).toBe('true');
      expect(fixture.componentInstance.shown()).toBe(3);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([]);
    });
  });

  describe('the neighbours in the overlay', () => {
    it('shows the one before and the one after', async () => {
      const { fixture, host } = await render(3);

      host.dispatchEvent(pointer('pointerdown', 0));
      fixture.detectChanges();

      expect(fixture.componentInstance.previous()).toBe(2);
      expect(fixture.componentInstance.next()).toBe(4);
    });

    it('shows nothing to the left at zero, which is the affordance', async () => {
      // There is no minus one, and the absence is what tells a thumb it has reached
      // the end without a disabled control or a bounce to explain it (section 4).
      const { fixture, host } = await render(0);

      host.dispatchEvent(pointer('pointerdown', 0));
      fixture.detectChanges();

      expect(fixture.componentInstance.previous()).toBeNull();
      expect(fixture.componentInstance.next()).toBe(1);
    });
  });

  describe('what the spinbutton reports', () => {
    it('announces the number it is showing, and its floor', async () => {
      const { fixture, host } = await render(2);

      expect(host.getAttribute('role')).toBe('spinbutton');
      expect(host.getAttribute('aria-valuenow')).toBe('2');
      expect(host.getAttribute('aria-valuemin')).toBe('0');
      expect(host.getAttribute('aria-label')).toBe('How many Milk');

      key(host, 'ArrowUp');
      fixture.detectChanges();
      expect(host.getAttribute('aria-valuenow')).toBe('3');
    });
  });

  describe('a settled value arriving from elsewhere', () => {
    it('is taken while nothing is happening', async () => {
      const { fixture } = await render(2);

      fixture.componentRef.setInput('value', 7);
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(7);
    });

    it('does not yank the number out from under a moving thumb', async () => {
      const { fixture, host } = await render(2);

      host.dispatchEvent(pointer('pointerdown', 0));
      host.dispatchEvent(pointer('pointermove', -QUANTITY_REEL_PX_PER_UNIT));
      fixture.detectChanges();

      // Somebody else's edit lands mid gesture. The store's overlay already claims
      // `quantity` for this window; this is the same rule one layer up.
      fixture.componentRef.setInput('value', 99);
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(3);
    });
  });
});
