> **PR:** [#527](https://github.com/IchirokuXVI/nx-portfolio/pull/527)

# 0167: shop sections, and where a product is in a shop

> Needs `0166` first: a section covers categories, and a category has to be a row. Frontend
> half: velista `0120` (the aisles of the shop you are in). Back office half: admin `0037`.
> Followed by `0168` (a shop has a map), which writes a shop's section order and its per
> shop pins from an accepted map, and adds step 1.5 to the rule of section 3.
> Reads beside it: `0163` (the basket read at a shop, which is where a product's sections are
> served) and `0141` (the walk order learned from sessions, which this plan does not replace).
>
> Prerequisite reading: `0166` sections 1 to 3 (the tree and the wire), `0012` and `0038`
> section 5.2 (`positionInStore` and the split of `supermarket_location_items`), `0163`
> section 2 (what the basket read answers per product at a shop), `0110` and `0141` (why the
> order inside an aisle is learned and not configured), and velista `0077` (the aisle view).

The app's categories are one taxonomy for everybody. A shop is laid out by whoever laid it
out: Mercadona has a "Charcutería" wall and a "Platos preparados" fridge, LIDL has a bakery
by the entrance and a middle aisle of whatever is on offer this week, and a small shop has
six aisles with no names at all. A shopper standing in one of them wants the basket cut the
way the shop is cut, not the way the taxonomy is.

This plan records that cut. A **section** is a chain's own aisle name, mapped onto the app's
categories. A **location** says which of its chain's sections it has and in what order. A
**pin** says that in this chain a given product is in one section and not in the others its
categories put it in. From those three, one read rule answers "where is P in shop S",
and the rule falls back to the product's own categories when the shop has said nothing.

The product's example, stated against `0166`'s taxonomy: a frozen pizza carries
`frozen-meals-and-pizzas` and `pizzas`. A shop has a "Pizzas" section covering the leaf
`pizzas` and a "Frozen" section covering the root `frozen`. The pizza is in both, which is
the default and needs no configuration. If that shop keeps every pizza in the "Pizzas"
section, one pin per pizza says so, and the pizza leaves "Frozen". A shop whose sections are
not mapped at all shows the pizza under its two categories, as if the shop did not exist.

## Brief for the agent

### Objective

Add sections per chain, each covering categories. Record per location which sections it has
and in what order. Let a product be pinned to sections within a chain. Answer, for every
product in a basket read at a shop, which of that shop's sections it is in, by the rule of
section 3.

### Context

- **Chains and locations** are `supermarkets` and `supermarket_locations` in catalog
  (`catalog/src/app/entities/supermarket*.entity.ts`). `supermarket_location_items` is unique
  per product and location and carries the free text `positionInStore` and the availability
  columns of `0084`. `supermarket_items` is the per chain presence.
- **Categories** are `categories` and `item_categories` after `0166`: two levels, a product
  only on leaves, and `ix_item_categories_category`.
- **The basket read at a shop** (`0163`): `BasketController.get` in the gateway composes core's
  rows with catalog's products, and with a shop it already asks catalog for the shop's scope
  stack and availability. The read's products are `BasketProductView[]`, which extends
  `ItemView`.
- **The walk order** (`0141`) orders rows on read from the owner's past sessions. It is an
  order of rows, not of aisles, and inside any grouping the client keeps the incoming order.
- Admin routes under `/v1/admin/catalog/**` are not uniform CRUD (locations are listed and
  created under their chain, read at `/locations/{id}`). The new routes follow the same
  pattern.

### Target state

- Tables `supermarket_sections`, `section_categories`, `location_sections` and
  `supermarket_item_sections` exist with the rules of sections 1 and 2.
- `GET /v1/catalog/locations/:id/sections` answers the shop's sections in order, each with
  the categories it covers, and says whether the list is the shop's own or the chain's
  default.
- The basket read at a shop carries `sectionIds: string[]` on every product, computed by the
  rule of section 3 in one query per read.
- The admin routes of section 4 exist. `openapi.json` and `wire-types.ts` are regenerated.
- A spec against real Postgres proves each branch of the rule of section 3.

### Scope

Work only in:

- `apps/luna-shopper-backend/catalog/src/app/entities`, `db/migrations`, a new
  `catalog/section.service.ts` with its NATS handlers, and `catalog.mappers.ts`
- `libs/luna-shopper/contracts` (messages and schemas for sections, and `sectionIds` on the
  basket product view)
- `apps/luna-shopper-backend/gateway/src/app/catalog` (public and admin controllers and DTOs)
  and `gateway/src/app/baskets/basket-catalog.service.ts` for the one extra call
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, the admin app beyond the regenerated wire types, the walk order,
`positionInStore`, availability, prices, or the item search.

### Constraints

- **A section belongs to one chain, and a location only lists its own chain's sections.**
  Enforced by a trigger on `location_sections` and on `supermarket_item_sections`, because
  a foreign key cannot say it.
- **A section covers a root to mean all its children.** The read rule expands it. A section
  covering a leaf covers that leaf alone.
- **No configuration means the chain's default.** A location with no `location_sections`
  rows has every section of its chain in the chain's order. There is no "this shop has no
  sections" state, because such a shop shows plain categories through the fallback anyway.
- **The rule never infers availability.** A product no section covers is still sold at the
  shop. It is shown under its own categories. `0163` and backlog `0016` own availability.
- **One query per read**, over the read's product ids, not one per product.
- Only make changes directly requested. Do not build per location pins, a section walk
  order learned from sessions, or an aisle number on a section.

### Action boundaries

Stop and ask before:

- adding a per location pin (section 6 explains why the pin is per chain first)
- deleting `positionInStore` or migrating its text into sections
- changing the walk order of `0141`
- letting a section cover a category of another chain's mapping table, if `0166` section 11
  is decided in favour of one table

### Progress evidence

After each numbered section, state what was built and paste the output that proves it:

- The migration up and down on an ephemeral Luna slot.
- The rule spec of section 3 against real Postgres: a pinned product, a pinned product whose
  section the shop lacks, a product covered through a root, a product covered through a
  leaf, a product nothing covers, a shop with no configuration, and a shop with two chains'
  sections refused by the trigger.
- `EXPLAIN` of the read of section 3 for 100 products at one shop.
- The basket read at a shop over HTTP with `sectionIds` on its products.
- The regenerated documents.

## 1. The tables

```
supermarket_sections
  id              uuid PK
  supermarketId   uuid FK supermarkets(id) ON DELETE CASCADE
  slug            varchar          UNIQUE (supermarketId, slug)
  name            jsonb            LocalizedText
  position        int NOT NULL     the chain's default order
  createdAt, updatedAt

section_categories
  sectionId       uuid FK supermarket_sections(id) ON DELETE CASCADE
  categoryId      uuid FK categories(id) ON DELETE RESTRICT   a root or a leaf
  PRIMARY KEY (sectionId, categoryId)
  INDEX ix_section_categories_category (categoryId)

location_sections
  supermarketLocationId  uuid FK supermarket_locations(id) ON DELETE CASCADE
  sectionId              uuid FK supermarket_sections(id) ON DELETE CASCADE
  position               int NOT NULL     this shop's order
  PRIMARY KEY (supermarketLocationId, sectionId)
  trigger: the section's supermarketId equals the location's supermarketId

supermarket_item_sections           the pin
  supermarketId   uuid FK supermarkets(id) ON DELETE CASCADE
  itemId          uuid FK items(id) ON DELETE CASCADE
  sectionId       uuid FK supermarket_sections(id) ON DELETE CASCADE
  PRIMARY KEY (supermarketId, itemId, sectionId)
  INDEX ix_item_sections_item (itemId, supermarketId)
  trigger: the section's supermarketId equals supermarketId
```

A section has a slug because the back office will import a chain's aisle list from a file
one day, and because two sections named "Frescos" in one chain is an operator error worth
refusing. A section's `position` is the chain's default order, which a location overrides
with its own rows.

## 2. Three writes, and what each one means

| Write | Means |
| ----- | ----- |
| a section with categories | "this chain has an aisle called X, and it holds these kinds of product" |
| a location's ordered section list | "this shop has these of its chain's aisles, walked in this order" |
| a pin of a product to sections in a chain | "in this chain, this product is in these aisles and no other" |

Deleting a category a section covers is refused by `0166`'s R4 (`CATEGORY_IN_USE`), the same
as deleting one a product carries. Deleting a section cascades out of the location lists and
the pins, because a section that no longer exists cannot be a place.

An empty pin set is not a state: putting a product's pins to an empty list deletes its rows
and returns it to the default rule.

## 3. The rule

For a location `S` of chain `C` and a product `P` with leaf categories `L(P)`:

1. **Present sections.** The sections of `S` in `location_sections` order. If `S` has no
   rows, every section of `C` in `position` order.
2. **Pinned.** If `supermarket_item_sections` has rows for `(C, P)`, the answer is those
   sections that are present. If none of them is present, continue: a pin to an aisle this
   shop does not have says nothing about this shop.
3. **Covered.** The present sections with a `section_categories` row whose category is in
   `L(P)` or is the parent of a category in `L(P)`.
4. **Nothing.** An empty list. The client shows `P` under its own categories.

The answer is an ordered list of section ids, in the present order. It is computed for every
product of a basket read in one statement: present sections as a CTE, pins joined on the
read's product ids, coverage joined through `item_categories` and `categories`, and a
`COALESCE` of the two per product. It is served on the basket read only, because the basket
at a shop is the one screen that stands inside a shop. The catalog tab browses chains, not
shops, and does not get it.

A product in two sections is in both on purpose: either its two categories are covered by two
aisles, or somebody pinned it to two. The client draws it in each.

## 4. The wire

```ts
export interface SupermarketSectionView {
  id: string;
  supermarketId: string;
  slug: string;
  name: LocalizedText;
  position: number;
  categoryIds: string[]; // roots and leaves, as written
}

export interface LocationSectionsView {
  sections: SupermarketSectionView[]; // in this shop's order
  /** `LOCATION` when the shop has rows of its own, `CHAIN` when it inherits the chain's list. */
  source: 'LOCATION' | 'CHAIN';
}

// BasketProductView, on a read with a shop; absent on a read without one
sectionIds?: string[];
```

| Route | Answers |
| ----- | ------- |
| `GET /v1/catalog/locations/:id/sections` | `LocationSectionsView` |
| `POST /v1/admin/catalog/supermarkets/:id/sections` | create: `slug`, `name`, `categoryIds`, optional `position` |
| `GET /v1/admin/catalog/supermarkets/:id/sections` | the chain's sections in `position` order |
| `GET /v1/admin/catalog/sections/:id` | one section |
| `PATCH /v1/admin/catalog/sections/:id` | `name`, `position`, `categoryIds` (replaces the set) |
| `DELETE /v1/admin/catalog/sections/:id` | cascades, see section 2 |
| `GET /v1/admin/catalog/locations/:id/sections` | `LocationSectionsView`, the same as the public read |
| `PUT /v1/admin/catalog/locations/:id/sections` | `{ sectionIds: string[] }` in order; an empty array deletes the rows and returns the shop to the chain's default |
| `GET /v1/admin/catalog/supermarkets/:id/item-sections?itemId=` or `?sectionId=` | the pins of a product in the chain, or the products pinned to a section |
| `PUT /v1/admin/catalog/supermarkets/:id/item-sections` | `{ itemId, sectionIds: string[] }`, replaces the pins; empty removes them |
| `GET /v1/admin/catalog/locations/:id/item-sections?itemIds=` | the rule of section 3 for named products, for the back office's "where shoppers will find it" preview |

The public read takes no account: a shop's aisle list is not private, and a guest reading a
shared basket at a shop needs it (velista `0120`).

## 5. Not in this plan

- Any screen: velista `0120` and admin `0037`.
- A per location pin (section 6).
- An aisle number, a map, or a walk order between sections learned from sessions. The order
  of sections is written by an operator. The order of rows inside one stays `0141`'s.
- Importing a chain's sections from a storefront's own tree, or from `categoryPath`.
- Retiring `positionInStore` (section 6).

## 6. Open questions

- **The pin is per chain here, and per shop in `0168`.** The heavy part of the
  configuration is naming sections and mapping them, and that is done once per chain. A
  chain shelves a product the same way in most of its shops, so a chain pin covers most
  cases with one row. The per shop pin exists too, as `location_item_sections` in `0168`,
  and it is written only by an accepted shop map, never by hand: a product anchor on the
  map is somebody standing in that shop saying where the product is. It is step 1.5 of the
  rule, between present sections and chain pins. This plan builds neither the table nor
  the step.
- **`positionInStore` overlaps with a pin.** It is per location free text ("aisle 4, bottom
  shelf") and it stays useful for what a section cannot say. The back office keeps showing
  it. Whether it is renamed to "shelf note" or dropped is admin `0037`'s question.
- **Sections across a mixed list.** A shop with sections for half of the taxonomy shows a
  mixed list: its sections in order, then the app categories nothing covers. The order of
  that second half is the client's choice (velista `0120`), and the server does not try to
  interleave.
