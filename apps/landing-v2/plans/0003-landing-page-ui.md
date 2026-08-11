# 0003 — Landing page UI (header no-nav, dynamic hero/table/grid, dynamic year)

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Prereq: `0001` (libs), `0002` (data). Build in `@portfolio/landing-v2/ui`, rendered
> by the `LandingV2Wrapper` (feature-shell) which feeds it the data-access output.
> Match the approved mockup and the locked design system in `0000`.

## Component structure
Keep the page presentational (all data comes in via inputs; the wrapper subscribes to
the services). Mirror `libs/landing/ui` (`landing-ui-module.ts` +
`RokuTranslatorModule.withConfig`).

- `libs/landing-v2/ui/src/lib/landing/landing.ts|html|scss` — root
  `lib-landing-v2-ui`, `ChangeDetectionStrategy.OnPush`. Inputs:
  `projects = input<TranslatedProject[]>([])`,
  `facts = input<TranslatedInfoFact[]>([])`. Uses `compReady` gated on
  `RokuTranslatorService.loaded$` (as v1 does).
- Register in a `landing-v2-ui-module.ts` with the RokuTranslator config
  (`defaultNamespace: 'landingV2'`, `locales: ['en','es']`,
  `loader: (l) => import('../../assets/i18n/${l}.json')`) and export from
  `libs/landing-v2/ui/src/index.ts`.
- i18n files: `libs/landing-v2/ui/assets/i18n/en.json` + `es.json` (page chrome keys
  below). English default.

Break the page into small standalone child components under
`libs/landing-v2/ui/src/lib/` for testability (all `lib-landing-v2-*`):
`site-header`, `hero`, `info-table`, `project-card`, `project-grid`, `site-footer`.
Register each in the ui-module.

## 1. Header — NO navigation (brief requirement #1)
`site-header`: keep the bar (brand mark "D" + name on the left) and the **Download CV**
action on the right. **Remove the nav links** (`Projects` / `Contact`) entirely — the
page is a single scroll, the nav added nothing. Header height ≤ 72px, single row at all
widths. CV link = the résumé asset (see §CV/socials).

## 2. Hero
`hero`: left column = availability badge (pulsing gold dot + label), `H1` name, mono
role line, subtitle, then the CV + socials action row. Right column (desktop ≥720px
container) = the **dynamic info-table** (`info-table`, §3). Single column below 720px
(table drops below the actions or hides — keep it visible, stacked).
- Constraints: headline ≤ 2 lines, subtitle from i18n. Fluid `clamp()` sizes from the
  mockup. `text-wrap: balance` on the headline.
- Strings from i18n: `welcome_title`, `role`, `welcome_subtitle`, `available`.

## 3. Info-table (dynamic — brief requirement #2)
`info-table`: `@for (fact of facts(); track fact.id)` renders one row each:
`label` (mono, muted) on the left, `value` (+ optional `note` sub-line) on the right.
**No hardcoded rows.** Dashed hairline between rows; last row no border. Empty state:
if `facts()` is empty, render nothing (no empty shell).

## 4. Projects (dynamic + visual config — brief requirements #3, #4)
`project-grid`: 2-col CSS Grid at desktop (`grid-template-columns: 1fr 1fr`,
`grid-auto-flow: dense`), 1-col under 720px. `@for (p of projects(); track p.id)`
renders a `project-card`, applying visual config:
- `p.visual.columnSpan === 2` → `grid-column: 1 / -1`.
- `p.visual.featured` → the wide split layout (media beside body on desktop).
- **Remove the `03 / 03` counter** from the section head (brief #3) — just the
  translated `projects` title, nothing on the right.

`project-card` renders from `TranslatedProject`:
- Media: `@if (p.visual.mediaKind === 'screenshot')` → `<img>` (lazy, `object-fit:
  cover`); `@else` → the **brand-panel** (§Portfolio visual from `0002`; for Portfolio
  use the module-federation-graph motif, else the monogram panel).
- Body: `name` (+ repo icon-link to `repoLink`), `tagline`, `description`, a
  "View project" link → `p.detailLink` (falls back to `appLink` when no detail page,
  e.g. POS), and the `tags` chips.
- Strings: `projects` (section title), `project_view` (link). Titles/taglines/desc
  come already-translated from data-access (not i18n keys).

## 5. Footer — dynamic year (brief requirement #6)
`site-footer`: brand mark, socials row (GitHub / LinkedIn / Email), and a note line
`© {{ year }} Daniel · {{ 'built' | rokuT }}` where
`year = new Date().getFullYear()` (a component getter/field — never a hardcoded
`2026`). Socials are links, not a duplicate CTA of the header CV button.

## 6. CV & socials (brief: download CV + visit socials)
- **CV / résumé**: reuse the existing asset. Copy
  `libs/landing/ui/assets/resume.pdf` into `libs/landing-v2/ui/assets/resume.pdf` and
  resolve its URL the way v1 does (`import('../../assets/resume.pdf?asset')` then strip
  the query). Link `download`/`target="_blank"`. One primary "Download CV" button in
  the hero + the same in the header; **one intent, one label** ("Download CV") — do not
  add a second contact-style CTA.
- **Socials**: GitHub `https://github.com/ichirokuxvi`, LinkedIn
  `https://www.linkedin.com/in/ichiroku/`, Email `mailto:ichiroku.work@gmail.com`
  (carry over from v1). Icon links in hero + footer.

## 7. Icons (from `@portfolio/shared/ui` — CLAUDE.md, do not inline raw SVG)
Needed: download/CV, GitHub, LinkedIn, email, arrow-right (view project), and (optional)
the brand-panel graph motif. **First check `libs/shared/ui`** for existing icon
components (there are several — `home-icon`, `save-icon`, etc.). For each missing one,
add a standalone `*-icon` component following the existing pattern
(`import('./x.svg?raw')` + `DomSanitizer`) and export it from
`libs/shared/ui/src/index.ts`. The GitHub/LinkedIn SVGs already exist as raw assets in
`libs/landing/ui/assets/` — turn them into shared icon components if not present.

## 8. Responsive (320px → 3840px)
- Container `max-width: 1160px`, centered; at 4K it stays centered with wide gutters.
- Breakpoint at ~720px (container-relative in the mockup; in the real app use normal
  `@media`/`min-width` since the shell owns the viewport): single column below,
  2-col + split feature above.
- Verify no element exceeds the viewport at 320px (long words/URLs: `overflow-wrap`;
  screenshots `max-width:100%`). `0005` enforces this with e2e.

## i18n keys (en/es) — `libs/landing-v2/ui/assets/i18n/`
`welcome_title` ("I'm Daniel" / "¡Soy Daniel!"), `role`
("Full-stack developer · Angular · Nx" / "Desarrollador full-stack · Angular · Nx"),
`welcome_subtitle` (reuse v1), `available` ("Available for work" / "Disponible para
trabajar"), `resume` ("Download CV" / "Descargar CV"), `projects` ("Projects" /
"Proyectos"), `project_view` ("View project" / "Ver proyecto"), `built` ("Built with
Angular & Nx" / "Hecho con Angular y Nx"). Confirm new-copy wording per OQ2.

## Verify
1. `npx nx lint landing-v2/ui shared/ui` + `npx nx test landing-v2/ui` — pass; add a
   spec asserting: no `<nav>` links in the header; project cards render from an input
   array; a `columnSpan: 2` project gets the full-width class; the footer year equals
   `new Date().getFullYear()`; the info-table renders one row per fact.
2. Live via shell: `npx nx serve shell`, open `/en/landingV2` and `/es/landingV2`.
   Check: header has no nav; hero info-table populated from data; projects grid with
   Portfolio + Damocle'Sword full-width and Odontogram/POS half-width; CV downloads;
   socials open; footer shows the current year; language toggle swaps all copy.
3. Resize 320 → 3840: no horizontal scrollbar at any width.
4. Commit: `feat(landing-v2): landing page UI (dynamic hero/table/grid, no nav, live year)`.

## Conflict discipline
New files under `libs/landing-v2/{ui,feature-shell}`. The only shared edits are
**additive** icon components in `libs/shared/ui` + its `index.ts`. Do not modify
`libs/landing/*`.
