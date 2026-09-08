/**
 * What a chart is handed (plan 0015, section 3).
 *
 * The three shapes below are the whole contract between a screen and a chart.
 * Nothing here knows where a number came from, which is the point: the dashboard
 * builds these in a selector, a spec builds them by hand out of literals, and a
 * later screen that wants a chart of one chain's prices builds them from
 * something else again. A chart that reached for a wire type would be the
 * dashboard's chart and nobody else's.
 *
 * Every string that reaches a chart is already translated, except the handful of
 * words the charts own themselves (section 5), which live under `chart` in this
 * library's `en.json`.
 */

export interface ChartPoint {
  /** `YYYY-MM-DD`. The chart parses it as a UTC day. */
  readonly day: string;
  readonly value: number;
}

/**
 * A series without its numbers: who it is and which colour it wears.
 *
 * The bar chart takes a list of these beside its bars, because a stack's
 * categories carry the values and the series carry only identity. The line
 * chart's {@link ChartSeries} is this plus the points, so the two agree on what
 * identity means and a caller can build one from the other.
 */
export interface ChartSeriesInfo {
  /** Stable across renders: what `@for` tracks and what the colour is keyed on. */
  readonly key: string;
  /** Already translated. */
  readonly label: string;
  /**
   * Which of the six colours. 1 to 6, and the same whenever this series appears.
   *
   * A position, never a cursor into a cycling list. A series that is absent this
   * month keeps its number for the month it comes back, so a reader who learned
   * a colour last week has not been lied to.
   */
  readonly colour: number;
}

export interface ChartSeries extends ChartSeriesInfo {
  readonly points: readonly ChartPoint[];
}

export interface ChartBar {
  readonly key: string;
  readonly label: string;
  /** One entry per series, in series order. A single series is an array of one. */
  readonly values: readonly number[];
}

/** What a stat tile shows beside its number, when there is one to show. */
export interface ChartDelta {
  readonly value: number;
  /** Already translated, and it names the period: "in the last 7 days". */
  readonly caption: string;
}
