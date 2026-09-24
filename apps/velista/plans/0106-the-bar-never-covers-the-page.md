> **PR:** [#488](https://github.com/IchirokuXVI/nx-portfolio/pull/488)

# 0106: the bar never covers the page

The bottom bar of plan `0097` hides the last part of a page. On a zone list and on a basket
the composer row that adds a line sits under the bar, and every page scrolls a little even
when its content is short. This plan replaces the scroll model under the bar instead of adding
another compensation to it.

## Why the bar covers things today

- `AppNav` is `position: fixed` at the bottom (`libs/velista/ui/src/lib/layout/app-nav.scss`).
- The only room made for it is `padding-bottom: var(--app-page-foot)` on `.app-main`
  (`app-layout.scss`). Padding adds space after the end of the document. It does not move
  anything that is pinned to the bottom of the viewport.
- Pages size themselves with `min-block-size: calc(100svh - var(--app-safe-bottom))`, and
  `--app-safe-bottom` is 0 while the bar is up. So a page is at least one full viewport tall,
  plus the padding, and the document always scrolls a little.
- The composer (`.composer-dock` on the list page and the basket page) is
  `position: sticky; inset-block-end: 0`. Standalone, the body scrolls, so the dock sticks to
  the bottom of the viewport, which is exactly the strip the fixed bar covers (z 5 over z 1).
- Standalone and mounted behave differently: mounted, `.page` is the scroll container.
  Standalone, `block-size: 100%` resolves to `auto`, the body scrolls, and
  `:host(.standalone) .page { overflow-y: visible }` exists to make sticky rows work.

## The decision: a frame that never scrolls

The user proposed this and it is the right model:

- The app is a column exactly one viewport tall (`100svh` standalone, the space the shell
  gives it mounted). The body never scrolls.
- The column holds the routed page, which takes the free space (`flex: 1; min-block-size: 0`),
  and the bar, which is an ordinary flex item at the end. The bar is not `fixed` any more, so
  nothing can sit under it.
- Each page has one scroll container, its own `.page`, with `overflow-y: auto`. A composer dock
  is a flex item after `.page`, not a sticky element, so it is always visible and always above
  the bar.

Why this is better than more padding:

- The bar takes its real height out of the layout, so no page needs to know the bar's height.
  `--app-page-foot` and the `nav-up` swap of `--app-safe-bottom` can go.
- One model for both run modes. The `standalone` host class and its `overflow-y: visible`
  exception go away, and sticky rows (`ListTools`) stick inside `.page` in both modes.
- Short pages stop scrolling, because nothing is taller than the frame.

The costs, which the builder must handle rather than discover:

- **Scroll restoration.** Angular's `withInMemoryScrolling` restores the window's scroll only.
  With the window fixed, going back to a long list starts at the top. Check what velista
  configures today. If it restores window scroll, say so in the PR and keep the loss visible;
  do not build a custom restorer in this plan.
- **The phone's address bar** no longer collapses on scroll in a browser tab, because the
  document does not scroll. `100svh` is the small viewport, so nothing is cut off. An installed
  app has no address bar. Accept this.
- **Pull to refresh** in mobile Chrome only fires when the document scrolls. Accept this for
  the same reason.
- **Keyboard.** When the phone keyboard opens over the composer, the visual viewport shrinks.
  Check on a 390 px wide viewport that the composer field is still visible while typing
  (`interactive-widget` in the viewport meta tag, if the app sets one, decides this).

## Brief for the agent

### Objective

Make the velista app a non scrolling column with the bottom bar as its last flex item, so that
no page content, composer or empty state is ever under the bar, and short pages do not scroll.

### Context

- Layout: `libs/velista/ui/src/lib/layout/app-layout.{html,scss,ts}` (the bar is drawn after
  `<router-outlet>` inside `<main class="app-main">`, `navReserved()` binds `nav-up`) and
  `app-nav.{ts,html,scss}`.
- Roots: standalone `apps/velista/src/app/app-root.ts` (`display: flex; min-block-size:
  100svh`). Mounted, the portfolio shell's root is a flex column with `min-height: 100dvh`.
- Tokens: `--app-nav-height`, `--app-page-foot`, `--app-safe-bottom` in
  `libs/velista/ui/src/lib/styles/_semantic.scss` and `app-layout.scss`.
- Pages that size themselves against the viewport: search every velista stylesheet for
  `100svh`, `--app-safe-bottom`, `--app-page-foot` and `standalone`. At least
  `list-page.scss`, `basket-page.scss`, the mixins in
  `libs/velista/feature-lists/src/lib/_list-page.scss` and `_basket-shared.scss`, and
  `home-page.scss` do.
- Sheets cover the bar (plan `0097` section 5). They are `position: fixed` overlays and are not
  part of the column.
- Plan `0097`: read its constraints and section 3 (`NavChrome` hides the bar on some screens).

### Target state

- In both run modes, at 390 x 844 and at 1280 x 800:
  - the document's `scrollHeight` equals its `clientHeight` on every screen with the bar
  - the composer on a zone list and on a basket is fully visible above the bar, with nothing
    overlapping it, on a list with 40 lines and on an empty list
  - the last row of a long list can be scrolled into view above the composer
  - `ListTools` stays stuck at the top of `.page` while the list scrolls
- On a screen where `NavChrome` hides the bar, the page takes the whole column and the bottom
  safe area inset is applied once, by the page.
- Where the bar is shown, the safe area inset is applied once, by the bar (plan `0097`'s rule
  that the bar is the only element carrying `--app-safe-bottom` still holds).
- The `standalone` host class exists only if something other than scrolling still needs it.
- The home page's dock still sits at the foot of the page, above the bar.

### Scope

Work in `libs/velista/ui/src/lib/layout`, `libs/velista/ui/src/lib/styles`,
`apps/velista/src/app`, and the page stylesheets (and a page's host class binding) of every
velista feature lib that sizes itself against the viewport. Update their specs,
including `app-layout.spec.ts`.

Do not touch: the portfolio shell's own layout, the sheets, the bar's content, tabs or badge.
Other agents edit `basket-page.html` and `list-page.html` at the same time. Change templates
only where the layout needs it (for example removing a `standalone` binding), and prefer
stylesheet changes.

### Constraints

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- `100svh` only. `no-dynamic-viewport-units.spec.ts` fails on `dvh` or `lvh`.
- `token-hygiene.spec.ts` rejects raw pixel values except `0px` and `1px`.
- Mounted mode must not depend on the shell's layout changing. If velista cannot fill the
  shell's space without a shell change, stop and ask.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- changing the portfolio shell (`apps/shell`) or its global styles
- adding a custom scroll restoration service
- changing what the bar shows or when it is shown

### Progress evidence

- `npx nx run-many -t lint,test -p velista-ui velista-feature-lists velista-feature-shopping-lists velista-feature-home`
  (and every other velista lib whose stylesheet you changed) green, and `npx nx build velista`
  and `npx nx build shell` green.
- A Playwright check script in the worktree's `tools/dev/.run/` that measures, with
  `getBoundingClientRect`, the composer's bottom against the bar's top and the document's
  scroll height, on the home page, a zone list and a basket, in both run modes and both
  viewport sizes. Paste its output in the PR body.
- Two screenshots at 390 px, list page and basket, in the PR body.
