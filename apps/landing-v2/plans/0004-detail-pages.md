# 0004 — Project detail pages: Portfolio, Odontogram, Damocle'Sword

> Repo-relative paths. Aliases only across lib boundaries. Commit locally only.
> Prereq: `0001`–`0003`. Adds three routed detail pages the landing project cards
> link to (`detailLink`). **Restaurant POS is intentionally excluded** — not ported to
> the portfolio yet; its card's "View project" falls back to `appLink` (`0002`/`0003`).

## Routing
Add a `<router-outlet>` to the shell-side wrapper so the index (landing page) and the
detail pages share the `landingV2` remote. In
`libs/landing-v2/feature-shell/src/lib/routes.ts` (`LandingV2Routes`):

```ts
export const LandingV2Routes: Route[] = [
  { path: '', component: LandingV2Wrapper },                 // landing page (0003)
  { path: 'portfolio',     loadComponent: () => import('@portfolio/landing-v2/feature-portfolio').then((m) => m.PortfolioPage) },
  { path: 'odontogram',    loadComponent: () => import('@portfolio/landing-v2/feature-odontogram').then((m) => m.OdontogramPage) },
  { path: 'damoclesSword', loadComponent: () => import('@portfolio/landing-v2/feature-damocles').then((m) => m.DamoclesPage) },
];
```

Landing lives at `''` and detail pages at their own paths, so the wrapper's own
template does not need a permanent outlet — but if `LandingV2Wrapper` renders the
landing UI directly, host these as **sibling** routes (as above) rather than children,
so the detail page replaces the landing page. Preview URLs:
`/en/landingV2/portfolio`, `/es/landingV2/odontogram`, etc. `detailLink` values in
`0002` must match these exactly.

## Feature libs (generate now)
```sh
npx nx g @nx/angular:library --name=landing-v2/feature-portfolio \
  --directory=libs/landing-v2/feature-portfolio --importPath=@portfolio/landing-v2/feature-portfolio \
  --unitTestRunner=jest --linter=eslint --style=scss --no-interactive
# repeat for feature-odontogram and feature-damocles
```
Each exposes one standalone page component (`PortfolioPage` /`OdontogramPage`
/`DamoclesPage`, selector `lib-landing-v2-<name>-page`, `OnPush`). Add the asset
`types/**/*.d.ts` include to any that import images.

## Shared detail-page shell
Build one small reusable presentational component in `@portfolio/landing-v2/ui`
(`detail-page-shell`, `lib-landing-v2-detail-page-shell`) so the three pages are
consistent and thin:
- Inputs: `title`, `tagline`, and projected slots for the body sections and a
  side/meta panel.
- A **back link** to the landing page (`routerLink` to `/{locale}/landingV2`) using the
  arrow icon; a header with the project title; a repo link + live-app link (when
  present). Same dark tokens + gold accent as the landing page.
- Detail pages compose `detail-page-shell` + section blocks (heading + prose + optional
  media/stat rows). Reuse the info-table pattern for a "tech / facts" panel if useful.

All page copy is i18n (namespace `landingV2`, keys prefixed `detail.<project>.*` in
`libs/landing-v2/ui/assets/i18n/{en,es}.json`), English default. Long-form
description copy that already exists as data (project descriptions from `0002`) can be
reused; detail pages add depth beyond the card blurb.

## Content outlines (real, from the codebase)

### Portfolio — `feature-portfolio`
Theme: "this site, and how it's built." Sections:
- **Overview** — a personal portfolio built as an Angular **module-federation**
  micro-frontend system in an **Nx monorepo**: a `shell` host mounting `landing`,
  `odontogram`, `damoclesSword` remotes at runtime.
- **Architecture** — locale-first routing (`/:locale/...`), lazy-loaded remotes via
  `<remote>/Routes` aliases, a hand-rolled i18n singleton (**RokuTranslator**) shared
  `singleton: true` across all micro-frontends.
- **Engineering** — a custom Nx plugin (`@portfolio/docker`) with `build`/`push`
  executors wrapping `docker buildx`; Kubernetes/Helm deploy to a k3s cluster; GitHub
  Actions CI computing affected projects; Jest + Playwright/Cypress testing.
- **Meta panel** — tech chips (Angular, Nx, TypeScript, Module Federation, Docker, k8s,
  Helm, GitHub Actions) + repo link. No screenshot (same self-reference reasoning as
  the card; reuse the brand-panel/graph motif as the hero visual).

### Odontogram — `feature-odontogram`
Theme: "a dental chart that models real treatments." Sections:
- **What it is** — a full odontogram to record treatments and keep patient history.
- **The hard part** — a tooth has up to **six zones**; a single treatment can affect
  multiple zones and span **more than one tooth**; the SVG chart maps clicks to
  zones/teeth and persists state.
- **Meta panel** — tech chips (Angular, SVG), live-app link (`/{loc}/odontogram`), repo
  link, and the existing screenshot as the hero visual.

### Damocle'Sword — `feature-damocles`
Theme: "a VR game studio, and its site." Pull real copy from
`libs/damoclesSword/ui/assets/i18n/en.json` (who-we-are, values, what-we-do, vision)
and the `damoclesSword/data-access` project domain. Sections:
- **The studio** — a VR game studio founded by university students; develops VR games
  and offers VR/gamification services to companies. (Paraphrase `section-who-we-are`.)
- **Their work** — VR titles (e.g. **STARLIT: ASCENSION** — a VR shooter) and client
  R&D projects (Realistic Interactor, VR Sickness Reducer). (From the project data.)
- **How the site is built** — an Angular micro-frontend: Home/About/Services/Contact,
  a translated (EN/ES/FR) component system, a reactive contact form, a data-access
  layer for news & projects. This is the "goes into detail" engineering angle.
- **Meta panel** — tech chips (Angular, Micro-frontend, VR, i18n EN/ES/FR), live-app
  link (`/{loc}/damoclesSword`), repo link, and (if captured in `0002`) the home
  screenshot or the STARLIT logo as the hero visual.

## Verify
1. `npx nx lint` + `npx nx test` for the three feature libs and `landing-v2/ui` — pass.
   Add a spec per page asserting the title renders and the back link points to
   `/{locale}/landingV2`.
2. Live via shell: from `/en/landingV2`, click each project's "View project" → lands on
   the detail page; back link returns; POS "View project" goes to `/en/point-of-sale`
   (live app, no detail page). Repeat `/es`.
3. No horizontal scroll on any detail page at 320–3840 (formalized in `0005`).
4. Commit: `feat(landing-v2): Portfolio, Odontogram & Damocle'Sword detail pages`.

## Conflict discipline
New files under `libs/landing-v2/feature-*` and additive blocks in
`libs/landing-v2/ui`. `libs/landing-v2/feature-shell/src/lib/routes.ts` is edited to
register the three routes. Do not modify other scopes.
