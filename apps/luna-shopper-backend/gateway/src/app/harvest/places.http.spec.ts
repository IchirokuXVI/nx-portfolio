import { Test } from '@nestjs/testing';
import {
  DISCOVERED_PLACE_PATTERNS,
  PlaceMatchRung,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  PLACE_CANDIDATES_DETAIL,
  PlaceAlreadyImportedException,
  PlaceMatchesLocationException,
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
        label: { es: 'Mercadona Libertador' },
        address: 'Avenida del Libertador 5',
        postalCode: '14013',
        rung: PlaceMatchRung.ADDRESS,
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
