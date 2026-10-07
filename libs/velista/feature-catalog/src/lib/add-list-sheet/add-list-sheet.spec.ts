import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, UrlSegment } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
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
  StorageKeys,
} from '@portfolio/velista/platform';
import { AddListSheet } from './add-list-sheet';

/** One list as the store reads it from the list service. */
interface FakeList {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneName: string;
  readonly name: string;
  readonly wantedCount: number;
  readonly myPermissions: readonly ListPermission[];
}

const WRITER: readonly ListPermission[] = ['READ', 'WRITE'];

const WEEKLY: FakeList = {
  id: 'list-weekly',
  zoneId: 'zone-home',
  zoneName: 'Home',
  name: 'Weekly shop',
  wantedCount: 14,
  myPermissions: WRITER,
};
const PARTY: FakeList = {
  ...WEEKLY,
  id: 'list-party',
  name: 'Party',
  wantedCount: 3,
};
const CLEANING: FakeList = {
  id: 'list-cleaning',
  zoneId: 'zone-flat',
  zoneName: 'Flat',
  name: 'Cleaning',
  wantedCount: 0,
  myPermissions: WRITER,
};
/** A list the person only reads, which the sheet never offers. */
const READ_ONLY: FakeList = {
  ...CLEANING,
  id: 'list-rota',
  name: 'Rota',
  myPermissions: ['READ'],
};

interface Options {
  readonly lists?: readonly FakeList[];
  /** A guest, who is never asked for lists. */
  readonly guest?: boolean;
  /** What `StorageKeys.lastList` holds on arrival. */
  readonly lastList?: string;
  /** The lists never answer, so the sheet stays on its loading note. */
  readonly loadingForever?: boolean;
  /**
   * The URL of the page the sheet covers, one route for each entry, as the
   * router hands it over. The catalog under the portfolio's mount by default.
   */
  readonly covered?: readonly (readonly string[])[];
}

interface Harness {
  readonly fixture: ComponentFixture<AddListSheet>;
  readonly store: CatalogAddStore;
  readonly sheets: { dismiss: jest.Mock };
  readonly storage: Map<string, string>;
  readonly listMyZones: jest.Mock;
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
async function settle(fixture: ComponentFixture<AddListSheet>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const lists = options.lists ?? [WEEKLY, PARTY, READ_ONLY, CLEANING];
  const zones = [
    ...new Map(
      lists.map((list) => [
        list.zoneId,
        { id: list.zoneId, name: list.zoneName, myStatus: 'APPROVED' },
      ])
    ).values(),
  ];
  const storage = new Map<string, string>();
  if (options.lastList !== undefined) {
    storage.set(StorageKeys.lastList, options.lastList);
  }
  const sheets = { dismiss: jest.fn().mockResolvedValue(undefined) };
  const listMyZones = jest.fn(async () => ({ items: zones, nextCursor: null }));

  await TestBed.configureTestingModule({
    imports: [AddListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(storage),
      // The real store, over doubles of what it reads.
      CatalogAddStore,
      {
        provide: SessionStore,
        useValue: { isGuest: signal(options.guest === true) },
      },
      { provide: ZONE_SERVICE, useValue: { listMyZones } },
      {
        provide: LIST_SERVICE,
        useValue: {
          listLists: (zoneId: string) =>
            options.loadingForever === true
              ? new Promise(() => undefined)
              : Promise.resolve({
                  items: lists.filter((list) => list.zoneId === zoneId),
                  nextCursor: null,
                }),
        },
      },
      { provide: LINE_SERVICE, useValue: {} },
      { provide: SheetNavigation, useValue: sheets },
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

  const fixture = TestBed.createComponent(AddListSheet);
  fixture.detectChanges();
  await settle(fixture);

  return {
    fixture,
    store: TestBed.inject(CatalogAddStore),
    sheets,
    storage,
    listMyZones,
  };
}

function host(fixture: ComponentFixture<AddListSheet>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** The radio rows, in the order drawn. */
function options(fixture: ComponentFixture<AddListSheet>): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      'lib-list-choice [role="radio"]'
    ),
  ];
}

function option(
  fixture: ComponentFixture<AddListSheet>,
  listId: string
): HTMLButtonElement | null {
  return host(fixture).querySelector<HTMLButtonElement>(
    `lib-list-choice [data-list="${listId}"]`
  );
}

/** The ids of the rows that are checked. */
function checked(fixture: ComponentFixture<AddListSheet>): string[] {
  return options(fixture)
    .filter((row) => row.getAttribute('aria-checked') === 'true')
    .map((row) => row.dataset['list'] ?? '');
}

describe('AddListSheet', () => {
  it('asks which list, in a dialog named by its title', async () => {
    const { fixture } = await render();

    const title = host(fixture).querySelector('#add-list-title');
    expect(title?.textContent?.trim()).toBe('catalog.lists.title');
    expect(
      host(fixture)
        .querySelector('[role="radiogroup"]')
        ?.getAttribute('aria-labelledby')
    ).toBe('add-list-title');
  });

  it('draws each list the person can write to, under the name of its group', async () => {
    const { fixture } = await render();

    // A group's name, then its lists, in the order the groups were read.
    const drawn = [
      ...host(fixture).querySelectorAll('lib-list-choice .group, [data-list]'),
    ].map((row) =>
      row.classList.contains('group')
        ? `# ${row.textContent?.trim()}`
        : (row.querySelector('.name')?.textContent?.trim() ?? '')
    );
    expect(drawn).toEqual([
      '# Home',
      'Weekly shop',
      'Party',
      '# Flat',
      'Cleaning',
    ]);
    // The list that is only read is not offered.
    expect(option(fixture, 'list-rota')).toBeNull();
    expect(option(fixture, 'list-weekly')?.textContent).toContain(
      'catalog.lists.toBuy'
    );
  });

  it('checks the first list the person can write to when nothing was used before', async () => {
    const { fixture } = await render();

    expect(checked(fixture)).toEqual(['list-weekly']);
    expect(option(fixture, 'list-weekly')?.classList.contains('is-on')).toBe(
      true
    );
  });

  it('checks the last used list, and only that one', async () => {
    const { fixture } = await render({ lastList: 'zone-flat/list-cleaning' });

    expect(checked(fixture)).toEqual(['list-cleaning']);
    expect(option(fixture, 'list-weekly')?.getAttribute('aria-checked')).toBe(
      'false'
    );
  });

  it('chooses with one press: the store is told, the choice is written, and the sheet closes', async () => {
    const { fixture, store, sheets, storage } = await render();
    const choose = jest.spyOn(store, 'choose');

    option(fixture, 'list-party')?.click();
    await settle(fixture);

    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith('list-party');
    // One value for both pages: the list the plus now adds to.
    expect(store.target()?.listId).toBe('list-party');
    // The last used list, so the catalog opens on it next time.
    expect(storage.get(StorageKeys.lastList)).toBe('zone-home/list-party');
    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('closes onto the product page when that is the page it covers', async () => {
    const { fixture, sheets } = await render({
      covered: [['velista'], ['en'], ['catalog'], ['products', 'item-oil']],
    });

    option(fixture, 'list-cleaning')?.click();
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledWith(
      '/velista/en/catalog/products/item-oil'
    );
  });

  it('closes from its own button without choosing, on a standalone build too', async () => {
    const { fixture, store, sheets, storage } = await render({
      covered: [['en'], ['catalog']],
    });
    const choose = jest.spyOn(store, 'choose');

    const close =
      host(fixture).querySelector<HTMLButtonElement>('button.close');
    expect(close?.textContent).toContain('catalog.sheet.close');
    close?.click();
    await settle(fixture);

    expect(choose).not.toHaveBeenCalled();
    expect(storage.has(StorageKeys.lastList)).toBe(false);
    expect(sheets.dismiss).toHaveBeenCalledWith('/en/catalog');
  });

  it('reads the lists itself on a cold load of its URL', async () => {
    const { listMyZones } = await render();

    expect(listMyZones).toHaveBeenCalledTimes(1);
  });

  it('says the lists are on their way while the read is out', async () => {
    const { fixture } = await render({ loadingForever: true });

    expect(host(fixture).querySelector('lib-list-choice')).toBeNull();
    const note = host(fixture).querySelector('.note');
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toContain('catalog.lists.loading');
  });

  it('says there is no list to add to, for a person who can write to none', async () => {
    const { fixture } = await render({ lists: [READ_ONLY] });

    expect(host(fixture).querySelector('lib-list-choice')).toBeNull();
    const note = host(fixture).querySelector('.note');
    expect(note?.textContent).toContain('catalog.lists.none');
    expect(note?.textContent).not.toContain('catalog.lists.loading');
  });

  it('says the same to a guest, who is never asked for lists', async () => {
    const { fixture, listMyZones } = await render({ guest: true });

    expect(listMyZones).not.toHaveBeenCalled();
    expect(host(fixture).querySelector('.note')?.textContent).toContain(
      'catalog.lists.none'
    );
  });
});
