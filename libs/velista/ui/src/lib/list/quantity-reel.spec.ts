import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  QUANTITY_REEL_IDLE_MS,
  QUANTITY_REEL_PX_PER_UNIT,
  QUANTITY_REEL_TAP_MAX_MS,
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
  options: { readonly?: boolean; min?: number; max?: number } = {}
): Promise<{
  fixture: ComponentFixture<QuantityReel>;
  host: HTMLElement;
  deltas: number[];
  /** Absolute commits, which is what the two writes behind this control take. */
  runs: { from: number; to: number }[];
  /** Every value the thumb sat on, in order, including the null on each close. */
  previews: (number | null)[];
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
  if (options.min !== undefined) {
    fixture.componentRef.setInput('min', options.min);
  }
  if (options.max !== undefined) {
    fixture.componentRef.setInput('max', options.max);
  }
  fixture.detectChanges();

  const deltas: number[] = [];
  fixture.componentInstance.committed.subscribe((delta) => deltas.push(delta));
  const runs: { from: number; to: number }[] = [];
  fixture.componentInstance.committedTo.subscribe((run) => runs.push(run));
  const previews: (number | null)[] = [];
  fixture.componentInstance.preview.subscribe((seen) => previews.push(seen));

  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    deltas,
    runs,
    previews,
  };
}

/** One whole drag: down, move by `units`, up. Leftwards is more (section 4). */
function drag(host: HTMLElement, units: number): void {
  host.dispatchEvent(pointer('pointerdown', 0));
  host.dispatchEvent(
    pointer('pointermove', -units * QUANTITY_REEL_PX_PER_UNIT)
  );
  host.dispatchEvent(pointer('pointerup', -units * QUANTITY_REEL_PX_PER_UNIT));
}

/** A press and a lift in the same place, which is what a tap is. */
function tap(target: EventTarget, clientX = 0): void {
  target.dispatchEvent(pointer('pointerdown', clientX));
  target.dispatchEvent(pointer('pointerup', clientX));
}

/** The element in the open overlay standing for `value`. Absent past the range. */
function number(host: HTMLElement, value: number): HTMLElement {
  return host.querySelector(`[data-reel-value="${value}"]`) as HTMLElement;
}

function key(host: HTMLElement, name: string): void {
  host.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true })
  );
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

  /**
   * The second gesture. A drag is the whole point of the control, but ±1 through forty
   * pixels of travel is the one case where the gesture is more work than the thing it
   * replaced, and the numbers are already on screen being pointed at.
   */
  describe('tapping a number', () => {
    it('goes to the one that was tapped', async () => {
      const { fixture, host, deltas } = await render(2);

      // A tap on the pill opens it; nothing has changed yet.
      tap(host);
      fixture.detectChanges();
      expect(fixture.componentInstance.open()).toBe(true);
      expect(fixture.componentInstance.shown()).toBe(2);

      tap(number(host, 3));
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(3);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([1]);
    });

    it('goes down as readily as up', async () => {
      const { fixture, host, deltas } = await render(2);

      tap(host);
      fixture.detectChanges();
      tap(number(host, 1));
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(1);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([-1]);
    });

    it('adds up over several taps into one delta, like the drag does', async () => {
      const { fixture, host, deltas } = await render(2);

      tap(host);
      for (const target of [3, 4, 5]) {
        fixture.detectChanges();
        tap(number(host, target));
      }
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(5);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([3]);
    });

    it('is a tap and not a hold: a press that lingers changes nothing', async () => {
      // A hold is how a drag begins. Somebody who pressed, thought better of it and
      // lifted without moving did not ask for the number they were resting on.
      const { fixture, host, deltas } = await render(2);

      tap(host);
      fixture.detectChanges();

      const target = number(host, 3);
      target.dispatchEvent(pointer('pointerdown', 0));
      jest.advanceTimersByTime(QUANTITY_REEL_TAP_MAX_MS + 50);
      target.dispatchEvent(pointer('pointerup', 0));
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([]);
    });

    it('does not fire at the end of a drag that began on a number', async () => {
      // The drag has already said where it wants to be. Reading the release as a tap
      // as well would drag the reel to five and then snap it back to three.
      const { fixture, host, deltas } = await render(2);

      tap(host);
      fixture.detectChanges();

      const target = number(host, 3);
      target.dispatchEvent(pointer('pointerdown', 0));
      target.dispatchEvent(
        pointer('pointermove', -3 * QUANTITY_REEL_PX_PER_UNIT)
      );
      target.dispatchEvent(
        pointer('pointerup', -3 * QUANTITY_REEL_PX_PER_UNIT)
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(5);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([3]);
    });

    it('has nothing to tap past the end of the range', async () => {
      const { fixture, host } = await render(0);

      tap(host);
      fixture.detectChanges();

      // The empty neighbour carries no value, so there is no minus one to land on.
      expect(number(host, -1)).toBeNull();
      expect(number(host, 1)).not.toBeNull();
    });

    it('does not move for a caller who may not change it', async () => {
      const { fixture, host, deltas } = await render(3, { readonly: true });

      tap(host);
      fixture.detectChanges();

      // The overlay never opened, so there is nothing to tap in the first place.
      expect(fixture.componentInstance.open()).toBe(false);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([]);
    });
  });

  /**
   * The overlay is wider than the pill and reaches over the row beside it, so the thing
   * somebody is looking at when they decide to drag is often not the thing that used to
   * be listening.
   */
  describe('where a drag may start', () => {
    it('starts on a number inside the open overlay, not only on the pill', async () => {
      const { fixture, host, deltas } = await render(2);

      tap(host);
      fixture.detectChanges();

      const target = number(host, 2);
      target.dispatchEvent(pointer('pointerdown', 0));
      target.dispatchEvent(
        pointer('pointermove', -2 * QUANTITY_REEL_PX_PER_UNIT)
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(4);

      target.dispatchEvent(
        pointer('pointerup', -2 * QUANTITY_REEL_PX_PER_UNIT)
      );
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([2]);
    });

    it('starts anywhere in the overlay, number or not', async () => {
      const { fixture, host, deltas } = await render(1);

      tap(host);
      fixture.detectChanges();

      const overlay = host.querySelector('.overlay') as HTMLElement;
      overlay.dispatchEvent(pointer('pointerdown', 0));
      overlay.dispatchEvent(pointer('pointermove', -QUANTITY_REEL_PX_PER_UNIT));
      overlay.dispatchEvent(pointer('pointerup', -QUANTITY_REEL_PX_PER_UNIT));
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([1]);
    });
  });

  describe('saying that it closed by itself', () => {
    it('announces the timeout, so the row can stay deaf for a beat', async () => {
      const { fixture, host } = await render(2);
      const closes: number[] = [];
      fixture.componentInstance.autoClosed.subscribe(() => closes.push(1));

      drag(host, 1);
      expect(closes).toEqual([]);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(closes).toEqual([1]);
    });

    it('says nothing when somebody closed it themselves', async () => {
      // A blur, or the row asking for it. Both are somebody's own doing, and the tap
      // they cost has already been spent.
      const { fixture, host } = await render(2);
      const closes: number[] = [];
      fixture.componentInstance.autoClosed.subscribe(() => closes.push(1));

      drag(host, 1);
      host.dispatchEvent(new FocusEvent('blur'));
      fixture.componentInstance.close();

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(closes).toEqual([]);
    });

    it('commits what it was holding when the row closes it', async () => {
      const { fixture, host, deltas } = await render(2);

      drag(host, 2);
      fixture.componentInstance.close();
      fixture.detectChanges();

      expect(deltas).toEqual([2]);
      expect(fixture.componentInstance.open()).toBe(false);
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

  /**
   * The three things velista `0055` and `0056` need from this control, none of which
   * changes what it already does (velista `0054`, section 5).
   *
   * A contribution to a line is the same gesture over a different number, and the
   * difference is entirely in the bounds and in what has to be said while the thumb
   * is still moving. So the reel takes its floor and its ceiling, says what is under
   * the thumb, and reports where a run started as well as how far it went.
   */
  describe('the bounds a caller sets', () => {
    it('floors where the caller says, not at zero', async () => {
      // A contribution floors at what has already been bought against that list, and
      // the server refuses anything under it. A control that could reach a refused
      // number is a gesture that fails after it has already happened on screen.
      const { fixture, host, deltas } = await render(4, { min: 2 });

      drag(host, -10);
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).toBe(2);

      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      expect(deltas).toEqual([-2]);
    });

    it('draws no neighbour past either end of the range it was given', async () => {
      // The gap is the affordance: no disabled control, no bounce, and nothing that
      // has to be read to be understood (section 4).
      const { fixture, host } = await render(3, { min: 3, max: 4 });

      host.dispatchEvent(pointer('pointerdown', 0));
      fixture.detectChanges();

      expect(fixture.componentInstance.previous()).toBeNull();
      expect(fixture.componentInstance.next()).toBe(4);
      expect(number(host, 2)).toBeNull();
    });

    it('announces that range, so the spinbutton says the truth', async () => {
      const { host } = await render(4, { min: 2, max: 9 });

      expect(host.getAttribute('aria-valuemin')).toBe('2');
      expect(host.getAttribute('aria-valuemax')).toBe('9');
    });

    it('ceilings where the caller says', async () => {
      const { fixture, host } = await render(4, { max: 6 });

      drag(host, 10);
      fixture.detectChanges();

      expect(fixture.componentInstance.shown()).toBe(6);
    });
  });

  describe('saying what is under the thumb', () => {
    it('reports the number the thumb is on, as it moves', async () => {
      // The caption has to be said **while the thumb is still moving**: "buying 20
      // instead of 5" arrives a beat too late if it waits for the delta.
      //
      // It is an effect, so it reports **once per change detection** rather than once
      // per write, which is what a caption wants: a drag that crosses three numbers
      // between two frames draws the one it landed on, not all three.
      const { fixture, host, previews } = await render(2);

      host.dispatchEvent(pointer('pointerdown', 0));
      fixture.detectChanges();
      expect(previews[previews.length - 1]).toBe(2);

      for (const units of [1, 2, 3]) {
        host.dispatchEvent(
          pointer('pointermove', -units * QUANTITY_REEL_PX_PER_UNIT)
        );
        fixture.detectChanges();
        expect(previews[previews.length - 1]).toBe(2 + units);
      }

      host.dispatchEvent(pointer('pointerup', -3 * QUANTITY_REEL_PX_PER_UNIT));
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
      fixture.detectChanges();

      // Null the moment it closes, so the caption goes away rather than freezing at
      // the last number a finger was over.
      expect(previews[previews.length - 1]).toBeNull();
    });

    it('goes quiet when the overlay is closed from outside', async () => {
      const { fixture, host, previews } = await render(2);

      drag(host, 1);
      fixture.detectChanges();
      expect(previews[previews.length - 1]).toBe(3);

      fixture.componentInstance.close();
      fixture.detectChanges();
      expect(previews[previews.length - 1]).toBeNull();
    });
  });

  describe('where the run started and where it ended', () => {
    it('reports both, beside the delta', async () => {
      // What the two writes behind this control actually take: they refuse a `from`
      // that no longer matches, because a gesture whose meaning depends on where it
      // started must not be applied to a number that moved underneath it.
      const { host, deltas, runs } = await render(5);

      drag(host, 15);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);

      expect(deltas).toEqual([15]);
      expect(runs).toEqual([{ from: 5, to: 20 }]);
    });

    it('measures from where the run began, not from the last snap', async () => {
      // Three drags inside one idle window are one request, and its `from` is where
      // the thumb first went down.
      const { host, runs } = await render(2);

      drag(host, 2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS / 2);
      drag(host, 1);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);

      expect(runs).toEqual([{ from: 2, to: 5 }]);
    });

    it('says nothing when the run ended where it began', async () => {
      const { host, deltas, runs } = await render(4);

      drag(host, 2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS / 2);
      drag(host, -2);
      jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);

      expect(deltas).toEqual([]);
      expect(runs).toEqual([]);
    });
  });
});
