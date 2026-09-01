import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_SERVICE,
  fakeItemNames,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeShoppingProfileStore,
  fakeZoneStore,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  provideFakeShoppingProfileStore,
  provideFakeZoneStore,
  type FakeItemNames,
  type FakeLineStore,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import {
  SUGGEST_DEBOUNCE_MS,
  type CatalogItem,
  type CatalogServiceI,
  type CatalogSuggestion,
  type Line,
  type LineSettlement,
  type ListPermission,
  type MyZone,
  type ShoppingListSummary,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { LinePage } from './line-page';

/**
 * The page, at the DOM, for what velista plan `0047` put on it.
 *
 * Three of the four are things that were drawn and inert: the add chip that was not a
 * control, the "show more" that no value could reach, and the names that came from a
 * fixture. The fourth is `alsoOn`, which is now absent rather than empty and is
 * asserted by its absence.
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const ME = 'user-me';

const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

const MILK: CatalogItem = {
  id: 'item-milk-a',
  name: { es: 'Leche entera', en: 'Whole milk' },
  brand: 'Hacendado',
  productGroupId: null,
};

const OAT: CatalogItem = {
  id: 'item-oat',
  name: { es: 'Bebida de avena', en: 'Oat drink' },
  brand: 'Oatly',
  productGroupId: null,
};

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 2,
    itemIds: ['item-milk-a'],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function list(
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 1,
    wantedCount: 1,
    myPermissions: ADMIN,
    ...overrides,
  };
}

function zone(): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    role: 'OWNER',
    status: 'APPROVED',
    memberCount: 2,
    listCount: 1,
  };
}

function bought(id: string): LineSettlement {
  return {
    id,
    lineId: LINE_ID,
    listId: LIST_ID,
    outcome: 'BOUGHT',
    quantity: 1,
    itemId: null,
    settledByUserId: ME,
    settledAt: new Date('2026-08-30T10:00:00.000Z'),
  };
}

/** A catalog that answers one fixed suggestion, so a spec can choose from the list. */
function catalogOffering(
  suggestions: readonly CatalogSuggestion[]
): CatalogServiceI {
  return {
    suggest: jest.fn().mockResolvedValue(suggestions),
    itemsByIds: jest.fn().mockResolvedValue([]),
  };
}

interface Options {
  readonly lines?: readonly Line[];
  readonly list?: ShoppingListSummary;
  readonly itemNames?: FakeItemNames;
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly itemSettlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly moreSettlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly moreItemSettlements?: Readonly<
    Record<string, readonly LineSettlement[]>
  >;
  readonly catalog?: CatalogServiceI;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LinePage>;
  lines: FakeLineStore;
  catalog: CatalogServiceI;
  profiles: FakeShoppingProfileStore;
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: 'loaded',
    settlements: options.settlements ?? { [LINE_ID]: [] },
    itemSettlements: options.itemSettlements ?? { [LINE_ID]: [] },
    moreSettlements: options.moreSettlements,
    moreItemSettlements: options.moreItemSettlements,
  });
  const catalog = options.catalog ?? catalogOffering([]);
  const profiles = fakeShoppingProfileStore();
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [LinePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      provideFakeListStore(
        fakeListStore({ lists: [options.list ?? list()], state: 'loaded' })
      ),
      provideFakeZoneStore(fakeZoneStore({ zones: [zone()] })),
      provideFakeMemberNames(fakeMemberNames({})),
      provideFakeItemNames(
        options.itemNames ?? fakeItemNames({ items: [MILK] })
      ),
      provideFakeShoppingProfileStore(profiles),
      provideFakeSessionStore('REGISTERED'),
      { provide: CATALOG_SERVICE, useValue: catalog },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LinePage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines, catalog, profiles };
}

const textOf = (fixture: ComponentFixture<LinePage>): string =>
  fixture.nativeElement.textContent ?? '';

/** The one button whose text is the given key. Keys, because the translator emits them. */
function buttonWith(
  fixture: ComponentFixture<LinePage>,
  key: string
): HTMLButtonElement | null {
  return (
    fixture.debugElement
      .queryAll(By.css('button'))
      .map((element) => element.nativeElement as HTMLButtonElement)
      .find((element) => (element.textContent ?? '').includes(key)) ?? null
  );
}

describe('LinePage', () => {
  describe('the product names', () => {
    it('come from the service, as one request for the set', async () => {
      const { fixture } = await render();

      expect(fixture.componentInstance.page()?.products[0].name).toBe(
        'Whole milk'
      );
    });

    it('report a failure as a failure, never as the line having none', async () => {
      const { fixture } = await render({
        itemNames: fakeItemNames({ items: [], failed: ['item-milk-a'] }),
      });

      const text = textOf(fixture);
      expect(text).toContain('list.detail.namesFailed');
      // The chip is drawn as unnamed rather than as the "no products" sentence, which
      // is what the chip used to say about a product it was displaying.
      expect(text).toContain('list.detail.unnamedProduct');
      expect(fixture.componentInstance.page()?.products).toHaveLength(1);
    });
  });

  describe('adding a product', () => {
    it('offers a control rather than a decoration', async () => {
      const { fixture } = await render();

      const add = buttonWith(fixture, 'list.page.addProduct');
      expect(add).not.toBeNull();
    });

    it('does not offer it to somebody who may not edit', async () => {
      const { fixture } = await render({
        list: list({ myPermissions: ['READ'] }),
      });

      expect(buttonWith(fixture, 'list.page.addProduct')).toBeNull();
    });

    it('searches the catalog, scoped to the active profile', async () => {
      jest.useFakeTimers();
      try {
        const catalog = catalogOffering([{ kind: 'item', item: OAT }]);
        const { fixture } = await render({ catalog });

        fixture.componentInstance.startAdding();
        fixture.detectChanges();

        const field = fixture.debugElement.query(By.css('.search-field'))
          .nativeElement as HTMLInputElement;
        field.value = 'oat';
        field.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        jest.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);

        // The scope rule (section 3): the profile's id is passed, and the fake store's
        // default profile is what resolves.
        expect(catalog.suggest).toHaveBeenCalledWith('oat', {
          profileId: expect.any(String),
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('attaches what was chosen, unioned onto the set the line already has', async () => {
      const { fixture, lines } = await render();

      await fixture.componentInstance.addProduct({ kind: 'item', item: OAT });

      expect(lines.calls).toContainEqual({
        kind: 'update',
        lineId: LINE_ID,
        itemIds: ['item-milk-a', 'item-oat'],
      });
      expect(lines.linesIn(LIST_ID)[0].itemIds).toEqual([
        'item-milk-a',
        'item-oat',
      ]);
    });

    it('attaches a whole group, as the composer does', async () => {
      const { fixture, lines } = await render();

      await fixture.componentInstance.addProduct({
        kind: 'group',
        group: {
          id: 'group-milk',
          name: { es: 'Leche', en: 'Milk' },
          itemCount: 2,
        },
        itemIds: ['item-milk-a', 'item-oat'],
      });

      // `item-milk-a` was already there and is not duplicated: the set is a set.
      expect(lines.linesIn(LIST_ID)[0].itemIds).toEqual([
        'item-milk-a',
        'item-oat',
      ]);
    });

    it('writes nothing when the product is already on the line', async () => {
      const { fixture, lines } = await render();

      await fixture.componentInstance.addProduct({ kind: 'item', item: MILK });

      expect(lines.calls).toEqual([]);
    });
  });

  describe('paging the histories', () => {
    it('offers no further page when the store holds the whole history', async () => {
      const { fixture } = await render({
        settlements: { [LINE_ID]: [bought('st-1')] },
      });

      expect(buttonWith(fixture, 'list.page.more')).toBeNull();
    });

    it('appends the next page rather than replacing what is drawn', async () => {
      // The rule that makes a history's "show more" correct rather than merely present
      // (section 4): the recent rows are the ones somebody opened a history for.
      const { fixture, lines } = await render({
        settlements: { [LINE_ID]: [bought('st-1')] },
        moreSettlements: { [LINE_ID]: [bought('st-2')] },
      });

      const more = buttonWith(fixture, 'list.page.more');
      expect(more).not.toBeNull();

      more?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(lines.calls).toContainEqual({
        kind: 'moreSettlements',
        lineId: LINE_ID,
      });
      expect(fixture.componentInstance.page()?.thisList.rows).toHaveLength(2);
      // And the control goes when the history is exhausted.
      expect(buttonWith(fixture, 'list.page.more')).toBeNull();
    });

    it('pages the cross list history by asking again, not by slicing', async () => {
      // Asking again is what applies the read access filter per page, which is the
      // backend's rule and cannot be satisfied by paging a snapshot.
      const { fixture, lines } = await render({
        itemSettlements: { [LINE_ID]: [bought('st-a')] },
        moreItemSettlements: { [LINE_ID]: [bought('st-b')] },
      });

      buttonWith(fixture, 'list.page.more')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(lines.calls).toContainEqual({
        kind: 'moreItemSettlements',
        lineId: LINE_ID,
      });
      expect(fixture.componentInstance.page()?.everywhere?.rows).toHaveLength(2);
    });
  });

  it('omits alsoOn entirely while nothing can answer it', async () => {
    // Omitted rather than drawn empty (section 5). Drawn empty, "no other list has
    // this" and "nobody asked" are the same picture.
    const { fixture } = await render();

    expect(fixture.componentInstance.page()?.alsoOn).toBeNull();
    expect(textOf(fixture)).not.toContain('list.page.alsoOn');
  });
});
