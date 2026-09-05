# 0012 One queue for everything a source named

Backend plan `0086` folds `item_source_refs` and `source_aliases` into `source_catalog_entries`
and deletes the `REFRESH` run mode. The back office has three queue screens over those tables
today: `harvest/entries` for products a walk found and nothing matched, `harvest/item-refs` for
the fuzzy matches a walk proposed, and `harvest/leaflets/queue` for the printed names a leaflet
queued. After `0086` they list one table with one status column, so they are one screen.

This plan is that screen, and the two deletions the backend forces on the run form. It is small on
purpose: the queue `0010` section 3 drew for leaflets is the right shape for every source kind,
and this plan generalises it rather than designing a fourth.

Depends on backend `0086`. Nothing here can be built before the one table and its four routes
exist, and the wire types it reads are generated from that plan's `openapi.json`.

## 1. The queue

Route `harvest/entries`, and only that. `harvest/item-refs` and `harvest/leaflets/queue` are
removed from `routes.ts`, from the navigation list, and from `en.json`. `harvest/leaflets/upload`
stays and its success state links to `harvest/entries` with the chain preselected, where the
upload's rows now are.

The chain is chosen first, as every queue does. One row per `source_catalog_entries` row in
status `CANDIDATE` or `UNRESOLVED`, newest `lastSeenAt` first, which is what `sourceEntry.list`
answers with no `status` given. Two filters beside the chain: a status choice that also offers
`ACTIVE` and `REJECTED` for looking a decision up, and a source kind choice with the three
official kinds, so an operator working through a leaflet's rows is not interleaved with a walk's
4,000.

Each row shows what the source said and what the ladder proposed:

- The name, brand, format and size, verbatim. The EAN when there is one.
- **A source kind badge**: API, web or leaflet. It is the one thing that tells a Mercadona product
  from a Mercadona leaflet tile of the same product, and the two are two rows on purpose.
- The price and unit price on the row, with the leaflet window when it has one, and the page and
  raw text out of `details` for a leaflet row. A row with no price says so rather than showing
  a blank, because for a DEZA row that is the truth and for a leaflet row it is the conditional
  promotion rule of backend `0081` section 6.2.
- The proposal, when the ladder made one: the catalog item under `itemId`, resolved through the
  directory as the alias queue resolves its candidate today, or the sibling row under
  `candidateEntryId` with its own name and kind. `confidence` and `matchedBy` beside it.
- `timesSeen`, and the run that last saw it as a link to `harvest/runs/:id`.

Three actions, the ones `0010` section 3 gave the alias queue, on every row whatever its kind:

- **Accept, to an existing product.** The proposed item is preselected when there is one.
  Otherwise the reference picker over `items` with a search filter, since a typeahead with no
  filter ignores what is typed. Sends `POST /v1/admin/harvest/entries/:id/accept` with the
  `itemId`. When the proposal is a sibling row rather than an item, the primary action is instead
  to open that sibling, because it is the one with the EAN and the one to create the item from.
- **Accept, as a new product.** The inline item form, prefilled from the row: `name.es` from
  `name`, `name.en` empty, `brand`, `ean`, `unitSize`, the category the backend derives shown as
  the default, the default unit likewise. The operator changes anything. Sends
  `POST /v1/admin/harvest/entries/:id/item` with only the fields the operator changed, because
  the backend fills every other one from the row. The row keeps its printed name whatever the
  item is called (backend `0086`, D6).
- **Reject.** `POST /v1/admin/harvest/entries/:id/reject`, with a confirmation. The row leaves
  the queue as `REJECTED` and no run asks about it again.

**The confirmation names the price.** `SourceEntryAcceptResult.pricesWritten` says whether the
accept wrote one, and the row said which: "1.19 EUR written for Mercadona, national, from the
walk of 4 September" or "no price on this row, nothing written". An operator who accepts a DEZA
row and sees no price written must not read that as a failure, so the sentence says why.

## 2. The run form

`MODES` in `runs-page.ts` loses `REFRESH`. `harvest-seed.ts` and `harvest-memory.ts` lose their
refresh fixtures.

`CATALOG_DISCOVERY` gains a price scope picker, shown when the chosen chain's source adapter is
`mercadona-api` and required then, because the spawn refuses a Mercadona walk without one
(backend `0086` section 8). The picker lists the chain's scopes, the way the leaflet upload page
already picks one for its chain, and defaults to the chain's national scope as that page does.
For a `deza-web` source it is not shown: the backend accepts a scope for that adapter and ignores
it, and a field that does nothing is not offered.

The runs list and the run page show the three modes and nothing else. A run page for a
`CATALOG_DISCOVERY` shows `updated` and `unchanged` as prices written and confirmed, the way it
already reads a leaflet run's counters, because a walk writes prices now.

## 3. Data layer and models

`harvest-api.ts` and `harvest-memory.ts` lose the alias and item ref calls and gain
`acceptEntry`, `createItemFromEntry` and `rejectEntry` beside `listEntries`, which takes the
status and source kind filters. `ref-view.ts`, `ref-view.spec.ts`, `alias-view.ts` and
`queued-aliases.ts` go, and `entry-view.ts` takes their place: one view model, mapped from the
generated `SourceCatalogEntry` wire type through the same `unknown` mapping every other model
uses (rule D4). The source kind is an enum of this app's own, as every other enum is.

The wire types are regenerated from backend `0086`'s document and committed with it.

## 4. Testing

- `entries-queue.spec.ts`: the queue lists the two queued statuses by default, filters by status
  and by source kind, shows a kind badge per row, resolves an item proposal through the directory
  and a sibling proposal through the row's own fields, and shows "no price" for a row with none.
- Accept with a proposal sends the proposed `itemId`. Accept with a sibling proposal opens the
  sibling. Create sends only the changed fields. Reject asks first.
- The confirmation sentence for `pricesWritten` of 1 and of 0.
- `routes.spec.ts`: `item-refs` and `leaflets/queue` are gone and the navigation has one queue
  entry for entries. `harvest-absent.spec.ts` still passes with the fewer routes.
- `runs-page.spec.ts`: three modes, the scope picker shown for a Mercadona source and required,
  hidden for a DEZA source.

## 5. Exit criteria

- One queue route lists every `CANDIDATE` and `UNRESOLVED` row of a chain whatever its source
  kind, with the kind visible per row, and offers accept, create and reject on each.
- The item refs and leaflet queue routes, pages, views and translations do not exist.
- The run form cannot name `REFRESH`, and a Mercadona walk cannot be started without a scope.
- `wire-types.ts` is regenerated and `npx nx affected -t lint test build` is green.
