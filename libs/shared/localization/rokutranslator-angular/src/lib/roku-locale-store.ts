import { inject, Injectable, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { BehaviorSubject, Observable } from 'rxjs';
import { writeAppLocale } from './locale-routing/app-locale-storage';

/**
 * App-wide single source of truth for the active locale.
 *
 * `RokuTranslatorService` is instantiated per module (each remote configures its
 * own namespaces), so it cannot hold the global locale by itself. This store is
 * `providedIn: 'root'`, subscribes once to the `RokuTranslator` singleton, and
 * exposes the current locale as both an observable (for data pipelines) and a
 * signal (for templates / the pipe). The per-module service just re-exposes it.
 *
 * The canonical holder is a `BehaviorSubject`, so `locale$` replays the current
 * value synchronously on subscribe — a locale-keyed fetch resolves in the same
 * tick as a plain call would, which keeps synchronous consumers (and their tests)
 * working. The signal is derived from it for change-detection.
 */
@Injectable({ providedIn: 'root' })
export class RokuLocaleStore {
  private _router = inject(Router);

  private readonly _locale$ = new BehaviorSubject<string>(
    RokuLocaleStore.readInitialLocale()
  );

  /** Current locale as an observable. Data pipelines key their refetch off this. */
  readonly locale$: Observable<string> = this._locale$.asObservable();

  /** Current locale as a signal. Reading it in a view wakes OnPush components. */
  readonly locale: Signal<string> = toSignal(this._locale$, {
    requireSync: true,
  });

  constructor() {
    RokuTranslator.onLocaleChange((locale) => this._locale$.next(locale));
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
    return this._locale$.value;
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
