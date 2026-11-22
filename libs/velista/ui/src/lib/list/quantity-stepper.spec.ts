import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { LINE_QUANTITY_MAX, type QuantityStep } from '@portfolio/velista/models';
import { QuantityStepper, REFUSED_SHOWN_MS } from './quantity-stepper';

/**
 * The D3 stepper (velista `0188`, section 7). It draws what it is given, so the
 * harness plays the caller: every emitted amount is written back as the next value,
 * the way a page's `quantityRuns` draws its pending run.
 */
describe('QuantityStepper (velista 0188)', () => {
  interface Harness {
    readonly fixture: ComponentFixture<QuantityStepper>;
    readonly steps: QuantityStep[];
    readonly el: HTMLElement;
    readonly minus: HTMLButtonElement;
    readonly plus: HTMLButtonElement;
    set(name: string, value: unknown): void;
  }

  /** A translator that echoes its key and its values, so names can be asserted. */
  const echo = {
    provide: RokuTranslatorService,
    useValue: {
      loaded: signal(true),
      locale: signal('en'),
      getLocale: () => 'en',
      t: (key: string, _ns?: unknown, _l?: unknown, values?: unknown) => {
        const args =
          typeof _ns === 'object' && _ns !== null ? _ns : (values ?? undefined);
        return args === undefined ? key : `${key}:${JSON.stringify(args)}`;
      },
    },
  };

  function render(
    inputs: Record<string, unknown>,
    options: { readonly follow?: boolean } = {}
  ): Harness {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [QuantityStepper, RokuTranslatorTestingModule.forTesting()],
      providers: [echo],
    });
    const fixture = TestBed.createComponent(QuantityStepper);
    const set = (name: string, value: unknown) => {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
    };
    fixture.componentRef.setInput('name', 'Plátano');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const steps: QuantityStep[] = [];
    fixture.componentInstance.stepped.subscribe((step) => {
      steps.push(step);
      if (options.follow !== false) {
        set('value', step.to);
      }
    });
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      steps,
      el,
      get minus() {
        return el.querySelector('button.minus') as HTMLButtonElement;
      },
      get plus() {
        return el.querySelector('button.plus') as HTMLButtonElement;
      },
      set,
    };
  }

  const fire = (target: EventTarget, type: string) =>
    target.dispatchEvent(new Event(type, { bubbles: true }));

  /** A click a pointer made: its `detail` counts the presses, so it is at least 1. */
  const pointerClick = (target: EventTarget) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

  /** A click Enter or Space made on a focused button: its `detail` is 0. */
  const keyClick = (target: EventTarget) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

  const tos = (h: Harness) => h.steps.map((step) => step.to);

  /** The sheet's field, and typing and keys on it. */
  const field = (h: Harness) => h.el.querySelector('input') as HTMLInputElement;
  const type = (h: Harness, text: string) => {
    const input = field(h);
    input.value = text;
    fire(input, 'input');
    h.fixture.detectChanges();
  };
  const key = (h: Harness, name: string) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    });
    field(h).dispatchEvent(event);
    h.fixture.detectChanges();
    return event;
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('a press', () => {
    it('emits on click and not on pointerdown', () => {
      const h = render({ value: 750, unit: 'GRAM' });
      fire(h.plus, 'pointerdown');
      expect(h.steps).toEqual([]);
      fire(h.plus, 'pointerup');
      h.plus.click();
      expect(h.steps).toEqual([{ from: 750, to: 775, repeat: false }]);
    });

    it('emits valueChange with the same amount, and never sets its own value', () => {
      const h = render({ value: 3 }, { follow: false });
      const values: number[] = [];
      h.fixture.componentInstance.valueChange.subscribe((v) => values.push(v));
      h.plus.click();
      h.fixture.detectChanges();
      h.plus.click();
      h.fixture.detectChanges();
      expect(values).toEqual([4, 4]);
      expect(h.el.getAttribute('data-value')).toBe('3');
    });

    it('takes a minus under one step to the floor', () => {
      const h = render({ value: 10, unit: 'GRAM' });
      h.minus.click();
      expect(tos(h)).toEqual([0]);
    });

    it('steps a count by 10 from 1000 and back by 1 below it (S7b)', () => {
      const h = render({ value: 999 });
      h.plus.click();
      h.plus.click();
      h.minus.click();
      h.minus.click();
      expect(tos(h)).toEqual([1000, 1010, 1000, 999]);
    });
  });

  describe('the ends (S8, decision D)', () => {
    it('draws minus at an end at 0 with aria-disabled and keeps focus on it', () => {
      const h = render({ value: 1 });
      h.minus.focus();
      h.minus.click();
      expect(tos(h)).toEqual([0]);
      expect(h.minus.getAttribute('aria-disabled')).toBe('true');
      expect(h.minus.hasAttribute('disabled')).toBe(false);
      expect(document.activeElement).toBe(h.minus);
      h.minus.click();
      expect(tos(h)).toEqual([0]);
    });

    it('turns plus off one step before the most, and never clamps', () => {
      const h = render({ value: 999_999, max: 999_999 });
      expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      h.plus.click();
      expect(h.steps).toEqual([]);
      h.set('value', 999_950);
      expect(h.plus.getAttribute('aria-disabled')).toBeNull();
    });

    describe('every unit goes no higher than 99 999 (the owner, 2026-11-17)', () => {
      it('has the one ceiling as its default max', () => {
        expect(LINE_QUANTITY_MAX).toBe(99_999);
      });

      it.each(['GRAM', 'MILLILITER'])('stops %s plus at 99 975, and never clamps', (unit) => {
        const h = render({ value: 99_925, unit });
        h.plus.click();
        h.plus.click();
        expect(tos(h)).toEqual([99_950, 99_975]);
        expect(h.plus.getAttribute('aria-disabled')).toBe('true');
        h.plus.click();
        expect(tos(h)).toEqual([99_950, 99_975]);
        h.set('value', 99_974);
        expect(h.plus.getAttribute('aria-disabled')).toBeNull();
        h.set('value', 99_999);
        expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      });

      it('stops a count plus where a step of 10 would pass it', () => {
        const h = render({ value: 99_980 });
        h.plus.click();
        expect(tos(h)).toEqual([99_990]);
        expect(h.plus.getAttribute('aria-disabled')).toBe('true');
        h.plus.click();
        expect(tos(h)).toEqual([99_990]);
      });

      it('stops a plus hold before the ceiling', () => {
        const h = render({ value: 99_900, unit: 'GRAM' });
        fire(h.plus, 'pointerdown');
        jest.advanceTimersByTime(5000);
        expect(tos(h)).toEqual([99_925, 99_950, 99_975]);
        const count = render({ value: 99_950 });
        fire(count.plus, 'pointerdown');
        jest.advanceTimersByTime(5000);
        expect(tos(count)).toEqual([99_960, 99_970, 99_980, 99_990]);
      });

      it.each(['GRAM', 'UNIT'])('draws a %s line stored above it as it is, plus off and minus on', (unit) => {
        const h = render({ value: 100_000, unit });
        expect(h.el.getAttribute('data-value')).toBe('100000');
        expect(h.el.textContent).toContain('100');
        expect(h.plus.getAttribute('aria-disabled')).toBe('true');
        expect(h.minus.getAttribute('aria-disabled')).toBeNull();
        h.minus.click();
        expect(tos(h)).toEqual([unit === 'GRAM' ? 99_975 : 99_990]);
      });

      it('says the ceiling as aria-valuemax and takes End to it, for every unit', () => {
        for (const unit of ['UNIT', 'GRAM', 'MILLILITER']) {
          const sheet = render({ value: 5, unit, variant: 'sheet' });
          expect(field(sheet).getAttribute('aria-valuemax')).toBe('99999');
          key(sheet, 'End');
          expect(tos(sheet)).toEqual([99_999]);
        }
      });

      it('holds a lower max the caller passes', () => {
        const h = render({ value: 475, unit: 'GRAM', max: 500 });
        h.plus.click();
        expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      });
    });

    it('turns a count plus off where the short reading would not move', () => {
      const h = render({ value: 999_985, max: 999_999 });
      expect(h.plus.getAttribute('aria-disabled')).toBe('true');
    });

    it('says a write in flight with aria-disabled on both buttons', () => {
      const h = render({ value: 3, disabled: true });
      expect(h.minus.getAttribute('aria-disabled')).toBe('true');
      expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      h.plus.click();
      expect(h.steps).toEqual([]);
    });
  });

  describe('the hold (section 3.3)', () => {
    it('repeats after 400 ms, then every 300, 255, 217, 184, 157, 133, 113 and 100 ms', () => {
      const h = render({ value: 0 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(399);
      expect(h.steps).toEqual([]);
      jest.advanceTimersByTime(1);
      expect(tos(h)).toEqual([1]);
      const intervals = [300, 255, 217, 184, 157, 133, 113, 100, 100];
      for (const [index, interval] of intervals.entries()) {
        jest.advanceTimersByTime(interval - 1);
        expect(h.steps).toHaveLength(index + 1);
        jest.advanceTimersByTime(1);
        expect(h.steps).toHaveLength(index + 2);
      }
      expect(h.steps.every((step) => step.repeat)).toBe(true);
    });

    it('is an ordinary press when released before 400 ms', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(300);
      fire(h.plus, 'pointerup');
      h.plus.click();
      jest.advanceTimersByTime(2000);
      expect(h.steps).toEqual([{ from: 2, to: 3, repeat: false }]);
    });

    it('adds nothing on the click that ends a hold that repeated', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.plus, 'pointerup');
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('swallows the click of a hold that a touch browser sends in a later task', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.plus, 'pointerup');
      jest.advanceTimersByTime(50);
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('swallows the release after the finger slid off and back on', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.plus, 'pointerleave');
      jest.advanceTimersByTime(200);
      fire(h.plus, 'pointerup');
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('still steps on a keyboard click right after a hold', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.plus, 'pointerup');
      keyClick(h.plus);
      expect(tos(h)).toEqual([3, 4]);
      expect(h.steps.at(-1)?.repeat).toBe(false);
    });

    it('steps once on a fresh press after a hold', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.plus, 'pointerup');
      pointerClick(h.plus);
      fire(h.plus, 'pointerdown');
      fire(h.plus, 'pointerup');
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3, 4]);
    });

    it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
      'stops on %s',
      (type) => {
        const h = render({ value: 2 });
        fire(h.plus, 'pointerdown');
        jest.advanceTimersByTime(700);
        fire(h.plus, type);
        jest.advanceTimersByTime(3000);
        expect(tos(h)).toEqual([3, 4]);
      }
    );

    it('stops when the page scrolls, and the release after it adds nothing', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      window.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(3000);
      fire(h.plus, 'pointerup');
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('stops when disabled turns true', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      h.set('disabled', true);
      jest.advanceTimersByTime(3000);
      expect(tos(h)).toEqual([3]);
    });

    it('stops on destroy', () => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      h.fixture.destroy();
      jest.advanceTimersByTime(3000);
      expect(tos(h)).toEqual([3]);
    });

    it('never takes an amount to 0: a minus hold from 100 g stops at 25 g (S8b)', () => {
      const h = render({ value: 100, unit: 'GRAM' });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(5000);
      expect(tos(h)).toEqual([75, 50, 25]);
      // The release of the hold, long after it stopped, adds no step: no 0,
      // also when the click comes in a later task.
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      jest.advanceTimersByTime(1);
      pointerClick(h.minus);
      expect(tos(h)).toEqual([75, 50, 25]);
      // A separate press is the way to 0.
      fire(h.minus, 'pointerdown');
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(tos(h)).toEqual([75, 50, 25, 0]);
      expect(h.steps.at(-1)?.repeat).toBe(false);
    });

    it('stops a minus hold at min when min is above 0', () => {
      const h = render({ value: 4, min: 1 });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(5000);
      expect(tos(h)).toEqual([3, 2, 1]);
    });

    it('stops a plus hold before passing the most', () => {
      const h = render({ value: 97, max: 100 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(5000);
      expect(tos(h)).toEqual([98, 99, 100]);
    });

    it.each([
      ['a second finger', { isPrimary: false }],
      ['a button that is not the main one', { button: 2 }],
    ])('keeps the swallow of a stopped hold when %s goes down', (_, extra) => {
      const h = render({ value: 3 });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(400 + 300 + 255 + 1000);
      expect(tos(h)).toEqual([2, 1]);
      const other = new Event('pointerdown', { bubbles: true });
      Object.assign(other, extra);
      h.plus.dispatchEvent(other);
      jest.advanceTimersByTime(2000);
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(tos(h)).toEqual([2, 1]);
    });

    it('starts no hold on a button at an end', () => {
      const h = render({ value: 0 });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(2000);
      expect(h.steps).toEqual([]);
    });
  });

  describe('a held step goes on until the finger lifts (velista 0193)', () => {
    /** A pointer event with the fields the stepper reads. */
    const pointer = (
      target: EventTarget,
      type: string,
      fields: Record<string, unknown> = {}
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 7, isPrimary: true, button: 0 });
      Object.assign(event, fields);
      target.dispatchEvent(event);
      return event;
    };

    /** A touch move on the button, as the browser sends it while the finger moves. */
    const touchMove = (target: EventTarget) => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    const selectStart = (target: EventTarget) => {
      const event = new Event('selectstart', {
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };

    /** The button's box on the page, which jsdom does not lay out. */
    const placeAt = (button: HTMLElement) => {
      button.getBoundingClientRect = () =>
        ({
          left: 100,
          right: 148,
          top: 200,
          bottom: 248,
          width: 48,
          height: 48,
          x: 100,
          y: 200,
        }) as DOMRect;
    };

    it('keeps repeating after a pointerleave, and pointerup ends it', () => {
      const h = render({ value: 2 });
      pointer(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      pointer(h.plus, 'pointerleave');
      jest.advanceTimersByTime(300 + 255);
      expect(tos(h)).toEqual([3, 4, 5]);
      pointer(h.plus, 'pointerup', { clientX: 0, clientY: 0 });
      pointerClick(h.plus);
      jest.advanceTimersByTime(3000);
      expect(tos(h)).toEqual([3, 4, 5]);
    });

    it('cancels a touch move once the hold repeated, and not before', () => {
      const h = render({ value: 2 });
      pointer(h.plus, 'pointerdown');
      jest.advanceTimersByTime(399);
      expect(touchMove(h.plus).defaultPrevented).toBe(false);
      jest.advanceTimersByTime(1);
      expect(touchMove(h.plus).defaultPrevented).toBe(true);
      // Also once the repeat stopped on its own: the finger is still down.
      h.set('disabled', true);
      jest.advanceTimersByTime(3000);
      expect(touchMove(h.plus).defaultPrevented).toBe(true);
    });

    it('lets a swipe before the first repeat scroll, and its cancel steps nothing', () => {
      const h = render({ value: 2 });
      pointer(h.plus, 'pointerdown');
      jest.advanceTimersByTime(150);
      expect(touchMove(h.plus).defaultPrevented).toBe(false);
      pointer(h.plus, 'pointercancel');
      jest.advanceTimersByTime(3000);
      expect(h.steps).toEqual([]);
    });

    it('captures the pointer on pointerdown of a button that is not at an end', () => {
      const h = render({ value: 2 });
      const capture = jest.fn();
      h.plus.setPointerCapture = capture;
      pointer(h.plus, 'pointerdown');
      expect(capture).toHaveBeenCalledWith(7);
      const atEnd = jest.fn();
      h.set('value', 0);
      h.minus.setPointerCapture = atEnd;
      pointer(h.minus, 'pointerdown');
      expect(atEnd).not.toHaveBeenCalled();
    });

    it('holds on when the capture throws for a pointer that is gone', () => {
      const h = render({ value: 2 });
      h.plus.setPointerCapture = () => {
        throw new DOMException('gone', 'NotFoundError');
      };
      pointer(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400);
      expect(tos(h)).toEqual([3]);
    });

    it.each(['mouse', 'pen'])(
      'steps nothing for a %s press released off the button before the first repeat',
      (pointerType) => {
        const h = render({ value: 2 });
        placeAt(h.plus);
        pointer(h.plus, 'pointerdown', {
          pointerType,
          clientX: 120,
          clientY: 220,
        });
        jest.advanceTimersByTime(200);
        pointer(h.plus, 'pointerup', {
          pointerType,
          clientX: 120,
          clientY: 300,
        });
        pointerClick(h.plus);
        expect(h.steps).toEqual([]);
        // A key click is a new gesture and still steps.
        keyClick(h.plus);
        expect(tos(h)).toEqual([3]);
      }
    );

    it('steps for a touch tap whose contact lands a few pixels past the button', () => {
      const h = render({ value: 2 });
      placeAt(h.plus);
      pointer(h.plus, 'pointerdown', {
        pointerType: 'touch',
        clientX: 146,
        clientY: 246,
      });
      jest.advanceTimersByTime(120);
      pointer(h.plus, 'pointerup', {
        pointerType: 'touch',
        clientX: 152,
        clientY: 251,
      });
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('steps once for a press that wandered and came back onto the button', () => {
      const h = render({ value: 2 });
      placeAt(h.plus);
      pointer(h.plus, 'pointerdown', { clientX: 120, clientY: 220 });
      pointer(h.plus, 'pointerleave', { clientX: 120, clientY: 300 });
      jest.advanceTimersByTime(200);
      pointer(h.plus, 'pointerup', { clientX: 140, clientY: 240 });
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('steps on the next press after one released off the button', () => {
      const h = render({ value: 2 });
      placeAt(h.plus);
      const mouse = { pointerType: 'mouse', clientY: 220 };
      pointer(h.plus, 'pointerdown', { ...mouse, clientX: 120 });
      pointer(h.plus, 'pointerup', { ...mouse, clientX: 400 });
      pointerClick(h.plus);
      pointer(h.plus, 'pointerdown', { ...mouse, clientX: 120 });
      pointer(h.plus, 'pointerup', { ...mouse, clientX: 120 });
      pointerClick(h.plus);
      expect(tos(h)).toEqual([3]);
    });

    it('lets a second finger on the other button keep the hold of the first one', () => {
      const h = render({ value: 5 });
      placeAt(h.plus);
      const first = { pointerId: 1, pointerType: 'touch' };
      const second = { pointerId: 2, pointerType: 'touch', isPrimary: false };
      pointer(h.plus, 'pointerdown', { ...first, clientX: 120, clientY: 220 });
      jest.advanceTimersByTime(400);
      expect(tos(h)).toEqual([6]);
      pointer(h.minus, 'pointerdown', second);
      pointer(h.minus, 'pointerup', { ...second, clientX: 20, clientY: 220 });
      pointerClick(h.minus);
      // As in velista 0188: the second finger stops the repeat and its click adds
      // nothing. The first finger's touch is still claimed and selects nothing.
      jest.advanceTimersByTime(2000);
      expect(tos(h)).toEqual([6]);
      expect(touchMove(h.plus).defaultPrevented).toBe(true);
      expect(touchMove(h.minus).defaultPrevented).toBe(false);
      expect(selectStart(document.body).defaultPrevented).toBe(true);
      pointer(h.plus, 'pointerup', { ...first, clientX: 120, clientY: 300 });
      pointerClick(h.plus);
      expect(tos(h)).toEqual([6]);
      expect(touchMove(h.plus).defaultPrevented).toBe(false);
      expect(selectStart(document.body).defaultPrevented).toBe(false);
    });

    it('steps both taps of two fingers before the first repeat', () => {
      const h = render({ value: 5 });
      placeAt(h.plus);
      // A pen holds plus, so the off box rule applies to the first pointer.
      const first = { pointerId: 1, pointerType: 'pen' };
      const second = { pointerId: 2, pointerType: 'touch', isPrimary: false };
      pointer(h.plus, 'pointerdown', { ...first, clientX: 120, clientY: 220 });
      jest.advanceTimersByTime(150);
      // The second finger's lift is far outside the plus box: it is not measured
      // against it, and it does not end the first finger's hold.
      pointer(h.minus, 'pointerdown', second);
      pointer(h.minus, 'pointerup', { ...second, clientX: 20, clientY: 220 });
      pointerClick(h.minus);
      expect(tos(h)).toEqual([4]);
      expect(selectStart(document.body).defaultPrevented).toBe(true);
      pointer(h.plus, 'pointerup', { ...first, clientX: 130, clientY: 230 });
      pointerClick(h.plus);
      expect(tos(h)).toEqual([4, 5]);
    });

    it('listens for touches on the two buttons from the start, not on the document', () => {
      const h = render({ value: 2 });
      const added = jest.spyOn(document, 'addEventListener');
      try {
        pointer(h.plus, 'pointerdown');
        jest.advanceTimersByTime(400);
        expect(
          added.mock.calls.filter(([type]) => String(type).startsWith('touch'))
        ).toEqual([]);
        // A touch that started elsewhere on the page is never cancelled.
        expect(touchMove(document.body).defaultPrevented).toBe(false);
        expect(touchMove(h.minus).defaultPrevented).toBe(false);
        expect(touchMove(h.plus).defaultPrevented).toBe(true);
      } finally {
        added.mockRestore();
      }
    });

    it('adds its touch listeners non passive on each button, and removes them on destroy', () => {
      const added = jest.spyOn(HTMLElement.prototype, 'addEventListener');
      const removed = jest.spyOn(HTMLElement.prototype, 'removeEventListener');
      try {
        const h = render({ value: 2 });
        const touch = (calls: unknown[][]) =>
          calls.filter(([type]) => String(type).startsWith('touch'));
        const adds = touch(added.mock.calls);
        expect(adds.map(([type, , options]) => [type, options])).toEqual([
          ['touchstart', { passive: false }],
          ['touchmove', { passive: false }],
          ['touchstart', { passive: false }],
          ['touchmove', { passive: false }],
        ]);
        h.fixture.destroy();
        expect(
          touch(removed.mock.calls).map(([type, fn]) => [type, fn])
        ).toEqual(adds.map(([type, fn]) => [type, fn]));
      } finally {
        added.mockRestore();
        removed.mockRestore();
      }
    });

    it('prevents a selection during a hold, and not after it ended', () => {
      const h = render({ value: 2 });
      expect(selectStart(h.el).defaultPrevented).toBe(false);
      pointer(h.plus, 'pointerdown');
      expect(selectStart(document.body).defaultPrevented).toBe(true);
      jest.advanceTimersByTime(1000);
      expect(selectStart(h.el).defaultPrevented).toBe(true);
      pointer(h.plus, 'pointerup');
      expect(selectStart(h.el).defaultPrevented).toBe(false);
    });

    it('clears a selection that started during the hold, and keeps one from before', () => {
      const h = render({ value: 2 });
      const text = document.createElement('p');
      text.textContent = 'Plátano de Canarias';
      document.body.appendChild(text);
      const selectText = () => {
        const range = document.createRange();
        range.selectNodeContents(text);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
      };
      try {
        pointer(h.plus, 'pointerdown');
        selectText();
        jest.advanceTimersByTime(400);
        expect(document.getSelection()?.isCollapsed ?? true).toBe(true);
        selectText();
        pointer(h.plus, 'pointerup');
        expect(document.getSelection()?.isCollapsed ?? true).toBe(true);

        selectText();
        pointer(h.plus, 'pointerdown');
        jest.advanceTimersByTime(400);
        pointer(h.plus, 'pointerup');
        expect(document.getSelection()?.toString()).toBe('Plátano de Canarias');
      } finally {
        document.getSelection()?.removeAllRanges();
        text.remove();
      }
    });

    it.each([
      ['pointerup', (h: Harness) => pointer(h.plus, 'pointerup')],
      ['pointercancel', (h: Harness) => pointer(h.plus, 'pointercancel')],
      ['destroy', (h: Harness) => h.fixture.destroy()],
    ])('takes its listeners away on %s', (_, end) => {
      const h = render({ value: 2 });
      const plus = h.plus;
      const added = jest.spyOn(document, 'addEventListener');
      const removed = jest.spyOn(document, 'removeEventListener');
      try {
        pointer(h.plus, 'pointerdown');
        jest.advanceTimersByTime(400);
        const listeners = added.mock.calls
          .filter(([type]) => type === 'selectstart')
          .map(([type, listener]) => [type, listener]);
        expect(listeners.map(([type]) => type)).toEqual(['selectstart']);
        end(h);
        for (const [type, listener] of listeners) {
          expect(removed).toHaveBeenCalledWith(type, listener, {
            capture: true,
          });
        }
        expect(touchMove(plus).defaultPrevented).toBe(false);
        expect(selectStart(document.body).defaultPrevented).toBe(false);
      } finally {
        added.mockRestore();
        removed.mockRestore();
      }
    });
  });

  describe('the row (section 3.4)', () => {
    it('is a group named for its subject, with buttons that name their step', () => {
      const h = render({ value: 750, unit: 'GRAM' });
      const group = h.el.querySelector('[role="group"]') as HTMLElement;
      expect(group.getAttribute('aria-label')).toBe(
        'amount.group:{"name":"Plátano"}'
      );
      expect(h.minus.getAttribute('aria-label')).toBe(
        'amount.less:{"step":"25 g","name":"Plátano"}'
      );
      expect(h.plus.getAttribute('aria-label')).toBe(
        'amount.more:{"step":"25 g","name":"Plátano"}'
      );
    });

    it('names a count step 1 below 1000 and 10 from it', () => {
      const h = render({ value: 1000 });
      expect(h.minus.getAttribute('aria-label')).toContain('"step":"1"');
      expect(h.plus.getAttribute('aria-label')).toContain('"step":"10"');
    });

    it('draws the short form with its spoken words, and no focusable cell', () => {
      const h = render({ value: 1275, unit: 'GRAM' });
      expect(h.el.querySelector('.number')?.textContent).toBe('1.28');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('kg');
      expect(
        h.el.querySelector('lib-amount-figure .visually-hidden')?.textContent
      ).toBe('1.275 kilograms');
      expect(h.el.querySelector('input')).toBeNull();
      expect(h.el.querySelector('[tabindex]')).toBeNull();
      expect(h.el.querySelectorAll('button')).toHaveLength(2);
    });

    it('announces the amount once, 800 ms after the last press (decision E)', () => {
      const h = render({ value: 750, unit: 'GRAM' });
      const live = h.el.querySelector('[aria-live="polite"]') as HTMLElement;
      h.plus.click();
      h.fixture.detectChanges();
      jest.advanceTimersByTime(700);
      h.plus.click();
      jest.advanceTimersByTime(799);
      h.fixture.detectChanges();
      expect(live.textContent?.trim()).toBe('');
      jest.advanceTimersByTime(1);
      h.fixture.detectChanges();
      expect(live.textContent?.trim()).toBe(
        'amount.settled:{"name":"Plátano","amount":"800 grams"}'
      );
      h.plus.click();
      h.fixture.detectChanges();
      expect(live.textContent?.trim()).toBe('');
    });

    it('empties the live region when the value moves with no press', () => {
      const h = render({ value: 750, unit: 'GRAM' });
      const live = h.el.querySelector('[aria-live="polite"]') as HTMLElement;
      h.plus.click();
      jest.advanceTimersByTime(800);
      h.fixture.detectChanges();
      expect(live.textContent?.trim()).toContain('amount.settled');
      // Somebody else changed the line.
      h.set('value', 1000);
      expect(live.textContent?.trim()).toBe('');
    });

    it('carries the amount in base units as data-value (decision L)', () => {
      const h = render({ value: 1275, unit: 'GRAM' });
      expect(h.el.getAttribute('data-value')).toBe('1275');
    });

    it('draws the took edge (decision J)', () => {
      const h = render({ value: 2, took: true });
      expect(h.el.classList).toContain('is-took');
    });

    it('draws a reader the amount alone, with no buttons (decision I)', () => {
      const h = render({ value: 750, unit: 'GRAM', readonly: true });
      expect(h.el.querySelectorAll('button')).toHaveLength(0);
      expect(h.el.querySelector('.number')?.textContent).toBe('750');
      expect(
        h.el.querySelector('lib-amount-figure .visually-hidden')?.textContent
      ).toBe('750 grams');
    });
  });

  describe('the sheets (section 3.5)', () => {
    it('is a spinbutton with its four values and the exact form', () => {
      const h = render({ value: 1275, unit: 'GRAM', variant: 'sheet' });
      const input = field(h);
      expect(input.getAttribute('role')).toBe('spinbutton');
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.getAttribute('aria-valuenow')).toBe('1275');
      expect(input.getAttribute('aria-valuemin')).toBe('0');
      expect(input.getAttribute('aria-valuemax')).toBe('99999');
      expect(input.getAttribute('aria-valuetext')).toBe('1.275 kilograms');
      expect(input.getAttribute('aria-label')).toBe(
        'amount.group:{"name":"Plátano"}'
      );
      expect(input.value).toBe('1.275');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('kg');
      expect(h.el.querySelector('[role="group"]')).toBeNull();
    });

    it('names the field with fieldName as given, and the buttons with name (velista 0190, section 5)', () => {
      const h = render({
        value: 2,
        variant: 'sheet-narrow',
        name: 'Compra semanal',
        fieldName: 'Compra semanal, pide',
      });
      expect(field(h).getAttribute('aria-label')).toBe('Compra semanal, pide');
      expect(h.plus.getAttribute('aria-label')).toBe(
        'amount.more:{"step":"1","name":"Compra semanal"}'
      );
      expect(h.minus.getAttribute('aria-label')).toBe(
        'amount.less:{"step":"1","name":"Compra semanal"}'
      );
      // Every other stepper keeps "Amount of {{name}}".
      const plain = render({ value: 2, variant: 'sheet' });
      expect(field(plain).getAttribute('aria-label')).toBe(
        'amount.group:{"name":"Plátano"}'
      );
    });

    it('selects the whole number on focus', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      const input = field(h);
      input.focus();
      fire(input, 'focus');
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(3);
    });

    it('steps with the arrows and goes to the ends with Home and End', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      expect(key(h, 'ArrowUp').defaultPrevented).toBe(true);
      key(h, 'ArrowDown');
      key(h, 'ArrowDown');
      key(h, 'End');
      key(h, 'Home');
      // End goes to the ceiling of every unit, 99 999 (the owner, 2026-11-17).
      expect(tos(h)).toEqual([775, 750, 725, 99_999, 0]);
      expect(h.steps.every((step) => !step.repeat)).toBe(true);
    });

    it('does not fill the live region for the arrow keys', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      key(h, 'ArrowUp');
      jest.advanceTimersByTime(2000);
      h.fixture.detectChanges();
      expect(
        h.el.querySelector('[aria-live="polite"]')?.textContent?.trim()
      ).toBe('');
    });

    it('holds its symbol while typing, and commits on Enter', () => {
      const h = render({ value: 500, unit: 'MILLILITER', variant: 'sheet' });
      type(h, '1');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('ml');
      type(h, '1500');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('ml');
      expect(h.steps).toEqual([]);
      key(h, 'Enter');
      expect(h.steps).toEqual([{ from: 500, to: 1500, repeat: false, typed: true }]);
      expect(field(h).value).toBe('1.5');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('l');
    });

    it('commits on blur, and puts back text that is not a number', () => {
      const h = render({ value: 2, variant: 'sheet-narrow' });
      type(h, '12');
      fire(field(h), 'blur');
      expect(tos(h)).toEqual([12]);
      type(h, 'abc');
      fire(field(h), 'blur');
      h.fixture.detectChanges();
      expect(tos(h)).toEqual([12]);
      expect(field(h).value).toBe('12');
    });

    it('puts typed text back on Escape and keeps the sheet open', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      type(h, '9');
      const escape = key(h, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(field(h).value).toBe('750');
      expect(h.steps).toEqual([]);
    });

    it('leaves Escape to the sheet when nothing is typed', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      let reached = false;
      h.el.addEventListener('keydown', () => (reached = true));
      const escape = key(h, 'Escape');
      expect(escape.defaultPrevented).toBe(false);
      expect(reached).toBe(true);
    });

    it('keeps typed text when the value changes underneath it', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      type(h, '9');
      h.set('value', 800);
      expect(field(h).value).toBe('9');
    });

    it('commits typed text on a button press and takes no step with it', () => {
      const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
      type(h, '900');
      h.plus.click();
      expect(h.steps).toEqual([{ from: 750, to: 900, repeat: false, typed: true }]);
    });

    describe('a typed weight waits for the end of the edit (the owner, 2026-11-17)', () => {
      /** One more key at the end of what the field holds, as a person types. */
      const append = (h: Harness, keys: string) => {
        for (const one of keys) {
          type(h, field(h).value + one);
        }
      };
      const symbol = (h: Harness) => h.el.querySelector('.symbol')?.textContent;
      const turned = (h: Harness) =>
        h.el.querySelector('.turned')?.textContent?.trim() ?? null;
      const state = (h: Harness) => `${field(h).value} ${symbol(h)}`;

      it.each(['sheet', 'sheet-narrow'])(
        'holds grams while 25000 is typed from an empty field in the %s variant, and rests as 25 kg',
        (variant) => {
          const h = render({ value: 500, unit: 'GRAM', variant });
          type(h, '');
          const seen: string[] = [];
          for (const one of '25000') {
            append(h, one);
            seen.push(state(h));
          }
          expect(seen).toEqual([
            '2 g',
            '25 g',
            '250 g',
            '2500 g',
            '25000 g',
          ]);
          expect(h.steps).toEqual([]);
          key(h, 'Enter');
          expect(h.steps).toEqual([
            { from: 500, to: 25_000, repeat: false, typed: true },
          ]);
          expect(state(h)).toBe('25 kg');
        }
      );

      it('reads a paste of 25000 the same way', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '25000');
        expect(state(h)).toBe('25000 g');
        fire(field(h), 'blur');
        expect(tos(h)).toEqual([25_000]);
        expect(state(h)).toBe('25 kg');
      });

      it('reads a paste of 25000 over a line in kilos in grams too', () => {
        const h = render({ value: 2500, unit: 'GRAM', variant: 'sheet' });
        type(h, '25000');
        expect(state(h)).toBe('25000 g');
        key(h, 'Enter');
        expect(tos(h)).toEqual([25_000]);
      });

      it('keeps 2.5 kg with a 0 appended as 2.50 kg', () => {
        const h = render({ value: 2500, unit: 'GRAM', variant: 'sheet' });
        expect(state(h)).toBe('2.5 kg');
        append(h, '0');
        expect(state(h)).toBe('2.50 kg');
        expect(turned(h)).toBe('');
        key(h, 'Enter');
        // The same amount: nothing to send, and the field rests as before.
        expect(h.steps).toEqual([]);
        expect(state(h)).toBe('2.5 kg');
      });

      it.each(['sheet', 'sheet-narrow'])(
        'turns 50 kg and a 0 into 500 g at once in the %s variant, then waits in grams',
        (variant) => {
          const h = render({ value: 50_000, unit: 'GRAM', variant });
          expect(state(h)).toBe('50 kg');
          append(h, '0');
          expect(state(h)).toBe('500 g');
          expect(turned(h)).toBe('amount.turned.grams');
          append(h, '0');
          expect(state(h)).toBe('5000 g');
          expect(turned(h)).toBe('');
          key(h, 'Enter');
          expect(tos(h)).toEqual([5000]);
          expect(state(h)).toBe('5 kg');
        }
      );

      it('holds litres the same way, and turns into millilitres over 99', () => {
        const h = render({ value: 500, unit: 'MILLILITER', variant: 'sheet' });
        type(h, '2');
        append(h, '500');
        expect(state(h)).toBe('2500 ml');
        key(h, 'Enter');
        expect(state(h)).toBe('2.5 l');
        type(h, '150');
        expect(state(h)).toBe('150 ml');
        expect(turned(h)).toBe('amount.turned.milliliters');
        key(h, 'Enter');
        expect(tos(h)).toEqual([2500, 150]);
      });

      it('goes back to grams when emptied, and keeps kilos while a digit is left', () => {
        const h = render({ value: 50_000, unit: 'GRAM', variant: 'sheet' });
        type(h, '5');
        expect(state(h)).toBe('5 kg');
        type(h, '');
        expect(symbol(h)).toBe('g');
        expect(turned(h)).toBe('amount.turned.grams');
        append(h, '5');
        expect(state(h)).toBe('5 g');
        key(h, 'Enter');
        expect(tos(h)).toEqual([5]);
      });

      it('reads the first key in kilos on a line resting in kilos, decimals too', () => {
        const h = render({ value: 1500, unit: 'GRAM', variant: 'sheet' });
        expect(state(h)).toBe('1.5 kg');
        type(h, '2');
        expect(state(h)).toBe('2 kg');
        append(h, ',5');
        expect(state(h)).toBe('2,5 kg');
        key(h, 'Enter');
        expect(tos(h)).toEqual([2500]);
      });

      it('does not accept a separator under grams', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '1');
        append(h, ',');
        expect(state(h)).toBe('1 g');
        append(h, '5');
        expect(state(h)).toBe('15 g');
        key(h, 'Enter');
        expect(tos(h)).toEqual([15]);
      });

      it('does not accept the key that would leave decimals under grams: 99.5 into 199.5', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '');
        append(h, '50000');
        key(h, 'Enter');
        // 50 kg now; the field is edited into 99.5 kg.
        type(h, '99.5');
        expect(state(h)).toBe('99.5 kg');
        const input = field(h);
        input.value = '199.5';
        input.setSelectionRange(1, 1);
        fire(input, 'input');
        h.fixture.detectChanges();
        expect(state(h)).toBe('99.5 kg');
        expect(input.selectionStart).toBe(0);
        key(h, 'Enter');
        expect(tos(h)).toEqual([50_000, 99_500]);
      });

      it('does not accept a sixth digit: the field holds at most 99999, which rests as 99.999 kg', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '');
        append(h, '999999');
        expect(state(h)).toBe('99999 g');
        key(h, 'Enter');
        expect(tos(h)).toEqual([99_999]);
        expect(state(h)).toBe('99.999 kg');
        type(h, '250000');
        expect(state(h)).toBe('99.999 kg');
        expect(h.fixture.componentInstance.draft()).toBeNull();
      });

      it('types a single gram', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '1');
        key(h, 'Enter');
        expect(tos(h)).toEqual([1]);
      });

      it('leaves a count as it was: no turn, read in the name it started under, held to 99 999', () => {
        const h = render({ value: 2, variant: 'sheet' });
        type(h, '1');
        append(h, '000');
        expect(field(h).value).toBe('1000');
        expect(turned(h)).toBe('');
        key(h, 'Enter');
        type(h, '250000');
        key(h, 'Enter');
        expect(tos(h)).toEqual([1000, 99_999]);
      });

      it('puts the shown amount back on Escape after a turn', () => {
        const h = render({ value: 1500, unit: 'GRAM', variant: 'sheet' });
        type(h, '150');
        expect(symbol(h)).toBe('g');
        key(h, 'Escape');
        expect(state(h)).toBe('1.5 kg');
        expect(turned(h)).toBe('');
      });
    });

    describe('a key the field does not accept says why (the owner, 2026-11-17)', () => {
      const append = (h: Harness, keys: string) => {
        for (const one of keys) {
          type(h, field(h).value + one);
        }
      };
      /** The popover's sentence, drawn in the overlay, or null when none shows. */
      const popover = () =>
        document.querySelector('.refusal')?.textContent?.trim() ?? null;
      /** What the field's polite live region says. */
      const said = (h: Harness) =>
        h.el.querySelector('.refusal-said')?.textContent?.trim() ?? null;
      /** Drops the no-break space `Intl` writes before a unit. */
      const plain = (text: string | null) => text?.replace(/\s/g, ' ');
      const typedFocused = (h: Harness, text: string) => {
        field(h).focus();
        type(h, text);
      };

      describe('each reason', () => {
        it('says a gram has no decimals for a separator under grams, and keeps the field', () => {
          const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
          type(h, '1');
          expect(popover()).toBeNull();
          append(h, ',');
          expect(field(h).value).toBe('1');
          expect(popover()).toBe('amount.refused.wholeGrams:{}');
          expect(said(h)).toBe('amount.refused.wholeGrams:{}');
        });

        it('says a millilitre has no decimals for a separator under millilitres', () => {
          const h = render({
            value: 500,
            unit: 'MILLILITER',
            variant: 'sheet-narrow',
          });
          type(h, '150.');
          expect(field(h).value).toBe('500');
          expect(popover()).toBe('amount.refused.wholeMilliliters:{}');
        });

        it('says the most in grams for a sixth digit under grams', () => {
          const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
          type(h, '');
          append(h, '999999');
          expect(field(h).value).toBe('99999');
          expect(plain(popover())).toBe(
            'amount.refused.most:{"amount":"99,999 g"}'
          );
        });

        it('says the most in kilos for 99.5 edited into 199.5 under kilos', () => {
          const h = render({ value: 50_000, unit: 'GRAM', variant: 'sheet' });
          type(h, '99.5');
          type(h, '199.5');
          expect(field(h).value).toBe('99.5');
          expect(plain(popover())).toBe(
            'amount.refused.most:{"amount":"99.999 kg"}'
          );
        });

        it('says the most for a paste of six digits', () => {
          const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
          type(h, '250000');
          expect(field(h).value).toBe('500');
          expect(plain(popover())).toBe(
            'amount.refused.most:{"amount":"99,999 g"}'
          );
        });

        it('says at most three decimals for a fourth decimal under litres', () => {
          const h = render({
            value: 1500,
            unit: 'MILLILITER',
            variant: 'sheet',
          });
          type(h, '1.234');
          append(h, '5');
          expect(field(h).value).toBe('1.234');
          expect(popover()).toBe('amount.refused.decimals:{}');
        });

        it('says nothing for a key it accepts, nor for a turn', () => {
          const h = render({ value: 50_000, unit: 'GRAM', variant: 'sheet' });
          append(h, '0');
          expect(popover()).toBeNull();
          expect(said(h)).toBe('');
        });

        it('says the most when a typed count is held to it as the edit ends', () => {
          const h = render({ value: 2, variant: 'sheet' });
          type(h, '250000');
          expect(popover()).toBeNull();
          key(h, 'Enter');
          expect(tos(h)).toEqual([99_999]);
          expect(plain(popover())).toBe(
            'amount.refused.most:{"amount":"99,999"}'
          );
          expect(said(h)).toBe(popover());
        });

        it('says the most for a held count on a blur too, and stays there for its beat', () => {
          const h = render({ value: 2, variant: 'sheet' });
          typedFocused(h, '123456');
          fire(field(h), 'blur');
          h.fixture.detectChanges();
          expect(tos(h)).toEqual([99_999]);
          expect(popover()).not.toBeNull();
          jest.advanceTimersByTime(REFUSED_SHOWN_MS);
          h.fixture.detectChanges();
          expect(popover()).toBeNull();
        });

        it('says nothing for a typed count at or under the most', () => {
          const h = render({ value: 2, variant: 'sheet' });
          type(h, '99999');
          key(h, 'Enter');
          expect(tos(h)).toEqual([99_999]);
          expect(popover()).toBeNull();
        });
      });

      describe('the popover leaves', () => {
        /** A field in grams that just refused a separator after "15". */
        const refused = () => {
          const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
          typedFocused(h, '15');
          append(h, ',');
          expect(popover()).not.toBeNull();
          return h;
        };

        it('on the next accepted key', () => {
          const h = refused();
          append(h, '0');
          expect(field(h).value).toBe('150');
          expect(popover()).toBeNull();
          expect(said(h)).toBe('');
        });

        it('stays while refused keys follow, and says its sentence once', () => {
          const h = refused();
          const live = h.el.querySelector('.refusal-said') as HTMLElement;
          const changes: string[] = [];
          const watcher = new MutationObserver(() =>
            changes.push(live.textContent ?? '')
          );
          watcher.observe(live, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          append(h, ',');
          append(h, '.');
          watcher.disconnect();
          expect(changes).toEqual([]);
          expect(popover()).toBe('amount.refused.wholeGrams:{}');
        });

        it('on Enter, which commits the text', () => {
          const h = refused();
          key(h, 'Enter');
          expect(tos(h)).toEqual([15]);
          expect(popover()).toBeNull();
        });

        it('on a blur', () => {
          const h = refused();
          fire(field(h), 'blur');
          h.fixture.detectChanges();
          expect(popover()).toBeNull();
        });

        it('on a pointer press of a button', () => {
          const h = refused();
          fire(h.plus, 'pointerdown');
          h.fixture.detectChanges();
          expect(popover()).toBeNull();
        });

        it('on a key press of a button', () => {
          const h = refused();
          keyClick(h.minus);
          h.fixture.detectChanges();
          expect(popover()).toBeNull();
        });

        it('on an arrow key', () => {
          const h = refused();
          key(h, 'ArrowUp');
          expect(popover()).toBeNull();
        });

        it('on Escape, which goes no further and keeps the typed text', () => {
          const h = refused();
          const escape = key(h, 'Escape');
          expect(escape.defaultPrevented).toBe(true);
          expect(popover()).toBeNull();
          expect(field(h).value).toBe('15');
          expect(h.fixture.componentInstance.draft()).toBe('15');
          // A second Escape puts the shown amount back, as before.
          key(h, 'Escape');
          expect(field(h).value).toBe('500');
        });

        it('lets an Escape with nothing to close through, as before', () => {
          const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
          const escape = key(h, 'Escape');
          expect(escape.defaultPrevented).toBe(false);
        });

        it('by itself after a few seconds, and a new refusal starts the beat again', () => {
          const h = refused();
          jest.advanceTimersByTime(REFUSED_SHOWN_MS - 1000);
          append(h, '.');
          jest.advanceTimersByTime(REFUSED_SHOWN_MS - 1);
          h.fixture.detectChanges();
          expect(popover()).not.toBeNull();
          jest.advanceTimersByTime(1);
          h.fixture.detectChanges();
          expect(popover()).toBeNull();
          expect(said(h)).toBe('');
        });

        it('never takes the focus from the field', () => {
          const h = refused();
          expect(document.activeElement).toBe(field(h));
        });
      });

      it('changes no size of the stepper: the popover is out of the capsule', () => {
        const h = render({ value: 500, unit: 'GRAM', variant: 'sheet' });
        type(h, '1,');
        const capsule = h.el.querySelector('.stepper') as HTMLElement;
        expect(capsule.contains(document.querySelector('.refusal'))).toBe(
          false
        );
      });
    });

    describe('a pointer press while text is typed (the owner, 2026-11-12)', () => {
      /** Types into a focused field, as a person does. */
      const typeFocused = (h: Harness, text: string) => {
        field(h).focus();
        type(h, text);
      };
      /** Down, then the focus moves to the button and the field blurs. */
      const downAndFocus = (h: Harness, button: HTMLButtonElement) => {
        fire(button, 'pointerdown');
        button.focus();
        h.fixture.detectChanges();
      };

      it('commits the text and takes no step, in the real event order', () => {
        const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
        typeFocused(h, '900');
        downAndFocus(h, h.plus);
        expect(tos(h)).toEqual([900]);
        fire(h.plus, 'pointerup');
        pointerClick(h.plus);
        expect(tos(h)).toEqual([900]);
      });

      it('commits the text and takes no step when the button takes no focus', () => {
        const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
        typeFocused(h, '900');
        fire(h.plus, 'pointerdown');
        fire(h.plus, 'pointerup');
        pointerClick(h.plus);
        expect(tos(h)).toEqual([900]);
      });

      it('starts no hold from that press', () => {
        const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
        typeFocused(h, '900');
        downAndFocus(h, h.minus);
        jest.advanceTimersByTime(3000);
        fire(h.minus, 'pointerup');
        pointerClick(h.minus);
        expect(tos(h)).toEqual([900]);
      });

      it('steps on the next pointer press', () => {
        const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
        typeFocused(h, '900');
        downAndFocus(h, h.plus);
        fire(h.plus, 'pointerup');
        pointerClick(h.plus);
        fire(h.plus, 'pointerdown');
        fire(h.plus, 'pointerup');
        pointerClick(h.plus);
        expect(tos(h)).toEqual([900, 925]);
      });

      it('steps on a key click after Tab left the field, which committed it', () => {
        const h = render({ value: 750, unit: 'GRAM', variant: 'sheet' });
        typeFocused(h, '900');
        h.plus.focus();
        h.fixture.detectChanges();
        expect(tos(h)).toEqual([900]);
        keyClick(h.plus);
        expect(tos(h)).toEqual([900, 925]);
      });
    });
  });

  describe("the product's step (velista 0186, section 3)", () => {
    const arrow = (h: Harness, name: string) => {
      const input = h.el.querySelector('input') as HTMLInputElement;
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          bubbles: true,
          cancelable: true,
        })
      );
      h.fixture.detectChanges();
    };

    it('moves a press, a repeat and an arrow key by a step of 100', () => {
      const h = render({ value: 1000, unit: 'GRAM', step: 100 });
      h.minus.click();
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(400);
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(h.steps).toEqual([
        { from: 1000, to: 900, repeat: false },
        { from: 900, to: 800, repeat: true },
      ]);

      const sheet = render({
        value: 1000,
        unit: 'GRAM',
        step: 100,
        variant: 'sheet',
      });
      arrow(sheet, 'ArrowDown');
      arrow(sheet, 'ArrowUp');
      expect(tos(sheet)).toEqual([900, 1000]);
    });

    it('moves a press at 1000 by 10 on a step of 5 (S7b, decision F)', () => {
      const h = render({ value: 995, unit: 'GRAM', step: 5 });
      h.plus.click();
      h.plus.click();
      h.minus.click();
      h.minus.click();
      expect(tos(h)).toEqual([1000, 1010, 1000, 995]);
    });

    it('names the step each button moves', () => {
      const h = render({ value: 1000, unit: 'GRAM', step: 100 });
      expect(h.minus.getAttribute('aria-label')).toContain('"step":"100 g"');
      expect(h.plus.getAttribute('aria-label')).toContain('"step":"100 g"');
      h.set('step', 5);
      expect(h.minus.getAttribute('aria-label')).toContain('"step":"5 g"');
      expect(h.plus.getAttribute('aria-label')).toContain('"step":"10 g"');
    });

    it('turns plus off where one step of the product would pass the most', () => {
      const h = render({ value: 99_950, unit: 'GRAM', step: 100 });
      expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      h.set('step', null);
      expect(h.plus.getAttribute('aria-disabled')).toBeNull();
    });

    it('ignores a step on a count', () => {
      const h = render({ value: 3, step: 100 });
      h.plus.click();
      expect(tos(h)).toEqual([4]);
    });

    describe('typing accepts any amount (the owner, ruling 44 of 2026-11-16)', () => {
      it('takes 10 g on a step of 50 down to 0 with the trash, or up to 60', () => {
        const down = render({ value: 10, unit: 'GRAM', step: 50 });
        expect(down.minus.classList).toContain('is-clear');
        expect(down.minus.querySelector('lib-trash-icon')).not.toBeNull();
        down.minus.click();
        expect(tos(down)).toEqual([0]);

        const up = render({ value: 10, unit: 'GRAM', step: 50 });
        up.plus.click();
        expect(tos(up)).toEqual([60]);
      });

      it('keeps a typed amount under one step on a step of 50', () => {
        const h = render({ value: 50, unit: 'GRAM', step: 50, variant: 'sheet' });
        type(h, '10');
        key(h, 'Enter');
        expect(tos(h)).toEqual([10]);
      });

      it('keeps a typed amount under the floor of the buttons with a typed floor', () => {
        const h = render({
          value: 100,
          unit: 'GRAM',
          step: 100,
          min: 100,
          typedMin: 1,
          variant: 'sheet',
        });
        type(h, '10');
        key(h, 'Enter');
        expect(tos(h)).toEqual([10]);
        type(h, '0');
        key(h, 'Enter');
        expect(tos(h)).toEqual([10, 1]);
        // The buttons still stop at their floor: minus at 1 is at its end.
        expect(h.minus.getAttribute('aria-disabled')).toBe('true');
        h.minus.click();
        expect(tos(h)).toEqual([10, 1]);
        expect(field(h).getAttribute('aria-valuemin')).toBe('1');
      });

      it('holds a typed amount to the floor of the buttons without one, as before', () => {
        const h = render({
          value: 100,
          unit: 'GRAM',
          step: 100,
          min: 100,
          variant: 'sheet',
        });
        type(h, '10');
        key(h, 'Enter');
        expect(tos(h)).toEqual([]);
        expect(field(h).getAttribute('aria-valuemin')).toBe('100');
      });
    });

    describe('where minus reaches 0 and quick presses (velista 0188 S14)', () => {
      const trash = (h: Harness) => h.minus.querySelector('lib-trash-icon');

      it.each([
        [100, 100],
        [300, 500],
        [5, 5],
      ])('draws the trash at %s g on a step of %s', (value, step) => {
        const h = render({ value, unit: 'GRAM', step });
        expect(trash(h)).not.toBeNull();
        expect(h.minus.classList).toContain('is-clear');
      });

      it.each([
        [1005, 5],
        [200, 100],
        [600, 500],
      ])('draws the bar at %s g on a step of %s', (value, step) => {
        const h = render({ value, unit: 'GRAM', step });
        expect(trash(h)).toBeNull();
        expect(h.minus.classList).not.toContain('is-clear');
      });

      it('goes from 300 g to 0 in one minus on a step of 500', () => {
        const h = render({ value: 300, unit: 'GRAM', step: 500 });
        h.minus.click();
        expect(tos(h)).toEqual([0]);
      });

      it('builds quick presses in one task on the step of the product', () => {
        const h = render(
          { value: 1000, unit: 'GRAM', step: 100 },
          { follow: false }
        );
        h.minus.click();
        h.minus.click();
        h.plus.click();
        expect(h.steps).toEqual([
          { from: 1000, to: 900, repeat: false },
          { from: 900, to: 800, repeat: false },
          { from: 800, to: 900, repeat: false },
        ]);
      });

      it('builds quick presses past 1000 by 10 on a step of 5', () => {
        const h = render(
          { value: 1005, unit: 'GRAM', step: 5 },
          { follow: false }
        );
        h.minus.click();
        h.minus.click();
        expect(tos(h)).toEqual([995, 990]);
      });

      it('stops plus at the most within one task on a step of 100', () => {
        const h = render(
          { value: 99_700, unit: 'GRAM', step: 100 },
          { follow: false }
        );
        h.plus.click();
        h.plus.click();
        h.plus.click();
        expect(tos(h)).toEqual([99_800, 99_900]);
      });
    });
  });

  describe('the trash where minus reaches 0 (S14)', () => {
    const trash = (h: Harness) => h.minus.querySelector('lib-trash-icon');
    const bar = (h: Harness) => h.minus.querySelector('.glyph');
    const variants = ['row', 'sheet', 'sheet-narrow'] as const;

    describe.each(variants)('in the %s variant', (variant) => {
      it.each([
        [1, 'UNIT'],
        [25, 'GRAM'],
        [10, 'GRAM'],
      ])('draws a red trash at %s %s', (value, unit) => {
        const h = render({ value, unit, variant });
        expect(trash(h)).not.toBeNull();
        expect(bar(h)).toBeNull();
        expect(h.minus.classList).toContain('is-clear');
      });

      it.each([
        [2, 'UNIT'],
        [50, 'GRAM'],
        [0, 'UNIT'],
        [0, 'GRAM'],
      ])('draws the bar at %s %s', (value, unit) => {
        const h = render({ value, unit, variant });
        expect(trash(h)).toBeNull();
        expect(bar(h)).not.toBeNull();
        expect(h.minus.classList).not.toContain('is-clear');
      });

      it('never draws it with a floor above 0', () => {
        expect(trash(render({ value: 1, min: 1, variant }))).toBeNull();
        expect(
          trash(render({ value: 25, unit: 'GRAM', min: 25, variant }))
        ).toBeNull();
      });

      it('follows value as the caller redraws', () => {
        const h = render({ value: 2, variant }, { follow: false });
        expect(trash(h)).toBeNull();
        h.set('value', 1);
        expect(trash(h)).not.toBeNull();
        h.set('value', 0);
        expect(trash(h)).toBeNull();
        expect(h.minus.getAttribute('aria-disabled')).toBe('true');
        h.set('value', 3);
        expect(trash(h)).toBeNull();
      });
    });

    it('keeps the truthful name of the step', () => {
      const h = render({ value: 25, unit: 'GRAM' });
      expect(h.minus.getAttribute('aria-label')).toBe(
        'amount.less:{"step":"25 g","name":"Plátano"}'
      );
    });

    it('takes a separate press to 0 after a hold ends on it', () => {
      const h = render({ value: 3 });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(400 + 300 + 255 + 1000);
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(tos(h)).toEqual([2, 1]);
      expect(trash(h)).not.toBeNull();
      fire(h.minus, 'pointerdown');
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(tos(h)).toEqual([2, 1, 0]);
    });

    it('takes a long press that starts on the trash to 0 on release, with no repeat (the owner, 2026-11-17)', () => {
      const h = render({ value: 25, unit: 'GRAM' });
      expect(trash(h)).not.toBeNull();
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(3000);
      expect(h.steps).toEqual([]);
      fire(h.minus, 'pointerup');
      pointerClick(h.minus);
      expect(h.steps).toEqual([{ from: 25, to: 0, repeat: false }]);
    });

    it('draws no button at all for a reader', () => {
      const h = render({ value: 1, readonly: true });
      expect(h.el.querySelectorAll('button')).toHaveLength(0);
      expect(h.el.querySelector('lib-trash-icon')).toBeNull();
    });
  });

  describe('presses faster than the caller redraws', () => {
    it('builds each press in one task on the one before', () => {
      const h = render(
        { value: 1000, unit: 'GRAM', variant: 'sheet' },
        { follow: false }
      );
      h.minus.click();
      h.minus.click();
      h.minus.click();
      expect(h.steps).toEqual([
        { from: 1000, to: 975, repeat: false },
        { from: 975, to: 950, repeat: false },
        { from: 950, to: 925, repeat: false },
      ]);
      // It draws nothing of its own meanwhile.
      expect(h.el.getAttribute('data-value')).toBe('1000');
    });

    it('builds arrow keys in one task on the one before', () => {
      const h = render(
        { value: 1000, unit: 'GRAM', variant: 'sheet' },
        { follow: false }
      );
      const input = h.el.querySelector('input') as HTMLInputElement;
      for (let i = 0; i < 3; i++) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
        );
      }
      expect(tos(h)).toEqual([975, 950, 925]);
    });

    it('builds a press on a typed commit in the same task', () => {
      const h = render(
        { value: 750, unit: 'GRAM', variant: 'sheet' },
        { follow: false }
      );
      const input = h.el.querySelector('input') as HTMLInputElement;
      input.value = '900';
      fire(input, 'input');
      h.fixture.detectChanges();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
      );
      h.plus.click();
      expect(h.steps).toEqual([
        { from: 750, to: 900, repeat: false, typed: true },
        { from: 900, to: 925, repeat: false },
      ]);
    });

    it('builds each repeat of a hold on the one before', () => {
      const h = render({ value: 2 }, { follow: false });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(400 + 300 + 255);
      expect(h.steps).toEqual([
        { from: 2, to: 3, repeat: true },
        { from: 3, to: 4, repeat: true },
        { from: 4, to: 5, repeat: true },
      ]);
    });

    // Not S15 proof: a caller's new value is the base with or without the kept amount.
    it('starts from the caller once it sets an amount of its own', () => {
      const h = render({ value: 1000, unit: 'GRAM' }, { follow: false });
      h.minus.click();
      h.minus.click();
      h.minus.click();
      h.set('value', 850);
      h.minus.click();
      expect(h.steps.at(-1)).toEqual({ from: 850, to: 825, repeat: false });
    });

    it('lets the caller win at once when its value moves, even before a render', () => {
      const h = render({ value: 1000, unit: 'GRAM' }, { follow: false });
      h.minus.click();
      h.fixture.componentRef.setInput('value', 950);
      h.minus.click();
      expect(h.steps.at(-1)).toEqual({ from: 950, to: 925, repeat: false });
    });

    it('steps from the kept amount again once a caller that ignores it redraws', () => {
      const h = render({ value: 1000, unit: 'GRAM' }, { follow: false });
      h.minus.click();
      h.fixture.detectChanges();
      h.minus.click();
      h.fixture.detectChanges();
      expect(tos(h)).toEqual([975, 975]);
    });

    it('stops at an end it reached within one task', () => {
      const h = render({ value: 1 }, { follow: false });
      h.minus.click();
      h.minus.click();
      expect(tos(h)).toEqual([0]);
    });

    it('stops plus at the most it reached within one task', () => {
      const h = render({ value: 98, max: 100 }, { follow: false });
      h.plus.click();
      h.plus.click();
      h.plus.click();
      expect(tos(h)).toEqual([99, 100]);
    });
  });

  describe('a typed amount says it was typed (velista 0190, section 4)', () => {
    it('marks a committed typed amount, even one step away', () => {
      const h = render({ value: 3, variant: 'sheet' });
      type(h, '4');
      key(h, 'Enter');
      expect(h.steps).toEqual([{ from: 3, to: 4, repeat: false, typed: true }]);
    });

    it('marks nothing for an arrow, Home, End or a press', () => {
      const h = render({ value: 3, variant: 'sheet' });
      key(h, 'ArrowUp');
      key(h, 'Home');
      key(h, 'End');
      h.plus.click();
      expect(h.steps.some((step) => step.typed !== undefined)).toBe(false);
    });
  });

  describe('the look (section 3.2)', () => {
    it('pads the wide sheet by 6, and the narrow one keeps 4 and draws a figure with a symbol at 16 px', () => {
      // The fit test of velista-luna-e2e measures the narrow field: "99,999" in
      // DejaVu Sans, the system font of the CI runner, is 65.6 px at 17 px, more
      // than 72 less 6 on each side (2026-11-20).
      const scss = readFileSync(join(__dirname, 'quantity-stepper.scss'), 'utf8');
      const rule = /([^{}]*)\{[^}]*padding-inline:\s*var\(--app-stepper-cell-pad-sheet\)/.exec(
        scss
      );
      expect(rule?.[1]).toContain(':host(.variant-sheet) .cell');
      expect(rule?.[1]).not.toContain('variant-sheet-narrow');
      expect(scss).toMatch(
        /:host\(\.variant-sheet-narrow\) \.field-cell:not\(\.is-bare\) \.field \{\s*font-size: var\(--app-stepper-figure-least\);/
      );
    });
  });
});
