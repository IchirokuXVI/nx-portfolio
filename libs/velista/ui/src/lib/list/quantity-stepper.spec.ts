import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
} from '@portfolio/velista/models';
import { QuantityStepper } from './quantity-stepper';

/**
 * The stepper in its two modes (velista `0134`, section 4.1). Uncontrolled, it
 * owns the number. Controlled, the container owns it and a press is only told.
 */
describe('QuantityStepper', () => {
  async function render(
    inputs: Record<string, unknown>
  ): Promise<ComponentFixture<QuantityStepper>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [QuantityStepper, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(QuantityStepper);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function host(fixture: ComponentFixture<QuantityStepper>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** The two buttons: the minus, then the plus. */
  function steps(
    fixture: ComponentFixture<QuantityStepper>
  ): HTMLButtonElement[] {
    return [...host(fixture).querySelectorAll<HTMLButtonElement>('button')];
  }

  /** The number as drawn, and as a screen reader hears it. */
  function drawn(fixture: ComponentFixture<QuantityStepper>): {
    text: string | null | undefined;
    now: string | null | undefined;
  } {
    return {
      text: host(fixture).querySelector('.value')?.textContent,
      now: host(fixture)
        .querySelector('[role="spinbutton"]')
        ?.getAttribute('aria-valuenow'),
    };
  }

  function record(fixture: ComponentFixture<QuantityStepper>): {
    stepped: number[];
    values: number[];
  } {
    const heard = { stepped: [] as number[], values: [] as number[] };
    fixture.componentInstance.stepped.subscribe((by) => heard.stepped.push(by));
    fixture.componentInstance.value.subscribe((value) =>
      heard.values.push(value)
    );
    return heard;
  }

  describe('uncontrolled', () => {
    it('changes the value on a press on the plus, and says one more', async () => {
      const fixture = await render({ value: 2 });
      const heard = record(fixture);

      steps(fixture)[1]?.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.value()).toBe(3);
      expect(drawn(fixture)).toEqual({ text: '3', now: '3' });
      expect(heard.values).toEqual([3]);
      expect(heard.stepped).toEqual([1]);
    });

    it('changes the value on a press on the minus, and says one fewer', async () => {
      const fixture = await render({ value: 2 });
      const heard = record(fixture);

      steps(fixture)[0]?.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.value()).toBe(1);
      expect(drawn(fixture)).toEqual({ text: '1', now: '1' });
      expect(heard.values).toEqual([1]);
      expect(heard.stepped).toEqual([-1]);
    });
  });

  describe('controlled', () => {
    it('says the press and keeps the value it was given', async () => {
      const fixture = await render({ value: 2, controlled: true });
      const heard = record(fixture);

      steps(fixture)[1]?.click();
      fixture.detectChanges();

      expect(heard.stepped).toEqual([1]);
      expect(heard.values).toEqual([]);
      expect(fixture.componentInstance.value()).toBe(2);
      expect(drawn(fixture)).toEqual({ text: '2', now: '2' });
    });

    it('says each press in order while the value has not moved', async () => {
      const fixture = await render({ value: 2, controlled: true });
      const heard = record(fixture);

      steps(fixture)[0]?.click();
      fixture.detectChanges();
      steps(fixture)[1]?.click();
      fixture.detectChanges();

      expect(heard.stepped).toEqual([-1, 1]);
      expect(drawn(fixture)).toEqual({ text: '2', now: '2' });
    });

    it('draws the new value once the container gives it one', async () => {
      const fixture = await render({ value: 2, controlled: true });

      steps(fixture)[1]?.click();
      fixture.componentRef.setInput('value', 3);
      fixture.detectChanges();

      expect(drawn(fixture)).toEqual({ text: '3', now: '3' });
    });
  });

  describe('the two ends', () => {
    it('says nothing at the minimum, in either mode', async () => {
      for (const controlled of [false, true]) {
        const fixture = await render({ value: LINE_QUANTITY_MIN, controlled });
        const heard = record(fixture);

        expect(steps(fixture)[0]?.disabled).toBe(true);
        steps(fixture)[0]?.click();
        // A disabled button takes no click, so the guard is asked directly too.
        fixture.componentInstance.step(-1);
        fixture.detectChanges();

        expect(heard.stepped).toEqual([]);
        expect(heard.values).toEqual([]);
        expect(drawn(fixture).text).toBe(String(LINE_QUANTITY_MIN));
      }
    });

    it('says nothing at the maximum, in either mode', async () => {
      for (const controlled of [false, true]) {
        const fixture = await render({ value: LINE_QUANTITY_MAX, controlled });
        const heard = record(fixture);

        expect(steps(fixture)[1]?.disabled).toBe(true);
        steps(fixture)[1]?.click();
        fixture.componentInstance.step(1);
        fixture.detectChanges();

        expect(heard.stepped).toEqual([]);
        expect(heard.values).toEqual([]);
        expect(drawn(fixture).text).toBe(String(LINE_QUANTITY_MAX));
      }
    });

    it('stops at the minimum the caller names', async () => {
      const fixture = await render({ value: 4, min: 4 });
      const heard = record(fixture);

      expect(steps(fixture)[0]?.disabled).toBe(true);
      fixture.componentInstance.step(-1);

      expect(heard.stepped).toEqual([]);
      expect(fixture.componentInstance.value()).toBe(4);
    });
  });

  describe('the host classes', () => {
    it('carries neither class by default', async () => {
      const fixture = await render({ value: 2 });

      expect(host(fixture).classList.contains('is-accent')).toBe(false);
      expect(host(fixture).classList.contains('is-compact')).toBe(false);
    });

    it('carries is-accent for the quiet action colour', async () => {
      const fixture = await render({ value: 2, accent: true });

      expect(host(fixture).classList.contains('is-accent')).toBe(true);
      expect(host(fixture).classList.contains('is-compact')).toBe(false);
    });

    it('carries is-compact for the small size', async () => {
      const fixture = await render({ value: 2, compact: true });

      expect(host(fixture).classList.contains('is-compact')).toBe(true);
      expect(host(fixture).classList.contains('is-accent')).toBe(false);
    });
  });
});
