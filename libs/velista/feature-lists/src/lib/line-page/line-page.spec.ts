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
  LINE_SERVICE,
  fakeGroupNames,
  fakeItemNames,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeShoppingProfileStore,
  fakeZoneStore,
  provideFakeGroupNames,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  provideFakeShoppingProfileStore,
  provideFakeZoneStore,
  type FakeGroupNames,
  type FakeItemNames,
  type FakeLineStore,
  type CatalogServiceI,
  type FakeShoppingProfileStore,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import {
  LINE_ITEM_SET_MAX,
  SUGGEST_DEBOUNCE_MS,
  type AlsoOnVm,
  type CatalogItem,
  type CatalogSuggestion,
  type Line,
  type LineSettlement,
  type ListPermission,
  type MyZone,
  type ProductGroup,
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
  size: 1,
  unit: 'LITER',
  productGroupId: null,
};

const OAT: CatalogItem = {
  id: 'item-oat',
  name: { es: 'Bebida de avena', en: 'Oat drink' },
  brand: 'Oatly',
  size: 1,
  unit: 'LITER',
  productGroupId: null,
};

const MILK_GROUP: ProductGroup = {
  id: 'group-milk',
  name: { es: 'Leche', en: 'Milk' },
};

/** As many product ids as asked for, for the specs about the cap. */
function items(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index}`);
}

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 2,
    itemIds: ['item-milk-a'],
    productGroupId: null,
    groupItemIds: [],
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

/**
 * The `also on` read (backend plan 0053, section 3), per product.
 *
 * A stub over the one method this page calls rather than a whole `LineMemory`: the page
 * reaches `LINE_SERVICE` directly for it, and what the specs below are about is how
 * several products' answers are merged and what happens when one does not come back.
 */
function alsoOnService(
  answers: Readonly<Record<string, AlsoOnVm | Error>> = {}
): Pick<LineServiceI, 'listsHoldingItem'> & {
  readonly asked: { itemId: string; excludeListId?: string }[];
} {
  const asked: { itemId: string; excludeListId?: string }[] = [];

  return {
    asked,
    listsHoldingItem: async (itemId, options) => {
      asked.push({ itemId, excludeListId: options?.excludeListId });
      const answer = answers[itemId];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? { places: [], hasMore: false };
    },
  };
}

interface Options {
  readonly lines?: readonly Line[];
  readonly list?: ShoppingListSummary;
  readonly alsoOn?: Readonly<Record<string, AlsoOnVm | Error>>;
  readonly itemNames?: FakeItemNames;
  readonly groupNames?: FakeGroupNames;
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
  holding: ReturnType<typeof alsoOnService>;
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
  const holding = alsoOnService(options.alsoOn);
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
      provideFakeGroupNames(
        options.groupNames ?? fakeGroupNames({ groups: [MILK_GROUP] })
      ),
      provideFakeShoppingProfileStore(profiles),
      provideFakeSessionStore('REGISTERED'),
      { provide: CATALOG_SERVICE, useValue: catalog },
      { provide: LINE_SERVICE, useValue: holding },
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

  // The "also on" read resolves through a `Promise.all` that `whenStable` does not
  // wait for in a zoneless test, so the microtask queue is drained by hand. Microtasks
  // rather than a `setTimeout`, because one spec here installs fake timers before it
  // renders and a macrotask would never fire.
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
  fixture.detectChanges();

  return { fixture, lines, catalog, profiles, holding };
}

/**
 * Let the effects wake and their promises land, after the store has been moved.
 *
 * The same hand drained microtask queue `render` finishes with, for the same reason:
 * the "also on" read resolves through a `Promise.all` that `whenStable` does not wait
 * for in a zoneless test.
 */
async function drain(fixture: ComponentFixture<LinePage>): Promise<void> {
  fixture.detectChanges();
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
  fixture.detectChanges();
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

    it('offers products and never groups, because the line is already a set of them', async () => {
      jest.useFakeTimers();
      try {
        const catalog = catalogOffering([
          {
            kind: 'group',
            group: { id: 'group-milk', name: { es: 'Leche', en: 'Milk' } },
            itemIds: ['item-milk-a', 'item-oat'],
          },
          { kind: 'item', item: OAT },
        ]);
        const { fixture } = await render({ catalog });

        fixture.componentInstance.startAdding();
        fixture.detectChanges();

        const field = fixture.debugElement.query(By.css('.search-field'))
          .nativeElement as HTMLInputElement;
        field.value = 'milk';
        field.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        jest.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);
        // The answer arrives on a microtask, which fake timers do not drive.
        await Promise.resolve();
        await Promise.resolve();

        // The group is dropped and the order of what is left is the server's: this
        // screen attaches one product at a time, and a group row here reads as a group
        // being poured into a group.
        expect(fixture.componentInstance.suggestions()).toEqual([
          { kind: 'item', item: OAT },
        ]);
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

    // Handed one directly, which the search above no longer does. The row type is the
    // catalog's union, so the case still has to be answered, and attaching the members
    // is the only answer that is not a tap doing nothing.
    it('attaches a whole group when it is given one', async () => {
      const { fixture, lines } = await render();

      await fixture.componentInstance.addProduct({
        kind: 'group',
        group: { id: 'group-milk', name: { es: 'Leche', en: 'Milk' } },
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

  /**
   * The cap, refused before the request (velista plan 0065, section 3).
   *
   * The point of every one of these is what the client does **not** send. The server
   * enforces the same rule and keeps its generic sentence, so reaching it now means a
   * second client or a stale set rather than the ordinary path.
   */
  describe('the cap', () => {
    it('refuses a group that does not fit whole, and sends nothing', async () => {
      // All or nothing, and the sentence says why: a partial fill would be the server
      // choosing which 2 of Milk's 10 land on somebody's shopping list.
      const { fixture, lines } = await render({
        lines: [line({ itemIds: items(98) })],
      });

      await fixture.componentInstance.addProduct({
        kind: 'group',
        group: MILK_GROUP,
        itemIds: items(10).map((itemId) => `${itemId}-new`),
        offer: null,
      });

      expect(lines.calls).toEqual([]);
      expect(lines.linesIn(LIST_ID)[0].itemIds).toHaveLength(98);
      // On the view model and not on rendered text: the testing translator does not
      // interpolate, so the sentence on screen is the key alone.
      expect(fixture.componentInstance.productsFull()).toEqual({
        key: 'list.page.productsFull.group',
        args: { count: 98, cap: LINE_ITEM_SET_MAX, name: 'Milk', adds: 10 },
      });
    });

    it('refuses one product on a full line, and sends nothing', async () => {
      const { fixture, lines } = await render({
        lines: [line({ itemIds: items(100) })],
      });

      await fixture.componentInstance.addProduct({ kind: 'item', item: OAT });

      expect(lines.calls).toEqual([]);
      expect(fixture.componentInstance.productsFull()).toEqual({
        key: 'list.page.productsFull.one',
        args: { count: 100, cap: LINE_ITEM_SET_MAX },
      });
    });

    it('still allows a removal from an over cap line', async () => {
      // The rule is `next.length <= max(cap, current.length)`, so a line the catalog's
      // own sync carried past 100 can be brought back under it. Written the other way
      // it would be frozen by the rule that exists to keep it under the cap.
      const { fixture, lines } = await render({
        lines: [
          line({
            itemIds: items(104),
            productGroupId: MILK_GROUP.id,
            groupItemIds: items(104),
          }),
        ],
      });

      await fixture.componentInstance.removeProduct('item-0');

      expect(lines.linesIn(LIST_ID)[0].itemIds).toHaveLength(103);
      expect(fixture.componentInstance.productsFull()).toBeNull();
    });

    it('counts the whole set against the cap without clamping either number', async () => {
      const { fixture } = await render({
        lines: [line({ itemIds: items(104) })],
      });

      expect(fixture.componentInstance.page()?.counter).toEqual({
        count: 104,
        cap: LINE_ITEM_SET_MAX,
        overCap: true,
      });
    });
  });

  /**
   * Keeping a product the catalog put there (velista plan 0065, section 4).
   *
   * The gesture is one field on the wire and one chip moving on the screen, and both
   * halves are asserted: the request carries `adoptItemIds` and nothing else, and the
   * chip is in the other cluster afterwards.
   */
  describe('keeping a product', () => {
    const subscribed = (): Line =>
      line({
        itemIds: ['item-milk-a', 'item-oat'],
        productGroupId: MILK_GROUP.id,
        groupItemIds: ['item-milk-a'],
      });

    it('sends adoptItemIds alone and moves the chip to the other cluster', async () => {
      const { fixture, lines } = await render({ lines: [subscribed()] });

      await fixture.componentInstance.adoptProduct('item-milk-a');
      await drain(fixture);

      // The field and nothing else. A set replacement that happened to keep the
      // product would be an ordinary edit, not a statement about who owns it.
      expect(lines.calls).toEqual([
        { kind: 'update', lineId: LINE_ID, adoptItemIds: ['item-milk-a'] },
      ]);

      const clusters = fixture.componentInstance.page()?.clusters;
      // One cluster left, and it is the person's: nothing is the catalog's any more.
      expect(clusters).toHaveLength(1);
      expect(clusters?.[0].headingKey).toBe('list.page.addedByYou');
      expect(
        clusters?.[0].products.map((product) => product.itemId)
      ).toEqual(['item-milk-a', 'item-oat']);
    });

    it('offers it on the catalog’s chip only, and never to a reader', async () => {
      const { fixture } = await render({ lines: [subscribed()] });

      expect(buttonWith(fixture, 'list.page.keepProduct')).not.toBeNull();

      const readOnly = await render({
        lines: [subscribed()],
        list: list({ myPermissions: ['READ'] }),
      });
      expect(buttonWith(readOnly.fixture, 'list.page.keepProduct')).toBeNull();
    });

    it('draws no control at all on a line that follows no group', async () => {
      // Every line backend `0048` created. No headings and no `Keep`: the page is
      // exactly what it was before this plan for all of them.
      const { fixture } = await render();

      expect(fixture.componentInstance.page()?.clusters).toBeNull();
      expect(buttonWith(fixture, 'list.page.keepProduct')).toBeNull();
    });

    it('sends nothing for a product the person already owns', async () => {
      // A stale frame rather than a gesture. A request for it would bump the line's
      // version to say nothing at all.
      const { fixture, lines } = await render({ lines: [subscribed()] });

      await fixture.componentInstance.adoptProduct('item-oat');

      expect(lines.calls).toEqual([]);
    });

    it('names the group it follows in the heading', async () => {
      const { fixture } = await render({ lines: [subscribed()] });

      const clusters = fixture.componentInstance.page()?.clusters;
      expect(clusters?.[0].headingKey).toBe('list.page.fromGroup');
      expect(clusters?.[0].headingArgs).toEqual({ name: 'Milk' });
    });

    it('falls back to the unnamed heading when the group did not resolve', async () => {
      const { fixture } = await render({
        lines: [subscribed()],
        groupNames: fakeGroupNames({ groups: [], failed: [MILK_GROUP.id] }),
      });

      expect(fixture.componentInstance.page()?.clusters?.[0].headingKey).toBe(
        'list.page.fromGroupUnnamed'
      );
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

  describe('where else it is wanted', () => {
    it('asks per product, excluding the list being asked from', async () => {
      // Per product because the server answers for an item and refuses a group, and
      // excluding this list because "also on" means somewhere else.
      const { holding } = await render({
        lines: [line({ itemIds: ['item-milk-a', 'item-oat'] })],
      });

      expect(holding.asked).toEqual([
        { itemId: 'item-milk-a', excludeListId: LIST_ID },
        { itemId: 'item-oat', excludeListId: LIST_ID },
      ]);
    });

    it('asks nothing more for a write that leaves the products alone', async () => {
      // The bug this replaced: the read was keyed on the `Line` object, which the store
      // replaces on every write to it, and one edit is three writes (the optimistic
      // patch, the server's row, the realtime echo). So a quantity nudge re-asked for
      // every product on the line, three times over.
      const { fixture, lines, holding } = await render({
        lines: [line({ itemIds: ['item-milk-a', 'item-oat'] })],
      });
      expect(holding.asked).toHaveLength(2);

      lines.set([line({ itemIds: ['item-milk-a', 'item-oat'], quantity: 9 })]);
      await drain(fixture);

      expect(holding.asked).toHaveLength(2);
    });

    it('asks only about the product that joined the set', async () => {
      // Adding a product does not change the answer for the products already on the
      // line, and this page's answer is a snapshot of the visit, so the ones it holds
      // are reused. Adding one product is one request, not one per product.
      const { fixture, lines, holding } = await render();
      expect(holding.asked.map((ask) => ask.itemId)).toEqual(['item-milk-a']);

      lines.set([line({ itemIds: ['item-milk-a', 'item-oat'] })]);
      await drain(fixture);

      expect(holding.asked.map((ask) => ask.itemId)).toEqual([
        'item-milk-a',
        'item-oat',
      ]);
    });

    it('never asks for a line with no products', async () => {
      // The server refuses that read rather than answering empty, because there is no
      // question to ask. Asking anyway would turn a legitimate absence into an error.
      const { fixture, holding } = await render({
        lines: [line({ itemIds: [] })],
      });

      expect(holding.asked).toEqual([]);
      expect(fixture.componentInstance.page()?.alsoOn).toBeNull();
    });

    it('merges the products answers, counting one list once', async () => {
      // A list wanting two of this line's products is one place, not two.
      const { fixture } = await render({
        lines: [line({ itemIds: ['item-milk-a', 'item-oat'] })],
        alsoOn: {
          'item-milk-a': {
            places: [
              { listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' },
            ],
            hasMore: false,
          },
          'item-oat': {
            places: [
              { listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' },
              { listId: 'list-3', listName: 'Office', zoneName: 'Work' },
            ],
            hasMore: false,
          },
        },
      });

      expect(fixture.componentInstance.page()?.alsoOn?.places).toEqual([
        { listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' },
        { listId: 'list-3', listName: 'Office', zoneName: 'Work' },
      ]);
      expect(textOf(fixture)).toContain('list.page.alsoOn');
    });

    it('draws nothing for an empty answer, and does not call it a failure', async () => {
      // Asked, and nothing else wants it. The section is not drawn, but the answer is
      // a real one: this is the case that used to be indistinguishable from not asking.
      const { fixture } = await render({
        alsoOn: { 'item-milk-a': { places: [], hasMore: false } },
      });

      expect(fixture.componentInstance.page()?.alsoOn).toEqual({
        places: [],
        hasMore: false,
      });
      expect(textOf(fixture)).not.toContain('list.page.alsoOn');
    });

    it('says there are more when the server capped the answer', async () => {
      const { fixture } = await render({
        alsoOn: {
          'item-milk-a': {
            places: [
              { listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' },
            ],
            hasMore: true,
          },
        },
      });

      expect(textOf(fixture)).toContain('list.page.alsoOnMore');
    });

    it('keeps the products that answered when one request fails', async () => {
      // An indicator, so a partial answer beats none. It says there is more rather
      // than presenting the half it has as the whole.
      const { fixture } = await render({
        lines: [line({ itemIds: ['item-milk-a', 'item-oat'] })],
        alsoOn: {
          'item-milk-a': {
            places: [
              { listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' },
            ],
            hasMore: false,
          },
          'item-oat': new Error('gateway down'),
        },
      });

      const alsoOn = fixture.componentInstance.page()?.alsoOn;
      expect(alsoOn?.places).toHaveLength(1);
      expect(alsoOn?.hasMore).toBe(true);
    });

    it('is null when nothing came back at all', async () => {
      // Every request failed, so as far as the reader is concerned nobody asked, and
      // the section is omitted rather than claiming no other list wants this.
      const { fixture } = await render({
        alsoOn: { 'item-milk-a': new Error('gateway down') },
      });

      expect(fixture.componentInstance.page()?.alsoOn).toBeNull();
      expect(textOf(fixture)).not.toContain('list.page.alsoOn');
    });
  });
});
