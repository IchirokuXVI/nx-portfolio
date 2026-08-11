# 0005 — e2e: no horizontal scroll / no element overflows the viewport (320→3840)

> Repo-relative paths. Commit locally only. Prereq: `0003` (landing UI) and ideally
> `0004` (detail pages, so the crawl covers them). Lives in the generated
> **Playwright** project — directory `apps/landing-v2-e2e`, nx project name
> **`landingV2-e2e`** (use the nx name in `nx e2e` commands, the directory in paths).

## Goal
Guarantee the brief's hard requirement: **no horizontal scroll and no visible element
wider than the screen**, across the full responsive range **320px → 3840px (4K)**, on
every reachable `landingV2` route.

> Scope note: "no scroll" = no *horizontal* scroll and no element sticking out past the
> viewport. Vertical scrolling is normal for a content page and is **not** failed.

## Reuse the proven spec
`apps/damoclesSword-e2e/src/no-horizontal-scroll.spec.ts` already implements exactly
this technique and is battle-tested (it drove the recent damocles horizontal-scroll
fixes). **Copy it** to `apps/landing-v2-e2e/src/no-horizontal-scroll.spec.ts` and adapt:

1. **Viewports** — extend the list to cover 4K and an ultra-wide step, keeping the
   small end at 320:
   ```ts
   const viewports = [
     { name: 'mobile-sm', width: 320,  height: 720  },
     { name: 'mobile',    width: 420,  height: 812  },
     { name: 'tablet',    width: 768,  height: 1024 },
     { name: 'laptop',    width: 1280, height: 800  },
     { name: 'desktop',   width: 1920, height: 1080 },
     { name: 'qhd',       width: 2560, height: 1440 },
     { name: 'uhd-4k',    width: 3840, height: 2160 },
   ];
   ```
2. **Scope (important — landingV2 is at the locale root).** Point `baseURL` at
   `/<locale>` (e.g. `/en`). The damocles spec's `inScope` (`p === scope ||
   p.startsWith(scope + '/')`) is **too broad here**: from the root it would follow the
   project cards' `appLink`s into the *other* remotes/live apps (`/en/odontogram`,
   `/en/damoclesSword`, `/en/point-of-sale`), which have their own e2e. Narrow it so the
   crawl covers only landingV2's own routes — the landing page and the `projects/`
   subtree:
   ```ts
   const inScope = (p: string) =>
     p === scope /* /en */ || p.startsWith(scope + '/projects');
   ```
   That discovers `/en/projects/portfolio|odontogram|damoclesSword` (reachable from the
   landing "View project" links) and excludes everything else.
3. Keep the two assertions unchanged: behavioural (`scrolledX === 0`) and geometric
   (`scrollWidth <= clientWidth + TOLERANCE_PX`), plus the offender list
   (`getBoundingClientRect().right > clientWidth`) so failures name the overflowing
   element. That offender check *is* the "visible elements don't overflow the screen"
   requirement.

## Playwright config
Model `apps/landing-v2-e2e/playwright.config.ts` on
`apps/damoclesSword-e2e/playwright.config.ts`:
- `webServer` boots the shell with the `landingV2` dev remote (so the page renders
  through the shell, per CLAUDE.md — never port 4204 directly) and sets
  `reuseExistingServer` for local runs.
- `use.baseURL = 'http://localhost:<shellport>/en'` (allow override via
  `process.env.BASE_URL`, as damocles does).
- Consider a second project/run for `/es` (Spanish text is longer and is a common
  source of overflow) — either a second `baseURL` run or a locale loop in the spec.
  Recommended: cover both `en` and `es`.

## Optional second spec — smoke
Add `apps/landing-v2-e2e/src/landing.spec.ts` asserting the core of the page is present
(header has no `<nav>` links, projects grid renders ≥4 cards, CV link is a download,
footer year equals the current year). Delete the generated `example.spec.ts`.

## Verify
1. Pre-start the shell (`npx nx serve shell`), then:
   `npx nx e2e landingV2-e2e` (or `--grep "no horizontal scroll"`). All viewport
   tests green for `en` and `es`, across every crawled route.
2. Deliberately break one card (e.g. a fixed `width: 2000px`) and confirm the spec
   fails and names the offender — proves the guard works — then revert.
3. Commit: `test(landing-v2): e2e guard against horizontal overflow 320→3840`.

## Conflict discipline
All new files under `apps/landing-v2-e2e/`. No other project touched.
