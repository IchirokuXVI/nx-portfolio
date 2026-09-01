# 0049: what the basket and its history do not yet say

> Nine things that plans `0044` and `0045` describe and the shipped screens do not draw. None
> of them is a defect: every one is a screen telling the truth about less than it knows, and a
> few are places where the screen holds the answer and declines to render it.
>
> They are collected into one plan because they are the same size and the same kind, and
> because several of them are the **same underlying question** asked on three screens: how much
> of what the server knows may this reader see, and how does the screen say "not that" without
> saying something false instead?

## 1. Two places where the data is present and the UI is not

### 1.1 The settlement history nobody draws

`0044` section 4.1 lists the settlement history among the things an owner or a passing
registered participant sees on a basket, and the basket draws per line attribution instead
("Marc got 2"). Attribution answers who; the history answers what happened in what order, which
is the question after a trip where two people bought against one line.

`GET /v1/lines/:id/settlements` exists from backend `0047`, but it is account authenticated and
zone scoped, so it is a different surface from the participant authenticated basket and was
skipped rather than wired. Wire it, for the readers who may use it: the owner, and a registered
participant while they hold `WRITE` on the source. A guest never sees it, unchanged from
`0044`.

The access rule is `0051`'s and is not relaxed here: privilege is **checked per request**, not
cached at join, so a participant who loses `WRITE` loses the history on their next read.

### 1.2 The missed origins that are counted and not named

When a settle cannot reach every origin, the server reports what it skipped, and for a
privileged reader that report carries `skipped[].listId`. The screen renders a count and never
a name, for every reader. `settle-sheet.ts:333` says so in a comment: the basket screen reaches
no zone list store, and the author did not want a template on this screen able to name a
household at all.

That instinct is right and the outcome is wrong. "2 lines could not be updated" is unactionable;
the person needs to know which list to go and look at. The resolution is not to give the basket
screen a zone list store, which would be a genuine coupling. It is that **the report carries
the names**, composed by the gateway for readers entitled to them, in the same way `0044`
already composes `sourceNames` for the basket's source lists. A guest's report keeps the count
and gains nothing.

## 2. The history says "finished" because it cannot say more

`0045` shipped the history copy as "N of M finished" rather than the mock's "3 of 4 got, 1 not
available", and that was the correct call at the time: `GeneratedListSummaryView` carries
`lineCount` and `settledLineCount` and nothing else, and `NOT_AVAILABLE` closes a line exactly
as a purchase does, so a summary that claimed a purchase would have been guessing.

Backend `0053` section 2 puts the breakdown on the summary. When it lands, the history rows say
what actually happened, and the mock's sentence becomes drawable.

**The copy does not change before the field exists.** "Finished" is the honest word for a
number that merges two outcomes, and a screen that says "got" for a shop that had none of it is
worse than a screen that is vague.

## 3. The generation sheet ignores the profile's stored scope

`0045` section 3.4 and section 4.1 ask the sheet to prefill from the profile's stored
generation scope. It prechecks every writable group whole instead.

The cause is a frontend decision rather than a backend absence, and it is worth stating because
it will recur. Backend `0049` stores `generationScope` and `generationSources` on the profile.
Velista `0046` deliberately kept both off the `ShoppingProfile` model, because `PATCH` treats a
present collection as a **full replacement**, so a model carrying a field no screen renders
would eventually send an empty one back and silently erase the user's stored scope. Keeping the
field off the model was the safe choice available at the time.

The fix is not to put the field on the model and be careful. It is to stop the model from being
able to make that mistake:

- The generation scope is read through its own call and held on its own, not merged into the
  profile the profiles page edits and saves.
- The profiles page's `PATCH` sends the collections it actually edits and no others, which is
  already what it does, and gains a spec that says so.

With the scope readable, the sheet prechecks from it. Where the profile stores no scope the
sheet falls back to prechecking everything, which is today's behaviour and is the right default
for somebody who has never narrowed it.

## 4. Three things the sheet and the card get wrong at the edges

- **"No sources" only detects belonging to no group.** `0045` section 3.4 wants somebody who
  holds `WRITE` nowhere to be told why the source list is empty. The sheet can only see "member
  of zero groups" without a `listLists` call per group on open, so somebody who is in groups but
  can write in none finds out one step further in, when a group expands to nothing. The sheet
  resolves writability as it expands, and when every expanded group is empty it says the same
  sentence it would have said up front, rather than leaving the person to infer it.
- **The sheet stops at one hundred lists per group.** `listLists` is cursor paginated and the
  sheet does not follow the cursor, so a group with more than a hundred writable lists silently
  shows the first hundred. Silently is the problem. It follows the cursor.
- **No presence on the card.** The mock draws "Ana and a guest are shopping now" and the
  listing carries no participants, so this would cost a request per card per dashboard load.
  With `0048` the basket has real presence, and the card can have it for the price of the field
  on the summary rather than a request. **Deferred to whenever backend `0053` touches the
  summary anyway**, and explicitly not worth a request of its own.

## 5. Two judgement calls, recorded rather than changed

Both were deliberate. They are written down because a later reader will otherwise find them and
read them as oversights.

- **The card does not render during the zone load.** `0045` section 3.1 asks for the card
  "alongside the zone skeletons, never after them", and `selectHomeState` keys its single
  `loading` state on the zone read, so the whole dashboard is skeleton until zones finish. Both
  reads start together, so this is ordering rather than a round trip. Fixing it means giving
  `HomeState`'s loading variant its own card slot, which reshapes the state union for a
  fractional second of dashboard. **Not changed here.** Revisit if the zone read gets slower.
- **The quiet refresh after a settle is app wide.** `GeneratedListStore` is app scoped, so a
  settle burst triggers one refetch whether or not the dashboard or the history is on screen.
  Bounded and cheap, and the alternative couples the store to route state. **Not changed here.**

## 6. Two small wrongnesses

- **The history's live region re announces on every count change**, including after a settle
  refresh, rather than once per page of results as `0045` section 7 asks. A screen reader user
  standing in a shop hears the total re read every time somebody else buys something. It
  announces per page.
- **`people-sheet.html` uses `basket.people.deviceUnknown` ("Not recorded") as the fallback for
  a missing join time.** A device oriented key doing double duty for a time. It gets its own
  key, in both locales.

## 7. What is tested

- The settlement history drawn for an owner, drawn for a registered participant holding
  `WRITE`, absent for a guest, and disappearing on the request after `WRITE` is lost.
- A skipped origin naming its list for a privileged reader and staying a bare count for a guest.
- The sheet prechecking from a stored generation scope, and prechecking everything when there
  is none.
- A profiles page `PATCH` that never sends a collection the page does not edit. This is the
  spec that makes section 3 safe, and it is the one worth writing first.
- The sheet following the cursor past one hundred lists.
- Somebody in groups but writable in none reading the sentence rather than an empty expansion.
- The history's live region announcing once per page.
- The profile chooser with more than one profile. `0045` covered only the absent with one case.

## 8. Acceptance criteria

- An owner and a `WRITE` holding participant read a line's settlement history from the basket;
  a guest cannot, and neither can a participant who has lost `WRITE`.
- A skipped origin names its list for a reader entitled to it and is a count for one who is not.
- The history says what was bought and what was unavailable once the summary carries it, and
  says "finished" until then.
- The generation sheet prefills from the profile's stored scope, and no profiles page save can
  erase that scope.
- A group with more than one hundred writable lists shows all of them.
- Somebody who can write nowhere is told why, wherever they find out.
- The history announces once per page, and the people sheet's missing join time has its own copy.

## 9. Out of scope

- **Prices, the "+X same price" display, and splitting a basket across shops.** Backlog `0004`
  and the optimizer, unchanged from `0044` section 9.
- **Archiving and deleting runs.** The API keeps them (backend `0050` section 7); still no
  screen offers them, still deliberately.
- **Per line guest visibility.** Backend `0051` section 11.
- **The card's loading slot and the store's refresh scope**, both recorded in section 5 as
  decisions rather than work.
