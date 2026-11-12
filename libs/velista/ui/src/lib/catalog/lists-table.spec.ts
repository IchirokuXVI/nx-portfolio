import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  HoldingRow,
  ProductListGroup,
  ProductListRow,
} from '@portfolio/velista/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QuantityStepper } from '../list/quantity-stepper';
import { ListsTable, type ListsTableStep } from './lists-table';

/**
 * The lists of every group and how many of one product each holds (velista
 * `0134`, section 7): one stepper for each list, a row of its own for a line that
 * holds the product under another name, and words in place of a stepper on a list
 * the person only reads.
 */
function held(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    lineId: 'line-coffee',
    name: 'Ground coffee',
    quantity: 2,
    unit: 'UNIT',
    editable: true,
    pending: false,
    ...overrides,
  };
}

function list(
  listId: string,
  name: string,
  overrides: Partial<ProductListRow> = {}
): ProductListRow {
  return {
    listId,
    name,
    lastUsed: false,
    canAdd: true,
    main: null,
    others: [],
    ...overrides,
  };
}

/** The line somebody typed in their own words, which holds the same product. */
const MACHINE = held({
  lineId: 'line-machine',
  name: 'Coffee for the machine',
  quantity: 1,
});

/** Holds the product under its own name, and was the last list used. */
const WEEKLY = list('l1', 'Weekly shop', { lastUsed: true, main: held() });
/** Does not hold the product. */
const BARBECUE = list('l2', 'Barbecue');
/** Holds it under another name only. */
const OFFICE = list('l3', 'Office', { others: [MACHINE] });
/** A list the person can read and cannot add to. */
const PARENTS = list('l4', 'Parents', { canAdd: false });

const HOME: ProductListGroup = {
  zoneId: 'z1',
  zoneName: 'Home',
  lists: [WEEKLY, BARBECUE],
};
const WORK: ProductListGroup = {
  zoneId: 'z2',
  zoneName: 'Work',
  lists: [OFFICE, PARENTS],
};

const GROUPS: readonly ProductListGroup[] = [HOME, WORK];

/** One group of the lists given, for a spec about one list. */
function only(...lists: ProductListRow[]): readonly ProductListGroup[] {
  return [{ zoneId: 'z1', zoneName: 'Home', lists }];
}

/** Every translator call of the render, to read the values a string was given. */
let asked: jest.SpyInstance;

async function render(
  groups: readonly ProductListGroup[] = GROUPS
): Promise<ComponentFixture<ListsTable>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ListsTable, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(ListsTable);
  fixture.componentRef.setInput('groups', groups);
  fixture.componentRef.setInput('product', 'Café molido');
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<ListsTable>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function listOf(
  fixture: ComponentFixture<ListsTable>,
  listId: string
): HTMLElement {
  return host(fixture).querySelector(
    `li.list[data-list="${listId}"]`
  ) as HTMLElement;
}

/** The list's own row: its name and, where the person may use one, its stepper. */
function rowOf(
  fixture: ComponentFixture<ListsTable>,
  listId: string
): HTMLElement {
  return listOf(fixture, listId).querySelector('.row') as HTMLElement;
}

/** The inset row of one line that holds the product under another name. */
function otherOf(
  fixture: ComponentFixture<ListsTable>,
  lineId: string
): HTMLElement {
  return host(fixture).querySelector(
    `.other[data-line="${lineId}"]`
  ) as HTMLElement;
}

/** What the first stepper within draws, in base units (velista 0188, L). */
function amountOf(within: HTMLElement): string | null | undefined {
  return within
    .querySelector('lib-quantity-stepper')
    ?.getAttribute('data-value');
}

/** Whether a stepper button is at an end or off: drawn, focusable, and deaf. */
function off(button: HTMLButtonElement | undefined): boolean {
  return button?.getAttribute('aria-disabled') === 'true';
}

/** The stepper of a list's own row, to emit what a hold would. */
function stepperOf(
  fixture: ComponentFixture<ListsTable>,
  listId: string
): QuantityStepper {
  return fixture.debugElement.query(
    By.css(`li.list[data-list="${listId}"] .row lib-quantity-stepper`)
  ).componentInstance as QuantityStepper;
}

/** The accessible name of the first stepper within. */
function groupName(within: HTMLElement): string | null | undefined {
  return within.querySelector('[role="group"]')?.getAttribute('aria-label');
}

/** A stepper's two buttons: the minus, then the plus. */
function steps(within: HTMLElement): HTMLButtonElement[] {
  return [
    ...within.querySelectorAll<HTMLButtonElement>(
      'lib-quantity-stepper button'
    ),
  ];
}

/** The values every call for a key was given, with no repeats. */
function valuesOf(key: string): unknown[] {
  const seen = new Map<string, unknown>();
  for (const call of asked.mock.calls) {
    if (call[0] === key) {
      seen.set(JSON.stringify(call[3]), call[3]);
    }
  }
  return [...seen.values()];
}

function record(fixture: ComponentFixture<ListsTable>): {
  added: string[];
  lineStepped: ListsTableStep[];
} {
  const heard = {
    added: [] as string[],
    lineStepped: [] as ListsTableStep[],
  };
  fixture.componentInstance.added.subscribe((id) => heard.added.push(id));
  fixture.componentInstance.lineStepped.subscribe((step) =>
    heard.lineStepped.push(step)
  );
  return heard;
}

describe('ListsTable', () => {
  describe('the groups and their lists', () => {
    it('draws each group under its name, in the order given', async () => {
      const fixture = await render();

      expect(
        [...host(fixture).querySelectorAll('h3.group')].map(
          (one) => one.textContent
        )
      ).toEqual(['Home', 'Work']);
      expect(host(fixture).querySelectorAll('ul.lists')).toHaveLength(2);
    });

    it('draws every list of a group, in the order given', async () => {
      const fixture = await render();

      expect(
        [...host(fixture).querySelectorAll<HTMLElement>('li.list')].map(
          (one) => [
            one.dataset['list'],
            one.querySelector('.name')?.textContent,
          ]
        )
      ).toEqual([
        ['l1', 'Weekly shop'],
        ['l2', 'Barbecue'],
        ['l3', 'Office'],
        ['l4', 'Parents'],
      ]);
    });

    it('does not sort: the page hands the lists in with the last used one first', async () => {
      const fixture = await render(only(BARBECUE, WEEKLY));

      expect(
        [...host(fixture).querySelectorAll<HTMLElement>('li.list')].map(
          (one) => one.dataset['list']
        )
      ).toEqual(['l2', 'l1']);
    });

    it('draws nothing for no groups', async () => {
      const fixture = await render([]);

      expect(host(fixture).querySelector('.group')).toBeNull();
      expect(host(fixture).querySelector('button')).toBeNull();
    });

    it('says which list was the last used, in words, and says it of no other', async () => {
      const fixture = await render();

      expect(
        ['l1', 'l2', 'l3', 'l4'].map(
          (id) =>
            listOf(fixture, id).querySelector('.last')?.textContent?.trim() ??
            null
        )
      ).toEqual(['catalog.inLists.last', null, null, null]);
    });
  });

  describe("a list's own stepper", () => {
    it('starts at the quantity of the line under the product name', async () => {
      const fixture = await render();

      const stepper = rowOf(fixture, 'l1');
      expect(amountOf(stepper)).toBe('2');
    });

    it('starts at zero on a list with no such line', async () => {
      const fixture = await render();

      const stepper = rowOf(fixture, 'l2');
      expect(amountOf(stepper)).toBe('0');
      // Nothing to take away yet.
      expect(off(steps(stepper)[0])).toBe(true);
      expect(off(steps(stepper)[1])).toBe(false);
    });

    it('is not drawn on a list that holds the product under another name only (decision B)', async () => {
      const fixture = await render();

      // Its line has a row of its own, with a stepper that works.
      expect(
        rowOf(fixture, 'l3').querySelector('lib-quantity-stepper')
      ).toBeNull();
      expect(amountOf(otherOf(fixture, 'line-machine'))).toBe('1');
      expect(steps(otherOf(fixture, 'line-machine')).map(off)).toEqual([
        false,
        false,
      ]);
    });

    it('is not drawn either where the only line of the product is stocked at zero', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            others: [held({ lineId: 'line-zero', quantity: 0 })],
          })
        )
      );

      expect(
        rowOf(fixture, 'l1').querySelector('lib-quantity-stepper')
      ).toBeNull();
      expect(amountOf(otherOf(fixture, 'line-zero'))).toBe('0');
    });

    it('says its amount is of the product on its list', async () => {
      const fixture = await render();

      expect(groupName(rowOf(fixture, 'l1'))).toBe('amount.group');
      expect(valuesOf('amount.inList')).toEqual(
        expect.arrayContaining([
          { name: 'Café molido', list: 'Weekly shop' },
          { name: 'Café molido', list: 'Barbecue' },
        ])
      );
      expect(valuesOf('amount.inList')).not.toContainEqual({
        name: 'Café molido',
        list: 'Office',
      });
    });

    it('is the row stepper, with no tint on any row', async () => {
      const fixture = await render();

      const all = host(fixture).querySelectorAll('lib-quantity-stepper');
      expect(all.length).toBeGreaterThan(0);
      for (const one of all) {
        expect(one.classList.contains('variant-row')).toBe(true);
        expect(one.classList.contains('is-accent')).toBe(false);
        expect(one.classList.contains('is-took')).toBe(false);
      }
    });

    it('draws a weight as its amount over its unit: "750" over "g"', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            main: held({ quantity: 750, unit: 'GRAM' }),
          })
        )
      );

      const figure = rowOf(fixture, 'l1').querySelector('lib-amount-figure');
      expect(figure?.querySelector('.number')?.textContent).toBe('750');
      expect(figure?.querySelector('.symbol')?.textContent).toBe('g');
      // The number comes first, and the symbol is drawn under it.
      expect(figure?.firstElementChild?.classList.contains('number')).toBe(
        true
      );
    });

    it('makes the line on a plus from zero: an add, with the list', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l2'))[1]?.click();

      expect(heard.added).toEqual(['l2']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('steps the line on a plus when the line is there, never an add (U5)', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[1]?.click();

      expect(heard.lineStepped).toEqual([
        {
          listId: 'l1',
          lineId: 'line-coffee',
          step: { from: 2, to: 3, repeat: false },
        },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('steps a weight line by one step, as the list page does', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            main: held({
              lineId: 'line-milk',
              quantity: 2000,
              unit: 'MILLILITER',
            }),
          })
        )
      );
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[1]?.click();

      expect(heard.lineStepped).toEqual([
        {
          listId: 'l1',
          lineId: 'line-milk',
          step: { from: 2000, to: 2025, repeat: false },
        },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('passes every repeat of a held plus on to the line', async () => {
      const fixture = await render();
      const heard = record(fixture);

      stepperOf(fixture, 'l1').stepped.emit({ from: 2, to: 3, repeat: true });
      stepperOf(fixture, 'l1').stepped.emit({ from: 3, to: 4, repeat: true });

      expect(heard.lineStepped.map((one) => one.step)).toEqual([
        { from: 2, to: 3, repeat: true },
        { from: 3, to: 4, repeat: true },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('adds once per press from zero: a repeat of a held plus sends no add', async () => {
      const fixture = await render();
      const heard = record(fixture);

      stepperOf(fixture, 'l2').stepped.emit({ from: 0, to: 1, repeat: false });
      stepperOf(fixture, 'l2').stepped.emit({ from: 1, to: 2, repeat: true });
      stepperOf(fixture, 'l2').stepped.emit({ from: 2, to: 3, repeat: true });

      expect(heard.added).toEqual(['l2']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('says one fewer for the line under the product name on a minus', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        {
          listId: 'l1',
          lineId: 'line-coffee',
          step: { from: 2, to: 1, repeat: false },
        },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('says one fewer at one too, which is how the line goes to zero', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { main: held({ quantity: 1 }) }))
      );
      const heard = record(fixture);

      expect(off(steps(rowOf(fixture, 'l1'))[0])).toBe(false);
      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        {
          listId: 'l1',
          lineId: 'line-coffee',
          step: { from: 1, to: 0, repeat: false },
        },
      ]);
    });

    it('draws the trash on the minus at one, and the line at zero then has its own row (owner, 2026-11-12; decision B)', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { main: held({ quantity: 1 }) }))
      );

      // The next press reaches zero, so the minus says the line will go.
      const minus = steps(rowOf(fixture, 'l1'))[0];
      expect(minus?.classList.contains('is-clear')).toBe(true);
      minus?.click();

      // The store keeps the line at zero; it is no longer under the product name.
      fixture.componentRef.setInput(
        'groups',
        only(list('l1', 'Weekly shop', { others: [held({ quantity: 0 })] }))
      );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        rowOf(fixture, 'l1').querySelector('lib-quantity-stepper')
      ).toBeNull();
      expect(amountOf(otherOf(fixture, 'line-coffee'))).toBe('0');
    });

    it('draws no trash on the minus above one', async () => {
      const fixture = await render();

      expect(
        steps(rowOf(fixture, 'l1'))[0]?.classList.contains('is-clear')
      ).toBe(false);
    });

    it('draws the amount and no buttons for a person who may add and may not change the quantity (decision C)', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', { main: held({ editable: false }) }),
          BARBECUE
        )
      );

      const row = rowOf(fixture, 'l1');
      expect(
        row
          .querySelector('lib-quantity-stepper')
          ?.classList.contains('is-readonly')
      ).toBe(true);
      expect(amountOf(row)).toBe('2');
      expect(steps(row)).toEqual([]);
      // And no switched off plus, and no words in its place.
      expect(row.querySelector('.sub')).toBeNull();
      // A list that does not hold it keeps its add control.
      expect(steps(rowOf(fixture, 'l2'))).toHaveLength(2);
    });

    it('keeps both buttons, switched off, and the focus while the add of a plus at zero is out', async () => {
      const fixture = await render(only(BARBECUE));
      document.body.appendChild(host(fixture));
      const plus = steps(rowOf(fixture, 'l2'))[1];
      plus?.focus();
      plus?.click();

      // The store draws the line at once, before the add answers.
      fixture.componentRef.setInput(
        'groups',
        only(
          list('l2', 'Barbecue', {
            main: held({
              lineId: 'unsaved:l2/item-coffee',
              quantity: 1,
              editable: false,
            }),
          })
        )
      );
      fixture.detectChanges();
      await fixture.whenStable();

      const row = rowOf(fixture, 'l2');
      const stepper = row.querySelector('lib-quantity-stepper');
      expect(stepper?.classList.contains('is-readonly')).toBe(false);
      expect(stepper?.classList.contains('is-disabled')).toBe(true);
      const both = steps(row);
      expect(both).toHaveLength(2);
      expect(both.every(off)).toBe(true);
      expect(both[1]).toBe(plus);
      expect(document.activeElement).toBe(plus);
      host(fixture).remove();
    });

    it('counts at zero in the unit the product is asked for: "0" over "ml", a step of 25 ml', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ListsTable, RokuTranslatorTestingModule.forTesting()],
      }).compileComponents();
      asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');
      const fixture = TestBed.createComponent(ListsTable);
      fixture.componentRef.setInput('groups', only(BARBECUE));
      fixture.componentRef.setInput('product', 'Leche');
      fixture.componentRef.setInput('unit', 'MILLILITER');
      fixture.detectChanges();
      await fixture.whenStable();

      const figure = rowOf(fixture, 'l2').querySelector('lib-amount-figure');
      expect(figure?.querySelector('.number')?.textContent).toBe('0');
      expect(figure?.querySelector('.symbol')?.textContent).toBe('ml');
      expect(valuesOf('amount.more')).toContainEqual(
        expect.objectContaining({ step: '25 ml' })
      );
    });

    it('counts at zero for a product with no unit given, and the line drawn keeps its own unit', async () => {
      const fixture = await render(
        only(
          BARBECUE,
          list('l1', 'Weekly shop', {
            main: held({ quantity: 750, unit: 'GRAM' }),
          })
        )
      );

      expect(stepperOf(fixture, 'l2').unit()).toBe('UNIT');
      expect(stepperOf(fixture, 'l1').unit()).toBe('GRAM');
    });

    it('moves the line both ways for a person who may change it and may not add', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { canAdd: false, main: held() }))
      );
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[1]?.click();
      // The caller keeps the amount; its redraw is the base of the next press.
      fixture.detectChanges();
      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.added).toEqual([]);
      expect(heard.lineStepped).toEqual([
        {
          listId: 'l1',
          lineId: 'line-coffee',
          step: { from: 2, to: 3, repeat: false },
        },
        {
          listId: 'l1',
          lineId: 'line-coffee',
          step: { from: 2, to: 1, repeat: false },
        },
      ]);
    });

    it('draws the quantity it is given again after a press the list did not take', async () => {
      const fixture = await render();

      // The write fails, so the quantity the table is given never moves.
      steps(rowOf(fixture, 'l1'))[1]?.click();
      fixture.detectChanges();

      expect(amountOf(rowOf(fixture, 'l1'))).toBe('2');
    });

    it('draws the new quantity once the list has taken the press', async () => {
      const fixture = await render();

      steps(rowOf(fixture, 'l2'))[1]?.click();
      fixture.componentRef.setInput('groups', [
        {
          ...HOME,
          lists: [
            WEEKLY,
            { ...BARBECUE, main: held({ lineId: 'line-new', quantity: 1 }) },
          ],
        },
        WORK,
      ]);
      fixture.detectChanges();

      expect(amountOf(rowOf(fixture, 'l2'))).toBe('1');
      expect(amountOf(rowOf(fixture, 'l1'))).toBe('2');
    });

    it('says the line waits for approval only when it does', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', { main: held({ pending: true }) }),
          BARBECUE
        )
      );

      expect(rowOf(fixture, 'l1').querySelector('.sub')?.textContent).toContain(
        'catalog.added.pending'
      );
      expect(rowOf(fixture, 'l2').querySelector('.sub')).toBeNull();
    });
  });

  describe('a line under another name', () => {
    it('gets its own row under its list, with its name and its own quantity', async () => {
      const fixture = await render();

      const row = otherOf(fixture, 'line-machine');
      expect(row.closest('li.list')).toBe(listOf(fixture, 'l3'));
      expect(row.querySelector('.other-name')?.textContent).toBe(
        'Coffee for the machine'
      );
      expect(row.querySelector('.sub')?.textContent).toContain(
        'catalog.inLists.other'
      );
      expect(amountOf(row)).toBe('1');
      // The list draws no stepper of its own beside it (decision B).
      expect(
        listOf(fixture, 'l3').querySelectorAll('lib-quantity-stepper')
      ).toHaveLength(1);
    });

    it('draws no such row on a list with none', async () => {
      const fixture = await render();

      expect(listOf(fixture, 'l1').querySelector('.other')).toBeNull();
      expect(listOf(fixture, 'l2').querySelector('.other')).toBeNull();
    });

    it('draws a row for each when a list has several, in the order given', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            main: held(),
            others: [
              MACHINE,
              held({ lineId: 'line-guests', name: 'For guests', quantity: 3 }),
            ],
          })
        )
      );

      expect(
        [...listOf(fixture, 'l1').querySelectorAll<HTMLElement>('.other')].map(
          (one) => [one.dataset['line'], amountOf(one)]
        )
      ).toEqual([
        ['line-machine', '1'],
        ['line-guests', '3'],
      ]);
      // And the list's own stepper still counts the line of the product's name.
      expect(amountOf(rowOf(fixture, 'l1'))).toBe('2');
    });

    it('says its amount is of the line on the list, in the row stepper', async () => {
      const fixture = await render();

      const row = otherOf(fixture, 'line-machine');
      expect(groupName(row)).toBe('amount.group');
      expect(valuesOf('amount.inList')).toContainEqual({
        name: 'Coffee for the machine',
        list: 'Office',
      });
      expect(
        row
          .querySelector('lib-quantity-stepper')
          ?.classList.contains('variant-row')
      ).toBe(true);
    });

    it('says a step for that line, with its list, and never an add', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(otherOf(fixture, 'line-machine'))[1]?.click();
      // The caller keeps the amount; its redraw is the base of the next press.
      fixture.detectChanges();
      steps(otherOf(fixture, 'line-machine'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        {
          listId: 'l3',
          lineId: 'line-machine',
          step: { from: 1, to: 2, repeat: false },
        },
        {
          listId: 'l3',
          lineId: 'line-machine',
          step: { from: 1, to: 0, repeat: false },
        },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('has a disabled stepper when the person may not change it, and still shows how many', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            others: [{ ...MACHINE, editable: false }],
          })
        )
      );
      const heard = record(fixture);

      const row = otherOf(fixture, 'line-machine');
      expect(steps(row).map(off)).toEqual([true, true]);
      expect(amountOf(row)).toBe('1');

      for (const button of steps(row)) {
        button.click();
      }

      expect(heard.lineStepped).toEqual([]);
    });

    it('says it waits for approval when it does', async () => {
      const fixture = await render(
        only(
          list('l1', 'Weekly shop', {
            others: [{ ...MACHINE, pending: true }],
          })
        )
      );

      const sub = otherOf(fixture, 'line-machine').querySelector('.sub');
      expect(sub?.textContent?.trim()).toBe('catalog.inLists.otherPending');
    });
  });

  describe('a list the person only reads', () => {
    it('has no stepper, and says so in words', async () => {
      const fixture = await render();

      const row = rowOf(fixture, 'l4');
      expect(row.querySelector('lib-quantity-stepper')).toBeNull();
      expect(row.querySelector('button')).toBeNull();
      expect(row.querySelector('.sub')?.textContent).toContain(
        'catalog.inLists.readOnly'
      );
    });

    it('is still named, and drawn quieter', async () => {
      const fixture = await render();

      const name = rowOf(fixture, 'l4').querySelector('.name');
      expect(name?.textContent).toBe('Parents');
      expect(name?.classList.contains('is-read')).toBe(true);
      expect(
        rowOf(fixture, 'l1')
          .querySelector('.name')
          ?.classList.contains('is-read')
      ).toBe(false);
    });

    it('does not say so of a list the person may add to', async () => {
      const fixture = await render();

      for (const id of ['l1', 'l2', 'l3']) {
        expect(listOf(fixture, id).textContent).not.toContain(
          'catalog.inLists.readOnly'
        );
      }
    });

    it('still shows a line that holds the product under another name, with a stepper nobody can press', async () => {
      const fixture = await render(
        only(
          list('l4', 'Parents', {
            canAdd: false,
            others: [{ ...MACHINE, editable: false }],
          })
        )
      );

      expect(
        rowOf(fixture, 'l4').querySelector('lib-quantity-stepper')
      ).toBeNull();
      const row = otherOf(fixture, 'line-machine');
      expect(amountOf(row)).toBe('1');
      expect(steps(row).map(off)).toEqual([true, true]);
    });
  });

  it("hands the product's step to every stepper of the table (velista 0186)", async () => {
    const weight = held({ quantity: 1000, unit: 'GRAM' });
    const fixture = await render(
      only(
        list('l1', 'Weekly shop', { main: weight }),
        list('l3', 'Office', {
          others: [{ ...MACHINE, quantity: 500, unit: 'GRAM' }],
        })
      )
    );
    fixture.componentRef.setInput('step', 100);
    fixture.detectChanges();

    const stepped: ListsTableStep[] = [];
    fixture.componentInstance.lineStepped.subscribe((step) =>
      stepped.push(step)
    );
    steps(rowOf(fixture, 'l1'))[0].click();
    steps(otherOf(fixture, 'line-machine'))[1].click();

    expect(stepped.map((each) => each.step)).toEqual([
      { from: 1000, to: 900, repeat: false },
      { from: 500, to: 600, repeat: false },
    ]);
  });

  it("steps each line by the line's own step, the one the list page uses (velista 0186, decision A)", async () => {
    // "Pollo" holds a whole chicken (250) and thighs (100): the list page steps it
    // by 100, the smallest, so the whole chicken's page must too.
    const pollo = held({ quantity: 1000, unit: 'GRAM', step: 100 });
    const plain = held({ quantity: 1000, unit: 'GRAM', step: null });
    const fixture = await render(
      only(
        list('l1', 'Groceries', { main: pollo }),
        list('l3', 'Office', {
          others: [{ ...MACHINE, quantity: 1000, unit: 'GRAM', step: null }],
        }),
        list('l5', 'Unread', {
          main: { ...plain, lineId: 'line-unread', step: undefined },
        })
      )
    );
    fixture.componentRef.setInput('step', 250);
    fixture.detectChanges();

    const stepped: ListsTableStep[] = [];
    fixture.componentInstance.lineStepped.subscribe((step) =>
      stepped.push(step)
    );
    steps(rowOf(fixture, 'l1'))[0].click();
    // Known to be the default: not the product's 250.
    steps(otherOf(fixture, 'line-machine'))[0].click();
    // Not known yet: the product's step stands in.
    steps(rowOf(fixture, 'l5'))[0].click();

    expect(stepped.map((each) => each.step.to)).toEqual([900, 975, 750]);
  });

  it('never draws a dash for a list that holds none', async () => {
    const fixture = await render();

    expect(host(fixture).textContent).not.toMatch(/[–—]/);
  });

  it('has every string of the table in both languages', () => {
    // The testing translator answers the key, so the strings are read off the
    // files the real one loads.
    for (const locale of ['en', 'es']) {
      const file = join(__dirname, '../../../assets/i18n', `${locale}.json`);
      const catalog = JSON.parse(readFileSync(file, 'utf8')).catalog;

      for (const key of ['last', 'other', 'otherPending', 'readOnly']) {
        expect([key, typeof catalog.inLists[key]]).toEqual([key, 'string']);
      }
      expect(typeof catalog.added.pending).toBe('string');
      const amount = JSON.parse(readFileSync(file, 'utf8')).amount;
      expect(amount.inList).toContain('{{name}}');
      expect(amount.inList).toContain('{{list}}');
    }
  });
});
