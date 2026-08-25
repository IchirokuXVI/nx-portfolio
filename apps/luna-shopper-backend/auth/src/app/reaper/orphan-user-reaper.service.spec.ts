import { UserKind } from '@portfolio/luna-shopper/contracts';
import { of } from 'rxjs';
import { OrphanUserReaperService } from './orphan-user-reaper.service';

/**
 * The orphan reaper's selection logic (plan 0011). Core is the authority on
 * membership, so the reaper only deletes the subset core says is memberless.
 */
describe('OrphanUserReaperService.reap', () => {
  const reaperCfg = {
    enabled: true,
    graceMs: 1000,
    intervalMs: 1000,
    batchSize: 200,
  };

  function build(candidates: { id: string }[], memberless: string[]) {
    const find = jest.fn(async () => candidates);
    const dataSource = {
      getRepository: () => ({ find }),
    } as unknown as ConstructorParameters<typeof OrphanUserReaperService>[0];
    const client = {
      send: jest.fn(() => of({ userIds: memberless })),
    } as unknown as ConstructorParameters<typeof OrphanUserReaperService>[1];
    const identity = {
      deleteAccount: jest.fn(async ({ userId }: { userId: string }) => ({
        userId,
        deleted: true,
      })),
    } as unknown as ConstructorParameters<typeof OrphanUserReaperService>[2];
    const logger = {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as ConstructorParameters<typeof OrphanUserReaperService>[3];
    const configService = {
      getOrThrow: () => ({ reaper: reaperCfg }),
    } as unknown as ConstructorParameters<typeof OrphanUserReaperService>[4];

    const svc = new OrphanUserReaperService(
      dataSource,
      client,
      identity,
      logger,
      configService
    );
    return { svc, find, client, identity };
  }

  it('does nothing when there are no aged temporary candidates', async () => {
    const { svc, client, identity } = build([], []);
    await expect(svc.reap()).resolves.toBe(0);
    expect(client.send).not.toHaveBeenCalled();
    expect(identity.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes only the candidates core reports as memberless', async () => {
    const { svc, identity } = build(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      ['a', 'c']
    );
    await expect(svc.reap()).resolves.toBe(2);
    expect(identity.deleteAccount).toHaveBeenCalledTimes(2);
    expect(identity.deleteAccount).toHaveBeenCalledWith({ userId: 'a' });
    expect(identity.deleteAccount).toHaveBeenCalledWith({ userId: 'c' });
    expect(identity.deleteAccount).not.toHaveBeenCalledWith({ userId: 'b' });
  });

  it('deletes nothing when core reports every candidate still has a membership', async () => {
    const { svc, identity } = build([{ id: 'a' }, { id: 'b' }], []);
    await expect(svc.reap()).resolves.toBe(0);
    expect(identity.deleteAccount).not.toHaveBeenCalled();
  });

  it('queries core only with the temporary user kind', async () => {
    const { svc, find } = build([{ id: 'a' }], ['a']);
    await svc.reap();
    const whereArg = find.mock.calls[0][0].where;
    expect(whereArg.kind).toBe(UserKind.TEMPORARY);
  });
});
