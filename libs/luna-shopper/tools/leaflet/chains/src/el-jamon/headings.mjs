/**
 * El Jamon's own defaults for a `build-document.mjs` run.
 *
 * `build-document.mjs` loads this file on every El Jamon build, as it does for
 * every chain: `SECTIONS` resolves the printed department heading, and
 * `FIXED_SECTIONS` and `TOOL_NAME` are the defaults a leaflet's own
 * `leaflet.json` can override. `cli.mjs` reads `DPI` when it renders the pages.
 * The vocabulary is the one the September 2026 whole document reading used,
 * before El Jamon moved to per page readings.
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

/** The dpi `cli.mjs` renders this chain's pages at, unless `--dpi` says
 * otherwise. 160 is what the September 2026 reading and the model comparison in
 * the leaflet plan's section 7 both used. */
export const DPI = 160;
