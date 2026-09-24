import {
  NearbyShopNoPick,
  PROFILE_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  UserKind,
  type NearbyShopsRequest,
  type ProfileScopeSelector,
} from '@portfolio/luna-shopper/contracts';
import type { NatsClient } from '../messaging/nats-client';
import { CatalogNearbyShopsController } from './nearby-shops.controller';
import type { NearbyShopsDto } from './nearby-shops.dto';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * The gateway's half of `POST /v1/catalog/shops/nearby` (plan 0164): read the
 * caller's profile, hand catalog the point with the profile's codes and
 * refusals, and pass the answer through. Which shops come back and which is
 * picked is catalog's, proven in `nearby-shops.integration.spec.ts` and
 * `nearby-shop-pick.spec.ts`.
 */

const USER = { userId: 'user-1', kind: UserKind.REGISTERED };
const POINT = { latitude: 37.88, longitude: -4.77, accuracyMetres: 12 };
const ANSWER = {
  candidates: [],
  pick: null,
  noPick: NearbyShopNoPick.NONE_NEARBY,
};

function build(selector: Partial<ProfileScopeSelector> = {}) {
  const sent: { subject: string; payload: unknown }[] = [];
  const nats = {
    send: async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      if (subject === PROFILE_PATTERNS.resolveScopes) {
        return {
          profileId: 'profile-1',
          postalCodes: ['14001'],
          supermarketIds: [],
          excludedSupermarketIds: ['chain-dia'],
          excludedSupermarketLocationIds: ['shop-9'],
          empty: false,
          ...selector,
        } satisfies ProfileScopeSelector;
      }
      return ANSWER;
    },
  } as unknown as NatsClient;
  const controller = new CatalogNearbyShopsController(
    nats,
    new ScopeResolutionService(nats, {} as never)
  );
  return { controller, sent };
}

describe('CatalogNearbyShopsController (plan 0164)', () => {
  it('asks about the named profile, and sends the point with its codes and refusals', async () => {
    const { controller, sent } = build();

    const answer = await controller.nearby(USER, {
      ...POINT,
      profileId: 'profile-1',
    } as NearbyShopsDto);

    expect(answer).toBe(ANSWER);
    expect(sent[0]).toEqual({
      subject: PROFILE_PATTERNS.resolveScopes,
      payload: { userId: 'user-1', profileId: 'profile-1' },
    });
    expect(sent[1]).toEqual({
      subject: SUPERMARKET_LOCATION_PATTERNS.nearby,
      payload: {
        ...POINT,
        profilePostalCodes: ['14001'],
        excludedSupermarketIds: ['chain-dia'],
        excludedSupermarketLocationIds: ['shop-9'],
      } satisfies NearbyShopsRequest,
    });
  });

  it('asks about the default profile when none is named', async () => {
    const { controller, sent } = build();

    await controller.nearby(USER, { ...POINT } as NearbyShopsDto);

    expect(sent[0].payload).toEqual({ userId: 'user-1', profileId: undefined });
  });

  it('sends nothing but the three point fields of the body', async () => {
    const { controller, sent } = build();

    await controller.nearby(USER, {
      ...POINT,
      altitude: 700,
    } as unknown as NearbyShopsDto);

    expect(Object.keys(sent[1].payload as object).sort()).toEqual([
      'accuracyMetres',
      'excludedSupermarketIds',
      'excludedSupermarketLocationIds',
      'latitude',
      'longitude',
      'profilePostalCodes',
    ]);
  });
});
