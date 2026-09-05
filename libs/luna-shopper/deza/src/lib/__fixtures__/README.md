# DEZA fixtures

Three pages of `https://www.dezacalidad.es/productos/`, captured on 2026-09-05
and stored **verbatim, byte for byte as the server sent them**. No test in this
library touches the network, so these files are the whole contract with the
source: a markup change upstream is a failing test with a diffable page rather
than a run that quietly stores nothing.

| File                     | The case it exists for                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landing-page.html`      | The listing with no section selected. Carries all four things the parser reads: the section tree in the search form, 15 product rows, the attribute icons, and the 20 page widget that says the query is at the source's 300 row ceiling. Rows 6, 7, 10, 11 and 15 have icons; rows 10 and 14 name a single shop, which is the negative claim plan 0085 section 1 is built around. |
| `search-one-page.html`   | `Bolleria` narrowed by the term `croissant`: 8 rows and **no pagination widget at all**, which is the last page number 0 rather than 1 and is what tells the crawler a query is complete.                                                                                                                                                                                          |
| `page-past-the-end.html` | Page 21 of a capped query. The source answers **200** with the grid container present and nothing inside it, so the end of a result set is zero rows rather than an error.                                                                                                                                                                                                         |

## Why they are whole pages

`mercadona`'s fixtures are small JSON documents because the source answers JSON.
This one answers a 130 KB WordPress page, and most of what the parser has to get
right is finding its containers inside one. A trimmed fixture would stop proving
that, so nothing here is trimmed and **nobody edits one by hand**.

Refresh them with

```sh
npx nx run luna-shopper/deza:capture-fixtures
```

which makes four requests, one at a time, half a second apart, and commit the
diff. The assortment moves, so the product names in `landing-page.html` will
change between captures; the tests assert the shapes and the counts the plan
measured, and keep the size split table of real descriptions in
`size.spec.ts`, where a recapture cannot silently rewrite it.
