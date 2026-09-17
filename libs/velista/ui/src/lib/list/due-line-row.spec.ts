import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { DueLineRowVm } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { DueLineRow } from './due-line-row';
import { QuantityStepper } from './quantity-stepper';

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
    expect(stepper(fixture).canDecrease()).toBe(false);
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
});
