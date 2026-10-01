# 0130: one header for every page

> Mock: none yet. **The mock is the first step of this plan, and no code starts before it is
> reviewed** (section 9). A new folder `mocks/header/` draws the header on every page, and the
> existing folders that draw an old header are redrawn.
>
> Prerequisite reading: `0002` section 6 (where the display face is allowed), `0037` and `0051`
> section 3 (the two title steps this plan replaces with one), `0097` and `0106` (the bar at
> the bottom, and the document that does not scroll), `0111` (no back chevron on a basket
> page), `0124` (the supermarket picker page) and the back rule in `CLAUDE.md`.

Every page in velista draws its own header. Some put the brand bar on top and a back chevron
on a row of its own under it, with the title on a third row. Some draw a bar with a border,
some draw a head with none. The title is `2xl` on one page and `xl` on the next, in the
display face here and in the system face there. On the list page the header changes height
when the list arrives.

This plan gives the app **one** header. It is the home page's header, and every page draws
it. Only three things differ from page to page: the title, whether the left end holds a back
button or an icon, and the quick actions at the right.

## Brief for the agent

### Objective

Build one `PageHeader` component in `libs/velista/ui`, draw it on every page inside
`AppLayout`, and delete every header a page draws for itself. Use the
`nx-portfolio-angular-developer` skill, and `design-taste-frontend` for the mock and for the
places where content moves out of a header (the group page and the list page).

### Context

- **There is no shared page header today.** `lib-app-bar` (`libs/velista/ui/src/lib/home/app-bar.*`)
  is the brand bar: the mark, the word Velista, the assistant button and the account button.
  Each page includes it in its own template. `AppLayout` draws no top header, only the outlet
  and the bottom `lib-app-nav`.
- **Pages that draw the brand bar**: home, the group page (`zones/:zoneId`), members, the
  list page, account, profiles, the account's supermarkets page and the landing page.
- **The home bar, which is the base** (`app-bar.scss`): a flex row,
  `padding: var(--app-space-4) var(--app-space-5) var(--app-space-3)`, a bottom border of
  `1px solid var(--app-border-subtle)`, actions of `--app-touch-target` with a glyph of
  `--app-icon-md`. The word is the display face at `--app-text-2xl`, weight 400, with
  `--app-tracking-wordmark`. It has no explicit height and no safe area inset. It sits outside
  the scroller (`home-page.scss`), so it never scrolls away.
- **Four copies of one back button.** `@mixin back` is repeated in `_account-page.scss`,
  `_zone-page.scss`, `_list-page.scss` and `_install-page.scss`, and again in
  `feature-catalog/_picker-page.scss` and `feature-shop-map/_shop-map.scss`. On the account,
  group, members and list pages the back button and the title are **inside** the scrolling
  `main`, so they scroll away and only the brand bar stays.
- **Two content headers**: `lib-group-header` (`ui/src/lib/zone/`) and `lib-list-header`
  (`ui/src/lib/list/`). `lib-list-tools` (`ui/src/lib/list/`) holds the filter button and is
  shared by the list page and the basket page.
- **The loading states** come from `select-group-state.ts` and `select-list-state.ts`. On a
  cold arrival the group page draws no group header at all, and the list page draws a grey
  block where the name will be.
- **Back** is `PageNavigation.back(fallbackUrl)` (`libs/velista/platform`). The rule in
  `CLAUDE.md` stays as it is: every back control names a fallback.
- **Icons** are in `libs/velista/ui/src/lib/icons/icons.ts`. There is a `sliders` icon, which
  the walks page already uses for settings, and no gear. There is `filter`, `home`,
  `basket`, `product`, `store`, `person` and `clock`.
- **Copy** is in `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- **Token rule**: `token-hygiene.spec.ts` rejects raw pixels in a component. A new size is a
  semantic token in `libs/velista/ui/src/lib/styles/_semantic.scss`.

### Target state

Sections 1 to 8 below. In short:

1. `PageHeader` exists, with one height, one title style and a bottom border.
2. Every page inside `AppLayout` draws it, outside its scroller.
3. The brand bar's content (the word, the assistant, the account) shows on home only.
4. The group page and the list page keep everything they showed, in new places.
5. A spec fails when a page draws a header of its own.

### Scope

In: `libs/velista/ui` (the new component, the tokens, the two content headers, the list
tools), every `feature-*` page listed in section 4, the i18n files, the mocks, and the e2e
selectors that the moved controls break.

Out: the pages outside `AppLayout`'s signed in chrome (section 8), the bottom bar, every
sheet, and any change to what a quick action does.

### Constraints

- Rule N1: the product name stays a translation value. `PageHeader` takes a title string and
  never names the product.
- Nothing created here imports `@angular/core/rxjs-interop`.
- No raw pixels. No `dvh` or `lvh`.
- A back control calls `PageNavigation.back(fallbackUrl)` with the fallback the page names
  today. `PageHeader` emits, and the page decides where back goes.
- `visually-hidden` is not a global class. Define it in the new stylesheet from the mixin.
- Do not move a quick action into a menu or remove one, except where a section below says so.

### Action boundaries

- Build the mock first, publish it, and stop for review. Do not write code against an
  unreviewed mock.
- Do not change `0002`, `0037` or `0051` beyond the notes that section 7 names.
- If a page cannot fit its actions beside the title at 390px, do not shrink the title on
  that page. Say so and stop: section 6 names the one case known today.

### Progress evidence

- `npx nx build velista` passes (only the build type checks templates).
- `npx nx affected -t lint test` passes, with the new guard spec in it.
- A browser walk through the shell and through velista's own origin, on a slot, over every
  page in section 4: the header's box is the same height on each, the title does not move
  when the data arrives, and no header scrolls away. Record the measured height.
- `velista-luna-e2e` passes against the slot.

## 1. The rules

These are rules H1 to H6. No other plan uses the letter H.

- **H1. One header, one size.** Every page draws `PageHeader`. Its block size comes from one
  token, `--app-header-height`, and the top safe area inset is added to it as padding. A page
  cannot make it taller or shorter.
- **H2. One title.** One line, cut with an ellipsis. One face, one size, one weight and one
  tracking, which are the home header's today: the display face, `--app-text-2xl`, weight
  400, `--app-tracking-wordmark`. The title is the page's `h1`.
- **H3. Always a bottom border.** `1px solid var(--app-border-subtle)`. There is no input to
  turn it off.
- **H4. The left end holds a back button or an icon, never neither and never both.** A page
  with a way back draws the chevron. A page with none draws an icon that names the page.
- **H5. The right end holds quick actions.** Each one is a button of `--app-touch-target`.
  An action that is not ready is absent, and its absence does not change the header's height.
- **H6. The header never loads.** While a page loads, the header has its final height and a
  real title: the app's word for the kind of page (Group, List). It never draws a grey block
  and it is never absent.

One consequence of H1 and H2 together: a header holds **only** a title. A subtitle, a
progress line, a logo, a role chip or a count is page content and goes below the header.

## 2. The component

`PageHeader`, selector `lib-page-header`, in `libs/velista/ui/src/lib/layout/`, exported from
the library's index.

| Part    | How a page states it                                                                 |
| ------- | ------------------------------------------------------------------------------------ |
| Title   | `title` input, a string that is already translated                                   |
| Back    | `backLabel` input. When it is set, the chevron draws and `back` emits on a press     |
| Icon    | a `[pageHeaderIcon]` slot, drawn only when `backLabel` is not set                    |
| Actions | a `[pageHeaderActions]` slot at the right                                            |
| Close   | `leading="close"` draws the X in the back position, for the two pages that use it today |

The markup is a `<header>` with the left control, the `h1`, and the actions. The title takes
the space that is left (`flex: 1 1 auto; min-inline-size: 0`).

Tokens, in `_semantic.scss`:

- `--app-header-height`: the home bar's height today, which is the touch target plus its
  block padding (44px, 12px and 8px, so 64px). Measure the home bar in a browser before you
  fix the value, and write the measured number.
- The header's inline padding is `--app-space-5` at both ends, as on home. The back button
  keeps the negative start margin its mixin has today, so the chevron's glyph lines up with
  the icon on a page that has no back.

The header is `flex: none` and sits **outside** the page's scroller, in every page, as on
home. It is not `position: sticky`. Top safe area: `padding-block-start` adds
`var(--app-safe-top)`, which the basket and shop map bars do today and the home bar does not.

Delete the six copies of `@mixin back` and the `bar`, `head` and `title` mixins that only a
header used, once no page uses them.

## 3. The brand header is home's

The word Velista, the assistant button and the account button show **on the home page only**.

- Home draws `PageHeader` with the brand mark in the icon slot, the `app-title` value as the
  title, and three actions: the offline mark, the assistant and the account. Its look does
  not change. The assistant button keeps `libTourAnchor="assistant"`.
- The group page, members, the list page, account, profiles and the account's supermarkets
  page lose the brand bar. Their own header takes its place, so each of them gets shorter by
  one row.
- `lib-app-bar` stays for the landing page only, which is signed out and outside this plan.
  Remove its signed in branch if nothing else reads it.
- The offline mark (`connection.notLive`) was on six pages through the brand bar. It stays on
  home. The list page keeps its own stale notice in the content, and the group page keeps
  `zone.detail.stale`, so no page loses the only sign that it is not live.

A person on a list page now reaches the assistant and the account through home. This is
what was asked for, and the brief says the brand header can return to other pages later, so
`PageHeader` must not make that hard: the three actions are ordinary content in the actions
slot.

## 4. Every page

"Icon" is the page's icon when it has no back. A tab's icon is the one its tab in the bottom
bar shows.

| Page | Left | Title | Actions |
| --- | --- | --- | --- |
| `home` | brand mark | Velista (`app-title`) | offline mark, assistant, account |
| `zones/:zoneId` | back | the group's name. **Group** while it loads | none |
| `zones/:zoneId/members` | back | `zone.members.title`, else Members | none |
| `zones/:zoneId/lists/:listId` | back | the list's name. **List** while it loads | filter, list settings (section 5) |
| `.../lines/:lineId` | back | the line's text. **Product** while it loads | none |
| `account` | back | Your account | none |
| `account/profiles` | back | Shopping profiles | none |
| `account/profiles/:id/supermarkets` | back | Supermarkets | none |
| `assistant` | back | Assistant | none |
| `catalog` | catalog tab icon | Catalog | none (section 6) |
| `catalog/categories` | back | Categories | none |
| `catalog/categories/:parentSlug` | back | the category's name. **Categories** while it loads | none |
| `catalog/supermarket` | back | Supermarket | Near me |
| `catalog/supermarket/:supermarketId` | back | the chain's name. **Supermarket** while it loads | none |
| `shopping-lists/current` | basket tab icon | Shopping list | history |
| `shopping-lists/live`, `/:basketId` | basket tab icon | as today | section 6 |
| `shopping-lists` (history) | back | Your shopping lists | none |
| `shops/:locationId` | back | the shop's name. **Shop** while it loads | none |
| `shops/:locationId/map` | back | Where things are | Walks |
| `shops/:locationId/walks` | back | Walks | mapping settings |
| `.../walks/settings`, `.../:walkId/settings` | back | as today | none |
| `.../walks/:walkId` | back | the walk's name. **Walk** while it loads | the ellipsis |
| `.../walks/:walkId/rewind` | close | as today | none |
| `.../walks/:walkId/edit` | back | the walk's name | the status pill, Done |
| `.../walks/:walkId/record` | close, or back, as today | as today | the status pill, Stop |
| `install` | back | as today | none |

Notes on the rows:

- **Account, profiles, supermarkets, install.** The title moves up beside the back button.
  Today it sits on a row of its own under it. On install the brand mark between the two
  goes into the content or goes away, and the mock decides.
- **The picker page (`catalog/supermarket`).** The title "Supermarket" and the Near me
  button both move up into the header row with the back button. Near me is the page's quick
  action. On a chain's page the chain's logo and the shop count leave the header and become
  the first line of the content.
- **The line page** is drawn only when the line arrives, so today it shows nothing while it
  loads. Draw the header first, by H6.
- **Shop map pages.** Their bars already have a back button and a border. They take
  `PageHeader`, and each subtitle (the chain, the walk's status) becomes the first line of
  the content. The loading titles that are sentences today ("Loading the shop") become the
  kind's word, and the sentence moves to the content.
- **Text actions.** Done, Stop and Walks are text buttons today. They stay text, in the
  actions slot, at the touch target's height.

New copy, in both files: a word for the kind of page where the title is the reader's own
text. `zone.detail.title` (Group, Grupo), `list.header.title` (List, Lista), and the same
for a product line, a shop and a walk. Reuse a key when one already says the word.

## 5. The two pages whose content moves

### 5.1 The group page

- The group's name is the header's title, beside the back chevron.
- The initial tile is removed. Nothing replaces it.
- The role and the members count need a new place, and the mock decides between these two.
  The first is the recommendation:
  1. **In the Members row.** The Members row in the actions card is where a person goes to
     see members, so it shows the count as its value ("Members", then "5", then the
     chevron). The role chip sits at the start of the presence line, which becomes the
     first line of the content.
  2. **One quiet line** as the first line of the content: the role chip, then the count,
     then the presence row under it.
- `lib-group-header` loses its `identity` block and keeps the presence row, the stale notice
  and the actions card. Rename it if what is left is no longer a header.
- While the group loads, the title is Group and the content is the row skeleton, as today.

### 5.2 The list page

- The list's name is the header's title, beside the back chevron.
- **List settings becomes an icon button** in the header's actions: the `sliders` icon, which
  is what the walks page uses for settings, with `list.settings.title` as its accessible
  name. It shows under the same condition as today (`canManage`, and not while reordering).
  Draw a gear in the mock beside it if the sliders glyph does not read as settings, and add
  the gear to `icons.ts` only if the review picks it.
- **The filter button moves into the header's actions**, with its count badge and its
  accessible names (`basket.view.open`, `basket.view.openCount`). It shows under the
  condition the tools row has today.
- `lib-list-tools` keeps its lead content and its `[listToolsBelow]` slot. It gets an input
  that leaves out its own filter button, because the basket page still uses that button in
  the row (section 6). On the list page, do not draw the row when nothing is left in it.
- The "in {{group}}" line, the progress line, the progress bar, the viewers and the stale
  notice stay, as the first block of the content. `lib-list-header` loses the name and the
  settings button.
- While the list loads on a cold arrival, the title is List. `span.name-skeleton` goes. This
  is the defect named in the brief: the header's height and the title's size must be the
  same before and after the list arrives.

## 6. Two things the mock has to settle

1. **The basket page's actions.** It has no back button (`0111`), a history button at the
   left, and up to four icon buttons at the right (map, people, share, finish). By H4 the
   left end takes the basket icon, so history moves to the right and makes five. Five
   targets, the icon and the padding leave about 100px for the title at 390px. The mock
   draws this page and the review decides which actions stay in the header. The
   recommendation is history, share and finish in the header, and map and people as the
   first row of the content. Until that is decided, the basket page takes the new header
   with its actions as they are, history included at the right.
2. **The catalog's "near {{code}}" text.** It is a quiet text at the right of the head today.
   It is not an action, so by H5 it leaves the header and joins the tools row under it.

## 7. What this changes in earlier plans

- `0002` section 6 allows the display face in three places and says everything else signed
  in uses the system stack. The code left that rule some time ago. This plan replaces it for
  headers: **every page title is set as the home title is.** Add one line to `0002` section 6
  that points here.
- `0051` section 3 gave a title that is the reader's own text a smaller step (`xl`, no
  wordmark tracking). H2 removes that step. Add one line to `0051` that points here. The
  ellipsis rule from `0051` stays.
- The bottom bar's mock uses the names N1 and N2 for its own rules, which collide with
  `0001`. This plan does not fix that. It only avoids a third collision by using H.

## 8. Pages outside this plan

The landing page, `auth/*`, `setup/*`, `join/:code`, `s/:secret`, the not found page and
`lab/walk/*` do not take `PageHeader`. They are drawn before a person is inside the app or
outside its chrome: they have no bottom bar, and most of them draw the wordmark and put
their title in the body. Making them match is a different decision about what the first
screens look like, and it is not asked for here. If the review of the mock wants them in,
that is a second plan.

## 9. The mocks

The mock comes first, and **every mock that draws an old header must be updated** so that
the folders keep describing the app.

1. **A new folder, `mocks/header/`**, drawn on Day at 390 by 844:
   - one artboard that stacks the header of every page in section 4, so the height and the
     title can be compared by eye
   - the group page, loaded and loading, with both placements from section 5.1. There is no
     mock of the group page or the members page today, so this is their first
   - the list page, loaded and loading, with the two icon actions and the count badge
   - the account page and the picker page with Near me in the header
   - the basket page with five actions, and with the recommended three
   - a long title beside two actions, to show the ellipsis
   - notes that state H1 to H6 and the two open points in section 6
2. **Redraw the header in the existing folders.** The artboards that draw one today:
   - the brand bar outside home: `assistant/AppBar`, `nav/Tabs`, `nav/Rules`,
     `shopping-lists/Home`, `shopping-lists/HomeNoList`
   - account: `account/Account`, `account/AccountGuest`, `profiles/Account`,
     `profiles/Profile`, `install/Account`, `install/Install`
   - the picker and Near me: `shop-picker/Catalog`, `CatalogChain`, `CatalogShop`, `Picker`,
     `PickerNear`, `PickerSearch`
   - the list: `list/List`, `list/ListSettings`, `list/ListStates`, `one-field/Main`
   - the basket: `basket/Basket`, `basket-filter/Tools`, `one-field/Basket*`
   - the rest: `catalog/Browse`, `category-picker/Parents` and `Children`,
     `assistant/Panel`, `line/LinePage`, `shopping-lists/History`, and the `shop-map` boards
     with their Night twins

   Search every folder for a header before you trust this list. The sheets that draw Near me
   in their own title row (`buying-at/*`, `shop-picker/Basket`) are sheets, not pages, and do
   not change.
3. Run `node apps/velista/plans/mocks/build-index.mjs <folder>` for each folder you touch and
   publish each `index.html` to that folder's existing URL. Never edit an `index.html` by
   hand. Add the `header/` row to `mocks/README.md`. `shop-map/` is published as a Design
   canvas and follows its own steps in that README.
4. Stop for review. Write the review's answers to section 5.1 and section 6 into this plan
   before any code.

## 10. Build order

1. The mocks (section 9), then the review.
2. The token and `PageHeader`, with its spec: the back and icon rule, the `h1`, the border,
   and the two slots.
3. Home, then the six pages that lose the brand bar.
4. The group page and the list page (section 5), with `select-group-state` and
   `select-list-state` giving the header a title in every state.
5. Every other page in section 4.
6. Delete the old mixins, the unused parts of the two content headers and the unused
   branch of `lib-app-bar`.
7. **The guard spec**, beside `no-unguarded-history-back.spec.ts` and built the same way. It
   scans the velista scope and the app, and fails with the file's name when:
   - a page template inside `AppLayout` has an `h1` or a `<header>` outside `PageHeader`
   - `lib-app-bar` appears anywhere but the landing page
   - a routed page inside `AppLayout` has no `lib-page-header`
8. The e2e. Search `apps/velista-e2e` and `apps/velista-luna-e2e` for `lib-app-bar`,
   `.header-action`, `lib-list-tools`, the list settings text and the tour's `assistant`
   anchor, and fix each selector. The tour (`0099`) points at the assistant button, which is
   now on home only: walk the tour and make sure that no card points at it from another
   page.
