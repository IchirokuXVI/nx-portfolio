import { ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  BULK_DECISION_MAX_OPERATIONS,
  ItemCategory,
  SourceEntryStatus,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import {
  AdminCatalogItemsController,
  AdminCatalogProductGroupsController,
} from '../catalog/catalog-admin.controller';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestEntriesController } from './harvest.controller';
import { bodyParserProblems, jsonBodyParsers } from './import-body';

/**
 * The three bulk decision routes over real HTTP (plan 0100).
 *
 * Over the wire rather than by calling the handler, because the two things
 * worth asserting happen **before** the handler runs: the cap, which is a
 * validator on the body, and the body limit those routes needed to have a cap
 * at all. A thousand operations is a few hundred kilobytes, and the gateway's
 * default JSON limit is 100 KB, so without a parser of their own every file
 * near the published maximum would be refused as too large for a route that
 * says it accepts it.
 */

const ENTRY = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SEEN = '2026-09-10T09:00:00.000Z';

const IMPORT_CAP = 8 * 1024;
const BULK_CAP = 2 * 1024 * 1024;
const DEFAULT_CAP = 1024;

function accept(entryId: string) {
  return {
    op: 'accept',
    entryId,
    itemId: ITEM,
    expect: { status: SourceEntryStatus.UNRESOLVED, lastSeenAt: SEEN },
  };
}

function uuid(index: number): string {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
}

async function boot() {
  const send = jest.fn(async () => ({ applied: true, operations: [] }));

  const moduleRef = await Test.createTestingModule({
    controllers: [
      AdminHarvestEntriesController,
      AdminCatalogItemsController,
      AdminCatalogProductGroupsController,
    ],
    providers: [
      { provide: NatsClient, useValue: { send } },
      {
        provide: APP_FILTER,
        useValue: {
          catch: (error: unknown, host: { switchToHttp: () => never }) => {
            const http = host.switchToHttp() as unknown as {
              getResponse: () => {
                status: (code: number) => { json: (body: unknown) => void };
              };
            };
            const status = (error as { status?: number }).status ?? 500;
            const response = (error as { response?: { message?: string[] } })
              .response;
            http
              .getResponse()
              .status(status)
              .json({
                code:
                  status === 400
                    ? ERROR_CODES.VALIDATION_FAILED
                    : ERROR_CODES.INTERNAL,
                errors: response?.message ?? [],
              });
          },
        },
      },
    ],
  })
    .overrideGuard(AdminJwtGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => Record<string, unknown> };
      }) => {
        context.switchToHttp().getRequest()['user'] = {
          adminUserId: 'operator-1',
          token: 'the-operators-own-token',
        };
        return true;
      },
    })
    .compile();

  const nest = moduleRef.createNestApplication({ bodyParser: false });
  enableApiVersioning(nest);
  const limits = {
    importMaxBytes: IMPORT_CAP,
    bulkMaxBytes: BULK_CAP,
    defaultMaxBytes: DEFAULT_CAP,
  };
  for (const parser of jsonBodyParsers(limits)) {
    if (parser.path) {
      nest.use(parser.path, parser.handler);
    } else {
      nest.use(parser.handler);
    }
  }
  nest.use(bodyParserProblems(limits));
  nest.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, send, origin: `http://127.0.0.1:${port}` };
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the bulk decision routes', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    context = await boot();
  });

  afterAll(async () => {
    await context.nest.close();
  });

  beforeEach(() => {
    context.send.mockClear();
  });

  describe('POST /v1/admin/harvest/entries/decisions', () => {
    const PATH = '/v1/admin/harvest/entries/decisions';

    it('forwards the file, with the operator’s own credential', async () => {
      const response = await post(context.origin, PATH, {
        operations: [accept(ENTRY)],
      });

      expect(response.status).toBe(201);
      const [subject, payload] = context.send.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(subject).toBe('sourceEntry.applyDecisions');
      expect(payload['operations']).toHaveLength(1);
      expect(payload['adminToken']).toBe('the-operators-own-token');
    });

    it('accepts a file at the published maximum, which the default body limit would refuse', async () => {
      const operations = Array.from(
        { length: BULK_DECISION_MAX_OPERATIONS },
        (_value, index) => accept(uuid(index))
      );
      // The point of the route's own parser: this body is far over the 1 KB
      // default every other route on this gateway is held to.
      expect(JSON.stringify({ operations }).length).toBeGreaterThan(
        DEFAULT_CAP
      );

      const response = await post(context.origin, PATH, { operations });

      expect(response.status).toBe(201);
      expect(context.send).toHaveBeenCalledTimes(1);
    });

    it('refuses one operation over the cap, and never reaches the broker', async () => {
      const response = await post(context.origin, PATH, {
        operations: Array.from(
          { length: BULK_DECISION_MAX_OPERATIONS + 1 },
          (_value, index) => accept(uuid(index))
        ),
      });

      expect(response.status).toBe(400);
      // Refused whole. A gateway that chunked here would break the promise the
      // route exists to make.
      expect(context.send).not.toHaveBeenCalled();
    });

    it('refuses an empty file and an unknown kind', async () => {
      expect(
        (await post(context.origin, PATH, { operations: [] })).status
      ).toBe(400);
      expect(
        (
          await post(context.origin, PATH, {
            operations: [{ ...accept(ENTRY), op: 'reject' }],
          })
        ).status
      ).toBe(400);
      expect(context.send).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/admin/catalog/items/batch', () => {
    const PATH = '/v1/admin/catalog/items/batch';

    function product() {
      return {
        name: { es: 'Leche' },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      };
    }

    it('forwards the products it was given', async () => {
      const response = await post(context.origin, PATH, {
        items: [product(), product()],
      });

      expect(response.status).toBe(201);
      const [subject, payload] = context.send.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(subject).toBe('item.createMany');
      expect(payload['items']).toHaveLength(2);
    });

    it('refuses a list over the cap', async () => {
      const response = await post(context.origin, PATH, {
        items: Array.from(
          { length: BULK_DECISION_MAX_OPERATIONS + 1 },
          product
        ),
      });

      expect(response.status).toBe(400);
      expect(context.send).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/admin/catalog/product-groups/assignments', () => {
    const PATH = '/v1/admin/catalog/product-groups/assignments';

    it('forwards the operations it was given', async () => {
      const response = await post(context.origin, PATH, {
        operations: [
          {
            op: 'createGroup',
            ref: 'milk',
            name: { es: 'Leche' },
            slug: 'milk',
            referenceUnit: UnitOfMeasure.LITER,
          },
          {
            op: 'assignItem',
            itemId: ITEM,
            groupRef: 'milk',
            expect: { productGroupId: null },
          },
        ],
      });

      expect(response.status).toBe(201);
      const [subject, payload] = context.send.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(subject).toBe('productGroup.applyAssignments');
      expect(payload['operations']).toHaveLength(2);
    });

    it('refuses a list over the cap', async () => {
      const response = await post(context.origin, PATH, {
        operations: Array.from(
          { length: BULK_DECISION_MAX_OPERATIONS + 1 },
          (_value, index) => ({
            op: 'assignItem',
            itemId: uuid(index),
            groupId: ITEM,
            expect: { productGroupId: null },
          })
        ),
      });

      expect(response.status).toBe(400);
      expect(context.send).not.toHaveBeenCalled();
    });
  });
});
