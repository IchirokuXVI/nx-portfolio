# Section Centralization Refactor

> Executor note: this plan is written to be executed step by step. Do the steps in
> order. Do not skip the verification section. All paths are repo-relative to
> `D:\Projects\nx-portfolio`. Do NOT use relative import paths across library
> boundaries — use the `@portfolio/<scope>/<lib>` aliases.

## Context

The damoclesSword home page is built from section components in
`libs/damoclesSword/ui/src/lib/section-*` (`section-projects`, `section-news`,
`section-our-vision`, `section-contact-support`), composed by
`libs/damoclesSword/feature-home`. Today the same layout scaffolding is duplicated
in two places:

1. **`feature-home.scss`** repeats a full-width band + centered inner container
   block (`display:flex; width:100%; > * { flex-grow:1; max-width:1280px; margin:0 auto; }`)
   four times, and also carries **section theming** (background colors / the
   `left-squared-white-bg.avif` background image). Theming does not belong in
   `feature-home`.
2. **Each `section-*.scss`** repeats the same base container
   (`display:flex; flex-direction:column; width:100%; container-type:inline-size;
   flex-grow:1; padding:3em 2em; gap:2em;`), the same `.section-title` rules
   (`font-size:2em; text-transform:uppercase`) and the same
   `@container (max-width:800px)` title breakpoint (`font-size:1.5em`).

**Goal:** introduce one shared `section-layout` component in
`libs/damoclesSword/ui` that owns the band + centered container + optional section
title. Each section component sets its own theming through CSS custom properties
(so theming lives with the section, not in `feature-home`). `feature-home` keeps
**only** the ability to control `max-width`, and loses all theming and layout CSS.

## Design decisions (already settled)

- **Theming (background color/image, text color) moves OUT of `feature-home`** and
  into each section component's own `.scss`, expressed as CSS custom property
  overrides on the `<lib-damocles-sword-section-layout>` element it renders.
- **`max-width` stays controllable from `feature-home`.** It is a CSS custom
  property (`--section-max-width`) with a default in `section-layout`. Because CSS
  custom properties inherit through the DOM, `feature-home` sets it on each section
  component host and it cascades into the nested `section-layout`. This keeps
  `max-width` a `feature-home` concern without `feature-home` knowing about
  `section-layout`'s internals.
- **`contact-support` is an outlier** (no title; two self-themed panels; split
  backgrounds; different padding). It still uses `section-layout` for band +
  centering only: `title` omitted, `--section-padding: 0`, background left
  transparent (its panels theme themselves).
- The background image currently at
  `libs/damoclesSword/feature-home/assets/left-squared-white-bg.avif` must move to
  the UI lib assets so `section-projects` can reference it (theming lives with the
  section).

## Step 1 — Create the `section-layout` component

Create these files under
`libs/damoclesSword/ui/src/lib/section-layout/`:

### `section-layout.ts`

- Standalone component, selector `lib-damocles-sword-section-layout`.
- Imports: `RokuTranslatorPipe` (from `@portfolio/localization/rokutranslator-angular`)
  and `DoubleBorderedTitle` (from `../double-bordered-title/double-bordered-title`).
- Inputs (use the signal `input()` API, matching the rest of the lib):
  - `title = input<string | undefined>(undefined)` — a translation key. When set,
    the title block renders; when undefined, it does not.
  - `borderAlignment = input(BorderAlignment.LEFT)` — reuse the existing
    `BorderAlignment` enum exported from
    `../double-bordered-title/double-bordered-title`. Re-export it from this
    component's file (or import in consumers directly) so section components keep
    using it.
- Expose `BorderAlignment` for the template. Follow the existing pattern used by the
  section components (a `get BorderAlignment()` getter returning the enum), OR bind
  alignment-derived class from a computed — see template below.

### `section-layout.html`

```html
<div class="section-band" [class]="'title-' + borderAlignment()">
  <div class="section-container">
    @if (title()) {
      <div class="section-title">
        <lib-damocles-sword-double-bordered-title
          [borderAlignment]="borderAlignment()"
        >
          {{ title() | rokuT }}
        </lib-damocles-sword-double-bordered-title>
      </div>
    }
    <ng-content />
  </div>
</div>
```

The `title-left` / `title-center` / `title-right` class on the band drives the
title container's horizontal alignment (see SCSS). `borderAlignment()` returns the
enum value which is the string `'left' | 'center' | 'right'` (see
`double-bordered-title.ts`), so `'title-' + borderAlignment()` yields
`title-left`/`title-center`/`title-right`.

### `section-layout.scss`

Import the shared variables partial the same way the section files do
(`@import '../styles/variables';`) even if not strictly needed, for consistency.

Implement the band + container using CSS custom properties with defaults. This is
the single source of truth for the shared structure:

```scss
@import '../styles/variables';

.section-band {
  display: flex;
  width: 100%;
  background-color: var(--section-bg, transparent);
  background-image: var(--section-bg-image, none);
  background-size: var(--section-bg-size, cover);
  background-repeat: var(--section-bg-repeat, no-repeat);
  background-blend-mode: var(--section-bg-blend-mode, normal);
  color: var(--section-color, inherit);

  .section-container {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    width: 100%;
    max-width: var(--section-max-width, 1280px);
    margin: 0 auto;
    padding: var(--section-padding, 3em 2em);
    gap: var(--section-gap, 2em);
    container-type: inline-size;
  }

  .section-title {
    display: flex;
    width: 100%;
    font-size: var(--section-title-font-size, 2em);
    text-transform: uppercase;
    color: var(--section-title-color, inherit);
  }

  // Title horizontal alignment driven by borderAlignment.
  &.title-center .section-title { justify-content: center; }
  &.title-right .section-title { justify-content: flex-end; }
  // title-left is the default (flex-start / no rule needed).

  @container (max-width: 800px) {
    .section-title { --section-title-font-size: 1.5em; }
  }
}
```

Notes:
- The `@container (max-width:800px)` breakpoint currently lives in each section and
  only shrinks the title to `1.5em`. Because `.section-container` sets
  `container-type: inline-size`, this `@container` query resolves against it — same
  behavior as today. Keep the title breakpoint here so every section gets it for
  free.
- CSS custom property inheritance: any `--section-*` var set on the
  `<lib-damocles-sword-section-layout>` element (or any ancestor, e.g. the section
  component host or `feature-home`) cascades into `.section-band` /
  `.section-container`. This is how per-section theming and `feature-home`'s
  `max-width` reach the layout.

### CSS custom property contract (document this at top of `section-layout.scss` as a comment)

| Variable | Default | Set by | Purpose |
|---|---|---|---|
| `--section-max-width` | `1280px` | `feature-home` (per section host) | inner container width cap |
| `--section-bg` | `transparent` | section component | band background color |
| `--section-bg-image` | `none` | section component | band background image |
| `--section-bg-size` | `cover` | section component | background-size |
| `--section-bg-repeat` | `no-repeat` | section component | background-repeat |
| `--section-bg-blend-mode` | `normal` | section component | background-blend-mode |
| `--section-color` | `inherit` | section component | band text color |
| `--section-title-color` | `inherit` | section component | title text color |
| `--section-padding` | `3em 2em` | section component | container padding |
| `--section-gap` | `2em` | section component | container gap |

## Step 2 — Register `section-layout` in the UI lib

- Add `export * from './lib/section-layout/section-layout';` to
  `libs/damoclesSword/ui/src/index.ts`.
- Add `SectionLayout` (the class name) to the `components` array in
  `libs/damoclesSword/ui/src/lib/damocles-sword-ui-module.ts` and to its import list,
  so it is declared/exported by `DamoclesSwordUiModule` like the other components.
  (Section components import it directly as a standalone import too — see Step 3.)

## Step 3 — Refactor each section component to use `section-layout`

For every section: add `SectionLayout` to the component's standalone `imports`
array, wrap the template content in `<lib-damocles-sword-section-layout>`, pass
`title`/`borderAlignment`, and **delete** the now-duplicated container/title/
breakpoint SCSS. Move each section's theming into `--section-*` overrides set on the
`<lib-damocles-sword-section-layout>` element (via a class on it, or on `:host`).

### 3a. `section-our-vision` (`libs/damoclesSword/ui/src/lib/section-our-vision/`)

- `.html`: replace the outer `.section-vision-container` + inner `.section-title`
  block with:
  ```html
  <lib-damocles-sword-section-layout
    [title]="'section-vision.main-title'"
    [borderAlignment]="BorderAlignment.RIGHT"
  >
    <div class="section-content">
      ... existing content-text / content-img markup unchanged ...
    </div>
  </lib-damocles-sword-section-layout>
  ```
- `.scss`: delete `.section-vision-container` base rules, `.section-title` rules,
  and the title portion of the `@container` block. **Keep** the `.section-content`,
  `.content-text`, `.content-img`, `.know-more-button` rules and the
  `@container (max-width:800px) .section-content .content-img { display:none; }`
  rule (these are section-specific content, not shared scaffolding). Wrap the kept
  rules so they still apply (they can live at the top level of the file now, since
  the layout provides the container). No theming vars needed (vision has no
  background). Keep `@import '../styles/variables';` (used by `know-more-button`).
- `.ts`: add `SectionLayout` to `imports`. `DoubleBorderedTitle` is no longer
  referenced directly in this template — remove it from `imports` (but keep the
  `BorderAlignment` import and getter, still used to pass `[borderAlignment]`).
  `CallToActionButton` and `RokuTranslatorPipe` stay.

### 3b. `section-news` (`libs/damoclesSword/ui/src/lib/section-news/`)

- `.html`: wrap in
  ```html
  <lib-damocles-sword-section-layout
    [title]="'section-news.main-title'"
    [borderAlignment]="BorderAlignment.LEFT"
  >
    <div class="section-content"> ... @for news cards ... </div>
    <lib-damocles-sword-call-to-action-button class="see-more-button" [link]="[]">
      {{ 'section-news.see-more' | rokuT }}
    </lib-damocles-sword-call-to-action-button>
  </lib-damocles-sword-section-layout>
  ```
- `.scss`: delete `.section-news-container` base rules, `.section-title` rules, and
  the `@container` title block. **Keep** `.section-content` and `.see-more-button`
  rules. Move theming to layout host: news is dark, so set on `:host` (or a class on
  the layout element):
  ```scss
  :host {
    --section-bg: #0a0a0a;          // was feature-home .container-section-news bg
    --section-color: #f5f5f0;
    --section-title-color: #fff;
  }
  ```
  (The old file set `color:#f5f5f0` on the container and `#fff` on the title — map
  those to `--section-color` / `--section-title-color`.) Keep
  `@import '../styles/variables';` (used by `see-more-button`).
- `.ts`: add `SectionLayout` to `imports`; remove `DoubleBorderedTitle` from
  `imports` (keep `BorderAlignment` import + getter).

### 3c. `section-projects` (`libs/damoclesSword/ui/src/lib/section-projects/`)

- **Asset move:** move
  `libs/damoclesSword/feature-home/assets/left-squared-white-bg.avif` to
  `libs/damoclesSword/ui/src/assets/left-squared-white-bg.avif` (that is where the
  UI lib's other section assets live, e.g. `section-vision-addon.avif`). Confirm no
  other reference exists (grep showed only `feature-home.scss` uses it).
- `.html`: wrap in
  ```html
  <lib-damocles-sword-section-layout
    [title]="'section-projects.main-title'"
    [borderAlignment]="BorderAlignment.CENTER"
  >
    <div class="subsection subsection-client-projects"> ... unchanged ... </div>
    <div class="subsection subsection-games"> ... unchanged ... </div>
  </lib-damocles-sword-section-layout>
  ```
- `.scss`: delete `.section-projects-container` base rules, `.section-title` rules,
  and the `@container` title block. **Keep** all `.subsection*` rules. Move theming
  to the layout host. Projects has a background image + a translucent white overlay
  (from the old `feature-home .container-section-projects`):
  ```scss
  :host {
    --section-bg: rgba(255, 255, 255, 0.8);
    --section-bg-image: url('../../../assets/left-squared-white-bg.avif');
    --section-bg-blend-mode: lighten;
  }
  ```
  Verify the relative path resolves from
  `libs/damoclesSword/ui/src/lib/section-projects/section-projects.scss` to
  `libs/damoclesSword/ui/src/assets/left-squared-white-bg.avif`
  (`../../../assets/left-squared-white-bg.avif`). The old projects SCSS also set
  `--db-border-title-wrap: 'nowrap'` on the title element for CENTER alignment; move
  that onto the layout host too so it inherits into the nested double-bordered-title:
  ```scss
  :host { --db-border-title-wrap: 'nowrap'; }
  ```
- `.ts`: add `SectionLayout` to `imports`; remove `DoubleBorderedTitle` from
  `imports` (keep `BorderAlignment` import + getter). `ProjectCard` stays.

### 3d. `section-contact-support` (`libs/damoclesSword/ui/src/lib/section-contact-support/`)

This section has no title and its own two-panel layout. Use `section-layout` only
for band + centering.

- `.html`: wrap the existing `.section-contact-support` div (with its two `.panel`
  sections) in `<lib-damocles-sword-section-layout>` with **no** `title`:
  ```html
  <lib-damocles-sword-section-layout>
    <div class="section-contact-support"> ... unchanged panels ... </div>
  </lib-damocles-sword-section-layout>
  ```
- `.scss`: keep all existing panel styling. The existing `:host { display:block;
  container-type: inline-size; }` block and the `@container (max-width:800px)` panel
  rules can stay (the panels' container query now resolves against
  `.section-container` from the layout, which also sets `container-type` — behavior
  is equivalent; verify the mobile stacking still triggers, see Verification). Set
  layout overrides on `:host`:
  ```scss
  :host {
    --section-padding: 0;   // panels own their own padding
    --section-color: #fff;  // was `color:#fff` on .section-contact-support
  }
  ```
  The dark background that `feature-home .container-section-contact-support` used
  (`#0a0a0a`) was only visible behind the panels; the panels cover the full width,
  so it can be dropped OR set as `--section-bg: #0a0a0a` for safety. Set
  `--section-bg: #0a0a0a` to preserve the exact prior look.
- `.ts`: add `SectionLayout` to `imports`. (No title/DoubleBorderedTitle here.)

## Step 4 — Strip `feature-home`

- `libs/damoclesSword/feature-home/src/lib/feature-home/feature-home.scss`: remove
  ALL theming and band/centering rules (the four `.container-section-*` blocks).
  `feature-home` must not set any background color/image. The file should end up
  nearly empty. Its ONLY remaining responsibility is `max-width`. Set it once,
  inherited by all sections:
  ```scss
  :host {
    --section-max-width: 1280px;
  }
  ```
  (Per-section `max-width` overrides remain possible later by setting
  `--section-max-width` on an individual section host in this file, but default to
  the single global value.)
- `libs/damoclesSword/feature-home/src/lib/feature-home/feature-home.html`: the
  wrapper `<div class="container-section-*">` elements no longer carry styling. Keep
  the template simple — the section components can be listed directly:
  ```html
  <div class="container-trailer-video">
    <lib-damocles-sword-trailer-video></lib-damocles-sword-trailer-video>
  </div>
  <lib-damocles-sword-section-projects></lib-damocles-sword-section-projects>
  <lib-damocles-sword-section-news></lib-damocles-sword-section-news>
  <lib-damocles-sword-section-our-vision></lib-damocles-sword-section-our-vision>
  <lib-damocles-sword-section-contact-support></lib-damocles-sword-section-contact-support>
  ```
  (Keep the `container-trailer-video` wrapper if the trailer relies on it; the
  section wrappers are removable since the band now lives inside each section via
  `section-layout`.) Verify no remaining `feature-home.scss` selector targets those
  removed wrappers.
- Remove the now-unused `left-squared-white-bg.avif` from
  `libs/damoclesSword/feature-home/assets/` (moved in Step 3c). Check whether
  `libs/damoclesSword/feature-home/assets/white-hex-bg.png` is referenced anywhere
  (grep showed no current reference); if genuinely unused leave it as-is unless the
  user wants cleanup — do not delete unrelated assets without confirmation.

## Step 5 — Tests

- Add `section-layout.spec.ts` mirroring the existing section spec pattern (e.g.
  `section-news.spec.ts`) — a basic `TestBed` create/render smoke test. Match the
  import style and asset/i18n mocking already used by those specs (the feature-home
  jest config stubs static asset imports — see
  `libs/damoclesSword/feature-home/jest.config.cts` and `asset-file-mock.ts`; the UI
  lib has its own equivalent — follow whatever the existing UI section specs do).
- The existing section specs should keep passing; if any assert on the old
  container class names (`.section-news-container`, etc.) update those assertions to
  the new structure (`.section-band` / `.section-container` / `.section-title`, or
  the projected content classes).

## Verification

Run from repo root:

```sh
npx nx lint damoclesSword-ui
npx nx lint damoclesSword-feature-home
npx nx test damoclesSword-ui
npx nx test damoclesSword-feature-home
npx nx build damoclesSword --configuration=development
```

All must pass. The build catches broken asset paths (the moved
`left-squared-white-bg.avif`) and broken SCSS var references.

Then visually verify through the shell (remotes render only through the shell — a
remote served on its own port shows a blank page):

```sh
npx nx serve damoclesSword
```

Open the damoclesSword home via the shell URL (`/<locale>/damoclesSword`, e.g.
`/en/damoclesSword`) and confirm, at desktop width and below ~800px container width:

1. **Projects** section: centered title (nowrap), translucent-white background with
   the `left-squared-white-bg` image showing through (blend `lighten`), subsections
   intact.
2. **News** section: left-aligned title, dark background, light text, cards + "see
   more" button intact.
3. **Vision** section: right-aligned title, image hidden below 800px container
   width, "know more" button themed.
4. **Contact/Support** section: no title, two panels (yellow/blue) side by side,
   stacking vertically below 800px, email form + Patreon button working.
5. All sections share the same max-width cap and centering; changing
   `--section-max-width` in `feature-home.scss` visibly resizes every section.
6. Confirm `feature-home.scss` contains no background/theming rules.
```
