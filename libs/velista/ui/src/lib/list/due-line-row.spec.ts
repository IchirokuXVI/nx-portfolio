import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  QUANTITY_REEL_IDLE_MS,
  QUANTITY_REEL_PX_PER_UNIT,
  type DueLineRowVm,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { join } from 'node:path';
import { compile } from 'sass';
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { DueLineRow } from './due-line-row';
import { QuantityReel } from './quantity-reel';
import { QuantityStepper } from './quantity-stepper';

/**
 * The rules of a component's stylesheet as the browser gets them: compiled by the
 * repo's `sass`, as the contrast spec does, so nesting is flattened and a selector is
 * matched as it ships, not as it is written. jest's Angular preset does not inline a
 * `styleUrl`, so the component definition holds no style text to read.
 */
function compiledRules(file: string): { selector: string; body: string }[] {
  const css = compile(join(__dirname, file)).css;
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2],
  }));
}

function row(overrides: Partial<DueLineRowVm> = {}): DueLineRowVm {
  return {
    lineId: 'l-1',
    name: 'Eggs',
    reasonKey: 'list.due.period',
    reasonArgs: { days: 7, when: '5 days ago' },
    quantity: 2,
    ...overrides,
  };
}

async function render(
  vm: DueLineRowVm,
  inputs: { addsOnStep?: boolean; quietMs?: number } = {}
): Promise<ComponentFixture<DueLineRow>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [DueLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(DueLineRow);
  fixture.componentRef.setInput('row', vm);
  if (inputs.addsOnStep !== undefined) {
    fixture.componentRef.setInput('addsOnStep', inputs.addsOnStep);
  }
  if (inputs.quietMs !== undefined) {
    fixture.componentRef.setInput('quietMs', inputs.quietMs);
  }
  fixture.detectChanges();
  return fixture;
}

function el(
  fixture: ComponentFixture<DueLineRow>,
  selector: string
): HTMLElement {
  const found = (
    fixture.nativeElement as HTMLElement
  ).querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`no ${selector}`);
  }
  return found;
}

function stepper(fixture: ComponentFixture<DueLineRow>): QuantityStepper {
  return fixture.debugElement.query(By.directive(QuantityStepper))
    .componentInstance as QuantityStepper;
}

/** Press the stepper's plus (index 1) or minus (index 0). */
function press(fixture: ComponentFixture<DueLineRow>, index: 0 | 1): void {
  const buttons = (
    fixture.nativeElement as HTMLElement
  ).querySelectorAll<HTMLButtonElement>('lib-quantity-stepper .step');
  buttons[index].click();
  fixture.detectChanges();
}

describe('DueLineRow (velista 0089)', () => {
  afterEach(() => jest.useRealTimers());

  it('draws the name and the reason sentence, and a tap on them opens the line', async () => {
    const fixture = await render(row());
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));

    expect(el(fixture, '.name').textContent).toContain('Eggs');
    expect(el(fixture, '.reason').textContent).toContain('list.due.period');

    el(fixture, '.body').click();
    expect(opened).toEqual(['l-1']);
  });

  it('starts the stepper at the suggested amount, and never below one', async () => {
    const fixture = await render(row({ quantity: 2 }));

    expect(stepper(fixture).value()).toBe(2);
    expect(stepper(fixture).min()).toBe(1);

    press(fixture, 0);
    expect(stepper(fixture).value()).toBe(1);
    expect(stepper(fixture).minusAtEnd()).toBe(true);
  });

  it('adds the suggested amount when the button is pressed as it is', async () => {
    const fixture = await render(row({ quantity: 2 }));
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    expect(el(fixture, '.add').textContent).toContain('list.due.add');
    expect(el(fixture, '.add').getAttribute('aria-label')).toBe(
      'list.due.addLabel'
    );

    el(fixture, '.add').click();
    expect(added).toEqual([{ lineId: 'l-1', quantity: 2 }]);
  });

  it('adds the amount chosen on the stepper, and writes nothing while it moves (switch off)', async () => {
    jest.useFakeTimers();
    const fixture = await render(row({ quantity: 2 }), { quietMs: 100 });
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    press(fixture, 1);
    press(fixture, 1);
    jest.advanceTimersByTime(1000);
    expect(added).toEqual([]);
    expect(fixture.componentInstance.amount()).toBe(4);

    el(fixture, '.add').click();
    expect(added).toEqual([{ lineId: 'l-1', quantity: 4 }]);
  });

  it('adds by itself once a change goes quiet, when the switch is on', async () => {
    jest.useFakeTimers();
    const fixture = await render(row({ quantity: 2 }), {
      addsOnStep: true,
      quietMs: 100,
    });
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    press(fixture, 1);
    jest.advanceTimersByTime(99);
    press(fixture, 1);
    jest.advanceTimersByTime(99);
    // Every press starts the wait again, so three presses are one add.
    press(fixture, 1);
    expect(added).toEqual([]);

    jest.advanceTimersByTime(100);
    expect(added).toEqual([{ lineId: 'l-1', quantity: 5 }]);
  });

  it('does not add twice when the button is pressed while an add on step is waiting', async () => {
    jest.useFakeTimers();
    const fixture = await render(row({ quantity: 1 }), {
      addsOnStep: true,
      quietMs: 100,
    });
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    press(fixture, 1);
    el(fixture, '.add').click();
    jest.advanceTimersByTime(500);

    expect(added).toEqual([{ lineId: 'l-1', quantity: 2 }]);
  });

  it('keeps the chosen amount when the row is drawn again with the same suggestion', async () => {
    const fixture = await render(row({ quantity: 2 }));
    press(fixture, 1);

    fixture.componentRef.setInput('row', row({ quantity: 2, name: 'Eggs' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.amount()).toBe(3);

    fixture.componentRef.setInput('row', row({ quantity: 6 }));
    fixture.detectChanges();
    expect(fixture.componentInstance.amount()).toBe(6);
  });

  it("steps by the product's step the row carries (velista 0186)", async () => {
    const fixture = await render(
      row({ quantity: 1000, unit: 'GRAM', step: 100 })
    );
    expect(stepper(fixture).step()).toBe(100);

    press(fixture, 0);

    expect(fixture.componentInstance.amount()).toBe(900);
  });
});

/** Velista `0203`: the reel in the compact view, and the button's words in both. */
describe('DueLineRow, the compact view and the Add button (velista 0203)', () => {
  afterEach(() => jest.useRealTimers());

  function pointer(type: string, clientX: number): Event {
    const event = new MouseEvent(type, { bubbles: true, clientX });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'isPrimary', { value: true });
    // The button is down from the press until the lift, as on a real pointer.
    Object.defineProperty(event, 'buttons', {
      value: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    });
    return event;
  }

  async function compact(vm: DueLineRowVm) {
    const fixture = await render(vm);
    fixture.componentRef.setInput('layout', 'compact');
    fixture.detectChanges();
    return fixture;
  }

  function reel(fixture: ComponentFixture<DueLineRow>): QuantityReel {
    return fixture.debugElement.query(By.directive(QuantityReel))
      .componentInstance as QuantityReel;
  }

  it('draws the reel with a floor of 1 and no stepper in the compact view', async () => {
    const fixture = await compact(row({ quantity: 2 }));

    expect(
      fixture.debugElement.query(By.directive(QuantityStepper))
    ).toBeNull();
    expect(reel(fixture).value()).toBe(2);
    expect(reel(fixture).min()).toBe(1);
    expect(reel(fixture).previous()).toBe(1);
  });

  it('draws the stepper and no reel in the default view', async () => {
    const fixture = await render(row());

    expect(fixture.debugElement.query(By.directive(QuantityReel))).toBeNull();
    expect(stepper(fixture)).toBeDefined();
  });

  it('adds the amount the reel closed on', async () => {
    jest.useFakeTimers();
    const fixture = await compact(row({ quantity: 2 }));
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    const host = fixture.nativeElement.querySelector(
      'lib-quantity-reel'
    ) as HTMLElement;
    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(pointer('pointermove', -2 * QUANTITY_REEL_PX_PER_UNIT));
    host.dispatchEvent(pointer('pointerup', -2 * QUANTITY_REEL_PX_PER_UNIT));
    jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
    fixture.detectChanges();

    expect(fixture.componentInstance.amount()).toBe(4);
    expect(added).toEqual([]);
    el(fixture, '.add').click();
    expect(added).toEqual([{ lineId: 'l-1', quantity: 4 }]);
  });

  /** A drag, then the tape left open: what a thumb leaves behind on a phone. */
  function dragReel(fixture: ComponentFixture<DueLineRow>, units: number) {
    const host = fixture.nativeElement.querySelector(
      'lib-quantity-reel'
    ) as HTMLElement;
    host.dispatchEvent(pointer('pointerdown', 0));
    host.dispatchEvent(
      pointer('pointermove', -units * QUANTITY_REEL_PX_PER_UNIT)
    );
    host.dispatchEvent(
      pointer('pointerup', -units * QUANTITY_REEL_PX_PER_UNIT)
    );
    fixture.detectChanges();
  }

  /** A press and a click on Add, as a tap makes them; a touch tap moves no focus. */
  function tapAdd(fixture: ComponentFixture<DueLineRow>): void {
    const add = el(fixture, '.add');
    add.dispatchEvent(pointer('pointerdown', 0));
    add.click();
    fixture.detectChanges();
  }

  it('adds the amount on screen when Add is tapped while the tape is still open', async () => {
    jest.useFakeTimers();
    const fixture = await compact(row({ quantity: 2 }));
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    dragReel(fixture, 2);
    expect(reel(fixture).open()).toBe(true);
    tapAdd(fixture);

    expect(added).toEqual([{ lineId: 'l-1', quantity: 4 }]);
    expect(reel(fixture).open()).toBe(false);
    jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS * 2);
    expect(added).toHaveLength(1);
  });

  it('adds once with addsOnStep on, when Add is tapped while the tape is open', async () => {
    jest.useFakeTimers();
    const fixture = await render(row({ quantity: 2 }), {
      addsOnStep: true,
      quietMs: 100,
    });
    fixture.componentRef.setInput('layout', 'compact');
    fixture.detectChanges();
    const added: Array<{ lineId: string; quantity: number }> = [];
    fixture.componentInstance.added.subscribe((event) => added.push(event));

    dragReel(fixture, 2);
    tapAdd(fixture);
    jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS * 2);

    expect(added).toEqual([{ lineId: 'l-1', quantity: 4 }]);
  });

  it('closes the open tape on a press on the name too', async () => {
    jest.useFakeTimers();
    const fixture = await compact(row({ quantity: 2 }));

    dragReel(fixture, 1);
    el(fixture, '.body').dispatchEvent(pointer('pointerdown', 0));
    fixture.detectChanges();

    expect(reel(fixture).open()).toBe(false);
    expect(fixture.componentInstance.amount()).toBe(3);
  });

  it('spec 10: the words are "Add" and "Añadir" with no amount', () => {
    expect(en.list.due.add).toBe('Add');
    expect(es.list.due.add).toBe('Añadir');
  });

  it.each([
    ['compact', 3, 'UNIT', '3'],
    ['default', 3, 'UNIT', '3'],
    ['compact', 1500, 'GRAM', '1.5 kg'],
    ['default', 1500, 'GRAM', '1.5 kg'],
  ] as const)(
    'specs 10 and 11: in the %s view at %s the button says no amount, and its name does',
    async (layout, quantity, unit, words) => {
      const fixture = await render(row({ quantity, unit }));
      fixture.componentRef.setInput('layout', layout);
      fixture.detectChanges();
      const add = el(fixture, '.add');

      // The testing translator draws a key with its values after it, so a key read
      // with no values is drawn alone.
      expect(add.textContent?.trim()).toBe('list.due.add');
      expect(add.textContent).not.toContain(words);
      expect(add.getAttribute('aria-label')).toBe('list.due.addLabel');
      expect(fixture.componentInstance.amountWords()).toBe(
        unit === 'UNIT' ? quantity : words
      );
      expect(en.list.due.addLabel).toBe(
        'Add {{count}} of {{name}} to the list'
      );
    }
  );
});

/**
 * Velista 0196, target state 5. The due row's two buttons have no row around them that
 * the browser would highlight, but each would get the blue box of its own: both turn it
 * off, and the body, which opens the line, draws its own press instead.
 */
describe('DueLineRow, the press (velista 0196)', () => {
  const rules = compiledRules('due-line-row.scss');
  const body = (selector: string) =>
    rules.find((rule) => rule.selector === selector)?.body;

  it('turns off the tap highlight on both buttons', () => {
    for (const button of ['.body', '.add']) {
      expect(body(button)).toMatch(
        /-webkit-tap-highlight-color:\s*transparent;/
      );
    }
  });

  it('sinks the body while it is pressed, with no transition', () => {
    expect(body('.body:active')).toMatch(
      /background:\s*var\(--app-surface-sunken\);/
    );
    expect(
      rules.some(
        (rule) =>
          rule.selector.startsWith('.body') && rule.body.includes('transition')
      )
    ).toBe(false);
  });
});
