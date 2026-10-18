import { signal, type Type } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
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
  GatewayError,
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
  type Line,
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
import { LineHistoryPage } from './line-history-page';

/**
 * The history page of a line, at the DOM (velista `0135`, section 5).
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
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly moreSettlements?: Readonly<
    Record<string, readonly LineSettlement[]>
  >;
  readonly linesState?: 'idle' | 'loading' | 'loaded' | 'failed';
  /** What the read of the lines failed with, beside `linesState: 'failed'`. */
  readonly linesError?: unknown;
}

async function render<T>(
  component: Type<T>,
  options: Options = {}
): Promise<{
  fixture: ComponentFixture<T>;
  lines: FakeLineStore;
  pages: { back: jest.Mock };
  router: { navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: options.linesState ?? 'loaded',
    error: options.linesError,
    settlements: options.settlements ?? { [LINE_ID]: [] },
    moreSettlements: options.moreSettlements,
  });
  const pages = { back: jest.fn().mockResolvedValue(undefined) };
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  const catalog: CatalogServiceI = {
    suggest: jest.fn().mockResolvedValue([]),
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
      { provide: Router, useValue: router },
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

  return { fixture, lines, pages, router };
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

describe('LineHistoryPage', () => {
  it('reads the history of the line and draws its rows under a month', async () => {
    const { fixture } = await render(LineHistoryPage, {
      settlements: { [LINE_ID]: [bought('st-1', 1), bought('st-2', 2)] },
    });

    expect(fixture.nativeElement.querySelectorAll('.card .row').length).toBe(2);
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

  it('says a list you cannot read is not available, with a way back to the group and no retry (velista 0156)', async () => {
    const { fixture, router } = await render(LineHistoryPage, {
      lines: [],
      linesState: 'failed',
      linesError: new GatewayError({
        code: 'forbidden',
        status: 403,
        correlationId: 'cid-403',
      }),
    });

    expect(textOf(fixture)).toContain('list.error.notAvailable');
    expect(textOf(fixture)).not.toContain('list.page.failed');
    expect(buttonWith(fixture, 'list.page.retry')).toBeNull();

    buttonWith(fixture, 'list.header.back')?.click();
    await drain(fixture);

    expect(router.navigateByUrl).toHaveBeenCalledWith(
      `/velista/en/zones/${ZONE_ID}`,
      { replaceUrl: true }
    );
  });
});
