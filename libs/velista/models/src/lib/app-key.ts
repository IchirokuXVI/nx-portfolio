/**
 * The app's technical identifier, used to namespace anything it persists.
 *
 * The value is the Nx project name, which plan 0001 section 2 fixes as stable across a
 * rename. It is deliberately **not** the product name: rule N1 keeps that out of every
 * identifier, and a persisted key is the worst place to put one, because renaming it
 * would silently orphan every stored preference. The constant itself is unprefixed
 * because the `@portfolio/velista/models` import path already scopes it.
 *
 * Three namespaces are built from it today: the persisted locale
 * (`roku-locale:{appKey}`), the theme choice (plan 0002), and the session tokens
 * (plan 0004, section 5.3).
 *
 * **The namespace is load bearing, not tidiness.** While this app runs as a remote it
 * shares an origin with the whole portfolio, so an unnamespaced key collides with the
 * shell and with every other remote. Extraction gives the app its own origin and the
 * namespace becomes harmless.
 *
 * It lives in `models` rather than in `ui` so that the layers below the presentation
 * layer can namespace their own storage keys without depending on it: `data-access`
 * (plan 0002) and `platform` (plan 0004, section 3.2), both of which sit under `ui`.
 * `ui` re-exports it, so `@portfolio/velista/ui` remains a valid import site.
 */
export const APP_KEY = 'velista';
