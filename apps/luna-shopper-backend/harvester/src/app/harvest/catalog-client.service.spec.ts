import type { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import {
  ITEM_PRICE_PATTERNS,
  PriceSourceKind,
  SUPERMARKET_ITEM_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { of } from 'rxjs';
import { CatalogClient } from './catalog-client.service';

const ACTOR = 'ac700000-0000-4000-a000-000000000001';
const RUN = '33333333-3333-4333-8333-333333333333';

/**
 * The two price writes a run makes (plan 0080, section 9): what subject each
 * one reaches, and what it carries. A record's payload is what catalog
 * validates against the contract, so the shape here is the shape that matters.
 */
describe('CatalogClient price writes (plan 0080)', () => {
  function build() {
    const send = jest.fn(() => of({ inserted: 1, confirmed: 0 }));
    const client = { send } as unknown as ClientProxy;
    const config = {
      getOrThrow: () => ({ actorId: ACTOR }),
    } as unknown as ConfigService;
    return { client: new CatalogClient(client, config), send };
  }

  function payloadOf(send: jest.Mock): Record<string, unknown> {
    const [, record] = send.mock.calls[0] as [string, { data: unknown }];
    return record.data as Record<string, unknown>;
  }

  it('addPrices writes one kind for one scope, stamped with the run', async () => {
    const { client, send } = build();

    const result = await client.addPrices(
      'scope-1',
      [{ itemId: 'i1', price: 1.19, currency: 'EUR' }],
      RUN
    );

    expect(result).toEqual({ inserted: 1, confirmed: 0 });
    expect(send.mock.calls[0][0]).toBe(ITEM_PRICE_PATTERNS.addBatch);
    expect(payloadOf(send)).toEqual({
      userId: ACTOR,
      priceScopeId: 'scope-1',
      sourceKind: PriceSourceKind.OFFICIAL_API,
      sourceRunId: RUN,
      entries: [{ itemId: 'i1', price: 1.19, currency: 'EUR' }],
    });
  });

  it('setAvailability is a separate write that carries no price', async () => {
    const { client, send } = build();

    await client.setAvailability('scope-1', [
      { itemId: 'i1', available: false },
    ]);

    expect(send.mock.calls[0][0]).toBe(
      SUPERMARKET_ITEM_PATTERNS.setAvailability
    );
    expect(payloadOf(send)).toEqual({
      userId: ACTOR,
      priceScopeId: 'scope-1',
      entries: [{ itemId: 'i1', available: false }],
    });
  });

  it('refuses to write anonymously when no actor is configured', async () => {
    const config = {
      getOrThrow: () => ({ actorId: '' }),
    } as unknown as ConfigService;
    const client = new CatalogClient(
      { send: jest.fn() } as unknown as ClientProxy,
      config
    );
    // Thrown before anything is sent, synchronously: there is no promise to
    // reject because no request is ever built.
    expect(() => client.addPrices('scope-1', [], RUN)).toThrow(
      /HARVESTER_ACTOR_ID/
    );
  });
});
