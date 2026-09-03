# 0062 A postal code brings its neighbours

A profile holds the codes its owner typed, and a person does not shop only in the code they sleep
in. The supermarket two streets away is in the next code along, and asking somebody to know that,
and to type it, is asking them to do geography to buy milk.

So: adding a postal code may also add the ones near it, marked as ours rather than theirs, visibly
and removably.

Depends on `0060` (the centroid table and `postalCodesWithin`) and `0049` (the profile and
`ProfilePostalCode`). Feeds `0063`, which discovers stores for any code we have never seen, and
`apps/velista/plans/0058`, which is the screen this is configured from.

## 1. Where a postal code came from

`ProfilePostalCode` gains three columns.

**`source`**, an enum, three values and not two:

| Value    | Meaning                                                          |
| -------- | ---------------------------------------------------------------- |
| `TYPED`  | The user typed it.                                               |
| `DEVICE` | Resolved from a location permission (`apps/velista/plans/0058`). |
| `NEARBY` | We derived it from a `TYPED` or `DEVICE` code within the radius. |

`TYPED` and `DEVICE` behave identically everywhere in this plan: both are the user's, both are
removable, both can seed an expansion. They are separate anyway because the distinction cannot be
backfilled later and costs nothing now. The moment it earns its keep is the first time somebody
wants to re resolve a stale device code, or to tell a user _why_ a code they do not remember
typing is on their profile.

**`expandNearby`** (boolean, default false), meaningful only on a `TYPED` or `DEVICE` row: whether
this code's neighbours were asked for. It lives on the parent rather than being a one shot
argument to the write, because section 3 needs to recompute the derived set from scratch and
therefore needs to know, later, which parents wanted expansion.

**`suppressed`** (boolean, default false), meaningful only on a `NEARBY` row: section 3.1.

`country` joins them, defaulting to `es`. The centroid table is keyed on `(country, postalCode)`
and a lookup without one searches Spain and Bolivia together.

## 2. What the user may do to each

- **Add** a `TYPED` code, optionally with `expandNearby`.
- **Remove** any code, including a `NEARBY` one.
- **Never add** a `NEARBY` code directly. It is not a thing the user says; it is a thing we
  concluded. Typing a code that happens to be in the derived set is an ordinary add, and section
  3.2 says what becomes of the derived row.

## 3. The derived set is recomputed, never maintained

The tempting implementation stores a parent pointer on each derived row and edits incrementally:
add a parent, insert its neighbours; remove a parent, delete them. It has three bugs, and they are
the kind that surface months later on one user's profile.

- **A shared child.** Two user codes 3 km apart both derive the same neighbour. Removing one
  parent deletes a row the other still justifies.
- **An orphan.** Remove a parent without cleaning up and the user keeps rows they cannot explain
  and, by section 2, cannot re add once removed.
- **A changed radius.** Section 4 says the radius is configuration. An incremental scheme has no
  moment at which it revisits rows written under the old value.

All three vanish if the derived set is a **pure function** of the profile's own state, recomputed
in full on every change to it:

```
derived(profile) = union over p in profile.codes where p.source != NEARBY and p.expandNearby
                     of postalCodesWithin(p.postalCode, p.country, radius)
                   minus { every TYPED or DEVICE code on the profile }
```

The recompute is idempotent, it is a local query over an immutable table with no network in it,
and it has no orphan case to reason about because it never reasons about parents at all. Run it
after any write to a profile's postal codes, in the same transaction.

### 3.1 Removing a derived code has to survive the recompute

A pure recompute and "the user may remove a `NEARBY` code" contradict each other directly: the next
recompute puts it straight back, and the user removes it again, forever.

So removal of a derived code is **not a delete**. The row stays, `suppressed` becomes true, and it
disappears from every read: the configuration screen, the scope resolver's input, and the store
screen's query. Suppression is user input, so it belongs in the function's domain rather than
being erased by it:

```
visible_derived(profile) = derived(profile) minus { suppressed codes }
```

A suppressed row that leaves `derived(profile)` entirely, because its last justifying parent went
away, is deleted by the recompute like any other derived row. Nothing accumulates.

Removing a `TYPED` or `DEVICE` code **is** a delete, and the recompute after it prunes whatever it
was justifying.

### 3.2 Typing a code that is already derived promotes it

`uq_profile_postal_code` is unique on `(profileId, postalCode)`, so this case cannot be
overlooked: the insert simply fails. The behaviour is **promotion**. The existing row's `source`
becomes `TYPED`, `suppressed` clears, and `expandNearby` takes whatever the request asked for.

That is also the escape hatch from section 3.1. A user who suppressed a neighbour and then wants
it back types it, and it returns as theirs rather than as ours, which is a more honest description
of what happened.

## 4. The radius

**2 km, as configuration, from the first commit.** Not a constant, and per country from the start
even though only one country exists, because the value that makes sense in central Madrid and the
one that makes sense in rural Córdoba are unlikely to be the same number.

Worth knowing before anyone tunes it: 2 km around a dense urban centroid may pull in several
codes, and 2 km around a rural one may pull in none, leaving that user with exactly the code they
typed and a screen that looks broken to them and correct to us. Once `0060`'s table is loaded, the
distribution is a twenty line script over real data rather than a guess, and it may argue for
"the nearest N codes, capped by distance" instead of a pure radius. That is a change to this
function's body and to nothing else, which is a further reason the derived set is recomputed.

## 5. Every new code asks whether we know it

A code arriving on any profile, `TYPED`, `DEVICE` or `NEARBY`, may be one catalog holds no
locations for. That is `0063`'s trigger, and this plan's only obligation to it is to announce the
codes it wrote, fire and forget, outside the transaction. A discovery run takes minutes and an
admin import takes longer; neither may hold up a profile save, and a failure to enqueue one must
not fail the write that caused it.

What the user is told meanwhile is `apps/velista/plans/0059` section on the empty state: we do not
have locations for that postal code yet. No notification system is built for this and none is
planned here.

## 6. Contracts and endpoints

`ProfilePostalCodeView` gains `source`, `expandNearby`, `country`. Suppressed rows are **absent**
from every view rather than present with a flag: no client has a reason to render one, and an
absent row cannot be shown by accident.

The add route takes `expandNearby`. The delete route needs no new argument; whether it suppresses
or deletes follows from the row's own `source`, which the server knows and the client should not
have to.

**Regenerate the OpenAPI document** in the same change, since request and response DTOs both move:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 7. Migrations

Core: `source` (backfilled `TYPED`, which is what every existing row is), `expandNearby` default
false, `suppressed` default false, `country` default `es`.

## 8. Exit criteria

- Adding a code with `expandNearby` writes the parent and its neighbours, and adding one without
  it writes only the parent.
- Two parents sharing a neighbour, then removing one parent, leaves the neighbour. There is a test
  named for this.
- Removing a derived code suppresses it, and a recompute triggered by an unrelated add does not
  resurrect it.
- A suppressed code whose last parent is removed is deleted, and the profile has no leftover rows.
- Typing a suppressed or derived code promotes it to `TYPED` and clears the suppression.
- Changing the configured radius and recomputing converges to the same set as a profile built from
  scratch at that radius.
- The recompute issues no network call and no NATS request beyond the single
  `postalCodesWithin` per expanding parent.
- `openapi.json` regenerated and committed; `npx nx run-many -t build test -p luna-shopper-backend-core,luna-shopper-backend-gateway` passes.
