import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import {
  AUTH_PATTERNS,
  ZONE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { AccountController } from '../account/account.controller';
import { ZoneController } from '../zones/zone.controller';
import type { CurrentUser } from './jwt.strategy';
import { asRejectedCredentials, errorCodeOf } from './remote-problem';

/**
 * A token whose account no longer exists is an invalid token, not a missing
 * resource.
 *
 * The case that produced this file: a database is reset, every user in it going
 * with it, under a client still holding the pair it was issued before. That pair
 * is signed by the current key and its `exp` is in the future, so the guards let
 * it through and the client has no reason to doubt it either.
 *
 * What the caller then got was auth's `NotFoundException('User not found')`,
 * rendered as a 404 `not_found`. That code is a statement about a resource, and
 * on these routes the client cannot tell it from "no zone has that join code",
 * so it kept the dead pair in storage and presented it again on the next attempt,
 * and the one after that. Creating a group and joining one both failed forever
 * with nothing on either side that could break the loop.
 *
 * 401 is the answer that can: it is the one code the client already reads as
 * "these credentials are spent", so it refreshes, fails, and deletes the pair
 * from the browser. The next attempt goes out anonymously and works.
 */
describe('a token whose account is gone', () => {
  /** What a service's `NotFoundException` looks like once it has crossed NATS. */
  const userNotFound = () => ({
    status: HttpStatus.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
    message: 'User not found',
    correlationId: 'c1',
  });

  const caller = { userId: 'u1' } as CurrentUser;

  const calledWith = (send: jest.Mock, subject: string) =>
    send.mock.calls.some((c) => c[0] === subject);

  /** A gateway whose auth service has never heard of anybody. */
  function build() {
    const send = jest.fn(async (subject: string) => {
      if (subject === ZONE_PATTERNS.create || subject === ZONE_PATTERNS.join) {
        return { id: 'z1' };
      }
      // Every auth call here is keyed on the caller's own id, and the user row
      // behind it is gone.
      throw userNotFound();
    });
    return { send };
  }

  describe('asRejectedCredentials', () => {
    it('turns a not found about the caller into a 401', () => {
      const rejected = asRejectedCredentials(userNotFound());

      expect(rejected).toBeInstanceOf(UnauthorizedException);
      expect((rejected as UnauthorizedException).getStatus()).toBe(
        HttpStatus.UNAUTHORIZED
      );
    });

    it('reads the envelope nested under `error` as well as bare', () => {
      // Which of the two shapes arrives depends on the transport, so neither may
      // be the one that quietly falls through to the untouched branch.
      expect(asRejectedCredentials({ error: userNotFound() })).toBeInstanceOf(
        UnauthorizedException
      );
    });

    it('passes everything else through untouched', () => {
      // The narrowness is the point. A 404 about a zone, a list or a membership is
      // about that resource, and reporting it as a signed out session would sign
      // people out over a mistyped join code.
      const conflict = { status: 409, code: ERROR_CODES.CONFLICT, message: '' };
      expect(asRejectedCredentials(conflict)).toBe(conflict);

      const unknown = new Error('boom');
      expect(asRejectedCredentials(unknown)).toBe(unknown);
      expect(errorCodeOf(unknown)).toBe(ERROR_CODES.INTERNAL);
    });
  });

  describe('POST /v1/zones and POST /v1/zones/join', () => {
    it('answers 401 rather than 404, and creates nothing', async () => {
      const { send } = build();
      const controller = new ZoneController({ send } as never);

      await expect(
        controller.create(caller, { name: 'Home' })
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // The identity is resolved before core is asked to write anything, so a
      // rejected one leaves no zone owned by a user that does not exist.
      expect(calledWith(send, ZONE_PATTERNS.create)).toBe(false);
      // And no second guest account either: that is plan 0020's rule and it still
      // holds, the token was refused rather than treated as absent.
      expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(false);
    });

    it('answers 401 on a join too, and asks core nothing', async () => {
      const { send } = build();
      const controller = new ZoneController({ send } as never);

      await expect(
        controller.join(caller, { joinCode: 'ABCD1234' })
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(calledWith(send, ZONE_PATTERNS.join)).toBe(false);
      expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(false);
    });

    it('still mints a guest for a caller who presented no token at all', async () => {
      // The rule is about a token that names nobody, not about being anonymous.
      // Somebody with no session has an account made for them, as always.
      const send = jest.fn(async (subject: string) => {
        if (subject === AUTH_PATTERNS.createTemporaryUser) {
          return {
            userId: 'guest',
            username: 'Quiet Lantern',
            accessToken: 'a',
            refreshToken: 'r',
          };
        }
        return { id: 'z1' };
      });
      const controller = new ZoneController({ send } as never);

      const result = await controller.create(undefined, { name: 'Home' });

      expect(result.tokens?.userId).toBe('guest');
      expect(calledWith(send, ZONE_PATTERNS.create)).toBe(true);
    });
  });

  describe('the account routes', () => {
    it.each([
      ['reading the profile', (c: AccountController) => c.me(caller)],
      [
        'renaming',
        (c: AccountController) =>
          c.updateMe(caller, { username: 'Swift Sail' } as never),
      ],
      ['deleting the account', (c: AccountController) => c.remove(caller)],
    ])('answers 401 when %s', async (_name, call) => {
      // Every route on this controller is keyed on the token's `userId` and on
      // nothing else, so "not found" can only ever mean the caller themselves.
      const { send } = build();

      await expect(
        call(new AccountController({ send } as never))
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
