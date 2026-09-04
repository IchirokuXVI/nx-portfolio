> **PR:** [#189](https://github.com/IchirokuXVI/nx-portfolio/pull/189)

# 0075 Who changed this, and what it was before

The catalog records where a price came from and when. It does not record **who** put it there, or
what it replaced.

`SupermarketItem` carries `priceSourceKind` and `priceObservedAt`, which answer "was this typed or
fetched, and how old is it". Neither answers "I changed something last Tuesday and now a number is
wrong, what did I change". Today nothing can answer that, and nothing ever will be able to answer
it about last Tuesday, because history that was not written cannot be recovered.

That asymmetry is the whole argument for doing this now rather than when it is first wanted. An
actor column can be added at any time and starts being useful immediately. A history table added
later starts empty and stays useless for as long as it takes to accumulate.

Depends on `0071` (there is an actor id to record) and `0073` (the admin write routes are in one
place, which is where the recording goes). Independent of `0074`.

## 1. What is recorded

One table in **catalog's** database, `catalog_audit`.

| Column      | Type        | Notes                                                    |
| ----------- | ----------- | -------------------------------------------------------- |
| `id`        | uuid        | From `BaseEntity`.                                       |
| `actorId`   | uuid        | An `admin_users.id`, or a service actor id. Section 3.   |
| `actorKind` | enum        | `ADMIN` or `SERVICE`. Without it an id is ambiguous.     |
| `entity`    | varchar     | `supermarket_items`, `items`, and so on. The table name. |
| `entityId`  | uuid        | The row.                                                 |
| `action`    | enum        | `CREATE`, `UPDATE`, `DELETE`.                            |
| `before`    | jsonb, null | Null on create.                                          |
| `after`     | jsonb, null | Null on delete.                                          |
| `at`        | timestamptz | Indexed, because every query is "recently" or "between". |

Indexed on `at`, and on `(entity, entityId)` so a row's own history is one lookup.

`before` and `after` hold the **changed fields only**, not the whole row. A full row snapshot on
every write of a table with 4,232 products grows without bound and buries the one field that
changed in thirty that did not. A diff answers the question actually being asked.

## 2. What is audited

Every write behind `/v1/admin/catalog/**`, which after `0073` is exactly the eighteen routes in its
section 3, plus the writes the harvester makes through `CatalogClient`.

Reads are not audited. A back office with one operator generates no interesting read trail, and
auditing reads on a 4,000 row catalog browsed through a paginated list writes far more rows than
the writes do.

The audit row is written **in the same transaction as the change**. A separate write can succeed
when the change fails, or fail when the change succeeds, and a trail that is sometimes wrong is
worse than none: it gets trusted.

## 3. The harvester is a service, and its runs are not yours

`0072` moves the harvester from borrowing an admin identity to holding a configured service actor
id. This is where that distinction pays.

The rule comes from `catalog-client.service.ts` and survives into this table verbatim:

> A run started by the owner still writes as the harvester, because the write is the harvester's:
> attributing it to the person who pressed the button would hide which changes a machine made.

So an operator who presses "start run" in the back office and thereby causes four thousand price
updates produces **one** row attributable to them (the run start, if that is audited at all in
`0074`'s harvest surface) and four thousand rows attributed to the harvester with
`actorKind = SERVICE`. Collapsing the two would make the trail claim a person typed four thousand
prices, which is both false and exactly the wrong answer to the question the trail exists to
answer.

## 4. Volume, and the thing that will go wrong

A full Mercadona catalog discovery run touches on the order of 4,000 products. If every one of them
writes an audit row on every run, the table grows by a catalog per run and dwarfs the catalog
itself.

Two mitigations, and the first is the important one:

- **A write that changes nothing writes no audit row.** The harvester re-fetches prices that mostly
  have not moved, so the great majority of its writes are no ops at the field level. Comparing
  before and after and skipping the identical case removes most of the volume, and it also removes
  most of the noise, since a price that did not change is not history.
- **Retention.** Service authored rows are prunable on a schedule; admin authored rows are not
  pruned, because they are few and they are the ones anybody will ever read. The pruning job is
  **not** in this plan, but the `actorKind` column is what makes it possible later without a
  migration, which is why it is a column and not something inferred from whether the id resolves.

## 5. No UI

Nothing reads this table in this plan, and that is deliberate rather than an unfinished edge.

The value being bought now is the recording, which cannot be backfilled. A history viewer can be
added at any point against data that already exists, and it belongs beside the dashboard that also
reads `0071`'s failed login attempts. Both are low priority and both are only worth building once
there is history to show.

`apps/luna-shopper-admin/plans/0005` shows `priceSourceKind` and `priceObservedAt` on the price
screens, which answers the immediate operational question ("is this number mine or the
harvester's") without reading this table at all.

## 6. Migrations

One migration in catalog: the table, the enum types, and the two indexes. Nothing to backfill, and
nothing on any existing table changes.

Prove it on a throwaway Postgres before the PR, through both the built `migrate.js` and the CLI
path.

## 7. Tests

- A create, an update and a delete through an admin route each write exactly one row with the right
  actor, kind, entity, id and diff.
- The diff holds only changed fields.
- A write that changes no field writes no row.
- A failed change writes no row, asserted by forcing a rollback.
- A harvester write is recorded with `actorKind = SERVICE` and the service actor id, including when
  the run was started by an admin.

## 8. Exit criteria

- Every admin catalog write is recorded transactionally with its actor and its diff.
- Harvester writes are attributed to the service, never to the operator who started the run.
- No admin route reads the table.

## 9. Out of scope

- Any viewer, and any dashboard.
- Retention and pruning.
- Auditing core or auth writes. The named actions in `0074` delegate to services whose own
  behaviour is unchanged, and auditing them is a separate decision about a different database.
