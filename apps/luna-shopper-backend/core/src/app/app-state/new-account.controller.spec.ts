import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { NewAccountController } from './new-account.controller';
import type { UserAppStateService } from './user-app-state.service';

describe('NewAccountController', () => {
  const userId = randomUUID();
  let set: jest.Mock;

  function controller(newAccountsSkipTour: boolean): NewAccountController {
    const config = {
      getOrThrow: () => ({ appState: { newAccountsSkipTour } }),
    } as unknown as ConfigService;
    return new NewAccountController(
      { set } as unknown as UserAppStateService,
      config
    );
  }

  beforeEach(() => {
    set = jest.fn().mockResolvedValue({
      setupCompletedAt: null,
      tourSeenAt: new Date().toISOString(),
    });
  });

  describe('with NEW_ACCOUNTS_SKIP_TOUR on', () => {
    it('stamps the tour, and only the tour, for a registered account', async () => {
      await controller(true).onRegistered({ userId });

      expect(set).toHaveBeenCalledWith({ userId, tourSeen: true });
    });

    it('stamps the tour for a guest that registers', async () => {
      await controller(true).onUpgraded({ userId });

      expect(set).toHaveBeenCalledWith({ userId, tourSeen: true });
    });

    it('swallows a failed stamp, because the account exists either way', async () => {
      set.mockRejectedValue(new Error('connection refused'));

      await expect(controller(true).onRegistered({ userId })).resolves.toBe(
        undefined
      );
    });
  });

  describe('with NEW_ACCOUNTS_SKIP_TOUR off', () => {
    it('writes nothing', async () => {
      const c = controller(false);
      await c.onRegistered({ userId });
      await c.onUpgraded({ userId });

      expect(set).not.toHaveBeenCalled();
    });
  });
});
