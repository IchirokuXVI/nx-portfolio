# 0021 A postal code and what came of it

velista tells a user "we have no supermarkets for that postal code yet" and nobody in this back
office can find out why. The code may have never been looked at, or looked at and failed, or looked
at and produced thirty places that nobody imported. Those are three different problems with three
different fixes and today they look identical.

**This plan is the screen that tells them apart.** A list of every postal code the system has been
asked about, what its last discovery did, and how many people are waiting on it. Plus a detail page
that answers the three questions a person asks once they have found the row.

Depends on `apps/luna-shopper-backend/plans/0097` for every call. Depends on `0004` for the
descriptor, on `0006` for the harvester section it joins, on `0020` for the bulk failure rules that
adding several codes reuses, and on `0016` for the dashboard it puts a card on.

## 1. Where it lives

The harvester section, beside runs, places, entries, shops and sources, at `harvest/postal-codes`.

It belongs there and not under catalog, even though the code itself is catalog reference data,
because every action on the screen starts a harvest run or reads what one produced. An operator
arrives at it from the same place they arrive at the runs list, with the same question: what has the
harvester done, and what does it still owe me.

## 2. The list

A descriptor (`0004`), not a hand written page. It needs a list, a search box, a create form, a
named action per row and a detail page, and that is exactly the shape a descriptor is.

**One filter: the search box.** The whole table is the working set, and hiding rows behind a status
picker before anybody has looked at them is how a queue gets forgotten. `kind: 'search'` on the
`postalCode` parameter, prefix matched, which is how a person narrows a numeric code. The status
filter that `0097` also offers is not declared here, because the list is short enough to read.

| Column      | Source                   | On a phone |
| ----------- | ------------------------ | ---------- |
| Postal code | the row                  | yes        |
| Name        | the row's `placeName`    | yes        |
| Status      | the row                  | yes        |
| Last looked | `discoveredAt`, relative | yes        |
| Found       | `locatedInIt.total`      | yes        |
| Accepted    | `locatedInIt.imported`   | yes        |
| Waiting     | core's usage counts      | no         |
| Attempts    | the row                  | no         |

**Found and accepted are the "located in it" pair, and the header says so.** `0097` section 2
produces two of each and the difference matters on the detail page, where there is room to explain
it. A table column cannot explain itself, so the list shows the number a person actually means: the
places a user in that code would be shown.

`format-instant.ts` already renders a relative time for the harvester screens, and "Last looked"
uses it. A row that has never been looked at shows nothing, not "never" and not a dash, because the
status column next to it already says `PARKED` or `QUEUED`.

### 2.1 Waiting is a decoration, and it may be absent

The waiting count comes from core, in one batched call per page of rows, the way
`AdminUserNamesService` puts usernames beside a page of zones. Two rules come with that, and both
are `0074` section 3's:

- **One call per page, never one per row.** The list gathers the codes it just loaded and asks once.
- **A failure blanks the column and nothing else.** The rows render, the numbers are absent, and the
  screen says the count could not be read. A decoration that can fail the listing is worse than no
  decoration.

It is not sortable. `0097` section 7 explains why the harvester cannot order by a number core owns,
and a column header that looks sortable and is not would be a worse lie than a plain column.

## 3. Adding codes

The create form takes three things: a country, defaulted to `es` and rarely touched, one or more
postal codes, and a checkbox.

**The codes field accepts several.** An operator adding a city adds twelve codes, not one, and a
form used twelve times is a form nobody uses. Codes separated by whitespace, commas or newlines,
deduplicated before anything is sent.

**The checkbox is "Discover places now", default on.** Off parks the code: the row exists, it is
listed, and no run is queued for it. It exists for the code an operator wants tracked without
spending a run today.

`0097` keeps one code per call, so twelve codes are twelve calls, and this screen already knows how
to do that honestly. It reuses `0020`'s rules without reusing its selection bar:

- Four at a time, with a progress line counting codes rather than time.
- **Each failure named with its own code and its own reason**, read through `gatewayErrorKey`. The
  common one is `postalCodeUnknown`, which means a typo, and an operator who is told "3 of 12
  failed" cannot fix a typo they cannot see.
- What succeeded stays succeeded. The form keeps only the codes that failed, so pressing again
  retries exactly those.

## 4. Discovering again

One named action on the row: **Discover again**.

- **Confirmed first**, naming the code, because it starts a run that fetches from a public service.
- **Unavailable while the row is `RUNNING`**, through `available(row)`.
- **The label and the confirmation both say queued, not running.** The queue drains one run at a
  time. A button that promises a run and delivers a place in line teaches an operator to press it
  twice.

The confirmation body says the second thing `0097` section 6.2 makes true: this ignores the thirty
day cooldown, which is the only reason to press it.

### 4.1 When nothing drains

`postalCodeDiscovery.summary` answers `draining`. When it is false, a banner sits above the list:
harvesting is off in this deployment, so codes queue and nothing runs. The action stays enabled,
because queueing is still the right thing to do and `0063` designed for exactly that backlog, but
nobody presses it wondering why the row never moves.

## 5. The detail page

A custom page, like `user-detail-page.ts`, not a generated read view. It reads from three services
and each answer lands in its own panel.

**The row itself.** Status, the code's name, when it was first asked about, when we last looked and
last attempted, attempts, the error if there is one, and the link to the run that produced it. Both
count pairs from `0097` section 2 are here, side by side, each with a sentence saying which is
which: the places its own runs found, wherever they turned out to be, and the places that sit in
this code, whichever run found them.

**Near codes.** The neighbours from catalog, nearest first, each with its distance and each a link
to its own detail page when it is in the queue. Two lines of context that the panel states rather
than assumes: the distance is centroid to centroid, and a code being absent from this list is not
proof it is far away. When catalog answers `known: false`, the panel says the code is not in the
shipped table at all, which is a different fact from having no neighbours.

**Places in this code.** The discovered places, through `0097` section 9's new filter, each showing
its status and whether its postal code was tagged or derived. A derived code is a guess and the
panel labels it as one. Above them, the number of shops catalog already holds in this code, which is
the number that decides whether velista shows the user anything at all. Two links out: the places
queue filtered to this code, and the catalog locations list.

**Who is waiting.** Main and near, profiles and users, from core. Main means the user typed the code
or their device resolved it. Near means we derived it onto them from a neighbour. Suppressed rows
are shown as their own number with a sentence: these users were offered the code and removed it.

Each panel loads on its own and fails on its own. A core outage empties the waiting panel and leaves
the other three, because the page is four questions and three of them still have answers.

## 6. The dashboard card

`0016` owns the screen the app opens to, and this adds one card to it: codes queued, codes failed,
and the age of the oldest queued row. One call, `postalCodeDiscovery.summary`, the same one the
banner reads.

It earns its place because it is the only number on that screen that represents users waiting for
something. A run that failed is our problem. A postal code queued for three weeks is somebody
opening velista and being told we have nothing for them.

## 7. Translations

One namespace, `harvest.postalCodes.*`, beside the other harvester screens. The two count pairs get
full sentences rather than abbreviations, because "found" alone is the ambiguity `0097` section 2
exists to remove.

## 8. Testing

- The list renders the columns of section 2 and offers exactly one filter.
- The waiting column asks core once for a page of rows, not once per row.
- A failed usage call leaves every row rendered and the column empty.
- The create form splits pasted codes on whitespace, commas and newlines, deduplicates them, and
  sends one call each.
- A partial add keeps only the failed codes in the field and names each reason.
- Discover again is unavailable on a `RUNNING` row and confirms before it runs.
- The banner shows when `draining` is false and hides when it is true.
- The detail page renders four panels, and a failure in one leaves the other three.
- A code catalog does not know renders the "not in the table" sentence rather than an empty
  neighbours list.

## 9. Exit criteria

- An operator can search a postal code and see, in one row, whether we looked, when, what we found
  and how many people are waiting.
- An operator can add a city's worth of codes in one form, and see which of them were refused and
  why.
- An operator can force a discovery inside the cooldown and is told the code is queued.
- The three reasons velista shows an empty screen are distinguishable from the list alone.
- The dashboard says how many codes are waiting and how long the oldest has waited.

## 10. Out of scope

- **A map.** Every coordinate needed for one is in the data after `0097`, and it is the obvious next
  thing, but it is a component decision that wants `0015`'s answer about where visual components
  live.
- **Bulk actions over selected rows.** `0020` gives the three queue screens that shape. This list's
  one action starts a run, and running twelve at once is a queue with twelve entries either way.
- **Editing a code.** There is nothing on the row an operator owns. Everything is either the code
  itself or the record of what happened to it.
