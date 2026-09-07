> **PR:** [#283](https://github.com/IchirokuXVI/nx-portfolio/pull/283)

# 0023 A reference column names what it points at

Three list screens draw uuids where an operator reads a name. The prices list shows `itemId`
where it means a product, the products list shows `productGroupId` where it means a group, and
the price scopes list shows `supermarketId` where it means a chain. Plan `0004`, section 6 made
that deliberate: resolving a reference costs a request per row, which a list cannot afford, so
the form's picker is where a reference is shown by name and a list cell is the raw id.

**This plan keeps the reasoning and retires the blanket rule.** A reference column becomes the
target's name and a link that opens the target's own screen, through two honest routes to the
name: joined on by the backend where the target is large (a product), and resolved once per
distinct id and cached where the target is small (a chain, a group). The id stays as the
fallback, for a name that has not arrived yet and for a reference whose target is gone.

Depends on `0004` for the descriptor machinery and the rule it amends, on `0005` for the three
screens, and on `0012` for what a nullable reference means. Section 3 is backend work: one
contract view, one service join, one gateway route's response type, and the two regenerated
documents. `0022` will move these screens under a `catalog` segment; section 2.2 is what keeps
that from mattering here.

## 1. What changes, screen by screen

| Screen          | Column           | Name comes from            | Link opens          |
| --------------- | ---------------- | -------------------------- | ------------------- |
| `/prices`       | `itemId`         | the wire (section 3)       | the product's form  |
| `/items`        | `productGroupId` | resolve and cache (sec. 4) | the group's form    |
| `/price-scopes` | `supermarketId`  | resolve and cache (sec. 4) | the chain's form    |

The mobile card on `/prices` is part of the first row: its heading is the descriptor's `title`,
which is `row.itemId` today, and section 3.3 gives it the same name the column gets.

The **sold at this scope** column on `/prices` does not change. It is the scope wide
availability the backend materializes, it reads honestly, and whether it earns its width is a
separate conversation this plan explicitly does not have.

## 2. The cell learns what a reference is

### 2.1 One new cell shape

`ResourceCell` gains an optional member:

```ts
readonly reference?: { readonly resource: string; readonly id: string };
```

`toCell` emits it for every reference field, unconditionally: the id is on the row, so the cell
always knows what it points at even when it cannot yet say what that is called. `text` carries
the best name the cell has, which at this layer is the id; sections 3 and 4 are the two ways a
better one gets in. `toCell` stays pure and synchronous, which is why the lookup route overlays
names outside it (section 4.2) rather than teaching it to wait.

### 2.2 The link is derived, never typed

The cell does not carry router commands, because `toCell` lives in `models` and must not know
the route table. `ResourceListPage` turns `reference` into a `routerLink` array by asking the
resource registry, which is the same object navigation and the pickers already read: the target
descriptor's registered location decides the URL. When `0022` moves `/items` under
`/catalog/items`, every cell link moves with it, because nothing anywhere spelled the path out.

A target that has no detail screen gets no link, by the same `hasDetailScreen` test the row's
own click uses. A name without a link is still an answer; a link to a 404 is not.

### 2.3 An anchor inside a row that is itself clickable

The row already opens its own detail on click. The cell's anchor sits inside that row, so it
stops the click from propagating, and it is a real `<a>`: reachable by keyboard in its own tab
stop, named by the text it shows, and openable in a new tab, which is half the point of a link
in a table. The compact card gets the same anchor on the same cell.

### 2.4 Where the name comes from is the field's declaration

`ReferenceField` gains two optional members, mutually exclusive, both display only:

- **`nameFrom`**: the row property that carries the target's name, for a read that joins it on
  (section 3). The property holds a localized text, and the cell renders it exactly as a
  `localized-text` field would: through the content locales, with the missing locale markers,
  falling back to the id when the text is empty or the property is null.
- **`nameLookup: true`**: the name is resolved through `ReferenceLookup.resolve` and cached
  (section 4).

A reference field with neither keeps today's behavior, id and now a link. That is the guard
against the request storm the old rule feared: `nameLookup` is set on exactly two fields in this
plan, both pointing at small targets, and nothing resolves unless a descriptor asked. A
membership's `userId` keeps its id until someone deliberately decides otherwise, and for a large
target the answer is `nameFrom` and a backend join, never the lookup.

## 3. The product's name rides the admin read (`/prices`)

The wire view carries only `itemId`, and no frontend resolution is acceptable here: a page of
prices is a page of distinct products, so the lookup route would cost a request per row, which
is the exact thing plan `0004` refused. The name joins the row on the backend, on the admin read
only.

### 3.1 The contract and the schema

`catalog.messages.ts` gains an admin view beside the shopper one:

```ts
export interface AdminSupermarketItemView extends SupermarketItemView {
  /** The product's name, joined on for the back office. Null when the join found nothing. */
  itemName: LocalizedText | null;
}
export type AdminSupermarketItemPage = Paginated<AdminSupermarketItemView>;
```

A separate view rather than a widened `SupermarketItemView`, because the shopper view is
velista's contract and velista neither needs the name here nor wants a bigger page. The admin
NATS pattern (`supermarketItem.adminList`) is already its own handler, so the split costs one
type and no branching. `catalog.schemas.ts` gets the two schema ids beside the existing pair.

### 3.2 The service, the gateway, and the two regenerated files

`supermarket-item.service.ts`'s `adminList` joins `items.name` onto its query and copies it onto
each row. The gateway's `GET /v3/admin/catalog/supermarket-items` answers the new page type.
Then the two committed outputs, in this order and in the same PR:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Both are spec enforced (`openapi-document.spec.ts`, `wire-types.spec.ts`), so forgetting either
is a red build rather than drift. A large diff in `openapi.json` here is component reordering,
which regeneration is known to do, not damage.

### 3.3 The descriptor

`prices.ts` sets `nameFrom: 'itemName'` on the `itemId` field, and `title` becomes the same
resolution: the localized name through the content locales, falling back to `row.itemId` when
there is none. `title` stays a pure synchronous function, which is the reason this screen needed
the wire route in the first place: the compact card's heading cannot wait for a lookup.

## 4. Resolve once and cache (`/items`, `/price-scopes`)

### 4.1 Why not the wire here too

Product groups and chains number dozens, not thousands, and a page of products repeats the same
few group ids over and over. One resolve per **distinct** id, cached, costs a handful of
requests for the life of the screen, which is cheaper than teaching two more backend reads to
join. The dashboard already does exactly this for chain names (`_chains` in
`dashboard-page.ts`), and this section is that precedent made generic.

### 4.2 The name store

`ResourceListPage` holds a map from `resource:id` to name, filled by an effect over the loaded
rows: every `reference` cell whose field says `nameLookup`, whose id is not yet in the map, gets
one `ReferenceLookup.resolve` call, and the answers land in a signal the `rows` computed merges
over the cells' text. Loading more rows resolves only the ids the map has not seen. A resolve
that answers `null` records the id itself as the name, so a dangling reference stays an id on
screen and is never asked about twice.

Until an answer lands the cell shows the id, not a spinner: the id is true, arrives with the
row, and keeps the table from reflowing twice per page.

### 4.3 The two descriptors

`items.ts` sets `nameLookup: true` on `productGroupId`. A null group is the resting state of a
harvested product and keeps its "None" cell exactly as today; only a real id is resolved.
`price-scopes.ts` sets it on `supermarketId`. The compact card on `/price-scopes` still omits
the chain, for the reason the descriptor already states: the filter above the list fixed it.

## 5. Tests

- `resource-view.spec.ts`: a reference cell carries `reference` always, renders `nameFrom` as a
  localized text with missing markers, and falls back to the id.
- The list page spec: the link commands come from the registry, a target without a detail screen
  gets no link, the lookup fills names per distinct id, and a null resolve is cached.
- `catalog-screens.spec.ts`: the three descriptors declare what section 1's table says, and
  `nameFrom` and `nameLookup` are never set together.
- The gateway and catalog specs cover the join; the two staleness specs cover the regeneration.
- Assertions go on component inputs and view models, never on interpolated text, because the
  testing translator does not interpolate.

## 6. Out of scope

- The **sold at this scope** column, stated in section 1.
- The form's reference picker, which already shows names and does not change.
- Every other reference column in the app: they gain the link (section 2.1 emits `reference`
  unconditionally) but no name, until a descriptor declares one of section 2.4's members.
