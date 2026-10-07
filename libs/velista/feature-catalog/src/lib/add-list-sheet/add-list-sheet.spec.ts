import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, UrlSegment } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { CatalogAddStore } from '@portfolio/velista/data-access';
import type { ListPermission } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
  StorageKeys,
} from '@portfolio/velista/platform';
import {
  fakeAdds,
  type FakeAddDoubles,
  type FakeAdds,
  type FakeList,
} from '../catalog-adds.testing';
import { AddListSheet } from './add-list-sheet';

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
   * Called with the doubles before the sheet reads them, so a test can make the
   * first read fail.
   */
  readonly arm?: (doubles: FakeAddDoubles) => void;
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
  /** The line service double, which the store reads the chosen list's lines from. */
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
async function settle(fixture: ComponentFixture<AddListSheet>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const storage = new Map<string, string>();
  if (options.lastList !== undefined) {
    storage.set(StorageKeys.lastList, options.lastList);
  }
  const sheets = { dismiss: jest.fn().mockResolvedValue(undefined) };
  // The real store, over doubles of what it reads.
  const adds = fakeAdds({
    lists: options.lists ?? [WEEKLY, PARTY, READ_ONLY, CLEANING],
    guest: options.guest,
    storage,
    arm: (doubles) => {
      if (options.loadingForever === true) {
        doubles.listService.listLists.mockImplementation(
          () => new Promise(() => undefined)
        );
      }
      options.arm?.(doubles);
    },
  });

  await TestBed.configureTestingModule({
    imports: [AddListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      ...adds.providers,
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
    listMyZones: adds.zones.listMyZones,
    lines: adds.lines,
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
    // On its way is not failed: nothing offers a second try yet.
    expect(host(fixture).querySelector('button.retry')).toBeNull();
  });

  it('says the lists did not load, with a second try, and is not left on its loading note', async () => {
    const { fixture, listMyZones } = await render({
      arm: ({ zones }) =>
        zones.listMyZones.mockRejectedValueOnce(new Error('offline')),
    });

    expect(host(fixture).querySelector('lib-list-choice')).toBeNull();
    const notes = host(fixture).querySelectorAll('.note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.getAttribute('role')).toBe('alert');
    expect(notes[0]?.textContent).toContain('catalog.lists.failed');
    expect(host(fixture).textContent).not.toContain('catalog.lists.loading');
    // A failed read is not having no list, and does not say so.
    expect(host(fixture).textContent).not.toContain('catalog.lists.none');

    const retry =
      host(fixture).querySelector<HTMLButtonElement>('button.retry');
    expect(retry?.textContent).toContain('catalog.error.retry');
    expect(listMyZones).toHaveBeenCalledTimes(1);
    // The sheet can still be closed.
    expect(host(fixture).querySelector('button.close')).not.toBeNull();

    retry?.click();
    await settle(fixture);

    expect(listMyZones).toHaveBeenCalledTimes(2);
    expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(host(fixture).querySelector('button.retry')).toBeNull();
    expect(options(fixture).map((row) => row.dataset['list'])).toEqual([
      'list-weekly',
      'list-party',
      'list-cleaning',
    ]);
    expect(checked(fixture)).toEqual(['list-weekly']);
  });

  it('says so too when the lists of one group did not load, and again when the second try fails', async () => {
    const { fixture, listMyZones } = await render({
      arm: ({ listService }) =>
        listService.listLists
          .mockRejectedValueOnce(new Error('offline'))
          .mockRejectedValueOnce(new Error('offline'))
          .mockRejectedValueOnce(new Error('offline')),
    });

    expect(host(fixture).querySelector('.note')?.textContent).toContain(
      'catalog.lists.failed'
    );

    host(fixture).querySelector<HTMLButtonElement>('button.retry')?.click();
    await settle(fixture);

    // Still failed after the second try, and still offering another.
    expect(listMyZones).toHaveBeenCalledTimes(2);
    expect(
      host(fixture).querySelector('.note[role="alert"]')?.textContent
    ).toContain('catalog.lists.failed');
    expect(host(fixture).querySelector('button.retry')).not.toBeNull();

    host(fixture).querySelector<HTMLButtonElement>('button.retry')?.click();
    await settle(fixture);

    expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(options(fixture)).toHaveLength(3);
  });

  it('still offers the lists when only the lines of the chosen one did not load', async () => {
    const { fixture, store } = await render({
      arm: ({ lines }) =>
        lines.listLines.mockRejectedValueOnce(new Error('offline')),
    });

    // The sheet chooses a list. What that list holds is the page's to say.
    expect(store.linesStatus()).toBe('failed');
    expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(host(fixture).querySelector('button.retry')).toBeNull();
    expect(options(fixture)).toHaveLength(3);
  });

  it('reads the lines of the list it chooses, so the rows under the sheet can show them', async () => {
    const { fixture, lines } = await render();
    expect(lines.listLines).toHaveBeenCalledTimes(1);
    expect(lines.listLines.mock.calls[0]?.[0]).toBe('list-weekly');

    option(fixture, 'list-party')?.click();
    await settle(fixture);

    expect(lines.listLines).toHaveBeenCalledTimes(2);
    expect(lines.listLines.mock.calls[1]?.[0]).toBe('list-party');
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
