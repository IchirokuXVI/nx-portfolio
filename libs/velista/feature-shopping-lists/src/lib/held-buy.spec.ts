import { HeldBuy } from './held-buy';

/**
 * The buy that waits for the shop question (velista `0141`): a second press while
 * the question is open waits behind the first, and both are written in order,
 * once each.
 */
describe('HeldBuy', () => {
  it('writes two queued buys in the order they were pressed, the second after the first ends', async () => {
    const held = new HeldBuy();
    const log: string[] = [];
    let finishFirst: () => void = () => undefined;

    held.hold(async () => {
      log.push('first started');
      await new Promise<void>((resolve) => (finishFirst = resolve));
      log.push('first ended');
    });
    held.hold(async () => {
      log.push('second started');
    });

    const released = held.release();
    await Promise.resolve();
    expect(log).toEqual(['first started']);

    finishFirst();
    await released;
    expect(log).toEqual(['first started', 'first ended', 'second started']);
  });

  it('writes each buy once, however often it is released', async () => {
    const held = new HeldBuy();
    const written = { first: 0, second: 0 };
    held.hold(async () => {
      written.first++;
    });
    held.hold(async () => {
      written.second++;
    });

    await Promise.all([held.release(), held.release()]);
    await held.release();

    expect(written).toEqual({ first: 1, second: 1 });
  });

  it('writes nothing it dropped', async () => {
    const held = new HeldBuy();
    let written = 0;
    held.hold(async () => {
      written++;
    });
    held.hold(async () => {
      written++;
    });

    held.drop();
    await held.release();

    expect(written).toBe(0);
  });
});
