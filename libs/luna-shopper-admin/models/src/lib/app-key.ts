/**
 * The key this app namespaces its own browser storage under.
 *
 * Today that is the chosen locale (`roku-locale:{appKey}`), which is the only thing
 * this app persists: there is no locale segment in the URL (plan 0001, section 3),
 * so the choice has to live somewhere, and `localStorage` under this key is where.
 *
 * It is deliberately **not** where a token goes. Plan `0002` section 3 keeps the
 * session in memory alone, so closing the tab ends it.
 */
export const APP_KEY = 'luna-shopper-admin';
