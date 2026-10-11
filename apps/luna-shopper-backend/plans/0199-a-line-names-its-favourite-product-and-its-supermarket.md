# 0199: a line names its favourite product and its supermarket

> Asked for by the owner on 2026-10-11, with the build of velista plan `0135`: "add an
> option to select your preferred chain for that product. No shop, just chain" and "line
> products can be set as favorite, only one product can be set as favorite for a line".
> Velista `0135` sections 3.1 and 3.2 are the screens. This plan is the two fields they
> write.
>
> Prerequisite reading: velista `0135` sections 3, 3.1, 3.2 and 14, plan `0048` (a line
> holds a set of products), plan `0070` (a line follows a product group, and the sync that
> changes its set), plan `0076` section 3 (what a writer may change on an approved line),
> plan `0112` (a rename that merges two lines), and
> `core/src/app/entities/list-line.entity.ts`, `core/src/app/lists/line.service.ts`,
> `line-merge.service.ts`, `product-group-sync.service.ts`, `list.mappers.ts`,
> `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts`,
> `gateway/src/app/lists/list.dto.ts` and `list.controller.ts`.

A line holds a set of products and nothing says which of them the household wants, or
where it buys the line. This plan adds two fields to a line: the one product that is the
favourite, and the one supermarket (a chain, never a shop) that the line is bought at.

## Brief for the agent

### Objective

Add `favoriteItemId` and `preferredSupermarketId` to a line: one migration, the entity,
`LineView`, the update request, the gateway DTO, the rules of section 2, their specs, and
the regenerated `openapi.json` and admin wire types.

### Context

Every statement below was read on `dev` at `44f6b1da`. Check each one before you rely on
it.

- **A line is a row of `list_lines`** (`core/src/app/entities/list-line.entity.ts`). Its
  products are rows of `list_line_items` (`list-line-item.entity.ts`): `lineId`, `itemId`,
  `position` and `source` (`GROUP` or `USER`). `itemId` is a catalog id with no foreign
  key, because the catalog is another service.
- **Nothing marks one product of a line.** No column and no wire field is a favourite, a
  primary or a default product.
- **Nothing names a supermarket on a line.** The only chain facts in core are the
  refusals of a shopping profile (`profile_supermarket_preferences.excluded`) and the
  chain copied onto a settlement (`line_settlements.supermarketId`).
- **`LineView`** (`list.messages.ts`, near line 254) carries the products as `itemIds:
  string[]` and `groupItemIds: string[]`. A product is an id and not an object, on purpose
  (the comment near line 282 says why). So a flag for one product cannot go on a product.
  It goes on the line.
- **A line is edited by `PATCH /v1/lines/:id`** (`LinesController` in
  `gateway/src/app/lists/list.controller.ts`, `UpdateLineDto` in `list.dto.ts`). The
  request is `UpdateLineRequest` (`list.messages.ts`, near line 700): `content`,
  `quantity`, `itemIds` (the whole set), `adoptItemIds`, `confirmMerge`. Core handles it
  in `LineService` (`line.service.ts`, near line 1521).
- **Three writes change the product set of a line**: the update above, the sync of a
  product group (`product-group-sync.service.ts`), and a merge of two lines
  (`line-merge.service.ts`).
- **The identity of a line** is its normalized name and its product set
  (`item-set-hash.ts`, `line-content.ts`). An add that matches raises the line that
  exists.

### Target state

1. `list_lines` has two nullable columns, and `LineView` carries both.
2. `PATCH /v1/lines/:id` writes either one, alone or with other fields.
3. The favourite is always one of the products of the line, or null.
4. The rules of section 2 hold for every write that changes a product set.

### Scope

- `apps/luna-shopper-backend/core`: one migration, `ListLine`, the mapper, `LineService`,
  the group sync and the merge.
- `libs/luna-shopper/contracts`: `LineView` and `UpdateLineRequest`, with their schemas.
- `apps/luna-shopper-backend/gateway`: `UpdateLineDto`, and `docs/openapi.json` from the
  generator.
- `libs/luna-shopper-admin/models`: the wire types, from the generator.

### Constraints

- **Both fields are on the line and not on a product row.** `LineView.itemIds` stays an
  array of ids.
- **The supermarket is an opaque id**, as `itemId` is. Core does not ask the catalog
  whether it exists. The gateway checks only that it is a UUID.
- **No new route.** Both fields ride the update that exists.
- **The identity of a line does not change.** Neither field is part of `itemSetHash` or
  of the merge key. Two lines that differ only in these fields are the same line.
- **The migration only adds two nullable columns.** It changes no row. It needs no
  release task.
- **An update that names neither field leaves both alone.** Null clears a field.
  An absent field does not.

### Action boundaries

- Do not change velista. Velista plan `0135` reads and writes these fields.
- Do not change the basket, the estimate of plan `0132` or a settlement. Velista `0135`
  section 14 asks the owner whether they read these fields.
- Do not add a preference for each person. Section 4 says why it is left out.
- Do not edit `openapi.json` or `wire-types.ts` by hand.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway`
  and the contracts and admin models projects pass. Check the real names with
  `npx nx show projects`.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` leave no diff after the commit.
- The integration specs of section 3 pass against a real Postgres on an ephemeral Luna
  slot.

## 1. The two fields

| Field | Type | Meaning |
| --- | --- | --- |
| `favoriteItemId` | uuid or null | The one product of the line that the household wants. Always one of `itemIds` |
| `preferredSupermarketId` | uuid or null | The chain that the line is bought at. Never a shop |

Both are columns of `list_lines`, both default to null, and both are on `LineView`.
`UpdateLineRequest` and `UpdateLineDto` take each one as optional and nullable.

## 2. The rules

1. **The favourite is one of the products.** An update that sets `favoriteItemId` to an
   id that is not in the set of the line, as the set stands after the same update, is
   refused with `validation_failed`. An update can thus add a product and make it the
   favourite in one request.
2. **A favourite that leaves the set is cleared.** Every write that removes a product
   from a line sets `favoriteItemId` to null when that product was the favourite, in the
   same transaction: an update with `itemIds`, the sync of a product group, and a merge.
   A line with no products has no favourite.
3. **`adoptItemIds` does not touch the favourite.** Keeping a product changes who owns
   it and not the set.
4. **The supermarket does not depend on the products.** It stays when the set changes,
   also when the set becomes empty. Only an update clears it.
5. **Who may write them.** The rule that guards `itemIds` on the same update guards both
   fields: `WRITE` on a line that is not approved, `MANAGE` on any line (plan `0076`
   section 3, plan `0036` section 4.1). A write of either field by a writer puts an
   approved line back to waiting exactly when a write of `itemIds` does.
6. **A merge keeps the fields of the line that survives.** Where the survivor has none,
   it takes the field of the line that goes away. The favourite is taken only when that
   product is in the merged set.
7. **An add never sets them.** `POST /v1/lists/:id/lines` and the batch add do not take
   either field. A new line starts with both null. An add that raises a line that exists
   leaves the fields of that line alone.
8. **The version of the line rises** with a write of either field, and the realtime
   event of a line update carries the new `LineView`, as for any other update.
9. **A copy of a line to a basket or a trip does not carry them.** Nothing outside the
   list reads these fields in this plan.

## 3. Tests

- Unit specs of `LineService`: each rule of section 2 that the service owns (1, 2 for an
  update, 3, 4, 5, 7, 8), a null that clears, and an absent field that leaves the value.
- A spec of the group sync: a group that drops the favourite clears it.
- A spec of the merge: rule 6, with the survivor holding a field and with it holding
  none, and a favourite that is not in the merged set.
- A spec of the mapper and of the DTO validation: a value that is not a UUID is refused.
- Integration specs against Postgres: the migration runs on a database with lines, and
  an update writes and reads back both fields.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass with the regenerated files.

## 4. Not in this plan

- **A supermarket for each person.** The owner wrote "your preferred chain". This plan
  puts the choice on the line, so that everyone on the list sees it, because a line is
  what the household agreed to buy. One for each person needs a table keyed by the user
  and the line, and a `LineView` that differs by reader. Velista `0135` section 14 asks
  the owner.
- **A shop.** The owner excluded it.
- **The estimate and the basket.** Neither reads the two fields.
- **A favourite for each supermarket**, and more than one favourite.
