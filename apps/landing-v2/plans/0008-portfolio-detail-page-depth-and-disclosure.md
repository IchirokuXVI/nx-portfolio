# 0008 — Portfolio detail page: more depth, real progressive disclosure, tighter meta

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Builds on `0007` (the Portfolio page shipped: `DetailPageShell` plus `detail-section`,
> `detail-toc`, `tech-chip-group`, `facts-table`, five sections, en/es copy). This plan
> revises content depth, the disclosure mechanic, the meta panel, and mobile order per
> review feedback (2026-08-20). Source copy: `apps/shell/CASE_STUDY.md` (foundation) and
> `apps/docker/CASE_STUDY.md` (infrastructure).

## Why

The `0007` page reads well but is too thin. The reveal only appends a deep block under
each one-sentence lead; the meta panel shows the same facts twice (chips plus a facts
table); and on mobile the meta rail lands at the bottom where it is useless. This plan
deepens the copy so the default view is already a few paragraphs per section, turns the
reveal into a real view swap into a much longer read, trims the meta panel, and puts the
meta info first on mobile.

## Content: rewrite the sections

New section set. Titles and intent (every section is i18n copy, not hardcoded):

1. **Overview** — what the site is and, above all, the **motivation to build it**. This is
   the one section that stays a single paragraph (about four lines) in the collapsed view.
2. **Why micro-frontends** — reframe the honest motivation. It is **not** "a showcase of
   how the pieces fit." It is a **learning experience** that also doubles as a way to
   **show my skills as a developer**. Keep the practical upside (no reload of Angular or
   shared libs when moving between apps, shared config in one place, locale-first routing
   across apps) but the headline is learning plus demonstrating skill.
3. **Localization** (renamed from "Locale-first routing") — localization in general,
   centered on **RokuTranslator**: a hand-rolled i18next wrapper, a framework-agnostic
   singleton shared across the whole federation, per-library namespaces with per-locale
   lazy loaders, runtime language switch with no rebuild. Locale-first routing is
   mentioned as **one part** of this, not the main point.
4. **Organizing the project** (renamed from "Shared libraries") — by default almost
   everything lives in `libs`: some are feature libs, others `ui`, `data-access`,
   `models`, utils. The **apps stay almost untouched**. Most of the time something moves
   into its **own** library because it has outgrown the shared `ui`/utils library and is a
   **real feature in its own right**, with value in being independent from the other libs.
5. **Assets handling** — how static assets are handled across the federation.
   **Copy source is not written yet** (see "Copy source" below): there is no answered
   assets Q&A in `apps/shell/CASE_STUDY.md`. Candidate points, code-derived, pending
   Daniel's confirmation or a written answer:
   - each lib owns its own `assets/` (i18n JSON, icons), loaded by the lib that owns them;
   - SVG icons imported as raw strings (`?raw`) and inlined via `DomSanitizer` as standalone
     components, never inline `<svg>` markup;
   - the module-federation gotcha that a remote's CSS `url()` assets resolve against the
     **shell's** origin, not the remote's;
   - each leaf `tsconfig` needs `types/**/*.d.ts` in `include` so `*.svg?raw` / asset
     imports typecheck.
6. **Infrastructure and deployment** (renamed from "Engineering and delivery") — **drop
   signals / state / change-detection entirely**. Cover **GitHub** and **GitHub Actions**
   (affected-project CI), **Docker** (the custom `@portfolio/docker` plugin over
   `docker buildx`), **Helm**, **Kubernetes** (**k3s**), the staging then production
   release flow, and the **tests** (Jest for units, Cypress / Playwright for e2e, all
   pointed at the shell).

### Depth rules

- **Collapsed (highlight) view:** a few short paragraphs per section, **2 to 4 lines
  each**, EXCEPT Overview which stays one ~4-line paragraph.
- **Deep view:** the same sections with substantially **more detail**, always split into
  **multiple paragraphs** (never one wall of text), PLUS **extra sections that appear only
  in the deep view**.

### Proposed deep-only sections

Drawn from `apps/shell/CASE_STUDY.md` and `apps/docker/CASE_STUDY.md`; keep them
project-agnostic. Confirm or adjust during build:

- **Module federation topology** — the shell as the only host, lazy-loading each remote
  through its `<remote>/Routes` alias, and remotes rendering a blank page on their own
  port by design (they only render through the shell).
- **Testing** — the shared-spec contract pattern for the data-access layer, and why e2e
  points at the shell rather than each remote.

Both deep-only sections are **confirmed** (2026-08-20).

### Copy source

Every section's prose is adapted from `apps/shell/CASE_STUDY.md` (foundation) and
`apps/docker/CASE_STUDY.md` (infrastructure), tightened to showcase length, no dashes as
punctuation. **Exception: Assets handling has no answered source.** Before writing it,
either (a) Daniel adds an assets Q&A to `apps/shell/CASE_STUDY.md` and I adapt it, or
(b) I draft it from the code-derived candidate points above and Daniel reviews the draft.
Decide at implementation start; do not invent unverified claims in the meantime.

## Progressive disclosure: a view swap, not an append

Replace the "append a deep block" reveal with a full **view swap** driven by the
`deepDive` signal:

- **Collapsed (default):** the highlight paragraphs per section. A single button at the
  **bottom**: "Want to know even more?".
- **Expanded:** the highlight text **collapses away** and is replaced by the deep content
  (same sections with much more detail, plus the deep-only sections). The toggle button
  **moves to the top** (label e.g. "Show less" / "Back to the highlights"). On expanding,
  **scroll to the top of the article** so the relocated button and the fresh content are
  in view (honor reduced motion: instant vs smooth).
- At the **end** of the deep view, a short **closing comment for readers**: a sign-off
  note (i18n) styled distinctly from the body prose.
- **Accessibility:** a real `<button>` with `aria-expanded`; `aria-controls` points at the
  content region; labels are i18n.

The TOC ("On this page") derives from the **currently visible** section list, so it
updates between the two views automatically (more entries in the deep view).

## Meta panel changes

- **Sticky on desktop:** keep the right rail (TOC plus chips) sticky so it stays visible
  while the long body scrolls.
- **Remove the facts table** (it duplicates the chips). Drop the `facts-table` usage;
  since nothing else consumes it, remove the component, its spec, its barrel export, and
  its module entry so there is no dead code (`0007` added it; it can return later if a
  genuine need appears).
- **Chips, revised groups:**
  - **Frontend:** Angular 21, TypeScript (drop the "5.9"), Module Federation, Localization
    (replaces i18next)
  - **Tooling:** Nx 22, Jest, Cypress, Playwright
  - **Deployment** (group title was "Delivery"): Docker, Kubernetes (was k3s), Helm,
    GitHub Actions

## Mobile layout

- The meta info (the chips) moves to the **top** on mobile, above the section body (today
  it sits at the bottom). The TOC stays desktop-only (it is the sticky rail); on mobile
  the chips lead.
- **Mechanism:** change `DetailPageShell` directly so the `[meta]` slot renders **before**
  `[body]` on mobile (the single-column layout), for **every** detail page. **No input /
  opt-in flag** (`metaFirstOnMobile` is explicitly rejected). This applies to all detail
  pages (portfolio, odontogram, damocles) by design: the meta belongs on top on mobile
  everywhere. On desktop the order is unchanged (body left, sticky meta rail right).
- Preserve the no-horizontal-scroll guarantee (320 to 3840), both locales, both
  disclosure states.

## Component / structure impact

- **`detail-section`** becomes paragraph-list driven: render a title plus an ordered list
  of paragraph i18n keys (an `@for` of `{{ key | rokuT }}` into `<p>` elements) instead of
  the single `[lead]` / `[deep]` content slots. The same component renders the highlight
  paragraph list or the deep paragraph list depending on what the parent passes.
- **`PortfolioContent`** holds the section config: per section an `id`, a title key, an
  ordered list of highlight paragraph keys and of deep paragraph keys, and a `deepOnly`
  flag. It derives the visible sections and the TOC from `deepDive`, and owns the button
  placement (bottom when collapsed, top when expanded), the scroll-to-top on expand, and
  the closing note (deep only). Stays thin; layout and logic live in the `ui` pieces.
- **i18n:** new keys under `landingV2.detail.portfolio.*`. Suggested shape
  `sections.<id>.title`, `sections.<id>.highlight.pN`, `sections.<id>.deep.pN`, plus
  `reveal_more`, `reveal_less`, `closing_note`, and the chip group titles. Write English
  first, then Spanish (longer, so test wrapping). No dashes as punctuation (house style).
- **Remove obsolete `0007` keys** that no longer map: the old single `sections.<id>.lead`
  / `.detail`, and the `facts.*` labels/values for the removed table.

## Implementation steps (ordered)

1. Draft, per section, the highlight paragraphs and the deeper multi-paragraph copy in
   English (from the two case studies), plus the deep-only sections and the closing note.
2. Rework `detail-section` to render a paragraph-key list; update its spec.
3. Update `PortfolioContent`: section config, `deepDive` view swap, button at the bottom
   when collapsed and at the top when expanded, scroll-to-top-of-article on expand, and
   the closing note.
4. Meta panel: drop `facts-table`, revise the chip groups, ensure the desktop rail is
   sticky.
5. `DetailPageShell`: make the `[meta]` slot render before `[body]` on mobile for every
   detail page (no input). Desktop order unchanged.
6. Add and replace i18n keys in `en.json` and `es.json`; remove the obsolete ones.
7. Update specs: `detail-section`, `portfolio-content` (highlight vs deep swap, button
   relocation, deep-only sections present only when expanded, closing note in deep only).
   Remove the `facts-table` spec.

## Verify

1. `npx nx lint landing-v2/ui landing-v2/feature-project` and
   `npx nx test landing-v2/ui landing-v2/feature-project` pass.
2. Live via the shell, `/en` and `/es/projects/portfolio`: collapsed shows a few
   paragraphs per section (Overview one); the reveal swaps to the deeper multi-paragraph
   content plus the new sections, the button relocates to the top, the closing note shows;
   collapsing restores the highlights. TOC anchors track the visible sections. The desktop
   rail stays sticky.
3. Mobile: chips at the top; no horizontal scroll 320 to 3840 in both locales and both
   disclosure states (`0006` crawl).
4. Commit: `feat(landing-v2): deepen the Portfolio detail page and rework its disclosure`.

## Conflict discipline

Edit `libs/landing-v2/ui/src/lib/portfolio-content/*`, `detail-section/*`, the
`tech-chip-group` group data, the two i18n JSON files, and the `ui` `index.ts` plus
module barrel. Change `detail-page-shell`'s mobile ordering so the meta slot leads on
mobile for **all** detail pages (a shared change, intended to affect every detail page,
no input). Remove `facts-table`. Do not touch `feature-project` routing or the
`OdontogramContent` / `DamoclesContent` components: their detail pages inherit the shell's
mobile-order change automatically.
