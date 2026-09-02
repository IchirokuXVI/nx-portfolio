# Postal code centroids

The reduced GeoNames postal code export, one file per country (plan 0060,
section 3). Each file is a JSON array of `[postalCode, latitude, longitude]`
rows, one per line, sorted by postal code, coordinates to four decimals.

**Generated output. Never edit by hand.** The reducer is the only thing allowed
to write here:

```sh
npx nx run luna-shopper/postal-codes:refresh-dataset
```

It downloads `ES.zip` from https://download.geonames.org/export/zip/, keeps the
country, code, latitude and longitude columns, takes the mean of the distinct
points listed for each code, and rewrites `es.json`. The reduction is
deterministic, so a refresh against an unchanged upstream is a no op in git.

| File      | Rows   | Source                                                 |
| --------- | ------ | ------------------------------------------------------ |
| `es.json` | 11,150 | GeoNames `ES.txt`, downloaded 2026-09-02 (37,867 rows) |

## What a row is

**A centroid, never a boundary** (section 6). A postal code covers an area and
this reduces it to one point, so "which code is this device in" is the nearest
centroid and may be wrong at the edge of a large rural code, and "which codes
are within 2 km" is centroid to centroid. The callers say so.

## Licence

GeoNames postal code data is
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Anywhere a code
resolved or expanded through this data is shown must carry
`GEONAMES_ATTRIBUTION` from `@portfolio/luna-shopper/postal-codes`, with a link
to https://www.geonames.org.
