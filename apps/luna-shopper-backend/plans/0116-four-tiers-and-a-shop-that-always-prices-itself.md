> **PR:** [#383](https://github.com/IchirokuXVI/nx-portfolio/pull/383)

# 0116: four tiers, and a shop that always prices itself

> Admin half: `apps/luna-shopper-admin/plans/0028`.
>
> A price scope today is one of `NATIONAL`, `REGION`, `POSTAL_CODE` or `STORE`, and a shop holds
> its own `STORE` scope only when nothing else was named for it. This plan renames the unused
> `POSTAL_CODE` tier to `LOCAL_AREA`, moves Mercadona's warehouses into it, and gives every shop
> its `STORE` scope whatever else it holds. It is the first of five plans (0116 to 0120) that let
> one walk of a warehouse price a whole group of warehouses, regions or shops.
>
> Prerequisite reading: `0105` (priority and the shop stack), `0106` (Mercadona names its own
> shops), `0108` (several warehouses in one walk), `supermarket-location.service.ts` in full,
> and `price-scope.service.ts`.

## Brief for the agent

### Objective

Rename the `POSTAL_CODE` scope kind to `LOCAL_AREA`, make Mercadona's warehouses `LOCAL_AREA`
scopes at priority 200, and make every shop hold its own `STORE` scope in every stack it is ever
given, and let the price scopes list filter by kind, as sections 2 to 7 describe.

### Context

- `PriceScopeKind` is `NATIONAL | REGION | POSTAL_CODE | STORE`
  (`libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts:27`). The Postgres type is
  `price_scope_kind`. `DEFAULT_SCOPE_PRIORITY` is STORE 100, POSTAL_CODE 200, REGION 300,
  NATIONAL 1000.
- **No code path creates a `POSTAL_CODE` scope.** The value exists as an enum member, a priority
  default, migration literals, the harvest document schema, generated files and admin labels.
- `'POSTAL_CODE'` is **also** a value of `SCOPE_ORIGINS` (`catalog.messages.ts:1593`,
  `scope-resolver.service.ts:211`). That is where a resolved scope came from, not a kind, and it
  stays exactly as it is.
- Mercadona store discovery declares one `REGION` scope per warehouse
  (`mercadona-store-discovery.runner.ts:205`), and the catalog walk declares its walked scopes as
  `REGION` (`mercadona-catalog.runner.ts:92`). `ADAPTER_CAPABILITIES['mercadona-api']
  .walkablePriorities` is 300..300.
- The reference seed (`catalog/src/app/db/reference/seed-reference-catalog.ts:222`) upserts
  Mercadona warehouse `4661` by id as `REGION` at priority 300. It runs as a Helm Job on every
  deploy, and `referenceSeed.enabled` is true in both `values.staging.yaml` and
  `values.production.yaml`.
- `SupermarketLocationService.create` gives a shop a `STORE` scope only when the request names no
  scope (`supermarket-location.service.ts:134`). `update` replaces the stack with whatever is
  named, so it can drop the `STORE` scope and leave the scope row orphaned.
- `RunScopeResolver.load` keys a chain's scopes by `externalKey` alone, not by kind
  (`price-scope-resolver.ts:140`).
- The owner confirmed on 2026-09-16 that neither cluster holds a harvested warehouse scope or an
  imported shop. The seed's `4661` row is the only warehouse scope there, and the seed rewrites it
  by id.

### Target state

Every acceptance criterion in section 10 holds, `openapi.json` and the admin wire types are
regenerated, and `nx affected -t lint test` is green for the touched projects.

### Scope

- Work only in: `libs/luna-shopper/contracts` (the enum, the default priorities, the capability
  table, the harvest document schema and type), `apps/luna-shopper-backend/catalog` (a migration,
  `supermarket-location.service.ts`, `price-scope.service.ts`, the reference seed and their specs),
  `apps/luna-shopper-backend/harvester` (the two Mercadona runners, `harvest-export.ts`,
  `price-scope-resolver.ts` and their specs), `apps/luna-shopper-backend/gateway` (the priority
  description and `ListPriceScopesQueryDto` in `catalog.dto.ts`), `libs/luna-shopper/test-fixtures`, and the two generated files.
- Do NOT touch: `SCOPE_ORIGINS` or anything that reads a scope origin, the LIDL runners (their
  offer regions stay `REGION`), the effective price resolution (plan 0117), the admin libraries
  beyond the regenerated wire types and the one test value in `import-upload.spec.ts` (admin
  plan 0028).

### Constraints

- The enum change is `ALTER TYPE "price_scope_kind" RENAME VALUE 'POSTAL_CODE' TO 'LOCAL_AREA'`,
  the same shape as `1757000000000-PriceScopeRegionRename.ts`. No data migration.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.
- Existing `REGION` scopes of other chains keep their kind and priority.

### Action boundaries

- Proceed with in-scope edits, specs, the migration file and the generators.
- Stop and ask before running the migration anywhere but a throwaway slot, and if any code path
  turns out to create a `POSTAL_CODE` scope after all.

### Progress evidence

Report after the migration and the contract change, after the stack rule with its specs, and
after the Mercadona and seed changes, each with the spec run that proves it.

## 1. What is being built

| Piece                                          | Where                                                     |
| ---------------------------------------------- | --------------------------------------------------------- |
| `POSTAL_CODE` renamed to `LOCAL_AREA`          | contracts enum, a catalog migration, the document schema  |
| Warehouses are `LOCAL_AREA` at 200             | both Mercadona runners, the capability table, the seed    |
| Every shop holds its `STORE` scope             | `supermarket-location.service.ts`                         |
| A declared key that names another kind         | `price-scope-resolver.ts`                                 |
| The price scopes list filters by kind          | gateway query DTO, the catalog list query                 |

## 2. The four tiers

The tiers are what an operator reads, and the owner named them:

| Kind         | Default priority | Name in the back office | What it is                                   |
| ------------ | ---------------- | ----------------------- | -------------------------------------------- |
| `STORE`      | 100              | Single shop             | one shop                                     |
| `LOCAL_AREA` | 200              | Local area              | a small group a chain names, for example a warehouse |
| `REGION`     | 300              | Chain region            | a large group, for example LIDL's 59 offer regions  |
| `NATIONAL`   | 1000             | Nationwide              | every shop of the chain                      |

**The names are the admin's to draw** (admin plan 0028). This plan changes the kind and its
default priority, and nothing in the backend stores a display name.

**`POSTAL_CODE` is renamed rather than added beside.** It has no creator, so the rename changes
the meaning of no row, and leaving a fifth kind nobody writes is a kind an operator can still pick
by mistake.

Every occurrence of the kind moves: the enum member and `DEFAULT_SCOPE_PRIORITY`, the literal in
`harvest-document.ts:114` and `harvest-document-2.schema.ts:191`, the cast in `harvest-export.ts`,
the priority description in `catalog.dto.ts:512`, and the specs that name it
(`import-upload.spec.ts:107` in the admin is a test value and moves too). The historical
migrations keep their literals, since they describe the type as it was.

### 2.1 A document that still says `POSTAL_CODE`

**The harvest document accepts both spellings on read and writes only `LOCAL_AREA`.** A document is
a file somebody keeps, and a version 2 file that validated last week has to validate next week.
The schema's enum lists both values, the reader maps `POSTAL_CODE` to `LOCAL_AREA` before it
declares the scope, and the exporter writes the new name. No producer of a `POSTAL_CODE` document
is known, so this costs one line and removes the question.

## 3. Mercadona's warehouses are local areas

- `MercadonaStoreDiscoveryRunner.declareWarehouses` declares `kind: PriceScopeKind.LOCAL_AREA`.
- `MercadonaCatalogRunner.run` declares its walked scopes as `LOCAL_AREA`.
- `ADAPTER_CAPABILITIES['mercadona-api'].walkablePriorities` becomes
  `{ min: DEFAULT_SCOPE_PRIORITY.LOCAL_AREA, max: DEFAULT_SCOPE_PRIORITY.LOCAL_AREA }`.
- The comments that say "a warehouse is a REGION" are rewritten, including the kind's own comment
  in `catalog.enums.ts`, which today names Mercadona as its example of `REGION`.

**The capability table is generated into the admin**, so the regenerated wire types carry the new
band, and the runs form keeps offering Mercadona's warehouses without a change of its own.

## 4. The reference seed

`seed-reference-catalog.ts` upserts scope `4661` with `kind: 'LOCAL_AREA'` and
`priority: DEFAULT_SCOPE_PRIORITY.LOCAL_AREA`.

**This is how the one warehouse scope in each cluster moves, and it is why no data migration
exists.** The upsert is keyed on the row's derived id, so the next deploy rewrites the existing
row in place, and the unique index `(supermarketId, kind, externalKey)` has no second row to
collide with.

Plan 0105 says an existing row is never renumbered by a migration, because a number that moves on
its own silently re-ranks every shop holding the scope. This is the deliberate exception, stated
here so it does not read as an accident: the seed row is the only one, and its shop holds no scope
between `LOCAL_AREA` and `REGION` for the move to re-rank against.

The seeded Mercadona shop takes the stack rule of section 5 like any other shop, so the seed names
its warehouse and the catalog adds the shop's `STORE` scope.

### 4.1 Found while building: the upsert runs only once

**The paragraph above is true of a fresh database and false of a cluster.** `seedMercadona` looks
the chain up by brand key first, and upserts the chain, `4661` and the shop only when it finds
none. The first deploy created the chain, so every later deploy takes the other branch and never
reaches the upsert. That branch now calls `moveSeededMercadona`. It moves the scope whose id is
the seed's derived id to `LOCAL_AREA` at 200, and gives the seeded shop its `STORE` scope and the
prices it inherits. A scope a harvest created has another id and is never touched. A rehearsal on
a throwaway Postgres set the rows back to `REGION` 300 and ran the built `seed-reference.js`
twice. The first run moved them, and the second changed nothing.

The seed writes its rows directly rather than through `SupermarketLocationService`, so it applies
section 5 itself. That includes the two reference stores, whose `STORE` scopes were keyed by slug
and are now keyed by shop id. Keyed by slug, an admin edit of their stack would have added a
second store scope beside the first.

## 5. Every shop holds its `STORE` scope

**The rule: a shop's stack always contains the `STORE` scope whose `externalKey` is the shop's
id, and no request can remove it.**

- **Create.** `create` calls `ensureStoreScope` always, and the stack written is the named scopes
  plus that one. A request that names no scope gets the `STORE` scope alone, which is today's
  behaviour.
- **Update.** When a request names a stack, `update` adds the shop's `STORE` scope to it before
  `writeStack`, calling `ensureStoreScope` so a shop created before this plan gains one. A request
  that names only other scopes is not an error: the store scope is implied, the same way it is on
  create.
- **The empty stack refusal stays.** `priceScopeIds: []` is still "A shop must sell at one scope
  at least", because an explicitly empty list is a caller that thinks it is removing everything.
- **Naming the `STORE` scope of a different shop is refused.** `requestedStack` checks the chain
  today. It also refuses a `STORE` scope whose `externalKey` is not this shop's id, with a
  `ValidationException` that names the scope, because a shop quoted from another shop's hand
  entered prices is a mistake nobody makes on purpose.
- **Order is still priority.** The stack is ranked by `priority`, so where the store scope sits in
  the request decides nothing.

`writeStack` already recomputes the inherited prices of every scope in the new stack, so a shop
that gains a warehouse after its store scope inherits the warehouse's prices through the existing
path.

**The harvester needs no change for this.** `DiscoveredPlaceService.promote` sends the declared
warehouse as `priceScopeId`, and the catalog adds the store scope beside it.

## 6. A declared key that names another kind

`RunScopeResolver.load` keys a chain's scopes by `externalKey` only. Once warehouses and offer
regions can be different kinds of the same chain, a declaration of `LOCAL_AREA 4661` finding an
existing `REGION 4661` is a disagreement, not a match.

`declare` compares the found scope's kind with the declaration's. **A mismatch is a run warning
naming the key and both kinds, and the existing scope is still used.** It is not an error, because
a run that stops over a label loses a whole walk, and it is not silent, because the operator has to
fix the row by hand. The warning code is `SCOPE_KIND_MISMATCH` on the run's existing warnings list.

## 7. The price scopes list filters by kind

Section 5 gives Mercadona about 1,675 `STORE` scopes beside its 255 warehouses. The back office
reads a chain's scopes a page at a time and stops at 500 (`MAX_SCOPE_PAGES` in `runs-page.ts`), so
a list that returns every kind hides warehouses behind shops.

`ListPriceScopesQueryDto` gains `kind`, repeatable, validated against `PriceScopeKind`, and the
catalog list query applies it as `kind IN (...)` beside `supermarketId`. No `kind` means every
kind, which is today's answer.

## 8. What this plan does not do

- It does not create `REGION` scopes for Mercadona. The owner creates chain regions by hand when
  needed, and plan 0118 is how a walk writes to them.
- It does not change how a price is chosen between tiers. That is plan 0117.
- It does not add a back office control for the stack. That is admin plan 0028.

## 9. Tests

- **Contracts.** `harvest.messages.spec.ts` asserts Mercadona's band is `LOCAL_AREA..LOCAL_AREA`.
  A spec asserts `DEFAULT_SCOPE_PRIORITY` still orders STORE < LOCAL_AREA < REGION < NATIONAL.
- **Migration.** A migration spec in the style of the existing ones: the type's values after
  `up` are `NATIONAL, REGION, LOCAL_AREA, STORE`, and `down` renames back.
- **Document.** A version 2 document declaring `kind: 'POSTAL_CODE'` validates and imports as a
  `LOCAL_AREA` scope. An export writes `LOCAL_AREA`.
- **Stack.** `supermarket-location.service.spec.ts`:
  - create with a named warehouse writes a stack of the warehouse and the new store scope.
  - create with no scope writes the store scope alone.
  - update naming only a region keeps the store scope in the stack.
  - update on a shop with no store scope creates one.
  - update naming another shop's store scope is refused.
  - `priceScopeIds: []` is still refused.
- **Resolver.** A declaration whose key exists under another kind resolves to the existing scope
  and records `SCOPE_KIND_MISMATCH`.
- **Runners.** Both Mercadona runner specs assert `LOCAL_AREA` declarations.
- **List.** `kind=LOCAL_AREA&kind=REGION` answers only those kinds, and no `kind` answers all.
- **Integration.** One catalog integration spec creates a shop with a warehouse, writes a price at
  the warehouse, and reads the shop's materialized price through its store scope.

## 10. Acceptance criteria

- [ ] `PriceScopeKind` has `LOCAL_AREA` and no `POSTAL_CODE`, and the Postgres type matches after the
      migration.
- [ ] `SCOPE_ORIGINS` still contains `POSTAL_CODE`, unchanged.
- [ ] Mercadona store discovery and catalog walks declare `LOCAL_AREA` scopes, and the capability
      band is 200..200.
- [ ] The reference seed writes `4661` as `LOCAL_AREA` at 200, by the same id.
- [ ] Every create and every stack update leaves the shop holding its own `STORE` scope.
- [ ] A shop cannot be given another shop's `STORE` scope.
- [ ] A version 2 document with `POSTAL_CODE` still imports.
- [ ] A kind mismatch on a declared key is a run warning, not a failure.
- [ ] The price scopes list accepts a repeatable `kind` filter.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and their specs pass.

## 11. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-catalog
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test
```

The catalog integration spec needs its own target and a database. Run it against an ephemeral
slot as the memory note on backend spec traps describes.
