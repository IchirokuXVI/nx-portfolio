import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLIENT_VERSION_HEADER,
  ClientTooOldException,
  MIN_CLIENT_VERSION_HEADER,
} from '@portfolio/luna-shopper/platform';
import { MinClientVersionGuard } from './min-client-version.guard';

describe('MinClientVersionGuard', () => {
  let setHeader: jest.Mock;

  function context(
    clientVersion?: string,
    type: 'http' | 'rpc' = 'http'
  ): ExecutionContext {
    setHeader = jest.fn();

    return {
      getType: () => type,
      switchToHttp: () => ({
        getResponse: () => ({ setHeader }),
        getRequest: () => ({
          header: (name: string) =>
            name === CLIENT_VERSION_HEADER ? clientVersion : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function guardWithFloor(minClientVersion: string): MinClientVersionGuard {
    const config = {
      getOrThrow: () => ({ minClientVersion }),
    } as unknown as ConfigService;
    return new MinClientVersionGuard(config);
  }

  describe('with no floor configured', () => {
    // How both clusters run by default (plan 0034 D5).
    const guard = guardWithFloor('');

    it('allows everything', () => {
      expect(guard.canActivate(context('0.0.1'))).toBe(true);
    });

    it('advertises nothing', () => {
      guard.canActivate(context('0.0.1'));

      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('with a floor configured', () => {
    const guard = guardWithFloor('1.4.0');

    it('advertises the floor on every response', () => {
      guard.canActivate(context('2.0.0'));

      expect(setHeader).toHaveBeenCalledWith(
        MIN_CLIENT_VERSION_HEADER,
        '1.4.0'
      );
    });

    it('refuses a client below the floor', () => {
      expect(() => guard.canActivate(context('1.3.9'))).toThrow(
        ClientTooOldException
      );
    });

    it('advertises the floor on the refusal too', () => {
      // The refused client has to be able to read what it is being held to, and
      // the header is set before the throw for exactly that reason.
      expect(() => guard.canActivate(context('1.3.9'))).toThrow();

      expect(setHeader).toHaveBeenCalledWith(
        MIN_CLIENT_VERSION_HEADER,
        '1.4.0'
      );
    });

    it('allows a client exactly at the floor', () => {
      expect(guard.canActivate(context('1.4.0'))).toBe(true);
    });

    it('allows a client above the floor', () => {
      expect(guard.canActivate(context('1.4.1'))).toBe(true);
    });

    it('allows a request that states no version', () => {
      // curl, a health probe, anything that is not the app. The floor is aimed at
      // clients that identify themselves, and silence is not a claim to be old.
      expect(guard.canActivate(context(undefined))).toBe(true);
    });

    it.each(['staging', 'latest', 'not a version'])(
      'allows a client whose version does not parse: %s',
      (version) => {
        // Plan 0034 D6. The staging fleet identifies itself with its image tag, and
        // a tag nobody can order is never ordered.
        expect(guard.canActivate(context(version))).toBe(true);
      }
    );

    it('leaves broker messages alone', () => {
      // A NATS message has no response to set a header on and no client behind it.
      expect(guard.canActivate(context('1.0.0', 'rpc'))).toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('a floor that is itself a prerelease', () => {
    const guard = guardWithFloor('2.0.0-rc.2');

    it('refuses an earlier prerelease of the same release', () => {
      expect(() => guard.canActivate(context('2.0.0-rc.1'))).toThrow(
        ClientTooOldException
      );
    });

    it('allows the release the prereleases lead to', () => {
      expect(guard.canActivate(context('2.0.0'))).toBe(true);
    });
  });
});
