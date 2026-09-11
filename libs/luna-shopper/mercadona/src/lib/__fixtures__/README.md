# Mercadona fixtures

Captured payload shapes for the normalization tests (plan 0038, section 9). **No
test in this library touches the network**, so these files are the whole contract
with the source: a shape change upstream is a failing test with a diffable
fixture rather than a run that quietly stores nothing.

Each file is one of the awkward cases section 9 names, not a random sample:

| File                                   | The case it exists for                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-detail-es.json`               | The ordinary product: `bulk_price` equals `unit_price / unit_size`, EAN and brand present, category resolved by climbing from an unmapped level 2 name to its mapped parent.                                                                                                                |
| `product-detail-en.json`               | The same product under `lang=en`, for the one extra request an item creation pays (section 6.2).                                                                                                                                                                                            |
| `product-reference-format-100ml.json`  | Section 2.4's own example: `reference_format` reads `100 ml` on a number that is **per litre**. The label is a price tag for a human and cannot be parsed into a unit.                                                                                                                      |
| `product-capsules-per-unit.json`       | `bulk_price` equals `unit_price / total_units`, not `/ unit_size`: normalized per capsule rather than per kilo. 326 products behave this way.                                                                                                                                               |
| `product-inconsistent-bulk-price.json` | One of the **110 products (2.6%)** whose `bulk_price` matches neither derivation and disagrees with its own stated size. This is the fixture that makes "store it verbatim" a testable rule instead of a comment.                                                                           |
| `product-no-ean.json`                  | A novelty product with no EAN and an empty brand string. 3 of 40 sampled products looked like this.                                                                                                                                                                                         |
| `product-size-format-m.json`           | `size_format: 'm'` (foil, cling film): two products in the whole assortment, and no `UnitOfMeasure` value. Section 5.6 recommends not importing them.                                                                                                                                       |
| `categories-tree.json`                 | `GET /categories/`: the two level tree, roots holding the level 1 categories a walk fetches.                                                                                                                                                                                                |
| `category-expanded.json`               | `GET /categories/<id>/`: one level 1 category expanded to its level 2 children with products inline, including the `Charcutería y quesos` split that sends cheese to DAIRY and everything else to MEAT.                                                                                     |
| `stores.js`                            | The store finder's whole document, verbatim (plan 0106): 1,675 shops, 1,599 in Spain and 76 in Portugal, every one carrying a postal code and coordinates. It is a `var` assignment rather than JSON, which is what the parser strips, so it is checked in as text and never re-serialized. |
| `stores-total.js`                      | The companion document, which states the two counts the chain believes it published. A run checks what it read against it rather than assuming, and a disagreement is a line on the report and not a failure.                                                                               |

## Provenance, stated plainly

These were **authored from the measurements in plan 0038 section 2**, which were
taken against the live API on 2026-08-27, rather than written by a capture run.
Every field name, every value shape (prices as decimal strings, the warehouse key
as a string) and every documented number is from that section.

The two store finder documents are the exception: they **were** captured, from
the live documents on 2026-09-11, and every number the tests assert about them
was counted from that capture.

`npx nx run luna-shopper/mercadona:capture-fixtures` replaces them with real
captures. Run it before trusting a value that section 2 does not name, and commit
the diff. The opt in live test (`LUNA_LIVE_SOURCE_TEST=1`) is the other half: it
asserts the field names still exist, so a stale fixture says so.
