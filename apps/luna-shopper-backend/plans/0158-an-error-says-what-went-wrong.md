# 0158: an error says what went wrong

> Found by `0150` (report findings 7, 8 and 15, shopper F16). Prerequisite reading: the
> `ProblemDetails` shape in `libs/luna-shopper/platform/src/lib/errors/`, and the bulk
> decisions route `POST /v1/admin/harvest/entries/decisions`.

Four small defects made the `0150` operator guess:

- The bulk decisions route answered 201 `applied: false`, `failedStep: CREATE_ITEMS`,
  `error: "[object Object]"` on an EAN collision, and marked no operation. The single route
  says "Catalog already holds an item with EAN …" with a 409.
- `POST /v1/admin/catalog/item-prices` with `sourceKind: USER_RECEIPT` answered 201 and
  stored the row, although its own description says user kinds are refused.
- `GET /v1/baskets/undefined` and a malformed id on an admin locations route answered 500
  "Something went wrong on our side".
- Walk 2's `unchanged` counter read 6,324 for 4,246 products.

## Brief for the agent

### Objective

Make every error that crosses NATS keep its message, make the bulk decisions route name the
operation and the reason, refuse user kinds on the admin price route, answer 400 for a
malformed id, and make the run counter `unchanged` count products only.

### Context

- **`[object Object]`.** `harvester/src/app/harvest/source-entry-batch.service.ts:148-166`
  catches a failed `createItems` and calls `reason(error)` (`:557-562`), which falls through
  to `String(error)`. A NATS error arrives as a plain `ProblemDetails` object
  (`catalog-client.service.ts:435-450`, built by `global-exception.filter.ts:214-237` and
  `problem-details.ts:20-37`), not an `Error`. Catalog raised
  `ConflictException(EAN_TAKEN_IN_BATCH)` (`catalog/src/app/catalog/item.service.ts:286-288`,
  message at `:1302-1305`), which names neither the EAN nor the item.
- The single route checks first: `source-entry.service.ts:278-286` calls `findItemByEan`.
  `BulkOperationErrorCode.ALREADY_TAKEN` already exists
  (`libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts:146-147`).
- `source-entry-batch.service.spec.ts:614-636` mocks `throw new Error(...)`, which hides the
  defect.
- **The same stringification elsewhere**, where the `try` covers a NATS call:
  - operator visible: `run-executor.service.ts:532` stores the text as the run's `error`,
    `:537` logs it, and `postal-code-discovery.worker.ts:299` copies it into the queue row
  - logs only: `run-executor.service.ts:83`, `source-entry.service.ts:758`,
    `discovered-place.service.ts:287` and `:333`, `postal-code-discovery.service.ts:167`,
    `postal-code-discovery.worker.ts:140`, `source-entry-batch.service.ts:246, 249, 359`
  - gateway: `account/account.controller.ts:126-129`
  - A model to copy: `describe` in `gateway/src/app/lists/comment-transcription.service.ts:222-231`.
- **User kinds.** The gateway DTO accepts any kind (`gateway/src/app/catalog/catalog.dto.ts:574-581`,
  `@IsEnum(PriceSourceKind)`). `item-price.service.ts:62-85` in catalog has no check. The
  writer refuses a user kind only with a run id (`item-price-writer.ts:76-85`). The reference
  seed writes `USER_RECEIPT` through the writer with `sourceRunId: null`
  (`seed-reference-catalog.ts:376-379`), so the check does not belong in the writer.
- **Malformed ids.** No route validates path params: there are no `ParseUUIDPipe` uses in
  gateway, core or platform. The global `ValidationPipe`
  (`libs/luna-shopper/platform/src/lib/validation/validation-pipe.ts:12-18`) validates DTOs
  only. Postgres raises `22P02`, and `global-exception.filter.ts:170-172` turns it into a
  500. About 150 routes in 13 gateway controllers take an id. Core has six private copies of a
  uuid pattern (`line.service.ts:174`, `list.service.ts:65`, `settlement.service.ts:46`,
  `trips.service.ts:48`, `purchases.service.ts:46`, `settlement-paid.ts:8`).
- `ParticipantGuard` (`gateway/src/app/baskets/participant.guard.ts:62-84`) forwards the id
  to core before any pipe runs, because guards run before pipes.
- **The counter.** `source-ingest.ts:357-363` reports `unchanged: 1` per product, and
  `:776-781` reports `unchanged: confirmed` per price batch. `run-context.ts:63-72` adds both.
  Prices are already reported as `pricesPublished` and `pricesConfirmed` (`describePrices`,
  `run-executor.service.ts:629-640`). `source-ingest.spec.ts:788-817` asserts the double count.

### Target state

- One helper, `describeError(error: unknown): { code?, message }`, in
  `libs/luna-shopper/platform`, reads an `Error`, a `ProblemDetails` object, or anything else.
  Every site listed above uses it.
- The bulk route checks each create's EAN with `findItemByEan` in its validation step, marks
  the operation `ALREADY_TAKEN` with "Catalog already holds an item with EAN X (id)", and
  refuses at `VALIDATE`. The catalog 409 stays as the backstop for a race, and when it fires,
  the answer carries its message.
- Catalog's `EAN_TAKEN_IN_BATCH` message names the EAN.
- The admin price route refuses every kind except `ADMIN` and the automated kinds with 400,
  in the DTO (`@IsIn`) and again in `ItemPriceService.add`.
- A path param that must be a uuid and is not answers 400 in the house `ProblemDetails`
  shape, through one shared decorator. `GlobalExceptionFilter` maps Postgres `22P02` to 400 as
  the backstop. `ParticipantGuard` checks its id itself.
- `unchanged` counts products only.

### Scope

Work only in:

- `libs/luna-shopper/platform/src/lib/errors/` and `validation/`
- the harvester and gateway files listed in Context, and their specs
- `apps/luna-shopper-backend/catalog/src/app/catalog/item.service.ts` (the message only) and
  `item-price.service.ts`
- the 13 gateway controllers, for the decorator only
- core's six uuid copies, replaced by the shared check
- `libs/luna-shopper/contracts` if an error code is added, plus the regenerated `openapi.json`
  and `wire-types.ts`

Do not touch: the writer's run id check, what any route answers on success, or the
`ProblemDetails` shape.

### Constraints

- **Audit every id before it gets the decorator.** Some harvest and admin ids are not uuids
  (`:postalCode`, `:secret`, `:sourceKind`, `:code`, and any other you find). A decorator on a
  non uuid param breaks the route. List every param you leave out in the PR.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing an error code that velista or the admin app reads, or changing
the `ProblemDetails` fields.

### Progress evidence

- A `describeError` spec with an `Error`, a `ProblemDetails` object, a string and `null`.
- `source-entry-batch.service.spec.ts:614-636` rejects with a plain problem object and
  asserts the operation is marked with its reason.
- A gateway spec: `USER_RECEIPT` on the admin price route answers 400. A catalog spec: the
  service refuses it too.
- A gateway spec: `GET /v1/baskets/undefined` answers 400. A filter spec for `22P02`.
- `source-ingest.spec.ts:788-817` asserts the product count only.
- Tests pass for platform, harvester, catalog, core and gateway, and the OpenAPI and wire
  types are regenerated.
