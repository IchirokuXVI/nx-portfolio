import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeItemNames,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type FakeItemNames,
} from '@portfolio/velista/data-access';
import type {
  CatalogItem,
  Line,
  LineSettlement,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { LineDetailSheet } from './line-detail-sheet';

/**
 * The sheet, at the DOM, for the four things velista plan `0047` puts on it.
 *
 * The selector's own spec covers what the sheet **says**; this covers what reaches the
 * screen: names that came from the service rather than from a fixture, a failure that
 * is drawn as a failure and never as "no products", and the row's indicators on the
 * header.
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
  size: 1,
  unit: 'LITER',
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

function list(): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 1,
    wantedCount: 1,
    myPermissions: ADMIN,
  };
}

interface Options {
  readonly lines?: readonly Line[];
  readonly itemNames?: FakeItemNames;
  readonly settlements?: Readonly<Record<string, readonly LineSettlement[]>>;
  readonly claims?: Readonly<Record<string, string>>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LineDetailSheet>;
  itemNames: FakeItemNames;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const itemNames = options.itemNames ?? fakeItemNames({ items: [MILK] });
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [LineDetailSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(
        fakeLineStore({
          lines: options.lines ?? [line()],
          state: 'loaded',
          settlements: options.settlements ?? { [LINE_ID]: [] },
          claims: options.claims,
        })
      ),
      provideFakeListStore(fakeListStore({ lists: [list()], state: 'loaded' })),
      provideFakeMemberNames(fakeMemberNames({ 'user-ana': 'Ana' })),
      provideFakeItemNames(itemNames),
      provideFakeSessionStore('REGISTERED'),
      { provide: REALTIME_CLIENT, useValue: new RealtimeMemory() },
      { provide: SheetNavigation, useValue: sheets },
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

  const fixture = TestBed.createComponent(LineDetailSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, itemNames, sheets };
}

/**
 * What reached the DOM, as **keys**.
 *
 * The testing translator emits the key rather than a sentence and interpolates
 * nothing, so a spec asserting on English would be asserting on the translator. Every
 * question here is "was this drawn", which a key answers exactly; the one question that
 * is about a value, the product's name, is asked of the view model instead.
 */
const textOf = (fixture: ComponentFixture<LineDetailSheet>): string =>
  fixture.nativeElement.textContent ?? '';

describe('LineDetailSheet', () => {
  it('asks the service for the line products, once, as a set', async () => {
    // One request for the set rather than one per product, which is the acceptance
    // criterion the batch route exists for.
    const { itemNames } = await render({
      lines: [line({ itemIds: ['item-milk-a', 'item-milk-b'] })],
    });

    expect(itemNames.asked).toEqual([['item-milk-a', 'item-milk-b']]);
  });

  it('names the product from the service, not from a fixture', async () => {
    const { fixture } = await render();

    // The name is a value rather than a key, so it is asked of the view model: the
    // testing translator interpolates nothing, and `products.one` reaches the DOM
    // without its argument whatever the argument is.
    expect(fixture.componentInstance.detail()?.productsArgs).toEqual({
      name: 'Whole milk',
    });
  });

  it('says the names could not be loaded, and never that the line has no products', async () => {
    // The defect this plan is about, at the DOM. A failed lookup used to take the
    // template's empty branch and tell the reader their line carried nothing.
    const { fixture } = await render({
      itemNames: fakeItemNames({ items: [], failed: ['item-milk-a'] }),
    });

    const text = textOf(fixture);
    expect(text).toContain('list.detail.namesFailed');
    expect(text).not.toContain('list.page.noProducts');
    expect(text).not.toContain('list.detail.products.none');
    // The count survives the failure, because the count is a fact about the line.
    expect(text).toContain('list.detail.products.unnamed');
  });

  it('says nothing about names on a line that genuinely has no products', async () => {
    const { fixture } = await render({ lines: [line({ itemIds: [] })] });

    const text = textOf(fixture);
    expect(text).toContain('list.detail.products.none');
    expect(text).not.toContain('list.detail.namesFailed');
  });

  it('shows the same indicators as the row it opened from', async () => {
    // A settled line: at zero with a purchase on record, which is what the row draws
    // "bought" from. The header used to be passed `[]` and drew nothing at all.
    const { fixture } = await render({
      lines: [line({ quantity: 0, boughtCount: 1 })],
    });

    expect(textOf(fixture)).toContain('line.indicator.bought');
    expect(fixture.componentInstance.detail()?.indicators).toEqual(['bought']);
  });

  it('draws no indicators on an ordinary line', async () => {
    const { fixture } = await render();

    expect(textOf(fixture)).not.toContain('line.indicator.');
  });

  it('names who is out buying it, as the row does', async () => {
    const { fixture } = await render({ claims: { [LINE_ID]: 'user-ana' } });

    expect(textOf(fixture)).toContain('line.indicator.claimedBy');
    expect(fixture.componentInstance.detail()?.claimedBy).toBe('Ana');
  });

  /**
   * The way out of the sheet, and the difference between the two ways.
   *
   * `dismiss` gives back the screen underneath and pops the history to do it, so it
   * ignores the URL it is handed whenever there is something to pop. Sending the line
   * page through it therefore did not open the line page: it went back to the list,
   * which is the defect these two assert against, and it is invisible in any test that
   * only checks which URL was built.
   */
  describe('leaving it', () => {
    it('travels to the line page rather than popping back to the list', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.openPage();

      expect(sheets.leaveTo).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/lines/${LINE_ID}`
      );
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    it('still dismisses to the list, which is what cancelling means', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.dismiss();

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}`
      );
      expect(sheets.leaveTo).not.toHaveBeenCalled();
    });
  });
});
