import { Test } from '@nestjs/testing';
import {
  DISCOVERED_PLACE_PATTERNS,
  DiscoveredPlaceStatus,
  PlaceLinkField,
  SUPERMARKET_LOCATION_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { AdminHarvestPlacesController } from '../harvest/harvest.controller';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogLocationsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';

/**
 * A shop reference that another shop holds, over real HTTP (plan 0194).
 *
 * Catalog refuses it, and the refusal reaches the gateway as the problem
 * object that crossed NATS, never as an exception class. What is proved here
 * is that the gateway answers that object as it came: the status, the code
 * and the shop in `details`, on each route a person can reach it through.
 */

const CHAIN = '33333333-3333-4333-8333-333333333194';
const SHOP = '22222222-2222-4222-8222-222222222194';
const PLACE = '11111111-1111-4111-8111-111111111194';
const REF = 'node/1156230891';

const HELD_BY = {
  supermarketLocationId: '44444444-4444-4444-8444-444444444194',
  supermarketId: CHAIN,
  supermarketName: { es: 'Dia' },
  label: null,
  address: 'Gran Vía 1',
  city: 'Córdoba',
  externalProvider: 'OSM',
};

/** The refusal of catalog, as `NatsClient.send` rejects with it. */
const REFUSED = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  code: 'location_external_ref_taken',
  message: 'Another shop already holds that external reference.',
  detail: `Shop ${HELD_BY.supermarketLocationId} already holds the external reference ${REF}.`,
  correlationId: 'from-catalog',
  details: { externalRef: REF, heldBy: HELD_BY },
};

async function boot(answers: Record<string, unknown> = {}) {
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogSupermarketsController,
        AdminCatalogLocationsController,
        AdminHarvestPlacesController,
      ],
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

function send(
  origin: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const refuse = () => {
  throw REFUSED;
};

describe('a shop reference that another shop holds (plan 0194)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  async function expectRefusal(response: Response): Promise<void> {
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 409,
      code: 'location_external_ref_taken',
      details: { externalRef: REF, heldBy: HELD_BY },
    });
  }

  it('answers 409 with the holder when a new shop names it', async () => {
    context = await boot({ [SUPERMARKET_LOCATION_PATTERNS.create]: refuse });

    await expectRefusal(
      await send(
        context.origin,
        'POST',
        `/v1/admin/catalog/supermarkets/${CHAIN}/locations`,
        { externalRef: REF, externalProvider: 'OSM' }
      )
    );
  });

  it('answers 409 with the holder when an edit of a shop names it', async () => {
    context = await boot({ [SUPERMARKET_LOCATION_PATTERNS.update]: refuse });

    await expectRefusal(
      await send(
        context.origin,
        'PATCH',
        `/v1/admin/catalog/locations/${SHOP}`,
        {
          externalRef: REF,
        }
      )
    );
  });

  it('answers 409 with the holder when an import of a place meets it', async () => {
    context = await boot({ [DISCOVERED_PLACE_PATTERNS.import]: refuse });

    await expectRefusal(
      await send(
        context.origin,
        'POST',
        `/v1/admin/harvest/places/${PLACE}/import`,
        {}
      )
    );
  });

  it('answers a link that left the reference empty, with the holder', async () => {
    const linked = {
      place: {
        id: PLACE,
        status: DiscoveredPlaceStatus.IMPORTED,
        supermarketLocationId: SHOP,
      },
      filled: [PlaceLinkField.ADDRESS],
      refHeldBy: HELD_BY,
    };
    context = await boot({ [DISCOVERED_PLACE_PATTERNS.link]: linked });

    const response = await send(
      context.origin,
      'POST',
      `/v1/admin/harvest/places/${PLACE}/link`,
      { supermarketLocationId: SHOP }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(linked);
  });
});
