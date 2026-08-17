import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * Read the `supportedLocales` an app declared on its top route `data` (the same
 * list the {@link localeCorrectionGuard} validates against). A language switcher
 * calls this so it offers exactly the app's enabled locales, sourced from the
 * feature-shell's route config rather than a hardcoded UI constant.
 *
 * Must be called in an injection context (a field initializer / constructor).
 * Returns `undefined` when there is no router or no route in the chain declares
 * `supportedLocales`, so the caller can fall back to a sensible default.
 */
export function injectSupportedLocales(): readonly string[] | undefined {
  const route = inject(ActivatedRoute, { optional: true });

  if (!route) {
    return undefined;
  }

  for (const ancestor of route.pathFromRoot) {
    const locales = ancestor.snapshot.data['supportedLocales'];
    if (Array.isArray(locales) && locales.length > 0) {
      return locales as string[];
    }
  }

  return undefined;
}
