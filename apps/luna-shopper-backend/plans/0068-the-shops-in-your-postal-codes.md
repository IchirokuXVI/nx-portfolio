# 0068 The shops in your postal codes

`apps/velista/plans/0059` puts a list of actual shops in front of somebody. It names its server
halves as `0064` (what an exclusion means), `0061` (without which two thirds of those shops have no
postal code) and `0062` (the codes the list is drawn from), and all three have shipped.

The screen still cannot be built, because **no read answers "which shops are in my postal codes".**
`0064` added the exclusion and hung it on the one read that exists, `supermarketLocation.list`,
which answers exactly one question:

> that chain's shops, newest first, a hundred at a time, nationwide.

There is no postal code filter on it. `ListSupermarketLocationsRequest` carries `userId`,
`supermarketId`, `priceScopeId` and `excludedSupermarketLocationIds`, and the query is
`WHERE l."supermarketId" = :sid ORDER BY l."createdAt" DESC`.

This plan is the read the screen actually needs. Backend only; the screen is
`apps/velista/plans/0059`.

Depends on `0061` and `0062` (the codes, and the shops having any), and on `0064`, which owns what
an exclusion means and whose `refusedLocations` and `includeExcluded` this generalizes. It must land
after `0064`, and it is independent of `0069`.

## 1. What the screen has to ask, and what it would have to do today

`0059` draws three things, and each of them is a question nothing can answer.

| The screen            | The question                                                        |
| --------------------- | ------------------------------------------------------------------- |
| The franchise buttons | which chains have at least one shop in my codes, and how many       |
| Inside a franchise    | that chain's shops in my codes, grouped by code                     |
| The search bar        | across every franchise, matching name, chain, address, city or code |

Take a profile with `14010` (home, Córdoba) and `28001` (the office, Madrid), which `0062` expands
to a dozen or so codes. To draw the Mercadona group a client would have to `GET
/v1/catalog/supermarkets` and page every chain in the catalog, then page every one of that chain's
shops in the country a hundred at a time, then filter on postal code in the browser. **To find the
three Mercadonas near you it downloads every Mercadona in Spain**, and it repeats that per chain
just to decide which buttons to draw.

That is not a client that is written badly. It is the only client that can be written against the
reads that exist.

## 2. The postal codes are the caller's, and catalog never learns whose

Same shape as every priced read since `0049`, and for the same reason: **the gateway resolves and
passes.** Core answers what the profile says, catalog answers what that means, and neither service
learns the other's domain.

1. core, `profiles.resolveScopes`: the postal codes, the chains, the refusals. It already answers
   all of it, including `excludedSupermarketLocationIds` since `0064`.
2. catalog, the two subjects below: the shops in those codes.

`ScopeResolutionService` on the gateway is where this belongs, beside `refusedLocations`, which
`0064` added for exactly this pair of reads. It is **not** the cached `describe` path: that one
throws for a profile that has said nothing, and "which shops are near me" must answer for somebody
who is in the middle of filling their profile in. `0069` removes that throw, and this plan does not
depend on it either way.

**A caller may also state the codes.** `postalCode` is repeatable on the priced reads already and
the same argument applies here: a screen showing a code the user is about to add should be able to
ask about it before it is saved.

## 3. Two subjects, not three

### 3.1 `supermarketLocation.summarizeByChain`

One row per chain with at least one shop in the codes: the chain, how many shops it has there, and
how many of them the caller has refused.

**A grouped count rather than a page**, which is the same decision `0063` made for
`countByPostalCode` and for the same reason: the caller wants the whole shape at once, and a page
over tens of rows is a cursor nobody would ever pass back. A country has tens of chains and a
person's neighbourhood has a handful of them plus its independents.

The refusal counts are what make `0059`'s three state franchise button expressible:

| `excludedChain` | `excluded` vs `locations` | The button reads                           |
| --------------- | ------------------------- | ------------------------------------------ |
| true            | anything                  | chain excluded, including its future shops |
| false           | `0`                       | none excluded                              |
| false           | `1..n`                    | some excluded                              |

`excludedChain` comes from core and the two counts come from catalog, and the gateway is what puts
them in one row. Catalog does the counting because only catalog knows which shop belongs to which
chain; the gateway hands it the refused ids it got from core.

### 3.2 `supermarketLocation.search`

A page of shops in the codes, with an **optional** chain and an **optional** query.

One subject rather than a list and a search beside it, which is `0048`'s decision for
`item.search` restated: that subject was upgraded in place rather than replaced, so the same read
serves a listing with no query and a ranked search with one. Here it is simpler still, because
there is no ranking to speak of (section 5).

- no query, `supermarketId` set: the franchise's shops, which is `0059` section 3.3
- query set, no `supermarketId`: the search bar, which is section 3.1 and searches **across**
  franchises on purpose
- both: a search within a franchise, which no screen asks for today and costs nothing to allow

### 3.3 What is deliberately not here

**No "shops near this point".** Distance is not the axis and `0059` section 3.3 says why: a profile
can hold Córdoba and Madrid, so there is no single centre to sort by. The postal code is the axis,
and it is the one thing both services already agree on.

**No new attribution field.** `0059` section 5 has to render `OSM_ATTRIBUTION` wherever shops are
shown, and `SupermarketLocationView` already carries `externalProvider` for the shop and
`postalCodeSource` for whether its code was given or derived from a GeoNames centroid (`0061`,
section 5). The obligation travels with the data already; the screen reads those two fields and
renders the constants. Adding a string to the view would be shipping the same sentence a thousand
times.

## 4. OTHER is a client side bucket, and it is not what `0059` assumes

`0059` section 3.2 is emphatic that OTHER matters, and it is right: `0038` measured **35 of the 75**
places in one city radius as independent shops with no chain. It describes them as the places
`groupByBrand` returns "under a `null` key", and that is true of `@portfolio/luna-shopper/osm-places`
and **false of the catalog**.

`SupermarketLocation.supermarketId` is `NOT NULL`. When the harvester imports an unbranded place,
`resolveSupermarket` creates a `Supermarket` **named after the shop itself**, with
`externalBrandKey` null. So "Frutería Paco" is not an absent chain in the catalog; it is a chain
with one shop.

What survives the import is therefore the **key**, not the grouping:

> `externalBrandKey`, nullable because an independent shop has none.

So OTHER is "the chains with no brand key", and this plan does **not** make it a server side
category. `summarizeByChain` returns each chain with its `externalBrandKey`, forty-odd rows in a
dense city, and the screen buckets the keyless ones into one button. The server reports what it
knows; how that reads as a button is `0059`'s.

**The caveat, so it is not discovered later.** A chain the owner typed in by hand also has no brand
key, so it would land in OTHER beside the greengrocers. That is a data statement rather than a bug:
the fix is to set `externalBrandKey` on the chain, which is an owner edit on an existing field, and
the schema does not change either way.

## 5. Matching, and why there is no index work

Five fields, per `0059` section 3.1: **shop name, chain name, address, city, postal code.** The
first four are `label`, the chain's `name`, `address` and `city`; the fifth is the column the whole
read is already filtered on.

**Narrow by postal code first, then match, and that is the whole design.** `0048` needed a per
locale `tsvector` and a trigram index because it ranks a product catalog of tens of thousands of
rows against a typed word. Here the candidate set is the shops in one profile's postal codes, which
is dozens, and a case insensitive substring over dozens of rows is not a query worth an index. If a
profile ever holds enough codes for that to stop being true, the answer is the cap on codes, not a
second search stack.

Two consequences worth stating:

- **The chain name is `LocalizedText`**, so matching it means matching the values of a JSON object
  rather than a column. Match **any** locale rather than the caller's: somebody who types
  "Carrefour" means the chain whatever language their phone is in, and the alternative is a search
  that fails on a name the user is looking straight at.
- **A result names its chain**, which `0059` section 3.1 requires because "Ronda de los Tejares" does
  not identify a shop on its own. The view carries the chain, not only its id, so the row can be
  drawn from one response.

## 6. Exclusions: this read shows them, and that is the point

`0064` made `supermarketLocation.list` leave out what the caller refused, with `includeExcluded` for
the screen that edits those choices. **This read is that screen**, so the same flag lives here and
the same default holds: filtered unless asked, because every other caller is offering a shop rather
than editing an opinion about one.

A shop the caller refused comes back **with a flag on it** rather than merely present, so the row
can be drawn switched off without the client cross referencing the profile's `locations` array
against the page it just fetched.

An excluded **chain** is a different matter: its shops are hidden from the offering reads entirely
(`0064`, section 2.1), and on this read with `includeExcluded` they are returned with the chain's
own state on the summary row, because that is the control the user needs in order to change their
mind.

## 7. Contracts and endpoints

Two NATS subjects on catalog, two REST routes on the gateway, both under the catalog surface beside
the reads they generalize:

- `GET /v1/catalog/shops/summary`, the franchise rows
- `GET /v1/catalog/shops`, the page, taking `supermarketId`, `query`, `includeExcluded`,
  `profileId`, repeatable `postalCode`, and the usual cursor and limit

Named `shops` rather than `locations` because `catalog/locations` is already the owner surface for
one location by id, and these two are the shopper's read of the same table. The distinction is worth
a word in the path: one is administered, the other is browsed.

**Regenerate the OpenAPI document** and commit it in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 8. Migrations

None. Every column this reads already exists: `postalCode` and `country` arrived with `0061`,
`externalBrandKey` with `0038`, and `label`, `address` and `city` with `0012`.

## 9. Exit criteria

- A profile with two distant postal codes gets the shops in **both**, and none from a code it does
  not hold, with a test.
- The summary answers one row per chain with a shop in the codes, carrying its brand key, its shop
  count and its refused count, and a chain with no shop in those codes is absent rather than zero.
- The three franchise states are each derivable from one summary row, with a test per state.
- The search matches on each of the five fields, with a test per field, and a result names its
  chain.
- The chain name matches in a locale the caller is not using.
- A caller may state postal codes instead of naming a profile, and gets the same answer as a
  profile holding them.
- Refused shops are absent by default and present **and flagged** with `includeExcluded`.
- Forty independent one shop chains come back as forty summary rows with no brand key, and nothing
  in catalog calls them OTHER.
- `openapi.json` regenerated and committed; `npx nx run-many -t build test lint -p
luna-shopper-backend-catalog,luna-shopper-backend-gateway,luna-shopper-contracts` passes.
