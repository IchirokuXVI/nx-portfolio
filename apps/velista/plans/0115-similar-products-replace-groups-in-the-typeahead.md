> **PR:** [#501](https://github.com/IchirokuXVI/nx-portfolio/pull/501)

# 0115: similar products replace groups in the typeahead

A product group is one product sold under several labels (the rule in
`libs/luna-shopper/tools/curation/groups/src/prompt.md`). A shopper takes any member of a group
and compares members only on price. Until now, groups were offered in the composer's typeahead
as cards of their own. The user wants groups reached from a product instead, as its "similar
products", with a way to change a line's product for a cheaper sibling.

This plan was written after the change was built, because the request came directly. It records
what was asked, what was built in PR #501, and the decisions taken on the way.

## What was requested

1. Groups no longer appear in the typeahead.
2. The line detail page and the product detail page show "similar products": the siblings of
   the product in its group, when the product has a group.
3. The line detail page has a button to change the line's product for one of the similar ones.
4. On the basket list, every line whose product has a group has a "change product" button.
5. On the basket list, a small mark shows on a product that is not the best price of its group.
6. No existing function is removed, for example linking a group to a line.

## What existed

- The typeahead: `libs/velista/ui/src/lib/list/suggestion-list.{ts,html}` draws group cards
  (crate icon, "Group" badge, CDK popover, member reveal). `CatalogApi.suggest` and
  `BasketApi.suggest` return groups first. The line page already dropped group rows. The list
  page and the basket page did not.
- The product detail page is the product sheet,
  `libs/velista/feature-catalog/src/lib/product-sheet/`, mounted by `productSheetRoutes()` over
  the catalog, the zone list and both baskets (plan `0107`).
- The line page: `libs/velista/feature-lists/src/lib/line-page/`. It reads its line from
  `LineStore.linesIn(listId)`, and product names from `ItemNames`, which holds whole
  `CatalogItem`s, `productGroupId` included. Product writes are
  `LineStore.updateLine(id, { itemIds })`, which replaces the whole set.
- The basket: `BasketRow.optionIds` is the union of its lines' product sets. Rows with products
  are grouped by product set, so every line of such a row holds the same set.
  `BasketProduct` did not map the wire's `productGroupId`. No basket route changes a product.
  Only `PATCH /v1/lines/:id` does.
- The gateway already serves `GET /v1/catalog/product-groups/:id/items`: every member, priced
  at the caller's scopes (`bestOffer`). No velista client called it.
- Linking a group to a line: core accepts `productGroupId` on `POST /v1/lists/:id/lines`, and
  the line page draws "From {group}" headings. The velista composer never sent the field, so
  choosing a group copied its members into `itemIds` and linked nothing.

## Decisions

- **Filter on the client.** `suggest` has no kind selector, and the same read serves other
  screens, so `productSuggestions()` in `velista/models` drops groups at the three call sites.
  The group card code in `suggestion-list` stays, unreached. Nothing about linking a group to a
  line was touched.
- **One read of a group's members**, `CatalogServiceI.groupMembers(groupId, { profileId?,
  priceScopeIds? })`, cached by `GroupMembers` per group **and** scope. A group priced at a
  basket's scopes and at a profile are different answers. It primes `ItemNames`, so a line
  changed to a sibling has its name at once.
- **Siblings compare the way catalog ranks them** (`searchOffers`): an offer with a till price
  first, then unit price, then pack price. The mark needs a strict win on a comparison both sides
  can make. A product with no price is never marked, and a tie is not a better price.
- **Change replaces in place.** On the line page, the line's products from that group are
  replaced by the chosen one, and the words, quantity and history stay. A reader who cannot edit
  the line opens the sibling's product sheet over the line page instead.
- **The basket change is offered only when the reader can write every list on the row.** The
  change is a `PATCH` on each line of the row. A change to only some lines splits the row.
  Guests get neither the button nor the mark, because every catalog read needs an account.
- **Basket siblings are priced at the basket's scopes** (`Basket.scopes`), so a row's price and
  its siblings' prices come from the same shops.
- **The mark is words in the product caption**, "cheaper option" / "otro más barato", in the
  attention colour, and it is part of the row's accessible name.
- **The UI never says "group".** The app's vocabulary calls a zone a "Group", so the copy says
  "similar products".

## Brief for the agent

### Objective

Take product groups out of the composer's typeahead and surface them as "similar products" on
the line page, the product sheet and the basket, with a change of product and a cheaper option
mark, without removing any existing function.

### Context

- Use the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- A product group is one product under several labels. Siblings are true substitutes, and only
  price separates them.
- The paths and facts under "What existed" above are the starting state.
- Frontend only. The gateway routes needed already exist, and no backend or OpenAPI change is
  needed.

### Target state

1. **Typeahead.** The zone list, basket and line page composers offer products only, through one
   helper, `productSuggestions` in `libs/velista/models/src/lib/product-group.ts`.
2. **Data.** `CatalogServiceI.groupMembers` reads `GET /v1/catalog/product-groups/:id/items` in
   `CatalogApi`, follows the cursor at most three pages of 100, and treats a 404 as no siblings.
   `CatalogMemory` implements it too. `GroupMembers` in data-access caches the answer and is in
   `VELISTA_DATA_ACCESS_PROVIDERS`. `fakeGroupMembers` / `provideFakeGroupMembers` are in
   `store-doubles.ts`. `BasketProduct.productGroupId` is mapped from the wire.
3. **A shared list.** `lib-similar-products` (`libs/velista/ui/src/lib/catalog/`) draws the
   siblings with `lib-product-row`, cheapest first, with the unit price as the caption. It draws
   nothing while loading or when there are no siblings, and one muted line when the read fails.
   `ProductRow` gains an optional `verb` pill ("Change"), so the row stays one button with one
   accessible name.
4. **Line page.** A "Similar products" section for each group the line's products belong to,
   headed "Similar to {name}" when there are several. A writer's tap replaces the product. A
   reader's tap opens `…/lines/:lineId/sheet/products/:itemId`. The page gets the
   `<router-outlet />` its child sheets need.
5. **Product sheet.** The sheet lists the siblings. A tap opens the sibling in the same sheet with
   `replaceUrl`. The item id follows the route, and focus returns to the panel through the new
   `SheetShell.focusPanel()`, so Escape keeps working.
6. **Basket.** `BasketRow` has `canSwap` and `groupCheaper` inputs, a `swap` output, a swap icon
   button beside the body, and the mark in the product caption. `BasketPage` decides both flags
   and reads the members of every row's group once at the basket's scopes. The change sheet,
   `SwapSheet` at `rows/:rowKey/swap` in `basketSheetRoutes()`, lists the siblings, `PATCH`es
   every line of the row with `swappedItemIds`, refreshes the basket and closes. It stays open
   with a message when a write fails.

### Scope

`libs/velista/models`, `libs/velista/data-access`, `libs/velista/ui` (catalog row, similar
products, sheet shell, swap icon, both translation files), `libs/velista/feature-lists` (line page,
list page), `libs/velista/feature-catalog` (product sheet), `libs/velista/feature-shopping-lists`
(basket page, basket row, swap sheet), and `libs/velista/feature-shell` (routes and their spec).

### Constraints

- Only make changes directly requested.
- Never remove the group card code or anything that links a group to a line.
- Copy for people not at home with apps. Never the word "group" in the UI.
- No backend change, no migration, no new dependency.

### Action boundaries

Stop and ask before:

- changing a gateway route or DTO
- offering the basket change to a reader who cannot write every list on the row
- rewriting a line's text when its product changes

### Progress evidence

- `npx nx run-many -t lint,test -p velista/models velista/data-access velista/ui
  velista/feature-lists velista/feature-shopping-lists velista/feature-catalog
  velista/feature-shell` green, and `npx nx build velista --configuration=production` green with
  no budget warning.
- Specs: `product-group.spec`, `group-members.spec`, `swap.spec`, `swap-sheet.spec`,
  `basket-row-swap.spec`, and the new cases in the product sheet, line page and basket page
  specs. `routes.spec` counts the three new sheet routes (45 sheets, 10 over a basket).
- A browser walk at 390x844 against a backend with a priced group: the siblings on the line page,
  a change there, the typeahead with no group cards, the basket mark, the change sheet and its
  write, and the product sheet opening a sibling and still closing on Escape.

## Known gaps

- The line page is blank on a cold load of its own URL, because it reads the lines the list page
  loaded. That was true before this plan.
- The Spanish mark wraps to a second caption line next to a long product name at 390 px, as the
  existing "cheaper at" mark does.
- The velista composer still never sends `productGroupId`, so no screen in velista links a group
  to a line. The backend support and the "From {group}" headings are unchanged.
