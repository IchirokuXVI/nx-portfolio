import { Test } from '@nestjs/testing';
import {
  ItemSourceMatch,
  SOURCE_LOCATION_PATTERNS,
  SourceLocationStatus,
  type SourceLocationPage,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestShopsController } from './harvest.controller';

/**
 * The shop queue over real HTTP (plan 0154).
 *
 * The gateway adds nothing to the answer. What this checks is that the
 * candidates the harvester proposes reach the back office unchanged, and that
 * the published document says the field is there.
 */

const CHAIN = '11111111-1111-4111-8111-111111111154';
const LOCATION = '22222222-2222-4222-8222-222222222154';

const PAGE: SourceLocationPage = {
  items: [
    {
      id: '33333333-3333-4333-8333-333333333154',
      supermarketId: CHAIN,
      externalId: 'T4',
      printedName: 'Isla Fuerteventura',
      supermarketLocationId: null,
      status: SourceLocationStatus.UNMAPPED,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      firstSeenAt: '2026-09-23T13:00:28.315Z',
      lastSeenAt: '2026-09-23T13:00:28.315Z',
      firstRunId: null,
      lastRunId: null,
      candidates: [
        {
          supermarketLocationId: LOCATION,
          label: null,
          address: 'Calle Isla de Fuerteventura 48',
          postalCode: '14011',
          score: 1,
          strong: true,
        },
      ],
    },
  ],
  nextCursor: null,
};

async function boot() {
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminHarvestShopsController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return PAGE;
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

describe('the shop queue, the candidates field (plan 0154)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('answers the harvester’s candidates unchanged', async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/shops?supermarketId=${CHAIN}&status=UNMAPPED`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PAGE);
    expect(context.sent).toEqual([
      {
        subject: SOURCE_LOCATION_PATTERNS.list,
        payload: expect.objectContaining({
          supermarketId: CHAIN,
          status: SourceLocationStatus.UNMAPPED,
        }),
      },
    ]);
  });

  it('publishes candidates as a required field of every shop', () => {
    const document = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
        'utf8'
      )
    ) as {
      components: {
        schemas: Record<
          string,
          { required?: string[]; properties?: Record<string, unknown> }
        >;
      };
    };
    const { schemas } = document.components;

    expect(schemas['harvest.SourceLocationView'].required).toContain(
      'candidates'
    );
    expect(
      schemas['harvest.SourceLocationView'].properties?.['candidates']
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/harvest.SourceLocationCandidate' },
    });
    expect(schemas['harvest.SourceLocationCandidate'].required).toEqual([
      'supermarketLocationId',
      'label',
      'address',
      'postalCode',
      'score',
      'strong',
    ]);
  });
});
