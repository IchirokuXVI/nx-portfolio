import { Test } from '@nestjs/testing';
import {
  DISCOVERED_PLACE_PATTERNS,
  DiscoveredPlaceStatus,
  PlaceLinkField,
  PlaceMatchRung,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  PLACE_CANDIDATES_DETAIL,
  PLACE_CHAIN_DETAIL,
  PlaceAlreadyImportedException,
  PlaceMatchesLocationException,
  PlaceNamesAnotherChainException,
  SCOPE_KEY_DETAIL,
  ScopeNotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestPlacesController } from './harvest.controller';

/**
 * The places queue routes over real HTTP (plan 0152).
 *
 * Over HTTP because what these check is what the pipe and the filter do: the
 * body a route accepts, and the `details` a refusal carries to the back office.
 */

const PLACE = '11111111-1111-4111-8111-111111111152';
const LOCATION = '22222222-2222-4222-8222-222222222152';
const CHAIN = '33333333-3333-4333-8333-333333333193';

async function boot(answers: Record<string, unknown> = {}) {
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminHarvestPlacesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              const answer = answers[subject];
              return typeof answer === 'function'
                ? (answer as () => unknown)()
                : (answer ?? {});
            },
          },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = {
            adminId: 'admin-1',
            token: 'operator-token',
          };
          return true;
        },
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  const logger = {
    setContext: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  nest.useGlobalFilters(
    new GlobalExceptionFilter(
      logger as unknown as ConstructorParameters<
        typeof GlobalExceptionFilter
      >[0]
    )
  );
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the places queue routes (plan 0152)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('links a place to a shop with the operator’s credential', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: LOCATION }
    );

    expect(response.status).toBe(201);
    expect(context.sent).toEqual([
      {
        subject: DISCOVERED_PLACE_PATTERNS.link,
        payload: {
          userId: 'admin-1',
          adminToken: 'operator-token',
          placeId: PLACE,
          supermarketLocationId: LOCATION,
        },
      },
    ]);
  });

  it('refuses a link that names no shop', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      {}
    );

    expect(response.status).toBe(400);
    expect(context.sent).toEqual([]);
  });

  it('forwards force on import', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/import`,
      { force: true }
    );

    expect(response.status).toBe(201);
    expect(context.sent[0]?.payload).toMatchObject({
      placeId: PLACE,
      force: true,
    });
  });

  it('answers 409 place_matches_location with the candidates', async () => {
    const candidates = [
      {
        supermarketLocationId: LOCATION,
        supermarketId: CHAIN,
        label: { es: 'Mercadona Libertador' },
        address: 'Avenida del Libertador 5',
        city: 'Córdoba',
        postalCode: '14013',
        rung: PlaceMatchRung.ADDRESS,
        metres: null,
      },
    ];
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.import]: () => {
        throw new PlaceMatchesLocationException('A shop may be this place.', {
          details: { [PLACE_CANDIDATES_DETAIL]: candidates },
        });
      },
    });

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/import`,
      {}
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'place_matches_location',
      details: { candidates },
    });
  });

  it('answers 409 scope_not_found with the key', async () => {
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.import]: () => {
        throw new ScopeNotFoundException('No scope 4661.', {
          details: { [SCOPE_KEY_DETAIL]: '4661' },
        });
      },
    });

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/import`,
      {}
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'scope_not_found',
      details: { scopeKey: '4661' },
    });
  });

  it('answers a link with the place and what was filled (plan 0193)', async () => {
    const result = {
      place: { id: PLACE, status: DiscoveredPlaceStatus.IMPORTED },
      filled: [PlaceLinkField.ADDRESS, PlaceLinkField.CITY],
    };
    context = await boot({ [DISCOVERED_PLACE_PATTERNS.link]: result });

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: LOCATION }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
  });

  it('forwards acrossChains on a link (plan 0193)', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: LOCATION, acrossChains: true }
    );

    expect(response.status).toBe(201);
    expect(context.sent[0]?.payload).toEqual({
      userId: 'admin-1',
      adminToken: 'operator-token',
      placeId: PLACE,
      supermarketLocationId: LOCATION,
      acrossChains: true,
    });
  });

  it('refuses an acrossChains that is not a boolean', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: LOCATION, acrossChains: 'false' }
    );

    expect(response.status).toBe(400);
    expect(context.sent).toEqual([]);
  });

  it('answers 409 place_names_another_chain with the chain (plan 0193)', async () => {
    const chain = { id: CHAIN, name: { es: 'Dia' } };
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.link]: () => {
        throw new PlaceNamesAnotherChainException('Another chain.', {
          details: { [PLACE_CHAIN_DETAIL]: chain },
        });
      },
    });

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: LOCATION }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'place_names_another_chain',
      details: { chain },
    });
  });

  it('asks for the dry answer of the bulk link when apply is absent', async () => {
    const dry = { applied: false, linked: [], skipped: [] };
    context = await boot({ [DISCOVERED_PLACE_PATTERNS.linkByRef]: dry });

    const response = await post(
      context.origin,
      '/v1/admin/harvest/places/link-by-ref',
      {}
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(dry);
    expect(context.sent).toEqual([
      {
        subject: DISCOVERED_PLACE_PATTERNS.linkByRef,
        payload: {
          userId: 'admin-1',
          adminToken: 'operator-token',
          apply: undefined,
        },
      },
    ]);
  });

  it('forwards apply on the bulk link', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      '/v1/admin/harvest/places/link-by-ref',
      { apply: true }
    );

    expect(response.status).toBe(201);
    expect(context.sent[0]).toMatchObject({
      subject: DISCOVERED_PLACE_PATTERNS.linkByRef,
      payload: { apply: true },
    });
  });

  it('does not take the bulk route for a place called link-by-ref', async () => {
    // One segment after `places`, where every `:id` route has two. Proved
    // over HTTP because a reordered controller is where this would break.
    context = await boot();

    await post(context.origin, '/v1/admin/harvest/places/link-by-ref', {
      apply: true,
    });

    expect(context.sent.map((call) => call.subject)).toEqual([
      DISCOVERED_PLACE_PATTERNS.linkByRef,
    ]);
  });

  it('refuses an apply that is not a boolean, and a field it does not know', async () => {
    context = await boot();

    // The pipe converts implicitly, and `Boolean('false')` is true. A string
    // must never become the word that makes this call write.
    for (const apply of ['false', 'true', 'no', 0, 1]) {
      const worded = await post(
        context.origin,
        '/v1/admin/harvest/places/link-by-ref',
        { apply }
      );
      expect([apply, worded.status]).toEqual([apply, 400]);
    }
    const unknown = await post(
      context.origin,
      '/v1/admin/harvest/places/link-by-ref',
      { apply: true, metres: 250 }
    );

    expect(unknown.status).toBe(400);
    expect(context.sent).toEqual([]);
  });

  it('forwards apply: false as false', async () => {
    context = await boot();

    const response = await post(
      context.origin,
      '/v1/admin/harvest/places/link-by-ref',
      { apply: false }
    );

    expect(response.status).toBe(201);
    expect(context.sent[0]?.payload['apply']).toBe(false);
  });

  it('forwards country and postalCode on the list (plan 0193)', async () => {
    // Both were on the query DTO and neither reached the harvester, so the
    // places queue of a postal code showed the places of every code.
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.list]: { items: [], nextCursor: null },
    });

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/places` +
        '?country=es&postalCode=14013&status=NEW&limit=20'
    );

    expect(response.status).toBe(200);
    expect(context.sent).toEqual([
      {
        subject: DISCOVERED_PLACE_PATTERNS.list,
        payload: {
          userId: 'admin-1',
          adminToken: 'operator-token',
          runId: undefined,
          brandKey: undefined,
          status: DiscoveredPlaceStatus.NEW,
          country: 'es',
          postalCode: '14013',
          cursor: undefined,
          limit: 20,
        },
      },
    ]);
  });

  it('sends neither filter when the list names none', async () => {
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.list]: { items: [], nextCursor: null },
    });

    await fetch(`${context.origin}/v1/admin/harvest/places`);

    expect(context.sent[0]?.payload['country']).toBeUndefined();
    expect(context.sent[0]?.payload['postalCode']).toBeUndefined();
  });

  it('answers 409 place_already_imported on a reject', async () => {
    context = await boot({
      [DISCOVERED_PLACE_PATTERNS.reject]: () => {
        throw new PlaceAlreadyImportedException('Already imported.');
      },
    });

    const response = await post(
      context.origin,
      `/v1/admin/harvest/places/${PLACE}/reject`,
      {}
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'place_already_imported',
    });
  });
});
