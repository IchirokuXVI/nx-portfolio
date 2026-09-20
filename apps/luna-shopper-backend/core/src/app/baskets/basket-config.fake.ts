import type { ConfigService } from '@nestjs/config';

/** The default `BASKET_SKIP_WINDOW`, so a spec states a deviation and not the norm. */
export const SKIP_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * The slice of `core` configuration the basket reads (plan 0137, section 8).
 *
 * A stand in rather than a real `ConfigService`, because loading the real one
 * means loading the whole Joi schema and with it a database url, two public keys
 * and a broker address, none of which a spec about a row has anything to say
 * about.
 *
 * `skipWindowMs` is the one value under test, so it is an argument: test 12 of
 * section 10 reads the same row as stale at the default and fresh at fourteen
 * hours, which is what proves the comparison is the database's rather than a
 * constant somebody folded into TypeScript.
 */
export function fakeCoreConfig(skipWindowMs = SKIP_WINDOW_MS): ConfigService {
  return {
    getOrThrow: () => ({
      basket: { skipWindowMs },
      generatedList: { claimWindowMs: 60 * 60 * 60 * 1000 },
    }),
  } as unknown as ConfigService;
}
