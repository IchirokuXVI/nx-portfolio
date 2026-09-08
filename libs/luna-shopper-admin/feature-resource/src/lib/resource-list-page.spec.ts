import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  defineResource,
  type ResourceGateway,
  type ResourcePage,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { provideSections } from './admin-section';
import { ResourceListPage } from './resource-list-page';
import { RESOURCE_DESCRIPTOR } from './resource-route-data';

/**
 * What the list page lays over `toCell`'s work (admin plan 0023, section 2):
 * the link a reference cell carries, and the name the lookup resolved.
 *
 * Both live here and not in `toCell`, because both need what only this page
 * has: the registry, which knows where a target is mounted and whether it has
 * a detail screen, and the lookup, which costs a request. The assertions are
 * on the `rows()` view model rather than on rendered text, because the testing
 * translator does not interpolate.
 */

interface Gadget {
  id: string;
  factoryId: string | null;
  noteId: string | null;
}

const GADGET_ROWS: Gadget[] = [
  { id: 'g1', factoryId: 'f1', noteId: 'n1' },
  { id: 'g2', factoryId: 'f1', noteId: null },
  { id: 'g3', factoryId: 'f_gone', noteId: null },
];

function pageOf<T extends ResourceRow>(items: readonly T[]): ResourcePage<T> {
  return { items, nextCursor: null };
}

/** Reads of the factories, counted, so the caching is observable. */
const factoryReads: string[] = [];

const factoriesGateway: ResourceGateway<ResourceRow> = {
  list: async () => pageOf([]),
  read: async (id) => {
    factoryReads.push(id);
    if (id === 'f_gone') {
      throw new Error('gone');
    }
    return { id, name: 'Cordoba plant' };
  },
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

const gadgetsGateway: ResourceGateway<ResourceRow> = {
  list: async () => pageOf(GADGET_ROWS as unknown as ResourceRow[]),
  read: () => Promise.reject(new Error('not used')),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

const notesGateway: ResourceGateway<ResourceRow> = {
  list: async () => pageOf([]),
  read: async (id) => ({ id }),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

/** The target with a detail screen: `edit` gives it one. */
const FACTORIES = defineResource<{ id: string; name: string }>({
  name: 'factories',
  segment: 'factories',
  labels: { one: 'factories.one', many: 'factories.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'factories.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => factoriesGateway,
});

/** A target with no detail screen at all: its rows do not open. */
const NOTES = defineResource<{ id: string }>({
  name: 'notes',
  segment: 'notes',
  labels: { one: 'notes.one', many: 'notes.many' },
  title: (row) => row.id,
  fields: [{ kind: 'text', name: 'id', label: 'notes.id' }],
  list: { columns: ['id'], compact: ['id'] },
  gateway: () => notesGateway,
});

const GADGETS = defineResource<Gadget>({
  name: 'gadgets',
  segment: 'gadgets',
  labels: { one: 'gadgets.one', many: 'gadgets.many' },
  title: (row) => row.id,
  fields: [
    {
      kind: 'reference',
      name: 'factoryId',
      label: 'gadgets.factory',
      resource: 'factories',
      nameLookup: true,
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'noteId',
      label: 'gadgets.note',
      resource: 'notes',
      nullable: true,
    },
  ],
  list: { columns: ['factoryId', 'noteId'], compact: ['factoryId'] },
  gateway: () => gadgetsGateway,
});

async function render(): Promise<ComponentFixture<ResourceListPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceListPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      // The section is what the registry reads, so the links below come out
      // of the mount and not out of anything a descriptor spelled.
      provideSections({
        key: 'stuff',
        label: '',
        segment: 'stuff',
        resources: [GADGETS, FACTORIES, NOTES],
      }),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { [RESOURCE_DESCRIPTOR]: GADGETS } } },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResourceListPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

/** Lets the load and the lookups settle, then redraws. */
async function settle(fixture: ComponentFixture<ResourceListPage>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

beforeEach(() => {
  factoryReads.length = 0;
});

describe('a reference cell on the list page (admin plan 0023)', () => {
  it('derives the link from the registry, so a section move carries it', async () => {
    const fixture = await render();

    const cell = fixture.componentInstance.rows()[0].cells['factoryId'];
    expect(cell.link).toEqual(['/', 'stuff', 'factories', 'f1']);
  });

  it('gives a target without a detail screen no link at all', async () => {
    const fixture = await render();

    const cell = fixture.componentInstance.rows()[0].cells['noteId'];
    expect(cell.reference).toEqual({ resource: 'notes', id: 'n1' });
    expect(cell.link).toBeUndefined();
  });

  it('fills the looked up name once per distinct id', async () => {
    const fixture = await render();
    await settle(fixture);

    const rows = fixture.componentInstance.rows();
    expect(rows[0].cells['factoryId'].text).toBe('Cordoba plant');
    expect(rows[1].cells['factoryId'].text).toBe('Cordoba plant');
    // Two rows, one id, one request.
    expect(factoryReads.filter((id) => id === 'f1')).toHaveLength(1);
  });

  /**
   * A reference can outlive what it points at. The id stays on screen, and
   * the answer is cached like any other so the gone row is not asked about
   * on every further page.
   */
  it('keeps the id for a null resolve, and never asks about it again', async () => {
    const fixture = await render();
    await settle(fixture);

    expect(fixture.componentInstance.rows()[2].cells['factoryId'].text).toBe(
      'f_gone'
    );

    await fixture.componentInstance.store.load();
    await settle(fixture);
    expect(factoryReads.filter((id) => id === 'f_gone')).toHaveLength(1);
  });

  it('leaves an empty reference as its "none" cell, unresolved', async () => {
    const fixture = await render();
    await settle(fixture);

    const cell = fixture.componentInstance.rows()[1].cells['noteId'];
    expect(cell.key).toBe('resource.value.none');
    expect(cell.reference).toBeUndefined();
    expect(cell.link).toBeUndefined();
  });
});
