import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  getRequestContext,
  toSupportedLocale,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import { randomInt } from 'node:crypto';
import type { UsernamePool, UsernamePools } from './pool';
import { enPool } from './pools/en';
import { esPool } from './pools/es';

/** One pool per supported locale (plan 0018, section 3.1). */
export const USERNAME_POOLS: UsernamePools = {
  en: enPool,
  es: esPool,
};

/**
 * Generates a user's global username (plan 0018, section 3).
 *
 * Auth is the only service that mints identities, so it is the only service that
 * generates names. A name is drawn from **one locale's pool only** and stored
 * verbatim with no locale tag: it is a plain string from the moment it exists,
 * shown identically to every viewer whatever their own locale. Recording which
 * pool it came from would invite a future translation of it, which is precisely
 * the behaviour the requirement forbids.
 */
@Injectable()
export class UsernameGenerator {
  /**
   * A fresh name in `locale`, defaulting to the active request's locale (seeded
   * from the NATS headers by `RpcCorrelationInterceptor`) and finally to English.
   * The locale is used once and discarded: a user who later switches the app to
   * another language keeps their name, because by then it is theirs.
   */
  generate(locale?: string | null): string {
    const pool = this.poolFor(locale);
    const noun = pool.nouns[randomInt(pool.nouns.length)];
    const adjective = pool.adjectives[randomInt(pool.adjectives.length)];
    return pool.compose(noun, adjective);
  }

  private poolFor(locale?: string | null): UsernamePool {
    return USERNAME_POOLS[this.resolveLocale(locale)];
  }

  private resolveLocale(locale?: string | null): SupportedLocale {
    return (
      toSupportedLocale(locale) ?? getRequestContext()?.locale ?? DEFAULT_LOCALE
    );
  }
}
