import { runWithRequestContext } from '@portfolio/luna-shopper/platform';
import type { UsernamePool } from './pool';
import {
  USERNAME_POOLS,
  UsernameGenerator,
} from './username-generator.service';
import { UsernameController } from './username.controller';

const everyName = (pool: UsernamePool): string[] =>
  pool.nouns.flatMap((noun) =>
    pool.adjectives.map((adjective) => pool.compose(noun, adjective))
  );

/**
 * A fresh generated name (plan 0145, section 4).
 *
 * The two things worth proving are that the name comes from the caller's own
 * pool and that asking for one changes nothing anywhere. The second is proven
 * by construction here: the controller is built with the generator alone, so a
 * repository it does not hold is a repository it cannot write to, and any
 * future dependency has to be added to this file before it compiles.
 */
describe('UsernameController', () => {
  const controller = new UsernameController(new UsernameGenerator());

  it('answers a name from the locale it was given', () => {
    const { username } = controller.suggest({ locale: 'es' });

    expect(everyName(USERNAME_POOLS.es)).toContain(username);
  });

  it('answers a name from the request context when none is named', () => {
    const answer = runWithRequestContext(
      { correlationId: 'c', locale: 'es' },
      () => controller.suggest({})
    );

    expect(everyName(USERNAME_POOLS.es)).toContain(answer.username);
  });

  it('falls back to English when nothing says otherwise', () => {
    const { username } = controller.suggest({});

    expect(everyName(USERNAME_POOLS.en)).toContain(username);
  });

  it('answers a different name often enough to be worth a button', () => {
    // Not "always different": the pools are finite and a fair draw repeats.
    // What the screen needs is that pressing again moves, which twenty draws
    // over a pool this size prove without ever being flaky.
    const names = new Set(
      Array.from({ length: 20 }, () => controller.suggest({}).username)
    );

    expect(names.size).toBeGreaterThan(1);
  });
});
