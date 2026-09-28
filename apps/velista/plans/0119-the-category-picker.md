> **PR:** [#528](https://github.com/IchirokuXVI/nx-portfolio/pull/528)

# 0119: the category picker

> **Mock first.** Every velista page is mocked before it is built, and there is no mock for
> this plan yet. The session that builds it draws `mocks/category-picker/` first (the page of
> parents, the page of children, the catalog tab with a category chosen, and the empty leaf),
> and stops for the user's review before any code.
>
> Needs `0118` (categories are data, and `CategoryStore`) and backend `0166` (the tree
> route and `categoryId` on the item search). Prerequisite reading: `0100` (the catalog tab,
> whose section 8 left the category chip row out on purpose), `0097` (the bar and what it is
> shown on), `0107` (the product sheet over three pages), and CLAUDE.md on going back
> (`PageNavigation.back(fallbackUrl)`).

`0100` dropped a category chip row from the catalog tab because twelve chips above a list
is most of a phone, and it said to stop and ask before adding one. With eighty leaves under
seventeen roots, a chip row is not the answer either. The answer the user chose is a picker:
a full page of the parents, a tap opens a full page of that parent's children, a tap on a
child returns to the catalog tab narrowed to it. The narrowing composes with the field and
the chain chips the tab already has.

## Brief for the agent

### Objective

Add two pages under the catalog tab, one listing the roots and one listing a root's
children, and narrow the catalog tab's list to the chosen category, composed with the search
field and the chain chip. Use the `nx-portfolio-angular-developer` skill for the Angular
work and `design-taste-frontend` for the two pages.

### Context

- **The catalog tab**: `CatalogPage` in `libs/velista/feature-catalog/src/lib/catalog-page/`,
  at route `catalog` in `libs/velista/feature-shell/src/lib/routes.ts` (around line 986),
  with `productSheetRoutes()` as its children. Its state is signals on the page (`typed`,
  `query`, `chain`, `order`, `context`), its tools row is the field, `lib-chain-chips` and
  `lib-order-pills`, and the read is `CatalogBrowseApi.browse` with `order`, `limit`,
  `query`, `soldBy`, `priceScopeId` and `cursor` (`catalog-browse-api.ts:66`).
- **The tree**: `CategoryStore` from `0118`, roots with children in `position` order,
  `byId`, `rank`, and `itemCount` per row from the wire.
- **The search**: `GET /v1/catalog/items` takes `categoryId`, a leaf or a root (backend
  `0166` section 4).
- **Pages and going back**: a page's chevron calls `PageNavigation.back(fallbackUrl)`; the
  locale guard sits on the app's parent route; `AppHistory` decides whether a pop is safe.
- **The bar** (`0097`): drawn on the three tab roots and on the screens under them that
  section 3 of that plan lists; absent under a sheet.

### Target state

1. **Two pages.** `catalog/categories` lists the roots, each row a link with the name, the
   count of products under it, and a chevron. `catalog/categories/:parentSlug` lists that
   root's children the same way, headed by the root's name, with a first row "All <root>"
   that picks the root itself. Both are pages with the app's page head (chevron, title), not
   sheets: a picker with two levels of navigation is a place, not a cover. Rows with a count
   of zero are hidden, and a root whose children are all hidden is hidden.
2. **Picking narrows the tab.** A tap on a child, or on "All <root>", navigates to the
   catalog tab with `?category=<slug>`. The tab reads the slug, resolves it through
   `CategoryStore`, sends its id as `categoryId` on the browse read, and draws the choice
   in the tools row: a chip in front of the chain chips reading the name (the root's and
   the leaf's, "Frozen · Ice cream"), with a clear control that returns to the tab with no
   parameter. The field's placeholder names the category when one is chosen, as it names
   the chain today. The choice survives typing, ordering and a chain chip, and a chain chip
   survives the choice.
3. **The way in.** The tools row gains a "Categories" control at the head of the chip row.
   With nothing chosen it reads "Categories". With a choice it is the chip of point 2, and
   tapping the chip's body reopens the children page of the chosen root, so changing the
   leaf is one tap and one page.
4. **History reads naturally.** Tab, parents, children, tab narrowed: the phone's back
   button walks that in reverse, because each step is a push. The chevron on either page
   calls `PageNavigation.back` with the catalog tab as the fallback. Clearing the chip is a
   navigation to the tab without the parameter, not a pop.
5. **The URL is the choice.** `?category=<slug>` is the one place the choice lives, so a
   shared link opens the tab narrowed, and a cold load with an unknown slug drops the
   parameter and opens the tab plain. The search text stays out of the URL (`0117`).
6. **Empty leaf.** A leaf with no products for the chosen chain draws the tab's empty state
   with a sentence naming both ("Nothing in Ice cream at Mercadona yet") and the clear chip.
7. **The bar.** Both pages are under the catalog tab and keep the bar, with the catalog tab
   lit. The mock confirms it.
8. **Access.** The pages carry the same guards as the tab (`authenticatedGuard`,
   `setupGuard`), because every catalog read is refused without an account.

### Scope

Work in `libs/velista/feature-catalog` (two new page components, the tab's tools row and
state, `catalog-context.ts` if the tree belongs there), `libs/velista/feature-shell/src/lib/routes.ts`
and its spec, `libs/velista/data-access/src/lib/catalog/catalog-browse-api.ts` and its memory
twin for `categoryId`, `libs/velista/models` for the browse query, `libs/velista/ui` only if
the row the two pages draw is worth a shared component, the locale files, and the specs of
each. Add one e2e in `apps/velista-luna-e2e` that walks tab, parents, children, narrowed
tab, clear.

Do not touch: the basket, the zone list, the product sheet, or the order pills.

### Constraints

- Every string is a key. `inLocale` for names. No `@angular/core/rxjs-interop`. `svh` only.
  Tokens, never literal colours. Follow `velista-ui-rules` for pages and focus.
- The two pages are lists of links or buttons with accessible names of "name, count", and
  the count is words, not a bare number beside a name.
- The choice never lives in a store: the URL is the state (target 5).
- Only make changes directly requested.

### Action boundaries

Stop and ask before: drawing the picker as a sheet, adding a third page, adding a category
to the product row or card, adding a count per chain, or changing `lib-chain-chips`.

### Progress evidence

The mock, then the user's review. Then per target: the files changed and the spec run. At
the end: `npx nx test` and `npx nx lint` for the touched libraries, `npx nx build velista`,
the e2e against a slot serving backend `0166`, and a walk on a phone width with the tree of
appendix A of backend `0166` loaded.

## 1. Why a page and not a sheet

A sheet covers the page it was opened from and has a URL under `sheet/` (CLAUDE.md, sheets).
It is the right shape for one decision. This picker is two decisions deep and the second
page has its own back, and a sheet over a sheet is what the rule about sheets exists to
avoid. A page also gets the bar, so a person browsing categories is still visibly in the
catalog tab.

## 2. Why the URL holds the choice

The chain chip and the order live in signals, and `0117` keeps the search text out of the
URL because a term is typed, not chosen. A category is chosen, and a chosen thing is what a
link is for: "the frozen aisle at Mercadona" is a URL somebody sends. It also gives the back
button its steps for free.

## 3. Not in this plan

- A category on the product row, card or sheet.
- Counts per chain (backend `0166` section 11).
- Sections of a shop (`0120`): the catalog tab browses chains, and a shop's aisles belong
  to the basket at that shop.
- Editing the tree: the back office (admin `0036`).
