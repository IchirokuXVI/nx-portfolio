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
  provideSections,
  RecordPage,
  RecordView,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { categorySource, itemSource } from './catalog-sources';
import {
  ProductCategoriesBatch,
  toBatchAnswer,
} from './product-categories-batch';
import { CategoriesPage } from './products/categories-page';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products/products-routes';
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

/** The Products section, as the app declares it (admin plan 0043). */
const SECTION: AdminSection = {
  key: 'products',
  label: '',
  segment: PRODUCTS_SEGMENT,
  held: PRODUCT_RESOURCES,
  heldTabs: true,
  screens: productsRoutes(),
};

async function boot(url: string) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideSections(SECTION),
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
    const { fixture, batch } = await boot('/products');
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
    const { fixture, batch } = await boot('/products');
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
    const { fixture, batch } = await boot('/products');
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
    const { fixture } = await boot('/products');
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
    await boot('/products');

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
  /** Admin plan 0043, target 5: the two levels, drawn as the tree they are. */
  it('draws the two levels as a tree, each with its handle and product count', async () => {
    const { fixture } = await boot('/products/categories');
    const page = fixture.debugElement.query(By.directive(CategoriesPage))
      .componentInstance as CategoriesPage;

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Eggs, milk, and butter');
    expect(text).toContain('uncategorised');

    const root = page
      .shown()
      .find((node) => node.id === 'cat_eggs-milk-and-butter');
    expect(root?.children.map((child) => child.id)).toContain('cat_milk');
    // A top level category is one row, and the ones inside it are under it.
    expect(all(fixture, '.row.root').length).toBe(page.shown().length);
    expect(all(fixture, '.row.child').length).toBe(
      page.shown().reduce((sum, node) => sum + node.children.length, 0)
    );
    expect(all(fixture, '.row.child').length).toBeGreaterThan(5);
    // No category sits a third level down.
    expect(
      page.shown().flatMap((node) => node.children.flatMap((c) => c.children))
    ).toEqual([]);
  });

  it('opens the product list narrowed to a category from its count', async () => {
    const { fixture } = await boot('/products/categories');

    const milk = q(fixture, '[data-category="cat_milk"]')?.closest('.row');
    const count = milk?.querySelector('[data-category-count]');

    expect(count?.textContent?.trim()).toBe('2');
    expect(count?.getAttribute('href')).toBe('/products?categoryId=cat_milk');
  });

  it('narrows the tree by what is typed, keeping the category a match is inside', async () => {
    const { fixture } = await boot('/products/categories');
    const page = fixture.debugElement.query(By.directive(CategoriesPage))
      .componentInstance as CategoriesPage;

    page.term.set('milk');
    await settle(fixture);

    const shown = page.shown();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(page.tree.nodes().length);
    for (const root of shown) {
      const own = `${root.name} ${root.row.slug}`.toLowerCase();
      expect(
        own.includes('milk') ||
          root.children.every((child) =>
            `${child.name} ${child.row.slug}`.toLowerCase().includes('milk')
          )
      ).toBe(true);
    }

    page.term.set('no such category');
    await settle(fixture);
    expect(page.shown()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'resource.list.noMatch'
    );
  });

  it('closes and opens a top level category', async () => {
    const { fixture } = await boot('/products/categories');
    const before = all(fixture, '.row.child').length;

    await click(fixture, '.row.root button.twist');

    expect(all(fixture, '.row.child').length).toBeLessThan(before);
  });

  it('opens a category to be read, and the page that adds a new one', async () => {
    const { fixture } = await boot('/products/categories');
    const router = TestBed.inject(Router);

    await click(fixture, '[data-category="cat_milk"]');
    expect(router.url).toBe('/products/categories/cat_milk');
    expect(fixture.debugElement.query(By.directive(RecordPage))).not.toBeNull();
    // A record opens to be read (admin plan 0053): no control on the page.
    expect(
      fixture.nativeElement.querySelector(
        'lib-record-view input, lib-record-view select, lib-record-view textarea'
      )
    ).toBeNull();

    await router.navigateByUrl('/products/categories');
    await settle(fixture);
    await click(fixture, 'lib-page-header button.primary');
    expect(router.url).toBe('/products/categories/new');
  });

  /** A third level is said under the parent, not at the foot of the form. */
  it('says a third level under the parent it is about', async () => {
    const { fixture } = await boot('/products/categories/new');
    const page = fixture.debugElement.query(By.directive(RecordPage))
      .componentInstance as RecordPage;
    const view = fixture.debugElement.query(By.directive(RecordView))
      .componentInstance as RecordView;
    const store = page.store();

    store.set('name', { en: 'Tubs', es: 'Tarrinas' });
    store.set('slug', 'tubs');
    store.set('parentId', 'cat_ice-creams-and-ice');
    await store.submit();
    await settle(fixture);

    expect(view.messages()['parentId']).toEqual([
      { kind: 'key', key: 'resource.error.categoryTooDeep' },
    ]);
    // Said under the field, so not above the sections as well.
    expect(view.shownRefusal()).toBeNull();
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });
  });

  it('refuses to delete a category holding products, and links to them', async () => {
    const { fixture } = await boot('/products/categories');
    const row = q(fixture, '[data-category="cat_milk"]')?.closest('.row');
    expect(row).not.toBeNull();

    (
      row?.querySelector('[data-category-delete]') as HTMLButtonElement | null
    )?.click();
    await settle(fixture);
    await click(fixture, 'lib-confirm-dialog .controls button:first-child');

    const refusal = q(fixture, '[data-refusal]');
    expect(refusal?.textContent).toContain('resource.error.categoryInUse');
    const link = refusal?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/products?categoryId=cat_milk');
    // Still there.
    await expect(
      TestBed.inject(RESOURCE_GATEWAYS)
        .for<Wire.CatalogCategoryView>(categorySource())
        .read('cat_milk')
    ).resolves.toMatchObject({ slug: 'milk' });
  });

  it('opens the product list already filtered by the category it links to', async () => {
    const { fixture } = await boot('/products?categoryId=cat_milk');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Whole milk 1 L');
    expect(text).not.toContain('Dishwashing liquid');
  });

  it('narrows the products by a root to every product under its children', async () => {
    await boot('/products');
    const page = await TestBed.inject(RESOURCE_GATEWAYS)
      .for<Wire.CatalogItemView>(itemSource())
      .list({ filters: { categoryId: 'cat_eggs-milk-and-butter' } });

    expect(page.items.map((item) => item.id)).toEqual([
      'it_milk_1l',
      'it_milk_6pack',
    ]);
  });

  it('refuses a product with no category, as catalog does', async () => {
    await boot('/products');

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
