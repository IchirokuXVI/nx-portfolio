# 0128: drawn shelves, counters and tills on the shop map

> **Low priority.** The user decided on 2026-09-29 that the drawn look is built, in a plan
> of its own, after everything else in the shop map series. It takes the last number for
> that reason.
>
> Mock: `mocks/shop-map/`, the board "The shop map with drawn assets" in Day and Night,
> published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f. It is the only board that
> draws them.
>
> Needs `0121` (the shopper map) and `libs/luna-shopper/shop-map/editor/plans/0001` (the
> shopper look it adds to). Prerequisite reading: the editor plan's sections 2 and 4 and
> its constraints on inline SVG.

The shopper map ships plain: every area one colour with a border. The mock tried one step
further on a single board. Shelves show a row of small coloured products along each long
side, with a line down the middle and dividers every shelf unit. Counters show a glass front
along the side a shopper stands on. The fruit area is a crate of fruit. The checkouts are
tills with a belt, and the entrance is a sliding door in the wall. Labels sit on a small
tag so they stay readable over the pattern.

## Brief for the agent

### Objective

Add a drawn variant of the shopper look to the editor library, with the shapes of the mock
built from inline SVG patterns and symbols, and let velista's shopper map use it.

### Context

- **The shopper look** (editor plan section 2): areas in one default colour with a 2 px
  border and 6 px corners on the dotted walkway.
- **The mock's drawing**, which is CSS gradients on one board and is rebuilt here as SVG:
  - A shelf repeats a product strip of three colours (5 px bands with 2 px gaps) along
    both long sides, with a spine line and a divider every 36 px of screen at the fitted
    zoom.
  - A wall shelf has the strip on its aisle side only.
  - A counter has a 9 px glass band on the side facing the walkway.
  - A fruit or vegetable area is a crate: two offset grids of 5 px dots.
  - A checkout is a till symbol (a screen, a body and a belt). The entrance is two door
    leaves in the wall's gap.
- **Which area gets which drawing** comes from its kind and its section: a `shelf` is a
  shelf, a `counter` a counter, a `checkout` a till, an `entrance` a door, and a section
  whose name the chain maps to fruit and vegetables is a crate. Nothing else is inferred.
- **Colours**: the product strip's three colours and the glass are new custom properties
  with Day and Night defaults, like every colour of the library.

### Target state

- `setLook('shopper-drawn')` in the editor library, drawing the shapes of Context in both
  themes, with badges, labels and taps unchanged.
- Velista's shopper map uses the drawn look. The plain look stays in the library.
- The demo page shows both variants side by side.

### Scope

Work only in `libs/luna-shopper/shop-map/editor/**`, velista's map wrapper in
`libs/velista/feature-shop-map`, and their specs.

Do not touch: the mapper look, the document, the backend.

### Constraints

- **Inline SVG only**: `<pattern>` and `<symbol>`, no `<image>`, no `url()` to a file, no
  raster.
- **Labels stay readable**: each label sits on a tag in the area colour, as the mock does.
- **Frame time**: zooming the El Jamón fixture stays within the plain look's frame time
  plus 20 percent, measured on the same phone.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: drawing a kind not listed in Context, inferring a drawing from
anything but the kind and the section, or adding an asset file.

### Progress evidence

The files changed and the spec run, screenshots of the demo page beside the mock's board in
Day and Night, and the frame times of both looks.
