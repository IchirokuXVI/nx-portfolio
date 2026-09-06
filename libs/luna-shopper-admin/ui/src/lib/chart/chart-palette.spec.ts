import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHART_COLOURS,
  CHART_COLOUR_COUNT,
  chartColourVar,
} from './chart-palette';

/**
 * The palette, asserted where a spec can assert it.
 *
 * The validator that actually chose these six is the `dataviz` skill's
 * `scripts/validate_palette.js`, which measures the lightness band, the chroma
 * floor, every adjacent pair under each form of colour blindness and the
 * contrast against the surface. Running it here would mean vendoring it, and a
 * vendored copy drifts from the one that gets updated, so its run is recorded in
 * the pull request and what stays here is the pair of invariants a copy of the
 * numbers can break on its own: that there are six distinct colours, and that
 * the stylesheet and the TypeScript agree about which six.
 */
describe('the chart palette', () => {
  it('is six distinct colours', () => {
    expect(CHART_COLOURS).toHaveLength(6);
    expect(CHART_COLOUR_COUNT).toBe(6);
    expect(new Set(CHART_COLOURS).size).toBe(6);
    for (const colour of CHART_COLOURS) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /**
   * Declared twice, in the stylesheet the browser paints from and in the module a
   * spec can read, so the two are checked against each other rather than trusted
   * to have been edited together.
   */
  it('is the same six the stylesheet declares, in the same order', () => {
    const tokens = readFileSync(
      join(__dirname, '..', 'styles', '_tokens.scss'),
      'utf8'
    );

    const declared = CHART_COLOURS.map((_colour, index) => {
      const found = new RegExp(
        `--admin-chart-${index + 1}:\\s*(#[0-9a-f]{6});`
      ).exec(tokens);
      return found?.[1] ?? null;
    });

    expect(declared).toEqual([...CHART_COLOURS]);
  });

  /**
   * A series takes its colour by position, so the number it carries is the whole
   * of the decision and a number outside the six is a caller's arithmetic slip.
   * Clamping draws a wrong hue; dropping the series would draw nothing at all,
   * which is the worse of the two answers.
   */
  it('names a custom property per position, and clamps anything outside them', () => {
    expect(chartColourVar(1)).toBe('var(--admin-chart-1)');
    expect(chartColourVar(6)).toBe('var(--admin-chart-6)');
    expect(chartColourVar(0)).toBe('var(--admin-chart-1)');
    expect(chartColourVar(9)).toBe('var(--admin-chart-6)');
  });
});
