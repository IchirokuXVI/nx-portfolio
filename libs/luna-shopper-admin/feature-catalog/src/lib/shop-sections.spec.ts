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
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  ResourceChanges,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCATION_SEED } from './catalog-seed';
import { sectionSource } from './catalog-sources';
import { CATEGORIES } from './categories';
import { ChainSections } from './chain-sections';
import { ChainPage } from './chains/chain-page';
import { CHAIN_RESOURCES, chainsRoutes } from './chains/chains-routes';
import { ShopPage } from './chains/shop-page';
import { ItemChainSections, previewSentence } from './item-sections-panel';
import { ITEMS } from './items';
import { LocationSections, moveId } from './location-sections';
import { PRICES } from './prices';
import { catalogRoutes } from './routes';
import { SEEDED_SECTION } from './section-seed';
import {
  ShopSections,
  toSectionsAtLocation,
  toShopSection,
} from './shop-sections';
import { SupermarketFormPage } from './supermarket-form-page';

/**
 * Shop sections in the back office (admin plan 0037), against the in memory
 * twins: the rule of backend plan 0167, section 3, as the twin keeps it, and
 * each panel's read, a save and a refusal.
 *
 * Both panels are tabs since admin plan 0042: a chain's sections at
 * `/chains/{chainId}/sections`, and the order a shop walks them in at
 * `/chains/{chainId}/shops/{shopId}/sections`.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/**
 * The Chains section as the app declares it, and beside it what the product
 * screen needs of the catalog, mounted at the root.
 */
const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: chainsRoutes(),
  },
  {
    key: 'catalog',
    label: '',
    resources: [ITEMS, CATEGORIES, PRICES],
    screens: catalogRoutes(),
  },
];

/** A phone, where a row has a button each way and no handle. */
const PHONE: Provider = {
  provide: Viewport,
  useValue: { compact: signal(true), split: signal(false) },
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
    const fixture = await boot('/chains/sm_mercadona/sections');
    await settle(fixture);
    return fixture;
  }

  const panelOf = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(ChainSections))
      .componentInstance as ChainSections;

  /** The panel is a tab of the chain's page, at an address of its own. */
  it('is a tab of the chain’s page, reached from the tab row', async () => {
    const fixture = await boot('/chains/sm_mercadona/shops');

    const tab = (
      [...fixture.nativeElement.querySelectorAll('nav a')] as HTMLElement[]
    ).find((link) =>
      link.textContent?.includes('catalog.chains.tabs.sections')
    );
    tab?.click();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/chains/sm_mercadona/sections');
    expect(fixture.debugElement.query(By.directive(ChainPage))).not.toBeNull();
    expect(panelOf(fixture).supermarketId()).toBe('sm_mercadona');
  });

  /** Both links are asked of the registry, so they sit under the chain. */
  it('builds the add and edit links under the chain', async () => {
    const fixture = await openTab();
    const panel = panelOf(fixture);

    expect(panel.newLink()).toEqual([
      '/',
      'chains',
      'sm_mercadona',
      'sections',
      'new',
    ]);
    expect(panel.editLink(OFFERS)).toEqual([
      '/',
      'chains',
      'sm_mercadona',
      'sections',
      OFFERS,
    ]);
  });

  it('opens the form of a section as a page beside the chain’s', async () => {
    const fixture = await boot(`/chains/sm_mercadona/sections/${OFFERS}`);

    // A sibling of the chain's page and not a tab of it.
    expect(fixture.debugElement.query(By.directive(ChainPage))).toBeNull();
    expect(text(fixture)).toContain('resource.form.edit');
    // The chain is the address, so the form has no control for it. The slug
    // is there to show that the form did draw.
    expect(fixture.nativeElement.querySelector('#field-slug')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#field-supermarketId')
    ).toBeNull();
  });

  /**
   * Admin plan 0042, target 6: reorder. The order is each section's
   * `position`, so a move is the section and its neighbour trading places.
   */
  it('moves a section a step, by trading positions with its neighbour', async () => {
    const fixture = await openTab();
    const panel = panelOf(fixture);
    const before = panel.sections().map((section) => section.position);
    const changes = TestBed.inject(ResourceChanges);
    const written = changes.version('sections');

    (
      fixture.nativeElement.querySelectorAll(
        '[data-move-down]'
      )[0] as HTMLButtonElement
    ).click();
    await settle(fixture);
    await settle(fixture);

    expect(panel.sections().map((section) => section.slug)).toEqual([
      'chilled',
      'offers',
    ]);
    // The same two positions, the other way round.
    expect(panel.sections().map((section) => section.position)).toEqual(before);
    // The page above counts the sections, so it is told one was written.
    expect(changes.version('sections')).toBeGreaterThan(written);
  });

  it('offers no step past either end', async () => {
    const fixture = await openTab();
    const ups = fixture.nativeElement.querySelectorAll('[data-move-up]');
    const downs = fixture.nativeElement.querySelectorAll('[data-move-down]');

    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((ups[1] as HTMLButtonElement).disabled).toBe(false);
    expect((downs[0] as HTMLButtonElement).disabled).toBe(false);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why a move was refused, and reads the order again', async () => {
    const fixture = await openTab();
    const panel = panelOf(fixture);
    const gateways = TestBed.inject(RESOURCE_GATEWAYS);
    const real = gateways.for.bind(gateways);
    jest.spyOn(gateways, 'for').mockImplementation((source) => {
      // The gateway itself with one method replaced, and not a copy of it:
      // the read that follows the refusal goes through the same object.
      const gateway = real(source);
      gateway.update = async () => {
        throw refusal('section_not_found', 404);
      };
      return gateway;
    });

    await panel.move(panel.sections()[0], 1);
    await settle(fixture);

    expect(panel.sections().map((section) => section.slug)).toEqual([
      'offers',
      'chilled',
    ]);
    expect(panel.moving()).toBe(false);
    expect(text(fixture)).toContain('resource.error.sectionNotFound');
  });

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
    const fixture = await boot('/chains/new');

    expect(
      fixture.debugElement.query(By.directive(SupermarketFormPage))
    ).not.toBeNull();
    // The tabs are the chain's page, and a chain that does not exist has none.
    expect(fixture.debugElement.query(By.directive(ChainPage))).toBeNull();
    expect(text(fixture)).not.toContain('catalog.chains.tabs.sections');
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

/** The Sections tab of one of Mercadona's shops. */
async function openShopSections(id: string, providers: Provider[] = []) {
  const fixture = await boot(
    `/chains/sm_mercadona/shops/${id}/sections`,
    providers
  );
  await settle(fixture);
  const panel = fixture.debugElement.query(By.directive(LocationSections))
    .componentInstance as LocationSections;
  return { fixture, panel };
}

/** The rows of the ordering control, ticked ones first. */
const choiceRows = (fixture: ComponentFixture<TestHost>) =>
  [...fixture.nativeElement.querySelectorAll('.choices li')] as HTMLElement[];

/** A drag event jsdom can make: it has no `DragEvent` and no data transfer. */
const drag = (type: 'dragstart' | 'dragover' | 'dragend') =>
  new Event(type, { bubbles: true, cancelable: true });

describe('the sections of a shop', () => {
  const openShop = openShopSections;

  it('is a tab of the shop’s page, under the chain', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(fixture.debugElement.query(By.directive(ShopPage))).not.toBeNull();
    expect(panel.locationId()).toBe('loc_cordoba_oeste');
    // The chain is read off the shop the page holds, never typed.
    expect(panel.supermarketId()).toBe('sm_mercadona');
  });

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

  /** The page above counts the shop's sections on the tab, so it is told. */
  it('says a save happened, for the page that counts the sections', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const changes = TestBed.inject(ResourceChanges);
    const before = changes.version('location-sections');

    panel.move(CHILLED, -1);
    await panel.save();
    await settle(fixture);

    expect(changes.version('location-sections')).toBe(before + 1);
  });
});

/**
 * Ordering the list (admin plan 0042, target 5): a handle on a wide screen,
 * moved by a drag or by the arrow keys, and a button each way on a phone.
 * Either way nothing is written until Save.
 */
describe('ordering the sections of a shop', () => {
  const openShop = openShopSections;

  it('gives each ticked row a handle on a wide screen, and no buttons', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(fixture.nativeElement.querySelectorAll('[data-grip]')).toHaveLength(
      2
    );
    expect(fixture.nativeElement.querySelector('[data-move-up]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-move-down]')).toBeNull();
    expect(choiceRows(fixture).map((row) => row.draggable)).toEqual([
      true,
      true,
    ]);

    // A row the shop does not have is no place in its walk, so it has no
    // handle and cannot be dragged.
    panel.toggle(OFFERS);
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('[data-grip]')).toHaveLength(
      1
    );
    expect(choiceRows(fixture).map((row) => row.draggable)).toEqual([
      true,
      false,
    ]);
  });

  it('moves a row a place with the arrow keys, and says where it went', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setForLocation');
    const grip = () =>
      fixture.nativeElement.querySelectorAll('[data-grip]') as HTMLElement[];

    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    grip()[0].dispatchEvent(down);
    await settle(fixture);

    expect(panel.order()).toEqual([CHILLED, OFFERS]);
    // The page must not scroll under the row.
    expect(down.defaultPrevented).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent
    ).toContain('catalog.locationSections.movedTo');

    grip()[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
    );
    await settle(fixture);

    expect(panel.order()).toEqual([OFFERS, CHILLED]);
    expect(write).not.toHaveBeenCalled();
  });

  it('takes the place of the row it is dragged over, and writes nothing', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const write = jest.spyOn(TestBed.inject(ShopSections), 'setForLocation');

    choiceRows(fixture)[1].dispatchEvent(drag('dragstart'));
    await settle(fixture);
    expect(panel.dragging()).toBe(CHILLED);

    const over = drag('dragover');
    choiceRows(fixture)[0].dispatchEvent(over);
    await settle(fixture);

    // Reordered while the row is still held, and the browser is told the row
    // may be dropped here.
    expect(panel.order()).toEqual([CHILLED, OFFERS]);
    expect(over.defaultPrevented).toBe(true);

    choiceRows(fixture)[0].dispatchEvent(drag('dragend'));
    await settle(fixture);

    expect(panel.dragging()).toBeNull();
    expect(panel.dirty()).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('gives a phone a button each way, 44 px wide, and no handle', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste', [PHONE]);

    expect(fixture.nativeElement.querySelector('[data-grip]')).toBeNull();
    expect(choiceRows(fixture).map((row) => row.draggable)).toEqual([
      false,
      false,
    ]);

    const ups = fixture.nativeElement.querySelectorAll('[data-move-up]');
    const downs = fixture.nativeElement.querySelectorAll('[data-move-down]');
    expect(ups).toHaveLength(2);
    expect(downs).toHaveLength(2);
    // The first cannot go up and the last cannot go down.
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);
    // Each says which section it moves, since the button holds an icon alone.
    expect(ups[1].getAttribute('aria-label')).toBe(
      'catalog.locationSections.up'
    );

    (downs[0] as HTMLButtonElement).click();
    await settle(fixture);

    expect(panel.order()).toEqual([CHILLED, OFFERS]);
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

  it('keeps Save and Discard in a bar at the bottom, off until something moved', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');
    const bar = fixture.nativeElement.querySelector('.controls') as HTMLElement;
    const save = bar.querySelector('[data-save]') as HTMLButtonElement;
    const discard = bar.querySelector('[data-discard]') as HTMLButtonElement;

    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
    // The chain's default has nothing to go back to.
    expect(bar.querySelector('[data-use-chain]')).toBeNull();

    panel.move(CHILLED, -1);
    await settle(fixture);

    expect(save.disabled).toBe(false);
    expect(discard.disabled).toBe(false);

    discard.click();
    await settle(fixture);

    expect(panel.order()).toEqual([OFFERS, CHILLED]);
    expect(panel.dirty()).toBe(false);
    expect(save.disabled).toBe(true);
  });

  /**
   * A shop with a list of its own can go back to its chain's. On a wide
   * screen that is the first button of the bar. On a phone three buttons in
   * 390 px wrap their own words, so it sits under the list.
   */
  it('puts the way back to the chain’s order in the bar, and under the list on a phone', async () => {
    const wide = await openShop('loc_cordoba_centro');
    const inBar = wide.fixture.nativeElement.querySelector(
      '.controls [data-use-chain]'
    );
    expect(inBar).not.toBeNull();
    expect(
      wide.fixture.nativeElement.querySelectorAll('[data-use-chain]')
    ).toHaveLength(1);

    const phone = await openShop('loc_cordoba_centro', [PHONE]);
    const below =
      phone.fixture.nativeElement.querySelectorAll('[data-use-chain]');
    expect(below).toHaveLength(1);
    expect((below[0] as HTMLElement).closest('.controls')).toBeNull();
    // The bar keeps the two buttons of the edit in hand.
    expect(
      phone.fixture.nativeElement.querySelectorAll('.controls button')
    ).toHaveLength(2);
  });

  it('refuses to save a list with nothing ticked', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    panel.toggle(OFFERS);
    panel.toggle(CHILLED);
    await settle(fixture);

    expect(panel.dirty()).toBe(true);
    expect(
      (fixture.nativeElement.querySelector('[data-save]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(text(fixture)).toContain('catalog.locationSections.noneTicked');
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
  const openShop = openShopSections;

  const dialog = (fixture: ComponentFixture<TestHost>) =>
    fixture.nativeElement.querySelector('lib-confirm-dialog');

  const notice = (fixture: ComponentFixture<TestHost>) =>
    fixture.nativeElement.querySelector(
      'lib-location-sections [data-map-notice]'
    ) as HTMLElement | null;

  it('holds exactly one shop with a map in the memory twin', () => {
    expect(
      LOCATION_SEED.filter((location) => location.hasMap).map(
        (location) => location.id
      )
    ).toEqual(['loc_cordoba_centro']);
  });

  /**
   * A waiting state and not a paragraph (admin plan 0042, target 5). What a
   * map does to the list is behind the info button beside it, and the
   * sentence itself is asked before the first edit.
   */
  it('says the list follows the map, as a waiting state with its own info', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');

    expect(panel.hasMap()).toBe(true);
    expect(notice(fixture)?.textContent).toContain(
      'catalog.locationSections.mapState'
    );
    expect(notice(fixture)?.classList.contains('waiting')).toBe(true);
    expect(
      notice(fixture)?.parentElement?.querySelector('lib-info-button')
    ).not.toBeNull();
    expect(panel.mapInfo).toEqual({
      title: 'catalog.locationSections.info.title',
      points: ['catalog.locationSections.info.map'],
    });
    // The paragraph it replaced is gone from the page.
    expect(fixture.nativeElement.querySelector('[role="note"]')).toBeNull();
    expect(text(fixture)).not.toContain('catalog.locationSections.mapNotice');
  });

  it('says nothing about a map for a shop without one', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_oeste');

    expect(panel.hasMap()).toBe(false);
    expect(notice(fixture)).toBeNull();
    expect(text(fixture)).not.toContain('catalog.locationSections.mapState');
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

    // The first row's handle, moved down a place with the keyboard.
    (
      fixture.nativeElement.querySelector('[data-grip]') as HTMLElement
    ).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    await settle(fixture);
    expect(dialog(fixture)).not.toBeNull();
    expect(panel.order()).toEqual(before);
  });

  /** A drag is an edit, so it is refused while the question is open. */
  it('asks before a drag too, and drags after a yes', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro');
    const before = panel.order();

    const refused = drag('dragstart');
    choiceRows(fixture)[1].dispatchEvent(refused);
    await settle(fixture);

    expect(refused.defaultPrevented).toBe(true);
    expect(panel.dragging()).toBeNull();
    expect(dialog(fixture)).not.toBeNull();

    buttonSaying(
      fixture,
      'catalog.locationSections.mapConfirm.confirm'
    )?.click();
    await settle(fixture);
    // Agreeing makes no edit by itself: the operator drags again.
    expect(panel.order()).toEqual(before);

    choiceRows(fixture)[1].dispatchEvent(drag('dragstart'));
    choiceRows(fixture)[0].dispatchEvent(drag('dragover'));
    choiceRows(fixture)[0].dispatchEvent(drag('dragend'));
    await settle(fixture);

    expect(dialog(fixture)).toBeNull();
    expect(panel.order()).toEqual([...before].reverse());
  });

  it('asks on a phone as well, from a move button', async () => {
    const { fixture, panel } = await openShop('loc_cordoba_centro', [PHONE]);
    const before = panel.order();

    (
      fixture.nativeElement.querySelector(
        '[data-move-down]'
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(dialog(fixture)?.textContent).toContain(
      'catalog.locationSections.mapNotice'
    );
    expect(panel.order()).toEqual(before);
  });
});

describe('where a product is, per chain', () => {
  async function openItem(id: string) {
    // The catalog is at the root here, as the comment on `SECTIONS` says.
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
