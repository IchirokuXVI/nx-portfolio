# Mercadona fixtures

Captured payload shapes for the normalization tests (plan 0038, section 9). **No
test in this library touches the network**, so these files are the whole contract
with the source: a shape change upstream is a failing test with a diffable
fixture rather than a run that quietly stores nothing.

Each file is one of the awkward cases section 9 names, not a random sample:

| File                                   | The case it exists for                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-detail-es.json`               | The ordinary product: `bulk_price` equals `unit_price / unit_size`, EAN and brand present, category resolved by climbing from an unmapped level 2 name to its mapped parent.                                                                                                                                    |
| `product-detail-en.json`               | The same product under `lang=en`, for the one extra request an item creation pays (section 6.2).                                                                                                                                                                                                                |
| `product-reference-format-100ml.json`  | Section 2.4's own example: `reference_format` reads `100 ml` on a number that is **per litre**. The label is a price tag for a human and cannot be parsed into a unit.                                                                                                                                          |
| `product-capsules-per-unit.json`       | `bulk_price` equals `unit_price / total_units`, not `/ unit_size`: normalized per capsule rather than per kilo. 326 products behave this way.                                                                                                                                                                   |
| `product-inconsistent-bulk-price.json` | One of the **110 products (2.6%)** whose `bulk_price` matches neither derivation and disagrees with its own stated size. This is the fixture that makes "store it verbatim" a testable rule instead of a comment.                                                                                               |
| `product-no-ean.json`                  | A novelty product with no EAN and an empty brand string. 3 of 40 sampled products looked like this.                                                                                                                                                                                                             |
| `product-size-format-m.json`           | `size_format: 'm'` (foil, cling film): two products in the whole assortment, and no `UnitOfMeasure` value. Section 5.6 recommends not importing them.                                                                                                                                                           |
| `product-box-of-capsules.json`         | Product 11801, a box of 16 capsules priced as one piece (plan 0177). It answers `is_pack: false`, `total_units: 16`, `unit_size: 0.16` in `kg` and `reference_format: ud`. The pack count rule for a box was decided from it. Captured on 2026-10-04.                                                           |
| `product-pack-of-pads.json`            | Product 16566, a box of 10 pads (plan 0183). It answers `unit_size: 1`, `size_format: ud`, `total_units: 10`, `unit_price: 3.20` and `reference_price: 0.320`: the size of one is a placeholder and the count is in `total_units`. The rule for a size of one unit was decided from it. Captured on 2026-10-04. |
| `product-pack-of-wipes.json`           | Product 47293, a pack of 15 wet wipes (plan 0183): the same shape as the pads, with `total_units: 15`, `unit_price: 0.80` and `reference_price: 0.054`. Captured on 2026-10-04.                                                                                                                                 |
| `product-single-razor.json`            | Product 22083, one razor (plan 0183). `unit_size: 1`, `size_format: ud`, `total_units: null`, and a `reference_price` of 3.000 equal to its `unit_price`: here the chain did mean one. Captured on 2026-10-04.                                                                                                  |
| `product-roll-of-services.json`        | Product 49173, one roll of paper (plan 0183). `total_units: 600` with `unit_name: servicios` counts sheets, and its `reference_price` of 3.750 is the price of the one roll. It is why the rule checks the comparison price and does not trust `total_units` alone. Captured on 2026-10-04.                     |
| `categories-tree.json`                 | `GET /categories/`: the two level tree, roots holding the level 1 categories a walk fetches.                                                                                                                                                                                                                    |
| `category-expanded.json`               | `GET /categories/<id>/`: one level 1 category expanded to its level 2 children with products inline, including the `Charcutería y quesos` split that sends cheese to DAIRY and everything else to MEAT.                                                                                                         |
| `stores.js`                            | The store finder's whole document, verbatim (plan 0106): 1,675 shops, 1,599 in Spain and 76 in Portugal, every one carrying a postal code and coordinates. It is a `var` assignment rather than JSON, which is what the parser strips, so it is checked in as text and never re-serialized.                     |
| `stores-total.js`                      | The companion document, which states the two counts the chain believes it published. A run checks what it read against it rather than assuming, and a disagreement is a line on the report and not a failure.                                                                                                   |

## Provenance, stated plainly

These were **authored from the measurements in plan 0038 section 2**, which were
taken against the live API on 2026-08-27, rather than written by a capture run.
Every field name, every value shape (prices as decimal strings, the warehouse key
as a string) and every documented number is from that section.

The two store finder documents are the exception: they **were** captured, from
the live documents on 2026-09-11, and every number the tests assert about them
was counted from that capture.

`npx nx run luna-shopper/mercadona:capture-fixtures` replaces eleven of these files
with real captures: `product-detail-es.json`, `product-detail-en.json`,
`product-box-of-capsules.json`, `product-pack-of-pads.json`, `product-pack-of-wipes.json`,
`product-single-razor.json`, `product-roll-of-services.json`, `categories-tree.json`,
`category-expanded.json`, `stores.js` and `stores-total.js`. Run it before trusting a value that section 2 does not name,
and commit the diff. It does not write the five edge case fixtures
(`product-reference-format-100ml.json`, `product-capsules-per-unit.json`,
`product-inconsistent-bulk-price.json`, `product-no-ean.json` and
`product-size-format-m.json`). Those are kept by hand. The opt in live test (`LUNA_LIVE_SOURCE_TEST=1`) is the other half: it
asserts the field names still exist, so a stale fixture says so.
