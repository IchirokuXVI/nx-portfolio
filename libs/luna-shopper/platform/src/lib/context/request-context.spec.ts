import {
  getCorrelationId,
  getRequestContext,
  runWithRequestContext,
  setRequestContext,
} from './request-context';

describe('request context', () => {
  it('exposes the context only inside a scope', () => {
    expect(getRequestContext()).toBeUndefined();

    runWithRequestContext({ correlationId: 'x' }, () => {
      expect(getCorrelationId()).toBe('x');
      setRequestContext({ userId: 'u1', zoneId: 'z1' });
      expect(getRequestContext()).toMatchObject({
        correlationId: 'x',
        userId: 'u1',
        zoneId: 'z1',
      });
    });

    expect(getRequestContext()).toBeUndefined();
  });

  it('setRequestContext is a no-op outside a scope', () => {
    expect(() => setRequestContext({ userId: 'u' })).not.toThrow();
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates concurrent scopes', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      runWithRequestContext({ correlationId: 'a' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getCorrelationId());
      }),
      runWithRequestContext({ correlationId: 'b' }, async () => {
        seen.push(getCorrelationId());
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });
});
