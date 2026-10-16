import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  ITEM_LINKED_IMAGE_PATTERNS,
  ITEM_PATTERNS,
  ItemImageSource,
  SUPERMARKET_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogItemsController,
  AdminCatalogLinkedImagesController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';

/**
 * The three routes of a chain photo, over real HTTP (plan 0198, section 4).
 *
 * Over HTTP rather than as function calls, for the reason
 * `catalog-admin-query.http.spec.ts` sets out: the validation pipe and the
 * global filter make the status, and a handler called as a function never
 * meets either.
 *
 * What is asserted is what the gateway owns: the path, the guard, the body it
 * accepts, and the message it sends. Whether a product answers a photo is
 * catalog's decision, and `item-linked-images.integration.spec.ts` proves it.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

const CHAIN_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ROW_ID = '33333333-3333-4333-8333-333333333333';
const PHOTO = 'https://prod-mercadona.imgix.net/images/4241.jpg';

async function boot(answers: Record<string, unknown> = {}) {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogSupermarketsController,
        AdminCatalogItemsController,
        AdminCatalogLinkedImagesController,
      ],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return answers[subject] ?? { id: CHAIN_ID };
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

function call(
  origin: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('a chain photo, over HTTP (plan 0198)', () => {
  it('guards all three routes with the operator guard', () => {
    for (const controller of [
      AdminCatalogSupermarketsController,
      AdminCatalogItemsController,
      AdminCatalogLinkedImagesController,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        AdminJwtGuard,
      ]);
    }
  });

  describe('PUT /v1/admin/catalog/supermarkets/:id/linked-images', () => {
    it('sends the switch of that chain, with the operator token', async () => {
      const chain = {
        id: CHAIN_ID,
        name: { es: 'Mercadona' },
        linkedImagesEnabled: true,
      };
      const { nest, sent, origin } = await boot({
        [SUPERMARKET_PATTERNS.setLinkedImagesEnabled]: chain,
      });
      try {
        const res = await call(
          origin,
          'PUT',
          `/v1/admin/catalog/supermarkets/${CHAIN_ID}/linked-images`,
          { enabled: true }
        );

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(chain);
        expect(sent).toEqual([
          {
            subject: SUPERMARKET_PATTERNS.setLinkedImagesEnabled,
            payload: {
              userId: 'admin-1',
              adminToken: 'operator-token',
              supermarketId: CHAIN_ID,
              enabled: true,
            },
          },
        ]);
      } finally {
        await nest.close();
      }
    });

    it('turns it off with the same route', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const res = await call(
          origin,
          'PUT',
          `/v1/admin/catalog/supermarkets/${CHAIN_ID}/linked-images`,
          { enabled: false }
        );

        expect(res.status).toBe(200);
        expect(sent[0].payload['enabled']).toBe(false);
      } finally {
        await nest.close();
      }
    });

    it.each([
      ['no body', undefined],
      ['a word for the flag', { enabled: 'yes' }],
      // The pipe's implicit conversion would read this string as true.
      ['the string "false"', { enabled: 'false' }],
      ['a number', { enabled: 0 }],
      ['a field it does not know', { enabled: true, all: true }],
    ])('answers 400 for %s, and sends nothing', async (_what, body) => {
      const { nest, sent, origin } = await boot();
      try {
        const res = await call(
          origin,
          'PUT',
          `/v1/admin/catalog/supermarkets/${CHAIN_ID}/linked-images`,
          body
        );

        expect(res.status).toBe(400);
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    });

    it('answers 400 for an id that is not a uuid, and sends nothing', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const res = await call(
          origin,
          'PUT',
          '/v1/admin/catalog/supermarkets/mercadona/linked-images',
          { enabled: true }
        );

        expect(res.status).toBe(400);
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    });
  });

  describe('POST /v1/admin/catalog/linked-images/disable-all', () => {
    it('stops every chain with no body, and answers what changed', async () => {
      const { nest, sent, origin } = await boot({
        [ITEM_LINKED_IMAGE_PATTERNS.disableAll]: {
          supermarkets: 3,
          items: 4120,
        },
      });
      try {
        const res = await call(
          origin,
          'POST',
          '/v1/admin/catalog/linked-images/disable-all'
        );

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ supermarkets: 3, items: 4120 });
        expect(sent).toEqual([
          {
            subject: ITEM_LINKED_IMAGE_PATTERNS.disableAll,
            payload: { userId: 'admin-1', adminToken: 'operator-token' },
          },
        ]);
      } finally {
        await nest.close();
      }
    });
  });

  describe('GET /v1/admin/catalog/items/:id/linked-images', () => {
    it('answers every saved link of the product, of chains that are off too', async () => {
      const images = {
        images: [
          {
            sourceEntryId: ROW_ID,
            supermarketId: CHAIN_ID,
            url: PHOTO,
            enabled: false,
            firstLinkedAt: '2026-10-11T08:00:00.000Z',
            lastSeenAt: '2026-10-11T08:00:00.000Z',
          },
        ],
      };
      const { nest, sent, origin } = await boot({
        [ITEM_LINKED_IMAGE_PATTERNS.listByItem]: images,
      });
      try {
        const res = await call(
          origin,
          'GET',
          `/v1/admin/catalog/items/${ITEM_ID}/linked-images`
        );

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(images);
        expect(sent).toEqual([
          {
            subject: ITEM_LINKED_IMAGE_PATTERNS.listByItem,
            payload: {
              userId: 'admin-1',
              adminToken: 'operator-token',
              itemId: ITEM_ID,
            },
          },
        ]);
      } finally {
        await nest.close();
      }
    });
  });

  describe('a product read', () => {
    it('answers the photo fields catalog gave it, unchanged', async () => {
      const product = {
        id: ITEM_ID,
        name: { es: 'Leche' },
        imageUrl: PHOTO,
        imageSource: ItemImageSource.CHAIN,
        imageSupermarketId: CHAIN_ID,
        ownImageUrl: null,
        images: [
          {
            url: PHOTO,
            source: ItemImageSource.CHAIN,
            supermarketId: CHAIN_ID,
          },
        ],
      };
      const { nest, origin } = await boot({ [ITEM_PATTERNS.get]: product });
      try {
        const res = await call(
          origin,
          'GET',
          `/v1/admin/catalog/items/${ITEM_ID}`
        );

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(product);
      } finally {
        await nest.close();
      }
    });
  });
});
