import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, BasketTargetStore } from '@portfolio/velista/data-access';
import type { Basket, BasketListRef } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { TargetListSheet } from './target-list-sheet';

/**
 * Which list is this for? (velista `0092`, section 7.3.)
 *
 * The sheet **writes nothing to the server**, so there is nothing here about
 * requests. What is worth asserting is the shape of the choice: the lists come in
 * the server's order under their households' names, choosing one records it and
 * dismisses, and a remembered target the basket no longer covers is dropped
 * without the record being forgotten.
 */

const WEEKLY: BasketListRef = {
  listId: 'l-weekly',
  name: 'Weekly shop',
  zoneId: 'z-flat',
  zoneName: 'Flat 3B',
};

const GROCERIES: BasketListRef = {
  listId: 'l-groceries',
  name: 'Groceries',
  zoneId: 'z-home',
  zoneName: 'Parents',
};

/** A second list in the **first** household, so a group can hold two. */
const TREATS: BasketListRef = {
  listId: 'l-treats',
  name: 'Treats',
  zoneId: 'z-flat',
  zoneName: 'Flat 3B',
};

function basket(lists: readonly BasketListRef[]): Basket {
  return {
    id: 'basket-saturday',
    kind: 'GENERATED',
    name: 'Saturday shop',
    status: 'OPEN',
    createdAt: null,
    rows: [],
    lists,
    participants: [],
    me: {
      id: 'p-owner',
      kind: 'OWNER',
      displayName: 'Ana',
      username: 'ana',
      guestNumber: null,
      userId: 'u-1',
      joinedAt: null,
      lastSeenAt: null,
      shareLinkId: null,
    },
    products: new Map(),
    scopes: new Map(),
    progress: { done: 0, unavailable: 0, total: 0 },
    pending: 0,
  };
}

async function render(lists: readonly BasketListRef[]) {
  TestBed.resetTestingModule();

  const held = basket(lists);
  const dismiss = jest.fn().mockResolvedValue(undefined);

  await TestBed.configureTestingModule({
    imports: [TargetListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      BasketTargetStore,
      {
        provide: BasketStore,
        useValue: {
          basket: signal<Basket | null>(held),
          address: signal({ basketId: held.id }),
        },
      },
      {
        provide: SheetNavigation,
        useValue: { dismiss, leaveTo: jest.fn().mockResolvedValue(undefined) },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const target = TestBed.inject(BasketTargetStore);
  target.restore(held);

  const fixture = TestBed.createComponent(TargetListSheet);
  fixture.detectChanges();

  return { fixture, target, dismiss, held };
}

const rows = (fixture: ComponentFixture<TargetListSheet>) => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
    '.choice'
  ),
];

const zones = (fixture: ComponentFixture<TargetListSheet>) =>
  [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '.zone'
    ),
  ].map((node) => node.textContent?.trim());

describe('TargetListSheet', () => {
  it('lists every list this reader may write, under its household', async () => {
    const { fixture } = await render([WEEKLY, TREATS, GROCERIES]);

    // The server's order in both dimensions, never re-sorted here.
    expect(zones(fixture)).toEqual(['Flat 3B', 'Parents']);
    expect(rows(fixture).map((row) => row.textContent?.trim())).toEqual([
      'Weekly shop',
      'Treats',
      'Groceries',
    ]);
  });

  it('names a household once, however many of its lists are here', async () => {
    // Two households both keep one called "Groceries", so the group's name is
    // what tells them apart — as a heading rather than four repeats of a suffix.
    const { fixture } = await render([WEEKLY, TREATS]);

    expect(zones(fixture)).toEqual(['Flat 3B']);
    expect(rows(fixture)).toHaveLength(2);
  });

  it('is one radio group, so the arrow keys travel the whole set', async () => {
    const { fixture } = await render([WEEKLY, TREATS, GROCERIES]);

    const names = new Set(
      rows(fixture).map((row) =>
        row.querySelector('input')?.getAttribute('name')
      )
    );
    expect(names).toEqual(new Set(['basket-target']));
  });

  it('records the choice and dismisses to the basket', async () => {
    const { fixture, target, dismiss } = await render([WEEKLY, GROCERIES]);

    rows(fixture)[1].querySelector('input')?.click();
    fixture.detectChanges();

    expect(target.target()?.listId).toBe('l-groceries');
    expect(dismiss).toHaveBeenCalledWith(
      '/velista/en/shopping-lists/basket-saturday'
    );
  });

  it('says a list was chosen, for the basket page to focus the field (velista 0113)', async () => {
    const { fixture } = await render([WEEKLY, GROCERIES]);
    expect(fixture.componentInstance.chose).toBe(false);

    // The row not already checked: a remembered target from an earlier visit is
    // checked on arrival, and a checked radio fires no change when pressed.
    rows(fixture)
      .map((row) => row.querySelector<HTMLInputElement>('input'))
      .find((input) => input !== null && !input.checked)
      ?.click();

    expect(fixture.componentInstance.chose).toBe(true);
  });

  it('says nothing was chosen when it is dismissed without an answer', async () => {
    const { fixture, dismiss } = await render([WEEKLY, GROCERIES]);

    (fixture.componentInstance as unknown as { close(): void }).close();

    expect(dismiss).toHaveBeenCalled();
    expect(fixture.componentInstance.chose).toBe(false);
  });

  it('marks the one already chosen', async () => {
    const { fixture, target } = await render([WEEKLY, GROCERIES]);
    target.choose(GROCERIES);
    fixture.detectChanges();

    // Tinted **and** carrying a checked control, so nothing here is signalled by
    // colour alone.
    expect(rows(fixture)[1].classList.contains('picked')).toBe(true);
    expect(
      rows(fixture)[1].querySelector<HTMLInputElement>('input')?.checked
    ).toBe(true);
  });

  it('writes nothing to the server', async () => {
    // Choosing a target is a setting on the composer, kept on this device. The
    // only thing it changes is where the **next** add goes, so this sheet has no
    // busy state, no failure and no confirmation.
    const { fixture } = await render([WEEKLY, GROCERIES]);
    rows(fixture)[0].querySelector('input')?.click();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[aria-busy]')
    ).toBeNull();
  });
});

/**
 * What the store does on its own, which is easier to state than to draw.
 */
describe('BasketTargetStore', () => {
  /**
   * A basket of its own, and a fresh one per test that must start with nothing
   * remembered.
   *
   * The record is per basket and lives in this device's storage, which the
   * testing browser facade keeps across a `TestBed` reset — as the real one keeps
   * it across a reload. So a test that wants an empty memory asks about a basket
   * nothing has been chosen for, rather than reaching for a reset that would
   * stop this being the same storage the app uses.
   */
  let ids = 0;
  const freshBasket = (lists: readonly BasketListRef[]) => ({
    ...basket(lists),
    id: `basket-store-${(ids += 1)}`,
  });

  function build() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideVelistaTesting({ basePath: '/velista' }),
        BasketTargetStore,
      ],
    });
    return TestBed.inject(BasketTargetStore);
  }

  it('chooses the only list without asking', () => {
    const store = build();
    store.restore(freshBasket([WEEKLY]));

    // Nothing to pick between, so nobody is asked a question with one answer.
    expect(store.target()?.listId).toBe('l-weekly');
  });

  it('starts with none chosen when there is more than one', () => {
    const store = build();
    store.restore(freshBasket([WEEKLY, GROCERIES]));

    expect(store.target()).toBeNull();
  });

  it('remembers one basket’s target for the next visit', () => {
    const held = freshBasket([WEEKLY, GROCERIES]);
    const first = build();
    first.restore(held);
    first.choose(GROCERIES);
    first.leave();

    // The **record** survives the page being left, which is the whole point of
    // writing it down.
    const second = build();
    second.restore(held);
    expect(second.target()?.listId).toBe('l-groceries');
  });

  it('ignores a remembered list the basket no longer covers, and keeps it', () => {
    const held = freshBasket([WEEKLY, GROCERIES]);
    const first = build();
    first.restore(held);
    first.choose(GROCERIES);
    first.leave();

    // The coverage changed, or this reader's `WRITE` on that list went away.
    const narrowed = build();
    narrowed.restore({ ...held, lists: [WEEKLY, TREATS] });
    expect(narrowed.target()).toBeNull();

    // Dropped silently and **kept**: the list may come back on the next read, and
    // forgetting it would make a momentary refusal permanent.
    const again = build();
    again.restore(held);
    expect(again.target()?.listId).toBe('l-groceries');
  });

  it('is per basket, so one basket’s target is not another’s', () => {
    const store = build();
    store.restore(freshBasket([WEEKLY, GROCERIES]));
    store.choose(GROCERIES);
    store.leave();

    // A list belongs to a **basket's** coverage, where the view memory is the
    // shopper's own preference and travels with them (velista `0091`, section 7).
    const second = build();
    second.restore(freshBasket([WEEKLY, GROCERIES]));
    expect(second.target()).toBeNull();
  });
});
