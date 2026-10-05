> **PR:** [#623](https://github.com/IchirokuXVI/nx-portfolio/pull/623)

# 0041 The look and the frame

> First of seven plans that remodel the back office: `0041` (this one, the frame every screen
> sits in), `0042` (chains), `0043` (products), `0044` (the harvester), `0045` (shoppers),
> `0046` (the overview, the admins and the way in), `0047` (the removal sweep). Each one is a
> pull request that leaves a working app. Build them in that order.
>
> Mock: `plans/mocks/remodel/` in this app, published at
> <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>. The boards for this plan are
> `Tokens`, `Deployments`, and the chrome of every other board.

The header of the back office is two rows of links. It reserves about 180 px before the first
row of data, and more when a row wraps. On a phone the menu opens inside the header and pushes
the page down. Many screens open with a paragraph that explains why the gateway cannot answer
a question. The colors are grey, and the only accent is the color of the cluster.

This plan replaces the frame and the look. It moves no screen and changes no route.

## Brief for the agent

### Objective

Give `luna-shopper-admin` a new frame (a rail at the side on a wide screen, a bar at the bottom
on a phone, one page header), a new set of tokens and a typeface, and an info button that
replaces the paragraph above each page. Use the `nx-portfolio-angular-developer` skill, and
the `design-taste-frontend` and `antislop` skills for the look.

### Context

- **The frame today** is `libs/luna-shopper-admin/ui/src/lib/chrome/app-shell.ts`, wired by
  `feature-resource/src/lib/admin-shell-page.ts`. Sections come from `ADMIN_SECTIONS` in
  `apps/luna-shopper-admin/src/app/sections.ts` (plan `0022`).
- **Tokens** are CSS custom properties in `ui/src/lib/styles/_tokens.scss`. Two specs guard
  them: `ink-on-wash.spec.ts` and `wash-contrast.spec.ts`.
- **The compact switch** is `Viewport.compact`, `(max-width: 47.99rem)`.
- **The paragraph above a list** is `descriptor.note`, drawn by `ui/src/lib/resource/resource-list.ts`.
  Hand written pages draw their own lead paragraph.
- **Every string** is in `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Target state

1. **Rail on a wide screen.** A column 76 px wide at the left edge. It takes the color of the
   deployment (section 2), so that the operator sees at once whether this is production,
   staging or a local stack. One
   entry per section: an icon above a label. The current section has a lighter background. A
   section whose screens carry badges shows their sum as a count. At the bottom of the rail:
   the cluster label, the content language as a button that opens a menu, and the account as a
   button that opens a menu with the operator name and "Sign out". There is no top bar.
2. **Bar on a phone.** Below 48 rem the rail is a bar 58 px high, fixed at the bottom, in the
   same deployment color, with at
   most five entries. The first four sections show, and "More" opens a sheet with the other
   sections, the content language, the cluster label and "Sign out". The page reserves the
   height of the bar plus `env(safe-area-inset-bottom)`, so that the last row is reachable.
3. **One page header.** A `PageHeader` component, 52 px high on a wide screen and 48 px on a
   phone: an optional back link, the title, an optional line under the title on a phone, a slot
   for state chips, the info button, and a slot for at most two actions. On a phone the second
   and later actions go into a "More actions" menu. The header does not stick. Only the bar at
   the bottom is fixed on a phone.
4. **Tabs under the header.** A `PageTabs` component: links in one row, 40 px high (44 px on a
   phone), each with an optional count. A row that does not fit scrolls sideways and never
   wraps. Until plans `0042` to `0044` land, the screens of the current section are the tabs
   of every page in that section. This replaces the second row of the old header.
5. **The info button.** `InfoButton` plus `InfoPanel` in `ui`. The button is a circle with the
   letter i and an `aria-label` that names the subject. On a wide screen it opens a panel
   anchored to the button. On a phone it opens a sheet from the bottom. Escape and a press
   outside close it, and focus returns to the button. The content is a title, at most four
   points of at most 25 words each, and at most one caution.
6. **No paragraph above a page.** `ResourceDescriptor.note` becomes `info`
   (`{ title, points, caution? }`, all translation keys) and is shown through the info button.
   `formNote` becomes `caution` on the form and is drawn as one line with a warning icon,
   because a caution must be seen before the action. Section 3 holds the rule for which text
   goes where, and the new text for each note that exists today.
7. **Tokens.** The values in section 2 replace the palette. The accent no longer follows the
   deployment. The deployment colors the rail and the bar instead, and the sign in page shows
   the same color as a band 8 px high at its top edge. The name of the deployment is also
   written in the rail and in the "More" sheet, so that color is never the only sign.
8. **Typeface.** IBM Plex Sans (400, 500, 600) for text and IBM Plex Mono (400) for barcodes,
   keys and ids. Self hosted through `@fontsource/ibm-plex-sans` and
   `@fontsource/ibm-plex-mono`, with `font-display: swap`. Numbers in a column use
   `font-variant-numeric: tabular-nums`.
9. **Control sizes.** A control is 36 px high on a wide screen and 44 px on a phone. A text
   field is 16 px on a phone, so that iOS does not zoom.
10. **The scope mark.** A `ScopeMark` component in `ui`: four bars that rise, filled up to the
    level of the scope kind (Nationwide 1, Chain region 2, Local area 3, Single shop 4), with
    the kind as its accessible name. Plans `0042` and `0043` use it. This plan adds it to the
    price scope cell of the existing lists.

### Scope

- In: `ui/src/lib/chrome/**`, `ui/src/lib/styles/**`, new `ui/src/lib/page/**` and
  `ui/src/lib/info/**`, `ui/src/lib/resource/resource-list.ts` and `resource-form.ts` (the
  note and the form note only), `models` (the `info` and `caution` fields), every descriptor
  and hand written page that has a note or a lead today, `en.json`,
  `apps/luna-shopper-admin/src/styles.scss`, new icon components in `libs/shared/ui`.
- Out: every route, every gateway call, the content of any screen, the sign in page layout
  (it takes the new tokens and nothing else).

### Constraints

- No component library. The app has none today and this plan adds none.
- Icons are components in `libs/shared/ui`. Look in that directory before you add one. The
  mock draws its own paths, and those are not the source.
- Nothing created here imports `@angular/core/rxjs-interop`.
- `-ink` goes only on the solid color and `-on-wash` only on the wash. Extend the two contrast
  specs to the new pairs. Every text pair is 4.5 to 1 or more.
- Inline `template` and `styles`, as every component in this app has.
- The layout has three states and not two: below 48 rem (bar at the bottom), 48 rem to 72 rem
  (rail, one content column), and 72 rem and above (rail, content can split). `main` loses its
  `max-inline-size: 72rem`, because plans `0042` and `0044` split the content.
- No motion other than a 120 ms fade on the info panel and the sheets, and none under
  `prefers-reduced-motion`.

### Action boundaries

- Add the two `@fontsource` packages. Add no other dependency.
- Do not delete a translation key that a spec reads without changing the spec.
- Do not build any part of `0042`, `0043` or `0044`.

### Progress evidence

- `npx nx lint` and `npx nx test` pass for `luna-shopper-admin`, `luna-shopper-admin/ui`,
  `luna-shopper-admin/models`, `luna-shopper-admin/feature-resource` and every feature library
  whose page lost a lead paragraph.
- `npx nx build luna-shopper-admin` passes. The pull request checks do not build this app, so
  run the build yourself.
- A browser walk on a slot at 390 px, 900 px and 1360 px wide: no sideways scroll, the fixed
  chrome is 58 px on the phone and 0 px of height on a wide screen, the last row of a long list
  is reachable above the bar, the info panel opens and closes with the keyboard, and Tab
  reaches every entry of the rail with a visible focus ring. Attach the screenshots to the
  pull request.

## 1. Not in this plan

- A dark scheme. The app has one scheme and two specs that prove its contrast. A second scheme
  doubles those pairs and nobody asked for it. The tokens are named so that one can follow.
- Shoppers, Admins and Overview keep their content here and take the frame and the tokens.
  Plans `0045` and `0046` redesign them.

## 2. Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--admin-surface` | `#f3f4f1` | page ground |
| `--admin-surface-raised` | `#fcfcfa` | panels, header, fields |
| `--admin-border` | `#d9dcd6` | panel and row lines |
| `--admin-border-strong` | `#878e86` | control outlines |
| `--admin-ink` | `#14171a` | text |
| `--admin-ink-muted` | `#555c63` | second line, labels |
| `--admin-accent` | `#0b6b53` | primary button, current tab, switch on, scope mark |
| `--admin-accent-ink` | `#ffffff` | text on the accent |
| `--admin-accent-wash` | `#e3f1ec` | selected row, good state |
| `--admin-accent-on-wash` | `#085441` | text on the accent wash |
| `--admin-nav` | by deployment, below | rail and bottom bar |
| `--admin-nav-ink` | by deployment, below | entry at rest |
| `--admin-nav-current` | by deployment, below | current entry, with `#ffffff` text |
| `--admin-count` | `#fcfcfa` | count on the rail, with `--admin-ink` text |
| `--admin-waiting-wash` | `#fdf3e0` | something waits for a person |
| `--admin-waiting-on-wash` | `#7a4f05` | text on the waiting wash |
| `--admin-danger` | `#b4232a` | unchanged, with its wash and inks |
| `--admin-radius-control` | `0.375rem` | buttons, fields |
| `--admin-radius` | `0.625rem` | panels |
| `--admin-radius-state` | `0.25rem` | state labels |

`--admin-status-attention` and its wash are removed, and their uses take the waiting pair. The
chart colors do not change. The `[data-deployment]` rules set the three navigation tokens and
nothing else:

| Deployment | `--admin-nav` | `--admin-nav-current` | `--admin-nav-ink` |
| --- | --- | --- | --- |
| production | `#6e1a1f` | `#8f2a30` | `#f3d9da` |
| staging | `#6b4605` | `#8a5d0c` | `#f6e7c8` |
| development (a local stack) | `#173f5c` | `#23587d` | `#d3e3ef` |
| none of these | `#14211d` | `#24362f` | `#b9c4bf` |

Each ink is 6.5 to 1 or more on its rail. Add the four pairs to `wash-contrast.spec.ts`. The
label reads "PRODUCTION", "STAGING" or "LOCAL", dark text on `--admin-count`.

Why these: the ground is a cool grey with a little green so that the pine accent sits in it.
Pine is the one accent, and it marks what is selected and what is the main action. Amber on
the page means only "a person must decide". Red on the page means only danger. The deployment
color lives only in the navigation, which is the one part that looks the same on every screen,
so a red rail reads as "this is production" and not as an error on the page.

## 3. Which text goes where

- **Info button**: how to use the page. What a row is, what the main action does, where the
  result goes. At most four points.
- **One line under a control**: a state the operator must see to act, such as "This shop
  follows the chain's order".
- **Caution line**: an effect that is large or cannot be taken back. It stays visible.
- **Nowhere**: why the gateway has or lacks a route, and how the data is stored.

| Key today | What happens to it |
| --- | --- |
| `catalog.locations.note`, `catalog.sections.note`, `catalog.locationItems.note` | Removed in `0042`, where the chain or the shop comes from the address. Until then: the empty state says "Choose a chain to see its shops." and the like. |
| `catalog.prices.note` | Info: "One row is the price a shopper sees at one scope." "Open a row to see every price behind it, add one, or remove one." |
| `catalog.pricePolicies.note` | Info: the three points on the `Phone-Info` board. |
| `catalog.pricePolicies.formNote` | Caution: "Saving a rule works out the shown price of every product again. Expect a short wait." |
| `harvest.switch.lead` | Info on the "Runs may start" state: "A run starts only when the service is on and runs are allowed. Both are set at deploy time." "Whether one chain may be fetched is a switch in Setup." |
| `harvest.sources.lead` | Caution on the edit form: "A chain blocks a crawl that asks too fast. Raise workers and requests one step at a time, and watch the failures count." |
| `harvest.sources.osmAlways` | Stays as one line under the list. |
| `harvest.shops.lead` | Info: "One row is a shop that a source names." "Map it to one of our shops, or ignore it." "A run writes nothing for a shop that is not mapped." |
| `harvest.imports.lead` | Info: "Drop the JSON that a leaflet extractor, a person or an exported run made." Caution: "The same file is refused the second time, so do not edit a file to import it again." |
| `harvest.places.why` | Info on the card: "Discovery found this place and could not match it to a shop." "Add it to the catalog, link it to a shop we have, or reject it." |
| `harvest.postalCodes.add.lead` | Info: "The harvester looks for shops in each code you add." "A code that is not in the national table is refused, and the others are still added." |
| `brands.suggested.lead` | Info: "Brand names that sources use and that no registered brand holds. The most used come first." |
| `catalog.chainSections.says`, `catalog.productGroups.addItems.lead`, `catalog.prices.byItem.lead`, `brands.registered.spellings.says`, `harvest.places.groups.lead` | Removed. The panel title says the same. |

## 4. Decisions made

The owner settled these on 2026-10-03.

- **The bar on a phone shows the first four sections and "More".** After `0042` to `0044`
  those are Overview, Chains, Products and Harvest. Shoppers and Admins sit under "More".
- **No dark scheme.**
- **The rail takes the color of the deployment** (section 2).
- **This is not a new app** (section 6).

## 5. What this plan deletes

- The two row header: the template and styles of `app-shell.ts` that draw the top bar, the
  section row and the second row, and the "Menu" button with its `open` state.
- `ResourceDescriptor.note` and `formNote`, the `<p class="note">` of `resource-list.ts`, and
  every lead paragraph of a hand written page that section 3 lists as removed.
- The translation keys that section 3 lists as removed, and `shell.menu`.
- `--admin-status-attention` and its wash, and the accent values of the `admin-deployments`
  mixin.
- `environment-badge` in the header. The sign in page keeps it until `0046`.
- The `max-inline-size: 72rem` of `main`.

## 6. Why this is not a new app

The question was whether to build a second app and switch, or to change this one. Change this
one.

- **Most of the app does not change.** Of 261 source files, 97 are `data-access`, `models`
  and `feature-resource`, which hold the gateway calls, the wire types, the stores and the
  list and form engine. None of them draws the look. The queue pages, the run form and the
  panels hold logic that the remodel moves to a new address and does not rewrite.
- **A new app is a second deployment.** It needs a project, a port and a slot entry, a
  Dockerfile, a chart entry, a host name, a CORS origin on the gateway and a place in both
  workflows. The old app then needs all of that removed at the switch.
- **Nothing proves that two apps match.** No e2e project drives the back office. Two copies
  of 118 spec files drift apart during the weeks that both exist, and every gateway change in
  that time lands twice.
- **The seven plans already give what a new app gives.** Each one leaves a working app, the
  frame comes first so that every later screen is built in the new look, each plan lists what
  it deletes, and `0047` removes what is left.

A new app is the better choice only when the old one must stay in use, untouched, for a long
time beside the new one. One operator uses this app, and staging takes each plan as it merges.
