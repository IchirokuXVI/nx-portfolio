/**
 * The technical identifier for this app, used to namespace anything it persists.
 *
 * Its value is the Nx project name, which is stable across a rename (plan 0001,
 * section 2), and **not** the product name, which lives only in `AppBrand`. Rule N1
 * keeps the product name out of code symbols, and this constant is deliberately
 * unprefixed because the `@portfolio/velista/models` import path already scopes it.
 *
 * Two namespaces are built from it today: the persisted locale (`roku-locale:{appKey}`)
 * and the session tokens (plan 0004, section 5.3).
 *
 * **The namespace is load bearing, not tidiness.** While this app runs as a remote it
 * shares an origin with the whole portfolio, so an unnamespaced storage key collides
 * with the shell and with every other remote. Extraction gives the app its own origin
 * and the namespace becomes harmless.
 *
 * It lives in `models` rather than in `ui` because `platform` needs it for the storage
 * namespace while sitting below `ui` in the layering (plan 0004, section 3.2). `ui`
 * re-exports it, so `@portfolio/velista/ui` remains a valid source for it.
 */
export const APP_KEY = 'velista';
