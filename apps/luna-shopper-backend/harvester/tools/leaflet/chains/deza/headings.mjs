/**
 * Deza's own defaults for `build-document.mjs`: what its printed department
 * headings become, which pages carry no heading at all, and which model this
 * chain's readings have used so far.
 *
 * **Both maps are starting points, not the leaflet's own truth.** A leaflet's
 * `fixed_sections` wins for its own pages, because the cover, the index and the
 * back cover move when the leaflet grows or shrinks by a page. `SECTIONS`
 * itself is closer to fixed: it survives leaflet to leaflet, and a heading this
 * chain never printed before is exactly what `drift-check.mjs` should stop on.
 */

/** The printed heading, folded (accents stripped, upper cased), mapped onto
 * the schema's own department vocabulary. */
export const SECTIONS = {
  FRUTERIA: 'fruteria',
  PESCADERIA: 'pescaderia',
  CARNICERIA: 'carniceria',
  'ELABORADOS CARNICOS': 'elaborados-carnicos',
  CHARCUTERIA: 'charcuteria',
  'CHARCUTERIA AL CORTE': 'charcuteria',
  'PLATOS PREPARADOS': 'platos-preparados',
  REFRIGERADOS: 'refrigerados',
  CONGELADOS: 'congelados',
  'ACEITES Y SALSAS': 'despensa',
  ALIMENTACION: 'despensa',
  'DESAYUNOS Y MERIENDAS': 'desayunos-meriendas',
  APERITIVOS: 'aperitivos',
  BEBIDAS: 'bebidas',
  'CERVEZAS Y VINOS': 'bodega',
  PERFUMERIA: 'perfumeria',
  LIMPIEZA: 'limpieza',
  AMBIENTACION: 'ambientacion',
  'BAZAR - ESPECIAL PISO DE ESTUDIANTES': 'bazar',
  'VUELTA AL COLE': 'vuelta-al-cole',
};

/** The pages that carry no heading because they are not a department, as the
 * September 2026 leaflet laid them out. A different page count moves these,
 * which is why `leaflet.json`'s own `fixed_sections` overrides this default. */
export const FIXED_SECTIONS = {
  1: 'cover',
  2: 'index',
  3: 'index',
  62: 'back-cover',
};

/** The model and prompt this chain's readings have used so far. A leaflet read
 * with something else states its own `extraction.tool` in `leaflet.json`,
 * which then wins over this default. Kept verbatim from the September 2026
 * reading: it is a historical record, written into that reading's own
 * `producer.name`, and not a claim about the file this prompt now lives in. */
export const TOOL_NAME =
  'claude-sonnet-5 via Claude Code, prompt-deza-import.txt';
