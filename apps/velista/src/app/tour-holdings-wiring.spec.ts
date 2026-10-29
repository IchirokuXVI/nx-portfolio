import {
  createEnvironmentInjector,
  EnvironmentInjector,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  fakeOperatorSettingsStore,
  fakeProfileStore,
  fakeZoneStore,
  MEMORY_OPERATOR_SETTINGS,
  provideFakeOperatorSettingsStore,
  provideFakeProfileStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  type FakeOperatorSettingsStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { TourStore, type TourHoldings } from '@portfolio/velista/platform';
import { appProviders } from './app-providers';

/**
 * The wiring in `app-providers.ts` that tells `TourStore` what the account holds,
 * microphone included (velista `0174`, target 3).
 *
 * `tour-stops.spec.ts` covers `tourHoldingsOf` and `planTour` with values handed in.
 * This drives the effect that hands them in: null while the settings read is still
 * out, so the store waits as it does for the zones, and `voice: false` once the read
 * failed. Built through the route injector the router builds, as
 * `terms-gate-wiring.spec.ts` does.
 */
describe('appProviders: the tour holdings wiring (velista 0174)', () => {
  function setUp(operator: FakeOperatorSettingsStore): {
    tour: TourStore;
    held: () => TourHoldings | null | undefined;
  } {
    const overrides: Provider[] = [
      provideFakeProfileStore(fakeProfileStore({ profile: null })),
      provideFakeSessionStore('REGISTERED'),
      provideFakeZoneStore(fakeZoneStore({ zones: [], state: 'loaded' })),
      provideFakeOperatorSettingsStore(operator),
      { provide: APP_BASE_PATH, useValue: '' },
    ];
    const injector = createEnvironmentInjector(
      [...appProviders, ...overrides],
      TestBed.inject(EnvironmentInjector),
      'Route: velista'
    );
    jest.spyOn(injector.get(Router), 'navigateByUrl').mockResolvedValue(true);

    const tour = injector.get(TourStore);
    const setHoldings = jest.spyOn(tour, 'setHoldings');

    // Holdings are read only while a run is going. The run is not awaited: it waits
    // for the holdings this spec is about, and `skip()` below ends it.
    void tour.start();
    TestBed.tick();

    return { tour, held: () => setHoldings.mock.calls.at(-1)?.[0] };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('keeps the holdings unknown while the settings are still loading', () => {
    const operator = fakeOperatorSettingsStore(null);
    const { tour, held } = setUp(operator);

    expect(held()).toBeNull();

    // The answer arriving is what lets the run go on.
    operator.land(MEMORY_OPERATOR_SETTINGS);
    TestBed.tick();
    expect(held()).toEqual(expect.objectContaining({ voice: true }));

    tour.skip();
  });

  it('reads a failed settings read as no microphone', () => {
    const operator = fakeOperatorSettingsStore(null);
    operator.fail();
    const { tour, held } = setUp(operator);

    expect(held()).toEqual(expect.objectContaining({ voice: false }));

    tour.skip();
  });

  it('offers the voice card when the deployment transcribes and the assistant is on', () => {
    const { tour, held } = setUp(
      fakeOperatorSettingsStore({
        ...MEMORY_OPERATOR_SETTINGS,
        features: {
          ...MEMORY_OPERATOR_SETTINGS.features,
          assistant: true,
          transcription: true,
        },
      })
    );

    expect(held()).toEqual(expect.objectContaining({ voice: true }));

    tour.skip();
  });

  it('offers no voice card when either flag is off', () => {
    for (const off of ['assistant', 'transcription'] as const) {
      const { tour, held } = setUp(
        fakeOperatorSettingsStore({
          ...MEMORY_OPERATOR_SETTINGS,
          features: {
            ...MEMORY_OPERATOR_SETTINGS.features,
            assistant: true,
            transcription: true,
            [off]: false,
          },
        })
      );

      expect(held()).toEqual(expect.objectContaining({ voice: false }));

      tour.skip();
      TestBed.resetTestingModule();
    }
  });
});
