import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  RESOURCE_GATEWAYS,
  seededCategoryId,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  RecordPage,
  RecordView,
  ResourceChanges,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCATION_SEED } from './catalog-seed';
import { sectionSource } from './catalog-sources';
import { CHAIN_RESOURCES, chainsRoutes } from './chains/chains-routes';
import { LocationSections, moveId, previewSentence } from './location-sections';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products/products-routes';
import { SEEDED_SECTION } from './section-seed';
import {
  ShopSections,
  toLocationSections,
  toSectionsAtLocation,
  toShopSection,
} from './shop-sections';

/**
 * The sections of a shop in the back office (admin plan 0063), against the
 * in memory twins: the rules of backend plan 0200 as the twin keeps them, the
 * wire as the panel reads it, and the Sections tab of a shop, which is the
 * one place a section is added, opened, ordered and deleted.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** The Chains section and the Products section, each as the app declares it. */
const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: chainsRoutes(),
  },
  {
    key: 'products',
    label: '',
    segment: PRODUCTS_SEGMENT,
    held: PRODUCT_RESOURCES,
    heldTabs: true,
    screens: productsRoutes(),
  },
];

/** A phone, where a row has a button each way and no handle. */
const PHONE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(true), split: signal(false) },
};

const {
  centroChilled: CENTRO_CHILLED,
  centroOffers: CENTRO_OFFERS,
  oestePantry: OESTE_PANTRY,
  oesteChilled: OESTE_CHILLED,
} = SEEDED_SECTION;

const SHOPS = '/chains/sm_mercadona/shops';

function refusal(code: string, status: number): GatewayError {
  return new GatewayError({ code, status, correlationId: 'cid' });
}

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes(SECTIONS)),
      provideLocationMocks(),
      provideSections(...SECTIONS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await go(fixture, url);
  return fixture;
}

async function go(fixture: ComponentFixture<TestHost>, url: string) {
  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);
  await settle(fixture);
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const url = () => TestBed.inject(Router).url;

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

/** The record page that is open, innermost. */
const innerPage = (fixture: ComponentFixture<TestHost>) => {
  const pages = fixture.debugElement.queryAll(By.directive(RecordPage));
  return pages[pages.length - 1].componentInstance as RecordPage;
};

function sections(): ShopSections {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [ContentLocaleStore] });
  return TestBed.inject(ShopSections);
}

const idsOf = (list: readonly { id: string }[]) => list.map((row) => row.id);

describe('the rules, as the memory twin keeps them', () => {
  it('reads each shop its own sections in its order, and a shop with none as none', async () => {
    const shop = sections();

    expect(idsOf(await shop.forLocation('loc_cordoba_centro'))).toEqual([
      CENTRO_CHILLED,
      CENTRO_OFFERS,
    ]);
    expect(idsOf(await shop.forLocation('loc_cordoba_oeste'))).toEqual([
      OESTE_PANTRY,
      OESTE_CHILLED,
    ]);
    // A third shop of the same chain inherits nothing.
    expect(await shop.forLocation('loc_sierra')).toEqual([]);
  });

  it('answers covered through a root or a leaf, and none', async () => {
    const shop = sections();

    expect(
      await shop.atLocation('loc_cordoba_centro', [
        'it_milk_1l',
        'it_olive_oil_1l',
      ])
    ).toEqual([
      // Chilled covers the root the milk's leaf is under.
      { itemId: 'it_milk_1l', sectionIds: [CENTRO_CHILLED], step: 'COVERED' },
      // Offers covers no category, and no pin exists to put a product in it.
      { itemId: 'it_olive_oil_1l', sectionIds: [], step: 'NONE' },
    ]);
    expect(
      await shop.atLocation('loc_cordoba_oeste', ['it_olive_oil_1l'])
    ).toEqual([
      {
        itemId: 'it_olive_oil_1l',
        sectionIds: [OESTE_PANTRY],
        step: 'COVERED',
      },
    ]);
    expect(await shop.atLocation('loc_sierra', ['it_milk_1l'])).toEqual([
      { itemId: 'it_milk_1l', sectionIds: [], step: 'NONE' },
    ]);
  });

  it('writes an order, keeping a section it leaves out after the named ones', async () => {
    const shop = sections();

    expect(
      idsOf(await shop.setOrder('loc_cordoba_centro', [CENTRO_OFFERS]))
    ).toEqual([CENTRO_OFFERS, CENTRO_CHILLED]);
    expect(
      (await shop.forLocation('loc_cordoba_centro')).map(
        (section) => section.position
      )
    ).toEqual([0, 1]);
  });

  it('refuses a section of another shop, and one that does not exist', async () => {
    const shop = sections();

    await expect(
      shop.setOrder('loc_cordoba_centro', [OESTE_PANTRY])
    ).rejects.toMatchObject({ code: 'section_of_another_shop' });
    await expect(
      shop.setOrder('loc_cordoba_centro', ['sec_nowhere'])
    ).rejects.toMatchObject({ code: 'section_not_found' });
  });

  it('adds a section last, and refuses a slug its shop already holds', async () => {
    sections();
    const gateway = TestBed.inject(RESOURCE_GATEWAYS).for(sectionSource());

    // Another shop of the chain holds `pantry`, and that is no conflict.
    const added = await gateway.create({
      supermarketLocationId: 'loc_cordoba_centro',
      slug: 'pantry',
      name: { en: 'Pantry', es: 'Despensa' },
      categoryIds: [],
    });
    expect(added.position).toBe(2);

    await expect(
      gateway.create({
        supermarketLocationId: 'loc_cordoba_centro',
        slug: 'chilled',
        name: { en: 'Cold', es: 'Frío' },
        categoryIds: [],
      })
    ).rejects.toMatchObject({ code: 'section_slug_taken' });
    await expect(
      gateway.create({
        supermarketLocationId: 'loc_cordoba_centro',
        slug: 'bakery',
        name: { en: 'Bakery', es: 'Panadería' },
        categoryIds: ['cat_nowhere'],
      })
    ).rejects.toMatchObject({ code: 'category_not_found' });
  });

  it('closes the gap a delete leaves, and moves a section by its position', async () => {
    const shop = sections();
    const gateway = TestBed.inject(RESOURCE_GATEWAYS).for(sectionSource());
    await gateway.create({
      supermarketLocationId: 'loc_cordoba_centro',
      slug: 'bakery',
      name: { en: 'Bakery', es: 'Panadería' },
      categoryIds: [],
    });

    await shop.remove(CENTRO_CHILLED);
    const after = await shop.forLocation('loc_cordoba_centro');
    expect(after.map((section) => [section.slug, section.position])).toEqual([
      ['offers', 0],
      ['bakery', 1],
    ]);

    await gateway.update(after[1].id, { position: 0 });
    expect(
      (await shop.forLocation('loc_cordoba_centro')).map((section) => [
        section.slug,
        section.position,
      ])
    ).toEqual([
      ['bakery', 0],
      ['offers', 1],
    ]);
  });
});

describe('reading the section wire', () => {
  it('reads a section of a shop, and drops a record with no id', () => {
    expect(
      toShopSection({
        id: 's1',
        supermarketLocationId: 'loc_1',
        slug: 'fruteria',
        name: { es: 'Frutería' },
        position: 3,
        categoryIds: ['c1', 7],
      })
    ).toEqual({
      id: 's1',
      supermarketLocationId: 'loc_1',
      slug: 'fruteria',
      name: { es: 'Frutería' },
      position: 3,
      categoryIds: ['c1'],
    });
    expect(toShopSection({ slug: 'x' })).toBeNull();
  });

  /** The answer carries no `source` since backend plan 0200. */
  it('reads a shop’s sections with no source, and ignores an old one', () => {
    const read = toLocationSections({
      source: 'CHAIN',
      sections: [{ id: 's1' }, { name: 'no id' }, { id: 's2' }],
    });
    expect(read.map((section) => section.id)).toEqual(['s1', 's2']);
    expect(read[0]).not.toHaveProperty('source');
  });

  it('reads a preview with no pinned step: anything but covered is none', () => {
    expect(
      toSectionsAtLocation({
        items: [
          { itemId: 'a', sectionIds: ['s1'], step: 'COVERED' },
          { itemId: 'b', sectionIds: ['s2'], step: 'PINNED' },
          { itemId: 'c', sectionIds: [], step: 'NONE' },
          { sectionIds: ['s3'], step: 'COVERED' },
        ],
      })
    ).toEqual([
      { itemId: 'a', sectionIds: ['s1'], step: 'COVERED' },
      { itemId: 'b', sectionIds: [], step: 'NONE' },
      { itemId: 'c', sectionIds: [], step: 'NONE' },
    ]);
  });

  it('says the sections that hold a product, or that none does', () => {
    const name = (id: string) => ({ s1: 'Chilled', s2: 'Dairy' })[id] ?? id;

    expect(
      previewSentence(
        [{ itemId: 'a', sectionIds: ['s1', 's2'], step: 'COVERED' }],
        'a',
        name
      )
    ).toEqual({
      key: 'catalog.locationSections.preview.covered',
      sections: 'Chilled, Dairy',
    });
    expect(previewSentence([], 'a', name)).toEqual({
      key: 'catalog.locationSections.preview.none',
      sections: '',
    });
  });

  it('moves an id a step, and not past either end', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });
});

/** The Sections tab of one of Mercadona's shops. */
async function openShop(id: string, providers: Provider[] = []) {
  const fixture = await boot(`${SHOPS}/${id}/sections`, providers);
  const panel = fixture.debugElement.query(By.directive(LocationSections))
    .componentInstance as LocationSections;
  return { fixture, panel };
}

/** The rows of the list, in the order shown. */
const rowsOf = (fixture: ComponentFixture<TestHost>) =>
  [
    ...fixture.nativeElement.querySelectorAll('lib-location-sections .rows li'),
  ] as HTMLElement[];

/** A drag event jsdom can make: it has no `DragEvent` and no data transfer. */
const drag = (type: 'dragstart' | 'dragover' | 'dragend') =>
  new Event(type, { bubbles: true, cancelable: true });

describe('the Sections tab of a shop', () => {
  it('says a shop with no sections has none, and offers to add one', async () => {
    const { fixture, panel } = await openShop('loc_sierra');

    const empty = fixture.nativeElement.querySelector('[data-empty]');
    expect(empty?.textContent).toContain('catalog.locationSections.empty');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe(
      `${SHOPS}/loc_sierra/sections/new`
    );
    expect(panel.rows()).toEqual([]);
    // Nothing to order and nothing to preview.
    expect(fixture.nativeElement.querySelector('.controls')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-preview]')).toBeNull();
  });

  /** "It never mentions the chain" (admin plan 0063, target 4). */
  it('words the empty state with no chain in it', () => {
    const { catalog } = JSON.parse(
      readFileSync(join(__dirname, '../../../ui/assets/i18n/en.json'), 'utf8')
    );

    expect(catalog.locationSections.empty).not.toMatch(/chain/i);
    expect(catalog.locationSections.empty).toBe(
      'This shop has no sections yet. Until it has one, its products are shown under their own categories.'
    );
    expect(JSON.stringify(catalog.locationSections)).not.toMatch(/chain/i);
  });

  it('lists the sections in the shop’s order, a root marked as covering all of it', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    await settle(fixture);

    expect(panel.rows().map((row) => [row.place, row.section.slug])).toEqual([
      [1, 'chilled'],
      [2, 'offers'],
    ]);
    expect(rowsOf(fixture)).toHaveLength(2);
    expect(rowsOf(fixture)[0].textContent).toContain(
      'catalog.locationSections.coversAll'
    );
    expect(rowsOf(fixture)[1].textContent).toContain(
      'catalog.locationSections.coversNothing'
    );
    expect(panel.covered(panel.rows()[0].section)).toEqual([
      {
        id: seededCategoryId('eggs-milk-and-butter'),
        name: expect.any(String),
        root: true,
      },
    ]);
  });

  it('opens a section from its row, beside the shop and under the chain', async () => {
    const { fixture } = await openShop('loc_cordoba_centro');
    const open = fixture.nativeElement.querySelector(
      '[data-open]'
    ) as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe(
      `${SHOPS}/loc_cordoba_centro/sections/${CENTRO_CHILLED}`
    );

    open.click();
    await settle(fixture);
    await settle(fixture);

    expect(url()).toBe(
      `${SHOPS}/loc_cordoba_centro/sections/${CENTRO_CHILLED}`
    );
    expect(innerPage(fixture).descriptor.name).toBe('sections');
    expect(innerPage(fixture).heading()).toBe('Chilled');
  });

  /** Add opens the form under the shop, and the new section goes last. */
  it('adds a section from the form under the shop, last', async () => {
    const fixture = await boot(`${SHOPS}/loc_cordoba_centro/sections/new`);
    const store = innerPage(fixture).store();
    // The shop is in the address, and is no control.
    expect(
      fixture.nativeElement.querySelector('#record-field-supermarketLocationId')
    ).toBeNull();
    // The order is the tab's, and is no field.
    expect(
      fixture.nativeElement.querySelector('#record-field-position')
    ).toBeNull();

    store.set('name', { en: 'Bakery', es: 'Panadería' });
    store.set('slug', 'bakery');
    const view = fixture.debugElement.query(By.directive(RecordView))
      .componentInstance as RecordView;
    await view.save();
    await settle(fixture);
    await settle(fixture);

    const added =
      await TestBed.inject(ShopSections).forLocation('loc_cordoba_centro');
    expect(added.map((section) => section.slug)).toEqual([
      'chilled',
      'offers',
      'bakery',
    ]);
    expect(added[2].supermarketLocationId).toBe('loc_cordoba_centro');
  });

  it('says under the slug that the shop already holds it', async () => {
    const fixture = await boot(`${SHOPS}/loc_cordoba_centro/sections/new`);
    const store = innerPage(fixture).store();

    store.set('name', { en: 'Cold', es: 'Frío' });
    store.set('slug', 'chilled');
    const view = fixture.debugElement.query(By.directive(RecordView))
      .componentInstance as RecordView;
    await view.save();
    await settle(fixture);

    expect(store.error()?.code).toBe('section_slug_taken');
    expect(store.invalid()).toEqual(['slug']);
    expect(text(fixture)).toContain('resource.error.sectionSlugTaken');
    expect(url()).toBe(`${SHOPS}/loc_cordoba_centro/sections/new`);
  });

  it('edits the name and the categories of a section, and not its slug', async () => {
    const fixture = await boot(
      `${SHOPS}/loc_cordoba_oeste/sections/${OESTE_PANTRY}`
    );
    const page = innerPage(fixture);
    page.edit();
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector('#record-field-slug')
    ).toBeNull();
    page.store().set('name', { en: 'Oils', es: 'Aceites' });
    page
      .store()
      .set('categoryIds', [seededCategoryId('oils-sauces-and-spices')]);
    const view = fixture.debugElement.query(By.directive(RecordView))
      .componentInstance as RecordView;
    await view.save();
    await settle(fixture);

    const [pantry] =
      await TestBed.inject(ShopSections).forLocation('loc_cordoba_oeste');
    expect(pantry.name).toEqual({ en: 'Oils', es: 'Aceites' });
    expect(pantry.categoryIds).toEqual([
      seededCategoryId('oils-sauces-and-spices'),
    ]);
    expect(pantry.slug).toBe('pantry');
  });

  it('holds a new order and saves every section in one request', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setOrder');
    const changes = TestBed.inject(ResourceChanges);
    const before = changes.version('location-sections');

    panel.move(OESTE_CHILLED, -1);
    await settle(fixture);
    expect(write).not.toHaveBeenCalled();
    expect(panel.dirty()).toBe(true);

    buttonSaying(fixture, 'catalog.locationSections.save')?.click();
    await settle(fixture);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('loc_cordoba_oeste', [
      OESTE_CHILLED,
      OESTE_PANTRY,
    ]);
    expect(idsOf(panel.saved() ?? [])).toEqual([OESTE_CHILLED, OESTE_PANTRY]);
    expect(panel.dirty()).toBe(false);
    expect(text(fixture)).toContain('catalog.locationSections.saved');
    // The page above counts the shop's sections on the tab, so it is told.
    expect(changes.version('location-sections')).toBe(before + 1);
  });

  it('keeps the order in hand when the save is refused', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    jest
      .spyOn(TestBed.inject(ShopSections), 'setOrder')
      .mockRejectedValue(refusal('section_of_another_shop', 409));

    panel.move(OESTE_CHILLED, -1);
    await panel.save();
    await settle(fixture);

    expect(panel.order()).toEqual([OESTE_CHILLED, OESTE_PANTRY]);
    expect(idsOf(panel.saved() ?? [])).toEqual([OESTE_PANTRY, OESTE_CHILLED]);
    expect(text(fixture)).toContain('resource.error.sectionOfAnotherShop');
  });

  it('deletes a section only after saying what goes with it', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const remove = jest.spyOn(TestBed.inject(ShopSections), 'remove');

    (
      rowsOf(fixture)[0].querySelector('[data-delete]') as HTMLButtonElement
    ).click();
    await settle(fixture);

    const dialog = fixture.nativeElement.querySelector('lib-confirm-dialog');
    expect(dialog?.textContent).toContain(
      'catalog.locationSections.deleteBody'
    );
    expect(remove).not.toHaveBeenCalled();

    buttonSaying(fixture, 'catalog.locationSections.deleteConfirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(remove).toHaveBeenCalledWith(OESTE_PANTRY);
    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')
    ).toBeNull();
    expect(panel.rows().map((row) => [row.place, row.section.slug])).toEqual([
      [1, 'chilled'],
    ]);
  });

  it('keeps the section when the dialog is dismissed', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const remove = jest.spyOn(TestBed.inject(ShopSections), 'remove');

    panel.deleting.set(panel.rows()[0].section);
    await settle(fixture);
    buttonSaying(fixture, 'resource.action.cancel')?.click();
    await settle(fixture);

    expect(remove).not.toHaveBeenCalled();
    expect(panel.rows()).toHaveLength(2);
  });

  it('says why a delete was refused, and keeps the row', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    jest
      .spyOn(TestBed.inject(ShopSections), 'remove')
      .mockRejectedValue(refusal('section_not_found', 404));

    await panel.confirmDelete(panel.rows()[0].section);
    await settle(fixture);

    expect(panel.rows()).toHaveLength(2);
    expect(text(fixture)).toContain('resource.error.sectionNotFound');
  });

  it('keeps an order in hand through a delete, less the section', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro', [PHONE]);
    // Centro has a map, so the first move of the visit is agreed first.
    panel.mapEditAccepted.set(true);
    const gateway = TestBed.inject(RESOURCE_GATEWAYS).for(sectionSource());
    await gateway.create({
      supermarketLocationId: 'loc_cordoba_centro',
      slug: 'bakery',
      name: { en: 'Bakery', es: 'Panadería' },
      categoryIds: [],
    });
    await panel.reload();
    const bakery = panel.rows()[2].section.id;

    panel.move(bakery, -1);
    panel.move(bakery, -1);
    await panel.confirmDelete(panel.rows()[2].section);
    await settle(fixture);

    expect(panel.order()).toEqual([bakery, CENTRO_CHILLED]);
    expect(panel.dirty()).toBe(true);
  });

  /** "Read the preview": the answer of the server for a picked product. */
  it('previews where a product is at the shop', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    await panel.choose('it_milk_1l');
    await settle(fixture);
    expect(panel.preview()).toEqual({
      key: 'catalog.locationSections.preview.covered',
      sections: 'Chilled',
    });
    expect(
      fixture.nativeElement.querySelector('[data-preview]')?.textContent
    ).toContain('catalog.locationSections.preview.covered');

    await panel.choose('it_dish_soap');
    expect(panel.preview()?.key).toBe('catalog.locationSections.preview.none');

    await panel.choose('');
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-preview]')).toBeNull();
  });

  it('asks the preview again after a delete', async () => {
    const { panel } = await openShop('loc_cordoba_centro');
    await panel.choose('it_milk_1l');

    await panel.confirmDelete(panel.rows()[0].section);

    expect(panel.preview()?.key).toBe('catalog.locationSections.preview.none');
  });

  it('says why a preview could not be read', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    jest
      .spyOn(TestBed.inject(ShopSections), 'atLocation')
      .mockRejectedValue(refusal('unavailable', 503));

    await panel.choose('it_milk_1l');
    await settle(fixture);

    expect(panel.preview()).toBeNull();
    expect(panel.previewErrorKey()).toBe('resource.error.unknown');
  });
});

/**
 * Ordering the list: a handle on a wide screen, moved by a drag or by the
 * arrow keys, and a button each way on a phone. Nothing is written until Save.
 */
describe('ordering the sections of a shop', () => {
  it('gives each row a handle on a wide screen, and no buttons', async () => {
    const { fixture } = await openShop('loc_cordoba_oeste');

    expect(fixture.nativeElement.querySelectorAll('[data-grip]')).toHaveLength(
      2
    );
    expect(fixture.nativeElement.querySelector('[data-move-up]')).toBeNull();
    expect(rowsOf(fixture).map((row) => row.draggable)).toEqual([true, true]);
  });

  it('moves a row a place with the arrow keys, and says where it went', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setOrder');
    const grip = () =>
      fixture.nativeElement.querySelectorAll('[data-grip]') as HTMLElement[];

    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    grip()[0].dispatchEvent(down);
    await settle(fixture);

    expect(panel.order()).toEqual([OESTE_CHILLED, OESTE_PANTRY]);
    expect(down.defaultPrevented).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent
    ).toContain('catalog.locationSections.movedTo');
    expect(write).not.toHaveBeenCalled();
  });

  it('takes the place of the row it is dragged over, and writes nothing', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setOrder');

    rowsOf(fixture)[1].dispatchEvent(drag('dragstart'));
    await settle(fixture);
    expect(panel.dragging()).toBe(OESTE_CHILLED);

    const over = drag('dragover');
    rowsOf(fixture)[0].dispatchEvent(over);
    await settle(fixture);
    expect(panel.order()).toEqual([OESTE_CHILLED, OESTE_PANTRY]);
    expect(over.defaultPrevented).toBe(true);

    rowsOf(fixture)[0].dispatchEvent(drag('dragend'));
    await settle(fixture);
    expect(panel.dragging()).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('gives a phone a button each way and no handle', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste', [PHONE]);

    expect(fixture.nativeElement.querySelector('[data-grip]')).toBeNull();
    const ups = fixture.nativeElement.querySelectorAll('[data-move-up]');
    const downs = fixture.nativeElement.querySelectorAll('[data-move-down]');
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);

    (downs[0] as HTMLButtonElement).click();
    await settle(fixture);

    expect(panel.order()).toEqual([OESTE_CHILLED, OESTE_PANTRY]);
  });

  /**
   * 2.75 rem is 44 px. jsdom lays nothing out and the jest build drops a
   * component's styles, so the rule is read where it is written.
   */
  it('sizes a move button for a thumb', () => {
    const source = readFileSync(
      join(__dirname, 'location-sections.ts'),
      'utf8'
    );
    const move = /\.move button\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';

    expect(move).toContain('inline-size: 2.75rem');
    expect(move).toContain('min-block-size: 2.75rem');
  });

  it('keeps Save and Discard in a bar, off until something moved', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const bar = fixture.nativeElement.querySelector('.controls') as HTMLElement;
    const save = bar.querySelector('[data-save]') as HTMLButtonElement;
    const discard = bar.querySelector('[data-discard]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);

    panel.move(OESTE_CHILLED, -1);
    await settle(fixture);
    expect(save.disabled).toBe(false);

    discard.click();
    await settle(fixture);
    expect(panel.order()).toEqual([OESTE_PANTRY, OESTE_CHILLED]);
    expect(save.disabled).toBe(true);
  });
});

/**
 * A shop whose order follows its map (admin plan 0040; backend plan 0200,
 * section 5). `loc_cordoba_centro` has a walk shown to shoppers, and every
 * save of that walk writes the order, so the first move of a visit is
 * confirmed. Adding, opening and deleting are not: a walk deletes nothing.
 */
describe('the sections of a shop with a map', () => {
  const dialog = (fixture: ComponentFixture<TestHost>) =>
    fixture.nativeElement.querySelector('lib-confirm-dialog');

  it('holds exactly one shop with a map in the memory twin', () => {
    expect(
      LOCATION_SEED.filter((location) => location.hasMap).map(
        (location) => location.id
      )
    ).toEqual(['loc_cordoba_centro']);
  });

  it('says the order follows the map, as a waiting state with its own info', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    const notice = fixture.nativeElement.querySelector(
      '[data-map-notice]'
    ) as HTMLElement | null;

    expect(notice?.textContent).toContain('catalog.locationSections.mapState');
    expect(notice?.classList.contains('waiting')).toBe(true);
    expect(
      notice?.parentElement?.querySelector('lib-info-button')
    ).not.toBeNull();
    expect(panel.mapInfo.points).toEqual(['catalog.locationSections.info.map']);
  });

  it('says nothing about a map for a shop without one', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(fixture.nativeElement.querySelector('[data-map-notice]')).toBeNull();
    panel.move(OESTE_CHILLED, -1);
    await settle(fixture);
    expect(dialog(fixture)).toBeNull();
  });

  it('asks before the first move, makes it on yes, and asks once a visit', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    panel.move(CENTRO_OFFERS, -1);
    await settle(fixture);
    expect(dialog(fixture)?.textContent).toContain(
      'catalog.locationSections.mapNotice'
    );
    expect(panel.order()).toEqual([CENTRO_CHILLED, CENTRO_OFFERS]);

    buttonSaying(
      fixture,
      'catalog.locationSections.mapConfirm.confirm'
    )?.click();
    await settle(fixture);
    expect(dialog(fixture)).toBeNull();
    expect(panel.order()).toEqual([CENTRO_OFFERS, CENTRO_CHILLED]);

    panel.move(CENTRO_OFFERS, 1);
    await settle(fixture);
    expect(dialog(fixture)).toBeNull();
    expect(panel.order()).toEqual([CENTRO_CHILLED, CENTRO_OFFERS]);
  });

  it('refuses a drag while the question is open', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    const refused = drag('dragstart');
    rowsOf(fixture)[1].dispatchEvent(refused);
    await settle(fixture);

    expect(refused.defaultPrevented).toBe(true);
    expect(panel.dragging()).toBeNull();
    expect(dialog(fixture)).not.toBeNull();
  });

  it('deletes with no question about the map', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    (
      rowsOf(fixture)[1].querySelector('[data-delete]') as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(dialog(fixture)?.textContent).toContain(
      'catalog.locationSections.deleteHeading'
    );
    expect(dialog(fixture)?.textContent).not.toContain(
      'catalog.locationSections.mapNotice'
    );
    expect(panel.askingMapEdit()).toBe(false);
  });
});
