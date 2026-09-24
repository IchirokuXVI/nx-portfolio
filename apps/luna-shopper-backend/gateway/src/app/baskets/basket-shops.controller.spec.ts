import { Test } from '@nestjs/testing';
import {
  BASKET_PATTERNS,
  NearbyShopNoPick,
  PROFILE_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketParticipantContext,
  type BasketSearchScope,
  type ProfileScopeSelector,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketShopLockedException,
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { NatsClient } from '../messaging/nats-client';
import { BasketShopsController } from './basket-shops.controller';
import { ParticipantGuard } from './participant.guard';

/**
 * The gateway's half of `POST /v1/baskets/:id/shops/nearby` (plan 0164): the
 * basket's own shop locks it, the profile is the basket's pricing profile and
 * never the reader's, and the point goes to catalog with that profile's codes
 * and refusals.
 */

const BASKET = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OWNER = 'owner-1';
const POINT = { latitude: 37.88, longitude: -4.77, accuracyMetres: 12 };
const ANSWER = {
  candidates: [],
  pick: null,
  noPick: NearbyShopNoPick.NONE_NEARBY,
};

/** A guest, who has no account and no profile of their own. */
const GUEST: BasketParticipantContext = {
  participantId: 'participant-guest',
  basketId: BASKET,
  userId: null,
} as unknown as BasketParticipantContext;

function build(scope: Partial<BasketSearchScope> = {}) {
  const sent: { subject: string; payload: unknown }[] = [];
  const nats = {
    send: async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      if (subject === BASKET_PATTERNS.searchScope) {
        return {
          ownerUserId: OWNER,
          profileId: 'owner-profile',
          servesLocations: true,
          supermarketLocationId: null,
          ...scope,
        };
      }
      if (subject === PROFILE_PATTERNS.resolveScopes) {
        return {
          profileId: 'owner-profile',
          postalCodes: ['14001'],
          supermarketIds: [],
          excludedSupermarketIds: [],
          excludedSupermarketLocationIds: ['shop-9'],
          empty: false,
        } satisfies ProfileScopeSelector;
      }
      return ANSWER;
    },
  } as unknown as NatsClient;
  const controller = new BasketShopsController(
    nats,
    new ScopeResolutionService(nats, {} as never)
  );
  return { controller, sent, nats };
}

describe('BasketShopsController (plan 0164)', () => {
  it('judges the shops against the owner’s pricing profile, whoever asks', async () => {
    const { controller, sent } = build();

    const answer = await controller.nearby(GUEST, BASKET, POINT);

    expect(answer).toBe(ANSWER);
    expect(sent.map((s) => s.subject)).toEqual([
      BASKET_PATTERNS.searchScope,
      PROFILE_PATTERNS.resolveScopes,
      SUPERMARKET_LOCATION_PATTERNS.nearby,
    ]);
    expect(sent[0].payload).toEqual({
      basketId: BASKET,
      participantId: 'participant-guest',
    });
    expect(sent[1].payload).toEqual({
      userId: OWNER,
      profileId: 'owner-profile',
    });
    expect(sent[2].payload).toEqual({
      ...POINT,
      profilePostalCodes: ['14001'],
      excludedSupermarketIds: [],
      excludedSupermarketLocationIds: ['shop-9'],
    });
  });

  it('answers basket_shop_locked on a basket with its own shop, before the point is sent', async () => {
    const { controller, sent } = build({ supermarketLocationId: 'shop-1' });

    await expect(
      controller.nearby(GUEST, BASKET, POINT)
    ).rejects.toBeInstanceOf(BasketShopLockedException);
    expect(sent.map((s) => s.subject)).toEqual([BASKET_PATTERNS.searchScope]);
  });

  it('sends empty codes and refusals for a basket with no pricing profile', async () => {
    const { controller, sent } = build({ profileId: null });

    await controller.nearby(GUEST, BASKET, POINT);

    expect(sent.map((s) => s.subject)).toEqual([
      BASKET_PATTERNS.searchScope,
      SUPERMARKET_LOCATION_PATTERNS.nearby,
    ]);
    expect(sent[1].payload).toEqual({
      ...POINT,
      profilePostalCodes: [],
      excludedSupermarketIds: [],
      excludedSupermarketLocationIds: [],
    });
  });

  describe('over HTTP', () => {
    async function boot() {
      const { nats, sent } = build({ supermarketLocationId: 'shop-1' });
      const app = (
        await Test.createTestingModule({
          controllers: [BasketShopsController],
          providers: [
            { provide: NatsClient, useValue: nats },
            {
              provide: ScopeResolutionService,
              useValue: new ScopeResolutionService(nats, {} as never),
            },
          ],
        })
          .overrideGuard(ParticipantGuard)
          .useValue({
            canActivate: (context: {
              switchToHttp(): { getRequest(): Record<string, unknown> };
            }) => {
              context.switchToHttp().getRequest()['participant'] = GUEST;
              return true;
            },
          })
          .compile()
      ).createNestApplication();
      app.useGlobalPipes(createValidationPipe());
      const logger = {
        setContext: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      };
      app.useGlobalFilters(
        new GlobalExceptionFilter(
          logger as unknown as ConstructorParameters<
            typeof GlobalExceptionFilter
          >[0]
        )
      );
      app.setGlobalPrefix('v1');
      await app.init();
      await app.listen(0);
      const { port } = app.getHttpServer().address() as AddressInfo;
      return { app, sent, origin: `http://127.0.0.1:${port}` };
    }

    it('refuses a profileId, because the profile is the basket’s', async () => {
      const { app, sent, origin } = await boot();
      try {
        const res = await fetch(`${origin}/v1/baskets/${BASKET}/shops/nearby`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...POINT, profileId: BASKET }),
        });

        expect(res.status).toBe(400);
        expect(sent).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it('answers 409 basket_shop_locked on a basket started at a shop', async () => {
      const { app, origin } = await boot();
      try {
        const res = await fetch(`${origin}/v1/baskets/${BASKET}/shops/nearby`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(POINT),
        });

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'basket_shop_locked' });
      } finally {
        await app.close();
      }
    });
  });
});
