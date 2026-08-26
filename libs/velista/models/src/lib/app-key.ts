/**
 * The app's technical identifier, used to namespace anything it persists.
 *
 * The value is the Nx project name, which plan 0001 section 2 fixes as stable
 * across a rename. It is deliberately **not** the product name: rule N1 keeps that
 * out of every identifier, and a persisted key is the worst place to put one,
 * because renaming it would silently orphan every stored preference.
 *
 * It lives in `models` rather than in `ui` so that `data-access` can namespace its
 * storage keys with it without depending on the presentation layer. `ui`
 * re-exports it, so `@portfolio/velista/ui` remains a valid import site.
 */
export const APP_KEY = 'velista';
