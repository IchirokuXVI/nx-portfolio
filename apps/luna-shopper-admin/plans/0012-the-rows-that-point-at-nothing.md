# 0012 The rows that point at nothing

Every list in the back office narrows by a reference picker: products by their group, zones by a
person, shops by their chain. A picker answers one question, "which one". There is a second question
it cannot ask: "which rows have none". A product that belongs to no group is the ordinary state of a
freshly harvested one. A zone with no owner is what deleting an owner leaves behind. Both are rows an
operator opens the back office to find, and neither had a filter.

The product list had a workaround: a boolean filter, `withoutProductGroup`, drawn beside the group
picker. It answered the question for one column of one table. This plan retires that shape, because
a second control per nullable reference is a control the next table forgets.

Depends on `0004` for the reference picker and the filter descriptors. Depends on `0007` for the
people screens and on `0005` for the catalog screens, whose descriptors it edits.

## 1. What the request was, and what an orphan is

The request named memberships: the membership list cannot be read without a zone, and there is no
way to ask for the memberships that have none. That example is the one place the question has no
answer, and section 4 says why. What it pointed at is real everywhere else. A reference column that
is nullable holds rows that point at nothing, and the back office had no general way to list them.

The rule this plan fixes is small. **A reference filter over a nullable column offers "none" as one
of its choices**, in the same list as the rows it finds. Choosing it lists the rows whose column is
empty. Nothing else changes about the picker, the filter, the store or the list.

## 2. One choice in the picker, one literal on the wire

The reference filter descriptor gains `nullable: true`
(`libs/luna-shopper-admin/models/src/lib/resource/resource-descriptor.ts`). It is declared per
filter and never assumed. The question only has an answer over a column that can be null, and the
gateway route has to accept the literal before the screen sends it. A filter without the flag is
exactly what it was.

`ResourceFilters` passes the flag to the picker as `none`. The picker
(`libs/luna-shopper-admin/ui/src/lib/resource/reference-picker.ts`) then starts its list with a
"None" choice **while the search box is blank**. Once a term is typed the choice withdraws. A typed
word is a search for a row by name, and the absence of a row has no name to match. Under a term,
"None" reads as "nothing matched", which is a different sentence and already has one. The choice
survives an empty result, so a resource with no rows at all can still be asked the question.

Choosing it holds `REFERENCE_NONE`, the literal `none`
(`libs/luna-shopper-admin/models/src/lib/resource/reference-none.ts`), as the filter's value. The
picker draws it by name like any other choice and never resolves it. There is nothing to look up and
nothing to be missing. Clear works on it as on any value.

**The literal goes on the same query parameter a uuid goes on.** `productGroupId=none` is the
products in no group. `ownerUserId=none` is the zones nobody owns. An absent parameter already means
"any", so a filter cannot spell "none" by leaving itself out. A second boolean parameter per
reference is what the introduction retired. The literal is safe as a sentinel because no uuid can
equal it. It is a word rather than an empty string because an empty string is what an unset filter
holds. The store and `toParams` carry it unchanged, which is the point: nothing between the picker
and the gateway knows the value is special.

The gateway is where the literal stops.
`apps/luna-shopper-backend/gateway/src/app/admin/reference-none.ts` holds the validator,
`IsUuidOrNone`, and `referenceFilter(value)`. The second splits a parameter into the uuid it named
or the fact that it asked for none. A route maps that fact onto the flag its service already speaks:
catalog's `withoutProductGroup`, core's `withoutOwner`. **The services keep their own vocabulary.**
The contracts keep their reasoning for a flag beside the id rather than a null id, and that reasoning
still holds one hop further in. Anything that is neither a uuid nor the literal is a 400, as before.

The form picker is not touched. A nullable field already has "clear", which submits null. The two
are different acts: clearing a field empties one row, and filtering to none asks for every row that
is already empty. Nothing sets `none` on a form control.

## 3. Where it is switched on

**Products, by group.** `productGroupId` on `ITEMS` becomes `nullable: true`. The boolean
`withoutProductGroup` filter and its label are removed from the descriptor. The gateway's
`AdminSearchItemsQueryDto` drops the boolean parameter and takes the literal on `productGroupId`
instead. The controller turns it back into the `withoutProductGroup` flag that `ItemSearchRequest`
has always carried, so catalog is not changed. A stale client that still sends the boolean gets a
400 from the whitelist pipe, which is the honest answer to a parameter that no longer exists.

**Zones, by owner.** `zones.ownerUserId` is null from the moment an owner is deleted until somebody
claims the zone. That is the one orphaned row the people screens can hold. The zone list had no
owner filter, only `userId`, which matches an owner **or** a member of any status. "None" on that
filter means a zone nobody is in at all, which is not the question. So `ZONES` gains a second
reference filter, `ownerUserId`, marked `nullable: true`, beside the first rather than instead of
it. `ListAdminZonesRequest` gains `ownerUserId` and `withoutOwner`. `AdminZoneService.list` adds one
clause for each, applied beside the person filter, so that asking for two things at once answers
with their intersection. The positive half, "zones this person owns", comes along because the picker
needs something to be "none" of. It is a narrower question than the existing filter, and the
contract says so.

## 4. Where it is not, and why

**Memberships.** `zone_memberships.zoneId` is not nullable and the row is deleted with its zone. A
membership with no zone does not exist, so a "None" choice on that filter is a choice whose only
answer is an empty list. The request possibly also meant reading memberships across every zone. That
is a different feature. There is no flat membership route (`0009`, section 3.2), the collection is
addressed under its zone, and `requires` is what says so on the screen. Adding one is a gateway
route, a core read and a descriptor change, and it is not what "orphaned" means.

**Every other reference filter.** Shops by chain and by scope, prices by product and by scope,
lists by zone and by author, baskets by owner, lines by list: each of those columns is `NOT NULL`.
None of them is marked and none offers the choice. The flag is the whole switch. When a column
becomes nullable, or a new resource has one, the entire change is to mark its filter and to accept
the literal on its route. Section 6 says what proves it.

## 5. The memory gateway

`ResourceMemoryGateways` reads the same literal, so a screen filtered to none can be driven with no
backend. `none` on a parameter the row carries as a column matches the rows where that column is
null or absent. A parameter that is not a column, a search box, keeps the substring rule. An
operator can still type the word "none" into one.

## 6. Testing

- `reference-picker.spec.ts`: the choice is absent unless asked for. It is listed first while the
  box is blank. It withdraws under a term. It survives an empty result. Choosing it emits the
  literal. A held literal is drawn by name without a lookup and can be cleared.
- `resource-filters.spec.ts`: the descriptor's flag reaches the picker, and only for the filter
  that carries it.
- `resource-memory.spec.ts`: the literal on a column matches the empty rows, and on a search box
  it is a word.
- `catalog-descriptors.spec.ts` and `people-descriptors.spec.ts`: the group filter is nullable and
  the boolean is gone. The owner filter is the only nullable one on zones.
- `catalog-admin-query.http.spec.ts` and `admin-core-query.http.spec.ts`: over real HTTP, because
  the pipe validates the whole query object. A uuid passes through as the id. The literal becomes
  the flag with no id. Anything else is a 400. The retired boolean is a 400. The person filter on
  zones does not take the literal.
- `admin-zone.service.spec.ts`: the owner clause, the null clause, and that an unset flag adds no
  predicate.

## 7. Exit criteria

- On the product list, the group picker offers "None" before anything is typed, and choosing it
  lists the ungrouped products. There is no separate "belongs to no group" control.
- On the zone list, an "Owned by" picker offers "None", and choosing it lists the zones with no
  owner.
- A reference filter without `nullable: true` looks and behaves exactly as before.
- `openapi.json` and `wire-types.ts` are regenerated and committed. The gateway's document spec
  passes.
