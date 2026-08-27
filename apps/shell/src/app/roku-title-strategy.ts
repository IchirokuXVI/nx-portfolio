import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  TitleStrategy,
} from '@angular/router';
import { ROKU_TRANSLATOR } from '@portfolio/localization/rokutranslator-angular';

/**
 * Resolves a route's `title` as a translation key through RokuTranslator, so
 * document titles are localized the same way page content is.
 *
 * Set on a route: `title` is the translation key, and route `data` carries:
 * - `titleNs`: the namespace the key lives in (an app's own namespace);
 * - `titleFallback`: a plain string shown when that namespace's translations
 *   are not loaded yet (i18next returns the key on a miss). A locale switch is a
 *   full reload, so once the namespace is loaded the localized title stands.
 *
 * `titleNs` / `titleFallback` are read from the deepest activated route that
 * declares them, matching how `buildTitle` picks the deepest `title`.
 */
@Injectable({ providedIn: 'root' })
export class RokuTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  /**
   * **Transitional, and removed by the shell step of plan 0003**, which is where
   * `titleNs` / `titleFallback` come out of the route table and each app starts
   * setting its own title from its own translator (plan 0005 D10).
   *
   * Until then the shell still localizes titles on behalf of the apps that have not
   * migrated, and it does that through the transitional root `ROKU_TRANSLATOR`,
   * which is the same instance those apps are using. After the migration the shell
   * has no translator at all and this strategy keeps only the literal `title` path.
   */
  private readonly translator = inject(ROKU_TRANSLATOR);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    const { ns, fallback } = this.resolveTitleMeta(snapshot.root);

    if (key === undefined) {
      if (fallback !== undefined) {
        this.title.setTitle(fallback);
      }
      return;
    }

    const translated = this.translator.t(key, ns ? { ns } : undefined);
    const missing = translated === key;

    this.title.setTitle(
      missing && fallback !== undefined ? fallback : translated
    );
  }

  private resolveTitleMeta(root: ActivatedRouteSnapshot): {
    ns?: string;
    fallback?: string;
  } {
    let route: ActivatedRouteSnapshot | null = root;
    let ns: string | undefined;
    let fallback: string | undefined;

    while (route) {
      const data = route.data;
      if (typeof data['titleNs'] === 'string') {
        ns = data['titleNs'];
      }
      if (typeof data['titleFallback'] === 'string') {
        fallback = data['titleFallback'];
      }
      route = route.firstChild;
    }

    return { ns, fallback };
  }
}
