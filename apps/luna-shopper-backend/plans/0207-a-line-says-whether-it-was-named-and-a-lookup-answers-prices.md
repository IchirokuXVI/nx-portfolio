> **PR:** [#706](https://github.com/IchirokuXVI/nx-portfolio/pull/706)

# 0207: a line says whether it was named, and a lookup answers prices

> Asked for by the owner on 2026-10-11, for the rows of a list in velista: "List lines will
> show always two lines: user assigned label, [and] product name, brand, format, price."
> And: "When a line comes directly from a product, its user label IS NOT filled
> automatically, only the product. When displaying the line, if it doesn't have a user
> label, the product name is shown instead."
>
> This plan is the backend half. Velista plan `0144` reads the flag of section 1. Velista
> plan `0145` reads the prices of section 2. The two sections do not depend on each other.
>
> **Two decisions in this plan are mine and wait for the owner.** He did not answer what
> happens to the lines that exist today. Section 1.4 states what this plan does and why.
> The name of the flag is also mine.
>
> Prerequisite reading: plan `0199` (the favourite and the supermarket of a line), plan
> `0148` (the line that is already there), plan `0049` section 3 (why a product read is not
> scoped), `core/src/app/entities/list-line.entity.ts`, `core/src/app/lists/line.service.ts`
> (`add`, `addMany`, `applyLineEdit`, `applyRename`), `core/src/app/lists/line-content.ts`,
> `core/src/app/lists/list.mappers.ts`, `gateway/src/app/lists/list.dto.ts`,
> `gateway/src/app/baskets/basket.dto.ts`,
> `gateway/src/app/catalog/catalog.controller.ts` (`lookup`),
> `gateway/src/app/catalog/catalog-suggest.service.ts` and
> `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts`.

A line has one name, `content`, and the server reads it in many places. A line made from a
product gets the name of that product as its `content`, and nothing records that no person
typed it. This plan records it. It also lets one request ask the prices of many products.

## Review of 2026-10-11: settle these before you build

A review of pull request #696 checked this plan against the code on `dev`. Where this
section and a later section disagree, this section is right. The design of section 2
still works: `GetItemsRequest` takes `priceScopeIds` and `offers: 'all'` today.

1. **"The suggest read asks the same message" in section 2 is false.**
   `catalog-suggest.service.ts` sends `ITEM_PATTERNS.search` and `searchOffers`, not
   `getMany`.
2. **"Its best offer and the price at each chain" for the browse read is false.**
   `CatalogItemsController.search` sends no `offers`, so the browse read answers
   `bestOffer` only.
3. **The chain of a price is not in the answer.** `ItemOfferView` carries `priceScopeId`
   and no chain, and `GetItemsResult` is `{ items }` only. Velista `0145` section 2 needs
   the prices at the chain of a line. State whether the lookup answers the chain of each
   scope or the client reads the browse context for it.
4. **Section 1.2 says "no products of its own and no products of a group".**
   `LineView.groupItemIds` is the subset of `itemIds` that the group put there. The rule
   is one test: `itemIds` is empty.
5. **The bound is `ITEM_LOOKUP_LIMITS.maxIds`, which is 500.** `ITEM_LOOKUP_MAX_IDS` is
   the name in velista. The evidence measures 100 ids, while one request can carry 500.
   Measure 500 too.
6. **The scope lists `admin-edit.dto.ts`**, while the plan says the edit of an operator
   sends no flag. Leave that file alone unless the build finds a reason.

## Brief for the agent

### Objective

Add one flag to a line that says whether a person named it, carry it on every read and
write of a line, and let `POST /v1/catalog/items/lookup` answer prices at the scopes of the
caller.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **`list_lines.content` is `varchar NOT NULL`** (`list-line.entity.ts:59`). Core does no
  check of its length. The gateway DTOs do: 1 to 400 characters on the list routes
  (`list.dto.ts:139`, `:233`) and 1 to 500 on the basket routes (`basket.dto.ts:199`,
  `:227`).
- **A line made from a product gets the product name from the client.** Velista sends
  `content` (the name in the language of the reader) and `itemIds` to
  `POST /v1/lists/:id/lines`. Nothing on the row says where the name came from.
- **Core reads `content` for logic in many places**: the identity of an add
  (`lineIdentities`, `line-content.ts:71`), the collision of a rename (`findMergeTarget`,
  `line.service.ts:1237`), the merge key of a basket row (`line-dedup.ts:40`), the name of
  a basket row (`basket-rows.ts:439`), the order a shop is walked in
  (`basket-order.service.ts:130`), the change log (`line-change.recorder.ts`), the purchase
  reads (`purchases.sql.ts:398`) and the admin reads. The assistant service matches a line
  by its `content` (`assistant/src/app/assistant/tools.ts:1263`).
- **The change log cannot say which lines a person renamed.** Its rows are removed after
  thirty days, and none exist from before plan `0138`.
- **`LineView` is the wire shape of a line** (`list.messages.ts:254`), and every realtime
  event of a line carries the whole view.
- **`POST /v1/catalog/items/lookup` sends only `ids`** to `item.getMany`
  (`catalog.controller.ts:571`). It answers no price. The suggest read
  (`catalog-suggest.service.ts`) asks the same message with scopes and `offers: 'all'`.
- **One price read exists for a known product**, `GET /v1/catalog/items/:id/offers`. It
  answers one product for each request.

### Target state

1. A line carries `named`, a boolean (section 1).
2. Every route that makes or edits a line accepts it, and the server keeps the two rules of
   section 1.2.
3. `LineView` carries it, and so does every event that carries a view.
4. The lookup answers prices when the request asks for them (section 2).

### Scope

- `apps/luna-shopper-backend/core/src/app/entities/list-line.entity.ts` and one new
  migration in `core/src/app/db/migrations`.
- `apps/luna-shopper-backend/core/src/app/lists`: `line.service.ts` (the adds and the
  edit), `list.mappers.ts`, their specs.
- `apps/luna-shopper-backend/core/src/app/baskets/basket-line-add.service.ts`: it passes
  the flag on.
- `apps/luna-shopper-backend/gateway/src/app/lists/list.dto.ts`,
  `gateway/src/app/baskets/basket.dto.ts`, `gateway/src/app/admin/admin-edit.dto.ts`.
- `apps/luna-shopper-backend/gateway/src/app/catalog`: the lookup DTO and the route.
- `libs/luna-shopper/contracts`: `LineView`, the add and the update requests, the basket
  add request, the lookup request, and their schemas.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, both regenerated.

### Constraints

- **`content` stays required, and nothing that reads it changes.** The flag is a fact
  beside the name. It is not a second name.
- **No line is left with no name to show.** A line with no product is always named.
- **A write that sends `content` and no flag means a person typed it.** The assistant, the
  basket row rename, the operator edit and every older client then keep working with no
  change.
- **The migration writes no row a person wrote.** It adds a column with a default.
- **The lookup stays one read for many ids**, with the bound it has today
  (`ITEM_LOOKUP_MAX_IDS`).
- **`openapi.json` and the wire types are generated output.** Run both targets and commit
  the diffs.

### Action boundaries

- Do not make `content` nullable, and do not add a second text column.
- Do not change how lines merge, how a basket row is named, or what the assistant reads.
- Do not build a velista plan.
- Stop and ask before you add a second column or a table.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway`
  pass.
- The integration specs of the add, the batch add, the edit and the basket add run on a
  slot against a real Postgres, with the cases of section 3.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.
- The pull request states the time of one lookup of 100 ids with prices, measured on a
  slot with a realistic catalog.

## 1. The flag

### 1.1 The column

`list_lines.named`, `boolean NOT NULL DEFAULT true`.

- `true`: a person typed the name of this line.
- `false`: the name is the name of a product, written when the line was made. No person
  chose it.

### 1.2 The two rules the server keeps

1. **A line with no product is named.** A write that leaves a line with no products of its
   own and no products of a group sets `named` to `true`, whatever the request says. Its
   `content` does not change.
2. **A write of `content` with no flag names the line.** `named` becomes `true`.

### 1.3 The writes

- **`POST /v1/lists/:id/lines`** and each item of **`POST /v1/lists/:id/lines/batch`**
  accept an optional `named`. The default is `true`. `false` is kept only when the line
  holds a product (rule 1).
- **`POST /v1/baskets/:id/lines`** accepts the same field and hands it to
  `LineService.add`.
- **An add that raises a line that is already there** (plan `0148`) leaves the flag of
  that line as it is.
- **`PATCH /v1/lines/:id`** accepts an optional `named`.
  - `content` alone: rule 2.
  - `named: false` with `content`: the name is taken away. The client sends the name of a
    product as `content`. The collision rule of a rename applies as it does today, with
    `line_merge_required` and `confirmMerge`.
  - `named: false` alone: the flag changes and the name stays.
  - `itemIds: []` on a line that is not named: rule 1.
- **A rename that merges** keeps the flag of the line that survives, and then applies the
  rule of the write that caused it.
- **The basket row rename and the operator edit** send `content` and no flag. Rule 2
  covers them.
- **`LineMergeService.merge`**: the survivor is named when the survivor or the line it
  takes in is named.

### 1.4 The lines that exist today

The migration gives every line `named = true`. Nothing else is written.

A line that was made from a product before this plan then says it was named, and its name
is the name of its product. The server cannot tell these lines from the lines a person
renamed: the change log does not go back far enough, and the catalog is in another
database. Velista plan `0144` section 2 treats such a line as not named when its name is
the name of one of its products. That is a rule of the screen, and it changes no data.

The other choice is a release task that compares each name with the catalog and clears the
flag. It changes rows on a guess, so this plan does not take it. **The owner decides.**

### 1.5 The read

`LineView` gains `named: boolean`, required. `toLineView` maps it. `ItemLineView`, the
basket row view and the purchase row do not change.

## 2. Prices in the lookup

`POST /v1/catalog/items/lookup` accepts an optional `prices: boolean`. The default is
`false`, and the answer is then what it is today.

With `prices: true`:

- The gateway resolves the price scopes of the default profile of the caller, the way the
  browse read (`GET /v1/catalog/items`) does with no selector.
- It asks `item.getMany` with those scopes and `offers: 'all'`, the way the suggest read
  does.
- Each item of the answer carries what an item of the browse read carries about prices:
  its best offer and the price at each chain.
- An item with no price at those scopes is still in the answer, with no offer. A caller
  with no scope gets every item with no offer. Neither case is an error.
- The read is still not gated by membership of a list. It answers products, and the
  request names them.

The request takes no scope and no postal code. A reader sees the prices of the profile
they shop with, which is what the catalog tab shows them.

## 3. Tests

- The add: the default, `named: false` with a product, `named: false` with no product
  (kept as `true`), an add that raises a line.
- The batch add: the same for each item.
- The basket add: the flag reaches the line.
- The edit: `content` alone names the line, `named: false` with `content` and a collision
  asks for the merge, `named: false` alone, `itemIds: []` on a line that is not named, a
  rename that merges.
- The migration: up and down, on a table with rows.
- The lookup: with and without `prices`, an item with no price, a caller with no scope,
  the bound on the ids.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 4. Not in this plan

- **A name that follows the product.** The `content` of a line that is not named is the
  name the product had when the line was made, in the language of the person who made it.
  It does not change when the products of the line change. The basket and the assistant
  read it as they do today. Backend plan `0201` makes a basket row a product, which removes
  the case from the basket.
- **The assistant.** It names the lines it makes, because a person said the words.
- **A release task for the old lines** (section 1.4).
