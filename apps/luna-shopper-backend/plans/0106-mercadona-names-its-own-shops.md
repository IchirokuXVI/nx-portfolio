> **PR:** [#340](https://github.com/IchirokuXVI/nx-portfolio/pull/340)

# 0106 Mercadona names its own shops

`store-discovery.runner.ts:19` says this:

> **The mode did not gain a sibling; the source did.** Mercadona publishes no store list, so plan
> `0038` had to ask OpenStreetMap for one, and that was the only case there was.

That premise is false, and it was checked against the live site on 2026-09-10. Mercadona's own store
finder loads one static document with every shop in it, no key and no session:

```
https://storage.googleapis.com/pro-bucket-wcorp-files/json/data.js
```

It is 610 KB holding **1,675 shops**, 1,599 in Spain and 76 in Portugal. A companion document,
`data_total.js`, states those two counts, so a run can check that it read the whole file rather than
assume it. Not one record is missing a postal code or coordinates.

`0038` section 2.8 concluded that a store list has to come from a radius over OpenStreetMap, because
asking Nominatim for postal code 14013 returned a bounding box spanning most of Córdoba and two
thirds of the shops carried no postcode at all. That finding was about OpenStreetMap's data and it
stays true of OpenStreetMap. It was never a finding about Mercadona's data, and Mercadona's has no
such gaps.

This plan reads the shops from the chain. **It also declares the price scope each shop belongs to**,
which is what makes `0108` able to say "no need to create them".

Depends on `0105` for the priority a declared scope carries. Follows `0089` section 9 exactly: this
is a second `listsItsOwnStores` source, not a new mode.

## 1. What the document holds

One record, verbatim, with the field names it uses:

```json
{
  "p": "ES",
  "cp": "14920",
  "dr": "CT CÓRDOBA-MÁLAGA",
  "lc": "Aguilar de la Frontera",
  "pv": "CÓRDOBA",
  "lt": 37.5122596,
  "lg": -4.65112654,
  "tf": "957688215",
  "id": 283185311978,
  "in": "0900#0900#0900#C#0900#0900#0900",
  "fi": "2130#2130#2130#C#2130#2130#2130",
  "fs": "13/09/26-C#20/09/26-C#27/09/26-C",
  "pk": "S",
  "fap": "03/08/2004",
  "lpc": "S"
}
```

| Field                    | Meaning                                               |
| ------------------------ | ----------------------------------------------------- |
| `p`                      | country, `ES` or `PT`                                 |
| `cp`                     | postal code, present on every record                  |
| `dr`, `lc`, `pv`         | street, town, province                                |
| `lt`, `lg`               | latitude and longitude, present on every record       |
| `id`                     | the chain's own store id, and therefore `externalRef` |
| `in`, `fi`               | opening and closing time per weekday, `C` for closed  |
| `tf`                     | telephone                                             |
| `fs`, `fap`, `pk`, `lpc` | special dates, opening date, parking, ready to eat    |

**Nothing here is a warehouse.** The document says where a shop is and not what it charges, which is
section 3.

## 2. The library reads it, and the library stays framework free

`@portfolio/luna-shopper/mercadona` gains one function and keeps its hard constraint: no TypeORM, no
Nest, no database, every test against checked in fixtures with no network.

```ts
/** Every shop the chain publishes. One request, and a count to check it against. */
static async listStores(options: ListStoresOptions): Promise<MercadonaStoreList>;

export interface MercadonaStoreList {
  /** `fechaCreacion` from the document, so a report can say how fresh it was. */
  publishedOn: string;
  stores: MercadonaStore[];
  /** From `data_total.js`: what the chain says the counts are, per country. */
  declared: Record<string, number>;
}
```

The fixture is refreshed with the library's `capture-fixtures` target and never by hand.

**A count that disagrees is a warning and not a failure.** The two documents are written by different
jobs and a run that read 1,598 of a declared 1,599 has still found 1,598 real shops. The report says
so, and section 5 is where it says it.

## 3. A shop's scope, and the second request kind

A Mercadona shop's price scope is its warehouse, and the warehouse is a property of the **postal
code**, answered by the chain itself:

```
PUT https://tienda.mercadona.es/api/postal-codes/actions/change-pc/
{"new_postal_code": "14920"}     ->     header  x-customer-wh: 4661
```

`MercadonaClient.resolveWarehouse` already does this and is currently called by nothing but the
fixture capture tool.

Measured over the whole file on 2026-09-10: the 1,599 Spanish shops sit on **1,137 distinct postal
codes** resolving to **255 distinct warehouses**, and **150 shops** answer 404. A 404 is not an
error. It means Mercadona sells online to nobody at that code, so the chain will not state a price
scope for that shop, and the shop takes the `STORE` scope every location with no named scope already
takes at import.

So a full run is 1 request for the document plus 1,137 for the codes, about five minutes at the
owner set rate. That is two orders of magnitude below a catalog discovery.

### 3.1 What the run declares

One `ScopeDeclaration` per distinct warehouse, through the mechanism `0103` built:

```ts
report.scope({ key: '4661', kind: PriceScopeKind.REGION, name: 'Almacén 4661' });
```

`PriceScopeResolver` creates what catalog does not hold and answers with what it does, so a second
run declares the same 255 keys and creates none of them. **The runner still creates nothing itself**,
which is `0103` section 6.4 and is not relaxed here.

## 4. The postal code filter

`StoreDiscoveryInput` gains one optional field:

```ts
/**
 * Restrict the run to shops in these postal codes. Absent means every shop the
 * chain publishes.
 *
 * It filters the document after it is read, because the document is one request
 * whatever is asked of it. What it genuinely saves is the second request kind:
 * a run filtered to four codes resolves four warehouses instead of 1,137.
 */
postalCodes?: string[];
```

The filter is on the shop's own `cp`, and this is the one thing to get right. Filtering by "near this
postal code" would reintroduce exactly the ambiguity `0038` section 2.8 found in OpenStreetMap, where
the twelve Mercadonas in Córdoba's 14013 bounding box sit in 14004, 14007, 14011 and 14014. Here the
chain states each shop's own code, so an exact match is a well posed question and a radius is not
needed.

**An empty array and an absent field are the same thing**, which is every shop. A filter that matched
nothing is a run that reports nothing, with a report line naming the codes that matched no shop.

## 5. The report

- One observed place per shop, carrying `externalRef` from `id`, `postalCodeSource: SOURCE`, and the
  chain identity that `0103` section 6.4 stamps.
- One scope declaration per distinct warehouse resolved.
- `publishedOn` and the declared counts against the read counts.
- The count of shops whose postal code answered 404, named as shops the chain prices no scope for.
- The postal codes asked for that matched no shop.

**No availability and no price.** The store finder states neither.

## 6. What changes

| File                                                      | Change                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `libs/luna-shopper/mercadona/src/lib/stores.ts`           | the document parser and its types                      |
| `libs/luna-shopper/mercadona/src/lib/mercadona.client.ts` | `listStores`                                           |
| `libs/luna-shopper/mercadona/tools/capture-fixtures.ts`   | capture both documents                                 |
| `harvester/.../mercadona-store-discovery.runner.ts`       | the new case                                           |
| `harvester/.../store-discovery.runner.ts`                 | dispatch `mercadona-api`, and delete the false comment |
| `harvester/.../store-discovery-runner.ts`                 | `postalCodes` on the input                             |
| `libs/luna-shopper/contracts/.../harvest.messages.ts`     | `listsItsOwnStores: true` for `mercadona-api`          |
| `gateway/.../harvest/harvest.dto.ts`                      | the postal codes field on the spawn                    |
| `libs/luna-shopper-admin/feature-harvest/runs-page.ts`    | the field, shown when the adapter lists its own stores |

`runnerFor` stops being a two way `adapterKey === 'lidl-api'` conditional and becomes a lookup, so a
third chain that names its own shops is a table entry.

## 7. Order of work

1. The library: parser, types, fixtures, tests. No network anywhere in them.
2. The capability flip and the contract change.
3. The runner and the dispatch.
4. The filter, end to end, including the back office field.
5. `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.

## 8. Tests

- Parser, against a checked in capture: 1,675 records, every one with `cp` and coordinates, the two
  countries split 1,599 and 76.
- A truncated fixture: the declared count disagrees, the run still reports its places, the report
  says the counts disagreed.
- The filter: two codes in, only shops with those codes out, only those warehouses resolved.
- A filter matching nothing: no places, one report line, no error.
- A 404 from `change-pc`: the shop is still reported, no scope is declared for it, the report counts
  it.
- `store-discovery.runner.spec.ts`: `mercadona-api` reaches the new case, an unknown adapter and a
  run with no chain still reach OpenStreetMap.

## 9. Decisions

- **D1. The shops come from the chain, not from OpenStreetMap.** Official names, exact postal codes
  and no gaps beat a radius over community data, which is the same reasoning `0089` used for LIDL.
- **D2. A run declares scopes.** Otherwise `0108` has to create them mid-crawl, which is the layering
  `0103` removed.
- **D3. It still imports nothing.** `0038` section 6.1 holds: a run reports places and an admin
  decides. `0107` is where that changes, and it changes for a configured source rather than for this
  one.
- **D4. The filter matches the shop's own postal code exactly.** A radius here would rebuild the
  ambiguity the chain's own data removes.
- **D5. A 404 postal code is data.** It means no online warehouse, so the shop keeps a `STORE` scope
  and nothing pretends to know its price.

## 10. What this plan does not do

- It fetches no price. A price is a catalog discovery, and that is `0108`.
- It does not touch the OpenStreetMap case, the postal code queue, or the radius.
- It does not collapse the 255 warehouses into the ten price groups measured on 2026-09-10. The
  format allows a price per warehouse and a collapsed model cannot record the week one warehouse
  differs, which is the rule `0089` already states for LIDL's 59 regions.
