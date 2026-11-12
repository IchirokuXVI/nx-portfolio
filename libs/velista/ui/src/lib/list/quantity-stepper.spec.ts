import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { LINE_QUANTITY_MAX, type QuantityStep } from '@portfolio/velista/models';
import { QuantityStepper } from './quantity-stepper';

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
      const h = render({ value: 999_975, unit: 'GRAM', max: 999_999 });
      expect(h.plus.getAttribute('aria-disabled')).toBe('true');
      h.plus.click();
      expect(h.steps).toEqual([]);
      h.set('value', 999_950);
      expect(h.plus.getAttribute('aria-disabled')).toBeNull();
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

    it.each(['pointerleave', 'pointercancel'])('stops on %s', (type) => {
      const h = render({ value: 2 });
      fire(h.plus, 'pointerdown');
      jest.advanceTimersByTime(700);
      fire(h.plus, type);
      jest.advanceTimersByTime(3000);
      expect(tos(h)).toEqual([3, 4]);
    });

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

    it('starts no hold on a button at an end', () => {
      const h = render({ value: 0 });
      fire(h.minus, 'pointerdown');
      jest.advanceTimersByTime(2000);
      expect(h.steps).toEqual([]);
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
    const field = (h: Harness) =>
      h.el.querySelector('input') as HTMLInputElement;
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

    it('is a spinbutton with its four values and the exact form', () => {
      const h = render({ value: 1275, unit: 'GRAM', variant: 'sheet' });
      const input = field(h);
      expect(input.getAttribute('role')).toBe('spinbutton');
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.getAttribute('aria-valuenow')).toBe('1275');
      expect(input.getAttribute('aria-valuemin')).toBe('0');
      expect(input.getAttribute('aria-valuemax')).toBe(
        String(LINE_QUANTITY_MAX)
      );
      expect(input.getAttribute('aria-valuetext')).toBe('1.275 kilograms');
      expect(input.getAttribute('aria-label')).toBe(
        'amount.group:{"name":"Plátano"}'
      );
      expect(input.value).toBe('1.275');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('kg');
      expect(h.el.querySelector('[role="group"]')).toBeNull();
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
      const h = render({
        value: 750,
        unit: 'GRAM',
        variant: 'sheet',
        max: 999_999,
      });
      expect(key(h, 'ArrowUp').defaultPrevented).toBe(true);
      key(h, 'ArrowDown');
      key(h, 'ArrowDown');
      key(h, 'End');
      key(h, 'Home');
      expect(tos(h)).toEqual([775, 750, 725, 999_999, 0]);
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

    it('follows the typing with its symbol, and commits on Enter', () => {
      const h = render({ value: 500, unit: 'MILLILITER', variant: 'sheet' });
      type(h, '1');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('ml');
      type(h, '1,');
      expect(h.el.querySelector('.symbol')?.textContent).toBe('l');
      type(h, '1,5');
      expect(h.steps).toEqual([]);
      key(h, 'Enter');
      expect(h.steps).toEqual([{ from: 500, to: 1500, repeat: false }]);
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
      expect(h.steps).toEqual([{ from: 750, to: 900, repeat: false }]);
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
});
