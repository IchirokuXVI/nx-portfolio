import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { LOCATION_SEED } from './catalog-seed';
import { sectionSource } from './catalog-sources';
import { CATEGORIES } from './categories';
import { ChainSections } from './chain-sections';
import { ItemChainSections, previewSentence } from './item-sections-panel';
import { ITEMS } from './items';
import { LocationSections, moveId } from './location-sections';
import { LOCATIONS } from './locations';
import { PRICE_SCOPES } from './price-scopes';
import { PRICES } from './prices';
import { catalogRoutes } from './routes';
import { SEEDED_SECTION } from './section-seed';
import { SECTIONS } from './sections';
import {
  ShopSections,
  toSectionsAtLocation,
  toShopSection,
} from './shop-sections';
import { SupermarketFormPage } from './supermarket-form-page';
import { SUPERMARKETS } from './supermarkets';

/**
 * Shop sections in the back office (admin plan 0037), against the in memory
 * twins: the rule of backend plan 0167, section 3, as the twin keeps it, and
 * each panel's read, a save and a refusal.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [
  SUPERMARKETS,
  LOCATIONS,
  SECTIONS,
  PRICE_SCOPES,
  ITEMS,
  CATEGORIES,
  PRICES,
];

const SECTION: AdminSection = {
  key: 'catalog',
  label: '',
  resources: ALL,
  screens: catalogRoutes(),
};

const { offers: OFFERS, chilled: CHILLED } = SEEDED_SECTION;

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
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideResources(...ALL),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

function sections(): ShopSections {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [ContentLocaleStore] });
  return TestBed.inject(ShopSections);
}

describe('the rule, as the memory twin keeps it', () => {
  it('reads a shop with its own list in its order, and one without as the chain', async () => {
    const shop = sections();

    const centro = await shop.forLocation('loc_cordoba_centro');
    expect(centro.source).toBe('LOCATION');
    expect(centro.sections.map((section) => section.id)).toEqual([
      CHILLED,
      OFFERS,
    ]);

    const oeste = await shop.forLocation('loc_cordoba_oeste');
    expect(oeste.source).toBe('CHAIN');
    expect(oeste.sections.map((section) => section.id)).toEqual([
      OFFERS,
      CHILLED,
    ]);
  });

  it('answers each branch: pinned, covered through a root, and nothing', async () => {
    const shop = sections();

    const answer = await shop.atLocation('loc_cordoba_centro', [
      'it_olive_oil_1l',
      'it_milk_1l',
      'it_dish_soap',
    ]);

    expect(answer.source).toBe('LOCATION');
    expect(answer.items).toEqual([
      { itemId: 'it_olive_oil_1l', sectionIds: [OFFERS], step: 'PINNED' },
      { itemId: 'it_milk_1l', sectionIds: [CHILLED], step: 'COVERED' },
      { itemId: 'it_dish_soap', sectionIds: [], step: 'NONE' },
    ]);
  });

  it('ignores a pin to a section the shop does not have', async () => {
    const shop = sections();
    await shop.setForLocation('loc_cordoba_centro', [CHILLED]);

    const answer = await shop.atLocation('loc_cordoba_centro', [
      'it_olive_oil_1l',
    ]);

    // The oil is pinned to Offers, which this shop no longer lists, and no
    // section it has covers oil, so it is shown under its own categories.
    expect(answer.items[0]).toEqual({
      itemId: 'it_olive_oil_1l',
      sectionIds: [],
      step: 'NONE',
    });
  });

  it('shows a product under its categories at a chain with no sections', async () => {
    const shop = sections();

    const answer = await shop.atLocation('loc_consum_centro', ['it_milk_1l']);

    expect(answer.source).toBe('CHAIN');
    expect(answer.items[0].step).toBe('NONE');
  });

  it('returns a shop to the chain on an empty list, and recounts its shops', async () => {
    const shop = sections();

    await shop.setForLocation('loc_cordoba_oeste', [CHILLED]);
    let chain = await shop.chainSections('sm_mercadona');
    expect(chain.find((section) => section.id === OFFERS)?.locationCount).toBe(
      2
    );

    const back = await shop.setForLocation('loc_cordoba_oeste', []);
    expect(back.source).toBe('CHAIN');
    chain = await shop.chainSections('sm_mercadona');
    expect(chain.find((section) => section.id === OFFERS)?.locationCount).toBe(
      3
    );
  });

  it('refuses a section of another chain, and one that does not exist', async () => {
    const shop = sections();
    const gateway = TestBed.inject(RESOURCE_GATEWAYS).for(sectionSource());
    const consum = await gateway.create({
      supermarketId: 'sm_consum',
      slug: 'fresh',
      name: { en: 'Fresh' },
      categoryIds: [],
    });

    await expect(
      shop.setForLocation('loc_cordoba_centro', [String(consum['id'])])
    ).rejects.toMatchObject({ code: 'section_of_another_chain' });
    await expect(
      shop.setPins('sm_mercadona', 'it_milk_1l', ['sec_nowhere'])
    ).rejects.toMatchObject({ code: 'section_not_found' });
  });

  it('replaces the pins whole, and an empty pick removes them', async () => {
    const shop = sections();

    expect(await shop.setPins('sm_mercadona', 'it_milk_1l', [OFFERS])).toEqual([
      OFFERS,
    ]);
    expect(await shop.pinsOf('sm_mercadona', 'it_milk_1l')).toEqual([OFFERS]);

    expect(await shop.setPins('sm_mercadona', 'it_milk_1l', [])).toEqual([]);
    expect(await shop.pinsOf('sm_mercadona', 'it_milk_1l')).toEqual([]);
  });

  it('refuses a slug the chain holds, and cascades a delete out of lists and pins', async () => {
    const shop = sections();
    const gateway = TestBed.inject(RESOURCE_GATEWAYS).for(sectionSource());

    await expect(
      gateway.create({
        supermarketId: 'sm_mercadona',
        slug: 'offers',
        name: { en: 'Offers again' },
        categoryIds: [],
      })
    ).rejects.toMatchObject({ code: 'section_slug_taken' });

    await gateway.remove(OFFERS);

    const centro = await shop.forLocation('loc_cordoba_centro');
    expect(centro.sections.map((section) => section.id)).toEqual([CHILLED]);
    expect(await shop.pinsOf('sm_mercadona', 'it_olive_oil_1l')).toEqual([]);
  });
});

describe('reading the section wire', () => {
  it('reads a section, and drops a record with no id', () => {
    expect(toShopSection({ id: '' })).toBeNull();
    expect(
      toShopSection({
        id: 's1',
        supermarketId: 'c1',
        slug: 'frozen',
        name: { en: 'Frozen' },
        position: 2,
        categoryIds: ['k1', 7],
      })
    ).toEqual({
      id: 's1',
      supermarketId: 'c1',
      slug: 'frozen',
      name: { en: 'Frozen' },
      position: 2,
      categoryIds: ['k1'],
      locationCount: null,
    });
  });

  it('reads an unknown step as nothing, which never claims a section', () => {
    const answer = toSectionsAtLocation({
      source: 'LOCATION',
      items: [{ itemId: 'i1', sectionIds: ['s1'], step: 'GUESSED' }],
    });
    expect(answer.items[0].step).toBe('NONE');
  });

  it('names the branch that answered', () => {
    const name = (id: string) => (id === 's1' ? 'Frozen' : id);
    const at = (step: string, ids: string[]) =>
      toSectionsAtLocation({
        source: 'CHAIN',
        items: [{ itemId: 'i1', sectionIds: ids, step }],
      });

    expect(previewSentence(at('PINNED', ['s1']), 'i1', name)).toEqual({
      key: 'catalog.itemSections.preview.pinned',
      sections: 'Frozen',
    });
    expect(previewSentence(at('COVERED', ['s1']), 'i1', name).key).toBe(
      'catalog.itemSections.preview.covered'
    );
    expect(previewSentence(at('NONE', []), 'i1', name).key).toBe(
      'catalog.itemSections.preview.none'
    );
  });

  it('moves an id a step, and not past either end', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the Sections tab of a chain', () => {
  async function openTab() {
    const fixture = await boot('/supermarkets/sm_mercadona');
    buttonSaying(fixture, 'catalog.chainTabs.sections')?.click();
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }

  it('lists the sections in order, a root marked as covering all of it', async () => {
    const fixture = await openTab();
    const panel = fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;

    expect(panel.sections().map((section) => section.slug)).toEqual([
      'offers',
      'chilled',
    ]);
    const chilled = panel.sections()[1];
    expect(panel.covered(chilled)).toEqual([
      {
        id: 'cat_eggs-milk-and-butter',
        name: 'Eggs, milk, and butter',
        root: true,
      },
    ]);
    expect(text(fixture)).toContain('catalog.chainSections.coversAll');
    expect(text(fixture)).toContain('catalog.chainSections.coversNothing');
  });

  it('has no tabs on a chain being created', async () => {
    const fixture = await boot('/supermarkets/new');

    expect(
      fixture.debugElement.query(By.directive(SupermarketFormPage))
    ).not.toBeNull();
    expect(buttonSaying(fixture, 'catalog.chainTabs.sections')).toBeUndefined();
  });

  it('deletes a section after saying what goes with it', async () => {
    const fixture = await openTab();
    const panel = fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;

    panel.deleting.set(panel.sections()[0]);
    await settle(fixture);
    expect(text(fixture)).toContain('catalog.chainSections.deleteBody');

    await panel.confirmDelete(panel.sections()[0]);
    await settle(fixture);

    expect(panel.sections().map((section) => section.slug)).toEqual([
      'chilled',
    ]);
  });

  it('says why a delete was refused, and keeps the row', async () => {
    const fixture = await openTab();
    const panel = fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;
    const gateways = TestBed.inject(RESOURCE_GATEWAYS);
    const real = gateways.for.bind(gateways);
    jest.spyOn(gateways, 'for').mockImplementation((source) => {
      const gateway = real(source);
      return {
        ...gateway,
        remove: async () => {
          throw refusal('section_not_found', 404);
        },
      };
    });

    await panel.confirmDelete(panel.sections()[0]);
    await settle(fixture);

    expect(panel.sections()).toHaveLength(2);
    expect(text(fixture)).toContain('resource.error.sectionNotFound');
  });
});

describe('the sections of a shop', () => {
  async function openShop(id: string) {
    const fixture = await boot(`/locations/${id}`);
    await settle(fixture);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;
    return { fixture, panel };
  }

  it('opens on the chain default and says so', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(panel.saved()?.source).toBe('CHAIN');
    expect(text(fixture)).toContain('catalog.locationSections.fromChain');
    expect(panel.choices().map((choice) => choice.section.slug)).toEqual([
      'offers',
      'chilled',
    ]);
    expect(
      buttonSaying(fixture, 'catalog.locationSections.useChain')
    ).toBeUndefined();
  });

  it('holds the order locally and saves it whole in one request', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const shop = TestBed.inject(ShopSections);
    const write = jest.spyOn(shop, 'setForLocation');

    panel.move(CHILLED, -1);
    panel.toggle(OFFERS);
    await settle(fixture);
    expect(write).not.toHaveBeenCalled();
    expect(panel.dirty()).toBe(true);

    buttonSaying(fixture, 'catalog.locationSections.save')?.click();
    await settle(fixture);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('loc_cordoba_oeste', [CHILLED]);
    expect(panel.saved()?.source).toBe('LOCATION');
    expect(text(fixture)).toContain('catalog.locationSections.own');
  });

  it('returns a shop with its own list to the chain default', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    expect(panel.saved()?.source).toBe('LOCATION');

    buttonSaying(fixture, 'catalog.locationSections.useChain')?.click();
    await settle(fixture);
    // This shop has a map, so the first edit of the visit is confirmed.
    buttonSaying(
      fixture,
      'catalog.locationSections.mapConfirm.confirm'
    )?.click();
    await settle(fixture);

    expect(panel.saved()?.source).toBe('CHAIN');
    expect(panel.order()).toEqual([OFFERS, CHILLED]);
  });

  it('keeps what was ticked when the save is refused', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    jest
      .spyOn(TestBed.inject(ShopSections), 'setForLocation')
      .mockRejectedValue(refusal('section_of_another_chain', 409));

    panel.move(CHILLED, -1);
    await panel.save();
    await settle(fixture);

    expect(panel.order()).toEqual([CHILLED, OFFERS]);
    expect(panel.saved()?.source).toBe('CHAIN');
    expect(text(fixture)).toContain('resource.error.sectionOfAnotherChain');
  });
});

/**
 * A shop whose list follows its map (admin plan 0040, on backend plan 0168).
 *
 * The memory twin holds one: `loc_cordoba_centro` has a walk shown to
 * shoppers, and every save of that walk rewrites the list, so the panel says
 * so and the first edit of a visit is confirmed. `loc_cordoba_oeste` has no
 * map and edits as it always did.
 */
describe('the sections of a shop with a map', () => {
  async function openShop(id: string) {
    const fixture = await boot(`/locations/${id}`);
    await settle(fixture);
    const panel = fixture.debugElement.query(By.directive(LocationSections))
      .componentInstance as LocationSections;
    return { fixture, panel };
  }

  const dialog = (fixture: ComponentFixture<TestHost>) =>
    fixture.nativeElement.querySelector('lib-confirm-dialog');

  it('holds exactly one shop with a map in the memory twin', () => {
    expect(
      LOCATION_SEED.filter((location) => location.hasMap).map(
        (location) => location.id
      )
    ).toEqual(['loc_cordoba_centro']);
  });

  it('says the list follows the map', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    expect(panel.hasMap()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[role="note"]')?.textContent
    ).toContain('catalog.locationSections.mapNotice');
  });

  it('says nothing about a map for a shop without one', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(panel.hasMap()).toBe(false);
    expect(text(fixture)).not.toContain('catalog.locationSections.mapNotice');

    panel.move(CHILLED, -1);
    await settle(fixture);

    expect(dialog(fixture)).toBeNull();
    expect(panel.order()).toEqual([CHILLED, OFFERS]);
  });

  it('asks before the first edit, with the same sentence, and makes it on yes', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    const before = panel.order();

    const box = fixture.nativeElement.querySelector(
      '.choices input[type="checkbox"]'
    ) as HTMLInputElement;
    box.click();
    await settle(fixture);

    expect(dialog(fixture)?.textContent).toContain(
      'catalog.locationSections.mapConfirm.heading'
    );
    expect(dialog(fixture)?.textContent).toContain(
      'catalog.locationSections.mapNotice'
    );
    // Nothing changed yet, and the box shows it.
    expect(panel.order()).toEqual(before);
    expect(box.checked).toBe(true);

    buttonSaying(
      fixture,
      'catalog.locationSections.mapConfirm.confirm'
    )?.click();
    await settle(fixture);

    expect(dialog(fixture)).toBeNull();
    expect(panel.order()).toEqual(before.slice(1));
  });

  it('asks only once in a visit', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    const firstBox = () =>
      fixture.nativeElement.querySelector(
        '.choices input[type="checkbox"]'
      ) as HTMLInputElement;

    firstBox().click();
    await settle(fixture);
    expect(dialog(fixture)).not.toBeNull();
    buttonSaying(
      fixture,
      'catalog.locationSections.mapConfirm.confirm'
    )?.click();
    await settle(fixture);
    const afterFirst = panel.order();

    firstBox().click();
    await settle(fixture);

    expect(dialog(fixture)).toBeNull();
    expect(panel.askingMapEdit()).toBe(false);
    expect(panel.mapEditAccepted()).toBe(true);
    expect(panel.order()).not.toEqual(afterFirst);
  });

  it('changes nothing when the confirmation is dismissed, and asks again', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    const before = panel.order();
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setForLocation');

    buttonSaying(fixture, 'catalog.locationSections.useChain')?.click();
    await settle(fixture);
    // The dialog's own cancel, not the form's, which leaves the page.
    ([...dialog(fixture).querySelectorAll('button')] as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'resource.action.cancel')
      ?.click();
    await settle(fixture);

    expect(write).not.toHaveBeenCalled();
    expect(panel.order()).toEqual(before);
    expect(panel.dirty()).toBe(false);

    // The first row's down button: its up button is disabled at the top.
    (
      fixture.nativeElement.querySelectorAll(
        '.move button'
      )[1] as HTMLButtonElement
    ).click();
    await settle(fixture);
    expect(dialog(fixture)).not.toBeNull();
  });
});

describe('where a product is, per chain', () => {
  async function openItem(id: string) {
    const fixture = await boot(`/items/${id}`);
    await settle(fixture);
    await settle(fixture);
    const rows = fixture.debugElement
      .queryAll(By.directive(ItemChainSections))
      .map((row) => row.componentInstance as ItemChainSections);
    return { fixture, rows };
  }

  it('draws one row per chain the product is sold at, with its pins', async () => {
    const { fixture, rows } = await openItem('it_olive_oil_1l');

    expect(rows.map((row) => row.supermarketId())).toEqual(['sm_mercadona']);
    expect(rows[0].pinnedNames()).toBe('Offers');
    expect(text(fixture)).toContain('catalog.itemSections.pinnedTo');
  });

  it('says a product with no pin is placed by its categories', async () => {
    const { fixture, rows } = await openItem('it_milk_1l');

    expect(rows.map((row) => row.supermarketId()).sort()).toEqual([
      'sm_consum',
      'sm_mercadona',
    ]);
    expect(text(fixture)).toContain('catalog.itemSections.byCategories');
  });

  it('saves an empty pick as no pins', async () => {
    const { fixture, rows } = await openItem('it_olive_oil_1l');
    const [row] = rows;

    row.edit();
    row.toggle(OFFERS);
    await row.save();
    await settle(fixture);

    expect(row.pinned()).toEqual([]);
    expect(
      await TestBed.inject(ShopSections).pinsOf(
        'sm_mercadona',
        'it_olive_oil_1l'
      )
    ).toEqual([]);
    expect(text(fixture)).toContain('catalog.itemSections.byCategories');
  });

  it('keeps the edit open when the save is refused', async () => {
    const { fixture, rows } = await openItem('it_olive_oil_1l');
    const [row] = rows;
    jest
      .spyOn(TestBed.inject(ShopSections), 'setPins')
      .mockRejectedValue(refusal('section_of_another_chain', 409));

    row.edit();
    row.toggle(CHILLED);
    await row.save();
    await settle(fixture);

    expect(row.editing()).toBe(true);
    expect(row.pinned()).toEqual([OFFERS]);
    expect(text(fixture)).toContain('resource.error.sectionOfAnotherChain');
  });

  it('previews each branch at a chosen shop', async () => {
    const { fixture, rows } = await openItem('it_olive_oil_1l');
    const [row] = rows;

    await row.choose('loc_cordoba_oeste');
    await settle(fixture);
    expect(row.preview()).toEqual({
      key: 'catalog.itemSections.preview.pinned',
      sections: 'Offers',
    });

    // Without the pin the oil is in no section: nothing Mercadona has covers it.
    row.edit();
    row.toggle(OFFERS);
    await row.save();
    expect(row.preview()?.key).toBe('catalog.itemSections.preview.none');

    const milk = await openItem('it_milk_1l');
    const mercadona = milk.rows.find(
      (candidate) => candidate.supermarketId() === 'sm_mercadona'
    );
    await mercadona?.choose('loc_cordoba_centro');
    expect(mercadona?.preview()).toEqual({
      key: 'catalog.itemSections.preview.covered',
      sections: 'Chilled',
    });
  });

  it('says why a preview could not be read', async () => {
    const { fixture, rows } = await openItem('it_olive_oil_1l');
    jest
      .spyOn(TestBed.inject(ShopSections), 'atLocation')
      .mockRejectedValue(refusal('not_found', 404));

    await rows[0].choose('loc_cordoba_oeste');
    await settle(fixture);

    expect(rows[0].preview()).toBeNull();
    expect(text(fixture)).toContain('resource.error.notFound');
  });
});
