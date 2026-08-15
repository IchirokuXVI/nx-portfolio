import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

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

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    const { ns, fallback } = this.resolveTitleMeta(snapshot.root);

    if (key === undefined) {
      if (fallback !== undefined) {
        this.title.setTitle(fallback);
      }
      return;
    }

    const translated = RokuTranslator.t(key, ns ? { ns } : undefined);
    const missing = translated === key;

    this.title.setTitle(missing && fallback !== undefined ? fallback : translated);
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
