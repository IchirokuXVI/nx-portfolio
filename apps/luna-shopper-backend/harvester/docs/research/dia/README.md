# DIA research, 2026-09-29

The evidence behind backend plans `0173` (DIA's category tree replaces the first one) and `0174`
(the `dia-api` adapter). About 3,500 requests to `https://www.dia.es` over three sessions, from a
home connection, at 2 to 2.8 requests per second. Nothing here runs in CI.

The scripts were written for one machine and read and write a scratch folder by absolute path.
They are kept as a record of which request produced which fact, not as tools. The adapter's
fixtures come from its own `capture-fixtures` target (`0174`, section 11), never from here.

## Folders

| Folder | Holds |
| --- | --- |
| `feasibility/` | the first pass: the listing and detail APIs, the price per postal code, the shop file, the sitemap gap, blocking. `f.mjs` is the fetch helper (curl with browser headers, a pinned edge address, a request log) |
| `tree-and-stores/` | the second pass: the tree in Spanish and English, the drop analysis, the Wayback comparison, the shop detail fields, the postal code filter, the regular price rule |
| `appendix-build/` | `tree.py` then `build.py`: turn `data/category-tree.json` and the current taxonomy into plan `0173`'s appendices and the three JSON files below |
| `data/` | the small results, listed below |

## Data

| File | What it is |
| --- | --- |
| `category-tree.json` | DIA's tree as served, every node with id, parent, level, both names and both slugs, product counts, hidden and offer flags |
| `drop-analysis.json` | per dropped node, how many of its products also sit in a kept leaf, and the orphans |
| `tree.json` | the new tree of plan `0173`, Appendix A, as data |
| `old-to-new.json` | plan `0173`, Appendix C: every current row to one new row |
| `dia-map.json` | DIA id to our slug, every copied node plus the redirects of Appendix B. Plan `0174` generates `DIA_CATEGORY_SLUGS` from it |
| `check_service.json` | postal code to fulfilment store, 65 postal codes |
| `store_details_sample.json` | 22 shop details, every field |
| `q4_examples.json` | listing rows of each price kind: plain, club, promotion, club only multi buy |

## What was not kept

The full listing walks (about 2 MB each), the shop file (600 KB, and it changes version), the
cookie jars and the request logs. Rerun the scripts to regenerate them.

## The adapter's fixtures, 2026-10-02

Plan `0174` built the adapter in `libs/luna-shopper/dia`. Its fixtures are not here. They are in
`libs/luna-shopper/dia/src/lib/__fixtures__/`, with a `README.md` that names each file, and this
command captures them again:

```sh
npx nx run luna-shopper/dia:capture-fixtures
```

Notes from the first capture, which the plan did not have:

- The capture made 20 requests in about 15 seconds, at one request every 750 ms. Every answer
  was 200, 204 or 206. Node's global `fetch` sent three headers only: the Chrome `User-Agent`,
  `Accept` and `Accept-Language`. That is the measured row of plan `0174`, section 2.
- The shop file was `tiendas.v2749.json.gz`. It was `v2747` three days before, so the version in
  the hidden `#gz` input does change. The input's value is an absolute URL, not a bare file name.
- The file holds 3,238 records. The server sends it with `content-encoding: gzip`, and the body
  that `fetch` returns is still a gzip file, so the parser unpacks it until the gzip magic bytes
  are gone.
- A refused `PUT save-shipping-address` answers 206 with a JSON body (`VALIDATION_ERROR`,
  `no_service`), and the session keeps the postal code it had. In the capture that code was
  `08001`, not `28041`: the session keeps its last accepted code, which is `28041` only for a new
  session.
- `horariosTienda` keys `1` to `7` are Monday to Sunday. Shop `14126` opens at 08:30 on keys `1`
  to `6` and at 10:00 on key `7`, and every Sunday of the month is among its `festivosTienda`
  dates. A shop that closes on Sunday has no key `7`.
- Rows sold by weight carry `weight_in_grams` and `average_weight`. Other rows carry neither.
- The menu held one leaf the research of 2026-09-29 did not: `L2353`, "Turrones y dulces de
  Navidad". A catalog run names such a leaf in `unmappedLeaves`. Add it to `data/dia-map.json`,
  then run `npx nx run luna-shopper/dia:generate-categories`.
- `promotions[]` is stored as `extra.promotion = { entries: [...] }`, with DIA's own key names.
  The price history keeps `extra.promotion` only when it is an object, so the bare list of the
  plan's section 4 would be dropped.
