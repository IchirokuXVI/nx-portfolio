# El Jamón: what the site publishes and how to read it

These are research scripts, written on 2026-09-29. They check the facts in
sections 1 to 4 of
`apps/luna-shopper-backend/plans/0169-el-jamon-one-price-list-for-every-shop.md`.

**None of this code ships.** The adapter is `libs/luna-shopper/eljamon`. It is
framework free, and its test fixtures are in the repository. The scripts are here so that each
fact in the plan has a probe beside it that anybody can run again.

## Run them

The storefront `www.supermercadoseljamon.com` sends an incomplete certificate
chain. Its leaf is signed by "Sectigo Public Server Authentication CA EV R36",
but the server sends a different intermediate. A browser downloads the missing
certificate by itself. Node does not, so every request fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Give Node the missing intermediate, which is `sectigo-ev-r36.pem` in this
directory:

```sh
export NODE_EXTRA_CA_CERTS=apps/luna-shopper-backend/harvester/docs/research/eljamon/sectigo-ev-r36.pem
node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-counts.mjs
node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-postal-codes.mjs
node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-pages.mjs
```

The library does not use this variable. It carries the same certificate in
`transport.ts` and trusts it only for its own requests.

- `probe-counts.mjs`, 14 requests: the product URLs in `sitemap.xml`, and the
  article count of each top level category.
- `probe-postal-codes.mjs`, 27 requests: the prices of two categories under five
  postal codes, and one code that the shop does not serve.
- `probe-pages.mjs`, 7 requests: one page of each kind that the parsers read,
  saved into `out/`.

Every script sends the harvester's own User-Agent and waits 750 ms between
requests.

## What was found on 2026-09-29

- `sitemap.xml` lists **6,853** product URLs. The eleven top level categories
  print counts that sum to **6,853**.
- The postal codes 21440, 41010, 14013, 11205 and 18140 saw the **same prices
  and the same article counts**. So the chain has one price list.
- The shop refuses postal code 28001 (Madrid) with `"resultado":"ko"`. The
  postal code decides whether an area is served. It does not change prices.
- The store locator answers one search from Lepe, radius 1000 km, with **368**
  records. 366 are El Jamón shops. The other two are `Cash Lepe`, the group's
  cash and carry.
- The listing puts a plain space before `€`, not a non breaking space. The
  parser accepts both.
- The unit price label is `Kilo`, `Litro`, `Unidad` or `100gr`. The size forms
  include `pk-2` and `pza` as well as the forms that section 6 of the plan
  lists.
