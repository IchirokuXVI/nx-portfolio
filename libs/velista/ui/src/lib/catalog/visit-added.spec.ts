import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  VisitAdded,
  type VisitAddedRow,
  type VisitAddedSection,
  type VisitAddedStep,
} from './visit-added';

/**
 * What this visit to the catalog added (velista `0134`, section 4.4): one row and
 * one stepper for each line the visit added to, a button that takes all of them
 * back, and a link to the list.
 */
function row(overrides: Partial<VisitAddedRow> = {}): VisitAddedRow {
  return {
    lineId: 'line-oil',
    itemId: 'item-oil',
    name: 'Olive oil',
    detail: '1 L · €8.45 at Mercadona',
    quantity: 2,
    floor: 1,
    pending: false,
    ...overrides,
  };
}

const MILK = row({
  lineId: 'line-milk',
  itemId: 'item-milk',
  name: 'Milk',
  detail: null,
  quantity: 1,
});

const WEEKLY: VisitAddedSection = {
  listId: 'l1',
  name: 'Weekly shop',
  rows: [row(), MILK],
};

const BARBECUE: VisitAddedSection = {
  listId: 'l2',
  name: 'Barbecue',
  rows: [
    row({
      lineId: 'line-coal',
      itemId: 'item-coal',
      name: 'Charcoal',
      quantity: 3,
    }),
  ],
};

/** A press on the minus of the olive oil on the weekly shop. */
const OIL_DOWN: VisitAddedStep = {
  listId: 'l1',
  itemId: 'item-oil',
  lineId: 'line-oil',
  detail: '1 L · €8.45 at Mercadona',
  by: -1,
};

/**
 * One product on two lines of one list: under its own name, and under a name
 * somebody typed. The visit added to both.
 */
const TWICE: VisitAddedSection = {
  listId: 'l1',
  name: 'Weekly shop',
  rows: [
    row(),
    row({ lineId: 'line-fry', name: 'Oil for the fryer', quantity: 4 }),
  ],
};

/** Every translator call of the render, to read the values a string was given. */
let asked: jest.SpyInstance;

async function render(
  sections: readonly VisitAddedSection[]
): Promise<ComponentFixture<VisitAdded>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [VisitAdded, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(VisitAdded);
  fixture.componentRef.setInput('sections', sections);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<VisitAdded>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function section(
  fixture: ComponentFixture<VisitAdded>,
  listId: string
): HTMLElement {
  return host(fixture).querySelector(
    `section[data-list="${listId}"]`
  ) as HTMLElement;
}

function item(
  fixture: ComponentFixture<VisitAdded>,
  listId: string,
  itemId: string
): HTMLElement {
  return section(fixture, listId).querySelector(
    `[data-item="${itemId}"]`
  ) as HTMLElement;
}

/** A row's two stepper buttons: the minus, then the plus. */
function steps(
  fixture: ComponentFixture<VisitAdded>,
  listId: string,
  itemId: string
): HTMLButtonElement[] {
  return [
    ...item(fixture, listId, itemId).querySelectorAll<HTMLButtonElement>(
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

/** One row by its line, which is what tells two rows of one product apart. */
function line(
  fixture: ComponentFixture<VisitAdded>,
  listId: string,
  lineId: string
): HTMLElement {
  return section(fixture, listId).querySelector(
    `[data-line="${lineId}"]`
  ) as HTMLElement;
}

function steppedOf(fixture: ComponentFixture<VisitAdded>): VisitAddedStep[] {
  const heard: VisitAddedStep[] = [];
  fixture.componentInstance.stepped.subscribe((step) => heard.push(step));
  return heard;
}

describe('VisitAdded', () => {
  describe('the sections', () => {
    it('draws no heading for one list, which the sheet title already names', async () => {
      const fixture = await render([WEEKLY]);

      expect(host(fixture).querySelectorAll('section')).toHaveLength(1);
      expect(host(fixture).querySelector('.heading')).toBeNull();
    });

    it('draws one heading for each list when there are two', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);

      expect(
        [...host(fixture).querySelectorAll('.heading')].map(
          (one) => one.textContent
        )
      ).toEqual(['Weekly shop', 'Barbecue']);
      expect(section(fixture, 'l1').querySelectorAll('.row')).toHaveLength(2);
      expect(section(fixture, 'l2').querySelectorAll('.row')).toHaveLength(1);
    });

    it('draws nothing for no sections', async () => {
      const fixture = await render([]);

      expect(host(fixture).querySelector('section')).toBeNull();
      expect(host(fixture).querySelector('button')).toBeNull();
    });
  });

  describe('a row', () => {
    it('draws the rows in the order given', async () => {
      const fixture = await render([WEEKLY]);

      expect(
        [...host(fixture).querySelectorAll('.row .name')].map(
          (one) => one.textContent
        )
      ).toEqual(['Olive oil', 'Milk']);
    });

    it('draws the name, the detail and how many', async () => {
      const fixture = await render([WEEKLY]);

      const oil = item(fixture, 'l1', 'item-oil');
      expect(oil.querySelector('.name')?.textContent).toBe('Olive oil');
      expect(oil.querySelector('.detail')?.textContent).toBe(
        '1 L · €8.45 at Mercadona'
      );
      expect(oil.querySelector('.value')?.textContent).toBe('2');
    });

    it('marks each row with its line and its product', async () => {
      const fixture = await render([WEEKLY]);

      expect(
        [...host(fixture).querySelectorAll<HTMLElement>('.row')].map((one) => [
          one.dataset['line'],
          one.dataset['item'],
        ])
      ).toEqual([
        ['line-oil', 'item-oil'],
        ['line-milk', 'item-milk'],
      ]);
    });

    it('draws a row for each line when two lines hold one product', async () => {
      const fixture = await render([TWICE]);

      expect(section(fixture, 'l1').querySelectorAll('.row')).toHaveLength(2);
      expect(
        line(fixture, 'l1', 'line-oil').querySelector('.name')?.textContent
      ).toBe('Olive oil');
      expect(
        line(fixture, 'l1', 'line-oil').querySelector('.value')?.textContent
      ).toBe('2');
      expect(
        line(fixture, 'l1', 'line-fry').querySelector('.name')?.textContent
      ).toBe('Oil for the fryer');
      expect(
        line(fixture, 'l1', 'line-fry').querySelector('.value')?.textContent
      ).toBe('4');
    });

    it('draws no detail line for a row with none', async () => {
      const fixture = await render([WEEKLY]);

      expect(
        item(fixture, 'l1', 'item-milk').querySelector('.detail')
      ).toBeNull();
    });

    it('says a line waits for approval only when it does', async () => {
      const fixture = await render([
        { ...WEEKLY, rows: [row({ pending: true }), MILK] },
      ]);

      expect(
        item(fixture, 'l1', 'item-oil').querySelector('.pending')?.textContent
      ).toContain('catalog.added.pending');
      expect(
        item(fixture, 'l1', 'item-milk').querySelector('.pending')
      ).toBeNull();
    });

    it('names each stepper for its product', async () => {
      const fixture = await render([WEEKLY]);

      expect(
        item(fixture, 'l1', 'item-oil')
          .querySelector('[role="spinbutton"]')
          ?.getAttribute('aria-label')
      ).toBe('catalog.added.stepper');
      expect(valuesOf('catalog.added.stepper')).toEqual([
        { name: 'Olive oil' },
        { name: 'Milk' },
      ]);
    });

    it('draws the stepper in the quiet colour and the small size', async () => {
      const fixture = await render([WEEKLY]);

      const stepper = item(fixture, 'l1', 'item-oil').querySelector(
        'lib-quantity-stepper'
      );
      expect(stepper?.classList.contains('is-accent')).toBe(true);
      expect(stepper?.classList.contains('is-compact')).toBe(true);
    });
  });

  describe('the stepper', () => {
    it('says one more, with the list, the product, the line and its detail', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);
      const heard = steppedOf(fixture);

      steps(fixture, 'l2', 'item-coal')[1]?.click();

      expect(heard).toEqual([
        {
          listId: 'l2',
          itemId: 'item-coal',
          lineId: 'line-coal',
          detail: '1 L · €8.45 at Mercadona',
          by: 1,
        },
      ]);
    });

    it('says which line was pressed when two lines hold one product', async () => {
      const fixture = await render([TWICE]);
      const heard = steppedOf(fixture);

      line(fixture, 'l1', 'line-fry')
        .querySelectorAll<HTMLButtonElement>('lib-quantity-stepper button')[1]
        ?.click();
      line(fixture, 'l1', 'line-oil')
        .querySelectorAll<HTMLButtonElement>('lib-quantity-stepper button')[0]
        ?.click();

      expect(heard).toEqual([
        { ...OIL_DOWN, lineId: 'line-fry', by: 1 },
        OIL_DOWN,
      ]);
    });

    it('moves only the line that took the press when two lines hold one product', async () => {
      const fixture = await render([TWICE]);

      fixture.componentRef.setInput('sections', [
        {
          ...TWICE,
          rows: [
            row(),
            row({ lineId: 'line-fry', name: 'Oil for the fryer', quantity: 5 }),
          ],
        },
      ]);
      fixture.detectChanges();

      expect(
        line(fixture, 'l1', 'line-oil').querySelector('.value')?.textContent
      ).toBe('2');
      expect(
        line(fixture, 'l1', 'line-fry').querySelector('.value')?.textContent
      ).toBe('5');
    });

    it('says one fewer, with the list, the product, the line and its detail', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);
      const heard = steppedOf(fixture);

      steps(fixture, 'l1', 'item-oil')[0]?.click();

      expect(heard).toEqual([OIL_DOWN]);
    });

    it('says one fewer at the floor too, which takes the product back', async () => {
      const fixture = await render([WEEKLY]);
      const heard = steppedOf(fixture);

      const milk = item(fixture, 'l1', 'item-milk');
      expect(
        milk.querySelector('[role="spinbutton"]')?.getAttribute('aria-valuemin')
      ).toBe('0');
      expect(steps(fixture, 'l1', 'item-milk')[0]?.disabled).toBe(false);
      steps(fixture, 'l1', 'item-milk')[0]?.click();

      expect(heard).toEqual([
        {
          listId: 'l1',
          itemId: 'item-milk',
          lineId: 'line-milk',
          detail: null,
          by: -1,
        },
      ]);
    });

    it('puts the lowest value one under the floor of a line that was there before the visit', async () => {
      const fixture = await render([
        { ...WEEKLY, rows: [row({ quantity: 5, floor: 5 })] },
      ]);
      const heard = steppedOf(fixture);

      expect(
        item(fixture, 'l1', 'item-oil')
          .querySelector('[role="spinbutton"]')
          ?.getAttribute('aria-valuemin')
      ).toBe('4');
      steps(fixture, 'l1', 'item-oil')[0]?.click();

      expect(heard).toEqual([OIL_DOWN]);
    });

    it('says a step down and then a step up when both land before the quantity moves', async () => {
      const fixture = await render([WEEKLY]);
      const heard = steppedOf(fixture);

      steps(fixture, 'l1', 'item-oil')[0]?.click();
      fixture.detectChanges();
      steps(fixture, 'l1', 'item-oil')[1]?.click();
      fixture.detectChanges();

      expect(heard).toEqual([OIL_DOWN, { ...OIL_DOWN, by: 1 }]);
    });

    it('draws the quantity it is given again after a press the list did not take', async () => {
      const fixture = await render([WEEKLY]);
      const oil = item(fixture, 'l1', 'item-oil');

      // The write fails, so the quantity the row is given never moves.
      steps(fixture, 'l1', 'item-oil')[1]?.click();
      fixture.detectChanges();

      expect(oil.querySelector('.value')?.textContent).toBe('2');
      expect(
        oil.querySelector('[role="spinbutton"]')?.getAttribute('aria-valuenow')
      ).toBe('2');
    });

    it('draws the new quantity only once the list has taken the press', async () => {
      const fixture = await render([WEEKLY]);

      steps(fixture, 'l1', 'item-oil')[1]?.click();
      fixture.detectChanges();
      fixture.componentRef.setInput('sections', [
        { ...WEEKLY, rows: [row({ quantity: 3 }), MILK] },
      ]);
      fixture.detectChanges();

      expect(
        item(fixture, 'l1', 'item-oil').querySelector('.value')?.textContent
      ).toBe('3');
    });
  });

  describe('the two buttons', () => {
    it('counts what Take all back takes, and names the list it opens', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);

      expect(
        section(fixture, 'l1').querySelector('[data-added="take-all"]')
          ?.textContent
      ).toContain('catalog.added.takeAll');
      expect(
        section(fixture, 'l1').querySelector('[data-added="open-list"]')
          ?.textContent
      ).toContain('catalog.added.open');
      expect(valuesOf('catalog.added.takeAll')).toEqual([
        { count: 2 },
        { count: 1 },
      ]);
      expect(valuesOf('catalog.added.open')).toEqual([
        { list: 'Weekly shop' },
        { list: 'Barbecue' },
      ]);
    });

    it('takes back everything on the list whose button was pressed', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);
      const taken: string[] = [];
      const opened: string[] = [];
      fixture.componentInstance.allTakenBack.subscribe((id) => taken.push(id));
      fixture.componentInstance.listOpened.subscribe((id) => opened.push(id));

      section(fixture, 'l2')
        .querySelector<HTMLButtonElement>('[data-added="take-all"]')
        ?.click();

      expect(taken).toEqual(['l2']);
      expect(opened).toEqual([]);
    });

    it('opens the list whose link was pressed', async () => {
      const fixture = await render([WEEKLY, BARBECUE]);
      const taken: string[] = [];
      const opened: string[] = [];
      fixture.componentInstance.allTakenBack.subscribe((id) => taken.push(id));
      fixture.componentInstance.listOpened.subscribe((id) => opened.push(id));

      section(fixture, 'l1')
        .querySelector<HTMLButtonElement>('[data-added="open-list"]')
        ?.click();

      expect(opened).toEqual(['l1']);
      expect(taken).toEqual([]);
    });
  });
});
