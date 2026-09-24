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
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { itemSource } from './catalog-sources';
import { ITEMS } from './items';
import {
  ProductGroupAssignments,
  toGroupAssignmentAnswer,
} from './product-group-assignments';
import { ProductGroupDetailPage } from './product-group-detail-page';
import { PRODUCT_GROUPS } from './product-groups';
import { SetGroupPanel } from './set-group-panel';

/**
 * Moving many products into a group, rendered (admin plan 0035, section 2).
 *
 * Both ways in run against the in memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so a move really moves a row of the item table and the
 * refusal really comes from a product that changed after the review. The
 * assignment service is spied rather than replaced, so a spec can prove that a
 * tick alone sends nothing and still let the press go through.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [ITEMS, PRODUCT_GROUPS];
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

  const assign = jest.spyOn(TestBed.inject(ProductGroupAssignments), 'assign');
  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return { fixture, assign };
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

/** The memory item table, as the gateway holds it now. */
async function itemsNow(): Promise<readonly Wire.CatalogItemView[]> {
  const page = await TestBed.inject(RESOURCE_GATEWAYS)
    .for<Wire.CatalogItemView>(itemSource())
    .list({ limit: 100 });
  return page.items;
}

async function groupOf(itemId: string): Promise<string | null> {
  return (
    (await itemsNow()).find((item) => item.id === itemId)?.productGroupId ??
    null
  );
}

describe('Add items on a product group', () => {
  it('opens on the ungrouped products, and a tick sends nothing', async () => {
    const { fixture, assign } = await boot('/product-groups/pg_olive_oil');

    // The generic form is still the top of the screen.
    expect(
      fixture.debugElement.query(By.directive(ProductGroupDetailPage))
    ).not.toBeNull();
    expect(q(fixture, 'lib-resource-form-page')).not.toBeNull();

    await click(fixture, '[data-add-items-open]');
    await settle(fixture, 300);

    const boxes = all(fixture, '[data-pick-item]');
    // `it_dish_soap` is the one product in no group in the seed.
    expect(boxes).toHaveLength(1);
    await tick(fixture, boxes[0]);

    expect(q(fixture, '[data-add-review]')?.hasAttribute('disabled')).toBe(
      false
    );
    expect(assign).not.toHaveBeenCalled();
    expect(await groupOf('it_dish_soap')).toBeNull();
  });

  it('moves the ticked products after the review, and says so per product', async () => {
    const { fixture, assign } = await boot('/product-groups/pg_olive_oil');
    await click(fixture, '[data-add-items-open]');
    await settle(fixture, 300);
    await tick(fixture, all(fixture, '[data-pick-item]')[0]);

    await click(fixture, '[data-add-review]');
    // The review names the product and where it is going, and has sent nothing.
    expect(q(fixture, '[data-review-item="it_dish_soap"]')).not.toBeNull();
    expect(assign).not.toHaveBeenCalled();

    await click(fixture, '[data-assign]');

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith([
      {
        itemId: 'it_dish_soap',
        groupId: 'pg_olive_oil',
        expectedGroupId: null,
      },
    ]);
    expect(await groupOf('it_dish_soap')).toBe('pg_olive_oil');
    expect(
      all(fixture, '[data-assign-result] li').map((li) =>
        li.getAttribute('data-outcome')
      )
    ).toEqual(['moved']);
  });

  it('refuses the whole request when a product moved after the review', async () => {
    const { fixture } = await boot('/product-groups/pg_olive_oil');
    await click(fixture, '[data-add-items-open]');
    await settle(fixture, 300);
    await tick(fixture, all(fixture, '[data-pick-item]')[0]);
    await click(fixture, '[data-add-review]');

    // Somebody else puts it in a group between the review and the press.
    await TestBed.inject(RESOURCE_GATEWAYS)
      .for<Wire.CatalogItemView>(itemSource())
      .update('it_dish_soap', { productGroupId: 'pg_whole_milk' });

    await click(fixture, '[data-assign]');

    const lines = all(fixture, '[data-assign-result] li');
    expect(lines.map((li) => li.getAttribute('data-outcome'))).toEqual([
      'refused',
    ]);
    expect(lines[0].textContent).toContain(
      'catalog.productGroups.assign.error.EXPECT_MISMATCH'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'catalog.productGroups.assign.refused'
    );
    // Nothing moved it back.
    expect(await groupOf('it_dish_soap')).toBe('pg_whole_milk');

    // Done keeps the tick, because the refusal said which product stopped it.
    await click(fixture, '[data-close]');
    expect(q(fixture, '[data-add-review]')).not.toBeNull();
  });
});

describe('Set group on the product list', () => {
  it('draws a tick box per row, and a tick sends nothing', async () => {
    const { fixture, assign } = await boot('/items');

    const boxes = all(fixture, '[data-pick-row]');
    expect(boxes.length).toBe(4);
    expect(q(fixture, '[data-bulk="setGroup"]')?.hasAttribute('disabled')).toBe(
      true
    );

    await tick(fixture, boxes[0]);
    await tick(fixture, boxes[3]);

    expect(q(fixture, '[data-bulk="setGroup"]')?.hasAttribute('disabled')).toBe(
      false
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('chooses a group, reviews, and moves every ticked row', async () => {
    const { fixture, assign } = await boot('/items');
    const boxes = all(fixture, '[data-pick-row]');
    // Whole milk 1 L (in whole milk) and the dish soap (in none).
    await tick(fixture, boxes[0]);
    await tick(fixture, boxes[3]);

    await click(fixture, '[data-bulk="setGroup"]');
    const panel = fixture.debugElement.query(By.directive(SetGroupPanel))
      .componentInstance as SetGroupPanel;
    await panel.choose('pg_olive_oil');
    await settle(fixture);

    await click(fixture, '[data-set-group-review]');
    expect(all(fixture, '[data-review-item]')).toHaveLength(2);
    expect(assign).not.toHaveBeenCalled();

    await click(fixture, '[data-assign]');

    expect(assign).toHaveBeenCalledWith([
      {
        itemId: 'it_milk_1l',
        groupId: 'pg_olive_oil',
        expectedGroupId: 'pg_whole_milk',
      },
      {
        itemId: 'it_dish_soap',
        groupId: 'pg_olive_oil',
        expectedGroupId: null,
      },
    ]);
    expect(await groupOf('it_milk_1l')).toBe('pg_olive_oil');
    expect(await groupOf('it_dish_soap')).toBe('pg_olive_oil');

    // Done closes the panel, clears the ticks and reads the page again.
    await click(fixture, '[data-close]');
    await settle(fixture);
    expect(q(fixture, 'lib-set-group-panel')).toBeNull();
    expect(
      all(fixture, '[data-pick-row]').filter(
        (box) => (box as HTMLInputElement).checked
      )
    ).toHaveLength(0);
  });

  it('leaves out a product already in the chosen group', async () => {
    const { fixture, assign } = await boot('/items');
    const boxes = all(fixture, '[data-pick-row]');
    await tick(fixture, boxes[0]);

    await click(fixture, '[data-bulk="setGroup"]');
    const panel = fixture.debugElement.query(By.directive(SetGroupPanel))
      .componentInstance as SetGroupPanel;
    await panel.choose('pg_whole_milk');
    await settle(fixture);
    await click(fixture, '[data-set-group-review]');

    expect(fixture.nativeElement.textContent).toContain(
      'catalog.productGroups.assign.alreadyIn'
    );
    expect(q(fixture, '[data-assign]')?.hasAttribute('disabled')).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the ticks when the panel is cancelled', async () => {
    const { fixture, assign } = await boot('/items');
    await tick(fixture, all(fixture, '[data-pick-row]')[1]);

    await click(fixture, '[data-bulk="setGroup"]');
    await click(fixture, '[data-set-group-cancel]');

    expect(q(fixture, 'lib-set-group-panel')).toBeNull();
    expect(
      (all(fixture, '[data-pick-row]')[1] as HTMLInputElement).checked
    ).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('toGroupAssignmentAnswer', () => {
  const sent = [
    { itemId: 'a', groupId: 'g', expectedGroupId: null },
    { itemId: 'b', groupId: 'g', expectedGroupId: 'h' },
  ];

  it('marks the failing line and never claims a move on a refusal', () => {
    const answer = toGroupAssignmentAnswer(
      {
        applied: false,
        error: null,
        results: [
          { op: 'assignItem', itemId: 'a', applied: true, error: null },
          {
            op: 'assignItem',
            itemId: 'b',
            applied: false,
            error: { code: 'EXPECT_MISMATCH', detail: 'b moved' },
          },
        ],
        createdGroups: [],
      },
      sent
    );

    expect(answer.applied).toBe(false);
    expect(answer.results.map((line) => line.applied)).toEqual([false, false]);
    expect(answer.results[1].error).toEqual({
      code: 'EXPECT_MISMATCH',
      detail: 'b moved',
    });
  });

  it('reads an unknown code as UNKNOWN and a missing line as not applied', () => {
    const answer = toGroupAssignmentAnswer(
      {
        applied: true,
        results: [
          {
            itemId: 'a',
            applied: true,
            error: { code: 'SOMETHING_NEW', detail: '' },
          },
        ],
      },
      sent
    );

    expect(answer.results[0].error?.code).toBe('UNKNOWN');
    expect(answer.results[1]).toEqual({
      itemId: 'b',
      applied: false,
      error: null,
    });
  });
});
