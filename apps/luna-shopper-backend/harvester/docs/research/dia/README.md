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
