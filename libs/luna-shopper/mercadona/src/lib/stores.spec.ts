import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MercadonaClient } from './mercadona.client';
import {
  openingHoursLine,
  parseStoreDocument,
  parseStoreTotals,
} from './stores';

/**
 * The store finder's document, read from the capture and never from a network
 * (plan 0106, section 2).
 *
 * The counts below are the whole point of the plan: `0038` section 2.8 rejected
 * a store list because OpenStreetMap's postcodes were missing two thirds of the
 * time, and this asserts that the chain's own document has no such gap.
 */

const FIXTURES = join(__dirname, '__fixtures__');
const document = readFileSync(join(FIXTURES, 'stores.js'), 'utf8');
const totals = readFileSync(join(FIXTURES, 'stores-total.js'), 'utf8');

describe('parseStoreDocument', () => {
  const { publishedOn, stores } = parseStoreDocument(document);

  it('reads every shop the chain publishes', () => {
    expect(stores).toHaveLength(1675);
    expect(publishedOn).toBe('11-09-2026');
  });

  it('splits the two countries the way the chain declares them', () => {
    const byCountry = stores.reduce<Record<string, number>>((counts, store) => {
      counts[store.country] = (counts[store.country] ?? 0) + 1;
      return counts;
    }, {});
    expect(byCountry).toEqual({ es: 1599, pt: 76 });
    expect(parseStoreTotals(totals)).toEqual({ ES: 1599, PT: 76 });
  });

  it('states a postal code and a position on every one of them', () => {
    // This is the finding the plan rests on. Two thirds of OpenStreetMap's
    // supermarkets carry no postcode; not one of these is missing one.
    expect(stores.filter((store) => !store.postalCode)).toEqual([]);
    expect(
      stores.filter(
        (store) =>
          !Number.isFinite(store.latitude) || !Number.isFinite(store.longitude)
      )
    ).toEqual([]);
  });

  it('sits the Spanish shops on the postal codes the run will ask about', () => {
    const codes = new Set(
      stores.filter((store) => store.country === 'es').map((s) => s.postalCode)
    );
    // What section 3's arithmetic is built on: 1,599 shops, 1,137 questions.
    expect(codes.size).toBe(1137);
  });

  it('keeps the chain’s own fields as the chain stated them', () => {
    const store = stores.find((s) => s.externalRef === '283185314342');
    expect(store).toMatchObject({
      externalRef: '283185314342',
      postalCode: '15006',
      country: 'es',
      street: 'AV DA OZA, 134',
      city: 'A Coruña',
      province: 'A CORUÑA',
      phone: '981303071',
      parking: true,
      readyToEat: false,
      openedOn: '24/11/2011',
    });
    expect(store?.latitude).toBeCloseTo(43.35342592, 6);
    expect(store?.longitude).toBeCloseTo(-8.39317618, 6);
  });

  it('drops a record that states no position, because a place needs one', () => {
    const { stores: parsed } = parseStoreDocument(
      `var dataJson={"fechaCreacion":"11-09-2026","tiendasFull":[` +
        `{"p":"ES","cp":"14013","id":1,"lt":37.8,"lg":-4.7},` +
        `{"p":"ES","cp":"14013","id":2},` +
        `{"p":"ES","id":3,"lt":37.8,"lg":-4.7}]}`
    );
    expect(parsed.map((store) => store.externalRef)).toEqual(['1']);
  });

  it('refuses a document that is no longer one assignment', () => {
    expect(() => parseStoreDocument('<html>nope</html>')).toThrow(
      /did not parse as JSON/
    );
  });
});

describe('openingHoursLine', () => {
  // The document was written on Friday 2026-09-11, so the first slot is that
  // Friday and the seventh is the Thursday after it.
  it('counts the seven slots from the day the document was written', () => {
    expect(
      openingHoursLine(
        '11-09-2026',
        '0900#0900#C#0900#0900#0900#0900',
        '2130#2130#C#2130#2130#2130#2130'
      )
    ).toBe('Mo-Sa 09:00-21:30; Su off');
  });

  it('reads a holiday inside the window as a day the shop does not open', () => {
    // 2026-09-11 is Catalonia's national day and 234 of the 235 Catalan shops
    // were shut for it. The line says `Fr off`, which is true of that week and
    // not of the shop: it is a dated window, and the row is read by a person.
    expect(
      openingHoursLine(
        '11-09-2026',
        'C#0900#C#0900#0900#0900#0900',
        'C#2130#C#2130#2130#2130#2130'
      )
    ).toBe('Mo-Th 09:00-21:30; Fr off; Sa 09:00-21:30; Su off');
  });

  it('answers nothing when there is no date to count the window from', () => {
    expect(openingHoursLine(null, '0900#0900', '2130#2130')).toBeNull();
    expect(openingHoursLine('11-09-2026', null, null)).toBeNull();
  });
});

describe('MercadonaClient.listStores', () => {
  function stubFetch(bodies: Record<string, string>) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const body = bodies[String(url)];
      return body === undefined
        ? new Response('', { status: 404 })
        : new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('reads the shops and the counts to check them against', async () => {
    const { fetchImpl, calls } = stubFetch({
      'https://stores.test/data.js': document,
      'https://stores.test/data_total.js': totals,
    });

    const list = await MercadonaClient.listStores({
      userAgent: 'LunaShopperBot/1.0',
      storesUrl: 'https://stores.test/data.js',
      totalsUrl: 'https://stores.test/data_total.js',
      fetchImpl,
    });

    expect(list.stores).toHaveLength(1675);
    expect(list.declared).toEqual({ ES: 1599, PT: 76 });
    expect(list.publishedOn).toBe('11-09-2026');
    expect(calls).toHaveLength(2);
  });

  it('keeps the shops when the companion document cannot be read', async () => {
    // A check that could not be made is not a check that failed.
    const { fetchImpl } = stubFetch({
      'https://stores.test/data.js': document,
    });

    const list = await MercadonaClient.listStores({
      userAgent: 'LunaShopperBot/1.0',
      storesUrl: 'https://stores.test/data.js',
      totalsUrl: 'https://stores.test/data_total.js',
      fetchImpl,
    });

    expect(list.stores).toHaveLength(1675);
    expect(list.declared).toEqual({});
  });

  it('refuses to report nothing when the shop list itself is gone', async () => {
    const { fetchImpl } = stubFetch({});
    await expect(
      MercadonaClient.listStores({
        userAgent: 'LunaShopperBot/1.0',
        storesUrl: 'https://stores.test/data.js',
        fetchImpl,
      })
    ).rejects.toThrow(/store list answered 404/);
  });
});

describe('MercadonaClient.resolveWarehouse, on a code the chain does not serve', () => {
  it('answers null rather than failing the run', async () => {
    const fetchImpl = (async () =>
      new Response(
        '{"error_msg":"This zip code is outside of our working area"}',
        {
          status: 404,
        }
      )) as unknown as typeof fetch;

    await expect(
      MercadonaClient.resolveWarehouse('3750-136', {
        userAgent: 'LunaShopperBot/1.0',
        fetchImpl,
      })
    ).resolves.toBeNull();
  });

  it('waits on the gate the run hands it, once per request', async () => {
    let gated = 0;
    const fetchImpl = (async () =>
      new Response('', {
        status: 200,
        headers: { 'x-customer-wh': '4661' },
      })) as unknown as typeof fetch;

    await MercadonaClient.resolveWarehouse('14013', {
      userAgent: 'LunaShopperBot/1.0',
      fetchImpl,
      acquire: async () => {
        gated += 1;
      },
    });

    // 1,213 of these go out in one run, so the run's rate limit has to reach
    // them the same way it reaches the walk.
    expect(gated).toBe(1);
  });
});
