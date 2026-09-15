/**
 * El Jamon's own defaults for a future `build-document.mjs` run.
 *
 * **Not consumed by `to-harvest-document.mjs` today.** El Jamon has no per page
 * readings and no build script (its readings are already whole documents in
 * the old leaflet shape, with a `section` already resolved on every page by
 * whatever produced that reading), so nothing in this repository actually
 * calls this file yet. It exists so `drift-check.mjs` has a heading vocabulary
 * to check a future El Jamon reading against, and so a first per page build for
 * this chain starts from the vocabulary the September 2026 reading already
 * used rather than an empty map.
 */

/** The printed heading, folded (accents stripped, upper cased), mapped onto
 * the schema's own department vocabulary. Populated from the sections the
 * September 2026 reading actually used. */
export const SECTIONS = {
  CARNICERIA: 'carniceria',
  BEBIDAS: 'bebidas',
  LACTEOS: 'lacteos',
  DROGUERIA: 'drogueria',
  PERFUMERIA: 'perfumeria',
};

/** The one page this chain's readings have fixed so far. */
export const FIXED_SECTIONS = { 1: 'cover' };

/** The model this chain's one reading has used so far. */
export const TOOL_NAME = 'claude opus 5 reading the rendered pages at 200 dpi';
