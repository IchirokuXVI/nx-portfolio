import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeShoppingProfileStore,
  provideFakeShoppingProfileStore,
  SHOP_SERVICE,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import type { ShopChainSummary } from '@portfolio/velista/models';
import {
  fakeGeolocationReader,
  GEOLOCATION_READER,
  PageNavigation,
  provideVelistaTesting,
  type LocationOutcome,
  type LocationPermission,
} from '@portfolio/velista/platform';
import { SetupFlow } from '../setup-flow';
import { fakeSetupFlow, type FakeSetupFlow } from '../testing/fake-setup-flow';
import { PlaceStep } from './place-step';

/**
 * Velista `0098`, section 5, step 2.
 *
 * jsdom has no geolocation, which is what `GEOLOCATION_READER` exists for: every state
 * the location sheet has is reachable here by what the fake reader answers.
 */
interface Options {
  readonly permission?: LocationPermission;
  readonly outcome?: LocationOutcome;
  /** What the server resolves a point to. Undefined makes the lookup throw. */
  readonly resolvesTo?: string | null;
}

const SUMMARY: readonly ShopChainSummary[] = [
  chain('sm-mercadona', 7),
  chain('sm-dia', 6),
];

function chain(supermarketId: string, locations: number): ShopChainSummary {
  return {
    supermarketId,
    name: { en: supermarketId, es: supermarketId },
    externalBrandKey: null,
    locations,
    excluded: 0,
    excludedChain: false,
  };
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<PlaceStep>;
  store: FakeShoppingProfileStore;
  flow: FakeSetupFlow;
  summarize: jest.Mock;
  reader: ReturnType<typeof fakeGeolocationReader>;
}> {
  TestBed.resetTestingModule();

  const store = fakeShoppingProfileStore({
    resolvesTo: 'resolvesTo' in options ? options.resolvesTo : '14013',
  });
  const reader = fakeGeolocationReader({
    permission: options.permission,
    outcome: options.outcome,
  });
  const flow = fakeSetupFlow();
  const summarize = jest.fn().mockResolvedValue(SUMMARY);

  await TestBed.configureTestingModule({
    imports: [PlaceStep, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideFakeShoppingProfileStore(store),
      { provide: GEOLOCATION_READER, useValue: reader.reader },
      { provide: SHOP_SERVICE, useValue: { summarizeChains: summarize } },
      { provide: SetupFlow, useValue: flow },
      { provide: PageNavigation, useValue: { back: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PlaceStep);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, flow, summarize, reader };
}

async function settle(fixture: ComponentFixture<PlaceStep>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function query<T extends HTMLElement>(
  fixture: ComponentFixture<PlaceStep>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

function text(fixture: ComponentFixture<PlaceStep>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

async function press(
  fixture: ComponentFixture<PlaceStep>,
  selector: string
): Promise<void> {
  const button = query<HTMLButtonElement>(fixture, selector);
  if (button === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  button.click();
  await settle(fixture);
}

async function type(
  fixture: ComponentFixture<PlaceStep>,
  value: string
): Promise<void> {
  const field = query<HTMLInputElement>(fixture, '#setup-postal-code');
  if (field === null) {
    throw new Error('no postal code field');
  }
  field.value = value;
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('change'));
  await settle(fixture);
}

function continueButton(fixture: ComponentFixture<PlaceStep>) {
  return query<HTMLButtonElement>(fixture, '.foot .primary');
}

function adds(store: FakeShoppingProfileStore) {
  return store.calls.filter((call) => call.method === 'addPostalCode');
}

describe('PlaceStep', () => {
  it('holds Continue until something has produced a code', async () => {
    const { fixture } = await render();

    expect(continueButton(fixture)?.disabled).toBe(true);
  });

  it('says what happens to the position before the button is pressed', async () => {
    const { fixture, reader } = await render();

    expect(text(fixture)).toContain('setup.place.privacy');
    expect(reader.state.reads).toBe(0);
  });

  describe('the four states of a location', () => {
    it('resolved: shows the code, announced, and ticks the neighbours', async () => {
      const { fixture } = await render();

      await press(fixture, '.locate');

      const placed = query(fixture, '.placed');
      expect(placed?.getAttribute('role')).toBe('status');
      expect(query(fixture, '.placed-code')?.textContent?.trim()).toBe('14013');
      expect(query<HTMLInputElement>(fixture, '.nearby input')?.checked).toBe(
        true
      );
      expect(continueButton(fixture)?.disabled).toBe(false);
    });

    it('refused before anybody asked: says so, and offers no button that cannot work', async () => {
      const { fixture } = await render({ permission: 'denied' });

      expect(text(fixture)).toContain('profiles.location.refused');
      expect(query(fixture, '.locate')).toBeNull();
      expect(query(fixture, '#setup-postal-code')).not.toBeNull();
    });

    it('refused when asked: the same sentence, and typing still works', async () => {
      const { fixture } = await render({ outcome: { state: 'denied' } });

      await press(fixture, '.locate');

      expect(text(fixture)).toContain('profiles.location.refused');
      expect(query(fixture, '.locate')).toBeNull();
    });

    it('unplaceable: says so, and hands over to typing', async () => {
      const { fixture } = await render({ resolvesTo: null });

      await press(fixture, '.locate');

      expect(text(fixture)).toContain('profiles.location.unplaceable');
      await press(fixture, '.notice .quiet');
      expect(document.activeElement).toBe(query(fixture, '#setup-postal-code'));
    });

    it('failed: the lookup could not be made, and the button stays to try again', async () => {
      const { fixture } = await render({ resolvesTo: undefined });

      await press(fixture, '.locate');

      expect(text(fixture)).toContain('profiles.location.failed');
      expect(query(fixture, '.locate')).not.toBeNull();
    });

    it('a device that could not place itself says so, and can try again', async () => {
      const { fixture } = await render({ outcome: { state: 'timed-out' } });

      await press(fixture, '.locate');

      expect(text(fixture)).toContain('profiles.location.unavailable');
      expect(query(fixture, '.locate')).not.toBeNull();
    });
  });

  it('writes a resolved code as the device, with the neighbours', async () => {
    const { fixture, store, flow } = await render();

    await press(fixture, '.locate');
    await press(fixture, '.foot .primary');

    expect(adds(store)).toEqual([
      {
        method: 'addPostalCode',
        profileId: 'sp1',
        body: { postalCode: '14013', source: 'DEVICE', expandNearby: true },
      },
    ]);
    expect(flow.go).toHaveBeenCalledWith('shops');
  });

  it('sends the tick as the person left it', async () => {
    const { fixture, store } = await render();

    await press(fixture, '.locate');
    const box = query<HTMLInputElement>(fixture, '.nearby input');
    box?.click();
    await settle(fixture);
    await press(fixture, '.foot .primary');

    expect(adds(store)[0]).toMatchObject({
      body: { expandNearby: false },
    });
  });

  it('writes a typed code as typed', async () => {
    const { fixture, store } = await render();

    await type(fixture, ' 14001 ');
    await press(fixture, '.foot .primary');

    expect(adds(store)[0]).toMatchObject({
      body: { postalCode: '14001', source: 'TYPED', expandNearby: true },
    });
  });

  it('counts what the code reaches before it is written', async () => {
    const { fixture, summarize, store } = await render();

    await press(fixture, '.locate');

    expect(summarize).toHaveBeenCalledWith('sp1', ['14013']);
    expect(query(fixture, '.reach')).not.toBeNull();
    expect(adds(store)).toHaveLength(0);
  });

  it('says what skipping costs once, and writes nothing when it goes ahead', async () => {
    const { fixture, store, flow } = await render();

    await press(fixture, 'lib-setup-step-header .skip');
    expect(text(fixture)).toContain('setup.place.skipTitle');
    expect(flow.go).not.toHaveBeenCalled();

    await press(fixture, '.skip-actions .quiet');

    expect(adds(store)).toHaveLength(0);
    expect(flow.go).toHaveBeenCalledWith('shops');
  });

  it('goes back to answering from the skip question', async () => {
    const { fixture, flow } = await render();

    await press(fixture, 'lib-setup-step-header .skip');
    await press(fixture, '.skip-actions .primary');

    expect(text(fixture)).not.toContain('setup.place.skipTitle');
    expect(flow.go).not.toHaveBeenCalled();
  });
});
