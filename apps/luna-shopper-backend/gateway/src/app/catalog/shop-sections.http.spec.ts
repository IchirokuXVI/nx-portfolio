import { Test } from '@nestjs/testing';
import { SECTION_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogLocationsController,
  AdminCatalogSectionsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';
import {
  CatalogLocationSectionsController,
  CatalogLocationsController,
} from './catalog.controller';

/**
 * Shop sections over real HTTP (plan 0167, section 4, as plan 0200 left it:
 * a section is created under its shop, and a chain has no section route).
 *
 * Over HTTP rather than as handler calls because what has to be true is that a
 * request **reaches** the handler through the gateway's real validation pipe,
 * and that the one public read is reachable with no token at all. The broker is
 * a stub that records what it was asked; catalog's answers are not what is
 * under test here.
 */

const CHAIN = '7e2a1b3c-4d5e-4f6a-9b8c-1d2e3f4a5b6c';
const SHOP = '5c7e9a1b-3d5f-4a7b-9c1d-3e5f7a9b1c3d';
const SECTION_A = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SECTION_B = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const PIZZA = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const MILK = '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a';
const CATEGORY = '5e6f7a8b-9c0d-5e1f-8a3b-4c5d6e7f8a9b';

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

async function boot() {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogSupermarketsController,
        AdminCatalogLocationsController,
        AdminCatalogSectionsController,
        CatalogLocationsController,
        CatalogLocationSectionsController,
      ],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return { sections: [] };
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
            token: 'token',
          };
          return true;
        },
      })
      // Nobody holds a velista token here, so every guarded shopper read
      // refuses: the public read answering at all is the proof it has no guard.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

type Booted = Awaited<ReturnType<typeof boot>>;

async function withApp(run: (app: Booted) => Promise<void>): Promise<void> {
  const app = await boot();
  try {
    await run(app);
  } finally {
    await app.nest.close();
  }
}

function send(
  origin: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('shop sections over HTTP (plans 0167 and 0200)', () => {
  describe('GET /v1/catalog/locations/:id/sections is public', () => {
    it('answers with no token, and asks catalog for the shop alone', async () => {
      await withApp(async ({ origin, sent }) => {
        const res = await send(
          origin,
          'GET',
          `/v1/catalog/locations/${SHOP}/sections`
        );

        expect(res.status).toBe(200);
        // The shop's own sections, and nothing that says where they came from.
        expect(await res.json()).toEqual({ sections: [] });
        // No userId: a guest reading a shared basket has none to send.
        expect(sent).toEqual([
          {
            subject: SECTION_PATTERNS.forLocation,
            payload: { supermarketLocationId: SHOP },
          },
        ]);
      });
    });

    it('leaves its neighbours on the same path guarded', async () => {
      await withApp(async ({ origin, sent }) => {
        const res = await send(origin, 'GET', `/v1/catalog/locations/${SHOP}`);

        expect(res.status).toBe(403);
        expect(sent).toEqual([]);
      });
    });

    it('refuses an id that is not a uuid before catalog is asked', async () => {
      await withApp(async ({ origin, sent }) => {
        const res = await send(
          origin,
          'GET',
          '/v1/catalog/locations/not-a-shop/sections'
        );

        expect(res.status).toBe(400);
        expect(sent).toEqual([]);
      });
    });
  });

  describe('a shop’s sections', () => {
    it('creates one under its shop, with the shop from the path', async () => {
      await withApp(async ({ origin, sent }) => {
        const res = await send(
          origin,
          'POST',
          `/v1/admin/catalog/locations/${SHOP}/sections`,
          {
            slug: 'pizzas',
            name: { es: 'Pizzas' },
            categoryIds: [CATEGORY],
          }
        );

        expect(res.status).toBe(201);
        expect(sent).toEqual([
          {
            subject: SECTION_PATTERNS.create,
            payload: {
              userId: 'admin-1',
              adminToken: 'token',
              supermarketLocationId: SHOP,
              slug: 'pizzas',
              name: { es: 'Pizzas' },
              categoryIds: [CATEGORY],
            },
          },
        ]);
      });
    });

    it('accepts a section that covers no category, and refuses a repeated one and a place', async () => {
      await withApp(async ({ origin, sent }) => {
        const path = `/v1/admin/catalog/locations/${SHOP}/sections`;
        const none = await send(origin, 'POST', path, {
          slug: 'middle-aisle',
          name: { es: 'Pasillo central' },
          categoryIds: [],
        });
        const twice = await send(origin, 'POST', path, {
          slug: 'frozen',
          name: { es: 'Congelados' },
          categoryIds: [CATEGORY, CATEGORY],
        });
        const missing = await send(origin, 'POST', path, {
          slug: 'frozen',
          name: { es: 'Congelados' },
        });
        // A new section goes after the last one: a create names no place.
        const placed = await send(origin, 'POST', path, {
          slug: 'frozen',
          name: { es: 'Congelados' },
          categoryIds: [],
          position: 0,
        });

        expect(none.status).toBe(201);
        expect(twice.status).toBe(400);
        expect(missing.status).toBe(400);
        expect(placed.status).toBe(400);
        expect(sent).toHaveLength(1);
      });
    });

    it('answers nothing under a chain: no section route and no pin route is left', async () => {
      await withApp(async ({ origin, sent }) => {
        const sections = `/v1/admin/catalog/supermarkets/${CHAIN}/sections`;
        const pins = `/v1/admin/catalog/supermarkets/${CHAIN}/item-sections`;
        const statuses = [
          (await send(origin, 'GET', sections)).status,
          (
            await send(origin, 'POST', sections, {
              slug: 'pizzas',
              name: { es: 'Pizzas' },
              categoryIds: [],
            })
          ).status,
          (await send(origin, 'GET', `${pins}?itemId=${PIZZA}`)).status,
          (
            await send(origin, 'PUT', pins, {
              itemId: PIZZA,
              sectionIds: [SECTION_A],
            })
          ).status,
        ];

        expect(statuses).toEqual([404, 404, 404, 404]);
        expect(sent).toEqual([]);
      });
    });

    it('reads, edits and deletes one at its own id; the slug is not editable', async () => {
      await withApp(async ({ origin, sent }) => {
        const path = `/v1/admin/catalog/sections/${SECTION_A}`;
        expect((await send(origin, 'GET', path)).status).toBe(200);
        expect(
          (
            await send(origin, 'PATCH', path, {
              position: 0,
              categoryIds: [CATEGORY],
            })
          ).status
        ).toBe(200);
        expect(
          (await send(origin, 'PATCH', path, { slug: 'renamed' })).status
        ).toBe(400);
        expect((await send(origin, 'DELETE', path)).status).toBe(200);

        expect(sent.map((message) => message.subject)).toEqual([
          SECTION_PATTERNS.get,
          SECTION_PATTERNS.update,
          SECTION_PATTERNS.delete,
        ]);
        expect(sent[1].payload).toMatchObject({
          sectionId: SECTION_A,
          position: 0,
          categoryIds: [CATEGORY],
        });
      });
    });
  });

  describe('the order of a shop', () => {
    it('reads it behind the operator’s guard, as the public read answers it', async () => {
      await withApp(async ({ origin, sent }) => {
        const res = await send(
          origin,
          'GET',
          `/v1/admin/catalog/locations/${SHOP}/sections`
        );

        expect(res.status).toBe(200);
        expect(sent[0]).toEqual({
          subject: SECTION_PATTERNS.forLocation,
          payload: { supermarketLocationId: SHOP },
        });
      });
    });

    it('sends the order as given, and refuses a repeated section', async () => {
      await withApp(async ({ origin, sent }) => {
        const path = `/v1/admin/catalog/locations/${SHOP}/sections`;
        const ordered = await send(origin, 'PUT', path, {
          sectionIds: [SECTION_B, SECTION_A],
        });
        // Well formed, and it changes nothing: catalog deletes no section.
        const empty = await send(origin, 'PUT', path, { sectionIds: [] });
        const repeated = await send(origin, 'PUT', path, {
          sectionIds: [SECTION_A, SECTION_A],
        });

        expect([ordered.status, empty.status, repeated.status]).toEqual([
          200, 200, 400,
        ]);
        expect(sent.map((message) => message.payload['sectionIds'])).toEqual([
          [SECTION_B, SECTION_A],
          [],
        ]);
        expect(sent[0].subject).toBe(SECTION_PATTERNS.setForLocation);
      });
    });
  });

  describe('the preview', () => {
    it('asks where the named products are, one or several', async () => {
      await withApp(async ({ origin, sent }) => {
        const path = `/v1/admin/catalog/locations/${SHOP}/item-sections`;
        const one = await send(origin, 'GET', `${path}?itemIds=${PIZZA}`);
        const two = await send(
          origin,
          'GET',
          `${path}?itemIds=${PIZZA}&itemIds=${MILK}`
        );
        const none = await send(origin, 'GET', path);

        expect([one.status, two.status, none.status]).toEqual([200, 200, 400]);
        expect(sent).toEqual([
          {
            subject: SECTION_PATTERNS.itemsAtLocation,
            payload: { supermarketLocationId: SHOP, itemIds: [PIZZA] },
          },
          {
            subject: SECTION_PATTERNS.itemsAtLocation,
            payload: { supermarketLocationId: SHOP, itemIds: [PIZZA, MILK] },
          },
        ]);
      });
    });
  });
});
