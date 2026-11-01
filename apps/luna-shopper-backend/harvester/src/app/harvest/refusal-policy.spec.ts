import { CARREFOUR_REFUSAL_POLICY } from '@portfolio/luna-shopper/carrefour';
import { HarvestRunMode } from '@portfolio/luna-shopper/contracts';
import { DIA_REFUSAL_POLICY } from '@portfolio/luna-shopper/dia';
import { MERCADONA_REFUSAL_POLICY } from '@portfolio/luna-shopper/mercadona';
import type {
  SourceStop,
  SourceTrip,
} from '@portfolio/luna-shopper/source-guard';
import { pausedLabel, refusalPolicyOf, stopSentence } from './refusal-policy';

/**
 * Which run gets a guard, and what a stopped run says (plan 0215, sections 3
 * and 6.2).
 */

const AT = Date.UTC(2026, 8, 25, 14, 3, 11);

const trip = (over: Partial<SourceTrip> = {}): SourceTrip => ({
  at: AT,
  rule: 'consecutive',
  refusals: 5,
  of: null,
  status: 403,
  url: 'https://tienda.mercadona.es/api/products/67890/',
  pauseMs: 600_000,
  ...over,
});

const stop = (over: Partial<SourceStop> = {}): SourceStop => ({
  at: AT + 602_000,
  cause: 'probes',
  trip: trip(),
  probesRefused: 3,
  pausedMs: 600_000,
  status: 403,
  url: 'https://tienda.mercadona.es/api/products/67890/',
  ...over,
});

describe('refusalPolicyOf', () => {
  it('takes each storefront adapter’s own constant', () => {
    const mode = HarvestRunMode.CATALOG_DISCOVERY;
    expect(refusalPolicyOf('mercadona-api', mode)).toBe(
      MERCADONA_REFUSAL_POLICY
    );
    expect(refusalPolicyOf('dia-api', mode)).toBe(DIA_REFUSAL_POLICY);
    expect(refusalPolicyOf('carrefour-web', mode)).toBe(
      CARREFOUR_REFUSAL_POLICY
    );
    for (const key of ['lidl-api', 'eljamon-web', 'deza-web'] as const) {
      expect(refusalPolicyOf(key, mode)).toEqual(
        expect.objectContaining({ consecutive: 5, coolDownMs: 600_000 })
      );
    }
  });

  it('gives no guard to OpenStreetMap, a file import or a run with no chain', () => {
    expect(
      refusalPolicyOf('osm-places', HarvestRunMode.STORE_DISCOVERY)
    ).toBeNull();
    expect(
      refusalPolicyOf('mercadona-api', HarvestRunMode.FILE_IMPORT)
    ).toBeNull();
    expect(
      refusalPolicyOf(undefined, HarvestRunMode.STORE_DISCOVERY)
    ).toBeNull();
  });

  it('pauses the four storefronts that pause and no other', () => {
    expect(MERCADONA_REFUSAL_POLICY).toEqual({
      consecutive: 5,
      window: { size: 50, refusals: 20 },
      coolDowns: 1,
      coolDownMs: 600_000,
      probes: 3,
    });
    expect(DIA_REFUSAL_POLICY.coolDowns).toBe(0);
    expect(CARREFOUR_REFUSAL_POLICY).toEqual(
      expect.objectContaining({ consecutive: 3, coolDowns: 0 })
    );
  });
});

describe('stopSentence', () => {
  it('names the trip, the refused probes and what was kept', () => {
    expect(stopSentence(stop(), true, 2140)).toBe(
      'Stopped: the chain refused 5 requests in a row at 14:03 UTC and still ' +
        'refused 3 probe(s) after a 10 minute pause. The 2,140 product(s) ' +
        'read before are kept.'
    );
  });

  it('says a chain that does not pause does not', () => {
    expect(
      stopSentence(
        stop({
          cause: 'trip',
          probesRefused: 0,
          pausedMs: null,
          trip: trip({ refusals: 3, pauseMs: null }),
        }),
        false,
        null
      )
    ).toBe(
      'Stopped: the chain refused 3 requests in a row at 14:03 UTC, and the ' +
        'run does not pause for this chain. Everything read before the stop ' +
        'is kept.'
    );
  });

  it('names the pause already spent on a second trip', () => {
    expect(
      stopSentence(
        stop({
          cause: 'trip',
          probesRefused: 0,
          trip: trip({ rule: 'window', refusals: 20, of: 50, pauseMs: null }),
        }),
        true,
        12
      )
    ).toBe(
      'Stopped: the chain refused 20 of the last 50 requests at 14:03 UTC, ' +
        'after a 10 minute pause earlier in the run. The 12 product(s) read ' +
        'before are kept.'
    );
  });

  it('labels the stage of a pause', () => {
    expect(pausedLabel(trip())).toBe(
      'The chain refused 5 requests in a row. Waiting 10 minutes before ' +
        'trying one more.'
    );
  });
});
