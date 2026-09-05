> **PR:** [#224](https://github.com/IchirokuXVI/nx-portfolio/pull/224)

# 0010 A leaflet arrives as a file and leaves as a queue

Backend plan `0081` imports a supermarket leaflet from a JSON document and queues every offer it
cannot resolve. This plan is the two screens that feed it and drain it: the upload, and the queue
of printed names waiting for a person.

Depends on `0006` for the harvest shell, the run page and the queue primitives. Depends on backend
`0081` for the route and the alias table, and on backend `0080` for the price rows the run writes.
Depends on backend `0079` for a product with a Spanish name and no English one.

## 1. This is not a descriptor screen

`0004` built the back office as descriptors: a list, a form, a data layer that maps one wire type
to one resource. `0005` section 4 already said prices were not one. Neither is this.

A file drop that validates, previews a table of offers, asks for a chain, a scope and two dates,
and starts a run is not a form over a resource. A queue where each row is a decision with three
outcomes, one of which creates a product, is not a list with an edit action. Both are bespoke
pages in `libs/luna-shopper-admin/feature-harvest`, beside `runs-page.ts`, `run-page.ts` and the
three queues `0006` drew. They reuse the shell, the data layer, the reference picker and the i18n
machinery without pretending to be descriptors.

## 2. The upload

Route `harvest/leaflets/upload`, reached from the harvest shell's navigation and from the runs
page's start form. That form gains `LEAFLET_IMPORT` in its mode picker (`runs-page.ts` line 27)
and sends the operator here instead of showing its own fields.

The page, top to bottom:

1. **The file.** A file input accepting `.json`, read in the browser, parsed. A file that is not
   JSON says so at once. The parsed document is held in memory and never stored by the client.
2. **What was read.** `retailer.name`, `retailer.chain_id`, `source.file`, `source.sha256`, the
   page count, the offer count, and the extractor's own `warnings` count. These are shown before
   anything is chosen, so a wrong file is obvious before it is sent. `chain_id` is displayed and
   never used to pick anything (backend `0081` section 4).
3. **The chain.** A reference picker over `supermarkets`, the same control the price form uses.
   Required.
4. **The scope.** A picker over the chosen chain's `price-scopes`, defaulting to its `NATIONAL`
   scope when one exists, because most leaflets are nationwide. A chain with no `NATIONAL` scope
   shows a link to the existing price scopes create form with the chain preselected, and the
   picker refreshes on return. Required.
5. **Validity.** Two date inputs prefilled from `validity.starts_on` and `ends_on`. A null in the
   file leaves its input empty and required. The operator is free to change both.
   The dates are sent as `YYYY-MM-DD` and the backend turns them into `Europe/Madrid` instants.
6. **A preview table** of the offers: id, page, printed name, format, brand, basis, price,
   promotion type, loyalty. Sortable by page. Loyalty rows and rows whose promotion has no single
   unit price are drawn muted with a note, so the operator sees before submitting which rows the
   rules will drop or queue.
7. **Import.** `POST /v1/admin/harvest/leaflets`. On 201, leave for the run page, which polls
   the run to completion as every run does (`0006` section 2). On 409, show the earlier run and
   link to it, with the sentence that the same document was already imported and can be
   reverted first. On 400, section 2.1.

### 2.1 Validation feedback names the offer

The gateway validates the document against the versioned schema and answers a 400 problem document
listing every failure with its JSON path (backend `0081` section 4). The page turns each path into
a row: the offer id where the path is under `offers[n]`, the field, and the message. An offer with
three failures is one row with three lines. A failure outside `offers` names the section.

The rows are drawn beside the preview table, and the preview row with the same id is highlighted.
The operator fixes the file in the extractor and drops it again. Nothing on this page edits the
document, on purpose: an edited document has a different digest, and the digest is the dedupe key.

## 3. The queue

Route `harvest/leaflets/queue`. One row per `source_aliases` row in status `CANDIDATE` or
`UNRESOLVED`, newest first, filtered by chain. The chain is chosen first, as the entries queue does
(`entries-queue-page.ts` lines 52 to 54), because the queue is per chain by construction.

Each row shows the printed name, format and brand. It shows the leaflet price and basis from the
run that queued it, and the page. It shows `raw_text` and `confidence` where the document carried
them. It shows the candidate the fuzzy rung proposed, where there is one, and how many times this
string was seen. Three actions:

- **Accept, to an existing product.** The candidate is preselected when there is one. Otherwise a
  reference picker over `items`, with a search filter, since a typeahead with no filter ignores
  what is typed. Confirm sends `POST /v1/admin/harvest/aliases/:id/accept` with the `itemId`.
- **Accept, as a new product.** Opens the item form inline with `name.es` prefilled from the
  printed name, `name.en` empty, `brand` prefilled from the printed brand, and category and
  default unit to choose. The operator changes the name and the brand freely. Save sends one
  call, `POST /v1/admin/harvest/aliases/:id/item`, which creates the item and binds the alias in
  the harvester, the way `entries/:entryId/item` does for a snapshot entry. The alias keeps its
  printed name whatever the item is called (backend `0081` section 2).
- **Reject.** `POST /v1/admin/harvest/aliases/:id/reject`, with a confirmation. The row leaves
  the queue and the alias stays as `REJECTED`. The next leaflet that prints that string skips it
  with a warning and does not ask again. That is the rule `DiscoveredPlaceStatus` already keeps
  for places: the status is the owner's, and a run does not get to overwrite a decision.

**Accepting writes the price** the row was queued for, from the run's stored document, with that
run's id (backend `0081` section 3). The row's confirmation says so: "1.19 EUR written for Deza,
national, until 23 September".

### 3.1 With `0079`, a Spanish only product is legal

Before backend `0079` a new item needed both names, and the only way to save a leaflet product
was to copy the Spanish string into `en`. Now `name.en` stays null. The inline form leaves it
empty, the draft accepts one locale (`resource-draft.ts` under `0079`), and the item lists in the
catalog screens with a `missing en` tag. The operator translates it when he has time, or never,
and a shopper in English sees the Spanish name through the fallback either way.

## 4. Its own page, not a fourth tab on an existing one

Two of `0006`'s queues are candidates for reuse. `item-refs-queue-page.ts` is the closest: confirm,
reject and correct on a candidate mapping, one decision at a time. `entries-queue-page.ts`
promotes a snapshot entry to a product, which is the create path here.

**Decision: a new `aliases-queue-page.ts`, sharing the primitives and not the page.**

The ref page's row is a mapping from an item to a chain's product id. It is drawn around
`refProblem` and a product that stopped appearing. Its correction is "no, it is that other product
id". Its route is `item-refs/unresolved`. An alias row is a printed string with a price and a
page. Its correction is "it is that item" or "it is a new item called this". One page over both is
a page with two row shapes, two APIs and two vocabularies. `0006` itself learned to avoid that
when the entries page found that half the routes it was drawn around did not exist
(`entries-queue-page.ts` lines 43 to 50).

What is shared, and extracted from the ref page where it is inline today: the confirm, reject and
correct trio as a row footer, the item reference picker with its search filter, `formatInstant`,
and the queue's empty and error states. What is new: the row body, the inline item form, and the
per chain chooser reused from the entries page.

The harvest shell gains a fourth queue entry, and its badge counts `CANDIDATE` plus `UNRESOLVED`
aliases for the chosen chain, the same count the queue's first page shows.

## 5. The run page, for a leaflet run

`run-page.ts` already draws a run's counters and status. A `LEAFLET_IMPORT` run adds two things it
reads off the widened `HarvestRunView`:

- **Warnings**, as a table: offer id, code, message. `LOYALTY_REQUIRED`, `CONDITIONAL_PRICE`,
  `DUPLICATE_KEY`, `REJECTED_ALIAS`, and the extractor's own warnings carried through. This is
  where the operator sees what was dropped and why, which is the owner's condition for dropping
  loyalty offers at all.
- **A link to the queue** filtered to this run's chain, with the count of rows the run queued.

The counters keep their labels, with `skipped` added.

## 6. Data layer and models

`libs/luna-shopper-admin/data-access/src/lib/harvest/harvest-api.ts` gains the upload call, the
three alias calls and the alias list. `harvest-memory.ts` and `harvest-seed.ts` gain an in memory
alias queue for the specs and the demo. `models/src/lib/harvest` gains `SourceAliasRow`, mapped
from `Wire.HarvestSourceAliasView` after `wire-types.ts` is regenerated, and the warning row
mapped from the run view. The i18n file gains the `harvest.leaflets.*` keys in English, which is
the operator's language (`localized-text.ts` lines 20 to 26).

## 7. Testing

- `leaflet-upload-page.spec.ts`: a non JSON file is refused in the browser. The preview shows the
  right counts. `NATIONAL` is preselected for a chain that has one. A null date makes the input
  required. A 400 is drawn as rows naming offer ids. A 409 links to the earlier run.
- `aliases-queue-page.spec.ts`: accept to a candidate sends the candidate's id, accept as new
  sends the edited name and brand and leaves `en` null, reject removes the row, the shell badge
  matches the count.
- `run-page.spec.ts`: warnings render for a leaflet run and not for a discovery run.
- `queues.spec.ts` and `routes.spec.ts` gain the fourth queue and the two routes.

## 8. Exit criteria

- An operator drops a leaflet JSON, sees what it contains, and picks a chain and a scope. For a
  file with no dates he types them. He starts a run that the run page then watches to completion.
- A document the schema refuses is explained by offer id and field, and the operator can fix and
  retry without leaving the page.
- Every queued printed name can be accepted to an existing product, accepted as a new product with
  any name and brand, or rejected. The printed name is never changed by any of the three, and a
  rejected one is not asked again.
- A new product from a leaflet is saved with no English name.
- Accepting a row writes the price it was queued for and says so.
- The queue is its own page sharing the ref page's primitives, and the shell counts it.
- The run page lists a leaflet run's warnings.
- `wire-types.ts` is regenerated and committed, and `npx nx affected -t lint test` is green.
