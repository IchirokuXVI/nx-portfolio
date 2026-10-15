# 0211: a malformed group assignment is refused, not a 500

> Asked for by the owner on 2026-10-15: "create a plan to fix the bugs you mentioned". The
> browser walk of PR [#716](https://github.com/IchirokuXVI/nx-portfolio/pull/716) found it
> and did not change it: `POST /v1/admin/catalog/product-groups/assignments` answers 500,
> `Cannot read properties of undefined (reading 'productGroupId')`, when an `assignItem`
> operation leaves out `expect`. It should answer the refusal that every other malformed
> operation of that route gets.
>
> Every fact below was read on `dev` at `bf701879` on 2026-10-15.
>
> Prerequisite reading: plan `0100` (the bulk group decisions),
> `catalog/src/app/catalog/product-group-assignment.service.ts`,
> `ProductGroupAssignmentDto` in `gateway/src/app/catalog/catalog.dto.ts`, and
> `assignItemToGroupOperation` / `createProductGroupOperation` in
> `libs/luna-shopper/contracts/src/schemas/messages/catalog.schemas.ts`.

## Brief for the agent

### Objective

Make the product group assignments route refuse every operation that lacks a field its
kind requires, with `BulkOperationErrorCode.MALFORMED_OPERATION` on that operation and
nothing written, instead of throwing inside catalog.

### Context

- **The gateway checks types, not kinds, on purpose.** Every per operation field of
  `ProductGroupAssignmentDto` (`catalog.dto.ts:1603`) is `@IsOptional()`. The comment above
  the class says the checks that depend on `op` live in catalog, because the gateway is one
  caller among several. `op` itself is `@IsIn(['createGroup', 'assignItem'])`.
- **The contract says what is required, and nothing enforces it.**
  `assignItemToGroupOperation` (`catalog.schemas.ts:1772`) requires `op`, `itemId` and
  `expect`, and `expect` requires `productGroupId` (a string or null).
  `createProductGroupOperation` requires `op`, `ref`, `name`, `slug` and `referenceUnit`.
  `contracts/src/schemas/validator.ts` exists, but no catalog message handler applies it.
  `CatalogController.applyGroupAssignments` (`catalog.controller.ts:661`) passes the payload
  straight to the service.
- **The service already has a shape pass.** `apply` calls `checkShape(operations)`
  (`product-group-assignment.service.ts:95`) and returns `refused(shape)` before any
  transaction when an outcome has an error. `checkShape` (`:302`) already answers
  `MALFORMED_OPERATION` for a bad slug and for an assignment that names both or neither of
  `groupId` and `groupRef`, and `DUPLICATE_SUBJECT` for a repeated `ref`, slug or `itemId`.
- **The defect.** `checkShape` trusts the TypeScript type. An `assignItem` with no `expect`
  passes it, and `applyInside` reads `operation.expect.productGroupId` (`:264`), which
  throws. The same trust covers the other required fields: a missing `itemId` reaches the
  duplicate check and the `In(...)` lookup, and a missing `slug` reaches `slugOf`. Any `op`
  that is not `createGroup` is treated as an `assignItem`.

### Target state

1. `checkShape` answers `MALFORMED_OPERATION` on the operation, with a sentence that names
   the missing field, when:
   - `op` is neither `createGroup` nor `assignItem`;
   - an `assignItem` has no `itemId` string, has no `expect` object, or has an `expect`
     whose `productGroupId` is `undefined` (null stays valid: it means "in no group");
   - a `createGroup` has no `ref`, `name`, `slug` or `referenceUnit`.
2. These checks run first for each operation, before the duplicate and slug checks read
   the field. An operation that fails one gets no second error.
3. The route answers as it answers any refused file today: the same status and body shape
   as a `MALFORMED_OPERATION` for both `groupId` and `groupRef`, nothing written, no event.

### Scope

- `apps/luna-shopper-backend/catalog/src/app/catalog/product-group-assignment.service.ts`
  and `product-group-assignment.service.spec.ts`.
- This plan file: add "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Keep the gateway DTO as it is. Its comment is a decision, and catalog must refuse these
  operations from every caller, not only the gateway.
- Use the existing `fail` helper and the existing code. Add no error code, so the contract,
  `openapi.json` and the admin wire types do not change.
- Do not wire `contracts/src/schemas/validator.ts` into catalog's message handlers. That is
  a change to every pattern, and it is not this defect.
- Treat the operation as `unknown` shaped at the edges you check. Do not cast a missing
  field away with `as`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change a contract type or schema,
  the gateway, or another service.
- You may search the other bulk handlers of catalog (the entry decisions route of plan
  `0100` and its siblings) for the same trust in a required field. Report what you find in
  "What the build decided". Fix one only if it is the same defect in the same shape check
  pattern, and name it in the PR.

### Progress evidence

- New specs in `product-group-assignment.service.spec.ts`, each failing before the change:
  an `assignItem` with no `expect`, with `expect: {}`, with no `itemId`; a `createGroup`
  with no `slug` and one with no `referenceUnit`; an unknown `op`. Each answers a refused
  file with `MALFORMED_OPERATION` on that index and writes nothing. An `assignItem` with
  `expect: { productGroupId: null }` still applies.
- `npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway`
  passes.
- `npx nx run luna-shopper-backend-gateway:openapi` leaves `openapi.json` unchanged (see the
  memory on line endings if Windows shows a diff of every line).
- Optional, if a slot is free: the request from the header against an ephemeral Luna slot
  answers the refusal and not a 500.

## 1. Not in this plan

- Validating every catalog message against its contract schema at the handler.
- The two held choice leftovers that the same review found in velista. Velista
  [`0149`](../../velista/plans/0149-a-held-product-choice-lets-go-once-it-is-spent.md)
  fixes them.

## 2. Choices that are mine

- **Fixed in catalog, not in the gateway.** A `@ValidateIf` on the DTO would turn this one
  route's 500 into a 400 for the back office, and leave the same crash for every other
  caller of the pattern.
- **`MALFORMED_OPERATION` and not a new code.** Its meaning, "the operation names neither of
  two required alternatives, or both", is the nearest the contract has, and a missing
  required field is the same kind of fault.

## What the build decided

- **One reader in front of the shape pass.** `missingField(operation: unknown)` reads the
  operation as a plain record and returns the sentence for the first required field it
  lacks, or null. `checkShape` calls it first for each operation and returns on a refusal,
  so the duplicate, slug and alternative checks never read a missing field and a refused
  operation carries exactly one error.
- **Each sentence names the field.** `A createGroup operation needs slug.`,
  `An assignItem operation needs expect.`, `op must be createGroup or assignItem.` The
  specs assert the field name is in the detail.
- **Present means a non empty string** for `ref`, `slug`, `referenceUnit` and `itemId`,
  because the contract says `nonEmptyString`. `name` and `expect` must be objects.
  `expect.productGroupId` must be a string or `null`; any other type is refused like
  `undefined`, since the contract allows nothing else. The value of `referenceUnit` is not
  checked against `UnitOfMeasure`: that is a wrong value, not a missing field, and it was
  out of the plan.
- **The outcome echoes a missing `ref` or `itemId` as `null`**, not `undefined, so the
  refused file still matches the outcome schema. An unknown `op` is echoed as sent.
- **The specs feed the malformed operations through one cast in the spec helper**, because
  the point is input the type forbids. The service itself casts nothing away.

### The sibling handlers

- **Catalog has no other bulk handler of this pattern.** `ItemService.createMany`,
  `updateMany` and `teachEans` take one kind of entry, not a union of operations, and have
  no shape pass. They were left alone.
- **The entry decisions route of plan 0100 has the same defect, in harvester.**
  `SourceEntryBatchService` (`harvester/src/app/harvest/source-entry-batch.service.ts`)
  has the same `checkShape` and reads `operation.expect.status` and
  `operation.expect.lastSeenAt` (`:495`, `:505`) with nothing checking that `expect` is
  there. It is another service, so this plan does not touch it. It wants its own plan.

### Evidence

- Six new cases in `product-group-assignment.service.spec.ts` failed against the old
  service and pass now; the `expect: { productGroupId: null }` case applies before and
  after.
- `npx nx run-many -t lint test -p luna-shopper-backend-catalog luna-shopper-backend-gateway`
  passes except `openapi-document.spec.ts` on this Windows checkout, whose working copy of
  `openapi.json` is CRLF (`core.autocrlf=true`). `npx nx run luna-shopper-backend-gateway:openapi`
  writes a file byte identical to the committed blob, and the spec passes on that file.
- No ephemeral slot was run: the specs left no doubt.
