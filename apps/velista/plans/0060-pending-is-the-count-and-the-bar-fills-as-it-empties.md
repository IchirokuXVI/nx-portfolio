# 0060: pending is the count, and the bar fills as it empties

> Client only. No server change, no contract change, no new read: every number this plan uses is
> already on the wire and is already in the view models.
>
> Prerequisite reading: `0019` section 3 (the empty list rule these counts already obey) and
> backend `0047` section 2.3, which is where the meaning changed and the copy did not follow.

Three screens report a list's progress and all three report it backwards. A list where nothing has
been bought says **"12 of 12 ready"** with a full bar, and a list that has been completely shopped
says **"0 of 12 ready"** with an empty one.

This is not a wording preference. It is an inversion, and it has been shipped since the rename.

## 1. How it happened

The number is `wantedCount`, and the model says exactly what it is:

> How many of this list's lines the household currently wants: `quantity > 0`.

It used to be `readyCount`, counting lines somebody had ticked on some trip. Backend `0047` section
2.3 changed the subject, not the wording, and `readListCounts` in the mapper carries a long comment
about that rename. What nobody re pointed was the three call sites and the two translation keys,
which still say `ready` and still read the number as though it counted things that were done.

So the field means **pending** and every screen presents it as **finished**:

| The list                 | `wantedCount` | Drawn today      | The truth       |
| ------------------------ | ------------- | ---------------- | --------------- |
| 12 lines, nothing bought | 12            | "12 of 12 ready" | 12 still to buy |
| 12 lines, 5 bought       | 7             | "7 of 12 ready"  | 7 still to buy  |
| 12 lines, all bought     | 0             | "0 of 12 ready"  | nothing left    |

The middle row is why this survived: "7 of 12" looks plausible, moves when the list moves, and is
only obviously wrong at the two ends. The bar is the tell. It is full before the shop and empty
after it.

## 2. The answer to "is this the right change"

Yes, and the counting question and the wording question have different answers, so they are
answered separately.

**On the wording**: "ready" was never right for this field, and it is not rescuable by inverting the
arithmetic either. `lineCount - wantedCount` is not "ready", it is "lines nobody currently wants",
which includes a line somebody bought last week, a line the household stopped needing, and a line
somebody zeroed by mistake. Calling that "ready" claims a shopping trip happened. **Pending** is
the honest word: it is a property of the line right now, it needs no history to be true, and it
survives a line going back to five units next Tuesday.

**On the argument against it**: a line with 5 units left is arguably "ready to be shopped", which
is the reading that makes the current copy defensible. It is also the reading nobody has when they
glance at a card. Progress language on a list of chores means work done, not work available, and a
label that needs its own explanation to be read correctly is a label that will be read
incorrectly. Drop it.

**On the bar**: fill by what is finished, so it fills as the list empties and is full when nothing
is pending. That is what a progress bar means everywhere else in the world, and it is the shape
this screen was clearly reaching for.

One consequence worth accepting on purpose: an **empty list of zero lines** and a **fully shopped
list** both end with nothing pending. They are already distinguished, and stay so, because
`0019` section 3 draws "List is empty" and no bar at all at zero lines. Nothing in this plan
touches that branch.

## 3. What the copy becomes

Two keys, in `libs/velista/ui/assets/i18n/en.json` and `es.json`:

| Key                   | Today                          | Becomes                            |
| --------------------- | ------------------------------ | ---------------------------------- |
| `home.progress.ready` | `{{ready}} of {{total}} ready` | `{{pending}} of {{total}} pending` |
| `list.header.ready`   | `{{ready}} of {{total}} ready` | `{{pending}} of {{total}} pending` |

Rename the keys to `home.progress.pending` and `list.header.pending` in the same change. Leaving a
key called `ready` holding the word "pending" is how the next person reintroduces this bug, and the
key is referenced from exactly three templates.

Spanish: `{{pending}} de {{total}} pendientes`. The masculine plural `listos` goes with the word it
was translating and does not carry over.

### 3.1 Nothing pending is its own sentence

`0 of 12 pending` is arithmetically fine and reads badly on the one screen somebody wants to feel
good about. Add a key for the finished case, drawn when `wantedCount === 0` and `lineCount > 0`:

- `home.progress.done` / `list.header.done`: **"Nothing left"** (`Nada pendiente`).

This is a display branch and not a fourth number. The bar is full behind it either way.

## 4. What changes, and where

| Piece                                     | File                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| The sentence on a list row in a zone      | `libs/velista/ui/src/lib/zone/list-row.ts`                |
| The same sentence inside a zone card      | `libs/velista/ui/src/lib/home/zone-card.html`             |
| The sentence and the bar on the list page | `libs/velista/ui/src/lib/list/list-header.ts` and `.html` |
| Both keys, both locales                   | `libs/velista/ui/assets/i18n/{en,es}.json`                |

The interpolation argument is renamed from `ready` to `pending` at all three call sites, and the
value passed is still `wantedCount`. **No view model changes and no selector changes**: the number
was always the right number, and this plan does not go near `select-home-state.ts`,
`select-group-state.ts` or `select-list-state.ts`. Anything that recomputes a count here is a
second definition of the same fact and will drift from the server's.

### 4.1 The bar

In `list-header.ts`:

```ts
readonly percent = computed(() => {
  const { wantedCount, lineCount } = this.header();
  return lineCount === 0 ? 0 : Math.round(((lineCount - wantedCount) / lineCount) * 100);
});
```

The zero guard stays for the reason its comment already gives. `wantedCount` is clamped to
`lineCount` in `readListCounts`, so the subtraction cannot go negative and the bar cannot invert;
that clamp is now load bearing for this computation, and it is worth a line of comment on
`percent` saying so, because the mapper's own comment explains it as a display nicety.

The bar stays `aria-hidden`. The sentence beside it is still the accessible version and now says
something true.

## 5. Tests

- `list-header.spec.ts`: 12 lines with 12 wanted is 0 percent; 12 with 0 wanted is 100 percent; 12
  with 5 wanted is 58 percent. The first two are the regression guards and the failing assertion
  today would be either of them.
- `list-header.spec.ts`: zero lines draws the empty sentence and no bar, unchanged.
- `list-header.spec.ts`: zero wanted over a non empty list draws the "Nothing left" key rather than
  the pending sentence.
- `list-row.spec.ts` and `zone-card.spec.ts`: assert on the **key and its arguments**, never on
  rendered text. The testing translator does not interpolate, so an assertion on "7 of 12 pending"
  passes on nothing.
- A grep style guard is not worth adding here. The keys are renamed, so a missed call site is a
  missing translation at runtime and a failing spec at build, which is enough.

## 6. Out of scope

- **The basket's own counts.** The basket screen counts settled against quantity and has never had
  this problem, because `0043` made the quantity the state there. It is not touched.
- **A per unit bar.** Filling by units bought rather than by lines finished is a different and
  arguably better figure, and the server does not send it. `lineCount` and `wantedCount` are what
  the wire carries, this plan uses them correctly, and asking for a third count is a backend plan
  nobody has asked for yet.
