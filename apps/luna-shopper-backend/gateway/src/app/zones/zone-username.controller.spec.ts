import {
  AUTH_PATTERNS,
  UserKind,
  ZONE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ZoneController } from './zone.controller';

/**
 * Defaulting the per zone username on create and join (plan 0018, section 9).
 * Core always receives a concrete string; the optionality lives only in the DTO,
 * and the gateway is where the default is resolved.
 */
function build() {
  const send = jest.fn(async (subject: string) => {
    if (subject === AUTH_PATTERNS.createTemporaryUser) {
      return {
        userId: 'guest',
        kind: UserKind.TEMPORARY,
        username: 'Quiet Lantern',
        accessToken: 'a',
        refreshToken: 'r',
      };
    }
    if (subject === AUTH_PATTERNS.getProfile) {
      return {
        userId: 'u1',
        kind: UserKind.REGISTERED,
        username: 'Swift Sail',
        email: null,
        emailVerified: false,
        displayName: null,
      };
    }
    return { id: 'z1' };
  });
  return { controller: new ZoneController({ send } as never), send };
}

const authenticated: CurrentUser = { userId: 'u1' } as CurrentUser;

const sentTo = (send: jest.Mock, subject: string) =>
  send.mock.calls.find((c) => c[0] === subject)?.[1];

const calledWith = (send: jest.Mock, subject: string) =>
  send.mock.calls.some((c) => c[0] === subject);

describe('ZoneController username defaulting', () => {
  it('an authenticated caller who omits it joins under their global name', async () => {
    const { controller, send } = build();

    await controller.join(authenticated, { joinCode: 'ABCD1234' });

    expect(sentTo(send, ZONE_PATTERNS.join).username).toBe('Swift Sail');
  });

  it('an authenticated caller who supplies one gets that one, with no profile hop', async () => {
    const { controller, send } = build();

    await controller.create(authenticated, { name: 'Home', username: 'Mamá' });

    expect(sentTo(send, ZONE_PATTERNS.create).username).toBe('Mamá');
    // The global name is neither read nor written by a per zone choice.
    expect(calledWith(send, AUTH_PATTERNS.getProfile)).toBe(false);
    expect(calledWith(send, AUTH_PATTERNS.setUsername)).toBe(false);
  });

  it('an anonymous caller joins under the name minted with their guest identity', async () => {
    const { controller, send } = build();

    const result = await controller.create(undefined, { name: 'Home' });

    expect(sentTo(send, ZONE_PATTERNS.create).username).toBe('Quiet Lantern');
    expect(result.tokens?.username).toBe('Quiet Lantern');
    // The name came back on the mint; reading it back would be the wrong shape.
    expect(calledWith(send, AUTH_PATTERNS.getProfile)).toBe(false);
  });

  it('an anonymous caller who supplies one still gets a token pair', async () => {
    const { controller, send } = build();

    const result = await controller.join(undefined, {
      joinCode: 'ABCD1234',
      username: 'Mamá',
    });

    expect(sentTo(send, ZONE_PATTERNS.join).username).toBe('Mamá');
    expect(result.tokens?.userId).toBe('guest');
  });
});
