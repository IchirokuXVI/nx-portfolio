> **PR:** [#755](https://github.com/IchirokuXVI/nx-portfolio/pull/755)

# 0214: a product add merges by product, and a line carries its comment count

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Two majors of `docs/reports/2026-10-16-velista-e2e-slot1.md` are in
> the core lists service: F3.1 (a product that is already on the list, added by a person in
> the other locale, makes a second line) and F3.4 (comment counts vanish on reload, because
> the lines read has no count). An optional third item gives the group read a `hasLists`
> fact for F2.2. Velista `0158` consumes the count.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0207` (a line says whether it was named), velista `0144`,
> `apps/luna-shopper-backend/core/src/app/lists/line-content.ts` (`lineIdentities`,
> `normalizeContent`), `line.service.ts` (`add`, `addMany`, `findAddTarget`,
> `findEarliestLines`, `list`), `line-named.ts`, `list.mappers.ts` (`toLineView`),
> `entities/line-comment.entity.ts`, and `LineView` in
> `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts`.

## Brief for the agent

### Objective

An add of a product set that an unnamed line already holds lands on that line whatever
name the adder's locale gave it, and every line of a lines read says how many comments it
has.

### Context

- **The composer sends the product's name in the viewer's locale with `named: false`**
  (`libs/velista/ui/src/lib/list/line-composer.ts:401-418`, `catalogName(..., this._locale())`).
  Plan `0207` adds the `named` flag beside `content` and never removes `content`
  (`line-named.ts:1-27`, `line.service.ts:1234`).
- **The merge key leads with the name.** `lineIdentities` (`line-content.ts:71-89`) builds
  every key as `normalizeContent(content) + "\u0000" + group:|set:|text`. `add`
  (`line.service.ts:913-930`) looks the target up through `findAddTarget` (`:1351`) and
  `findEarliestLines` (`:1366-1415`), whose `select` has `content, itemSetHash,
  productGroupId` and no `named` (`:1378-1386`). So "Eggs" with set S never meets "Huevos"
  with set S, while "huevos" does because `normalizeContent` folds case and accents
  (`:36-43`).
- **The client already decides "already in your list" by product.**
  `libs/velista/models/src/lib/catalog-holdings.ts:102-118` filters on
  `itemIds.includes(itemId)`. The card and the server disagree, which is the defect.
- **The lines read has no comment count.** `list` (`line.service.ts:3246-3290`) reads a page
  and then three batched queries (`:3269-3273`: sets, settlements, claims). `toLineView`
  (`list.mappers.ts:103-142`) has no comment field. `LineComment` is indexed on `lineId`
  (`line-comment.entity.ts:16-19`, `ix_comments_line`), so a fourth batched count is cheap.
  `comment.service.ts` has no delete, so a plain count is right.
- **`toLineView` is also the payload of `line.added` and `line.updated`**
  (`line.service.ts:972-980`, `:2812`). A required count on `LineView` would force a count
  query onto every write.
- **Velista reads the count only from events.** `mappers.ts:357` (`toLine`) has no field,
  `line-store.ts:1337-1343` increments only a count it already knows, and the doc comments at
  `line-store.ts:1043-1047` and `models/src/lib/list-view.ts:248-254` say "nothing on the
  wire".
- **The group read has no total list count.** `zone.messages.ts:102-106` says `listCount`
  counts lists the caller may read, and the `hasLists` fact is deferred in the doc at
  `:109-113`. Staff read every list (`list-access.service.ts:112`), so for them zero
  readable means zero lists; a plain member cannot tell.

### Target state

1. `lineIdentities` takes `named`. For a line with `named === false` that has a set or a
   group, the key is `set:<hash>` or `group:<id>` with no name part. Named lines and text
   lines keep today's keys. `findEarliestLines` selects `named`, and `add` and `addMany`
   pass `req.named`.
2. `LineView` gains `commentCount: number | null`. `list` fills it from one batched
   `SELECT "lineId", count(*) ... GROUP BY 1` over the page's line ids. Event payloads carry
   `null`, which means "unknown", and the contract doc says so.
3. Optional, if it fits in the same PR without a second migration: the zone read gains
   `hasLists: boolean`, true when the zone has at least one list whatever the caller may
   read. The doc at `zone.messages.ts:109-113` is updated.
4. The OpenAPI document and the admin wire types are regenerated.

### Scope

- `apps/luna-shopper-backend/core/src/app/lists/line-content.ts` (a new `line-content.spec.ts`
  beside it, none exists), `line.service.ts`, `list.mappers.ts`, and the specs
  `line-add-merge.spec.ts`, `line-named.spec.ts`, `line-named.integration.spec.ts`.
- `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts` and
  `src/schemas/messages/list.schemas.ts` (`LineView`), and the zone messages if item 3 is
  built.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, regenerated.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- An unnamed product add does **not** land on a line that somebody named, even with the
  same set. A named line is a person's own words, and the owner has not decided otherwise.
  Record this as a decision for the owner in "What the build decided".
- `commentCount` is nullable so that no write path pays for a count.
- Regenerate, never edit, the two generated files. Then `npx nx build luna-shopper-admin`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you add a column, a migration, or a
  change to `normalizeContent`.
- If `lineIdentities` has a caller outside `line.service.ts` (the doc at `line-content.ts:9`
  names `baskets/line-dedup.ts`, and grep found no importer), stop and report it before you
  change the key shape.

### Progress evidence

- New specs, each failing before the change:
  - an unnamed add with set S in locale en lands on the unnamed line with set S created in
    locale es, and the quantity rises by one;
  - an unnamed add with set S does not land on a named line with set S;
  - a text add still merges by folded name;
  - a lines read answers `commentCount` 2 for a line with two comments and 0 for one with
    none;
  - a `line.added` payload carries `commentCount: null`.
- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
  passes, including `openapi-document.spec.ts` and `wire-types.spec.ts`.
- `npx nx build luna-shopper-admin` passes.

## 1. Not in this plan

- Reading `commentCount` in velista and drawing the badge after a reload. Velista `0158`
  does that, and it needs this plan first.
- The catalog page's name based `addedToLine` (`catalog-holdings.ts:149-157`), which has
  the same locale fault on the client. Velista `0158` notes it.

## 2. Choices that are mine

- **The key, not a second lookup.** Dropping the name part of the key for unnamed product
  lines is one function and one `select`. A second lookup by set would add a path that the
  existing merge specs do not cover.
- **Nullable on events.** The alternative, a page level map of counts, is harder for the
  client to apply per line.

## What the build decided

The build of 2026-10-18 settled the points below. Each one is a choice of the builder that
the owner can overturn, except the first, which is the owner's to decide. Where this section
and a section above disagree, this section is right.

1. **The plan landed in two PRs.** Items 2 and 4 (the comment count on `LineView` and its
   contract, schema, OpenAPI document and wire types) are in PR #755. Item 1 (the merge key)
   is built in PR #752, which is now a draft and waits on the owner.
2. **Owner decision, open: the merge key of item 1.** Migration
   `1756003900000-LineNamed.ts` defaulted every existing row to `named = true`, and velista
   sends `named: false` on every product add. So every line made before plan `0207` is
   named, and the key as specified (an unnamed product line is met by `set:<hash>` or
   `group:<id>` alone, never by its name) stops the same name merges on those lists: an
   add of "Huevos" from the composer makes a second line beside the old "Huevos" line of
   the same product, where today it merges. The owner has two options:
   - (a) land #752 as written and accept the duplicates on old lists;
   - (b) let an unnamed add also match a named line whose folded name equals the add's.
     That keeps today's same name merge and still never joins "Eggs" to "Huevos".
3. **`toLineView` takes the count as an optional fifth argument that defaults to null.**
   The other arguments of that mapper have no default on purpose. Null is the truth for
   every caller except the lines read, so a default here cannot hide a wrong answer, and
   it keeps the basket, settlement and group sync callers unchanged.
4. **The count is raw SQL** (`count(*)::int ... WHERE "lineId" = ANY($1::uuid[]) GROUP BY 1`)
   beside the settlement summary, run in the same `Promise.all` as the three other page
   reads. A line with no row answers 0.
5. **The schema states `commentCount` as required, `['integer', 'null']`, minimum 0.**
6. **Item 3 is not built.** `hasLists` needs a second count in the zone summary query,
   whose index plan `zone-summary.integration.spec.ts` asserts with EXPLAIN, plus the
   summary reader, the zone counts broadcast and the zone schemas. That is a second query
   pattern outside the scope of this plan. It can be its own plan.
