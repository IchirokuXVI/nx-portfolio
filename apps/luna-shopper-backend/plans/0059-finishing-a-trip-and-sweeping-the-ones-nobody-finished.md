# 0059: finishing a trip, and sweeping the ones nobody finished

> Frontend half: `apps/velista/plans/0057`, which draws every rule this plan owns.
> Depends on `0050` for the basket and its statuses, on `0051` for participants and the
> guest surface, and on `0052` for the claim.
>
> A basket is a shopping trip. A trip ends, and today nothing in the system can say so:
> `COMPLETED` exists, `PATCH /v1/generated-lists/:id` accepts it, and no client has ever
> sent it. So every trip anybody has taken is still `ACTIVE`, and the household is still
> being told somebody is out buying the bread.
>
> This plan makes finishing a real act, makes a finished basket actually refuse writes,
> and closes the ones nobody got round to finishing.

## 1. The problem, stated precisely

Somebody shops with ten lines, settles four, and walks home. The six they did not settle
are unremarkable: the shop was out, they changed their mind, they forgot. Plan `0047`
section 3 already decided what happens to those, and the decision was **nothing**, on
purpose: skipping writes no row, because "I decided not to buy this today" must not look
like it was dealt with.

That decision is right and this plan does not touch it. What is wrong is the sentence the
household reads afterwards. Those six lines still say **"Ana is buying this"**, for a week,
because `LINE_CLAIMS_SQL` counts a basket as claiming while its status is live and its
`generatedAt` is inside the claim window.

Plan `0052` section 4.1 saw this coming and answered it with the window. The window is the
right backstop and the wrong primary mechanism:

- **It is invisible.** Nothing on any screen says a claim will expire, or when.
- **It is unactionable.** The person who knows the trip is over is standing there with the
  phone, and the system offers them no way to say so.
- **Seven days is a long time to be wrong** about a fact whose entire purpose is to stop two
  people buying the same milk this weekend.

So: a button for the person who knows, and a shorter window for the ones who do not press it.

### 1.1 What is already solved, and is not re-solved here

A line settled all the way through releases its origins the moment it is settled. That is
the fourth predicate in `LINE_CLAIMS_SQL`, `gll."settledQuantity" < gll."quantity"`, and it
does not wait for the trip to end.

**A basket whose lines are all settled therefore already claims nothing.** Automatic
completion buys exactly zero of section 1's problem, and this plan does not treat "every
line is settled" as a status transition at all. It is a fact the read already knows, the
frontend draws it as a prompt (`velista 0057` section 4), and a person presses the button.

## 2. Finishing

`GeneratedListStatus.COMPLETED`, through the route that already exists.

### 2.1 Owner only, which is already structurally true

`PATCH /v1/generated-lists/:id` sits behind `JwtAuthGuard` on `GeneratedListController`,
and `GeneratedListService.load` finds by `{ id, ownerUserId: userId }`, answering
`NO_SUCH_GENERATED_LIST` to anybody else. A guest holds a participant session and no
account token, so it cannot reach that controller at all, and a registered participant who
is not the owner is refused by the `where`.

**Nothing is added to enforce this**, and it is written down here so that the frontend's
"owner only" is understood as a description of the server rather than a policy the client
is being trusted with. The one thing that must not happen is a finish route appearing on
the participant surface in `generated-list-sharing.controller.ts`, which is the controller a
guest can reach.

### 2.2 What finishing does

`GeneratedListService.update` already does all of it and is unchanged:

- sets `status`, saves, emits `GeneratedListUpdated` to the owner
- on the live to not live transition, calls `claims.announceReleased(refsOf(id))`, so every
  zone room hears that its lines are no longer claimed
- on the way back, re-announces the claim, because a basket returned to `DRAFT` claims its
  lines again and a read after a reload would say so

That last one is what makes **unfinishing** free. There is no separate reopen route for a
basket and none is added: `PATCH` with `status: 'ACTIVE'` is the undo, it is the same write,
and it already emits the right event in the right direction.

## 3. A finished basket refuses every write

This is the real work, and the reason is that today it does not.

### 3.1 The gap

`GeneratedListFinishedException` is raised in **three** places. The basket's write surface
has **eight**. The refusal was added as each of plans `0055`, `0057` and `0058` needed it,
and the paths that predate them were never revisited.

| Write                        | Where                                                     | Guards today |
| ---------------------------- | --------------------------------------------------------- | ------------ |
| Settle a line                | `generated-list-settle.service.ts`, `settle`              | **no**       |
| Reopen a settled line        | `generated-list-reopen.service.ts`, `reopen`              | **no**       |
| Owner adds a line            | `generated-list-line.service.ts`, `addLine`               | **no**       |
| Owner edits a line           | `generated-list-line.service.ts`, `updateLine`            | **no**       |
| Owner deletes a line         | `generated-list-line.service.ts`, `deleteLine`            | **no**       |
| Swap the product pick        | `generated-list-basket.service.ts`, `setPick`             | **no**       |
| Participant adds a line      | `generated-list-basket.service.ts`, `addLine`             | yes          |
| Move what is outstanding     | `generated-list-outstanding.service.ts`, `setOutstanding` | yes          |
| Bind an added line to a list | `generated-list-bind.service.ts`, `bindLine`              | yes          |

Settling is the one that matters most and the one that is unguarded. A finished trip that
still accepts settlements can write into a household's zone lines days after the shopper
went home, and it can do so from a link the owner shared with somebody who is no longer
shopping.

### 3.2 The rule

**Every write that changes a basket or any of its lines is refused when
`isLiveGeneratedList(status)` is false**, with `GeneratedListFinishedException`, whoever is
asking. Owner included: the owner's remedy is to unfinish it, which is one write and is
already built, rather than a special case that lets the owner edit a finished trip and
leaves everybody looking at a screen that disagrees with itself.

The check is the three lines the guarded paths already use, loaded from the same row those
paths already load, so it costs no extra query anywhere:

```ts
if (!isLiveGeneratedList(list.status)) {
  throw new GeneratedListFinishedException(/* … */);
}
```

It is **not** extracted into a shared helper that takes a repository and re-reads the list.
Every one of these services already has the row in hand at the point the check belongs, and
a helper that re-read it would add a query per write to save three lines per service.

### 3.3 A spec that stops it happening again

`generated-list-finished.spec.ts`, one test per row of section 3.1's table: each write is
called against a `COMPLETED` basket and must raise `generated_list_finished`. This is the
guard against the next write path landing unprotected, which is exactly how the current gap
opened.

It asserts the **code**, not the message. The messages differ per path and section 4 of plan
`0054` is why the code is what a client branches on.

### 3.4 What a finished basket still does

Everything that is not a write. This is the half that must not regress, because a finished
trip is a receipt somebody will want to look at.

- **Reads.** The basket, its lines, their settlements, the history, the outstanding numbers.
- **Share links keep working.** A link is not revoked by finishing, the URL still opens, and
  the person who had it still sees the basket. `generated-list-sharing.controller.ts:684`
  already declines to accept **new** participants once the basket is `COMPLETED` or
  `ARCHIVED`, which is a different question from whether the people already in it may look.
- **Guests already in it stay in it.** Their participant session is still valid, they still
  resolve, they are still named on the rows they settled.
- **Presence and the socket.** They remain in the basket's room. Nothing evicts anybody: the
  people in a shop when the owner presses finish are the exact people who most need to see
  that it happened, and a disconnection would tell them nothing.

Finishing is not revoking, not archiving, and not deleting. The three already exist and are
three different acts.

## 4. The sweep

The backstop for a trip nobody finished.

### 4.1 What it does

Moves a `DRAFT` or `ACTIVE` basket whose `generatedAt` is older than the claim window to
`COMPLETED`.

**Every live basket past the window, not only the fully settled ones.** This is the point
that makes the sweep worth having: the basket in section 1 has six unsettled lines and is
precisely the one that needs closing. A sweep that only closed the tidy ones would close the
baskets that were already claiming nothing and leave the ones that were.

### 4.2 One number, not two

The cutoff is `generatedList.claimWindowMs`, the number `LINE_CLAIMS_SQL` already uses.

This is deliberate and it is the reason the sweep is shaped this way rather than as a
separate grace period. Past that window the claim had already expired, so the basket had
already stopped saying anything to the household. The sweep is not changing what anybody
sees at that moment. It is **writing down what the read already believed**, which is why it
cannot surprise anyone and why a second number here would be a way for the status and the
claim to disagree.

The invariant, worth stating because a future change could break it silently: **a live
basket never outlives its own claim.** After this plan, "the window expired" and "the trip
is over" are the same event.

### 4.3 Sixty hours

`GENERATED_LIST_CLAIM_WINDOW` drops from `7d` to `60h`.

Two and a half days, and the half is the whole point. Somebody generates a basket on Friday
evening and goes on Sunday afternoon, which is two days later at a different hour. A flat
`48h` would expire that trip somewhere on Sunday morning, before the shopping, and the
person walking into the shop would find their basket closed. Sixty hours covers the second
day whatever time of day the trip actually happens, and stops well short of a third.

Seven days was never argued for in plan `0052`; it was the placeholder for a retention
window plan `0050` section 7 left unbounded. It is too long for a fact about this weekend.

`parseDurationMs` takes `h`, so `60h` needs no parser change.

### 4.4 Shape

`GeneratedListSweepService`, mirroring `ZoneReaperService` in the same codebase rather than
inventing a second background style: `OnApplicationBootstrap` and `OnApplicationShutdown`, a
raw `setInterval` that is `unref`ed so it never holds the process open, a `running` flag so
two ticks cannot overlap, a batch limit, and a `sweep()` returning a count that the spec can
call directly with no timers involved.

- **It goes through `GeneratedListService.update`**, once per basket, rather than issuing a
  bulk `UPDATE`. The transition has to announce the released claims and emit
  `GeneratedListUpdated`, and section 2.2's logic is where that lives. A bulk update would
  be one query and a household that never hears about it.
- **The batch is a cap per tick, not per run.** Whatever is left is swept on the next tick.
- **It is disabled by config in the same way the zone reaper is**, and enabled by default.

### 4.5 What it must not do

- **Never touch `ARCHIVED`.** Archiving is a person hiding a basket, and it is already not
  live, so the sweep has nothing to add and would only rewrite somebody's deliberate choice.
- **Never delete anything.** Plan `0050` section 7 left retention unbounded and this plan
  does not decide it. The sweep changes a status.
- **Never write to a zone list.** It settles nothing. The unsettled lines stay unsettled and
  unrecorded, which is plan `0047` section 3's rule and section 1's premise.
- **Never emit a per line event.** The release is announced per zone room by
  `announceReleased`, which is already how a burst is handled (`0052` section 3.1).

## 5. Contracts, events, migrations

- **No new status.** `COMPLETED` is the one, and adding a fifth for "swept" would be a
  distinction with no reader. Nothing in the product asks whether a person or a timer closed
  a trip, and the honest answer to a future request for it is `generatedAt` beside the
  window.
- **No new error code.** `generated_list_finished` exists and section 3.2 is what it was
  written for.
- **No new event.** `GeneratedListUpdated` and `LineClaimChanged` both already fire on this
  transition, from `update`.
- **No migration.** Nothing gains a column. The claim stays derived, which is `0052` section
  4's main practical argument and stays true here.
- **No contract change**, therefore no OpenAPI diff from this plan's own surface. Regenerate
  and commit anyway before the PR, because `openapi-document.spec.ts` is the gate and a
  no-op regeneration costs nothing.

## 6. Config

| Var                             | Was  | Now    |
| ------------------------------- | ---- | ------ |
| `GENERATED_LIST_CLAIM_WINDOW`   | `7d` | `60h`  |
| `GENERATED_LIST_SWEEP_ENABLED`  | new  | `true` |
| `GENERATED_LIST_SWEEP_INTERVAL` | new  | `1h`   |
| `GENERATED_LIST_SWEEP_BATCH`    | new  | `100`  |

Joi defaults in `app-config.ts`, beside the reaper's. The doc comment on
`GENERATED_LIST_CLAIM_WINDOW` currently says it is the number the claim read uses; it gains
the second reader, and section 4.2's invariant, so the next person to change it knows they
are moving two things at once.

**`luna-slot.sh` writes these into a generated `.env`.** A new required var that the
generator does not know about kills a service at boot while the gateway stays up and
answers 500, so the three sweep vars go into the generator in the same change, and the tier
2 compose file states them separately.

## 7. Open decisions

- Whether the sweep should skip a basket with **live presence**, on the grounds that
  somebody is holding it open in a shop right now. Leaning no: at sixty hours nobody is
  mid trip, presence at that age is a phone that never disconnected, and the check would
  couple core to realtime state for a case that does not happen.
- Whether an owner should be told a trip was swept, by a notification or a mark on the
  history row. Leaning no for now, since the claim had already expired and nothing visible
  changed, but this is the decision most likely to be revisited once somebody reports being
  surprised.
- Whether `updateLine` and `deleteLine` should stay refused on a finished basket, or whether
  deleting a line from a finished trip is a tidying act rather than an edit. Leaning
  refused, per section 3.2's one rule, and unfinish is the remedy.

## 8. Exit criteria

- [ ] Every row of section 3.1's table raises `generated_list_finished` on a `COMPLETED`
      basket, and `generated-list-finished.spec.ts` covers all nine.
- [ ] Reads, share links, existing guests, presence and history are unaffected by finishing,
      with a spec per clause of section 3.4.
- [ ] `PATCH` to `ACTIVE` unfinishes a basket and re-announces its claims, and the same route
      is unreachable to a participant who is not the owner.
- [ ] `GeneratedListSweepService.sweep()` completes live baskets older than the window, skips
      `ARCHIVED`, respects the batch cap, and emits the release per zone room.
- [ ] The sweep writes through `update`, proven by a spec asserting the events rather than
      only the rows.
- [ ] `GENERATED_LIST_CLAIM_WINDOW` is `60h`, `line-claim.spec.ts` still passes, and the new
      config vars are in `app-config.ts`, `luna-slot.sh` and the tier 2 compose file.
- [ ] `npx nx run luna-shopper-backend-gateway:openapi` regenerated and committed.
