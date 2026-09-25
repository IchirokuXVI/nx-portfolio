> **PR:** [#420](https://github.com/IchirokuXVI/nx-portfolio/pull/420)

# 0131: one rule for who settles and who changes what a list asks for

> First build plan of the series recorded in `0130`, and it needs no other plan. It is
> section 5 of `0130` applied to the code that exists today, before any basket table moves.
>
> Two surfaces write the same two numbers, and they ask different people for different
> permissions. The list page settles a line behind `DECIDE`
> (`core/src/app/lists/settlement.service.ts:119`). The basket settles the same line behind
> the owner's `WRITE` (`generated-list-settle.service.ts:145`). The list page refuses a
> `WRITE` holder who changes the quantity of an `APPROVED` line
> (`line.service.ts:2244-2248`). The basket lets the same person do it through
> `setOriginQuantity`, which asks for `WRITE` alone and says so in a comment
> (`generated-list-origins.service.ts:526`, `:570-573`). Whichever rule is the right one, a
> household cannot hold both, and the basket that is always there (`0136`) makes the looser
> one the default screen.
>
> The same audit found one hole with no second opinion about it. Taking a purchase back
> writes units onto a zone line and never asks whether the basket's owner can still write
> that list (`generated-list-reopen.service.ts:373-399`). A guest can therefore write a
> list the owner lost, which is the one thing plan `0051` section 6.4 says cannot happen.
>
> Prerequisite reading: `0130` sections 5 and 11 (decision 1), plan `0036` (the permission
> set), plan `0047` section 4 (the settle), plan `0051` section 6.4 (delegation), plan `0076`
> sections 2 to 4 (who moves an approved quantity), plan `0104` section 3 (the revert walk),
> `core/src/app/lists/list-access.service.ts` and
> `core/src/app/generated-lists/generated-list-reopen.service.ts` in full.

## Brief for the agent

### Objective

Make one function per act decide who is allowed to settle a line and who is allowed to
change what a list asks for, have the list page and the basket both call it, close the
revert's missing access check, and throttle the participant writes that are not throttled.

### Context

- `ListPermission` is a set of four: `READ`, `WRITE`, `DECIDE`, `MANAGE`
  (`libs/luna-shopper/contracts/src/lib/enums/list.enums.ts:23`). `WRITE` and `DECIDE` are
  independent. A zone `OWNER` or `ADMIN` holds all four by derivation
  (`list-access.service.ts:142`).
- `ListAccessService` (`core/src/app/lists/list-access.service.ts`) has `resolve` (`:158`),
  `requireRead` (`:194`), `requireWrite` (`:199`), `requireDecide` (`:213`), `requireManage`
  (`:219`) and `requireAccess` (`:236`). It answers about **one** list and **one** account.
- `GeneratedListSharingService.writableAmong(userId, listIds)`
  (`generated-list-sharing.service.ts:756`) answers `WRITE` alone, for many lists, through
  `WRITABLE_AMONG_SQL` (`generated-list-sharing.sql.ts:41`). Nothing answers "which of the
  four does this person hold on each of these lists" in one read.
- `SettlementService.settle` calls `requireDecide` (`settlement.service.ts:119`), and its
  comment (`:85-88`) says why: "this is what `setStatus` was".
- `LineService.authorizeEdit` (`line.service.ts:2215`) and `reopenAfterEdit` (`:2088`) are
  plan `0076`. An approved line's quantity moves for `DECIDE` or `MANAGE` and for nobody
  else. `addQuantity` (`:1985`) goes through the same two.
- `GeneratedListOriginsService.setOriginQuantity` (`:477`) calls `requireWritable`
  (`:1011`), which asks `WRITE` of the owner and then of the actor. `createOrigin` (`:887`)
  calls the same check at `:903` and then creates the zone line through
  `GeneratedListLineService.promote`, which is `LineService.add` with the actor's account.
- `GeneratedListReopenService.revertUnits` (`:191`) is called by `reopen` (`:107`), by
  `GeneratedListOutstandingService.revert` (`generated-list-outstanding.service.ts:209`)
  and by `GeneratedListOriginSettledService.revert`
  (`generated-list-origin-settled.service.ts:224`). Its only skip today is an origin line
  that no longer exists (`:383`), and `RevertSkip` (`:633`) carries no reason, so
  `origin-settled` names every skip `ORIGIN_DELETED` (`:232`).
- The participant controller throttles four routes of eleven
  (`gateway/src/app/generated-lists/generated-list-sharing.controller.ts:801`, `:849`,
  `:903`, `:1416`). `PARTICIPANT_THROTTLE_LIMITS.write` is 60 a minute
  (`participant-throttler.guard.ts:43`), and its own comment already says the settle route
  needs it.
- The client follows the server's rule by hand. `LineDetailSheet._canSettle` is
  `canDecide` (`libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts:275`)
  and the memory gateway's `settle` requires `'DECIDE'`
  (`libs/velista/data-access/src/lib/lines/line-memory.ts:390`).

### Target state

Every acceptance criterion in section 10 holds. `npx nx run-many -t lint test` is green for
core, gateway, contracts, the admin models and the three velista projects named in scope,
with `openapi.json` and the wire types regenerated.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/core/src/app/lists/` (`list-access.service.ts`, a new
    `list-acts.ts`, a new `list-permissions.sql.ts`, `settlement.service.ts`,
    `line.service.ts` for the one call named in section 3, and their specs)
  - `apps/luna-shopper-backend/core/src/app/generated-lists/`
    (`generated-list-origins.service.ts`, `generated-list-reopen.service.ts`,
    `generated-list-origin-settled.service.ts`, `generated-list-outstanding.service.ts`,
    `generated-list-sharing.service.ts` for the one method named in section 2, and specs)
  - `libs/luna-shopper/contracts` (the comment on `ListPermission`, the skip reason on the
    reopen result, `demandChangeable` on the origin detail, and their schemas)
  - `apps/luna-shopper-backend/gateway/src/app/generated-lists/generated-list-sharing.controller.ts`
    (throttles and two comments) and `gateway/src/app/lists/list.controller.ts` (one
    description)
  - `libs/velista/feature-lists`, `libs/velista/data-access`, `libs/velista/models` for the
    client change in section 7, and nothing else in velista
  - the generated `openapi.json` and `wire-types.ts`
- Do NOT touch: any migration (this plan has none), `LineService.authorizeEdit` and
  `reopenAfterEdit` (plan `0076` stays exactly as it is), the approval routes, the
  allocation rule of the settle, `seesZoneData` (`0136` deletes it), the basket tables
  (`0133` and `0136`), the settle's `ACCESS_GONE` skip (it is already right).

### Constraints

- An access read never runs inside a transaction (`0130` section 13). Every new check in
  this plan is resolved before its transaction opens, and the row state it branches on, the
  line's approval, is read again under the lock.
- The rule is a pure function with no database in it, so a spec states the rule instead of
  mocking its way to it. The service method is that function plus a read.
- A refusal reaches a person. Every new refusal is a `ForbiddenException` with a sentence a
  shopper can act on, and a skip is reported, never thrown.
- Only make changes directly requested. No new permission, no new error code.

### Action boundaries

- Proceed with in scope edits, specs and the two generators.
- Stop and ask if any caller of `requireDecide` other than the settle and the approval turns
  out to mean "is allowed to settle", or if closing the revert hole needs a schema change.

### Progress evidence

Report after the rule and its specs (section 2), after the three call sites with their
specs (sections 3 to 5), and after the throttles and the client change, each with the spec
run that proves it.

## 1. What is being built

| Piece                                                    | Where                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `canSettle`, `canChangeDemand`, pure                      | new `core/src/app/lists/list-acts.ts`                        |
| `requireSettle`, `permissionsAmong`                       | `list-access.service.ts`, new `list-permissions.sql.ts`      |
| the list page settle asks `WRITE`                         | `settlement.service.ts`                                      |
| a change of demand asks `DECIDE` or `MANAGE` on a basket  | `generated-list-origins.service.ts`                          |
| `demandChangeable` on an origin row                       | contracts, `generated-list-origins.service.ts`, the schema   |
| the revert asks the owner's `WRITE`, and reports a skip   | `generated-list-reopen.service.ts` and its two callers       |
| throttles on seven participant writes                     | `generated-list-sharing.controller.ts`                       |
| the client's settle follows `WRITE`                       | `libs/velista` (section 7)                                   |

## 2. The rule, stated once

New file `core/src/app/lists/list-acts.ts`. Two free functions, exported, with no imports
beyond the two enums:

```ts
/** Whether a holder of these permissions can record a purchase or a shop that had none. */
export function canSettle(permissions: ReadonlySet<ListPermission>): boolean {
  return permissions.has(ListPermission.WRITE) || permissions.has(ListPermission.MANAGE);
}

/**
 * Whether a holder of these permissions can change how many of a line the list asks for.
 * An approved quantity is what the group agreed to (plan 0076, section 4.1).
 */
export function canChangeDemand(
  permissions: ReadonlySet<ListPermission>,
  approvalStatus: LineApprovalStatus
): boolean {
  if (permissions.has(ListPermission.MANAGE)) return true;
  if (approvalStatus === LineApprovalStatus.APPROVED) {
    return permissions.has(ListPermission.DECIDE);
  }
  return permissions.has(ListPermission.WRITE);
}
```

`canChangeDemand` is `authorizeEdit` reduced to a request that names the quantity and
nothing else (`line.service.ts:2220-2248`). It is written out a second time on purpose, as
the readable statement of plan `0076` section 4.1, and **section 3 makes `authorizeEdit`
call it** for that branch so the two cannot drift.

`ListAccessService` gains two methods:

```ts
/** Requires the right to settle: see `canSettle`. */
async requireSettle(listId: string, userId: string): Promise<ShoppingList>;

/**
 * The permissions one account holds on each of these lists, at request time.
 * A list the account has no approved membership for is absent from the map.
 */
async permissionsAmong(
  userId: string,
  listIds: readonly string[]
): Promise<Map<string, Set<ListPermission>>>;
```

`requireSettle` is `resolve` plus `canSettle`, refusing with
`'You need write access to this list'` (the `WRITE` entry of `REFUSALS`, `:259`).

`permissionsAmong` is one query, `LIST_PERMISSIONS_AMONG_SQL`, in a new
`core/src/app/lists/list-permissions.sql.ts`. `$1` is the account, `$2` the list ids:

```sql
SELECT sl.id AS "listId",
       CASE
         WHEN m.role IN ('OWNER', 'ADMIN')
           THEN ARRAY['READ', 'WRITE', 'DECIDE', 'MANAGE']
         ELSE COALESCE(la."permissions"::text[], ARRAY[]::text[])
       END AS "permissions"
FROM "shopping_lists" sl
JOIN "zone_memberships" m
  ON m."zoneId" = sl."zoneId" AND m."userId" = $1 AND m.status = 'APPROVED'
LEFT JOIN "list_access" la
  ON la."listId" = sl.id AND la."membershipId" = m.id
WHERE sl.id = ANY($2::uuid[])
```

It is the many list twin of `permissionsForMembership` (`:138`) and it must agree with it:
the integration spec in section 9 proves the two answer the same set for a staff member, a
row holder and a stranger. The staff array is written from `ALL_LIST_PERMISSIONS` by the
service when it builds the map, so the SQL literal above is the only second copy of that
list, and the spec pins it.

`GeneratedListSharingService.writableAmong` (`generated-list-sharing.service.ts:756`) stays,
because the settle, the redaction and the pickers all read it. It gains one sibling that
delegates here and adds nothing:

```ts
/** The owner's standing on these lists, all four permissions, at request time. */
permissionsAmong(userId: string, listIds: readonly string[]) {
  return this.listAccess.permissionsAmong(userId, listIds);
}
```

Only if `GeneratedListSharingService` already injects `ListAccessService`. If it does not,
the two basket services below inject `ListAccessService` themselves and this sibling is
not written.

## 3. The list page settle asks `WRITE`

`SettlementService.settle` (`settlement.service.ts:114`): line `:119` becomes
`this.listAccess.requireSettle(found.listId, req.userId)`. The block comment at `:73-88` is
rewritten to say what is true now, and it names this plan.

**This reverses plan `0036` section 1.2 for the settle and for nothing else.** That section,
restated in the comment being replaced: "`DECIDE` and not `WRITE`, because this is what
`setStatus` was: the flatmate who walks the aisle and says what went in the trolley is
exactly the person plan 0036 separated that permission out for". The reasoning held while
the list page was the only place a purchase was recorded. Plan `0051` section 2 then let
anybody holding `WRITE` take a line into a basket, on the ground that "a basket settles the
lines it drew from, and settling is a write" (`generated-list.sql.ts:22-28`), so a `WRITE`
holder already records purchases on every list they can write, from the other screen. What
`DECIDE` still protects is the thing it was named for: approving, rejecting, and moving a
number the group agreed to. `setApproval` (`line.service.ts:2264`) keeps `requireDecide`.

What a settle does to the line is unchanged. It decrements, it never reopens an approval
and it never splits (`settlement.service.ts:97-102`), so a `WRITE` holder who settles an
approved line does not put it back to `PENDING`.

`LineService.authorizeEdit` (`:2215`) changes in one place. The final test at `:2244`,
`approved && req.quantity !== undefined && !decides`, becomes
`req.quantity !== undefined && !canChangeDemand(permissions, line.approvalStatus)`. The
behaviour is identical: `MANAGE` returned at `:2220`, an unapproved line needs the `WRITE`
already checked at `:2241`, and an approved one needs `DECIDE`. The refusal sentence stays
word for word. The existing `line-operator-edits.spec.ts` and the plan `0076` specs must
pass untouched, which is the proof.

The comment on `ListPermission.DECIDE` (`list.enums.ts:28`) loses "settle a line", and the
one on `WRITE` (`:26`) gains it. `REFUSALS` does not change.

## 4. A change of demand on a basket asks `DECIDE` or `MANAGE`, of the owner

`GeneratedListOriginsService.requireWritable` (`:1011`) is replaced by
`requireDemandChange(list, actorUserId, listId, approvalStatus)`:

1. Read `permissionsAmong(list.ownerUserId, [listId])`. When the owner's set does not hold
   `WRITE`, refuse with today's sentence, `'The basket’s owner can no longer write that
   list'`. That is coverage and it is unchanged.
2. When `!canChangeDemand(ownerSet, approvalStatus)`, refuse with
   `'The owner of this shopping list cannot change that quantity. Somebody who can approve
   lines has to'`.
3. When the actor is not the owner, read the actor's set the same way. No `WRITE`: today's
   `'You need write access to that list'`. Not `canChangeDemand`: the sentence of
   `line.service.ts:2245`, word for word, because it is the same refusal.

**The owner is asked because the owner is who delegated** (plan `0051` section 6.4, and
`0130` section 5). **The actor is asked wherever they are asked today**, which is this
method: an account holder does not gain, through somebody else's basket, a right they do
not hold on the list page.

Where it is called:

- `setOriginQuantity` at `:526`. The approval comes from `source.approvalStatus`, the row
  read at `:520`. It is a read outside the lock, so `write` (`:664`) re-reads the line under
  `pessimistic_write` at `:680` and **re-tests `canChangeDemand` on the locked row** with the
  two sets resolved outside, exactly as `addQuantity` does it (`line.service.ts:2013-2017`).
  The sets are passed into `write` as an argument. They are not read inside it.
- **Only when the zone line moves.** An adoption that takes over demand the list already
  has (`move.delta` applied as `max(0, quantity - listQuantity)`, `:700` onward) and lands
  on zero writes no demand, so it needs `WRITE` alone, as today. The test is made where
  `zoneMoved` is decided, under the lock.
- `createOrigin` at `:903` keeps `WRITE` and nothing more. It creates a line through
  `LineService.add`, and the add's own rules decide whether the line starts `PENDING` and
  whether a merge onto an approved line is allowed (plans `0037` and `0091`). Repeating them
  here is a second definition.

The comment at `:570-573` ("it re triggers no approval") stays true and gains a sentence:
the write is refused to anybody the list page refuses, which is why no approval has to be
re-asked.

**The row says whether it can be moved.** `GeneratedListLineOriginDetail`
(`generated-list-sharing.messages.ts:1403`) gains, beside `writable` (`:1433`):

```ts
/**
 * Whether this reader, through this basket, can change how many this list asks for:
 * the owner's standing and the reader's own, by `canChangeDemand`, on the line as it
 * is approved now. False on a row that is not `writable`.
 */
demandChangeable: boolean;
```

`lineOrigins` (`:156` onward) already reads the owner's writable set at `:174`. It reads
`permissionsAmong` for the owner and for the actor instead, once each for the whole sheet,
and fills both flags from them. The JSON schema in
`libs/luna-shopper/contracts/src/schemas/messages/generated-list-sharing.schemas.ts` gains
the required boolean. The client half is velista `0092`. This plan changes no velista
basket file, and the new field is ignored by today's mapper
(`libs/velista/data-access/src/lib/mapping/basket-mappers.ts:281` reads named keys).

## 5. Taking a purchase back asks the owner's `WRITE`

`GeneratedListReopenService.revertUnits` (`:191`):

1. **Before the transaction opens**, read the standing settlements of the basket line the
   way `:239` does, without a lock, collect their distinct non null `listId`s, and read
   `writableAmong(list.ownerUserId, thoseListIds)`. One query, outside the transaction.
2. Inside the walk, a standing row whose `listId` is not in that set is **skipped whole**:
   it is not marked reverted, no units go back, `taken` and `need` do not move, and one
   `RevertSkip` is recorded per zone line with `reason: 'ACCESS_GONE'`. The walk goes on to
   the next row, so a line with one reachable origin and one unreachable one gives back
   what it can.
3. A waiting row (`lineId` null, `:282`) is reverted as today. It writes no list.
4. A `NOT_AVAILABLE` close is one act written as a row per origin (`:310-323`). It goes
   back only when **every** row of the act sits on a writable list. Otherwise the whole act
   is skipped, because half a close taken back is a state no settle can produce.
5. The basket line's `settledQuantity` falls by what was taken and no more. The
   "consumed everything lands on zero" shortcut (`:428` onward) applies only when nothing
   was skipped.

`RevertSkip` (`:633`) gains `reason: 'ACCESS_GONE' | 'ORIGIN_DELETED'`, and the deleted
line skip at `:383` sets `'ORIGIN_DELETED'`. `GeneratedListOriginSettledService.revert`
(`:224`) stops hard coding the reason at `:232` and passes each skip's own.
`GeneratedListOutstandingService.revert` (`:209`) reports `skippedCount` as today.

**A per origin revert on a list the owner lost is refused, not skipped.**
`GeneratedListOriginSettledService` already asks `writableAmong` before a raise (`:183`).
It asks the same question before a lowering and answers the same named `ACCESS_GONE` skip
with nothing written, so both directions of that control agree.

The contract: `GeneratedListReopenResult` and `GeneratedListSettleResult` already carry
`skippedCount` and, for an entitled reader, `skipped: GeneratedListSettleSkip[]` whose
`reason` is already the two value union (`generated-list-sharing.messages.ts:784`). Nothing
is added to the wire. `reopen` (`:107`) fills `skipped` for a reader who passes
`seesZoneData`, the way the settle does at `:455-470`, if it does not already.

The gateway comment at `generated-list-sharing.controller.ts` above the `outstanding` route
(`:1149`), which says the owner's standing authorizes both directions, becomes true and
keeps its wording.

## 6. Throttles

`@ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)` and
`@UseGuards(ParticipantThrottlerGuard)` are added to the seven participant writes that lack
them, in the order the decorators are written at `:801-802`:

| Route                                  | Line    |
| -------------------------------------- | ------- |
| `POST :id/lines/:lineId/products`      | `:1043` |
| `POST :id/lines/:lineId/settle`        | `:1082` |
| `POST :id/lines/:lineId/outstanding`   | `:1149` |
| `POST :id/lines/:lineId/reopen`        | `:1193` |
| `POST :id/lines/:lineId/origins`       | `:1280` |
| `POST :id/lines/:lineId/origins/settled` | `:1334` |
| `POST :id/participant-token`           | `:1447` |

One bucket, the existing `write` limit of 60 a minute per participant. The reads stay
unthrottled. `participant-throttler.guard.spec.ts` gains a case that lists the controller's
`POST`, `PATCH` and `DELETE` handlers by reflection and fails when one has no
`PARTICIPANT_THROTTLE` metadata, so a route added by `0136` cannot forget it.

## 7. The client

The server's rule for the list page settle moved, and the client states that rule in two
places. Both change, and nothing else in velista does:

| File                                                                          | Change                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts:274-275` | `_canSettle` follows `canWrite \|\| canManage`. The comment says `WRITE` and names this plan.         |
| `libs/velista/feature-lists/src/lib/line-detail-sheet/select-line-detail.ts:68` and `libs/velista/models/src/lib/line-detail-view.ts:280-284` | the doc comments say `WRITE`.                     |
| `libs/velista/data-access/src/lib/lines/line-memory.ts:373`, `:390`           | `settle` requires `'WRITE'` (or `'MANAGE'`), so the fixture refuses who the server refuses.                |
| `libs/velista/models/src/lib/list-view.ts:229`                                | the comment on `canDecide` loses "Tick off, mark unavailable".                                             |

**The reel does not change.** `LineRowVm.adjustable` follows `canDecide`
(`select-list-state.ts:280`) and `changeQuantity` calls `addQuantity`
(`list-page.ts:1115-1125`), which is a change of demand and stays behind `DECIDE`. Angular
changes follow the `nx-portfolio-angular-developer` skill. No copy changes, because the
sheet draws the control or does not.

## 8. Not in this plan

- `BasketSettleService`, rows and the owner asked through coverage: `0136`. It calls
  `canSettle` and `canChangeDemand` from the file this plan creates.
- The basket screen disabling the "asked for" control from `demandChangeable`: velista
  `0092`.
- `seesZoneData` becoming per list: `0136`.
- Links, expiry and the participant row: `0140`.

## 9. Tests

Unit:

1. `canSettle` and `canChangeDemand` over every subset of the four permissions and the three
   approval states, as a table.
2. `SettlementService.settle`: a `WRITE` only member settles an approved line, the line
   stays `APPROVED`, and a `DECIDE` only member is refused with the `WRITE` sentence.
3. `authorizeEdit` behaves as before: the plan `0076` specs pass with no edit.
4. `setOriginQuantity` on an `APPROVED` line: refused when the owner holds `WRITE` alone,
   allowed when the owner holds `DECIDE`, refused to a registered actor who holds `WRITE`
   alone beside an owner who holds `DECIDE`, allowed to a guest beside that same owner.
5. An adoption that moves the zone line by zero needs `WRITE` alone.
6. The approval read outside the lock is re-tested inside it: a line approved between the
   two reads refuses a `WRITE` only owner.
7. `lineOrigins` answers `demandChangeable` false on a row that is `writable` and approved,
   for a `WRITE` only owner.
8. `revertUnits`: an origin on a list the owner lost is skipped with `ACCESS_GONE`, its
   settlement still stands, the zone line did not move, the other origin went back, and
   `settledQuantity` fell by the units taken alone.
9. A `NOT_AVAILABLE` close with one unreachable origin is skipped whole.
10. A guest's reopen after the owner lost the list writes nothing anywhere. This is the
    regression spec for the hole.
11. `setOriginSettled` lowering on a lost list answers the named skip and calls no revert.
12. The reflection spec of section 6.

Integration, real database, through the integration target:

13. `permissionsAmong` agrees with `permissionsForMembership` for a zone owner, a zone
    admin, a member with a `list_access` row of `['READ','WRITE']`, a member with none, a
    `PENDING` member and a stranger, across two zones in one call.

## 10. Acceptance criteria

- [ ] One file states who can settle and who can change demand, and the list page and the
      basket both call it.
- [ ] A `WRITE` holder settles from the list page, and approval is still `DECIDE`.
- [ ] Nobody changes an approved line's quantity through a basket who is refused that change
      on the list page, and the basket's owner is asked first.
- [ ] Taking a purchase back never writes a list the basket's owner cannot write, and the
      shopper is told what did not go back.
- [ ] Every participant write is throttled, and a spec fails when one is not.
- [ ] Plan `0076`'s rule and its specs are unchanged.
- [ ] No migration. `openapi.json` and the wire types are current.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
npx nx run-many -t lint test -p velista/feature-lists velista/data-access velista/models
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Confirm the three velista project names with `npx nx show projects | grep velista` before
running, because `run-many` drops a name it does not know (memory note on Nx workspace
traps). Run the integration spec through its own target against a slot, boot core on it
once to catch an erased injection token, then give the slot back.
