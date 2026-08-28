# UI, components & styling

Presentational components live in the scope's `ui` lib. Copy shapes from
`libs/landing-v2/ui/*`, `libs/damoclesSword/ui/*`, and `libs/shared/ui/*`.

## Component conventions

- **Standalone components, Angular 21.** No NgModules per component. The `ui` lib
  aggregates its standalone components in one `*-ui-module.ts` NgModule that also
  registers the RokuTranslator namespace (see `references/localization.md`) and
  re-exports the components; consumers import that module (e.g. `LandingV2UiModule`).
- **Selectors.** Presentational components in a `ui` lib use `lib-<name>`
  selectors (`lib-hero`, `lib-project-grid`). App-level components use the app
  prefix from its `project.json` (`app`, `ng-odtg`, …).
- **Signals everywhere.** Use `signal` / `computed` / `input()` / `output()` for
  state and derived values; update signals yourself rather than relying on Angular
  to notice mutations to plain fields. This is what keeps the zoneless apps
  cheap on change detection (see `references/testing.md` for the zoneless setup).
- **Lazy & async by default.** Load heavy assets (images, media) through
  JavaScript and reveal content once ready, rather than blocking render.

## Icons — always from `@portfolio/shared/ui`

Icons are standalone components in `libs/shared/ui` (`home-icon`, `save-icon`,
`trash-icon`, `upload-icon`, …), each inlining an `*-icon.svg` via
`import('./x.svg?raw')` + `DomSanitizer`. **Never inline raw `<svg>` markup** in a
feature/ui component. Before adding an icon, check whether one already exists and
reuse it; if not, add a new icon component to `libs/shared/ui`, export it from that
lib's `index.ts`, and remember the asset-import-types tsconfig step (see
`references/creating-a-new-app.md` → "Asset-import types gotcha").

## Styling

SCSS (`inlineStyleLanguage: scss`). Component styles inline or in `.scss` files.
Note that a remote's SCSS `url()` assets resolve against the **shell's** origin at
runtime (the shell serves them), so renaming one can require an `nx serve` restart.

## Text in templates

Never hardcode user-facing strings. Use the impure `rokuT` pipe
(`{{ 'my.key' | rokuT }}`) or `RokuTranslatorService.t(...)`, and take per-record
content already-localized from the data-access services. Full detail:
`references/localization.md`.

## Visual / layout design

Any landing page, detail page, or visually significant component goes through the
**`design-taste-frontend`** skill first — invoke it, get the direction, then
implement to it. Do not hand-roll a look. Reuse the app's locked design system if
it has one (e.g. landingV2's dark / gold-accent palette).
