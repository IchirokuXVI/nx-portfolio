import { Test } from '@nestjs/testing';
import { SOURCE_ENTRY_PATTERNS } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestItemsController } from './harvest.controller';

/**
 * The source rows of one product, over real HTTP (plan 0160).
 *
 * The gateway adds nothing to the answer. What this checks is the route, the
 * payload the harvester is asked with, and that the published document
 * carries `eanSharedBy` on every row.
 */

const ITEM = '11111111-1111-4111-8111-111111111160';

const PAGE = {
  items: [{ id: 'e1', itemId: ITEM, eanSharedBy: 2 }],
  nextCursor: null,
};

async function boot() {
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminHarvestItemsController],
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

describe('the source rows of one product (plan 0160)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('asks the harvester for the product, paged, and answers what it said', async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/items/${ITEM}/entries?limit=25&cursor=abc`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PAGE);
    expect(context.sent).toEqual([
      {
        subject: SOURCE_ENTRY_PATTERNS.listByItem,
        payload: {
          userId: 'admin-1',
          adminToken: 'operator-token',
          itemId: ITEM,
          cursor: 'abc',
          limit: 25,
        },
      },
    ]);
  });

  it('refuses a product id that is not a uuid, and sends nothing', async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/items/dorada/entries`
    );

    expect(response.status).toBe(400);
    expect(context.sent).toHaveLength(0);
  });

  it('publishes eanSharedBy as a required field of every row', () => {
    const { schemas } = readDocument();

    expect(schemas['harvest.ItemSourceEntryView'].required).toContain(
      'eanSharedBy'
    );
    expect(schemas['harvest.ItemSourceEntryView'].required).toContain('status');
  });
});

describe('the settlements of a basket row (plan 0160)', () => {
  it('publishes settlements on every admin basket row, with the paid price', () => {
    const { schemas } = readDocument();

    expect(schemas['admin-core.AdminBasketRowView'].required).toContain(
      'settlements'
    );
    expect(schemas['admin-core.AdminBasketSettlementView'].required).toEqual(
      expect.arrayContaining([
        'outcome',
        'quantity',
        'pricePaidCents',
        'priceScopeId',
        'supermarketLocationId',
        'settledByUserId',
        'settledByParticipantId',
      ])
    );
  });
});

function readDocument() {
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
  return document.components;
}
