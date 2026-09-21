import { HttpStatus, ValidationPipe } from '@nestjs/common';
import {
  APP_STATE_PATTERNS,
  AUTH_PATTERNS,
  UserKind,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import type { CurrentUser } from '../auth/jwt.strategy';
import { AccountController } from './account.controller';
import { UpdateAppStateDto } from './account.dto';

/**
 * What the account routes of plan 0145 are responsible for, and only that:
 * composing two services into one body, degrading when one of them is away, and
 * refusing a body that asks for nothing.
 *
 * Which timestamp comes back is core's, and is proven against real Postgres in
 * `user-app-state.integration.spec.ts`.
 */

const USER: CurrentUser = { userId: 'user-1', kind: UserKind.REGISTERED };

/** What auth answers for {@link USER}. */
const PROFILE: UserProfileView = {
  userId: USER.userId,
  kind: UserKind.REGISTERED,
  username: 'Brave Anchor',
  email: 'brave@example.test',
  emailVerified: true,
  displayName: null,
};

const STATE = {
  setupCompletedAt: '2026-09-21T10:00:00.000Z',
  tourSeenAt: null,
};

function build(
  answers: Partial<Record<string, unknown | (() => Promise<unknown>)>> = {}
) {
  const send = jest.fn(async (pattern: string) => {
    const answer = answers[pattern];
    if (typeof answer === 'function') {
      return (answer as () => Promise<unknown>)();
    }
    if (answer !== undefined) {
      return answer;
    }
    if (pattern === AUTH_PATTERNS.getProfile) {
      return PROFILE;
    }
    if (pattern === APP_STATE_PATTERNS.get) {
      return STATE;
    }
    if (pattern === APP_STATE_PATTERNS.set) {
      return STATE;
    }
    throw new Error(`nothing answers ${pattern} in this test`);
  });
  const scopes = { invalidate: jest.fn() } as never;
  return {
    controller: new AccountController({ send } as never, scopes),
    send,
  };
}

describe('AccountController, on what an account has been shown', () => {
  describe('GET me', () => {
    it('composes the profile and the state into one body', async () => {
      const { controller, send } = build();

      await expect(controller.me(USER)).resolves.toEqual({
        ...PROFILE,
        appState: STATE,
      });

      expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.getProfile, {
        userId: USER.userId,
      });
      expect(send).toHaveBeenCalledWith(APP_STATE_PATTERNS.get, {
        userId: USER.userId,
      });
    });

    it('answers the profile with two nulls when core cannot be reached', async () => {
      const { controller } = build({
        [APP_STATE_PATTERNS.get]: () =>
          Promise.reject(new Error('core is not there')),
      });

      await expect(controller.me(USER)).resolves.toEqual({
        ...PROFILE,
        appState: { setupCompletedAt: null, tourSeenAt: null },
      });
    });

    it('still fails when auth cannot be reached, because the name is the screen', async () => {
      const { controller } = build({
        [AUTH_PATTERNS.getProfile]: () =>
          Promise.reject(new Error('auth is not there')),
      });

      await expect(controller.me(USER)).rejects.toThrow();
    });
  });

  describe('PATCH app-state', () => {
    it('passes the flags it was given, with the caller from the token', async () => {
      const { controller, send } = build();

      await controller.setAppState(USER, { setupCompleted: true });

      expect(send).toHaveBeenCalledWith(APP_STATE_PATTERNS.set, {
        userId: USER.userId,
        setupCompleted: true,
      });
    });

    it('answers the whole state', async () => {
      const { controller } = build();

      await expect(
        controller.setAppState(USER, { tourSeen: true })
      ).resolves.toEqual(STATE);
    });
  });

  describe('the body PATCH app-state accepts', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    const metadata = {
      type: 'body' as const,
      metatype: UpdateAppStateDto,
    };

    async function validate(body: unknown): Promise<unknown> {
      return pipe.transform(body, metadata);
    }

    it('accepts one flag', async () => {
      await expect(validate({ setupCompleted: true })).resolves.toEqual({
        setupCompleted: true,
      });
    });

    it('accepts both flags', async () => {
      await expect(
        validate({ setupCompleted: true, tourSeen: true })
      ).resolves.toEqual({ setupCompleted: true, tourSeen: true });
    });

    it('refuses an empty body', async () => {
      await expect(validate({})).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('refuses false, because this route cannot unset', async () => {
      await expect(validate({ setupCompleted: false })).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      await expect(
        validate({ setupCompleted: true, tourSeen: false })
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  describe('GET username-suggestions', () => {
    it('asks auth for a name and sends nothing about the caller', async () => {
      const { controller, send } = build({
        [AUTH_PATTERNS.suggestUsername]: { username: 'Calm Harbour' },
      });

      await expect(controller.suggestUsername()).resolves.toEqual({
        username: 'Calm Harbour',
      });

      expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.suggestUsername, {});
    });
  });
});
