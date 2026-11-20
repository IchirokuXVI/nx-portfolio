# 0027 (backlog) A body boolean reads only a JSON boolean

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Found while PR #1031 was built and reviewed (merged on 2026-11-20). PR #1031 made every boolean
> query flag of the gateway read its raw text through `asQueryFlag`. It left body booleans alone
> and listed them as open for the owner. The owner parked the fix here on 2026-11-20 (decision
> 107b of the harvester round). Every anchor below was read on `origin/dev` on 2026-11-20. Paths
> are relative to `apps/luna-shopper-backend/gateway/src/app/` unless they say otherwise.
>
> **This is not a live defect.** velista and the back office send real JSON booleans in every
> body. Only a client that sends a boolean as text meets it.
>
> Prerequisite reading: PR #1031 (its body and its "Open for the owner" section),
> `libs/luna-shopper/platform/src/lib/validation/validation-pipe.ts`,
> `libs/luna-shopper/platform/src/lib/validation/query-flag.ts` and its spec, and
> `query-flags.http.spec.ts`.

## Brief for the agent

### Objective

Make every boolean field of a gateway body DTO accept only a JSON boolean. The JSON text
`"false"` or `"true"` in such a field answers 400 `validation_failed`, as any other wrong type
does. A real `true` or `false` reads as itself, and an absent field stays absent.

### Context

- `createValidationPipe` (`libs/luna-shopper/platform/src/lib/validation/validation-pipe.ts`)
  runs with `transform: true` and `enableImplicitConversion: true`. For a property typed
  `boolean`, class-transformer converts with `Boolean(value)` before `@IsBoolean` runs. It does
  that for a body as for a query.
- A JSON body carries real booleans, so a client that sends `{"force": false}` is read right.
  A client that sends `{"force": "false"}` sends a string. The pipe converts it to `true`, and
  `@IsBoolean` then passes.
- Some body fields already read the value as sent, and are safe: the inline
  `({ obj }) => obj?.['switchAccount']` transforms (`auth/auth.dto.ts`, and `askIfAmbiguous` in
  `baskets/basket.dto.ts` and `lists/list.dto.ts`), `asSent` and `asSpelled`
  (`harvest/harvest.dto.ts`), and `MergeFlag` (`catalog/catalog-admin.dto.ts`).
- The comment of `asQueryFlag` already states the trap for a body in one sentence.

### Target state

1. A helper beside `asQueryFlag` in `libs/luna-shopper/platform/src/lib/validation/`, exported
   from the library, that reads `obj[key]` and hands it on as sent. A JSON boolean passes
   `@IsBoolean`. A string or any other type fails it with 400.
2. Every boolean field of section 1 uses it.
3. The local raw readers that do the same (`asSent`, and the inline `obj[key]` transforms) use
   it too, unless one of them does more than read the value as sent. The builder names any that
   stay, with the reason.
4. A spec of the helper through the real pipe, as `query-flag.spec.ts` does for the query flag.
   It shows the trap with the pipe alone (`"false"` reads as true) and the fix with the helper.
5. An HTTP spec, in the form of `query-flags.http.spec.ts`, that boots a few controllers with
   the real `createValidationPipe()` and proves, for at least one field of each DTO file of
   section 1: `true` reads true, `false` reads false, `"false"` answers 400 with nothing sent to
   a service.

### Scope

The gateway's body DTOs of section 1, the new helper and its spec in
`libs/luna-shopper/platform`, the new HTTP spec, and `openapi.json` if a description changes.
No service other than the gateway, no client.

### Constraints

- A JSON boolean must keep working exactly as today. No client changes.
- No field changes its name, its optionality or its default.
- `openapi.json` and `wire-types.ts` are regenerated with the two commands of `CLAUDE.md`, never
  edited by hand. A body field's schema does not change, so the document should change in
  descriptions only, if at all.
- Query DTOs keep `asQueryFlag`. A query carries text, and a body carries JSON, so the two
  helpers stay two.

### Action boundaries

- Stop and ask before you change `createValidationPipe` itself, for example to turn off the
  implicit conversion. Every DTO of the gateway depends on it.
- Stop and ask if a client in the repository sends one of these fields as a string.

### Progress evidence

The spec output of the platform library and the gateway, the new HTTP spec failing on
`origin/dev` and passing after the change, and the diff of `openapi.json`, or a statement that
it did not change.

## 1. The fields

Every boolean property of a gateway body DTO with no raw reader, scanned on `origin/dev` on
2026-11-20. PR #1031 listed most of them. Two that it listed, `switchAccount` and
`askIfAmbiguous`, already read `obj[key]` and are not here.

| File | DTO | Field |
| --- | --- | --- |
| `harvest/harvest.dto.ts` | `SpawnHarvestRunDto` | `detailBackfill` |
| `harvest/harvest.dto.ts` | `ImportDiscoveredPlaceDto` | `force` |
| `harvest/harvest.dto.ts` | `UpsertSupermarketSourceDto` | `enabled`, `autoImportPlaces` |
| `harvest/harvest.dto.ts` | `SetSourceEnabledDto` | `enabled` |
| `harvest/harvest.dto.ts` | `SettleItemAtChainDto` | `dryRun` |
| `harvest/harvest.dto.ts` | `AddPostalCodeDiscoveryDto` | `discoverNow` |
| `account/shopping-profile.dto.ts` | `ProfilePostalCodeDto` | `expandNearby` |
| `account/shopping-profile.dto.ts` | `ProfileSupermarketDto`, `ProfileLocationDto` | `excluded` |
| `admin/admin-edit.dto.ts` | `UpdateAdminListDto` | `autoApproveLines`, `sharedWithZone` |
| `lists/list.dto.ts` | `CreateListDto` | `shareWithZone` |
| `lists/list.dto.ts` | `UpdateListDto` | `autoApproveLines`, `sharedWithZone` |
| `lists/list.dto.ts` | `UpdateLineDto` | `confirmMerge` |
| `baskets/basket.dto.ts` | `ChangeBasketLinesProductDto` | `keep` |
| `baskets/basket.dto.ts` | `RenameBasketRowDto` | `confirmMerge` |
| `catalog/catalog.dto.ts` | `CreateItemsDto`, `UpdateItemsDto` | `requireRegisteredBrands` |
| `catalog/catalog.dto.ts` | `AvailabilityEntryDto` | `available` |
| `catalog/catalog.dto.ts` | `UpdatePricePolicyDto` | `enabled` |
| `catalog/shop-walks.dto.ts` | `UpdateShopWalkDto` | `shown` |

The builder scans again before the build, because a DTO added later can add a field. A
`boolean` property with no transform in a `*.dto.ts` file is the search.

## 2. The fix

A body twin of `asQueryFlag`: it returns `obj[key]` as sent. With it, a JSON `false` stays
`false`, a JSON `"false"` stays a string, and `@IsBoolean` refuses the string. It reads no text
as a boolean, because a body has no bare flag and no text form to read.

```ts
@IsOptional()
@Transform(asBodyBoolean)
@IsBoolean()
force?: boolean;
```

The name is the builder's to propose.

## Tests

- `libs/luna-shopper/platform`: the helper through the real pipe. `true`, `false` and absent
  read as themselves. `"false"`, `"true"`, `0` and `1` fail `@IsBoolean`. The same DTO with no
  helper reads `"false"` as true, which is the trap.
- The gateway HTTP spec of Target state 5.
- Every existing gateway spec stays green.

## Acceptance criteria

- [ ] Every field of section 1, and any the scan of the build adds, reads only a JSON boolean.
- [ ] `{"field": "false"}` answers 400 `validation_failed` on each, and nothing is sent to a
      service.
- [ ] A JSON `true` and `false` read as today.
- [ ] `openapi.json` is regenerated, never edited by hand.

## Verification

```sh
npx nx test luna-shopper/platform
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test
```
