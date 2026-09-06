# 0015 A chart is a component

The dashboard (`0016`) draws numbers over time, and this app has nothing to draw them with. It has
one bar, `RunProgressView`, and that is a `div` with a width. A line over thirty days with a
hover, a legend and a table behind it for a screen reader is a different object, and building it
inside the dashboard page makes it the dashboard's and nobody else's.

So the charts are **components in `libs/luna-shopper-admin/ui`**, with plain inputs, no knowledge
of where a number came from, and their own specs. `0016` composes them. A later screen that wants
a chart of one chain's prices imports the same three and adds nothing.

Depends on `0004` for the `ui` library and its tokens. Does not depend on backend plan `0088`:
nothing here reads the gateway, and every spec runs on literal arrays.

## 1. d3 for the arithmetic, Angular for the drawing

The chart is an SVG in an Angular template. The scales, the tick positions and the path strings
come from d3's arithmetic modules, and nothing else of d3 is used:

- `d3-scale` for `scaleLinear`, `scaleTime`, `scaleBand` and their ticks.
- `d3-shape` for `line`, `area` and `stack`, which turn points into an SVG `d` string.
- `d3-array` for `max`, `extent` and `bisector`, the last of which is what a hover uses to find
  the nearest point.

Those three and their `@types` packages are the whole addition to `package.json`. **Not `d3`
itself, and not `d3-selection`.** The full bundle is the selection API and the DOM manipulation
it is built around, and a component that lets d3 write into the DOM is a component Angular cannot
reason about: two owners of one subtree, change detection that does not know what changed, and
specs that have to wait for a transition. Every element in a chart here is an Angular `@for` over
an array the component computed, so the template is the drawing and the spec reads it like any
other template.

They are ESM, they tree shake, and the three together are a few kilobytes gzipped, which is well
inside the `500kb` initial budget `project.json` sets.

`npm install` on Windows prunes other platforms' bindings from `package-lock.json`, so after the
install run `git checkout -- package-lock.json` and add only the lines the three packages need
(`npm install --package-lock-only` writes them without the prune, or take the hunks by hand).

## 2. The palette is computed, not chosen

The environment accent is red in production, amber in staging and blue in development (`0001`,
section 6). **No chart draws a series in it.** A red line in production means nothing about
the data and everything about the deployment, and the point of the accent is that it means one
thing everywhere it appears.

So charts have their own tokens, fixed across environments, in `_tokens.scss` under the admin
root:

```scss
--admin-chart-1 … --admin-chart-6   // categorical, in fixed order
--admin-chart-ink: var(--admin-ink-muted);   // axes, ticks, grid
--admin-chart-grid: var(--admin-border);
```

Six is the ceiling because `PriceSourceKind` has six members and that is the widest categorical
series any planned chart carries. A seventh series folds into the sixth as "other" rather than
taking a generated hue.

The six values are **validated, not eyeballed**. The `dataviz` skill ships
`scripts/validate_palette.js`, which checks the lightness band, the chroma floor, the separation
of adjacent pairs under each form of colour blindness and the contrast against the surface. Run
it against `--admin-surface-raised` (`#ffffff`), which is where every chart is drawn, and record
the run in the PR: the six hex values and the validator's table. A pair that fails is re-stepped
until it passes, and the order in which they pass is the order they are numbered in, because a
series takes its colour by **position in a fixed order**, never by cycling: series three is
`--admin-chart-3` whether or not series one and two are drawn this month.

Text never wears a series colour. A legend swatch is a coloured mark beside ink coloured text, a
tooltip value is ink, and a direct label at the end of a line is ink.

## 3. The three components

All three are standalone, `OnPush`, exported from `@portfolio/luna-shopper-admin/ui`, and take
their text as inputs already translated, except for the handful of strings that are theirs
(section 5). The input shapes live in `libs/luna-shopper-admin/ui/src/lib/chart/chart-types.ts`
and are exported too, so `0016` builds them in a selector and a spec builds them by hand:

```ts
export interface ChartPoint {
  /** `YYYY-MM-DD`. The chart parses it as a UTC day. */
  readonly day: string;
  readonly value: number;
}

export interface ChartSeries {
  /** Stable across renders: what `@for` tracks and what the colour is keyed on. */
  readonly key: string;
  /** Already translated. */
  readonly label: string;
  /** Which of the six colours. 1 to 6, and the same whenever this series appears. */
  readonly colour: number;
  readonly points: readonly ChartPoint[];
}

export interface ChartBar {
  readonly key: string;
  readonly label: string;
  /** One entry per series, in series order. A single series is an array of one. */
  readonly values: readonly number[];
}
```

### 3.1 `lib-line-chart`

One or more series over the same days.

- Inputs: `series: readonly ChartSeries[]`, `title: string` (the accessible name, and what a single
  series is called, so one series has **no legend**), `height` in pixels with a default of 220.
- One y axis, from zero, four ticks, integers only: every number here is a count. Never a dual
  axis. Two measures of different scale are two charts.
- The x axis is time. Ticks every seven days, formatted with `Intl.DateTimeFormat` as a short
  month and a day. Never `DatePipe`, and never d3's formatter, which is not locale aware.
- Two pixel lines, no markers at rest, a four pixel point on the hovered day.
- **Hover**: a vertical crosshair on the nearest day and a tooltip naming the day and every
  series' value, ink on the raised surface. It is on `mousemove` over the plot with a hit area
  the full height of the plot, and it leaves on `mouseleave`. jsdom has no `PointerEvent`, so the
  handlers are mouse handlers and the spec dispatches `MouseEvent`.
- **Legend** for two or more series, above the plot, swatch and label, in series order. With four
  or fewer series each line is also labelled directly at its right end, so identity never rests
  on colour alone.
- **Table**: a button toggles a `<table>` beneath the plot with one row per day and one column
  per series. The SVG carries `role="img"` and `aria-label` of the title, and the table is the
  accessible form of the data, so a screen reader is not read thirty path coordinates.
- An empty `series`, or series whose points are all zero, still draws the axes and the baseline,
  with the string for "nothing in this window" over the plot. A chart that vanishes when the
  count is zero is a chart an operator reads as broken.

### 3.2 `lib-bar-chart`

Categories along x, one value per category, or one stack per category.

- Inputs: `bars: readonly ChartBar[]`, `series: readonly { key; label; colour }[]` (one entry for
  plain bars, several for stacked), `title`, `height`.
- Bars are thin, with a two pixel gap of surface between adjacent bars and between the segments
  of a stack, and a four pixel radius on the top of the topmost segment only. Segments are
  stacked in series order, first series at the baseline.
- Category labels along x. With more than about ten categories the labels are thinned to every
  nth so they do not collide, and the tooltip carries the full label. This is what lets `0016`
  draw thirty days of prices as thirty stacks.
- Hover per bar: the category label and every series' value. Legend and table as the line chart.
- A single series bar chart draws every bar in `--admin-chart-1`. Colour by category is identity
  the x axis already carries, and six colours for six statuses says nothing the labels do not.

### 3.3 `lib-stat-tile`

A headline number, which is the form for a single figure and is not a chart.

- Inputs: `label: string`, `value: number`, `delta?: { value: number; caption: string }`,
  `trend?: readonly number[]`, `link?: readonly unknown[]` (a `routerLink` array), and
  `tone: 'quiet' | 'attention'` with a default of `quiet`.
- The value is formatted with `Intl.NumberFormat` and set in tabular figures, large. The delta is
  signed (`+12`, `−3`, `0`) beside its caption ("in the last 7 days"), in muted ink, with no
  colour: an increase in failed logins is not good and an increase in users is not bad, and the
  tile does not know which it is holding.
- `trend` draws a sparkline: a plain `<svg>` of one line, no axes, no ticks, no hover, forty
  pixels tall, in `--admin-chart-1`. Its only job is the shape of the last thirty days beside
  the number.
- `attention` gives the tile a wash and a stronger border so a queue with rows in it is found
  from across the room. It uses `--admin-status-attention-wash` and `--admin-status-attention`, two
  new fixed tokens, and **not** the accent, for section 2's reason.
- With `link` the whole tile is an `<a>` and the label carries a chevron. Without it the tile is a
  `<div>` and nothing about it suggests it opens.

## 4. The width comes from the container

An SVG chart needs a pixel width to place ticks, and a `viewBox` that stretches distorts the
text in it. So each chart measures its host with a `ResizeObserver` and re-computes its scales
on change, with a default of 640 when the observer does not exist. jsdom does not have one, and
a spec that renders a chart must get a drawn chart rather than an exception, so the guard is
`typeof ResizeObserver === 'undefined'`, exactly as `Viewport` guards `matchMedia`.

Every derived value is a `computed` off the inputs and the width signal. There is no lifecycle
hook that recalculates and no subscription to unsubscribe from.

## 5. Copy

The components own only the strings a caller cannot know: the table toggle, the empty state and
the tooltip's day label. They go under a `chart` object inserted **immediately after `app`** at
the top of `libs/luna-shopper-admin/ui/assets/i18n/en.json`. `0016` adds its own `dashboard`
object at the end of the same file, and the two are placed at opposite ends so that the two
branches merge without a conflict.

```json
"chart": {
  "showTable": "Show as table",
  "hideTable": "Hide table",
  "empty": "Nothing in this window",
  "tooltipDay": "Day",
  "legend": "Series"
}
```

## 6. Tests

- A line chart with one series draws one `path`, no legend and no direct labels. With two it
  draws two paths, a legend of two, and two direct labels. With five it draws the legend and no
  direct labels.
- The table toggle reveals a table with one row per day and the values in series order.
- A `mousemove` at a known x shows the tooltip for the day nearest it. `mouseleave` hides it.
- All zero series draw the axes and the empty string. An empty array draws the same.
- A bar chart with two series draws two `rect` per category, a two pixel gap between them, and
  the second on top of the first.
- Thirty categories thin their labels. Five do not.
- A stat tile formats the value, signs the delta, draws a sparkline `path` when given a trend,
  and is an `<a>` only when given a link.
- The palette: a spec reads the six tokens' hex values from `chart-palette.ts` (the same values
  the SCSS declares, exported so a spec can see them) and asserts there are six, all distinct.
  The validator's result is recorded in the PR, since running it in jest would mean vendoring
  the script.
- Nothing here injects a service. Every spec configures the component and the translator double
  and no provider besides.

## 7. Exit criteria

- The three components render on desktop and on a phone width without horizontal overflow, which
  is checked by eye once, with a screenshot in the PR. The screen that draws them for real is
  `0016`, so the check here is a throwaway page that is not committed.
- The palette validator passes for all six colours against `#ffffff`, and the PR shows the run.
- `npx nx test luna-shopper-admin/ui` and `npx nx lint luna-shopper-admin/ui` are green, and
  `npx nx build luna-shopper-admin` stays inside its budgets.
- `package-lock.json` gains the three packages and their types and loses nothing.

## 8. Out of scope

- The dashboard, its data and its layout: `0016`.
- Any chart that is not a line, a bar or a tile. A pie is never coming: a share is a stacked bar.
- Animation. A chart that animates on every poll draws attention to nothing.
- A second colour scheme. The app has one, and the tokens are fixed.
- Zoom, brushing, or a selectable window. The window is the backend's and it is thirty days.
