> **PR:** [#527](https://github.com/IchirokuXVI/nx-portfolio/pull/527)
> Built without the parts that read backend 0168 (shop maps), which is on hold: target 2's map written list notice and target 3's per shop pins from a map.
> On 2026-09-29 the shop map series was rewritten: target 2 moved to `0040`, and target 3 was dropped because the new maps carry no product pins.

# 0037 Shop sections in the back office

> Back office half of backend `0167`. Needs `0036` (the tree has a screen and the item form
> has a leaf picker). Followed by `0038` (a map is reviewed), which reads the panels this
> plan adds. Prerequisite reading: backend `0167` in full (the three writes, the
> rule and the routes), admin `0034` (places and chains in the back office, where the chain
> and location screens live), admin `0005` (the "Aisle position" free text on location
> items), and the `admin-app` notes on nested members under a parent resource.

Backend `0167` records three things: a chain's sections and the categories each covers, the
ordered list of sections a shop has, and the sections a product is pinned to within a chain.
Each is a decision an operator makes while looking at a shop, and none of them has a screen.
This plan gives each one a screen, and gives the operator the one answer they will check
after every edit: where shoppers will find a given product in a given shop.

## Brief for the agent

### Objective

Under a chain, manage its sections and the categories each covers. Under a location, manage
which of the chain's sections it has and in what order. On a product, manage its pins per
chain and preview where it lands in a chosen shop. Use the `nx-portfolio-angular-developer`
skill for the Angular work and `design-taste-frontend` for the ordering control and the
preview.

### Context

- **Chains and locations** are the supermarkets and locations screens of `feature-catalog`
  (`supermarkets.ts`, `locations.ts`, and the nested pattern of listing locations under their
  chain). Location items with `positionInStore` are `location-items.ts`.
- **The item screen** is `item-form-page.ts` with its panels (prices, source products).
- **The tree** is the categories resource of `0036`, and the `references` field kind with a
  picker limit.
- **The new wire** (backend `0167` section 4): `SupermarketSectionView { id, supermarketId,
  slug, name, position, categoryIds }`; `LocationSectionsView { sections, source }`; the
  routes under `admin/catalog/supermarkets/:id/sections`, `admin/catalog/sections/:id`,
  `admin/catalog/locations/:id/sections` (`GET`, and `PUT { sectionIds }` in order, empty
  returns the shop to the chain's default), `admin/catalog/supermarkets/:id/item-sections`
  (`GET ?itemId=` or `?sectionId=`, `PUT { itemId, sectionIds }`), and
  `admin/catalog/locations/:id/item-sections?itemIds=` for the preview.

### Target state

1. **Sections of a chain.** The chain screen gets a "Sections" tab: list in `position`
   order with name, slug, the categories covered (roots shown as "Frozen (all)"), and the
   count of shops that list it. Create and edit: name (`localized-text`), slug (create
   only), position (`number`), categories (`references` to categories at any level). Delete
   warns that the section leaves every shop's list and every pin, then deletes.
2. **Sections of a shop.** The location screen gets a "Sections in this shop" panel. It
   opens on the chain's default with a sentence saying so (`source: CHAIN`). The operator
   ticks the sections the shop has and orders them (up and down controls, or a position
   number, as the review decides), then saves the ordered list. "Use the chain's default"
   sends the empty list. A section of another chain cannot be added, because the picker
   lists the shop's chain only. When the list was written by an accepted shop map (backend
   `0168`), the panel says so with the map's version and warns that the next acceptance
   overwrites a hand edit.
3. **Pins on a product.** The item screen gets a "Where it is, per chain" panel: one row
   per chain the product is sold at (`supermarket_items`), showing the pinned sections or
   "By its categories" when none, and an edit that picks sections of that chain. Saving an
   empty pick removes the pins. Under a chain's row, the per shop pins an accepted map
   wrote (backend `0168`) are listed read only, each with its shop and the map's version.
4. **The preview.** The same panel takes a shop (a location picker limited to the chain)
   and shows the sections the rule of backend `0167` section 3 answers for this product
   there, with a sentence naming the branch that answered: pinned, covered, or "shown under
   its own categories". It reads `locations/:id/item-sections?itemIds=`.
5. **Aisle position.** The free text `positionInStore` on location items is relabelled
   "Shelf note" and kept. Its help says a section is the aisle and the note is the shelf.
6. **Twins and specs.** The in memory gateway holds two sections for one chain, one shop
   with its own order, and one pin. Screen specs cover each panel's read, a save and a
   refusal.

### Scope

Work only in `libs/luna-shopper-admin/feature-catalog` (the chain, location and item
screens, a `sections.ts` descriptor and three panels), `data-access` and its in memory
twins, `ui/assets/i18n/en.json`, the specs of each, and the generated wire types only by
running the generator.

Do not touch: the backend, the categories screen of `0036` beyond linking to it, prices,
availability, or the harvest screens.

### Constraints

- The ordered list is saved whole: the panel holds the order locally and sends one `PUT`.
  Nothing is written per tick.
- A section's categories are shown by name through `nameLookup`. A root is marked as
  covering all its children.
- `no-literal-resource-path.spec.ts` still passes.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: a per location pin, importing sections from a chain's storefront tree,
deleting `positionInStore`, or a drag and drop dependency.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for every touched admin library, `npx nx build luna-shopper-admin`, and a walk over HTTP
against a slot serving backend `0167`: create two sections on a chain, give one shop its own
order, pin one product, and read the preview answer each of the three branches.

## 1. Not in this plan

- Sections on the phone: velista `0120` reads them, nobody edits them there.
- A per location pin (backend `0167` section 6).
- A map or an aisle number.
