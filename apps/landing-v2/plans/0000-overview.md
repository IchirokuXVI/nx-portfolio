# 0000 — landing-v2 redesign: overview & index

> Paths are repo-relative to `D:\Projects\nx-portfolio`. Never use relative imports
> across lib boundaries — use `@portfolio/<scope>/<lib>` aliases. **Commit locally
> only; never push** (see CLAUDE.md git workflow). All work happens on branch
> `landing-v2`.

## Goal
Ship a new landing micro-frontend (`landingV2`) implementing the approved dark /
gold-accent redesign, living side-by-side with the current `landing` remote until
cutover. The design was approved from the mockup with the changes captured across
plans `0001`–`0005`.

## What already exists (done in this branch)
The app was scaffolded with the Nx Angular **remote** generator:

```sh
npx nx g @nx/angular:remote --name=landingV2 --directory=apps/landing-v2 \
  --host=shell --style=scss --prefix=app --e2eTestRunner=playwright \
  --unitTestRunner=jest --no-interactive
```

This created:
- `apps/landing-v2/` — the remote app (MF name **`landingV2`**, dev port **4204**),
  exposing `./Routes` from `apps/landing-v2/src/app/remote-entry/entry.routes.ts`.
- `apps/landing-v2-e2e/` — a **Playwright** e2e project (matches `damoclesSword-e2e`).
- Wired the shell: `apps/shell/module-federation.config.ts` `remotes` now includes
  `'landingV2'`; `apps/shell/src/app/app.routes.ts` got a `landingV2` route; the
  `landingV2/Routes` path alias was added to `tsconfig.base.json`.

## Naming (read this — a hyphen forced a split)
Module-federation remote names must be valid JS identifiers, so the **project /
remote name is `landingV2`** while the **directory is `apps/landing-v2`** (the name
the user asked for, and where these plans live). Keep this convention throughout:
- App / remote / MF name, `nx` project name: **`landingV2`**.
- App directory: **`apps/landing-v2`**; e2e: **`apps/landing-v2-e2e`**.
- Routes alias: **`landingV2/Routes`**.
- New library scope (see below): directory **`libs/landing-v2/*`**, import alias
  **`@portfolio/landing-v2/<lib>`** (libraries have no identifier restriction, so the
  hyphen is fine there and matches the app folder).

## Architecture decisions

### D1 — New `libs/landing-v2/*` lib scope (do NOT mutate `libs/landing/*`)
`libs/landing/*` still powers the live `landing` remote. To keep v1 working and v2
self-contained, v2 gets its own scope. Libraries to generate in `0001`:
- `@portfolio/landing-v2/models` — interfaces (project, info-fact, translations).
- `@portfolio/landing-v2/data-access` — static data + in-memory services (projects,
  info-facts), mirroring `libs/landing/data-access` and
  `libs/damoclesSword/data-access`.
- `@portfolio/landing-v2/ui` — presentational landing page + its i18n namespace.
- `@portfolio/landing-v2/feature-shell` — the routed wrapper (mirrors
  `libs/landing/feature-shell`).
- `@portfolio/landing-v2/feature-portfolio`, `.../feature-odontogram`,
  `.../feature-damocles` — the three project detail pages (`0004`).

Duplicating the 3 small static-data files from `libs/landing/data-access` is
acceptable and intended — v2 changes the data anyway (new project, visual config,
different Portfolio image).

> Decision point for the user: if you'd rather **evolve `libs/landing/*` in place**
> and retire v1, say so and `0001`/`0002` collapse onto the existing libs instead.

### D2 — landingV2 replaces landing at the locale root (decided: cut over now)
This app is locale-first like every other remote (`/:locale/...`, per CLAUDE.md
"Locale-first routing"). The generator added `landingV2` as a **root-level** route;
`0001` instead points the **empty-path `:locale` child** at `landingV2/Routes` (where
`landing/Routes` used to be), removes the generator's root-level `landingV2` route, and
removes the old `landing` route. So the landing page lives at **`/<locale>`** and v1 is
retired from routing.

**Routing consequence — detail pages are namespaced under `projects/`.** Because
landingV2 now mounts at the locale root, its internal routes resolve relative to
`/<locale>`. Paths like `odontogram` / `damoclesSword` would collide with the real
odontogram/damoclesSword remotes (siblings under `:locale`), so the detail pages
(`0004`) live at **`/<locale>/projects/{portfolio,odontogram,damoclesSword}`**.
Fully deleting the old `landing` app + `libs/landing/*` and dropping `'landing'` from
the shell `remotes` array is a **separate later cleanup** (leave them in place for now;
an unrouted remote is harmless).

### D3 — Localization via RokuTranslator (unchanged pattern)
The UI lib registers its own namespace exactly like `libs/landing/ui`:
`RokuTranslatorModule.withConfig({ locales: ['en','es'], defaultNamespace: 'landingV2',
loader: (locale) => import('../../assets/i18n/${locale}.json') })`. **English is the
default.** Only `en` + `es` (no `fr` for landing-v2). Page chrome strings live in
these JSON i18n files; per-record *content* (project descriptions, info-table values)
lives already-translated in data-access translation tables (see D4).

### D4 — Data + translations shape (the "two files per record" the brief asks for)
Follow the established data-access convention (`libs/damoclesSword/data-access` /
`libs/landing/data-access`): a **structural** table `static-<x>-data.ts` plus a
**per-locale** table `static-<x>-translation-data.ts`, joined by an in-memory
`*Memory` service into a `Translated<X>`. This is the repo's realization of "one file
for the main record, one for the translations of each record."

> Note on "JSON": these are `.ts` files exporting typed arrays, not literal `.json`.
> That is deliberate — it matches every other data-access domain and gives type
> safety. If you truly want raw `.json`, it's a trivial swap, but it would diverge
> from the codebase convention; flag if you want that.

### D5 — Icons come from `@portfolio/shared/ui`
Per CLAUDE.md, icons are standalone components in `libs/shared/ui` (never inline raw
`<svg>`). The design needs: download/CV, GitHub, LinkedIn, email/contact, and an
arrow ("view project"). Reuse existing icon components where present; add any missing
ones to `libs/shared/ui` and export from its `index.ts` (see `0003` checklist).

## Design system (locked, from the approved mockup)
- **Theme:** dark only. Ground `#0d0d0f` (warm near-black, no pure `#000`), surface
  `#151517`, hairline `rgba(255,255,255,.09)`, text `#ededf0`, muted `#9a9aa2`.
- **Accent:** the existing brand **gold `#f2d45b`** (+ `#b89a3e` dim) — single accent,
  used identically everywhere.
- **Type:** display = tight system grotesk (heavy, negative tracking); body = same
  family, relaxed leading; utility/labels = `ui-monospace`. (No webfont required. If a
  branded face is wanted later, that's a separate change.)
- **Layout:** centered `max-width: 1160px`; fluid `clamp()` type; **responsive from
  320px to 3840px**. Header (no nav) → hero (name + role + subtitle + dynamic info
  table on desktop + CV/socials) → dynamic Projects grid → footer (dynamic year +
  socials). Single column under ~720px.

Reference mockup (approved): the artifact published from `0000`-era —
`https://claude.ai/code/artifact/b90bd4b6-db63-4555-aa73-b357a7ccfc85`.

## Approved changes folded into the plans
1. **Remove header navigation** — keep the header bar, drop the nav links. → `0003`.
2. **Hero info table built dynamically** from a data-access class (structural +
   translations). → `0002` (data), `0003` (render).
3. **Remove the `03 / 03` counter** on the Projects title. → `0003`.
4. **Projects built dynamically** with **visual config** so some span more columns
   than others (`columnSpan`, `featured`). → `0002` (model+data), `0003` (grid).
5. **Add damoclesSword** to the projects list (real info; VR studio). → `0002`.
6. **Footer year set dynamically** (`new Date().getFullYear()`). → `0003`.
7. **Portfolio image proposal** (no screenshot → no self-reference loop). → `0002` §
   "Portfolio visual".
8. **e2e: no scroll / no element overflows the viewport**, 320→3840. → `0005`.
9. **Detail feature pages** for Portfolio, Odontogram, damoclesSword (POS deferred).
   → `0004`.

## Plan sequence
| Plan | Title | Depends on |
|------|-------|-----------|
| `0001` | Scaffold libs + route landingV2 at the locale root + empty remote-entry | app (done) |
| `0002` | data-access: projects (+damocles, visual config) & hero info-table | 0001 |
| `0003` | Landing page UI (header no-nav, dynamic hero/table/grid, footer year) | 0001, 0002 |
| `0004` | Detail pages: Portfolio, Odontogram, damoclesSword | 0001, 0002 |
| `0005` | Playwright e2e: no horizontal/vertical overflow across viewports | 0003, 0004 |

## Cross-cutting conventions (apply in every plan)
- Remote renders **only through the shell** — the remote-entry component keeps an
  **empty template, no `<router-outlet>`** (CLAUDE.md). Develop/test via the shell URL
  `/<locale>` (e.g. `/en`), never port 4204 directly.
- Every leaf `tsconfig` that imports assets needs `types/**/*.d.ts` in `include` (see
  memory: "Asset import types") — verify when generating new libs.
- Run `npx nx lint <project>` + `npx nx test <project>` for every project you touch;
  they must pass on your new files.
- Commit locally after each plan; do not push.

## Decisions (resolved with the user 2026-08-11)
- **D-cutover:** landingV2 **replaces** landing at the locale root now (see D2). v1 is
  removed from routing; deleting its app/libs is a later cleanup.
- **D-portfolio-image:** Portfolio uses a generated **Nx module-federation graph**
  image (gold nodes shell/landing/odontogram/damoclesSword on the dark ground),
  shipped as a normal `image` asset (`0002` A.3). No self-referential screenshot.
- **D-hero-copy:** include **all** of: the "Available for work" badge, the mono role
  line (`Full-stack developer · Angular · Nx`), and the proposed info-table facts
  (Focus / Stack / Also / Based) — see `0002` B.2 and `0003`.
- **D-data-format:** `.ts` static-data tables (repo convention), not literal `.json`.
