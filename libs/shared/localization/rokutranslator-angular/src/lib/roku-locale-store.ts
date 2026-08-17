import { inject, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { Observable } from 'rxjs';
import { writeAppLocale } from './locale-routing/app-locale-storage';

/**
 * App-wide single source of truth for the active locale.
 *
 * `RokuTranslatorService` is instantiated per module (each remote configures its
 * own namespaces), so it cannot hold the global locale by itself. This store is
 * `providedIn: 'root'`, subscribes once to the `RokuTranslator` singleton, and
 * exposes the current locale as both a signal (for templates / the pipe) and an
 * observable (for data pipelines). The per-module service just re-exposes it.
 */
@Injectable({ providedIn: 'root' })
export class RokuLocaleStore {
  private _router = inject(Router);

  private readonly _locale = signal(RokuLocaleStore.readInitialLocale());

  /** Current locale as a signal. Reading it in a view wakes OnPush components. */
  readonly locale = this._locale.asReadonly();

  /** Current locale as an observable. Data pipelines key their refetch off this. */
  readonly locale$: Observable<string> = toObservable(this._locale);

  constructor() {
    RokuTranslator.onLocaleChange((locale) => this._locale.set(locale));
  }

  /**
   * The active locale is normally settled by `RokuTranslator.init` (an app
   * initializer) before this store is first injected. Guard the read so early
   * access (or a test that never calls init) falls back instead of throwing.
   */
  private static readInitialLocale(): string {
    try {
      return RokuTranslator.getLocale();
    } catch {
      return 'en';
    }
  }

  getLocale(): string {
    return this._locale();
  }

  /**
   * Post-render locale switch, triggered from a language switcher. Changes the
   * locale in place (no full page reload): updates `RokuTranslator` (which emits
   * and flips the signal, re-rendering the pure:false pipes and re-triggering the
   * locale-keyed data pipelines), persists the per-app choice, and rewrites the
   * leading locale segment of the URL via a router navigation.
   */
  async switchAppLocale(appKey: string, locale: string): Promise<void> {
    writeAppLocale(appKey, locale);

    await RokuTranslator.changeLocale(locale);

    // Rewrite the leading locale segment of the current URL. A router navigation
    // (not window.location) keeps the router state consistent and avoids a reload;
    // each app's localeCorrectionGuard re-validates the new segment on the way in.
    const tree = this._router.parseUrl(this._router.url);
    const primary = tree.root.children['primary'];

    if (primary && primary.segments.length > 0) {
      primary.segments[0].path = RokuTranslator.formatLocale(locale);
    }

    await this._router.navigateByUrl(tree);
  }
}
