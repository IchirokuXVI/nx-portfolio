/**
 * How a key becomes a sentence. The screen hands the translator's `t` through.
 *
 * In `models` rather than beside any one dashboard, because four screens build
 * their view models with it since admin plan 0022 split the overview into a
 * section each. It is the one shape all four share that names nothing from a
 * component library, so it is the one that can live down here.
 */
export type Translate = (
  key: string,
  values?: Record<string, unknown>
) => string;
