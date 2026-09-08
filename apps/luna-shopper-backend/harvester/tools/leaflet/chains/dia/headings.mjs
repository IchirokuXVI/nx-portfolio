/**
 * Dia's own defaults for `build-document.mjs`: what its printed department
 * headings become, which pages carry no heading at all, and which model this
 * chain's readings have used so far.
 *
 * **Both maps are starting points, not the leaflet's own truth.** A leaflet's
 * `fixed_sections` wins for its own pages, because the cover and the back
 * cover move when the leaflet grows or shrinks by a page. `SECTIONS` itself is
 * closer to fixed: it survives leaflet to leaflet, and a heading this chain
 * never printed before is exactly what `drift-check.mjs` should stop on.
 */

/** The printed heading, folded (accents stripped, upper cased), mapped onto
 * the schema's own department vocabulary.
 *
 * **Empty on purpose.** Dia prints no department heading banner. Two editions
 * were looked at, the week of 02/09 and the week of 09/09, and neither names a
 * department anywhere: a page is themed but unlabelled, and what a page does
 * print across the top is a campaign banner (`DIA WORLD BURGER TOUR`,
 * `TU COMPRA AYUDA`, `VIVE LA CARRERA EN MADRING`), which names a campaign and
 * not a department. So `chains/dia/prompt.txt` asks for an empty
 * `categoryPath` on every page, and a heading that does turn up in a later
 * edition reaches the build with no slug, which raises a warning and lands in
 * the report's `unrecognizedHeadings`. That is the intended signal: it means
 * Dia changed its leaflet, and a person should add the heading here rather
 * than let the reading resolve it silently. */
export const SECTIONS = {};

/** The pages that carry no heading because they are not a department, as the
 * September 2026 leaflets laid them out. Both editions are twelve pages, the
 * cover and the back cover both carry priced products, and neither has an
 * index page. A different page count moves the back cover, which is why
 * `leaflet.json`'s own `fixed_sections` overrides this default. */
export const FIXED_SECTIONS = {
  1: 'cover',
  12: 'back-cover',
};

/** The model and prompt this chain's readings have used so far. A leaflet read
 * with something else states its own `extraction.tool` in `leaflet.json`,
 * which then wins over this default. */
export const TOOL_NAME = 'claude-opus-5 via Claude Code, chains/dia/prompt.txt';
