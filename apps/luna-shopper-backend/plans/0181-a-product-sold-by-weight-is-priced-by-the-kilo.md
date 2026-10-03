# 0181: a product sold by weight is priced by the kilo

> Found by the audit of the first catalog on local slot 1, 2026-10-03, after the curation
> that `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md` describes.
>
> Prerequisite reading: plan `0080` (every price a source gave), plan `0157` (the best
> offer is one with a price), `libs/luna-shopper/mercadona/src/lib/normalize.ts`,
> `harvester/src/app/harvest/mercadona-catalog.runner.ts` (`pricesOf`, and the comment at
> lines 251 to 256), `harvester/src/app/harvest/source-entry-write.ts`,
> `libs/luna-shopper/tools/leaflet/cli/src/to-harvest-document.mjs` (`decidePrice`),
> `libs/luna-shopper/eljamon/src/lib/size.ts` (`soldByWeight`), and the owner's rule 7 in
> the report: "a weight that is not the same on every pack is not a format".

The owner's rule makes a cheese piece, a meat tray and loose fruit one product sold by the
kilo, with no size. The price of such a product is the price of a kilo. Two sources do not
write it that way.

## Brief for the agent

### Objective

Make every source write the per kilo price as the price of a product sold by weight, and
make a row say that it is sold by weight, so that a new product is created by the kilo
with no size and nobody has to resize it by hand.

### Context

Read from slot 1 on 2026-10-03:

| Chain | Price rows on products sold by the kilo | `price` is the per kilo price | `price` is something else |
| --- | ---: | ---: | ---: |
| El Jamón | 299 | 298 | 1 |
| Mercadona | 614 | 9 | 605, on 197 products |
| Deza leaflet | 21 | 0 | 21, all null |
| LIDL | 54 | 0 | 54 (no unit price at all) |

- **Mercadona.** `normalize.ts` maps `price` from `unit_price`, the price of one piece, and
  `unitPrice` from `bulk_price`. For a piece sold by approximate weight the piece weight is
  an estimate, so "Gambón congelado" carries 1,282.05 € beside 12.95 €/kg, and a 9 kg ham
  carries 504.00 €. `approx_size` and `selling_method` are never read. The runner writes
  `extra: null`. The report's stage "Weighed products" found these products by calling
  Mercadona's product API again by hand: 179 of 212 answered `approx_size: true`.
- **The leaflet.** `decidePrice` answers `price: null` and a unit price for an offer whose
  basis is `kg` or `l`, because a leaflet does not print a pack price. `file-import.runner.ts`
  and `source-entry-write.ts` pass the null through. 21 products therefore show no price at
  Deza, although the leaflet printed one.
- **El Jamón** already prints the per kilo figure as its price. Its size parser answers
  `soldByWeight` for a bare `kg`, and nothing reads that flag.
- **Two pieces of one product.** The curation merged pieces of one cheese onto one product.
  26 pairs of product and scope hold more than one price row, and two pieces can differ per
  kilo (9.41 against 9.70 €).

### Target state

1. A queue row says whether it is sold by weight: `source_catalog_entries.soldByWeight`
   (boolean, not null, default false), carried on the observation contract and the entry
   view.
2. **Mercadona** sets it from the product payload. Decide the exact field from a captured
   fixture of one approximate weight product and one fixed pack with an in-store barcode
   (the report names both kinds). For a row sold by weight the adapter writes
   `price = bulk_price`, `unitPrice = bulk_price`, `unitSize = null` and the size format
   `kg`. `bulk_price` is still stored verbatim (CLAUDE.md, "never recomputed").
3. **El Jamón** sets it from `soldByWeight` of its parser. Its prices do not change.
4. **The file import** sets it for an offer whose basis is `kg`. For that row the price
   written is the headline price, which is the price of a kilo. An offer whose basis is `l`
   keeps a null price: a litre basis is a comparison figure for a bottle, not a way to sell.
5. **LIDL** sets it when its payload says so. If the fixture shows no such field, say so
   in the PR and leave LIDL as it is.
6. **A create from a row sold by weight** defaults to `unitSize` null and `KILOGRAM`, in
   both the one row route and the bulk route (`itemFrom`). The curation packet shows
   `soldByWeight`, and `prompt.md` says what it means.
7. **One price per product, scope and source.** When several rows of one chain and one
   source kind are bound to one product, the price written for a scope is the lowest per
   kilo price among them. State the rule in `source-entry-write.ts` and cover it with a
   spec. This is the owner's call to change: say so in the PR description.
8. Regenerated `openapi.json` and `wire-types.ts`.

### Scope

Work only in `libs/luna-shopper/{mercadona,eljamon,lidl}`, the harvester (the runners,
`file-import.runner.ts`, `source-ingest.ts`, `source-entry-write.ts`, the entry entity, its
migration and mappers, `source-entry.service.ts`, `source-entry-batch.service.ts`),
`libs/luna-shopper/contracts`, `libs/luna-shopper/tools/curation/suggestions` (the packet
and `prompt.md`), the gateway DTOs and the two generated files.

Do NOT touch: catalog's `item_prices` or `supermarket_items` code, `decidePrice` in the
leaflet tool, the Deza adapter (it prints no prices), velista.

### Constraints

- Refresh Mercadona fixtures with `capture-fixtures`, never by hand.
- `externalId`, `sizeFormat` of existing rows and the alias key must not change.
- If plan `0177` is not merged, write `unitSize` and the printed format as today and do
  not add `sizeUnit`. If it is merged, a row sold by weight carries `sizeUnit` null.
- Never write a price to `supermarket_items` directly.
- Only make the changes this plan names.

### Acceptance criteria

- [ ] A Mercadona spec on the captured fixture: an approximate weight product answers
      `soldByWeight: true`, `price` equal to `bulk_price` and `unitSize` null. A fixed pack
      with an in-store barcode answers `soldByWeight: false` and its piece price.
- [ ] A file import spec: a `kg` basis offer writes its headline price as `price`. An `l`
      basis offer writes null.
- [ ] A harvester spec: two rows sold by weight bound to one product write one price for a
      scope, the lower per kilo figure.
- [ ] A harvester spec: `createItem` from a row sold by weight, with no size in the
      request, creates `KILOGRAM` with `unitSize` null, on both routes.
- [ ] `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

### Action boundaries

Proceed with code, fixtures, specs and an ephemeral slot. Stop and ask if the Mercadona
payload has no field that separates approximate weight from a fixed pack.

### Progress evidence

Report each criterion with its spec output. For Mercadona also quote the fixture's own
fields for the two products.

## The data already written

Plan `0186` repairs the 605 Mercadona rows and the 21 leaflet rows on slot 1 after this
plan lands: a new Mercadona run rewrites the first, and a second import of the same leaflet
document rewrites the second.
