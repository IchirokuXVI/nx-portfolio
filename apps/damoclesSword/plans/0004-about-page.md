# 0004 — About page (Worker B)

> Executor note: do the steps in order; do not skip verification. Paths are
> repo-relative to `D:\Projects\nx-portfolio`. Never use relative imports across lib
> boundaries — use `@portfolio/<scope>/<lib>` aliases. **Commit locally only; never
> push.** You work in your own git worktree on branch `feat/damocles-about`, dev ports
> **4220–4223**.

## Context
Flesh out the existing **About** page stub (`libs/damoclesSword/feature-about`) with
three real sections, matching the reference design (dark/light alternating bands, no
background images — flat white/dark placeholders; assets come later). The page is
already routed at `/en/damoclesSword/about` and in the header nav — do **not** touch
routing.

## Conventions (follow exactly — mirror `feature-home` and existing `section-*`)
- **Page component** thin: `imports: [DamoclesSwordUiModule]`, template lists section
  selectors in order; `.scss` sets `:host { --section-max-width: 1280px; }`. Change the
  stub `styleUrl` from `./feature-about.css` to `.scss` (delete the `.css`).
- **Each section** = folder `libs/damoclesSword/ui/src/lib/section-<name>/`
  (`.ts/.html/.scss/.spec.ts`), selector `lib-damocles-sword-section-<name>`, standalone,
  wraps body in `<lib-damocles-sword-section-layout>`, passes already-translated
  `[title]="'section-<name>.main-title' | rokuT"` + `[borderAlignment]` (expose via
  `get BorderAlignment(){ return BorderAlignment; }` from `../enums/border-alignment`).
- **Background** via CSS-var overrides on `:host`: dark =
  `--section-bg:#0a0a0a; --section-color:#f5f5f0; --section-title-color:#fff;`
  light = `--section-bg: rgba(255,255,255,0.9); --section-color:#1a1a1a;`.
  `@import '../styles/variables';`; `Audiowide` font for titles/bars.
- **Register** each new section in `damocles-sword-ui-module.ts` + `ui/src/index.ts`.
- Reuse the shared **`InfoCard`** (see `0002`) for the value cards.

## Sections (in order)

### 1. `section-who-we-are` (dark) — title "Who We Are" (`BorderAlignment.LEFT`)
Text + right-side media placeholder (a neutral box; no image yet).
> We are a studio born from the passion of a group of university students who, at some
> point in their journey, decided to enter the world of video games by creating their
> own — specifically using a technology that is not yet standardized: virtual reality.
>
> Our purpose? It's clear: to develop games that motivate us while offering our
> community and the world new experiences that haven't been seen before.
>
> Dreamers? Maybe. But with effort and love for our products, we are willing to do
> everything possible to reach those dreams. That's Damocle'Sword.

### 2. `section-our-values` (light) — title "Our Values" (`CENTER`)
Intro:
> At Damocle'Sword, we are very clear about who we are and how we are. That's why we
> believe it's important to communicate the values that define us as a studio, always
> staying true to them at all times.

Row of **4 `InfoCard`s** (title + description; accent bar via `--info-card-accent`):
- **Quality And Demand** — We always give our best, striving to learn and improve with
  each development. We want even the most critical audience to recognize our effort and
  care.
- **Social Responsibility** — We are aware that our games can have social repercussions,
  and we always take this into account, being responsible for what we do.
- **Respect For Our Own** — We respect the needs of our team and always strive to do
  what's best for everyone.
- **Curiosity** — We are always looking to experiment with new concepts and
  technologies, we love to create and learn new things.

(Optional: put the four values in a `libs/damoclesSword/data-access` `about-value`
domain following the `*Memory` + `static-*-data` pattern if it reads cleaner than inline
component data — otherwise inline static data is fine.)

### 3. `section-future` (dark) — title "Damocle'Sword In The Future" (`RIGHT`)
> We are a team with high expectations for our future journey, striving every day to
> achieve our goal.
>
> In the future (not too far away), Damocle'Sword will be a great Spanish company
> capable of developing multiple projects simultaneously and having a large team with
> whom we can learn and develop.
>
> We also envision a plan to support other projects through publishing and offering
> development services to other companies in the sector, as well as expanding into
> cultural development, offering experiences to museums, sports, etc.

## i18n
Add keys under prefixes `section-who-we-are.*`, `section-our-values.*`,
`section-future.*` to **all three** `libs/damoclesSword/ui/assets/i18n/{en,es,fr}.json`.
English = real copy; es/fr = reasonable quick translations (English fallback if unsure).
**Append your block near the end of each JSON.**

## Page composition
`libs/damoclesSword/feature-about/src/lib/feature-about/feature-about.html`: three
section selectors in order. Model `.ts`/`.scss` on `libs/damoclesSword/feature-home/`.

## Verify (port block 4220–4223)
1. `npx nx lint damoclesSword/ui damoclesSword/feature-about` and
   `npx nx test damoclesSword/ui` — must pass.
2. Live: set shell port **4220**, remotes 4221/4222/**4223** (edit `port` in
   `apps/shell/project.json` + each remote `project.json`; `publicHost` in
   `apps/damoclesSword/project.json` → `http://localhost:4223`), then `npx nx serve shell`.
   Open `http://localhost:4220/en/damoclesSword/about`. Confirm three sections render and
   bands alternate dark/light.
3. Playwright: add `apps/damoclesSword-e2e/src/about.spec.ts` asserting the three
   sections + four value cards render. Run with your port:
   `$env:BASE_URL='http://localhost:4220/en/damoclesSword'; npx nx e2e damoclesSword-e2e --grep about`.
4. **Revert the port files** (`git checkout -- apps/shell/project.json apps/landing/project.json apps/odontogram/project.json apps/damoclesSword/project.json`), then commit.

## Conflict discipline
Only create files under your `section-*` folders / feature lib; the only shared files
you edit are **additive**: `damocles-sword-ui-module.ts`, `ui/src/index.ts`, the three
i18n JSONs, and (if used) `data-access/src/index.ts`. Do not modify the shared
`InfoCard`. Do not commit port changes.
