import { commandStepKey, runOnce, type IdempotencyStore } from './idempotency';

class FakeStore implements IdempotencyStore {
  private readonly seen = new Set<string>();
  async firstSeen(key: string): Promise<boolean> {
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    return true;
  }
}

describe('idempotency', () => {
  it('runs the effect once and skips on redelivery', async () => {
    const store = new FakeStore();
    const effect = jest.fn().mockResolvedValue('done');

    expect(await runOnce(store, 'evt-1', effect)).toBe('done');
    expect(await runOnce(store, 'evt-1', effect)).toBeUndefined();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('namespaces command steps under one key', () => {
    expect(commandStepKey('cmd-1', 'mint-user')).toBe('cmd-1:mint-user');
    expect(commandStepKey('cmd-1', 'create-zone')).toBe('cmd-1:create-zone');
  });
});
