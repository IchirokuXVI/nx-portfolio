import { signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_SERVICE,
  type CatalogServiceI,
  fakeGroupMembers,
  fakeGroupNames,
  fakeItemNames,
  fakeLineStore,
  type FakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeShoppingProfileStore,
  fakeZoneStore,
  provideFakeGroupMembers,
  provideFakeGroupNames,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  provideFakeShoppingProfileStore,
  provideFakeZoneStore,
} from '@portfolio/velista/data-access';
import {
  type CatalogItem,
  type CatalogSuggestion,
  type Line,
  LINE_ITEM_SET_MAX,
  type LineSettlement,
  type ListPermission,
  type MyZone,
  type ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { LineHistoryPage } from '../line-history-page/line-history-page';
import { LineProductsPage } from './line-products-page';

/**
 * The two pages under a line, at the DOM (velista `0135`, sections 3 and 5).
 *
 * The products page holds the search, the adopt and the remove that the line
 * page had. Their rules did not change when they moved, and these specs are what
 * says so.
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const LINE_URL = `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/lines/${LINE_ID}`;
const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal', 'classic'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 2,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: 'user-me',
    approvedByUserId: 'user-me',
    version: 1,
    ...overrides,
  };
}

function item(id: string, en: string): CatalogItem {
  return {
    id,
    name: { en, es: '' },
    brand: 'Deliplus',
    size: 400,
    unit: 'MILLILITER',
    productGroupId: null,
    categories: [],
    offer: null,
    chainPrices: [],
    imageUrl: null,
    unitBasis: 'LITER',
  } as unknown as CatalogItem;
}

const NORMAL = item('normal', 'Shampoo for normal hair');
const CLASSIC = item('classic', 'Classic care shampoo');
const DANDRUFF = item('dandruff', 'Anti dandruff shampoo');

function bought(id: string, daysAgo: number): LineSettlement {
  return {
    id,
    lineId: LINE_ID,
    listId: LIST_ID,
    itemId: 'normal',
    outcome: 'BOUGHT',
    quantity: 1,
    settledByUserId: 'user-me',
    settledAt: new Date(Date.now() - daysAgo * 86_400_000),
    revertedAt: null,
    unitPriceCents: 215,
    currency: 'EUR',
  } as LineSettlement;
}

interface Options {
  readonly lines?: readonly Line[];
  readonly permissions?: readonly ListPermission[];
  readonly suggestions?: readonly CatalogSuggestion[];
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly moreSettlements?: Readonly<
    Record<string, readonly LineSettlement[]>
  >;
}

async function render<T>(
  component: Type<T>,
  options: Options = {}
): Promise<{
  fixture: ComponentFixture<T>;
  lines: FakeLineStore;
  pages: { back: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: 'loaded',
    settlements: options.settlements ?? { [LINE_ID]: [] },
    moreSettlements: options.moreSettlements,
  });
  const pages = { back: jest.fn().mockResolvedValue(undefined) };
  const catalog: CatalogServiceI = {
    suggest: jest.fn().mockResolvedValue(options.suggestions ?? []),
    itemsByIds: jest.fn().mockResolvedValue([]),
  } as unknown as CatalogServiceI;
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      provideFakeListStore(
        fakeListStore({
          lists: [
            {
              id: LIST_ID,
              zoneId: ZONE_ID,
              name: 'Weekly shop',
              createdByUserId: 'user-me',
              autoApproveLines: false,
              lineCount: 1,
              wantedCount: 1,
              myPermissions: options.permissions ?? ADMIN,
            } as ShoppingListSummary,
          ],
          state: 'loaded',
        })
      ),
      provideFakeZoneStore(
        fakeZoneStore({
          zones: [
            {
              id: ZONE_ID,
              name: 'Home',
              role: 'OWNER',
              status: 'APPROVED',
              memberCount: 2,
              listCount: 1,
            } as MyZone,
          ],
        })
      ),
      provideFakeMemberNames(fakeMemberNames({})),
      provideFakeItemNames(
        fakeItemNames({ items: [NORMAL, CLASSIC, DANDRUFF] })
      ),
      provideFakeGroupMembers(fakeGroupMembers()),
      provideFakeGroupNames(fakeGroupNames({ groups: [] })),
      provideFakeShoppingProfileStore(fakeShoppingProfileStore()),
      provideFakeSessionStore('REGISTERED'),
      { provide: CATALOG_SERVICE, useValue: catalog },
      { provide: PageNavigation, useValue: pages },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(component);
  await drain(fixture);

  return { fixture, lines, pages };
}

async function drain<T>(fixture: ComponentFixture<T>): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    fixture.detectChanges();
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  }
  fixture.detectChanges();
}

const textOf = <T>(fixture: ComponentFixture<T>): string =>
  fixture.nativeElement.textContent ?? '';

const updates = (lines: FakeLineStore) =>
  lines.calls.filter((call) => call.kind === 'update');

function buttonWith<T>(
  fixture: ComponentFixture<T>,
  key: string
): HTMLButtonElement | null {
  return (
    fixture.debugElement
      .queryAll(By.css('button'))
      .map((element) => element.nativeElement as HTMLButtonElement)
      .find((element) => (element.textContent ?? '').includes(key)) ?? null
  );
}

const product = (catalogItem: CatalogItem): CatalogSuggestion =>
  ({ kind: 'item', item: catalogItem }) as CatalogSuggestion;

describe('LineProductsPage', () => {
  it('lists the products of the line under a field that is not focused', async () => {
    const { fixture } = await render(LineProductsPage);
    const field = fixture.nativeElement.querySelector(
      '#line-product-search'
    ) as HTMLInputElement;

    expect(textOf(fixture)).toContain('Shampoo for normal hair');
    expect(textOf(fixture)).toContain('Classic care shampoo');
    expect(field).not.toBeNull();
    expect(document.activeElement).not.toBe(field);
    expect(
      fixture.nativeElement.querySelector('label[for="line-product-search"]')
    ).not.toBeNull();
  });

  it('goes back to the line page', async () => {
    const { fixture, pages } = await render(LineProductsPage);

    await fixture.componentInstance.back();

    expect(pages.back).toHaveBeenCalledWith(LINE_URL);
  });

  it('adds a product to the set, and never replaces the set', async () => {
    const { fixture, lines } = await render(LineProductsPage);

    await fixture.componentInstance.addProduct(product(DANDRUFF));

    expect(updates(lines)).toEqual([
      {
        kind: 'update',
        lineId: LINE_ID,
        itemIds: ['normal', 'classic', 'dandruff'],
      },
    ]);
  });

  it('sends nothing for a product the line already holds', async () => {
    const { fixture, lines } = await render(LineProductsPage);

    await fixture.componentInstance.addProduct(product(NORMAL));

    expect(updates(lines)).toEqual([]);
  });

  it('refuses an add over the cap before anything is sent, and says the numbers', async () => {
    const full = Array.from(
      { length: LINE_ITEM_SET_MAX },
      (_, index) => `item-${index}`
    );
    const { fixture, lines } = await render(LineProductsPage, {
      lines: [line({ itemIds: full })],
    });

    await fixture.componentInstance.addProduct(product(DANDRUFF));
    await drain(fixture);

    expect(updates(lines)).toEqual([]);
    expect(fixture.componentInstance.productsFull()).toEqual({
      key: 'list.products.full.one',
      args: { count: LINE_ITEM_SET_MAX, cap: LINE_ITEM_SET_MAX },
    });
    expect(fixture.nativeElement.querySelector('.full')).not.toBeNull();
  });

  it('removes one product by writing the set without it', async () => {
    const { fixture, lines } = await render(LineProductsPage);

    await fixture.componentInstance.removeProduct('normal');

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, itemIds: ['classic'] },
    ]);
  });

  it('keeps a product the catalog put there with adoptItemIds and nothing else', async () => {
    const { fixture, lines } = await render(LineProductsPage, {
      lines: [
        line({ productGroupId: 'group-1', groupItemIds: ['classic'] }),
      ],
    });

    expect(buttonWith(fixture, 'list.products.keep')).not.toBeNull();
    await fixture.componentInstance.adoptProduct('classic');
    // A product the person already owns has nothing to adopt.
    await fixture.componentInstance.adoptProduct('normal');

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, adoptItemIds: ['classic'] },
    ]);
  });

  it('sets the favourite from the star of a row, and clears it from the same star', async () => {
    const { fixture, lines } = await render(LineProductsPage, {
      lines: [line({ favoriteItemId: 'normal' })],
    });
    const stars = fixture.debugElement
      .queryAll(By.css('button.star'))
      .map((element) => element.nativeElement as HTMLButtonElement);

    expect(stars.map((star) => star.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);

    stars[1].click();
    await drain(fixture);
    stars[0].click();
    await drain(fixture);

    expect(updates(lines)).toEqual([
      { kind: 'update', lineId: LINE_ID, favoriteItemId: 'classic' },
      // The fake store applied the first write, so the first star is now empty
      // and a press on it sets the favourite again.
      { kind: 'update', lineId: LINE_ID, favoriteItemId: 'normal' },
    ]);
  });

  it('draws no field and no controls for a reader', async () => {
    const { fixture } = await render(LineProductsPage, {
      permissions: ['READ'],
      lines: [line({ favoriteItemId: 'normal' })],
    });

    expect(
      fixture.nativeElement.querySelector('#line-product-search')
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelectorAll('.star.is-mark')
    ).toHaveLength(1);
  });
});

describe('LineHistoryPage', () => {
  it('reads the history of the line and draws its rows under a month', async () => {
    const { fixture } = await render(LineHistoryPage, {
      settlements: { [LINE_ID]: [bought('st-1', 1), bought('st-2', 2)] },
    });

    expect(
      fixture.nativeElement.querySelectorAll('.card .row').length
    ).toBe(2);
    expect(textOf(fixture)).toContain('list.history.bought');
    expect(textOf(fixture)).toContain('Shampoo for normal hair · Deliplus');
    expect(textOf(fixture)).toContain('list.history.lastPaid');
  });

  it('says one sentence with nothing bought', async () => {
    const { fixture } = await render(LineHistoryPage);

    expect(textOf(fixture)).toContain('list.history.empty');
    expect(fixture.nativeElement.querySelector('.facts')).toBeNull();
  });

  it('offers both scopes on a line with products, and reads the second when chosen', async () => {
    const { fixture } = await render(LineHistoryPage);
    const scopes = fixture.debugElement
      .queryAll(By.css('.scope'))
      .map((element) => element.nativeElement as HTMLButtonElement);

    expect(scopes.map((scope) => scope.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);

    scopes[1].click();
    await drain(fixture);

    expect(fixture.componentInstance.scope()).toBe('everywhere');
  });

  it('has no scope control on a line of free text', async () => {
    const { fixture } = await render(LineHistoryPage, {
      lines: [line({ itemIds: [] })],
    });

    expect(fixture.nativeElement.querySelector('.scopes')).toBeNull();
  });

  it('appends an older page from Show older', async () => {
    const { fixture, lines } = await render(LineHistoryPage, {
      settlements: { [LINE_ID]: [bought('st-1', 1)] },
      moreSettlements: { [LINE_ID]: [bought('st-2', 40)] },
    });

    buttonWith(fixture, 'list.history.older')?.click();
    await drain(fixture);

    expect(lines.calls).toContainEqual({
      kind: 'moreSettlements',
      lineId: LINE_ID,
    });
  });

  it('goes back to the line page', async () => {
    const { fixture, pages } = await render(LineHistoryPage);

    await fixture.componentInstance.back();

    expect(pages.back).toHaveBeenCalledWith(LINE_URL);
  });
});
