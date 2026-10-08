import { TestBed, type ComponentFixture } from '@angular/core/testing';
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

function spinbutton(within: HTMLElement): Element | null {
  return within.querySelector('[role="spinbutton"]');
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
      expect(stepper.querySelector('.value')?.textContent).toBe('2');
      expect(spinbutton(stepper)?.getAttribute('aria-valuenow')).toBe('2');
    });

    it('starts at zero on a list with no such line', async () => {
      const fixture = await render();

      const stepper = rowOf(fixture, 'l2');
      expect(stepper.querySelector('.value')?.textContent).toBe('0');
      expect(spinbutton(stepper)?.getAttribute('aria-valuenow')).toBe('0');
      // Nothing to take away yet.
      expect(steps(stepper)[0]?.disabled).toBe(true);
      expect(steps(stepper)[1]?.disabled).toBe(false);
    });

    it('starts at zero on a list that holds the product under another name only', async () => {
      const fixture = await render();

      expect(rowOf(fixture, 'l3').querySelector('.value')?.textContent).toBe(
        '0'
      );
    });

    it('is named for its list', async () => {
      const fixture = await render();

      expect(spinbutton(rowOf(fixture, 'l1'))?.getAttribute('aria-label')).toBe(
        'catalog.inLists.stepper'
      );
      expect(valuesOf('catalog.inLists.stepper')).toEqual([
        { list: 'Weekly shop' },
        { list: 'Barbecue' },
        { list: 'Office' },
      ]);
    });

    it('is full size, and in the quiet colour only while the list holds some', async () => {
      const fixture = await render();

      const some = rowOf(fixture, 'l1').querySelector('lib-quantity-stepper');
      const none = rowOf(fixture, 'l2').querySelector('lib-quantity-stepper');
      expect(some?.classList.contains('is-accent')).toBe(true);
      expect(some?.classList.contains('is-compact')).toBe(false);
      expect(none?.classList.contains('is-accent')).toBe(false);
    });

    it('makes the line on a plus from zero: an add, with the list', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l2'))[1]?.click();

      expect(heard.added).toEqual(['l2']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('goes through an add on a plus too when the line is there, where the person may add', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[1]?.click();

      // The server puts one more on the line of that name, and an add asks for
      // less than a change of quantity does.
      expect(heard.added).toEqual(['l1']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('says one fewer for the line under the product name on a minus', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        { listId: 'l1', lineId: 'line-coffee', by: -1 },
      ]);
      expect(heard.added).toEqual([]);
    });

    it('says one fewer at one too, which is how the line goes to zero', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { main: held({ quantity: 1 }) }))
      );
      const heard = record(fixture);

      expect(
        spinbutton(rowOf(fixture, 'l1'))?.getAttribute('aria-valuemin')
      ).toBe('0');
      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        { listId: 'l1', lineId: 'line-coffee', by: -1 },
      ]);
    });

    it('gives a plus and no minus to a person who may add and may not change the quantity', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { main: held({ editable: false }) }))
      );
      const heard = record(fixture);

      const stepper = rowOf(fixture, 'l1');
      expect(spinbutton(stepper)?.getAttribute('aria-valuemin')).toBe('2');
      expect(steps(stepper)[0]?.disabled).toBe(true);
      expect(steps(stepper)[1]?.disabled).toBe(false);

      steps(stepper)[0]?.click();
      steps(stepper)[1]?.click();

      expect(heard.added).toEqual(['l1']);
      expect(heard.lineStepped).toEqual([]);
    });

    it('moves the line both ways for a person who may change it and may not add', async () => {
      const fixture = await render(
        only(list('l1', 'Weekly shop', { canAdd: false, main: held() }))
      );
      const heard = record(fixture);

      steps(rowOf(fixture, 'l1'))[1]?.click();
      steps(rowOf(fixture, 'l1'))[0]?.click();

      expect(heard.added).toEqual([]);
      expect(heard.lineStepped).toEqual([
        { listId: 'l1', lineId: 'line-coffee', by: 1 },
        { listId: 'l1', lineId: 'line-coffee', by: -1 },
      ]);
    });

    it('draws the quantity it is given again after a press the list did not take', async () => {
      const fixture = await render();

      // The write fails, so the quantity the table is given never moves.
      steps(rowOf(fixture, 'l1'))[1]?.click();
      fixture.detectChanges();

      expect(rowOf(fixture, 'l1').querySelector('.value')?.textContent).toBe(
        '2'
      );
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

      expect(rowOf(fixture, 'l2').querySelector('.value')?.textContent).toBe(
        '1'
      );
      expect(rowOf(fixture, 'l1').querySelector('.value')?.textContent).toBe(
        '2'
      );
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
      expect(row.querySelector('.value')?.textContent).toBe('1');
      // Beside the list's own stepper, which stays at zero.
      expect(
        listOf(fixture, 'l3').querySelectorAll('lib-quantity-stepper')
      ).toHaveLength(2);
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
          (one) => [
            one.dataset['line'],
            one.querySelector('.value')?.textContent,
          ]
        )
      ).toEqual([
        ['line-machine', '1'],
        ['line-guests', '3'],
      ]);
      // And the list's own stepper still counts the line of the product's name.
      expect(rowOf(fixture, 'l1').querySelector('.value')?.textContent).toBe(
        '2'
      );
    });

    it('names its stepper for the line and the list, and draws it small', async () => {
      const fixture = await render();

      const row = otherOf(fixture, 'line-machine');
      expect(spinbutton(row)?.getAttribute('aria-label')).toBe(
        'catalog.held.stepper'
      );
      expect(valuesOf('catalog.held.stepper')).toEqual([
        { line: 'Coffee for the machine', list: 'Office' },
      ]);
      expect(
        row
          .querySelector('lib-quantity-stepper')
          ?.classList.contains('is-compact')
      ).toBe(true);
    });

    it('says a step for that line, with its list, and never an add', async () => {
      const fixture = await render();
      const heard = record(fixture);

      steps(otherOf(fixture, 'line-machine'))[1]?.click();
      steps(otherOf(fixture, 'line-machine'))[0]?.click();

      expect(heard.lineStepped).toEqual([
        { listId: 'l3', lineId: 'line-machine', by: 1 },
        { listId: 'l3', lineId: 'line-machine', by: -1 },
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
      expect(steps(row).map((one) => one.disabled)).toEqual([true, true]);
      expect(row.querySelector('.value')?.textContent).toBe('1');

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
      expect(row.querySelector('.value')?.textContent).toBe('1');
      expect(steps(row).map((one) => one.disabled)).toEqual([true, true]);
    });
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
      expect(catalog.inLists.stepper).toContain('{{list}}');
      expect(catalog.held.stepper).toContain('{{line}}');
      expect(catalog.held.stepper).toContain('{{list}}');
      expect(typeof catalog.added.pending).toBe('string');
    }
  });
});
