/**
 * The six colours a series can wear, and nothing else (plan 0015, section 2).
 *
 * They are declared twice on purpose: as custom properties in `_tokens.scss`,
 * which is what the browser paints from, and here, which is what a spec can
 * read. Vendoring the validator into jest would be the alternative and it would
 * assert the same six numbers against a copy of the checks, so the spec asserts
 * the cheap invariants (there are six, they are distinct, they are the values the
 * stylesheet declares) and the PR carries the validator's run.
 *
 * The values are the `dataviz` skill's reference categorical palette, slots one
 * to six, validated against this app's raised surface (`#ffffff`) with
 * `scripts/validate_palette.js`: the lightness band, the chroma floor, the worst
 * adjacent pair under each form of colour blindness and the worst adjacent pair
 * in normal vision all pass. Three of them sit below 3:1 against white, which the
 * validator flags and which the charts answer the way the skill requires: every
 * chart of two or more series carries a legend, four or fewer are also labelled
 * directly, and every chart offers its data as a table.
 *
 * Six is the ceiling because `PriceSourceKind` has six members and that is the
 * widest categorical series any planned chart carries. A seventh folds into the
 * sixth as "other" rather than taking a generated hue.
 *
 * The order is fixed. A series takes its colour by position, so series three is
 * `--admin-chart-3` whether or not series one and two are drawn this month.
 */
export const CHART_COLOURS: readonly string[] = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
];

/** How many colours there are, which is also the highest legal `colour`. */
export const CHART_COLOUR_COUNT = CHART_COLOURS.length;

/**
 * The custom property a series' number names.
 *
 * A number outside one to six is clamped rather than dropped, because a chart
 * that draws nothing is a worse answer to a caller's arithmetic slip than a chart
 * that draws a wrong hue. Positions past the sixth are the caller's to fold into
 * "other" ({@link CHART_COLOUR_COUNT} is there for that), and the clamp is the
 * floor under a mistake, not the mechanism.
 */
export function chartColourVar(colour: number): string {
  const slot = Math.min(Math.max(Math.round(colour), 1), CHART_COLOUR_COUNT);
  return `var(--admin-chart-${slot})`;
}
