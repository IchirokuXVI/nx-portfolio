import { inject, Injectable, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, UrlSegment } from '@angular/router';
import { canonicalLocale } from '@portfolio/localization/rokutranslator';
import { BehaviorSubject, Observable } from 'rxjs';
import { writeAppLocale } from './locale-routing/app-locale-storage';
import { mountDepth } from './locale-routing/locale-segment';
import { ROKU_TRANSLATOR } from './roku-translator-token';

/**
 * One app's single source of truth for its active locale.
 *
 * `RokuTranslatorService` may be instantiated more than once inside an app (a UI
 * module configuring its own namespaces), so it cannot hold the locale by itself.
 * This store subscribes once to the app's `ROKU_TRANSLATOR` and exposes the current
 * locale as both an observable (for data pipelines) and a signal (for templates and
 * the pipe). The per-module service just re-exposes it.
 *
 * **It is provided by `provideRokuTranslator`, next to the translator it watches, and
 * is deliberately not `providedIn: 'root'`** (plan 0005 D5). It used to be, and that
 * worked only through an accident `module-federation.shared.ts` documents at length:
 * this library is not shared across remotes, so each remote carried a duplicate class,
 * a distinct DI token and therefore a distinct instance in one root injector, and the
 * copies stayed in step **only because every one of them subscribed to the same shared
 * core**. With a translator per app that property is gone, and a store in the
 * portfolio's root injector could not see an app scoped translator provided below it
 * anyway.
 *
 * `providedIn: 'root'` is **transitional and removed by the cleanup step of
 * `apps/shell/plans/0003`**, for the same reason `ROKU_TRANSLATOR` keeps a root
 * factory: an app that has not migrated yet installs its translations on a UI module,
 * below the components that inject this store, so until it moves its providers up the
 * root binding is the only one those components can see. A local provider wins for
 * everything below it, so an app that *has* migrated already gets its own.
 */
@Injectable({ providedIn: 'root' })
export class RokuLocaleStore {
  private _router = inject(Router);
  private _translator = inject(ROKU_TRANSLATOR);

  private readonly _locale$ = new BehaviorSubject<string>(
    this.readInitialLocale()
  );

  /** Current locale as an observable. Data pipelines key their refetch off this. */
  readonly locale$: Observable<string> = this._locale$.asObservable();

  /** Current locale as a signal. Reading it in a view wakes OnPush components. */
  readonly locale: Signal<string> = toSignal(this._locale$, {
    requireSync: true,
  });

  constructor() {
    this._translator.onLocaleChange((locale) => this._locale$.next(locale));
  }

  /**
   * The active locale is normally settled by the app's `init` before this store is
   * first injected. Guard the read so early access (or a test that never calls init)
   * falls back instead of throwing.
   */
  private readInitialLocale(): string {
    try {
      return this._translator.getLocale();
    } catch {
      return 'en';
    }
  }

  getLocale(): string {
    return this._locale$.value;
  }

  /**
   * Post-render locale switch, triggered from a language switcher. Changes the
   * locale in place (no full page reload): updates the app's translator (which emits
   * and flips the signal, re-rendering the pure:false pipes and re-triggering the
   * locale-keyed data pipelines), persists the per-app choice, and rewrites the
   * app's locale segment via a router navigation.
   *
   * `mountPath` is where the app is mounted, and the locale segment is the one
   * immediately after it. It is a parameter rather than an assumed index 0 because
   * the locale now sits *below* each app's mount (`/velista/en/...`), so index 0 is
   * the mount for every app except the one at the site root (plan 0005 D7).
   */
  async switchAppLocale(
    appKey: string,
    locale: string,
    mountPath = ''
  ): Promise<void> {
    writeAppLocale(appKey, locale);

    await this._translator.changeLocale(locale);

    // Rewrite this app's locale segment. A router navigation (not window.location)
    // keeps the router state consistent and avoids a reload; the app's own
    // localeGuard re-validates the new segment on the way in.
    const tree = this._router.parseUrl(this._router.url);
    const primary = tree.root.children['primary'];
    const index = mountDepth(mountPath);
    const canonical = canonicalLocale(locale);

    if (primary && primary.segments.length > index) {
      primary.segments[index].path = canonical;
    } else if (primary) {
      // The path stops at the mount, so there is no locale segment to rewrite yet.
      primary.segments = [...primary.segments, new UrlSegment(canonical, {})];
    }

    await this._router.navigateByUrl(tree);
  }
}
