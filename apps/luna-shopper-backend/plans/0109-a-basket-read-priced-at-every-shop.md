> **PR:** [#351](https://github.com/IchirokuXVI/nx-portfolio/pull/351)

# 0109: a basket read priced at every shop

> Client half: `apps/velista/plans/0078` (prices from one shop) and `0077` section 4 (the
> list grouping), which draw the two things this plan adds.
>
> The basket read prices every product once, at the cheapest of the run's scopes. That is
> the right answer to "what will this cost" and the wrong shape for "what does this shop
> charge": `offersFor` is a `DISTINCT ON (itemId)`, so the read cannot say which scopes
> list a product, only which one is cheapest. A chain filter built on it silently drops
> every product a chain stocks but is cheaper elsewhere, which velista `backlog/0001`
> recorded and which is why that filter was never built.
>
> This plan widens the read: every scope's offer, per product, in the same response. It
> also adds one number the list grouping needs, how many of a line each origin got, which
> the origins service already computes and the basket read does not carry.
>
> Prerequisite reading: `0066` (the basket read and its scopes), `0080` (what a price on
> `supermarket_items` is), `0105` (a shop under several scopes, and why the selection inside
> one shop's stack is not "cheapest") and `0104` section 4 (`settledPerOrigin`).

## 1. What is being built

| Piece                                                          | Where                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| A request that asks for every offer, and the answer            | `GetItemsRequest`, `ItemView`, `catalog.messages.ts`     |
| The query that answers it                                      | `item.service.ts`, beside `offersFor`                    |
| The basket read asking for it                                  | `generated-list-sharing.controller.ts`                   |
| What each origin got, on the basket line                       | `GeneratedListLineOriginView`, `generated-list.service.ts` |
| The document and the wire types                                | `openapi.json`, `wire-types.ts`                          |

## 2. Every offer, on request

```ts
export interface GetItemsRequest {
  ids: string[];
  priceScopeIds?: string[];
  /**
   * `best`, the default and what every caller gets today: one offer per item,
   * the cheapest across the scopes. `all`: every scope's offer, and the
   * cheapest still first and still on `bestOffer`.
   */
  offers?: 'best' | 'all';
}

export interface ItemView {
  // ...as today...
  bestOffer?: ItemOfferView | null;
  /** Present only when the request asked for `all`. Sorted by price, cheapest first. */
  offers?: ItemOfferView[];
}
```

`allOffersFor(itemIds, priceScopeIds)` beside `offersFor` is the same query without the
`DISTINCT ON`: every `supermarket_items` row for those items within those scopes, `available`
only, ordered by item then price with nulls last. It answers a `Map<itemId, ItemOfferView[]>`,
and `getMany` fills `offers` from it and `bestOffer` from the first entry, so the two cannot
disagree.

**Absent from `offers` means unlisted.** A row with `available = false` is excluded exactly as
`offersFor` excludes it today, so the client's "not listed at Mercadona" is "no row, or a row
that says unavailable", and there is no third state to draw.

Size: a basket of forty lines against ten scopes is at most four hundred rows in one query,
which is smaller than the product detail the same read already carries. No paging.

### 2.1 Which scopes, and whose stack

The basket read already resolves the run's scopes through `describe` and passes them as
`priceScopeIds`. Nothing changes there. What `0105` adds, a shop holding several scopes with
a priority, does not change this plan either: the read answers per scope, and which of a
shop's scopes the client shows is the client's question, answered by the scope the shopper
picked. The cheapest across scopes (`bestOffer`) keeps `0105` section 1.3's rule, that
comparing different shops is what the product is for.

Per shop availability overrides (`supermarket_location_items`, `0085`) stay unread, as they
are today. A scope's `available` is the answer.

## 3. The basket read

`GeneratedListParticipantController`'s basket route calls `getMany` with `offers: 'all'` and
the resolved scope ids. Everything else about the read is unchanged: the same scopes, the
same redaction, the same `scopes` array naming each scope's chain and, for a reader who
passes the rule, its locations.

Every other caller of `getMany` is untouched and keeps `best`.

## 4. What each origin got

```ts
export interface GeneratedListLineOriginView {
  id: string;
  zoneId: string;
  listId: string;
  lineId: string;
  /** What this origin contributed to the basket line's summed quantity. */
  quantity: number;
  /** How many of those were bought for this origin. BOUGHT rows only, reverted excluded. */
  settled: number;
  lineVersion: number;
}
```

`settled` is `GeneratedListOriginsService.settledPerOrigin`'s number, the floor `0104`
checks, computed **once for the whole basket** in `basketLineViewsFor` rather than once per
line: one grouped query over `line_settlements` for every origin of every line of the
basket, joined into the views. The per line method stays for the origins read and the
writes.

It rides on `origins`, so it is absent for exactly the readers `origins` is absent for.

## 5. The document and the wire types

Both regenerated and committed in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

`openapi-document.spec.ts` and `wire-types.spec.ts` fail until they are.

## 6. Tests

1. `getMany` with `offers: 'all'` answers every available row per item within the scopes,
   cheapest first, and `bestOffer` equals the first.
2. `getMany` without the flag answers exactly what it answers today.
3. An item with no row in the requested scopes answers an empty `offers` and no `bestOffer`.
4. An `available = false` row is absent from `offers`.
5. The basket read carries `offers` on every product and the same `scopes` as before.
6. `settled` on an origin equals the sum of live BOUGHT rows for that origin, a reverted row
   excluded and a NOT_AVAILABLE row counted as zero.
7. A guest's basket read carries no `origins` and therefore no `settled`.
8. The origins are computed in one query for the basket (integration, counted).
9. The OpenAPI document and the wire types are current.

## 7. Acceptance criteria

- A basket read says, for every product, what every one of the run's scopes charges, and
  which of them list it at all.
- The cheapest offer is unchanged and still first.
- Every origin on a basket line says how many of its share were bought.
- No other caller of the catalog's lookup sees a change.
