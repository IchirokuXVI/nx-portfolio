> **PR:** [#346](https://github.com/IchirokuXVI/nx-portfolio/pull/346)

# 0076: what the sheet remembers

> Third of the five basket finding plans (`0074` to `0078`). `0075` built the view state.
> This plan keeps part of it between visits, on the device, with a date on each part.
>
> Not every property is worth keeping. Order, grouping and the shop move lines and mark
> them, and a shopper who likes the list grouped by category likes it that way tomorrow
> too. The search and the list filter hide lines, and a basket that opens with half its
> lines missing because of a choice made last week is a basket somebody thinks is broken.
> So only the first kind is remembered.
>
> And one of the first kind is worth keeping for a while rather than for ever. "Prices from
> Mercadona" is true for the trip, not for the month. So each remembered property carries
> its own date, and the shop's is two hours out.
>
> Prerequisite reading: `0075` section 2 (the state), `0004` section 5.3 (why velista keeps
> things in `localStorage` and what it costs) and `BrowserFacade` in `libs/velista/platform`.

## 1. What is being built

| Piece                                                   | Where                                       |
| ------------------------------------------------------- | ------------------------------------------- |
| The storage key                                         | `libs/velista/platform/.../storage-keys.ts` |
| The record, its reading and its writing                 | `BasketViewStore`, a new `basket-view-memory.ts` |
| The per property expiry                                 | `basket-view-memory.ts`                     |
| The fake in specs                                       | `fakeBrowserFacade`, already there          |

No copy: nothing here is drawn.

## 2. The record

One key, `StorageKeys.basketView`, `basket-view:${APP_KEY}`, in the shape every velista
key takes. One record for the device, not one per basket: the preference is the shopper's,
and a shopper with two baskets in a week does not want to set it twice.

```ts
export interface BasketViewMemory {
  readonly version: 1;
  readonly order?: Remembered<BasketOrder>;
  readonly grouping?: Remembered<BasketGrouping>;
  /** A price scope id (`0078`). */
  readonly shop?: Remembered<string>;
}

export interface Remembered<T> {
  readonly value: T;
  /** ISO instant after which the value is ignored, or null for never. */
  readonly until: string | null;
}
```

`lists` and the search are not in the record and never will be, by section 0's argument.

The lifetime of each property is a constant beside the reader, and it is the only place the
numbers live:

```ts
export const BASKET_VIEW_LIFETIME_MS: Readonly<Record<keyof BasketViewMemory, number | null>> = {
  order: null,
  grouping: null,
  shop: 2 * 60 * 60 * 1000,
};
```

A property added later names its lifetime here or the code does not compile, which is what
makes the expiry general rather than a special case for the shop.

## 3. Reading, once

`BasketViewStore` reads the record **once, when the basket loads**: `open()` on the basket
store resolves, and the view store then reads storage and applies what it finds. The two
rules of that moment:

- **An expired property is ignored.** A property whose `until` is in the past at that
  moment is skipped, and the record is written back without it. The others apply.
- **Nothing is watched afterwards.** A shop remembered at 10:00 and read at 11:50 is
  applied. It expires at 12:00, and the list does not change under the shopper at 12:00:
  the expiry is not a timer, it is a date the reader compares against once. The next
  basket to open after 12:00 ignores it. `watchStorage` is not used either, for the same
  reason: a second tab changing the filter must not move rows under a thumb in this one.

Two more things the reader drops, silently, without writing anything back:

- A `shop` that is not among this basket's scopes (`BasketView.scopes`). The record was
  written on a basket priced at other shops, or a profile changed. The value stays in
  storage, because the next basket is very possibly priced at that shop again.
- A `grouping` of `list` for a reader whose lines carry no `origins`. That reader is shown
  the list ungrouped, and the sheet shows "Nothing" selected, because "List" is not a choice
  the sheet offers them. The value stays in storage, because the owner's phone is usually
  the owner's.

An unreadable record, a version that is not 1, a value that is not one of the union's, all
read as no record. Rule D4: the record is `unknown` until it is mapped.

## 4. Writing, on every change

Every setter of a remembered property writes the whole record, with that property's
`until` set to now plus its lifetime, or null for a lifetime of null. The other properties
are written as they stand, dates included, so setting the grouping does not extend the
shop's two hours.

`reset()` writes a record with no properties. Setting a property back to its default by hand
writes it as a property with the default value, which is deliberate: a shopper who chose
"Nothing" over a remembered "Category" has made a choice, and the record says so.

Every read and write goes through `BrowserFacade`, which swallows a throwing storage and
returns null, so a private window works and merely forgets.

## 5. Tests

1. Opening a basket applies a remembered order, grouping and shop.
2. A property with `until` in the past is ignored and removed from the record, and the
   others still apply.
3. A property with `until` in the future is applied, and a clock that passes `until` while
   the basket is open changes nothing.
4. Setting the shop writes `until` two hours out, and setting the grouping leaves the shop's
   date untouched.
5. A remembered shop not among the basket's scopes is ignored and kept in storage.
6. A remembered `list` grouping is ignored for a reader with no origins and kept in storage.
7. `lists` and the search are never written, whatever is set.
8. A record with the wrong version, or a value outside the union, reads as no record.
9. A storage that throws reads as no record and every setter still works.

## 6. Acceptance criteria

- The order, the grouping and the shop a shopper chose are there when the next basket
  opens, and the search and the list filter are not.
- The shop is forgotten after two hours, but never while a basket is open.
- Adding a property that is remembered means naming its lifetime, or the build fails.
