import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, UrlSegment } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CatalogAddStore,
  LINE_SERVICE,
  LIST_SERVICE,
  SessionStore,
  ZONE_SERVICE,
} from '@portfolio/velista/data-access';
import type { ListPermission } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { AddedSheet } from './added-sheet';

/** One list as the store reads it from the list service. */
interface FakeList {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneName: string;
  readonly name: string;
  readonly wantedCount: number;
  readonly myPermissions: readonly ListPermission[];
}

const WEEKLY: FakeList = {
  id: 'list-weekly',
  zoneId: 'zone-home',
  zoneName: 'Home',
  name: 'Weekly shop',
  wantedCount: 14,
  myPermissions: ['READ', 'WRITE', 'MANAGE'],
};
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

interface Options {
  /** What the visit added, in the order it was added. */
  readonly added?: readonly Seed[];
  readonly basePath?: string;
  /** The URL of the page the sheet covers, one route for each entry. */
  readonly covered?: readonly (readonly string[])[];
}

interface Harness {
  readonly fixture: ComponentFixture<AddedSheet>;
  readonly store: CatalogAddStore;
  readonly sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
  readonly lines: {
    addLineResult: jest.Mock;
    addQuantity: jest.Mock;
    deleteLine: jest.Mock;
  };
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

function lineIdOf(seed: Pick<Seed, 'listId' | 'itemId'>): string {
  return `line-${seed.listId}-${seed.itemId}`;
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const added = options.added ?? [OIL];
  const lists = [WEEKLY, CLEANING];
  const zones = lists.map((list) => ({
    id: list.zoneId,
    name: list.zoneName,
    myStatus: 'APPROVED',
  }));
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  // The line double keeps each quantity, so a step answers what the server would.
  const quantities = new Map<string, number>();
  const lines = {
    addLineResult: jest.fn(
      async (
        listId: string,
        _content: string,
        quantity = 1,
        itemIds: readonly string[] = []
      ) => {
        const itemId = itemIds[0] ?? '';
        const seed = added.find(
          (one) => one.listId === listId && one.itemId === itemId
        );
        const id = lineIdOf({ listId, itemId });
        const before = seed?.before ?? 0;
        quantities.set(id, before + quantity);
        return {
          line: {
            id,
            quantity: before + quantity,
            approvalStatus: seed?.pending === true ? 'PENDING' : 'APPROVED',
          },
          merged: before > 0,
        };
      }
    ),
    addQuantity: jest.fn(async (lineId: string, delta: number) => {
      const quantity = (quantities.get(lineId) ?? 0) + delta;
      quantities.set(lineId, quantity);
      return { id: lineId, quantity, approvalStatus: 'APPROVED' };
    }),
    deleteLine: jest.fn(async (lineId: string) => lineId),
  };

  await TestBed.configureTestingModule({
    imports: [AddedSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
      provideFakeBrowserFacade(new Map()),
      // The real store, over doubles of what it reads and writes.
      CatalogAddStore,
      { provide: SessionStore, useValue: { isGuest: signal(false) } },
      {
        provide: ZONE_SERVICE,
        useValue: {
          listMyZones: async () => ({ items: zones, nextCursor: null }),
        },
      },
      {
        provide: LIST_SERVICE,
        useValue: {
          listLists: async (zoneId: string) => ({
            items: lists.filter((list) => list.zoneId === zoneId),
            nextCursor: null,
          }),
        },
      },
      { provide: LINE_SERVICE, useValue: lines },
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
    await store.add({
      itemId: seed.itemId,
      name: seed.name,
      detail: seed.detail ?? null,
    });
  }

  const fixture = TestBed.createComponent(AddedSheet);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, sheets, lines };
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

/** The minus and the plus of one row's stepper. */
function stepper(
  fixture: ComponentFixture<AddedSheet>,
  itemId: string
): { minus: HTMLButtonElement | null; plus: HTMLButtonElement | null } {
  const steps =
    row(fixture, itemId)?.querySelectorAll<HTMLButtonElement>(
      'lib-quantity-stepper button.step'
    ) ?? [];
  return { minus: steps[0] ?? null, plus: steps[1] ?? null };
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

  it('passes a step to the store, for that list and that product', async () => {
    const { fixture, store, lines } = await render({ added: [OIL, RICE] });
    const step = jest.spyOn(store, 'step');

    stepper(fixture, 'item-rice').plus?.click();
    await settle(fixture);

    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith('list-weekly', 'item-rice', 1);
    expect(lines.addQuantity).toHaveBeenCalledWith(lineIdOf(RICE), 1);
    expect(quantityOf(fixture, 'item-rice')).toBe('2');
    expect(quantityOf(fixture, 'item-oil')).toBe('1');

    // Above the floor, a minus is one fewer and not a take back.
    stepper(fixture, 'item-rice').minus?.click();
    await settle(fixture);

    expect(step).toHaveBeenLastCalledWith('list-weekly', 'item-rice', -1);
    expect(lines.addQuantity).toHaveBeenLastCalledWith(lineIdOf(RICE), -1);
    expect(lines.deleteLine).not.toHaveBeenCalled();
    expect(quantityOf(fixture, 'item-rice')).toBe('1');
  });

  it('takes a product back with the minus at the floor: the line the visit made is deleted', async () => {
    const { fixture, store, lines, sheets } = await render({
      added: [OIL, RICE],
    });
    const step = jest.spyOn(store, 'step');

    stepper(fixture, 'item-oil').minus?.click();
    await settle(fixture);

    expect(step).toHaveBeenCalledWith('list-weekly', 'item-oil', -1);
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
