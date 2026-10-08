import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, UrlSegment } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { CatalogAddStore } from '@portfolio/velista/data-access';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import {
  fakeAdds,
  madeLineId,
  WEEKLY,
  type FakeAdds,
  type FakeLine,
  type FakeList,
} from '../catalog-adds.testing';
import { AddedSheet } from './added-sheet';

const CLEANING: FakeList = {
  ...WEEKLY,
  id: 'list-cleaning',
  zoneId: 'zone-flat',
  zoneName: 'Flat',
  name: 'Cleaning',
};

/** One product the visit added before the sheet opened. */
interface Seed {
  readonly listId: string;
  readonly itemId: string;
  readonly name: string;
  readonly detail?: string;
  /** How many the list held before the visit. Above zero is a merge. */
  readonly before?: number;
  /** The line the add made waits for approval. */
  readonly pending?: boolean;
}

const OIL: Seed = {
  listId: 'list-weekly',
  itemId: 'item-oil',
  name: 'Extra virgin olive oil',
  detail: 'Hacendado · 1 L · €8.45 at Mercadona',
};
const RICE: Seed = {
  listId: 'list-weekly',
  itemId: 'item-rice',
  name: 'Short grain rice',
};
const BLEACH: Seed = {
  listId: 'list-cleaning',
  itemId: 'item-bleach',
  name: 'Bleach',
};

/** The oil again on the weekly shop, under a name somebody typed, one of it. */
const FRYING_LINE: FakeLine = {
  id: 'line-frying',
  listId: 'list-weekly',
  content: 'Oil for frying',
  quantity: 1,
  itemIds: ['item-oil'],
};

/** A line that was there before the visit, which a stepper of the catalog raised. */
interface Raised {
  readonly listId: string;
  readonly itemId: string;
  readonly lineId: string;
}

interface Options {
  /** What the visit added, in the order it was added. */
  readonly added?: readonly Seed[];
  /** Lines the lists held before the visit, beside the ones `before` makes. */
  readonly lines?: readonly FakeLine[];
  /** The lines the visit raised by one from a row's stepper, after its adds. */
  readonly raised?: readonly Raised[];
  readonly basePath?: string;
  /** The URL of the page the sheet covers, one route for each entry. */
  readonly covered?: readonly (readonly string[])[];
}

interface Harness {
  readonly fixture: ComponentFixture<AddedSheet>;
  readonly store: CatalogAddStore;
  readonly sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
  /** The line service double the store reads and writes through. */
  readonly lines: FakeAdds['lines'];
}

/** A route snapshot's chain from the root, reduced to what the sheet reads. */
function routeChain(covered: readonly (readonly string[])[]): {
  pathFromRoot: { url: UrlSegment[] }[];
} {
  return {
    pathFromRoot: [
      { url: [] },
      ...covered.map((paths) => ({
        url: paths.map((path) => new UrlSegment(path, {})),
      })),
    ],
  };
}

/** Lets every pending promise run, then draws. */
async function settle(fixture: ComponentFixture<AddedSheet>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

/** The line an add of this product is on: the one that add made or raised. */
function lineIdOf(seed: Pick<Seed, 'listId' | 'itemId'>): string {
  return madeLineId(seed.listId, seed.itemId);
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const added = options.added ?? [OIL];
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  // The real store, over doubles of what it reads and writes. A product the list
  // held before the visit is a line under the product's name, which the add raises.
  const adds = fakeAdds({
    lists: [WEEKLY, CLEANING],
    lines: [
      ...added
        .filter((seed) => (seed.before ?? 0) > 0)
        .map((seed) => ({
          id: lineIdOf(seed),
          listId: seed.listId,
          content: seed.name,
          quantity: seed.before ?? 0,
          itemIds: [seed.itemId],
        })),
      ...(options.lines ?? []),
    ],
    pendingItemIds: added
      .filter((seed) => seed.pending === true)
      .map((seed) => seed.itemId),
  });

  await TestBed.configureTestingModule({
    imports: [AddedSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
      ...adds.providers,
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            parent: routeChain(
              options.covered ?? [['velista'], ['en'], ['catalog']]
            ),
          },
        },
      },
    ],
  }).compileComponents();

  // The visit, as the catalog page under the sheet made it: each product added
  // to the list that was chosen at the time. The last one stays chosen.
  const store = TestBed.inject(CatalogAddStore);
  await store.ensure();
  for (const seed of added) {
    store.choose(seed.listId);
    // The lines of a list chosen for the first time, before anything is added.
    await pause();
    await store.add({
      itemId: seed.itemId,
      name: seed.name,
      detail: seed.detail ?? null,
    });
  }
  // The stepper of a line under a row of the catalog, pressed once.
  for (const line of options.raised ?? []) {
    store.choose(line.listId);
    await pause();
    await store.step(
      { listId: line.listId, itemId: line.itemId, detail: null },
      line.lineId,
      1
    );
  }
  for (const mock of Object.values(adds.lines)) {
    mock.mockClear();
  }

  const fixture = TestBed.createComponent(AddedSheet);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, sheets, lines: adds.lines };
}

/** Lets every pending promise run. */
async function pause(): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
}

function host(fixture: ComponentFixture<AddedSheet>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function sections(fixture: ComponentFixture<AddedSheet>): HTMLElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLElement>(
      'lib-visit-added section[data-list]'
    ),
  ];
}

function row(
  fixture: ComponentFixture<AddedSheet>,
  itemId: string
): HTMLElement | null {
  return host(fixture).querySelector<HTMLElement>(
    `lib-visit-added [data-item="${itemId}"]`
  );
}

/** Every row of the sheet, in the order drawn. */
function rows(fixture: ComponentFixture<AddedSheet>): HTMLElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLElement>('lib-visit-added .row'),
  ];
}

/** The row of one line. A product on two lines of a list has two of them. */
function lineRow(
  fixture: ComponentFixture<AddedSheet>,
  lineId: string
): HTMLElement | null {
  return host(fixture).querySelector<HTMLElement>(
    `lib-visit-added [data-line="${lineId}"]`
  );
}

/** The minus and the plus of the stepper in one row. */
function stepsOf(scope: HTMLElement | null): {
  minus: HTMLButtonElement | null;
  plus: HTMLButtonElement | null;
} {
  const steps =
    scope?.querySelectorAll<HTMLButtonElement>(
      'lib-quantity-stepper button.step'
    ) ?? [];
  return { minus: steps[0] ?? null, plus: steps[1] ?? null };
}

function quantityIn(scope: HTMLElement | null): string | null {
  return (
    scope
      ?.querySelector('lib-quantity-stepper [role="spinbutton"]')
      ?.getAttribute('aria-valuenow') ?? null
  );
}

/** The minus and the plus of one row's stepper. */
function stepper(
  fixture: ComponentFixture<AddedSheet>,
  itemId: string
): { minus: HTMLButtonElement | null; plus: HTMLButtonElement | null } {
  return stepsOf(row(fixture, itemId));
}

function quantityOf(
  fixture: ComponentFixture<AddedSheet>,
  itemId: string
): string | null {
  return (
    row(fixture, itemId)
      ?.querySelector('lib-quantity-stepper [role="spinbutton"]')
      ?.getAttribute('aria-valuenow') ?? null
  );
}

describe('AddedSheet', () => {
  it('draws one section for one list, named by the title and with no heading', async () => {
    const { fixture } = await render({ added: [OIL, RICE] });

    expect(
      host(fixture).querySelector('#added-title')?.textContent?.trim()
    ).toBe('catalog.added.title');
    expect(host(fixture).querySelector('.note')?.textContent).toContain(
      'catalog.added.note'
    );

    expect(sections(fixture)).toHaveLength(1);
    expect(sections(fixture)[0]?.dataset['list']).toBe('list-weekly');
    expect(host(fixture).querySelector('lib-visit-added h3')).toBeNull();

    // One row for each product, in the order the visit added them.
    const names = [
      ...host(fixture).querySelectorAll('lib-visit-added .row .name'),
    ].map((name) => name.textContent?.trim());
    expect(names).toEqual(['Extra virgin olive oil', 'Short grain rice']);
    expect(
      row(fixture, 'item-oil')?.querySelector('.detail')?.textContent
    ).toBe('Hacendado · 1 L · €8.45 at Mercadona');
    expect(row(fixture, 'item-rice')?.querySelector('.detail')).toBeNull();
    expect(quantityOf(fixture, 'item-oil')).toBe('1');
  });

  it('draws one section for each list, under headings, when the visit added to two', async () => {
    const { fixture } = await render({ added: [OIL, RICE, BLEACH] });

    expect(
      host(fixture).querySelector('#added-title')?.textContent?.trim()
    ).toBe('catalog.added.titleMany');

    // The chosen list first, then the rest.
    expect(sections(fixture).map((section) => section.dataset['list'])).toEqual(
      ['list-cleaning', 'list-weekly']
    );
    expect(
      sections(fixture).map((section) =>
        section.querySelector('h3')?.textContent?.trim()
      )
    ).toEqual(['Cleaning', 'Weekly shop']);
    expect(sections(fixture)[0]?.querySelectorAll('.row')).toHaveLength(1);
    expect(sections(fixture)[1]?.querySelectorAll('.row')).toHaveLength(2);
  });

  it('says a line waits for approval under its name', async () => {
    const { fixture } = await render({
      added: [{ ...OIL, pending: true }, RICE],
    });

    expect(
      row(fixture, 'item-oil')?.querySelector('.pending')?.textContent
    ).toContain('catalog.added.pending');
    expect(row(fixture, 'item-rice')?.querySelector('.pending')).toBeNull();
  });

  it('passes a step to the store, for that list, that product and that line', async () => {
    const { fixture, store, lines } = await render({ added: [OIL, RICE] });
    const step = jest.spyOn(store, 'step');

    stepper(fixture, 'item-rice').plus?.click();
    await settle(fixture);

    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(
      { listId: 'list-weekly', itemId: 'item-rice', detail: null },
      lineIdOf(RICE),
      1
    );
    expect(lines.addQuantity).toHaveBeenCalledWith(lineIdOf(RICE), 1);
    expect(quantityOf(fixture, 'item-rice')).toBe('2');
    expect(quantityOf(fixture, 'item-oil')).toBe('1');

    // Above the floor, a minus is one fewer and not a take back.
    stepper(fixture, 'item-rice').minus?.click();
    await settle(fixture);

    expect(step).toHaveBeenLastCalledWith(
      { listId: 'list-weekly', itemId: 'item-rice', detail: null },
      lineIdOf(RICE),
      -1
    );
    expect(lines.addQuantity).toHaveBeenLastCalledWith(lineIdOf(RICE), -1);
    expect(lines.deleteLine).not.toHaveBeenCalled();
    expect(quantityOf(fixture, 'item-rice')).toBe('1');
  });

  it('hands the detail the record keeps back with a step, so the row still says it', async () => {
    const { fixture, store } = await render({ added: [OIL] });
    const step = jest.spyOn(store, 'step');

    stepper(fixture, 'item-oil').plus?.click();
    await settle(fixture);

    expect(step).toHaveBeenCalledWith(
      {
        listId: 'list-weekly',
        itemId: 'item-oil',
        detail: 'Hacendado · 1 L · €8.45 at Mercadona',
      },
      lineIdOf(OIL),
      1
    );
    expect(
      row(fixture, 'item-oil')?.querySelector('.detail')?.textContent
    ).toBe('Hacendado · 1 L · €8.45 at Mercadona');
  });

  describe('a product the visit raised on two lines of one list', () => {
    // The plus made the line under the product's name, and the stepper of "Oil for
    // frying" raised that line, which was there before with one.
    const twice: Options = {
      added: [OIL],
      lines: [FRYING_LINE],
      raised: [
        { listId: 'list-weekly', itemId: 'item-oil', lineId: 'line-frying' },
      ],
    };

    it('draws a row for each line, keyed by the line and named by what the line says', async () => {
      const { fixture } = await render(twice);

      expect(
        rows(fixture).map((one) => [
          one.dataset['item'],
          one.dataset['line'],
          one.querySelector('.name')?.textContent?.trim(),
          quantityIn(one),
        ])
      ).toEqual([
        ['item-oil', lineIdOf(OIL), 'Extra virgin olive oil', '1'],
        ['item-oil', 'line-frying', 'Oil for frying', '2'],
      ]);
    });

    it('names the line in a step, and moves that line alone', async () => {
      const { fixture, store, lines } = await render(twice);
      const step = jest.spyOn(store, 'step');

      stepsOf(lineRow(fixture, 'line-frying')).plus?.click();
      await settle(fixture);

      expect(step).toHaveBeenCalledTimes(1);
      expect(step).toHaveBeenCalledWith(
        { listId: 'list-weekly', itemId: 'item-oil', detail: null },
        'line-frying',
        1
      );
      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(lines.addQuantity).toHaveBeenCalledWith('line-frying', 1);
      expect(quantityIn(lineRow(fixture, 'line-frying'))).toBe('3');
      expect(quantityIn(lineRow(fixture, lineIdOf(OIL)))).toBe('1');
    });

    it('takes each line back its own way: the one that was there is lowered, the one the visit made is deleted', async () => {
      const { fixture, lines, sheets, store } = await render(twice);

      // "Oil for frying" held one before the visit, so it goes back to one.
      stepsOf(lineRow(fixture, 'line-frying')).minus?.click();
      await settle(fixture);

      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(lines.addQuantity).toHaveBeenCalledWith('line-frying', -1);
      expect(lines.deleteLine).not.toHaveBeenCalled();
      expect(lineRow(fixture, 'line-frying')).toBeNull();
      expect(lineRow(fixture, lineIdOf(OIL))).not.toBeNull();
      expect(sheets.dismiss).not.toHaveBeenCalled();

      stepsOf(lineRow(fixture, lineIdOf(OIL))).minus?.click();
      await settle(fixture);

      expect(lines.deleteLine).toHaveBeenCalledTimes(1);
      expect(lines.deleteLine).toHaveBeenCalledWith(lineIdOf(OIL));
      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(store.count()).toBe(0);
    });
  });

  it('takes a product back with the minus at the floor: the line the visit made is deleted', async () => {
    const { fixture, store, lines, sheets } = await render({
      added: [OIL, RICE],
    });
    const step = jest.spyOn(store, 'step');

    stepper(fixture, 'item-oil').minus?.click();
    await settle(fixture);

    expect(step).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'list-weekly', itemId: 'item-oil' }),
      lineIdOf(OIL),
      -1
    );
    expect(lines.deleteLine).toHaveBeenCalledWith(lineIdOf(OIL));
    expect(lines.addQuantity).not.toHaveBeenCalled();
    expect(row(fixture, 'item-oil')).toBeNull();
    // The other product stays, and so does the sheet.
    expect(row(fixture, 'item-rice')).not.toBeNull();
    expect(sheets.dismiss).not.toHaveBeenCalled();
  });

  it('takes back no more than the visit added from a line that was there before', async () => {
    // The list held two, and the visit raised the line to three.
    const { fixture, lines } = await render({
      added: [{ ...OIL, before: 2 }, RICE],
    });
    expect(quantityOf(fixture, 'item-oil')).toBe('3');

    stepper(fixture, 'item-oil').minus?.click();
    await settle(fixture);

    expect(lines.deleteLine).not.toHaveBeenCalled();
    expect(lines.addQuantity).toHaveBeenCalledTimes(1);
    expect(lines.addQuantity).toHaveBeenCalledWith(lineIdOf(OIL), -1);
    expect(row(fixture, 'item-oil')).toBeNull();
  });

  it('takes back everything the visit added to a list from one quiet button', async () => {
    const { fixture, store, lines } = await render({
      added: [OIL, RICE, BLEACH],
    });
    const takeAllBack = jest.spyOn(store, 'takeAllBack');
    const weekly = sections(fixture).find(
      (section) => section.dataset['list'] === 'list-weekly'
    );

    const button = weekly?.querySelector<HTMLButtonElement>(
      '[data-added="take-all"]'
    );
    expect(button?.textContent).toContain('catalog.added.takeAll');
    button?.click();
    await settle(fixture);

    expect(takeAllBack).toHaveBeenCalledTimes(1);
    expect(takeAllBack).toHaveBeenCalledWith('list-weekly');
    expect(
      lines.deleteLine.mock.calls.map(([lineId]) => lineId).sort()
    ).toEqual([lineIdOf(OIL), lineIdOf(RICE)].sort());
    // The other list keeps what was added to it.
    expect(sections(fixture).map((section) => section.dataset['list'])).toEqual(
      ['list-cleaning']
    );
    expect(store.count()).toBe(1);
  });

  it('opens the list, in place of the sheet', async () => {
    const { fixture, sheets } = await render({ added: [OIL] });

    const open = host(fixture).querySelector<HTMLButtonElement>(
      '[data-added="open-list"]'
    );
    expect(open?.textContent).toContain('catalog.added.open');
    open?.click();

    expect(sheets.leaveTo).toHaveBeenCalledTimes(1);
    expect(sheets.leaveTo).toHaveBeenCalledWith(
      '/velista/en/zones/zone-home/lists/list-weekly'
    );
    expect(sheets.dismiss).not.toHaveBeenCalled();
  });

  it('opens /en/zones/<zoneId>/lists/<listId> on a standalone build, for the list of that section', async () => {
    const { fixture, sheets } = await render({
      added: [OIL, BLEACH],
      basePath: '',
      covered: [['en'], ['catalog']],
    });

    sections(fixture)
      .find((section) => section.dataset['list'] === 'list-cleaning')
      ?.querySelector<HTMLButtonElement>('[data-added="open-list"]')
      ?.click();

    expect(sheets.leaveTo).toHaveBeenCalledWith(
      '/en/zones/zone-flat/lists/list-cleaning'
    );
  });

  it('closes itself once the last product is taken back', async () => {
    const { fixture, sheets, store } = await render({ added: [OIL] });

    stepper(fixture, 'item-oil').minus?.click();
    await settle(fixture);

    expect(store.count()).toBe(0);
    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('closes itself after take all back empties the record', async () => {
    const { fixture, sheets } = await render({ added: [OIL, RICE] });

    host(fixture)
      .querySelector<HTMLButtonElement>('[data-added="take-all"]')
      ?.click();
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('says nothing was added on a cold load of its URL, and stays open', async () => {
    const { fixture, sheets } = await render({ added: [] });

    expect(host(fixture).querySelector('lib-visit-added')).toBeNull();
    expect(host(fixture).querySelector('.note')?.textContent).toContain(
      'catalog.added.none'
    );
    expect(sheets.dismiss).not.toHaveBeenCalled();
  });

  it('closes from its own button, onto the page it covers', async () => {
    const { fixture, sheets, lines } = await render({ added: [OIL] });

    const close =
      host(fixture).querySelector<HTMLButtonElement>('button.close');
    expect(close?.textContent).toContain('catalog.sheet.close');
    close?.click();
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/catalog');
    // Closing takes nothing back.
    expect(lines.deleteLine).not.toHaveBeenCalled();
    expect(lines.addQuantity).not.toHaveBeenCalled();
  });
});
