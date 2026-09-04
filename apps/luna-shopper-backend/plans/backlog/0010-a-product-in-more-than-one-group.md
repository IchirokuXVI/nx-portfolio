# 0010 (backlog) A product in more than one group

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: medium.** Nothing is broken today and no shipped screen is empty because of this,
> which is what keeps it below `0009`. What it costs is a curation decision that should not have
> to be made: with one group per product, an owner who creates **Skimmed Milk** takes those
> cartons out of **Milk**, so the broad group a shopper actually types stops holding the products
> the narrow group claimed. The owner is pushed toward one flat layer of groups, and the flat
> layer is the thing the whole design was meant to grow out of. That is a real limit on curation
> rather than a defect, so it sits above `0005` and `0008` and below `0009`.

## 1. What exists today

`Item.productGroupId` is one nullable `uuid` column
(`apps/luna-shopper-backend/catalog/src/app/entities/item.entity.ts`), with a foreign key to
`product_groups` and `ON DELETE SET NULL`. There is no join table, so a product belongs to one
group or to none, and the "or none" is the resting state of a freshly harvested product.

Four things read that column, and only one of them is a plain filter:

- **The search documents.** `catalog_refresh_item_search`, installed by
  `1756200000000-CatalogSearchAndProductGroups.ts`, is a `BEFORE INSERT OR UPDATE ON "items"`
  trigger that reads `NEW."productGroupId"`, loads that group's name and synonyms, and folds them
  into `search_en` and `search_es` at weights C and D. This is what makes `leche` reach a carton
  whose name never says `leche`.
- **`catalog_refresh_group_members`**, an `AFTER UPDATE ON "product_groups"` trigger that rewrites
  every member's document when the group is renamed or given a synonym. It does that with a no op
  self assignment, `UPDATE "items" SET "productGroupId" = "productGroupId"`, so the document is
  built in exactly one place.
- **`ItemService`**: the `productGroupId` filter and the `withoutProductGroup` filter, on both the
  ranked and the ordinary branch (`item.service.ts:632`, `:639`, `:732`, `:737`); `membersOf`,
  which caps each group's membership in the database with `PARTITION BY i."productGroupId"`
  (`:490`); and the lateral in `searchOffers` that finds a group's cheapest priced member
  (`:370`).
- **`CatalogEventsPublisher.itemGroupChanged`**, which announces a membership change to core so a
  subscribed line gains or loses the product (plan 0070).

Assignment happens in one place, `ItemService.resolveGroup` (`:772`), called from `create` and
`update`. Nothing else writes membership, and nothing assigns it automatically: the matching
ladder that would let a harvest run classify what it finds is backlog `0001` section 6.2.

## 2. What changes, and the design that was not chosen

**A product may belong to any number of groups, including none.** Hacendado skimmed milk is a
member of **Milk** and of **Skimmed Milk**, and both groups compare it against their own members
in their own reference unit.

There were two ways to get there.

**A parent pointer on `product_groups`.** `parentId` plus a materialized path, membership stays a
single column, and "the members of Milk" means the subtree. It is cheaper: one column, one event
shape, and the rule that a product has exactly one most specific group survives untouched.
Backlog `0001` section 3.1 already designs that tree for categories.

**A join table**, which is this plan. It is chosen because a hierarchy answers one shape of
overlap and the owner wants the general one. **Lactose Free** and **Organic** cut across **Milk**
rather than sitting under it, and a product is in both and in neither's ancestor chain. A tree
cannot express that without duplicating the product into a second tree.

The two compose rather than compete, and this order is deliberate: the join table is what makes
overlap possible at all, and a parent pointer added later would only save curation effort by
computing the broad membership from the narrow one. **Until then membership does not propagate.**
Putting a carton in Skimmed Milk does not put it in Milk, and an owner curating the narrow group
has to tick the broad one too. Say so on the admin screen rather than inferring it, because a
membership the owner did not choose is the thing the whole surface is trying to avoid.

## 3. The table and the migration

```sql
CREATE TABLE "item_product_groups" (
  "itemId"         uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "productGroupId" uuid NOT NULL REFERENCES "product_groups"("id") ON DELETE CASCADE,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("itemId", "productGroupId")
);
CREATE INDEX "ix_item_product_groups_group" ON "item_product_groups" ("productGroupId");
```

The composite primary key is the uniqueness rule: a product is in a group once, and a second
insert is a no op rather than a duplicate row. The index on the group is what keeps the lateral in
section 5 as cheap as the partial index on `items` it replaces.

`ON DELETE CASCADE` on the group side replaces the old `SET NULL`, and the observable behaviour is
the same one plan 0048 argued for: deleting a group deletes memberships and leaves every product
where it is. `ProductGroupService.delete` still publishes `productGroupDeleted` afterwards, for
the reason plan 0070 section 5 gives, which the database cascade does not change.

`createdAt` is not decoration. It is what the **down** migration reads:

```sql
INSERT INTO "item_product_groups" ("itemId", "productGroupId")
  SELECT "id", "productGroupId" FROM "items" WHERE "productGroupId" IS NOT NULL;
ALTER TABLE "items" DROP COLUMN "productGroupId";
```

going back means picking one membership per product, and the oldest is the only defensible pick:

```sql
SELECT DISTINCT ON ("itemId") "itemId", "productGroupId"
  FROM "item_product_groups"
 ORDER BY "itemId", "createdAt" ASC, "productGroupId" ASC
```

**The down migration is lossy and must say so in its own comment.** Every membership a person
added after the first one is dropped, and no rollback can recover it.

An explicit `ItemProductGroup` entity rather than a TypeORM `@ManyToMany`, because catalog reads
are raw SQL and every catalog write goes through `CatalogAuditService.write`, which takes an
entity and a before and after pair. A membership add is a curation decision and belongs in the
audit trail like every other one.

## 4. The search documents, which is the part that is not a rename

This is the half that is not a mechanical substitution, and it is worth reading before estimating
the work.

`catalog_refresh_item_search` is a row trigger on `items`, so **after the change it can no longer
see the membership on INSERT**: the item row is written first and the membership rows after it.
The document is therefore built in two moments, and the trigger has to be correct at both.

- **On `items`**, the trigger keeps writing weights A and B from the product's own name and brand,
  and fills C and D by aggregating whatever memberships exist at that moment:

  ```sql
  SELECT string_agg(g."name" ->> 'en', ' '),
         string_agg(g."name" ->> 'es', ' '),
         string_agg("catalog_synonyms_text"(g."synonyms", 'en'), ' '),
         string_agg("catalog_synonyms_text"(g."synonyms", 'es'), ' ')
    INTO group_name_en, group_name_es, group_syn_en, group_syn_es
    FROM "item_product_groups" m
    JOIN "product_groups" g ON g."id" = m."productGroupId"
   WHERE m."itemId" = NEW."id";
  ```

  On INSERT that aggregates nothing and C and D are empty, which is correct: at that instant the
  product is in no group. `NEW."id"` is available because column defaults are applied before a
  `BEFORE INSERT` trigger fires.

  **No `ORDER BY` on the aggregates.** `to_tsvector` normalizes and sorts its lexemes, so the
  concatenation order cannot change the stored value, and an ordering added for tidiness would
  only be a cost per write.

- **On `item_product_groups`**, a new `AFTER INSERT OR DELETE` trigger re-touches the product so
  the same function rebuilds the document. The self assignment has to target a column that still
  exists, so it becomes `UPDATE "items" SET "id" = "id" WHERE "id" = ...`, which is the same no op
  shape the existing group trigger uses.

  A cascading delete does fire row triggers on the child table, so deleting a group drops its
  words out of every member's document with no extra work. **Prove that in the migration
  integration spec rather than assuming it**, because it is the one behaviour here that comes from
  Postgres rather than from code in this repository.

- **`catalog_refresh_group_members`** reaches its members through the join table instead of the
  column. Its `IS NOT DISTINCT FROM` guard stays exactly as it is: a group saved with no change to
  its name or synonyms must not rewrite a document, and with several groups per product that write
  amplification is now multiplied by the membership.

One consequence to accept rather than fix: **a product in three groups carries three group
vocabularies at weights C and D**, which is the point, and it dilutes `ts_rank` a little for that
product. Weight D is the lowest band, and a product genuinely in three groups is genuinely
findable by three sets of words. If it proves to matter, the answer is a cap on groups per product
and not a change to the weights.

## 5. The reads in catalog

- **The filters** become an `EXISTS`, on both branches:

  ```sql
  EXISTS (SELECT 1 FROM "item_product_groups" m
           WHERE m."itemId" = i."id" AND m."productGroupId" = $1)
  ```

  and `withoutProductGroup` becomes the matching `NOT EXISTS`. Plan 0073 section 4 holds
  unchanged: the two filters together still answer with nothing, because "in this group" and "in
  no group" is still a contradiction.

- **`membersOf`** joins the membership table and partitions by `m."productGroupId"`. The cap stays
  in the database, and `LINE_ITEM_SET_MAX` still means "per group". A product that belongs to two
  groups on the same page appears in both member sets, which is correct: the sets answer two
  different questions and the composer already treats them independently.

- **The cheapest member lateral** in `searchOffers` joins through the table rather than testing
  `mi."productGroupId" = g."id"`. The same product can be the cheapest member of Milk and of
  Skimmed Milk on one page, and both rows are right.

- **`resolveGroup`** becomes `resolveGroups`, checking every id and rejecting the whole write if
  one is unknown. It stays the only place an assignment is made.

## 6. The event, and core

`ItemGroupChangedEvent` carries `from` and `to`, which is a statement about a move between exactly
two groups. It becomes two sets:

```ts
export interface ItemGroupChangedEvent {
  eventId: string;
  itemId: string;
  /** The groups it joined. */
  added: string[];
  /** The groups it left. */
  removed: string[];
}
```

**Still one event per item write, not one per membership.** Plan 0070's reason survives the shape
change: a re-curation that swaps a carton from Milk into Skimmed Milk must reach a line bound to
either group as a single consistent statement, and two events let a line see a moment where the
product is in neither group or in both.

In core, `ProductGroupSyncService.handleItemGroupChanged` loops `attach` over `added` and `detach`
over `removed` inside the transaction it already opens. Both helpers already take one group id, so
they are unchanged. The docstring's invariant holds and gets one more word: a line is bound to at
most one group, so **at most one entry across both sets** can touch any given line.

**Deployment order is not free.** Staging deploys only the affected services, so catalog can ship
without core. Core learns to read `added` and `removed` first, tolerating the old `from` and `to`
in the same release, and catalog starts emitting the new shape in a later one. The reverse order
drops membership changes on the floor for as long as the two versions disagree, silently, because
an unreadable field is not an error.

## 7. The wire, the admin surface and the generated files

`ItemView.productGroupId: string | null` becomes `productGroupIds: string[]`, and
`UpdateItemRequest.productGroupId` becomes `productGroupIds?: string[]`, where absent means
unchanged and `[]` means "in no group". The **filter** stays singular on both the public and the
admin read: filtering by one group at a time is what the screens ask for, and a multi group filter
has no caller.

Gateway controllers are versioned per controller, major only (plan 0004 section 4), so this is a
`v2` on the catalog controllers that expose an item. **It is cheap to take as a break rather than
an additive field**, because nothing reads the item side field today: velista maps it in
`libs/velista/data-access/src/lib/mapping/mappers.ts:555` into `CatalogItem.productGroupId`, and
no screen reads it. The reader in `select-line-page.ts:170` is the **line's** group binding, which
this plan does not touch. Drop the field from the velista model in the same change rather than
carrying an array nothing consumes.

Two more places, both easy to miss:

- **The admin descriptor.** `libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts`
  has one `ReferenceField`, and it holds a single uuid. Multi valued membership needs either a
  `multiple?: boolean` on that field or a new kind beside it, plus a picker that shows the current
  memberships as removable chips. `libs/luna-shopper-admin/feature-catalog/src/lib/items.ts` then
  declares it, in the form and in the table column list. This is descriptor machinery work and not
  a screen: it is the third widening of the contract admin plan 0004 introduced, so read what
  plans 0005 and 0007 did to it before adding a fourth shape.
- **The generated files.** `npx nx run luna-shopper-backend-gateway:openapi` and then
  `npx nx run luna-shopper-admin/models:wire-types`, committed in the same change. Both have specs
  that go red when they are stale.

## 8. What does not change

- **A line still follows exactly one group.** `ListLine.productGroupId` stays a single nullable
  column and plan 0070 stands entirely. A product in two groups reaches the lines of both, which
  is the intended effect and needs no change on the line side.
- **`groupItemIds`** on a line still means the members of that one group.
- **Nothing assigns membership automatically.** Curation only, through the admin surface, for the
  same reason as before.
- **`referenceUnit` stays on the group.** A product compared in litres inside Milk and in units
  inside a Breakfast group is exactly why the unit belongs to the group and never to the product.

## 9. Open questions

- **Does a membership need an order, or a primary flag?** Nothing needs one today: every read is
  per group, and a product's "main" group is a display concern no screen has. Add it when a screen
  asks, not before.
- **Is there a ceiling on groups per product?** Section 4 says the vector dilution is acceptable.
  Measure it on the seeded Mercadona catalog before deciding, because a real answer needs real
  membership counts and today every product has at most one.
- **Does the group tree from backlog `0001` section 3.1 subsume the curation cost?** If it lands,
  ticking Skimmed Milk could imply Milk. That is a follow up, and it does not change any of the
  work here.

## 10. Done means

- An owner can put one product into two groups from the admin item form, and take it out of one.
- Searching either group's words finds the product, and deleting one group leaves it findable by
  the other's words with no further write.
- Both groups' rows in `searchOffers` consider the product when finding a cheapest member.
- A line following either group gains the product when the membership is added, and loses it when
  that one membership is removed while the other stays.
- The migration is proven up **and down** against a throwaway Postgres, including the lossy pick
  in the down direction, before the change is opened.
- `openapi.json` and `wire-types.ts` are regenerated and committed.
