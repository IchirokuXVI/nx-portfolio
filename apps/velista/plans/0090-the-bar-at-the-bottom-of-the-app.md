# 0090: the bar at the bottom of the app

> Mock: `mocks/nav/`, published at https://claude.ai/artifact/HSJYUM3oq8srUafnH76P81.
>
> velista has no navigation of its own. Every screen is reached by going into something
> and every way back is a chevron, so the catalog this app is about to gain would have
> no door and the basket being shopped is three taps from the list somebody is reading.
> This plan adds one bar with three tabs, Home, Catalog and Shopping list, drawn once
> for the whole app, on every screen except a sheet and the four screens of section 4.
> The Catalog tab's own screen is `0093` and does not exist yet: this plan gives it a
> route that draws a placeholder, so the bar is honest from the day it ships.
>
> Prerequisite reading: `0001` (the extraction contract, items 1 and 4), `0002`
> (sections 7 and 8, space and touch), `0004` (rule D1 and why `platform` exists),
> `0040` (a footer that does not cover the sheet), `0045` (your shopping list on the
> home page), `0061` section 1 (one bottom bar, and why it places nothing), `0071`
> (the startup gate in `AppLayout`), and `libs/velista/ui/src/lib/layout/`.

## Brief for the agent

### Objective

Draw one bottom bar with three tabs for the whole app, decide its visibility in
`platform` rather than in a page, remove home's button row, and add the
`shopping-lists/current` route that the third tab opens.

### Context

- `AppLayout` (`libs/velista/ui/src/lib/layout/app-layout.ts`) is the parent component
  of every route in this app. It already owns the theme scope, the startup gate, the
  connection screen and the update screen, and it reads all of them from `platform`
  services it injects.
- **Rule D1 is enforced by a spec.** `libs/velista/ui/src/lib/layering.spec.ts` scans
  every file in `ui` and fails the build if one imports `@portfolio/velista/data-access`
  or `@angular/common/http`, or injects `Router` or `ActivatedRoute`. A `routerLink` is
  allowed; reaching for the router is not.
- `platform` does not import `data-access` either. The established way round that is
  inversion: `ConnectionState` holds a signal in `platform` and the gateway interceptor
  in `data-access` writes to it. `AppHistory.watch()` is started from an environment
  initializer in `app-providers.ts`, which is the one place that may see both.
- `StartupGate` is the precedent for this plan's visibility service: the question needs
  the router, so it is answered in `platform` and `AppLayout` reads the answer.
- `AppPath` (`platform/src/lib/app-path.ts`) builds this app's localized URLs. Pages
  already use it for `homeUrl`.
- Home's bottom is a dock: `lib-shopping-list-card` sitting on `lib-bottom-action-bar`,
  two siblings at the end of a flex column (`home-page.html`). `BottomActionBar` is a
  shell used by home and by the shopping list history, and it places nothing itself.
- The list page and the basket page each end in a `lib-line-composer`. Both already
  carry `env(safe-area-inset-bottom)` through `--app-safe-bottom`.
- Routes live in `libs/velista/feature-shell/src/lib/routes.ts`, and `routes.spec.ts`
  asserts the sheet rules over them.

### Target state

A person on any screen of the app sees three labelled tabs at the bottom, presses one
and lands on that tab's screen. The bar is absent under an open sheet and on the four
screens in section 4. Home no longer carries the Get shopping list row, and both of
its actions are reachable from the third tab.

### Scope

Work only in:

- `libs/velista/ui/src/lib/layout/` (the bar, and `AppLayout`)
- `libs/velista/ui/src/lib/icons/` (only if a glyph is missing)
- `libs/velista/platform/src/lib/` (the visibility service, the badge signal)
- `libs/velista/feature-shell/src/lib/routes.ts` and its spec
- `libs/velista/feature-home/src/lib/home-page/` (removing the row)
- `libs/velista/feature-shopping-lists/src/lib/` (the new current screen)
- `libs/velista/data-access/src/lib/` (only to write the badge signal)
- `apps/velista/src/app/app-providers.ts` (only to wire the session into the bar)

Do not touch: the basket page's own controls, the list page, the assistant, the zone
pages, any backend, any other app.

### Constraints

- Follow the `nx-portfolio-angular-developer` skill for every file you create.
- Follow the `design-taste-frontend` skill for the bar itself.
- Zoneless, `ChangeDetectionStrategy.OnPush`, signals, no `@angular/core/rxjs-interop`
  anywhere in this app (CLAUDE.md, the NG0203 rule).
- `100svh` only. `no-dynamic-viewport-units.spec.ts` fails the build on `dvh` or `lvh`.
- Every string is a translation key in the `velista` namespace, none written inline.
- The bar is the only element on a screen that may carry `--app-safe-bottom`. A screen
  that draws its own dock keeps its padding and loses its inset while the bar is up.

### Action boundaries

Stop and ask before: adding a dependency, changing a route path that is not named in
this plan, changing `BottomActionBar`'s own markup, or touching the basket page's
composer.

### Progress evidence

After each section output: the files changed, and the command you ran to prove it.

## 1. What is being built

One component, one visibility service, one signal, one route, and one removal:

| Thing | Where |
| --- | --- |
| `AppNav`, presentational | `libs/velista/ui/src/lib/layout/app-nav.ts` |
| `NavChrome`, the visibility answer | `libs/velista/platform/src/lib/nav-chrome.ts` |
| `LiveBasketBadge`, a number or null | `libs/velista/platform/src/lib/live-basket-badge.ts` |
| `shopping-lists/current` | `feature-shell/src/lib/routes.ts` |
| Home's `lib-bottom-action-bar` | deleted from `home-page.html` |

## 2. The three tabs

Left to right: **Home**, **Catalog**, **Shopping list**. Each tab is an icon above its
word, never a bare glyph, and the whole tab is the target: 60px tall, a third of the
row wide, with the row 88px tall including the safe area inset.

- Home links to `AppPath` home. Catalog links to `catalog`. Shopping list links to
  `shopping-lists/current`.
- The active tab is drawn twice over: `--app-action-quiet-fg` on the glyph and the
  word, and a tinted pill behind both. Colour alone is not a state.
- `aria-current="page"` on the active tab, and the row is a `<nav>` with an
  `aria-label`.
- Icons: `home-icon` is new and belongs in `libs/shared/ui` (product neutral, per
  CLAUDE.md). The catalog uses the existing `product-icon` and the third tab the
  existing `basket-icon`, both in `libs/velista/ui/src/lib/icons/`.

**Which tab is active is decided by the URL, and often none is.** `home` lights Home,
`catalog` lights Catalog, anything under `shopping-lists` lights Shopping list, and
every other screen lights nothing. The bar on the account screen is a way out, not a
claim about where you are.

## 3. Where the bar is drawn

**It is drawn on every screen unless something says otherwise**, which is the opposite
of a page opting in. `AppNav` is rendered by `AppLayout`, as a sibling of the outlet,
after it.

`NavChrome` answers one signal, `visible`, and it is false when any of these holds:

1. The deepest activated route carries `data.chrome === 'none'` (section 4).
2. A sheet is open. A sheet is a child route under the `sheet` segment, so this is a
   URL test: the activated path contains `SHEET_SEGMENT`.
3. The session cannot use the tabs (section 4, the guest case).

For (3), `NavChrome` holds a `usable` signal that it does not compute itself.
`app-providers.ts` sets it from `SessionStore`, in an environment initializer beside the
one that starts `AppHistory`, because that file is the only place allowed to see both
libraries. Default it to false and set it on the first session read: under-showing the
bar costs one navigation, over-showing it hands an anonymous visitor two tabs that
answer with a sign in screen.

## 4. The four screens that carry `data.chrome: 'none'`

| Route | Why |
| --- | --- |
| the empty path (the front door) | Nobody has signed in, and two tabs need an account |
| `auth/login`, `auth/register`, `auth/upgrade`, `auth/verify`, `auth/callback` | Same, and each is one task with one way out |
| `join/:code` | An invitation, before the code is accepted |
| `s/:secret` | A guest's way in, and the guest case besides |

A guest who has accepted a shared basket lands on the ordinary basket page, which
carries no flag, so the guest case is the `usable` signal in section 3 and not route
data.

**The startup, connection and update screens are not in this table.** They replace the
outlet rather than covering it (`0071`), so no page is drawn at all and there is
nothing for a bar to sit under. `AppLayout` renders `AppNav` inside the same branch
that renders the outlet, which makes that true by construction rather than by a rule.

## 5. A sheet covers the bar

A sheet keeps its own bottom edge on the screen's bottom edge. It does not rest on top
of the bar, and the bar is not drawn while it is open (section 3, rule 2), so the scrim
covers the whole screen and nothing under it is pressable.

`SheetShell` already sits at `z-index: 10`. Give the bar a component token below that
and record the number beside the sheet's, so the two are read together.

## 6. What moves off home

Delete `<lib-bottom-action-bar>` from `home-page.html` along with the `getShoppingList`
and `openShoppingLists` handlers it fired. Keep `lib-shopping-list-card`: the dock
becomes the card sitting on the bar.

`BottomActionBar` itself stays. The shopping list history still uses it, and `0061`
made it the one bottom bar in the app.

Both of its actions live in the third tab afterwards (section 7). In the route table,
`getListSheetRoutes('home')` goes and `getListSheetRoutes('shopping-lists')` stays,
with a third copy under the new `current` route. Keep the existing rule that each copy
differs only in where Cancel returns to.

## 7. The third tab opens the basket being shopped

Add `shopping-lists/current`, **declared before** `shopping-lists/:generatedListId`, so
the word is not read as an id. This is the same collision that `SHEET_SEGMENT` exists
to prevent, and `routes.spec.ts` gets an assertion for it.

The screen it draws:

- With a live basket, it redirects to that basket's own URL, so the address bar names
  the basket and a reload lands on it.
- With none, it draws the empty state from the mock: the basket glyph, a title, two
  sentences, **Make my shopping list**, which opens the get sheet, and **See older
  lists**, which goes to the history.
- Its header carries the clock that used to sit beside Get shopping list on home, in
  both states, so the history is one press from the tab.

The badge on the tab is `LiveBasketBadge`: how many lines are still to get in the live
basket, or null. `data-access` writes it wherever it already knows that number, and
`platform` holds it so `ui` can read it. Null draws nothing; a number over 99 draws
`99+`.

## 8. Copy

| Key | English | Spanish |
| --- | --- | --- |
| `nav.home` | Home | Inicio |
| `nav.catalog` | Catalog | Catálogo |
| `nav.basket` | Shopping list | Lista de la compra |
| `nav.label` | Main sections | Secciones principales |
| `nav.badge` | {{count}} still to get | quedan {{count}} |
| `basket.current.empty.title` | Nothing to shop yet | Nada que comprar todavía |
| `basket.current.empty.body` | Velista makes one shopping list out of everything your groups still need. It tells you where each thing is cheapest. | Velista reúne en una lista todo lo que tus grupos necesitan y te dice dónde sale más barato. |
| `basket.current.empty.make` | Make my shopping list | Crear mi lista |
| `basket.current.empty.older` | See older lists | Ver listas anteriores |

The tab words are nouns a person would use, not features. Somebody who has never used
an app should read the row and know where each one goes.

## 9. Accessibility

- The row is a `<nav aria-label>` holding three links, in the visual order.
- The active link carries `aria-current="page"`.
- The badge's number is in the link's accessible name through `nav.badge`, never only
  as a coloured circle.
- Each target is at least 48px in both directions (`0002`, section 8).
- Focus order runs page, then bar. The bar is after the outlet in the DOM, which is
  what makes that true without a `tabindex`.

## 10. Not in this plan

- The catalog screen itself (`0093`). This plan adds the route and a placeholder that
  says the screen is coming, in one line, with no furniture.
- The setup and the tour (`0091`, `0092`), which hide the bar with the same route data
  this plan introduces.
- Remembering a scroll position or a stack per tab. Pressing a tab opens that tab's
  screen from the top, always.

## 11. Tests

- `app-nav.spec.ts`: renders three links with their words; marks exactly one active
  for each of the four URL shapes; draws no badge for null and `99+` for 140.
- `nav-chrome.spec.ts`: false for each route in section 4, false for any URL holding
  the sheet segment, false while `usable` is false, true for home, the account page and
  a zone list.
- `app-layout.spec.ts`: the bar is absent while the startup gate holds the outlet, and
  present once it releases it.
- `home-page.spec.ts`: the action bar is gone and the shopping list card is not.
- `routes.spec.ts`: `current` precedes `:generatedListId`; every route in section 4
  carries `data.chrome === 'none'` and no other route does.
- `basket-current.spec.ts`: redirects with a live basket, draws the empty state
  without one, and the clock is in the header in both.

## 12. Acceptance criteria

- [ ] The bar is drawn on home, the catalog placeholder, the shopping list, a group, a
      zone list, a line, the account, the assistant and the install screen.
- [ ] The bar is absent on the five auth routes, the front door, `join/:code`,
      `s/:secret`, for a guest, and under every open sheet.
- [ ] Exactly one tab is active on the three tab screens, and none anywhere else.
- [ ] Home has no button row, and its shopping list card sits on the bar.
- [ ] The third tab opens the live basket, or the empty state with both actions.
- [ ] The list page keeps its composer, with the bar beneath it and one safe area
      inset between them.
- [ ] `npx nx lint velista && npx nx test velista` pass, and every library touched.

## 13. Verification

```sh
npx nx test velista-ui
npx nx test velista-platform
npx nx test velista-feature-shell
npx nx test velista-feature-home
npx nx test velista-feature-shopping-lists
npx nx lint velista
npx nx build velista
```

Then serve the app on a slot and walk it: home, into a group, into a list, back out
through the bar, open a sheet, and confirm the bar is behind it.
