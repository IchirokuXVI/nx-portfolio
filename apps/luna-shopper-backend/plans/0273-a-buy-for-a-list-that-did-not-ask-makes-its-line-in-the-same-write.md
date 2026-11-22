> **PR:** [#1063](https://github.com/IchirokuXVI/nx-portfolio/pull/1063)

# 0273: a buy for a list that did not ask makes its line in the same write

> Decided on 2026-11-22. In the basket's line sheet each list's stepper stops changing what
> the list asks for and records what was bought for that list instead (velista `0201`). The
> section "Add it to another list" of the same sheet records buys too: a shopper who buys a
> product for a list that did not ask for it says so there, and the list gets the line at an
> asked amount of 0 with the buy recorded against it. The owner ruled that this happens in
> one transaction, so a failed write leaves no line behind, and that a guest cannot do it.
>
> This is the backend half of velista `0201`. Velista `0201` cannot be released without it,
> and it is of no use without velista `0201`: **release them together**, with velista `0200`
> (see velista `0201`) and backend `0274`. Amended on 2026-11-22 after its review: the
> ask of the line it makes reads 0 only once backend `0274` records how much of an ask each
> buy met, so spec 7 needs `0274`; the two can be built side by side. It needs nothing else
> of this round.
> Amended again on 2026-11-22: a catalog that does not answer gets its own try again error.
>
> What already works and is not changed (read on `dev` at `e06813139`):
> - A buy for one line of a row: `POST /v1/baskets/:id/rows/:rowKey/settle` with
>   `lineIds: [lineId]`, a `quantity` and `from` equal to that line's `left`, and no
>   `allocations`. The units go to that line, a buy above what it asks is recorded, and the
>   line's quantity is floored at 0 (`basket-settle.service.ts:95`, `:131` to `:140`,
>   `:178`; `basket-rows.ts:663` to `:669`).
> - Taking units back from one line: `POST /v1/baskets/:id/rows/:rowKey/revert` with
>   `lineIds: [lineId]`, `target: 'UNITS'`. It takes the newest buys of this trip first and
>   shrinks a buy by reverting it and appending the rest (`basket-revert.service.ts:112` to
>   `:209`).
>
> What does not work, and is this plan:
> - A line that is not a row of the basket cannot be bought: a line at 0 with no buy in this
>   trip answers "Row not found" (`basket-row-resolver.ts:46` to `:48`, `:95` to `:100`).
> - No endpoint creates a line at quantity 0: `POST /v1/baskets/:id/lines` requires 1 or
>   more (gateway `basket.dto.ts:266` to `:271`), and it records no buy.
> - No endpoint creates a line and records a buy in one transaction.
>
> Code anchors, on `dev` at `e06813139`, under `apps/luna-shopper-backend/`:
> `gateway/src/app/baskets/basket.controller.ts:352` (settle), `:583` to `:627` (revert),
> `:781` to `:824` (add a line); `gateway/src/app/baskets/basket.dto.ts:81` to `:205`, `:266`
> to `:271`; `core/src/app/baskets/basket-line-add.service.ts:66` to `:136` (the add: guest
> refused at `:73`, served and covered lists at `:81` to `:90`, `LineService.add` at `:92`);
> `core/src/app/baskets/basket-settle.service.ts:115` to `:232` (the settle transaction and
> the `line_settlements` insert); `core/src/app/baskets/basket-product.service.ts:101` to
> `:159` (`productLists`, which names each list's oldest line of the product or
> `lineId: null`); `core/src/app/lists/line.service.ts:1107` to `:1153` (`add`, its WRITE
> check and its list lock); `core/src/app/baskets/entities/line-settlement.entity.ts`;
> `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts:757` to `:971`.

## Brief for the agent

### Objective

Add one basket write that records a buy of the basket's product for a list that does not
ask for it, creating the line at quantity 0 when the list has none, in one transaction, for
a participant with an account who may write to that list.

### Context

- A row of the basket is one product; its entries are the lines of the covered lists that
  ask for it or were bought in this trip. A list that has no such line, or has a line at 0
  with no buy in this trip, is not an entry.
- `productLists` already answers, for each list the actor may write to and the basket
  covers, the oldest line holding the product or `lineId: null`. The velista sheet draws
  those lists under "Add it to another list".
- After this write the line has a buy in this trip, so it is an entry of the row, and every
  later plus and minus on it is the existing per line settle and revert.

### Target state

1. **A new route**, `POST /v1/baskets/:id/rows/:rowKey/buy-for-list`, body:
   `targetListId` (uuid), `lineId` (uuid or absent), `quantity` (integer, 1 to
   `LINE_QUANTITY_MAX`), `unit`, and the optional `priceScopeId` and
   `supermarketLocationId` a settle carries. **No `itemId`** (amended on 2026-11-22): the
   product is the row's, read by the server from `rowKey`, because this write creates a line
   on another household's list and a product other than the row's is never legitimate
   there. A row with no product answers 409 `basket_row_has_no_product`. 201 with the row
   as a settle answers it, so the client updates the row from the answer as it does after a
   settle.
2. **One transaction**, in core:
   - Refuse a guest (no `userId`) with the same 403 the add uses.
   - Refuse a finished basket, a list the basket does not cover and a list the actor may not
     write to, as the add does.
   - With `lineId`: lock that line, check it is on `targetListId`, holds the row's product,
     and is not an entry of the row (else 409 `basket_line_already_in_row`, so the client uses the
     plain settle).
   - Without `lineId`: create the line through the same code `LineService.add` uses, with
     quantity 0, the item, the unit and `named: false`, under the list lock. If an add at 0
     would merge onto an existing line of the product, use that line instead of making a
     second one.
   - **The new line's text** (amended on 2026-11-22) is the catalog product's name in the
     request's language, else in any language the product has. It is never the text of the
     row's line or of another list's line: one household may have typed it, and it must not
     reach another household's list. A product with no name in any language answers 409
     `basket_product_has_no_name` and writes nothing. A catalog that does not answer (its
     budget runs out, it fails, or no reply comes) is not a product with no name: when a line
     must be made, the route answers 503 `catalog_unavailable`, which tells the client to try
     again, and writes nothing. A buy on a line the list already holds needs no name and goes
     on without catalog. A core that does not answer the gateway's read of the row's product
     is a failed core call, answered as any other on the controller, and never
     `catalog_unavailable`.
   - **The product the gateway priced** rides the message as `expectedItemId`, which the
     gateway builds and the body cannot set. Core reads the row's product again, and when it
     is another (a co-shopper changed the row between the two reads) answers 409 `conflict`
     and writes nothing, so a price, a snapshot and a name are never recorded on the wrong
     product. The client reads the row again and retries.
   - Insert one `line_settlements` row, `BOUGHT`, with the quantity, `applied = 0` (backend
     `0274`), the price columns and the snapshot exactly as a settle writes them, and leave
     the line's quantity at 0.
   - Write the change rows a settle and an add write, and publish the same events, after the
     transaction commits.
   Any failure rolls the whole write back: no line, no buy.
3. The contract message and the gateway DTO name every field; the error codes go in the
   contracts' error list.
4. `apps/luna-shopper-backend/gateway/docs/openapi.json` and
   `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` are regenerated and
   committed.

### Scope

- Work in the gateway (route, DTO, docs), core (`baskets`, and `lists` only to reuse the add
  at 0), the contracts, and the generated files.
- Do NOT change settle, revert, the add route or `productLists`.
- Do NOT allow a quantity of 0 on the existing add route.

### Constraints

- Every POST is 201 with a body (the gateway route rules).
- The created line goes through the list's own add path, so its order, its change row and
  its realtime event are the same as any added line.
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if creating the line at 0 needs a change to `LineService.add` that other
  callers would see.
- Stop and ask if the realtime event of a buy on a line that was just created does not reach
  the basket's other participants the way a settle's does.

### Progress evidence

The specs of section 1; `npx nx affected -t lint test`; the gateway's
`openapi-document.spec.ts` and `wire-types.spec.ts` green after regeneration; an ephemeral
luna slot run of section 2.

## 1. Specs

1. A buy for a list with no line creates one line at 0 and one `BOUGHT` settlement of the
   quantity, in this basket, with the price columns of the request.
2. A buy with the `lineId` of a line at 0 that is not an entry records the settlement on
   that line and creates no line.
3. A `lineId` that is already an entry answers 409 `basket_line_already_in_row`.
4. A guest answers 403, and nothing is written.
5. A list the actor may only read answers 403; a list the basket does not cover answers 404.
6. A failure inside the transaction after the line was made (a forced error in the
   settlement insert) leaves no line and no settlement.
7. After the write the row read names the new entry with `asked` 0 and `bought` the
   quantity (with backend `0274` built), and a following settle and revert with
   `lineIds: [lineId]` work on it.
8. A row with no product answers 409 `basket_row_has_no_product`; a product with no name in
   any language answers 409 `basket_product_has_no_name`; the new line's text is the
   product's name, never the row's line text.
9. When a line must be made and catalog does not answer, the route answers 503
   `catalog_unavailable` and writes nothing; with the line of the list already there the buy
   is recorded on it.

## 2. Slot check

On an ephemeral luna slot: a basket covering two lists, one of which asks for milk; buy 2
milk for the other list through the new route; read the row; revert 1 through the existing
route with `lineIds: [newLineId]`; read the row again.

## 3. Acceptance criteria

- One call creates the line at 0 and records the buy, or writes nothing.
- A guest cannot call it.
- The committed OpenAPI document and wire types match the generator.

## Not in this plan

- The velista sheet that calls it (velista `0201`).
- Moving the revert's `from` guard under the lock (`basket-revert.service.ts:88` to `:94`
  checks it before the transaction). It is a narrow race that predates this round.
