> **PR:** [#221](https://github.com/IchirokuXVI/nx-portfolio/pull/221)

# 0011 The shops a source names

Backend plan `0084` adds `source_locations`: one row per shop a source names, holding the source's own
code, the name it printed, and the catalog location it points at once somebody says which. A run that
meets an unmapped shop writes no availability for it, counts it, and finishes.

This plan is the screen that turns those rows into mappings.

Depends on `0006` for the harvest shell and the queue pages beside which this one sits. Depends on
backend `0084` for the table and the four routes. Depends on `0004` for the reference picker.

## 1. A fourth queue, not a descriptor screen

`0006` drew three queues in `libs/luna-shopper-admin/feature-harvest`: `entries-queue-page.ts`,
`item-refs-queue-page.ts` and `places-queue-page.ts`. This is the fourth, and it is closest in shape
to the third.

`0010` section 1 gives the test for whether something is a descriptor screen, and this fails it the
same way: a row here is a decision with three outcomes, one of which binds a foreign record, and none
of which is "edit this row's fields". A descriptor list with an edit form over `externalId` and
`printedName` would offer the operator the two columns nobody is allowed to change.

So: a bespoke page reusing the shell, the data layer, the reference picker and the i18n machinery,
exactly as the other three do.

## 2. The queue

Route `harvest/shops`, in the harvest shell's navigation beside the existing queues.

**The chain is required and comes first.** `source_locations` is unique on
(`supermarketId`, `externalId`) and the mapping only makes sense within one chain. A reference picker
over `supermarkets` sits above the table, and the table is empty with a prompt until one is chosen.
This mirrors the existing queues, which are all chain scoped.

Columns:

| Column | Notes |
| --- | --- |
| Code | `externalId`. The source's own key, for example `T1`. Monospace, because it is an identifier. |
| Printed name | `printedName`, what the source displayed. |
| Status | `ACTIVE`, `UNMAPPED` or `IGNORED`. |
| Mapped to | The catalog location's label and address, blank when unmapped. |
| Matched by | `NAME_SIZE` for the automatic name match, `MANUAL` when a person bound it. |
| Last seen | `lastSeenAt`, and a link to `lastRunId`. |

Filter by status, defaulting to `UNMAPPED`, because the queue exists to be drained. The other two
statuses are reachable so that a wrong mapping can be found and undone.

**`matchedBy` is a column and not a detail.** A row bound by the automatic exact name match and a row
bound by a person look identical otherwise, and they carry different confidence. An operator
reviewing the chain's mappings needs to see which ones nobody checked.

## 3. Three actions

- **Map.** A reference picker over that chain's locations, then `sourceLocation.map`. The row becomes
  `ACTIVE` with `matchedBy: MANUAL`.
- **Ignore.** `sourceLocation.ignore`, for a place the source lists that we do not sell from. DEZA
  publishes eighteen centres and ten of them appear in the product listing, so eight rows exist to be
  ignored once and never seen again.
- **Unmap.** `sourceLocation.unmap`, back to `UNMAPPED`. Available on an `ACTIVE` row.

**The dialog says what mapping does not do.** Backend `0084` section 7 is explicit: mapping a shop
does not backfill the availability the run skipped, and the next run writes it. The operator is told
so at the moment of mapping, with the run start form one link away. Without that line the natural
reading of a green `ACTIVE` badge is "the data is here now", and it is not.

## 4. The picker needs a search filter on `locations`

The picker is scoped to the chosen chain and typed into, which is two requirements on the target
descriptor.

`LOCATIONS` in `libs/luna-shopper-admin/feature-catalog/src/lib/locations.ts` is already a resource,
and reference fields and reference filters over it exist. **A reference picker whose target declares
no `search` filter silently ignores what is typed**, showing the first page and nothing else. The
descriptor model supports the `search` filter kind. `LOCATIONS` gains one in this plan, and the
picker passes the chain as a fixed filter beside it.

A chain with ten shops does not need a typeahead. A chain with three hundred does, and the descriptor
is shared, so the filter belongs on the descriptor rather than in this page.

## 5. Data layer and models

Four gateway routes under the admin namespace of plan `0073`, and their wire types.

Both generated files are regenerated and committed in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

`wire-types.spec.ts` and `openapi-document.spec.ts` fail when either is stale, so a forgotten
regeneration is a red pull request rather than silent drift. A large reordering diff in
`openapi.json` after adding a controller is the generator sorting components, not damage.

## 6. What this plan does not draw

- **Per shop availability is not shown here.** Backend `0084` writes it and this screen maps the
  shops that let it be written. A screen that lists what one shop stocks belongs beside the catalog
  location screens of `0005`, and it is not in this plan.
- **The disagreements a run declined to write** are reported on the run, which is `0006`'s run page.
  This queue is about shops, not products.
- **Nothing creates a catalog location.** An unmapped shop that is genuinely a new store is created
  through the existing locations screen and then mapped here. Two acts, because creating a location
  sets a price scope and that is a decision, not a side effect of draining a queue.

## 7. Testing

- The table renders the six columns from a seeded chain, in `harvest-memory.ts`.
- Status filter defaults to `UNMAPPED`.
- Mapping calls `sourceLocation.map` with the picked location and moves the row to `ACTIVE`.
- The mapping dialog shows the "not backfilled" line. This is asserted on the component input rather
  than the rendered text, because the string interpolates and the testing translator does not
  interpolate.
- Ignoring removes the row from the default filter.
- The `locations` picker passes the typed term as a search filter. This is the test that the filter
  added in section 4 is actually reaching the request.
- The queue is unreachable with no chain chosen.

## 8. Exit criteria

- An operator maps a source's shop to a catalog location without leaving the back office.
- An unmapped shop is visible, and the count matches what the run reported.
- A shop the chain renames keeps its mapping, because the row is keyed on the code.
- `LOCATIONS` declares a search filter and the picker honours it.
- The committed OpenAPI document and the generated wire types are current.
