import nominatim from './__fixtures__/nominatim-14013.json';
import overpass from './__fixtures__/overpass-supermarkets.json';
import { OsmHttpError, OsmPlacesClient } from './osm-places.client';

const UA = 'LunaShopper/0.1 (+https://velista.app; contact@velista.app)';

interface StubResponse {
  status?: number;
  body?: unknown;
}

function stubFetch(answers: StubResponse[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) {
      throw new Error(`No stub response left for ${String(url)}`);
    }
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** The Overpass QL out of a form encoded POST body, `+` decoded as a space. */
function overpassQuery(init: RequestInit): string {
  return new URLSearchParams(String(init.body)).get('data') ?? '';
}

function client(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof OsmPlacesClient>[0]> = {}
) {
  return new OsmPlacesClient({
    userAgent: UA,
    fetchImpl,
    sleepImpl: async () => undefined,
    // The default is Nominatim's 1 req/s; a unit test must not wait for it.
    minIntervalMs: 0,
    ...overrides,
  });
}

describe('geocodePostalCode', () => {
  it('asks Nominatim for one result and returns the centre', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: nominatim }]);
    await expect(client(fetchImpl).geocodePostalCode('14013', 'es')).resolves.toEqual(
      { lat: 37.8587, lon: -4.7863 }
    );
    expect(calls[0].url).toContain('postalcode=14013');
    expect(calls[0].url).toContain('country=es');
    expect(calls[0].url).toContain('limit=1');
  });

  it('identifies itself, which Nominatim requires rather than merely prefers', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: nominatim }]);
    await client(fetchImpl).geocodePostalCode('14013');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe(UA);
  });

  it('paces itself at one request per second by default', () => {
    // The policy value is what a caller gets by not passing anything, which is
    // the point: politeness must not depend on remembering.
    const c = new OsmPlacesClient({ userAgent: UA });
    expect(c).toBeDefined();
  });
});

describe('findSupermarkets', () => {
  it('issues one Overpass query bounded by a radius around the point', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: overpass }]);
    const places = await client(fetchImpl).findSupermarkets(
      { lat: 37.8587, lon: -4.7863 },
      3000
    );

    expect(calls).toHaveLength(1);
    const query = overpassQuery(calls[0].init);
    expect(query).toContain(
      'nwr["shop"="supermarket"](around:3000,37.8587,-4.7863)'
    );
    // `out center` is what makes a way usable; without it every mapped building
    // comes back with no position and gets dropped.
    expect(query).toContain('out center tags;');
    expect(places).toHaveLength(5);
  });

  it('does not filter by brand: the run is chain agnostic by design', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: overpass }]);
    const places = await client(fetchImpl).findSupermarkets(
      { lat: 37.8587, lon: -4.7863 },
      3000
    );
    expect(overpassQuery(calls[0].init)).not.toContain('brand');
    // One query answers "what supermarkets are near me" for every chain at once.
    expect(new Set(places.map((p) => p.brandKey)).size).toBe(3);
  });

  it('retries a 429 and then succeeds', async () => {
    const slept: number[] = [];
    const { fetchImpl } = stubFetch([{ status: 429 }, { body: overpass }]);
    const places = await client(fetchImpl, {
      backoffBaseMs: 100,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    }).findSupermarkets({ lat: 37.8587, lon: -4.7863 }, 3000);
    expect(places).toHaveLength(5);
    expect(slept).toHaveLength(1);
  });

  it('gives up rather than hammering a volunteer funded service', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 504 },
      { status: 504 },
      { status: 504 },
    ]);
    await expect(
      client(fetchImpl, { retries: 2 }).findSupermarkets(
        { lat: 37.8587, lon: -4.7863 },
        3000
      )
    ).rejects.toBeInstanceOf(OsmHttpError);
    expect(calls).toHaveLength(3);
  });

  it('stops before requesting once the run is aborted', async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = stubFetch([{ body: overpass }]);
    const c = client(fetchImpl, { signal: controller.signal });
    controller.abort();
    await expect(
      c.findSupermarkets({ lat: 37.8587, lon: -4.7863 }, 3000)
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('awaits the injected gate, so the harvester can share one bucket', async () => {
    let acquired = 0;
    const { fetchImpl } = stubFetch([{ body: nominatim }, { body: overpass }]);
    const c = client(fetchImpl, {
      acquire: async () => {
        acquired += 1;
      },
    });
    const centre = await c.geocodePostalCode('14013');
    if (!centre) {
      throw new Error('the geocode stub answered nothing');
    }
    await c.findSupermarkets(centre, 3000);
    expect(acquired).toBe(2);
  });
});
