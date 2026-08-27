import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RokuTranslatorService } from './rokutranslator-service';

/**
 * A route `title` that is a translation key, resolved through **this app's** own
 * translator (plan 0005 D10).
 *
 * The shell used to do this for everybody: a `titleNs` in route data named the
 * remote's namespace and a shell-wide `TitleStrategy` looked the key up in the one
 * shared translator. With a translator per app the shell has no translator to call,
 * and route data naming another app's namespace means nothing. So the title goes next
 * to the instance that owns the strings, which is also the only shape that survives an
 * app running standalone on its own origin.
 *
 * It is a resolver rather than a plain string because the strings arrive
 * asynchronously: awaiting `loaded$` is what stops the first paint setting the raw key
 * as the document title. `loaded$` is a `ReplaySubject(1)`, so every navigation after
 * the first resolves from the buffer and costs nothing.
 *
 * Install it on the app's parent route, the same one carrying the locale guard, so the
 * title is set in the language the page is about to render in:
 *
 * ```ts
 * { path: '', canActivate: [localeGuard], title: localizedTitle('app-title'), ... }
 * ```
 *
 * @param key the translation key.
 * @param ns optional namespace override, for a key that lives in one of the app's
 *   other namespaces rather than its default.
 */
export function localizedTitle(key: string, ns?: string): ResolveFn<string> {
  return async () => {
    const translator = inject(RokuTranslatorService);

    await firstValueFrom(translator.loaded$);

    return translator.t(key, ns);
  };
}
