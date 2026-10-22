> **PR:** [#801](https://github.com/IchirokuXVI/nx-portfolio/pull/801)

# 0065 The photo field edits our photo

> Backend half: plan `0198` of `apps/luna-shopper-backend/plans/` (a chain photo is a link we
> can turn off), built in PR #691. This plan needs nothing that is not on `dev`. It shares no
> file with `0066` and can be built beside it.
>
> Mock: none. The page keeps its layout. Section 3 says what is drawn.

A product answers two photos. `imageUrl` is the photo a shopper sees: our own photo when we
have one, or else the first chain photo of a chain whose photos are on. `ownImageUrl` is our
own photo, the `items.imageUrl` column, and the only one the back office may write.

The product page fills its photo field from `imageUrl`. While every chain was off, both were
the same value. On 2026-10-17 the photos of Mercadona were turned on in production. Since then
a product with no photo of its own shows the Mercadona photo in that field, as if it were
ours. An edit of the field writes the address into our column, and it stays there after the
chain is turned off. Backend plan `0198` names this trap (section 3.2, the lines about
`ownImageUrl`) and leaves the fix to this directory.

## Brief for the agent

### Objective

Make the photo field of a product read and write our own photo only, and show the photo a
shopper sees, and where it comes from, as facts that cannot be edited. Use the
`nx-portfolio-angular-developer`, `antislop`, `antislop-ui` and `antislop-human` skills.

### Context

- **The descriptor** is `ITEMS` in `libs/luna-shopper-admin/feature-catalog/src/lib/items.ts`.
  The field is `{ kind: 'text', name: 'imageUrl', format: 'image', nullable, maxLength: 500 }`
  in the section `catalog.items.section.sold`.
- **There is no frontend model for a product.** Admin plan `0004` section 2 makes the generated
  wire types the view models. `Item` is `Wire.CatalogItemView & { categoryIds }`, and
  `itemGateway` in the same file only adds `categoryIds`.
- **The draft reads `row[field.name]`** (`draftFor` in
  `models/src/lib/resource/resource-draft.ts`). A save sends only the changed fields
  (`toInput`), and an emptied nullable field sends `null`. So an untouched field is safe
  today, and a touched one writes `items.imageUrl`.
- **The catalog writes the column only when the request names `imageUrl`**
  (`item.service.ts`, the update). A chain link is never written to it.
- **`ItemView`** (`CatalogItemView` in `wire-types.ts`) carries `imageUrl`, `imageSource`
  (`OWNER` or `CHAIN`), `imageSupermarketId`, `images[]` (each `url`, `source`,
  `supermarketId`) and `ownImageUrl`.
- **`GET /v1/admin/catalog/items/:id/linked-images`** answers every saved chain link of the
  product, on or off: `sourceEntryId`, `supermarketId`, `url`, `enabled`, `firstLinkedAt`,
  `lastSeenAt` (`CatalogItemLinkedImagesView`).
- **The Sources tab** of a product (`products/product-tabs.ts`, `item-source-entries.ts`)
  lists the chain rows that name the product. A link is keyed on one of those rows
  (`sourceEntryId`).
- **The memory back end** spreads an input onto the row (`resource-memory.ts`), so in memory
  `imageUrl` and `ownImageUrl` drift apart after an edit. The seeds carry both fields.

### Target state

1. **The photo field is our photo.** Its label is "Our photo". It is filled from
   `ownImageUrl`, and a save sends it as `imageUrl`, which is the name the update route reads.
   A product whose own photo is null shows an empty field, whatever chain photo a shopper sees.
2. **A help line under the field** says: "Shoppers see this photo first. With no photo here,
   they see a chain's photo, if that chain's photos are on."
3. **A fact, "Shoppers see"**, in the same section and never editable: the photo a shopper
   sees (`imageUrl`) as a small picture, and a word for where it comes from: "Ours", or the
   name of the chain for a chain photo, or "No photo".
4. **The Sources tab shows the photo of each chain row** that has a saved link: a small
   picture and "Shown" or "Saved, chain off". It reads
   `GET /v1/admin/catalog/items/:id/linked-images` once for the tab and joins on
   `sourceEntryId`. A row with no link shows nothing new.
5. **Every chain picture in the back office** is drawn with `referrerpolicy="no-referrer"`,
   and with the placeholder the image format already uses when a load fails. That is the
   client rule of backend `0198`.
6. **The memory back end** keeps the two fields apart as the catalog does: a write of
   `imageUrl` sets `ownImageUrl`, and `imageUrl` is our photo when there is one, or else the
   first link of the seed.

### Scope

- In: `feature-catalog/src/lib/items.ts`, `item-source-entries.ts`, `products/`, the shared
  draw of an image value if section 3.1 needs it (`feature-resource`), the memory back end and
  its seeds (`data-access`, `feature-catalog/src/lib/catalog-seed.ts`), their specs, and
  `en.json`.
- Out: the gateway, `openapi.json`, `wire-types.ts`, the catalog service, velista.

### Constraints

- Do not add a hand written type beside the wire types. A field the view lacks is a gap in the
  document.
- The descriptor keeps one field that writes. The two facts of target 3 do not send anything.
- Do not send `imageUrl` on a save unless the person changed the field. That holds today and
  must still hold.
- The constraints of plans `0053` and `0055` hold.

### Action boundaries

- Do not change a gateway route, a DTO or the catalog.
- Do not turn a chain's photos on or off on any cluster. On your own Luna slot you may, to
  walk the page.
- Do not start, stop or migrate Luna slot 0, 1 or 3.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/data-access` and
  `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- A spec proves target 1: a row whose `imageUrl` is a chain address and whose `ownImageUrl` is
  null opens with an empty field, and a save of another field sends no `imageUrl`.
- The walk of section 4, with screenshots at 1360 px and 390 px.

## 1. Not in this plan

- Velista. It draws `imageUrl` with no `referrerpolicy` and no placeholder, which breaks the
  same client rule. That is a velista plan.
- A way to copy a chain photo into our own photo. It would be a decision about rights, not a
  screen.
- The switch of a chain. That is plan `0066`.

## 2. How the field is filled and saved

The gateway of `ITEMS` maps each row it reads, as it already adds `categoryIds`:

```ts
// The form field is ours. The shown photo moves to fields the form never sends.
const toRow = (view: Wire.CatalogItemView): Item => ({
  ...withCategoryIds(view),
  imageUrl: view.ownImageUrl,
  shownImageUrl: view.imageUrl,
});
```

`shownImageUrl` and the source of the shown photo are read only, so they are absent from every
draft. If `Item` cannot carry `shownImageUrl` without a hand written type, read the shown photo
from `images` and `imageSource` in the fact itself, and say so in the pull request.

If a reader in the back office other than the product page wants the photo a shopper sees (a
picker, a queue row), it reads `shownImageUrl`. Search for every reader of `imageUrl` on a
product before you change the mapping, and list them in the pull request.

## 3. What the page draws

### 3.1 The section "Sold"

| Row | Value | Editable |
| --- | --- | --- |
| Our photo | the address, with the picture beside it | yes |
| Shoppers see | the picture, then "Ours", the chain's name, or "No photo" | never |

When our photo is set, "Shoppers see" draws "Ours" and the same picture. Draw it anyway: the
row answers the question a person opens the page with.

### 3.2 The Sources tab

Each chain row with a saved link gains the picture (48 px, cover) and one word: "Shown" when
the link is enabled, "Saved, chain off" when it is not. A failed load draws the placeholder.

## 4. The walk

On your own Luna slot with a catalog that has ACTIVE Mercadona rows with a photo. A Mercadona
catalog discovery of your own makes them, at 4 workers and 4 requests a second:

1. Turn Mercadona's photos on with `PUT /v1/admin/catalog/supermarkets/:id/linked-images`.
2. Open a product with no photo of its own and a Mercadona link. The field is empty. "Shoppers
   see" shows the Mercadona picture and the word "Mercadona".
3. Change the unit size and save. Read the product over the gateway: `ownImageUrl` is still
   null.
4. Set our photo and save. "Shoppers see" says "Ours".
5. Open the Sources tab. The Mercadona row shows its picture and "Shown". Turn Mercadona off,
   reload: "Saved, chain off".
