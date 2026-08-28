import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';

/**
 * A `RokuLocaleStore` for tests: an English locale that never moves, and a switch
 * that records what it was asked for instead of navigating.
 *
 * It exists because the store used to be `providedIn: 'root'` and subscribed to a
 * module global, so a spec that rendered anything reading the locale had to
 * `jest.mock('@portfolio/localization/rokutranslator')` and hand write a fake
 * translator. Half a dozen specs carried a copy of that mock, each slightly
 * different, and each one had to be edited when the core gained a method. Providing
 * the double here means a consumer spec declares `provideRokuTranslatorTesting()`
 * and says nothing about translation at all.
 */
@Injectable()
export class RokuLocaleStoreTestingDouble {
  readonly locale = signal('en');
  readonly locale$: Observable<string> = of('en');

  /** Every `switchAppLocale` call, in order, for a spec that asserts on the switch. */
  readonly switched: { appKey: string; locale: string; mountPath?: string }[] =
    [];

  getLocale(): string {
    return this.locale();
  }

  async switchAppLocale(
    appKey: string,
    locale: string,
    mountPath?: string
  ): Promise<void> {
    this.switched.push({ appKey, locale, mountPath });
    this.locale.set(locale);
  }
}
