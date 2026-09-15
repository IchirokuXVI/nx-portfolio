/**
 * LIDL's own defaults for `build-document.mjs`: what its printed banner
 * headlines become, which pages carry no heading at all, and which model this
 * chain's readings have used so far.
 *
 * **Both maps are starting points, not the leaflet's own truth.** A leaflet's
 * `fixed_sections` wins for its own pages, because the cover and the back cover
 * move when the leaflet grows or shrinks by a page.
 *
 * **`SECTIONS` is less stable here than it is for Deza, and that is the
 * chain's doing.** Deza prints a department name (`CARNICERIA`, `DROGUERIA`).
 * LIDL prints a marketing headline that names a product family in a different
 * sentence every week: `Elige la mejor fruta`, `Yo elijo ahorrar con el mejor
 * pescado fresco`, `Prepara el mejor bocadillo`. So a headline this map cannot
 * resolve is ordinary for LIDL rather than alarming, and the drift worth acting
 * on is a headline that resolves to the WRONG department, not one that resolves
 * to none. `category_path` does not depend on this map either
 * way: `to-harvest-document.mjs` writes the printed headline verbatim, and what
 * a miss costs is `extra.section` and a line in the build's warnings.
 *
 * The prompt already suppresses the headlines that name no department at all
 * (`Récord en ofertas`, `Súper finde`, `Tus otras marcas de siempre`), so they
 * arrive as an empty category path and never reach this map.
 */

/** The printed banner headline, folded (accents stripped, upper cased), mapped
 * onto the schema's own department vocabulary. Both the punctuated and the bare
 * form of a headline are listed where the leaflet sets a full stop or an
 * opening exclamation mark in artwork, because a page reader may or may not
 * copy it.
 *
 * **`Elige el mejor pan y bollería` is deliberately absent.** Bread and pastry
 * have no slug in the vocabulary the existing chains established, and inventing
 * `panaderia` here would put a value in `extra.section` that nothing else in
 * the workspace uses. The build warns on that heading once per bakery page,
 * which is the honest record of a gap; add the slug once the vocabulary does. */
export const SECTIONS = {
  'ELIGE LA MEJOR FRUTA': 'fruteria',
  'VERDURAS LISTAS PARA DISFRUTAR': 'fruteria',
  'YO ELIJO AHORRAR CON EL MEJOR PESCADO FRESCO': 'pescaderia',
  'YO ELIJO AHORRAR CON LA MEJOR CARNE FRESCA': 'carniceria',
  'YO ELIJO AHORRAR CON LOS EMBUTIDOS MAS SABROSOS': 'charcuteria',
  'PREPARA EL MEJOR BOCADILLO': 'charcuteria',
  'ENSALADAS LISTAS Y FRESCAS': 'platos-preparados',
  'FACIL DE PREPARAR': 'platos-preparados',
  'AUTENTICO SABOR A FRUTA PARA LLEVAR': 'bebidas',
  'CUIDARTE POR DENTRO VALE LA PENA': 'lacteos',
  'CUIDARTE POR DENTRO VALE LA PENA.': 'lacteos',
  'ELIGE CUIDARTE': 'perfumeria',
  'HOLA, FLORES!': 'bazar',
  '¡HOLA, FLORES!': 'bazar',
};

/** The pages that carry no heading because they are not a department, as the
 * September 2026 leaflet (edition 37/2026, 55 pages) laid them out. Both still
 * carry priced tiles, unlike Deza's cover. **This leaflet has no index page**:
 * nothing in it lists its own contents. A different page count moves the back
 * cover, which is why `leaflet.json`'s own `fixed_sections` overrides this
 * default. */
export const FIXED_SECTIONS = {
  1: 'cover',
  55: 'back-cover',
};

/** The model and prompt this chain's readings have used so far. A leaflet read
 * with something else states its own `extraction.tool` in `leaflet.json`, which
 * then wins over this default. */
export const TOOL_NAME =
  'claude-opus-5 via Claude Code, chains/lidl/prompt.txt';
