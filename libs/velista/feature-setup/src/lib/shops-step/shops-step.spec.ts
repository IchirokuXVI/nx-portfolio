import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeShoppingProfileStore,
  profilePostalCodeFor,
  provideFakeShoppingProfileStore,
  SHOP_SERVICE,
  SHOPPING_PROFILE_SERVICE,
  shoppingProfileFor,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import type {
  ShopChainSummary,
  ShoppingProfile,
  Supermarket,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { SetupChainList } from '@portfolio/velista/ui';
import { SetupFlow } from '../setup-flow';
import { fakeSetupFlow, type FakeSetupFlow } from '../testing/fake-setup-flow';
import { ShopsStep } from './shops-step';

/** Velista `0098`, section 5, step 3. */

const SUMMARY: readonly ShopChainSummary[] = [
  summary('sm-mercadona', 'Mercadona', 7),
  summary('sm-deza', 'Deza', 5),
  summary('sm-dia', 'DIA', 6),
];

const EVERY_CHAIN: readonly Supermarket[] = [
  { id: 'sm-mercadona', name: { en: 'Mercadona', es: 'Mercadona' } },
  { id: 'sm-deza', name: { en: 'Deza', es: 'Deza' } },
];

function summary(
  supermarketId: string,
  name: string,
  locations: number
): ShopChainSummary {
  return {
    supermarketId,
    name: { en: name, es: name },
    externalBrandKey: null,
    locations,
    excluded: 0,
    excludedChain: false,
  };
}

const PLACED = shoppingProfileFor({
  postalCodes: [
    profilePostalCodeFor({ postalCode: '14013', source: 'DEVICE' }),
    profilePostalCodeFor({ id: 'pc2', postalCode: '14012', source: 'NEARBY' }),
  ],
});

async function render(
  profile: ShoppingProfile = PLACED,
  chains: readonly ShopChainSummary[] = SUMMARY
): Promise<{
  fixture: ComponentFixture<ShopsStep>;
  store: FakeShoppingProfileStore;
  flow: FakeSetupFlow;
  summarize: jest.Mock;
  listSupermarkets: jest.Mock;
}> {
  TestBed.resetTestingModule();

  const store = fakeShoppingProfileStore({ profiles: [profile] });
  const flow = fakeSetupFlow(profile);
  const summarize = jest.fn().mockResolvedValue(chains);
  const listSupermarkets = jest.fn().mockResolvedValue(EVERY_CHAIN);

  await TestBed.configureTestingModule({
    imports: [ShopsStep, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideFakeShoppingProfileStore(store),
      { provide: SHOP_SERVICE, useValue: { summarizeChains: summarize } },
      { provide: SHOPPING_PROFILE_SERVICE, useValue: { listSupermarkets } },
      { provide: SetupFlow, useValue: flow },
      { provide: PageNavigation, useValue: { back: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShopsStep);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, flow, summarize, listSupermarkets };
}

async function settle(fixture: ComponentFixture<ShopsStep>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    fixture.detectChanges();
  }
}

function list(fixture: ComponentFixture<ShopsStep>): SetupChainList {
  const found = fixture.debugElement.query(
    (node) => node.componentInstance instanceof SetupChainList
  );
  return found.componentInstance as SetupChainList;
}

function text(fixture: ComponentFixture<ShopsStep>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

async function toggle(
  fixture: ComponentFixture<ShopsStep>,
  supermarketId: string
): Promise<void> {
  list(fixture).switched.emit(supermarketId);
  await settle(fixture);
}

async function press(
  fixture: ComponentFixture<ShopsStep>,
  selector: string
): Promise<void> {
  const button = (fixture.nativeElement as HTMLElement).querySelector(
    selector
  ) as HTMLButtonElement | null;
  if (button === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  button.click();
  await settle(fixture);
}

function saves(store: FakeShoppingProfileStore) {
  return store.calls.filter((call) => call.method === 'save');
}

describe('ShopsStep', () => {
  it('lists the chains near the code with their counts, every one on', async () => {
    const { fixture, summarize } = await render();

    expect(summarize).toHaveBeenCalledWith('sp1');
    expect(list(fixture).rows()).toEqual([
      { supermarketId: 'sm-mercadona', name: 'Mercadona', shops: 7, on: true },
      { supermarketId: 'sm-deza', name: 'Deza', shops: 5, on: true },
      { supermarketId: 'sm-dia', name: 'DIA', shops: 6, on: true },
    ]);
    expect(text(fixture)).toContain('setup.shops.near');
  });

  it('lists every chain, with no counts and no "near", when there is no code', async () => {
    const { fixture, listSupermarkets, summarize } =
      await render(shoppingProfileFor());

    expect(listSupermarkets).toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
    expect(
      list(fixture)
        .rows()
        .map((row) => row.shops)
    ).toEqual([null, null]);
    expect(text(fixture)).toContain('setup.shops.all');
    expect(text(fixture)).not.toContain('setup.shops.near');
  });

  it('keeps a chain switched off on the list, marked', async () => {
    const { fixture } = await render();

    await toggle(fixture, 'sm-dia');

    const dia = list(fixture)
      .rows()
      .find((row) => row.supermarketId === 'sm-dia');
    expect(dia?.on).toBe(false);
    expect(list(fixture).rows()).toHaveLength(3);
    expect(text(fixture)).toContain('setup.shops.off');
  });

  it('allows every chain off, says what it means, and does not block Done', async () => {
    const { fixture, flow } = await render();

    await press(fixture, '.all-off');

    expect(
      list(fixture)
        .rows()
        .every((row) => !row.on)
    ).toBe(true);
    expect(text(fixture)).toContain('setup.shops.noneTitle');

    await press(fixture, '.foot .primary');
    expect(flow.go).toHaveBeenCalledWith('done');
    expect(flow.chains()).toEqual({ on: 0, total: 3 });
  });

  it('sends only the chains that changed', async () => {
    const { fixture, store, flow } = await render();

    await toggle(fixture, 'sm-dia');
    await toggle(fixture, 'sm-deza');
    await toggle(fixture, 'sm-deza');
    await press(fixture, '.foot .primary');

    expect(saves(store)).toEqual([
      {
        method: 'save',
        profileId: 'sp1',
        field: 'chains',
        body: { supermarkets: [{ supermarketId: 'sm-dia', excluded: true }] },
      },
    ]);
    expect(flow.chains()).toEqual({ on: 2, total: 3 });
  });

  it('sends nothing when nothing changed', async () => {
    const { fixture, store, flow } = await render();

    await press(fixture, '.foot .primary');

    expect(saves(store)).toHaveLength(0);
    expect(flow.go).toHaveBeenCalledWith('done');
  });

  it('turns a refused chain back on by removing its refusal', async () => {
    const refusing = {
      ...PLACED,
      chains: [{ id: 'c1', supermarketId: 'sm-dia', excluded: true }],
    };
    const { fixture, store } = await render(
      refusing,
      SUMMARY.map((chain) =>
        chain.supermarketId === 'sm-dia'
          ? { ...chain, excludedChain: true }
          : chain
      )
    );

    const dia = () =>
      list(fixture)
        .rows()
        .find((row) => row.supermarketId === 'sm-dia');
    expect(dia()?.on).toBe(false);

    await toggle(fixture, 'sm-dia');
    await press(fixture, '.foot .primary');

    // Including is removing the row, so the replacement no longer names it.
    expect(saves(store)).toEqual([
      {
        method: 'save',
        profileId: 'sp1',
        field: 'chains',
        body: { supermarkets: [] },
      },
    ]);
  });

  it('writes nothing on Skip', async () => {
    const { fixture, store, flow } = await render();

    await toggle(fixture, 'sm-dia');
    await press(fixture, 'lib-setup-step-header .skip');

    expect(saves(store)).toHaveLength(0);
    expect(flow.go).toHaveBeenCalledWith('done');
  });
});
