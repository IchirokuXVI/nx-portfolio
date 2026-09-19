# 0130: the basket becomes a view

> The record of a series, and it builds nothing. Backend plans `0131` to `0144` and velista
> plans `0090` to `0096` build what this file describes, and every one of them names this
> file as prerequisite reading. It exists so that the model, the names and the decisions are
> written once. A plan in the series that disagrees with this file is wrong, and the fix is
> to change this file first, in the same pull request, and say so.
>
> It came out of an audit on 2026-09-19 of a redesign the product owner had already decided:
> a permanent basket that covers every list a person can write, generated baskets that
> follow their lists instead of freezing them, links that last twelve hours, no removal
> from a basket, skip, and purchases that need no trip. The audit found that the design
> fights the stored basket line at every turn, and the product owner then asked the
> question that settles it: can the basket line go away completely. It can. This series is
> that answer.

## Brief for the agent

### Objective

Read this file before building any plan of the series. Build nothing from it directly.

### Context

Sections 1 to 9 are the target model. Section 10 is what is deleted and what is lost.
Section 11 lists the decisions that were taken on a recommendation and that the product
owner can still reverse. Section 12 is the build order. Section 13 is the traps every plan
of the series shares.

### Target state

Nothing changes in the repository because of this file alone.

### Scope

- Work only in: nothing. A change to the model is an edit to this file, made inside the
  pull request of the plan that needs it.
- Do NOT touch: code, on the strength of this file. The plan you were named is the job.

### Constraints

- The plan you were named is the whole job (`CLAUDE.md`, "Plan files"). This file explains
  the neighbours. It does not authorize building them.

### Action boundaries

- Stop and ask when the plan you were named cannot be built without contradicting a
  section of this file. Name the section.

### Progress evidence

None. This plan has no build.

## 1. What was wrong, in one page

A basket line is a copy. `generated_list_lines` copies the text and the quantity of the
zone lines it came from, `generated_list_line_origins` copies what each list contributed,
and the settle keeps the copy and the list in step by hand. Plan `0050` section 4 made that
copy on purpose, because a frozen basket was the product. The redesign makes the basket
follow its lists, and a copy that follows its source is a cache with no owner. Every
contradiction the audit found is that cache disagreeing with something:

- `list_lines.quantity` falls on every purchase (plan `0047`), so a stored "asked" cannot be
  synchronized with it. It can only be derived.
- A source change has to be written into every basket that copied the line, which is a
  fan out write per edit, and the merge of two lists' milk into one row has to be redone on
  every rename.
- A line with no list (plan `0093`), a quantity above what the lists asked (plan `0056`), a
  split (plan `0094`) and a private order are all states that exist only because the copy
  can hold something its source does not.
- The overlap rule (plan `0050` section 3) exists only because two frozen copies of one
  milk can both be bought. Two views of one line cannot disagree.

## 2. The model

**An open basket stores no lines.** It is a header, a rule that says which lists it covers,
and the people on it. Its rows are read from `list_lines`, and everything that happens to a
row is an event on a list line that names the basket it happened through.

### 2.1 Tables that stay, and how they change

| Table                          | Change                                                                                                                                                                                                                  | Plan   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `generated_lists`              | gains `kind` (`LIVE`, `GENERATED`). `status` becomes `OPEN`, `FINISHED`, `ARCHIVED`. Gains a nullable `pricingProfileId` (null on a `LIVE` basket, whose read resolves the owner's default profile each time). Loses `sourceSnapshot`. One `LIVE` row per owner, by a partial unique index. `defaultTargetListId` goes in `0136`, with the add that read it. | `0133`, `0136` |
| `generated_list_participants`  | gains `expiresAt`. A live participant is `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`.                                                                                                              | `0140` |
| `generated_list_share_links`   | `expiresAt` becomes required, twelve hours after `createdAt`.                                                                                                                                                           | `0140` |
| `list_lines`                   | gains `deletedAt` and `deletedByUserId`. A delete is a soft delete. A merge still removes the absorbed row.                                                                                                             | `0132` |
| `line_settlements`             | `generatedListLineId` is replaced by `basketId`. `lineId` and `listId` are required again. `pricePaidCents` keeps its name and is defined as the price of **one unit** (in catalog `unitPrice` already means a price per kilogram or litre, so that word is taken), beside new `pricePaidCurrency` and `priceScopeId`. An index on `settledByUserId`. `ix_settlements_participant` already exists.                   | `0134`, `0136`, `0143` |

The rename of these tables to `baskets`, `basket_participants` and `basket_share_links`
is plan `0144`, last, when three of today's six basket tables are already gone.

### 2.2 Tables that are new

| Table                   | Holds                                                                                                                                                                                  | Plan   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `basket_sources`        | `(basketId, zoneId, listId NULL)`, one row per source of a `GENERATED` basket, with foreign keys that cascade, because a source is a rule evaluated today and not history. A null `listId` means every list of the zone. A basket made from "all" gets one whole zone row per zone writable at creation. A `LIVE` basket has no rows. | `0133` |
| `basket_trip_rows`      | `(basketId, listId, lineId, asked)`, unique on `(basketId, lineId)`, `lineId` a cascading foreign key, `asked >= 0`. No `zoneId`: nothing reads a finished trip by zone. Written in the transaction that finishes or archives an open `GENERATED` basket, deleted when it is reopened. The frozen half of a trip. | `0135` |
| `basket_line_skips`     | `(basketId, lineId, skippedByParticipantId, skippedAt, revertedAt, revertedByParticipantId)`. Append only, like a settlement.                                                         | `0137` |
| `list_line_changes`     | one row per change of demand on a list line: kind, the text and quantity before and after, the approval before and after, the survivor of a merge, who did it and through which basket. | `0138` |
| `basket_change_cursors` | `(participantId, seenFrom, seenThrough, ackedAt)`: what one viewer has acknowledged.                                                                                                   | `0138` |

### 2.3 Tables that are deleted

`generated_list_lines`, `generated_list_line_origins`, `generated_list_line_options`, in
plan `0136`. Section 10 says what goes with them.

## 3. Vocabulary

Words the series uses with one meaning each. A plan that needs a new one adds it here.

| Word          | Meaning                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| basket        | a row of `generated_lists`. The code says `GeneratedList` until plan `0144`. New tables, columns, contracts, routes and files say `basket` from the day they are created.                                                |
| kind          | `LIVE` or `GENERATED`. A `LIVE` basket is created for its owner on first read, is never finished and has no name. A `GENERATED` basket is created on purpose, with a name, sources and people.                             |
| open          | `status = 'OPEN'`. **The word "live" no longer means this.** `isLiveGeneratedList` becomes `isOpenBasket` in plan `0133`, because "the live basket" now names a kind.                                                     |
| coverage      | the lists a basket reads, computed at request time and never stored. `LIVE`: every list its owner holds `WRITE` on. `GENERATED`: the owner's writable lists narrowed by `basket_sources`, which is `narrow()` of today. |
| covered line  | a line of a covered list that is not soft deleted, is `APPROVED` or `PENDING`, and either has `quantity > 0` or was bought through this basket in the current session (section 4).                                       |
| row           | what the screen draws: the covered lines that share one merge key (`mergeKey` in `line-dedup.ts`, unchanged), grouped at read time.                                                                                     |
| entry         | one covered line inside a row.                                                                                                                                                                                           |
| anchor        | the earliest entry of a row by `(createdAt, id)`. Its id is the row's key on the wire and in a sheet's URL.                                                                                                              |
| session       | a run of purchases with no silence longer than `PURCHASE_SESSION_GAP_MS`, six hours. **A gap of exactly that long continues the session.** One constant and one function, `continuesPurchaseSession()`, in contracts, replacing `LOOSE_TRIP_GAP_MS`, `PURCHASE_MERGE_MS` and velista's own copy of the twelve hours. What the run is partitioned by belongs to the reader: a list (trips), a basket (a `LIVE` basket's "bought"), an owner across their baskets (the walk order), a person across lists (history). |
| trip          | a finished or open `GENERATED` basket, or a session of purchases that belong to no `GENERATED` basket. The screen never says "loose".                                                                                    |
| skip          | a standing row of `basket_line_skips`. Marked for `BASKET_SKIP_WINDOW` (twelve hours), then an ordinary row carrying a note. It ends when it is taken back, or when the same basket settles the line afterwards with either outcome: **the newest act of a basket on a line decides**, so a skip after "the shop had none" reads `SKIPPED` and the reverse reads `NOT_AVAILABLE`. Derived on read, so the settle writes nothing to end it. |
| mark          | what a row says about a recent change, for one viewer: `ADDED`, `CHANGED`, `REMOVED`.                                                                                                                                    |
| named person  | a participant with `invitedAt` set and `expiresAt` null. Lasts until revoked.                                                                                                                                            |
| link visitor  | a participant who came by a link, guest or registered. `expiresAt` is twelve hours after their own join.                                                                                                                 |

## 4. Arithmetic

For an **open** basket nothing is stored and nothing can drift:

- `left` of an entry is `list_lines.quantity`.
- `bought` of an entry is the sum of `quantity` over the basket's standing `BOUGHT`
  settlements on that line (`basketId` matches, `revertedAt IS NULL`). For a `LIVE` basket
  the sum runs over the current session only, because the basket never ends.
- `asked` is `bought + left`. It is never written anywhere while the basket is open.
- A row is the sum of its entries.
- "A quantity below what is already bought" cannot be stated in this model, so
  `BelowSettledException` and the floors of plans `0104` and `0092` go.

For a **finished** `GENERATED` basket, `asked` is `basket_trip_rows.asked`, written by the
finish, and `bought` is the same sum. That is what keeps plan `0122` section 4 true: a
finished trip's numbers stop moving.

**States of a row**, in the order they are tested:

| State           | When                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `REMOVED`       | every entry left the coverage and the viewer still has a mark for it. Disabled, informative, counts toward nothing.                         |
| `SKIPPED`       | a standing skip younger than the window.                                                                                                   |
| `NOT_AVAILABLE` | the basket's newest standing settlement on the row says so, and it is younger than the window (`LIVE`) or the basket is `GENERATED`.        |
| `DONE`          | `left = 0` and `bought > 0`.                                                                                                                |
| `PARTLY`        | both above zero.                                                                                                                           |
| `WANTED`        | everything else. A skip older than the window leaves the row here with `note: 'SKIPPED_EARLIER'`.                                          |

**Counts.** `progress` is `{ done, unavailable, total }` over rows that are not `REMOVED`.
`pending` is `total - done - unavailable`, and a `SKIPPED` row is pending. The server
computes both, and `pending` means this count and nothing else: the row's flag for a line
that waits for the household's approval is `awaitingApproval`. An entry carries its own
`state`, its `approvalStatus` and `demandEditable`, which is the rule of section 5 answered
by the server because no reader knows the owner's permissions. A row carries `noteAt`
beside `note`. The client never recounts (velista `0060` section 4).

## 5. Who is allowed to do what

One rule per act, held in `ListAccessService`, asked by the list page and by the basket
alike (plan `0131`). On a basket the rule is asked of the **owner** for a settle, a revert,
a skip and a change of demand, which is plan `0051` section 6.4 unchanged: the owner
delegated shopping, not permission. It is asked of the **actor** for an add and a rename,
because a household's list names accounts.

| Act                                  | Permission on the list                     | Guest | Link visitor with an account | Named person |
| ------------------------------------ | ------------------------------------------ | ----- | ---------------------------- | ------------ |
| see a row                            | owner holds `WRITE` (coverage)             | yes   | yes                          | yes          |
| see which list a row belongs to      | the **reader** holds `WRITE` on that list  | never | per list                     | per list     |
| settle, revert                       | owner holds `WRITE` or `MANAGE`            | yes   | yes                          | yes          |
| skip, take a skip back               | owner holds `WRITE`                        | yes   | yes                          | yes          |
| change what a list asks for          | owner holds `DECIDE` or `MANAGE` when the line is `APPROVED`, else `WRITE` | single entry rows only | yes | yes |
| add a line, naming its list          | actor holds `WRITE`, and the list is covered | never | yes                        | yes          |
| rename a row                         | actor holds `WRITE` on every entry's list  | never | yes                          | yes          |
| remove a line                        | not a basket act. The list page, `MANAGE` on an approved line. | never | never | never |
| finish, reopen, share, add people    | owner only                                 | never | never                        | never        |

The invariant that survives everything: **a guest can never cause a write anywhere the
owner could not have written themselves.** Coverage is recomputed on every request, so a
list the owner lost is not in the basket, and there is no `ACCESS_GONE` skip left to
report.

## 6. Redaction

`seesZoneData`, the all or nothing test of plan `0051` section 5.2, is deleted. It asks for
`WRITE` on every source list, and on a `LIVE` basket that is every list of the owner, so
no named person ever passes. The rule becomes per list, which section 11 of that plan
already named as the target:

- A reader gets a `BasketListRef { listId, name, zoneId, zoneName }` for each covered list
  the **reader** holds `WRITE` on. The owner gets all of them.
- An entry carries its `listId` only when that ref was served. Otherwise the entry says
  how much and nothing about where.
- Shop `locations` are the owner's profile and not a fact about a list, so the per list
  rule cannot answer them. The owner and every named person are served them. A link
  visitor is served chains and scopes and never an address.
- A broadcast carries the least privileged view, always, because a room cannot be
  projected per socket. In this series a basket broadcast carries line ids and a kind and
  nothing else, and an entitled client reads again.

## 7. Realtime

- Realtime has no database and routes on the envelope alone. The envelope gains
  `basketIds: string[]` in plan `0139`, and keeps the single `generatedListId` beside it
  until plan `0144`, because the durable consumer replays envelopes written before a
  deploy. Core resolves the ids with `BasketCoverageService.coveringBaskets(listId)`, the
  reverse of coverage, which plan `0133` builds and plan `0139` is the first to call. It
  answers each basket with its owner.
- `basket.linesChanged { lineIds }` is born in plan `0136`, addressed to the acting
  basket's room and its owner's `user:` room. Plan `0139` widens it: every list line write
  emits what it emits today to the zone and list rooms, and one `basket.linesChanged` to
  every covering basket's room and every covering basket's owner, because the owner is
  usually at home looking at a card that counts what is left. A skip belongs to one basket
  and is never fanned out to the others.
- **Coverage moves without any line write**: a list created, deleted or re-permissioned, a
  member approved, kicked, banned or re-roled. Those emit `basket.linesChanged` with an
  empty `lineIds` to every open basket of the household, which means "read again".
- A rename, a finish and a reopen reach the basket room as well as the owner. Today a guest
  never hears a finish. A deletion stays its own event, because it is the one that drives
  the evict sweep.
- A participant whose `expiresAt` passed is ended by a core sweep with the reason
  `EXPIRED`, which emits the existing participant left event, which realtime already turns
  into an evict sweep. A refused request says `participant_expired`, so a client can tell
  "your twelve hours ended" from "you were removed".
- Presence exists on `GENERATED` baskets only. A `LIVE` basket has a room and no presence
  room.
- The claim ("X is buying this") is derived from the coverage of open `GENERATED` baskets
  inside the claim window. A `LIVE` basket claims nothing. Coverage needs an approved
  membership, so plan `0052` section 6's "claimed without a name" case cannot arise.

## 8. The surface

Routes born in this series say `/v1/baskets`. Today's `/v1/generated-lists` routes that
survive unchanged are moved by plan `0144`.

| Route                                           | Who                 | Plan   |
| ----------------------------------------------- | ------------------- | ------ |
| `GET /v1/baskets/live`                          | account             | `0136` |
| `GET /v1/baskets/:id`                           | participant         | `0136` |
| `POST /v1/baskets/:id/rows/:rowKey/settle`      | participant         | `0136` |
| `POST /v1/baskets/:id/rows/:rowKey/revert`      | participant         | `0136` |
| `POST /v1/baskets/:id/rows/:rowKey/demand`      | participant         | `0136` |
| `PATCH /v1/baskets/:id/rows/:rowKey`            | account participant | `0136` |
| `POST /v1/baskets/:id/lines`                    | account participant | `0136` |
| `PUT` and `DELETE /v1/baskets/:id/rows/:rowKey/skip` | participant    | `0137` |
| `GET /v1/baskets/:id/changes`                   | participant         | `0138` |
| `POST /v1/baskets/:id/changes/seen`             | participant         | `0138` |
| `GET /v1/purchases/sessions` and its rows       | account             | `0142` |

`GET /v1/baskets/live/summary` answers the three numbers the home card needs without the
rows. A read is capped at `BASKET_LIMITS.maxRows` (1000) with `truncated: true` and is not
paged, because a row spans lists. `GENERATED_LIST_LIMITS.maxLines` goes. Every write answers
`BasketRowResult { row, progress }`, so a tap never costs a second read.

Every write that moves a number carries `from`, the `left` the client was looking at, and is
refused with `stale_quantity` when the row moved. A skip carries none: "not today" means the
same whatever the number is, and the route refuses a row whose `left` is zero instead. A `BOUGHT` settle carries an explicit
`quantity`. Those two replace the double tap cap of today's settle.

## 9. History

- A finished `GENERATED` basket is a named trip, on the zone list and in a person's
  history.
- Every other purchase is grouped into sessions by the six hour gap, never by a calendar
  day, so no time zone enters core.
- A person's history is the purchases made through baskets they own, plus the purchases
  they made themselves anywhere else. It is a read of `line_settlements`, not of baskets.
- A settlement records the price of one unit, its currency and the price scope it was read
  at, when the screen had one (plan `0143`). The gateway reads the price, as the owner. A
  client never sends money. It can name the shop, which is checked against the scope and
  stored only for a reader who is served shops. An amount with no currency is no amount,
  and a total over two currencies is null.

## 10. What is deleted, and what is lost with it

| Deleted                                                                                   | Lost, and whether it can be rebuilt                                                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| waiting settlements (plan `0093`): the nullable pair, two check constraints, the service  | every row with a null `lineId`. Not recoverable: no list was ever named. The migration of `0093` already says so.        |
| `ADDED` lines with no target, `defaultTargetListId`, the guest composer (plan `0055`)     | the text of every such line on an open basket. Not recoverable.                                                         |
| a basket line's own `quantity` above its origins (plan `0056`, legacy rows)               | the extra units. Not recoverable, and plan `0104` already stopped writing them.                                         |
| split and siblings (plan `0094`)                                                          | the layout. The purchases stay, each naming its product.                                                                |
| the stored pick and the option rows                                                       | a pick chosen before buying. The options are the union of the entries' product sets. The pick is sent with the settle.  |
| `position` and the owner's reorder route                                                  | a hand made order. The order is computed (plan `0141`).                                                                 |
| the overlap rule and the `CLAIMED` refusal (plans `0050` section 3, `0092` section 3.2)   | nothing.                                                                                                                |
| `sourceSnapshot`                                                                          | two things. It stored the lists the run resolved and never the zones the request named, so a backfilled basket gets list rows and never follows a list added to its zone later. `profileId` leaves the wire with no replacement. |
| `seesZoneData`                                                                            | nothing. Section 6.                                                                                                     |
| `LIVE_GENERATED_LIST_STATUSES`                                                            | nothing. A set of one value is not a set. One SQL fragment, `OPEN_GENERATED_BASKET`, replaces it.                       |
| `BelowSettledException`, `GENERATED_LIST_LIMITS.maxLines`, the run's `skipped` report     | nothing. Only the origins service threw the first, and no screen ever drew the last.                                    |
| the origins of finished baskets                                                           | nothing. They become `basket_trip_rows`, summed per zone line.                                                          |

## 11. Decisions taken on a recommendation

The product owner decided the thirteen points of the redesign. These were open after the
audit and were closed by taking the audit's recommendation. Each is one line to reverse,
and reversing one is an edit here first.

1. **A settle needs `WRITE` on both surfaces**, and a change of demand on an approved line
   needs `DECIDE` or `MANAGE` on both. Today the list page asks `DECIDE` for a settle and
   the basket asks the owner's `WRITE` for everything (plan `0131`).
2. **A list line is soft deleted**, so a purchase outlives the line it was made on.
3. **Skip lives in its own table, per basket and per list line.** Not a third
   `SettlementOutcome`: a settlement is a household fact that a dozen reads consume, and a
   skip is one trip's intention that expires and that other people must not see.
4. **Split is dropped** on both surfaces.
5. **A `LIVE` basket's "bought" and its progress are scoped to the current session.**
6. **A link accepts joins for twelve hours, and a link visitor's access lasts twelve hours
   from their own join.** A registered visitor still gets a participant row, because every
   attribution in core is a participant. What "never binds to an account" means is that the
   row expires unless the owner adds the person by name. The contact rule of plan `0114`
   section 4 is waived for that promotion: the owner handed the person the link.
7. **An add needs the actor's own `WRITE`, inside the owner's coverage.** The "or where
   their own account can write" half of the redesign is dropped for creates, because it
   produces a line no basket shows and an author the zone cannot resolve.
8. **Status becomes `OPEN`, `FINISHED`, `ARCHIVED`.** `ACTIVE` was written by one client
   call and read by nothing.
9. **`generated list` is renamed `basket`**, last.
10. **The viewer of a change is a participant, not a device.** Two devices of one account
    share a cursor.
11. **A price is read by the gateway at settle time** and stored as the price of one unit,
    with its currency. A household sees what its milk cost, which plan `0143` states as a
    disclosure the product owner accepts or refuses.
12. **A purchase somebody else made is not a "change".** The banner counts changes of
    demand: a line added, asked for differently, renamed, merged, removed.
13. **The remembered shop stays one record per device** (velista `0076`), not one per
    basket. The shop is where the person is standing, and a shop a basket does not price is
    dropped from the view and kept in storage, so neither surface can damage the other's.
    Only the composer's target list is remembered per basket.
14. **The share sheet reads the link and mints one only on a press.** Today it mints on
    open, which on a permanent basket is an invitation nobody asked for every time the
    owner opens the sheet to add a person.

## 12. Build order

Backend, each needing every plan above it unless it says otherwise:

| Plan   | Title                                                       | Needs          |
| ------ | ----------------------------------------------------------- | -------------- |
| `0131` | one rule for who settles and who changes what a list asks   | nothing        |
| `0132` | a deleted line keeps its purchases                          | nothing        |
| `0133` | a basket has a kind, three statuses and sources in a table  | nothing        |
| `0134` | a purchase names its basket                                 | `0133`         |
| `0135` | what a trip asked, written down when it ends                | `0134`         |
| `0136` | the open basket is a view of its lists                      | `0131` to `0135` |
| `0137` | a line skipped for now                                      | `0136`         |
| `0138` | what changed on a list, kept and shown to each viewer       | `0132`, `0136` |
| `0139` | a list change reaches every basket that covers it           | `0136`         |
| `0140` | a link that lasts twelve hours                              | `0136`         |
| `0141` | the order a shopper walks, learned from sessions            | `0136`         |
| `0142` | what a person bought, with or without a basket              | `0134`, `0135` |
| `0143` | what was paid, recorded at the shelf                        | `0136`         |
| `0144` | a generated list is called a basket, everywhere             | all of them    |

Velista:

| Plan   | Title                                              | Needs                    |
| ------ | -------------------------------------------------- | ------------------------ |
| `0090` | the basket as rows of lists                        | backend `0136`           |
| `0091` | the basket that is always there                    | `0090`                   |
| `0092` | skip, the shop had none, and nothing is removed    | `0090`, backend `0137`   |
| `0093` | what changed while you were not looking            | `0090`, backend `0138`, `0139` |
| `0094` | a link for twelve hours                            | `0090`, backend `0140`   |
| `0095` | a history without baskets, and what it cost        | backend `0142`, `0143`   |
| `0096` | the shopping e2e follows the new basket            | every plan above         |

**`dev` is not releasable between backend `0136` and velista `0096`.** Backend `0136`
replaces the wire shape of a basket, and the shopping e2e (`apps/velista-luna-e2e`) runs
only on a push to `main`, so pull request checks stay green while the two halves disagree.
Nobody rolls `dev` into `main` inside that window. Backend `0136` keeps its own pull
request green by touching the velista files its contract change breaks at compile time
and nothing else, and it says which.

The per list redaction of section 6 is built by backend `0136`, because the new read
cannot be served without it. Backend `0140` is links and expiry alone.

Four plans reach outside their own half, and each names the files:

- `0131` changes the line detail sheet's settle gate and the memory gateway in velista.
- `0133` renames the statuses, which velista and the admin back office hold as their own
  strings. Neither imports contracts, so a missed one fails at run time as `UNKNOWN` and
  never at compile time.
- `0134` replaces velista's own copy of the twelve hour merge constant.
- `0136` rebuilds the admin back office's basket read, which joins the line tables it
  deletes. It touches no velista file: velista has no compile time import of contracts.

The composer is absent between velista `0090` and `0092`, and the walk order learns from
finished baskets alone between backend `0136` and `0141`. Both are inside the window in
which `dev` is not releasable.

`0131`, `0132` and `0133` are independent and can be built in parallel. `0136` is the one
plan that cannot be cut smaller without a state in which reads are derived and writes are
not, and it says how to stage itself inside one pull request.

## 13. Traps every plan of the series shares

- **`core/src/migrate.ts` runs every pending migration in one transaction**
  (`runMigrations({ transaction: 'all' })`). A value added to an enum cannot be used in
  that transaction, in the same file or in another one. Rebuild the type: create the new
  type, alter the column with a `USING` cast, drop the old type.
- **A `varchar` behind a check constraint is not a Postgres enum.** `endedReason` is one,
  and `list_line_changes.kind` is built as one for that reason: a new value is a dropped
  and recreated constraint, inside the one transaction, with no trap.
- **Three list line writes open no transaction today**: the plain edit, the member path of
  the approval, and the member delete (`line.service.ts`). A plain quantity edit also takes
  no row lock, so it overwrites a settle that races it. `0136` routes demand through the
  locked `addQuantity`, and `0138` makes all three transactional before it records a
  change.
- **Every event has a JSON Schema and a place in the AsyncAPI document** under
  `libs/luna-shopper/contracts/src/schemas/`. An event added or deleted moves there too.
- **Raw SQL quotes every camelCase column by hand** (memory note on TypeORM raw SQL), and a
  rule that is a `WHERE`, a `GROUP BY` or a window is proven only by an integration spec
  against a real database, run through its own target on a slot.
- **A cursor never carries a timestamp.** It carries an id and the boundary is looked up in
  SQL, because an ISO string loses the microseconds of a `timestamptz`.
- **An access read never runs inside a transaction.** Every repository of the access
  service draws its own connection, and one request holding two is how the pool deadlocks.
- **A gateway route, a DTO, an error code or a contract schema that changes** means
  `npx nx run luna-shopper-backend-gateway:openapi` and then
  `npx nx run luna-shopper-admin/models:wire-types`, both committed. Never edit either
  file by hand.
- **Every `@Query()` value lives on the DTO.**
- **A `type` import on a Nest constructor dependency erases its token.** Only booting the
  service catches it, so boot it on a slot before opening the pull request.
- **Nothing a velista service provides per app uses `@angular/core/rxjs-interop`.**
- **A slot is borrowed.** `--list` first, the least that does the job, and `--down` when
  finished (`CLAUDE.md`, "Serving from a worktree").
