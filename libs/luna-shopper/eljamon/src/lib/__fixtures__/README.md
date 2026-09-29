# El Jamón fixtures

Five pages, captured on 2026-09-29. Each file holds **exactly the bytes that the
server sent**. No test in this library uses the network, so these files are the
whole contract with the source. If the markup changes upstream, a test fails and
the page diff shows why. Without the fixtures, a run stores nothing and says
nothing.

- `stores.html`: The store locator's answer to one search from Lepe, radius 1000 km. It holds 368 records: 366 El Jamón shops, and two `Cash Lepe` records, which are the group's cash and carry.
- `home.html`: `/` in a session with postal code 21440: the menu of the eleven top level categories.
- `category-page-1.html`: Page 1 of `Frescos` (`04`), a GET: the printed article count, the hidden `filters` input, rows on offer, rows sold by weight (`, kg`) and unit prices per `Kilo`, `100gr` and `Unidad`.
- `category-page-2.html`: Page 2 of the same category, the POST of page 1's `filters` with `page: 2`. It holds twenty products that page 1 does not hold. That proves the POST: a bare GET of that URL answers the carousel.
- `product.html`: The product page of the first row of page 1: the JSON-LD with its single quoted `availability`, and the breadcrumb.

## Why they are whole pages

The parsers must find their containers inside a 170 KB Liferay page. A trimmed
fixture does not prove that. So nothing here is trimmed, and **nobody edits a
fixture by hand**.

Refresh them with this command, then commit the diff:

```sh
npx nx run luna-shopper/eljamon:capture-fixtures
```

The command makes eight requests, one at a time, 750 ms apart.

The assortment moves, so the product names change between captures. The tests
assert shapes and counts. The table of real names is in `size.spec.ts`, where a
recapture cannot rewrite it. The store counts are asserted exactly, because a
change in the number of shops is news that the plan wants to see.
