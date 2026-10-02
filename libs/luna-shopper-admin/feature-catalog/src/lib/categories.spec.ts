import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
  ResourceFormPage,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { categorySource, itemSource } from './catalog-sources';
import { CATEGORIES } from './categories';
import { ITEMS } from './items';
import {
  ProductCategoriesBatch,
  toBatchAnswer,
} from './product-categories-batch';
import { SetCategoriesPanel } from './set-categories-panel';

/**
 * The category tree and "Set categories", rendered (admin plan 0036).
 *
 * Everything runs against the in memory gateway, which keeps the tree's rules,
 * so a refusal here is the memory twin refusing what catalog refuses rather
 * than a stub saying so. The batch is spied rather than replaced, so a spec can
 * prove that a tick and a pick send nothing and still let the press through.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [ITEMS, CATEGORIES];
const SECTION: AdminSection = { key: 'catalog', label: '', resources: ALL };

async function boot(url: string) {
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
    ],
  }).compileComponents();

  const batch = jest.spyOn(TestBed.inject(ProductCategoriesBatch), 'set');
  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return { fixture, batch };
}

/** Lets a read settle, then redraws. `whenStable` hangs in a zoneless spec. */
async function settle(fixture: ComponentFixture<TestHost>, ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const q = <T extends Element>(
  fixture: ComponentFixture<TestHost>,
  selector: string
) => fixture.nativeElement.querySelector(selector) as T | null;

const all = (fixture: ComponentFixture<TestHost>, selector: string) =>
  [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];

async function click(fixture: ComponentFixture<TestHost>, selector: string) {
  const button = q<HTMLButtonElement>(fixture, selector);
  expect(button).not.toBeNull();
  button?.click();
  await settle(fixture);
}

async function tick(fixture: ComponentFixture<TestHost>, box: HTMLElement) {
  box.dispatchEvent(new Event('change'));
  await settle(fixture);
}

/** The slugs of one product's categories, as the memory table holds them. */
async function slugsOf(itemId: string): Promise<readonly string[]> {
  const item = await TestBed.inject(RESOURCE_GATEWAYS)
    .for<Wire.CatalogItemView>(itemSource())
    .read(itemId);
  return item.categories.map((category) => category.slug);
}

/** Tick rows by index, open "Set categories" and pick these categories. */
async function picked(
  fixture: ComponentFixture<TestHost>,
  rows: readonly number[],
  categoryIds: readonly string[]
): Promise<SetCategoriesPanel> {
  const boxes = all(fixture, '[data-pick-row]');
  for (const index of rows) {
    await tick(fixture, boxes[index]);
  }
  await click(fixture, '[data-bulk="setCategories"]');
  const panel = fixture.debugElement.query(By.directive(SetCategoriesPanel))
    .componentInstance as SetCategoriesPanel;
  panel.choose(categoryIds);
  await settle(fixture);
  return panel;
}

describe('Set categories on the product list', () => {
  it('reviews every ticked product, now and after, and sends nothing yet', async () => {
    const { fixture, batch } = await boot('/items');
    // Whole milk 1 L (on milk) and the dish soap (on dishwasher).
    await picked(
      fixture,
      [0, 3],
      ['cat_ice-creams-and-ice', 'cat_cakes-and-churros']
    );
    expect(batch).not.toHaveBeenCalled();

    await click(fixture, '[data-set-categories-review]');

    const lines = all(fixture, '[data-review-item]');
    expect(lines.map((line) => line.getAttribute('data-review-item'))).toEqual([
      'it_milk_1l',
      'it_dish_soap',
    ]);
    expect(lines[0].textContent).toContain('Milk');
    expect(lines[0].textContent).toContain(
      'Ice creams and ice, Cakes and churros'
    );
    expect(lines[1].textContent).toContain('Dishwasher');
    expect(batch).not.toHaveBeenCalled();
  });

  it('replaces each product’s set in one request, and says what each has now', async () => {
    const { fixture, batch } = await boot('/items');
    await picked(fixture, [0, 3], ['cat_ice-creams-and-ice']);
    await click(fixture, '[data-set-categories-review]');

    await click(fixture, '[data-categories-send]');

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith([
      { itemId: 'it_milk_1l', categoryIds: ['cat_ice-creams-and-ice'] },
      { itemId: 'it_dish_soap', categoryIds: ['cat_ice-creams-and-ice'] },
    ]);
    expect(await slugsOf('it_milk_1l')).toEqual(['ice-creams-and-ice']);
    expect(await slugsOf('it_dish_soap')).toEqual(['ice-creams-and-ice']);
    expect(
      all(fixture, '[data-review-item]').map((line) =>
        line.getAttribute('data-outcome')
      )
    ).toEqual(['moved', 'moved']);

    // Done closes the panel, clears the ticks and reads the page again.
    await click(fixture, '[data-close]');
    await settle(fixture);
    expect(q(fixture, 'lib-set-categories-panel')).toBeNull();
  });

  it('leaves out a product that already has exactly the picked set', async () => {
    const { fixture, batch } = await boot('/items');
    await picked(fixture, [0], ['cat_milk']);
    await click(fixture, '[data-set-categories-review]');

    expect(fixture.nativeElement.textContent).toContain(
      'catalog.items.setCategories.alreadyThere'
    );
    expect(q(fixture, '[data-categories-send]')?.hasAttribute('disabled')).toBe(
      true
    );
    expect(batch).not.toHaveBeenCalled();
  });

  /**
   * The route is all or nothing: one refusal refuses the lot. A category
   * deleted between the review and the press is the real way to get one.
   */
  it('refuses the whole request, says why, and changes nothing', async () => {
    const { fixture } = await boot('/items');
    await picked(fixture, [0, 3], ['cat_ice-creams-and-ice']);
    await click(fixture, '[data-set-categories-review]');

    await TestBed.inject(RESOURCE_GATEWAYS)
      .for<Wire.CatalogCategoryView>(categorySource())
      .remove('cat_ice-creams-and-ice');

    await click(fixture, '[data-categories-send]');

    const refusal = q(fixture, '[data-categories-refused]');
    expect(refusal?.textContent).toContain('resource.error.categoryNotFound');
    expect(refusal?.textContent).toContain(
      'catalog.items.setCategories.unknown'
    );
    expect(
      all(fixture, '[data-review-item]').map((line) =>
        line.getAttribute('data-outcome')
      )
    ).toEqual(['refused', 'refused']);
    expect(await slugsOf('it_milk_1l')).toEqual(['milk']);
    expect(await slugsOf('it_dish_soap')).toEqual(['dishwasher']);

    // Back is still there: the operator can pick again.
    await click(fixture, '[data-categories-back]');
    expect(q(fixture, '[data-set-categories]')).not.toBeNull();
  });

  it('refuses a root, which no product may go on', async () => {
    await boot('/items');

    await expect(
      TestBed.inject(ProductCategoriesBatch).set([
        {
          itemId: 'it_milk_1l',
          categoryIds: ['cat_frozen-foods-and-ice-cream'],
        },
      ])
    ).rejects.toMatchObject({ code: 'category_not_a_leaf' });
    expect(await slugsOf('it_milk_1l')).toEqual(['milk']);
  });
});

describe('the category tree', () => {
  it('lists the tree with its parent, slug and product count', async () => {
    const { fixture } = await boot('/categories');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Eggs, milk, and butter');
    expect(text).toContain('uncategorised');
    expect(all(fixture, 'tbody tr').length).toBeGreaterThan(10);
  });

  /** A third level is said under the parent, not at the foot of the form. */
  it('says a third level under the parent it is about', async () => {
    const { fixture } = await boot('/categories/new');
    const page = fixture.debugElement.query(By.directive(ResourceFormPage))
      .componentInstance as ResourceFormPage;

    page.store.set('name', { en: 'Tubs', es: 'Tarrinas' });
    page.store.set('slug', 'tubs');
    page.store.set('parentId', 'cat_ice-creams-and-ice');
    await page.store.submit();
    await settle(fixture);

    expect(page.messages()['parentId']).toEqual([
      { kind: 'key', key: 'resource.error.categoryTooDeep' },
    ]);
    expect(page.bannerKey()).toBeNull();
  });

  it('refuses to delete a category holding products, and links to them', async () => {
    const { fixture } = await boot('/categories');
    const row = all(fixture, 'tbody tr').find((tr) =>
      tr.textContent?.includes('Milk')
    );
    expect(row).toBeDefined();

    (row?.querySelector('button.danger') as HTMLButtonElement | null)?.click();
    await settle(fixture);
    await click(fixture, 'lib-confirm-dialog .controls button:first-child');

    const refusal = q(fixture, '[data-refusal]');
    expect(refusal?.textContent).toContain('resource.error.categoryInUse');
    const link = refusal?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/items?categoryId=cat_milk');
    // Still there.
    await expect(
      TestBed.inject(RESOURCE_GATEWAYS)
        .for<Wire.CatalogCategoryView>(categorySource())
        .read('cat_milk')
    ).resolves.toMatchObject({ slug: 'milk' });
  });

  it('opens the product list already filtered by the category it links to', async () => {
    const { fixture } = await boot('/items?categoryId=cat_milk');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Whole milk 1 L');
    expect(text).not.toContain('Dishwashing liquid');
  });

  it('narrows the products by a root to every product under its children', async () => {
    await boot('/items');
    const page = await TestBed.inject(RESOURCE_GATEWAYS)
      .for<Wire.CatalogItemView>(itemSource())
      .list({ filters: { categoryId: 'cat_eggs-milk-and-butter' } });

    expect(page.items.map((item) => item.id)).toEqual([
      'it_milk_1l',
      'it_milk_6pack',
    ]);
  });

  it('refuses a product with no category, as catalog does', async () => {
    await boot('/items');

    await expect(
      TestBed.inject(RESOURCE_GATEWAYS)
        .for<Wire.CatalogItemView>(itemSource())
        .update('it_milk_1l', { categoryIds: [] })
    ).rejects.toMatchObject({
      code: 'item_needs_a_category',
    } satisfies Partial<GatewayError>);
  });
});

describe('toBatchAnswer', () => {
  it('reads the products in order, and nothing out of a body that is not one', () => {
    expect(toBatchAnswer({ items: [{ id: 'a' }, null, { id: 'b' }] })).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(toBatchAnswer('nope')).toEqual([]);
  });
});
