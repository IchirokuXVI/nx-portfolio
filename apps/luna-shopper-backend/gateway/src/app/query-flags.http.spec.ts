import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_POSTAL_CODE_PATTERNS,
  ADMIN_USER_PATTERNS,
  ADMIN_ZONE_PATTERNS,
  BASKET_PATTERNS,
  BASKET_SHARING_PATTERNS,
  ITEM_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import {
  AdminPostalCodesController,
  AdminZonesController,
} from './admin/admin-core.controller';
import { AdminUsersController } from './admin/admin-directory.controller';
import { AdminJwtGuard } from './admin/admin-jwt.guard';
import { AdminUserNamesService } from './admin/admin-user-names.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { BasketPresenceService } from './baskets/basket-presence.service';
import { BasketShareController } from './baskets/basket-sharing.controller';
import { BasketsController } from './baskets/baskets.controller';
import {
  AdminCatalogItemsController,
  AdminCatalogSupermarketItemsController,
} from './catalog/catalog-admin.controller';
import { CatalogShopsController } from './catalog/catalog.controller';
import { ScopeResolutionService } from './catalog/scope-resolution.service';
import { NatsClient } from './messaging/nats-client';

/**
 * Every boolean query flag of the gateway, through the real pipe and over HTTP.
 *
 * The pipe converts implicitly, and its conversion of a boolean is
 * `Boolean(value)`: the text `false` reaches a transform as `true`. A flag that
 * is not read from the raw text thus answers the opposite question for
 * `?flag=false`. A bare `?flag`, with no value, is refused like any other
 * text but `true` and `false`. Over HTTP, because the conversion happens in the pipe and a
 * handler call never meets it. The harvest flags have their own specs
 * (`harvest-query-flags.http.spec.ts`, `queue-brand-matches.http.spec.ts`).
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

const BASKET = '0b000000-0000-4000-a000-000000000001';

async function boot(controller: Type<unknown>) {
  const sent: SentMessage[] = [];
  const signedIn = {
    canActivate: (context: {
      switchToHttp(): { getRequest(): Record<string, unknown> };
    }) => {
      context.switchToHttp().getRequest()['user'] = {
        userId: 'user-1',
        adminId: 'admin-1',
        token: 'token',
      };
      return true;
    },
  };

  const nest = (
    await Test.createTestingModule({
      controllers: [controller],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return {
                items: [],
                chains: [],
                nextCursor: null,
                revoked: 0,
                postalCodes: [],
                excludedSupermarketIds: [],
                excludedSupermarketLocationIds: [],
              };
            },
          },
        },
        {
          provide: ScopeResolutionService,
          useValue: {
            forShops: async () => ({
              profileId: null,
              postalCodes: ['14013'],
              excludedSupermarketIds: [],
              excludedSupermarketLocationIds: [],
            }),
          },
        },
        {
          provide: BasketPresenceService,
          useValue: { countsFor: async () => new Map() },
        },
        {
          provide: AdminUserNamesService,
          useValue: {
            decorateZones: async (_admin: unknown, page: unknown) => page,
          },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue(signedIn)
      .overrideGuard(JwtAuthGuard)
      .useValue(signedIn)
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

interface FlagRoute {
  readonly route: string;
  readonly controller: Type<unknown>;
  readonly method: 'GET' | 'DELETE';
  readonly path: string;
  readonly flag: string;
  readonly subject: unknown;
  /** What the message carries when the query does not name the flag. */
  readonly absent: boolean | undefined;
}

const ROUTES: readonly FlagRoute[] = [
  {
    route: 'GET /v1/admin/users',
    controller: AdminUsersController,
    method: 'GET',
    path: 'admin/users',
    flag: 'verified',
    subject: ADMIN_USER_PATTERNS.list,
    absent: undefined,
  },
  {
    route: 'GET /v1/admin/zones',
    controller: AdminZonesController,
    method: 'GET',
    path: 'admin/zones',
    flag: 'hasPending',
    subject: ADMIN_ZONE_PATTERNS.list,
    absent: undefined,
  },
  {
    route: 'GET /v1/admin/catalog/postal-codes',
    controller: AdminPostalCodesController,
    method: 'GET',
    path: 'admin/catalog/postal-codes',
    flag: 'served',
    subject: ADMIN_POSTAL_CODE_PATTERNS.list,
    absent: undefined,
  },
  {
    route: 'GET /v1/admin/catalog/items',
    controller: AdminCatalogItemsController,
    method: 'GET',
    path: 'admin/catalog/items',
    flag: 'merged',
    subject: ITEM_PATTERNS.search,
    absent: undefined,
  },
  {
    route: 'GET /v1/admin/catalog/supermarket-items (stale)',
    controller: AdminCatalogSupermarketItemsController,
    method: 'GET',
    path: 'admin/catalog/supermarket-items',
    flag: 'stale',
    subject: SUPERMARKET_ITEM_PATTERNS.adminList,
    absent: undefined,
  },
  {
    route: 'GET /v1/admin/catalog/supermarket-items (available)',
    controller: AdminCatalogSupermarketItemsController,
    method: 'GET',
    path: 'admin/catalog/supermarket-items',
    flag: 'available',
    subject: SUPERMARKET_ITEM_PATTERNS.adminList,
    absent: undefined,
  },
  {
    route: 'GET /v1/catalog/shops/summary',
    controller: CatalogShopsController,
    method: 'GET',
    path: 'catalog/shops/summary',
    flag: 'includeExcluded',
    subject: SUPERMARKET_LOCATION_PATTERNS.summarizeByChain,
    absent: false,
  },
  {
    route: 'GET /v1/catalog/shops',
    controller: CatalogShopsController,
    method: 'GET',
    path: 'catalog/shops',
    flag: 'includeExcluded',
    subject: SUPERMARKET_LOCATION_PATTERNS.search,
    absent: false,
  },
  {
    route: 'GET /v1/baskets',
    controller: BasketsController,
    method: 'GET',
    path: 'baskets',
    flag: 'includeArchived',
    subject: BASKET_PATTERNS.listMine,
    absent: undefined,
  },
  {
    route: 'DELETE /v1/baskets/:id/share-link',
    controller: BasketShareController,
    method: 'DELETE',
    path: `baskets/${BASKET}/share-link`,
    flag: 'revokeParticipants',
    subject: BASKET_SHARING_PATTERNS.linkRevoke,
    absent: undefined,
  },
];

describe.each(ROUTES)(
  '$route reads $flag from the text sent',
  ({ controller, method, path, flag, subject, absent }) => {
    let context: Awaited<ReturnType<typeof boot>> | undefined;

    afterEach(async () => {
      await context?.nest.close();
      context = undefined;
    });

    function messageOf(sent: readonly SentMessage[]) {
      return sent.find((message) => message.subject === subject);
    }

    it.each([
      ['true', true],
      ['false', false],
    ])(`reads ${flag}=%p as %p`, async (spelled, read) => {
      context = await boot(controller);

      const response = await fetch(
        `${context.origin}/v1/${path}?${flag}=${spelled}`,
        { method }
      );

      expect(response.status).toBe(200);
      expect(messageOf(context.sent)?.payload[flag]).toBe(read);
    });

    it(`applies the route default when the query does not name ${flag}`, async () => {
      context = await boot(controller);

      const response = await fetch(`${context.origin}/v1/${path}`, { method });

      expect(response.status).toBe(200);
      const message = messageOf(context.sent);
      expect(message).toBeDefined();
      expect(message?.payload[flag]).toBe(absent);
    });

    it.each([`${flag}=no`, `${flag}=1`, `${flag}=`, flag])(
      'refuses ?%s',
      async (query) => {
        context = await boot(controller);

        const response = await fetch(`${context.origin}/v1/${path}?${query}`, {
          method,
        });

        expect(response.status).toBe(400);
        expect(messageOf(context.sent)).toBeUndefined();
      }
    );
  }
);
