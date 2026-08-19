# 0007 — Portfolio detail page: design and build the real content

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Prereq: `0005` (the detail-page scaffolding: `ProjectPage`, `DetailPageShell`,
> the per-project content components, and the `projects/<slug>` routing all exist).
> Source of truth for copy: `apps/shell/CASE_STUDY.md` (the foundation case study,
> now complete). This plan turns the thin Portfolio detail page into a real,
> well-designed "how this site is built" page.

## Goal

The Portfolio detail page (`/{locale}/projects/portfolio`, rendered by
`PortfolioContent` in `libs/landing-v2/ui`) is currently a skeleton: three sections
(Overview, Architecture, Engineering), each a heading plus a single short paragraph, and
a flat list of tech chips. Rebuild it into a detailed, designed page that actually
explains how the portfolio was built, drawing the content from `apps/shell/CASE_STUDY.md`.

Scope note: this plan targets the **Portfolio** page specifically, because its source
copy is ready. The same pattern (richer content components + more i18n copy) extends to
`OdontogramContent` and `DamoclesContent` later, once their case studies are finished, so
keep every new shared piece project-agnostic.

## Decisions (confirmed 2026-08-19)

- **Scope:** Portfolio page only. Odontogram and Damocle'Sword are later passes.
- **Depth: progressive disclosure.** The page shows the **highlights by default** (tight,
  scannable). At the bottom, a button ("Want to know even more?" or similar) reveals the
  **in-depth** content. So both depths ship: highlights first, deep dive on demand. See
  Design below for the mechanism.
- **Hero diagram:** out of scope for this pass; a later polish pass adds the
  module-federation topology diagram. Use a simple hero (or none) for now.
- **Implementation:** done from a **fresh session on its own worktree** (this planning
  session is pinned to the `case-study-docs` worktree). Start the fresh session, read this
  plan, and build. Branch off `dev` (the current base) or `main` per the repo default.

## Current state (what already exists, do not rebuild)

- Routing: one parameterized route `/{locale}/projects/:slug` -> `ProjectPage`
  (`libs/landing-v2/feature-project`), which maps the slug to a content component via
  `CONTENT_BY_SLUG` and renders it with `NgComponentOutlet`, passing a
  `TranslatedProject` as the `project` input. Adding a page means adding a content
  component, not a route.
- `DetailPageShell` (`libs/landing-v2/ui`): header (title, tagline, repo link, live-app
  link), optional hero image, and two projected slots, `[body]` and `[meta]`. Dark tokens
  plus gold accent from `libs/landing-v2/ui/src/lib/styles/_variables`.
- `PortfolioContent`: composes `DetailPageShell`, three `.detail-section` blocks bound to
  `landingV2.detail.portfolio.{overview,architecture,engineering}_{title,body}`, and a
  `techChips` list in the `[meta]` slot.
- Copy lives in `libs/landing-v2/ui/assets/i18n/{en,es}.json` under `landingV2.detail.*`.
  English is the default; Spanish is required (landingV2 usable locales are en, es).

## Content architecture (map from apps/shell/CASE_STUDY.md)

Restructure the Portfolio page into these sections. Each maps to material already written
and code-verified in the shell case study. Keep prose tight; this is a showcase, not the
raw Q&A. Every section is i18n copy, not hardcoded text.

1. **Overview** — what the portfolio is: an Angular micro-frontend system in an Nx
   monorepo; a shell host mounting landingV2, odontogram, damoclesSword remotes at
   runtime. (From CASE_STUDY "Overview" + "Why this stack".)
2. **Why micro-frontends** — the honest motivation: a building/learning goal; avoids
   reloading Angular and shared libs when moving between apps; global shared-lib config;
   enables locale-first routing that per-app nginx deploys could not; deliberately over
   engineered to showcase. (From the MF-motivation answer.)
3. **Locale-first routing and localization** — `/:locale/...` first segment (shareable,
   cacheable per language), the `localeGuard` + `localeCorrectionGuard` redirect flow, and
   the hand-rolled i18next wrapper `RokuTranslator` (framework agnostic singleton shared
   across the federation, per-lib namespaces, per-app locales, runtime no-reload switch).
   (From the localization Q&A.)
4. **Shared libraries and architecture** — the `libs/<scope>/*` layout, when something
   earns its own library, the "promote to shared only when truly shareable" rule, icons as
   components. (From the shared-foundation answer.)
5. **Engineering and delivery** — signals everywhere + `eventCoalescing`; the custom Nx
   `@portfolio/docker` plugin (`build`/`push` executors over `docker buildx`); k3s + Helm;
   GitHub Actions CI with affected detection; staging + production release pipeline; Jest
   plus Cypress/Playwright e2e all pointed at the shell. (From CASE_STUDY + cross-ref
   `apps/docker/CASE_STUDY.md`.)
6. **Meta panel** — tech chips (Angular 21, Nx 22, TypeScript 5.9, Module Federation,
   i18next, Docker, k3s, Helm, GitHub Actions) plus a small facts table (stack, apps,
   testing, deploy) and the repo link.

## Design

Match the landing page's existing visual language (dark background, gold accent, the type
scale in `libs/landing-v2/ui/src/lib/styles/_variables`); do not introduce a new palette.
Before writing markup, load the `design-taste-frontend` skill to calibrate the visual
direction so the page does not read as a templated doc dump.

Design intent:
- A quiet **section navigation / table of contents** down the side (or a sticky top strip
  on mobile) so a long page stays scannable. Anchored to the section ids.
- Each section is a **heading + short lead paragraph** (the highlight), plus a **deeper
  detail block that is hidden by default**. Avoid walls of text at the highlight level.
- **Progressive disclosure (the confirmed depth mechanism).** By default the page renders
  only the highlight leads. A single button at the bottom ("Want to know even more?")
  toggles a `deepDive` signal that reveals the in-depth content across the sections (the
  hidden detail blocks). Implementation notes:
  - Prefer one page-level toggle that expands every section's deep block at once, over a
    per-section accordion, so the reading flow stays linear. (A per-section accordion is an
    acceptable alternative if it reads better; decide during build.)
  - Accessibility: the button is a real `<button>` with `aria-expanded`; revealed content
    is not `display:none`-only if it must be reachable by anchor, but for this page a
    signal-driven `@if` is fine. Label text is i18n.
  - The button label and both content depths are i18n keys, so es ships too.
- **Hero visual:** deferred this pass (see Decisions). Use the project's existing image
  (`project().image`) if present, or no hero. The module-federation topology diagram is a
  later polish pass, built then as inline themable SVG in a `ui` component, not a raster.
- The **meta panel** becomes a proper aside: tech chips grouped, a short facts table, and
  the repo/live links (the site itself is the live demo, so "visit live" points at `/`).
- Respect the no-horizontal-scroll rule at 320 to 3840 (see `0006`), light and dark, en
  and es (Spanish copy is longer, so test wrapping).

New shared UI pieces (all in `libs/landing-v2/ui`, project agnostic, standalone, OnPush):
- `detail-section` — a titled content section with an `id` for TOC anchoring, a **lead**
  slot (always shown) and a **deep** slot (shown only when the page's `deepDive` is on).
  Replaces the ad-hoc `.detail-section` divs so odontogram/damocles reuse it. The
  reveal state can be passed in as an input or read from a small shared signal/service.
- `detail-toc` — the section navigation, driven by a list of `{ id, label }`.
- `tech-chip-group` / `facts-table` — small presentational helpers for the meta panel
  (reuse the existing `info-table` pattern if it fits rather than adding a new one).
- A **"want to know more" reveal button** (can live in `PortfolioContent` or a tiny
  reusable `ui` control) that toggles the `deepDive` signal. Keep the toggle state at the
  content-component level and pass it down to the sections.
- (Deferred) `mfe-topology-diagram` — later polish pass only; not built now.

Keep `PortfolioContent` thin: it composes `DetailPageShell` + the new section components
and only supplies the section list and i18n keys. All heavy layout/logic lives in the
reusable `ui` pieces.

## i18n copy

- Add the new keys under `landingV2.detail.portfolio.*` in
  `libs/landing-v2/ui/assets/i18n/{en,es}.json`. Suggested shape:
  `sections.<sectionId>.{title,lead,detail}` where `lead` is the always-visible highlight
  and `detail` is the deep-dive text revealed by the button; plus `reveal_more` /
  `reveal_less` button labels and any chip/fact labels. Keep the existing `overview_*` keys
  or migrate them; if migrating, update `portfolio-content.html`.
- Write English first (default), then Spanish. Prose should be adapted from the case study,
  not copied verbatim from the Q&A; tighten to showcase length. No dashes as punctuation
  (house style).
- Namespace stays `landingV2`; the pipe reads it via the lib's default namespace.

## Implementation steps (ordered)

1. Read `apps/shell/CASE_STUDY.md` end to end and draft, per section, a short **lead**
   (highlight) and a longer **detail** (deep dive) in English, before touching components.
2. Build the reusable `ui` pieces (`detail-section` with lead + deep slots, `detail-toc`,
   meta-panel helpers), each with a spec asserting it renders its inputs and that the deep
   slot is hidden until revealed. Export from `libs/landing-v2/ui`.
3. Rebuild `portfolio-content.html` to compose `DetailPageShell` + the section list + TOC +
   meta panel. Update `portfolio-content.ts` with the section metadata (`{ id, label }`) and
   the `deepDive` signal.
4. Add the "want to know even more?" reveal button at the bottom, wired to toggle
   `deepDive` (with `aria-expanded` and an i18n label). No hero diagram this pass.
5. Add all new i18n keys to `en.json` and `es.json` (lead, detail, reveal labels).
6. Style with the existing tokens; verify responsive behavior and both themes, and that the
   reveal transition reads well.
7. Update the `PortfolioContent` spec (and add specs for the new components), including a
   test that the deep content appears only after the button is clicked.

## Verify

1. `npx nx lint landing-v2-ui landing-v2-feature-project` and
   `npx nx test landing-v2-ui landing-v2-feature-project` pass.
2. Live via the shell: `/en/projects/portfolio` and `/es/projects/portfolio` render the
   highlights, the reveal button expands the deep content (and collapses it), the TOC
   anchors jump correctly, the back/brand link returns to `/{locale}`, and repo/live links
   work.
3. No horizontal scroll at 320 to 3840 in both locales and both themes (`0006` crawl).
4. Commit: `feat(landing-v2): build out the Portfolio project detail page`.

## Conflict discipline

New files under `libs/landing-v2/ui/src/lib/*` and additive keys in the two i18n JSON
files. Edit `libs/landing-v2/ui/src/lib/portfolio-content/*` and the `ui` `index.ts`
export barrel. Do not modify `feature-project` routing or other scopes unless a new
component genuinely needs it. Leave `OdontogramContent` / `DamoclesContent` untouched (a
later plan handles them with the same components).

## Resolved (was open)

All settled in the Decisions block above: Portfolio page only; highlights by default with a
bottom reveal button for the deep dive; hero diagram deferred; implementation in a fresh
session on its own worktree. Nothing blocks the build.
