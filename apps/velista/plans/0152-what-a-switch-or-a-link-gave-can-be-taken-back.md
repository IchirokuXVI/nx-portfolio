> **PR:** [#756](https://github.com/IchirokuXVI/nx-portfolio/pull/756)

# 0152: what a switch or a link gave can be taken back, and the copy says who goes

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Three findings of `docs/reports/2026-10-16-velista-e2e-slot1.md`
> about access that outlives the control that gave it: F4.2 (major, turning "Everybody in
> this group can use this list" off leaves every member who opened it with full access, and
> only a small hint says so), F6.3 (major, the revoke pane says "Also remove the 2 guests"
> and ticking it also removes a registered group member who joined by the link) and F4.10
> (cosmetic, an empty private list says everyone will see it).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0042` section 2.2 (sharing off revokes nobody, and why),
> backend plan `0114` section 5 (a link that reached the wrong hands),
> `apps/luna-shopper-backend/core/src/app/lists/list.service.ts:294-324` (`setAccess`, rules
> 3 and 5), `:502-552`, `:595-605`, `core/src/app/baskets/basket-sharing.service.ts:226-264`
> (`revokeLink`), `libs/velista/feature-lists/src/lib/list-settings-sheet/list-settings-sheet.ts`
> (`setSharedWithZone`, `_loadAccess`), `libs/velista/data-access/src/lib/lists/list-api.ts:120-145`
> (`setListAccess`), and `libs/velista/feature-shopping-lists/src/lib/share-sheet/share-sheet.ts:178-179`
> (`joinedCount`).

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

When the owner turns group sharing off, the sheet says how many people keep the list and
offers to take it from them in the same gesture. The revoke pane of a share link counts the
people who joined with it, in words that match what the server does. An empty private list
does not promise that everyone will see it.

### Context

- **Sharing off revokes nobody, on purpose.** `list.service.ts:502-518` (member path) and
  `:536-552` (operator path) state it, and `applyListUpdate` grants only when the switch
  opens (`:595-605`). The sheet's hint `list.settings.sharedWithZone.hint` (`en.json:892`,
  drawn at `list-settings-sheet.html:84-86`) is the only word about it. `setSharedWithZone`
  (`list-settings-sheet.ts:400-419`) sends the PATCH and reloads access only when the switch
  turns on (`:412-414`). Access rows come from `_loadAccess` (`:540`).
- **The bulk revoke already exists.** `PUT /v1/lists/:id/access` (gateway
  `list.controller.ts:288-301`) takes an array of `entries`. Core `setAccess`
  (`list.service.ts:294-324`) replaces each named membership's set, and rule 5 says an empty
  set deletes the row (`:310-312`, delete at `:386`). One PUT that names each member with
  `permissions: []` revokes them all in one transaction. Rule 3 (`:301-307`) refuses a non
  staff caller that clears a row holding `MANAGE`, so those rows stay out of the request.
  The client side is `ListApi.setListAccess` (`list-api.ts:120-145`). No backend change.
- **The entity cannot tell how a row was granted.** `ListAccess` has `listId`,
  `membershipId` and `permissions` only (`list-access.entity.ts:37-52`). Rows from the
  switch and rows granted by hand look the same, so the tick's copy says "the N people who
  have it" and not "the people the group gave it to".
- **The revoke cascade is documented backend intent.** `revokeLink` with
  `revokeParticipants` ends every live row with that `shareLinkId` (`basket-sharing.service.ts:226-264`),
  and the comment at `:242-244` says "Guests and registered joiners both go", because a link
  that reached the wrong hands may have reached an account too. A registered person the
  owner added by name has a null `shareLinkId` and stays. `linkView` counts every live
  participant with `shareLinkId` set (`:1198-1202`). So `joinedCount`
  (`share-sheet.ts:178-179`, `participantCount`) is right, and only the cascade label
  (`basket.revoke.cascade_*`, `en.json:1726-1727`, "guests") is wrong. `joinedWith`
  (`en.json:1706-1707`) already says "people".
- **The empty list copy.** `list.empty.body` (`en.json:789`, "Write the first thing and
  everyone here sees it") is drawn whenever `current.empty` holds
  (`list-page.html:209-213`), shared or not.

### Target state

1. When the sharing switch goes from on to off and N access rows without `MANAGE` exist,
   the sheet draws under the switch a tick "Also take it from the N people who have it",
   off by default, with the names of the N people under it. Saving with the tick on sends
   the PATCH, then one `setListAccess` that names each of those memberships with
   `permissions: []`, then reloads access. With the tick off, today's behaviour and today's
   hint stay.
2. With N equal to zero, no tick and no hint are drawn.
3. The cascade label of the revoke pane reads "Also remove the {{count}} people who joined
   with it" in both locales, in the same words as `joinedWith`.
4. The empty list body has a second key, for example `list.empty.bodyPrivate`, drawn when
   the list is not shared with the zone and no other member holds access. The shared
   wording stays for every other case.

### Scope

- `libs/velista/feature-lists/src/lib/list-settings-sheet/list-settings-sheet.ts`, `.html`
  and `list-settings-sheet.spec.ts`.
- `libs/velista/feature-lists/src/lib/list-page/list-page.html`, `list-page.ts` and
  `list-page.spec.ts` (item 4).
- `libs/velista/feature-shopping-lists/src/lib/share-sheet/share-sheet.spec.ts` if it
  asserts the cascade text.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- No backend change and no new route. If `setListAccess` refuses a row (rule 3), the sheet
  reports that the people with the manage right keep the list and lists them.
- The tick is off by default, as the revoke pane's is. Taking a list from people is the
  larger act and needs the explicit tick.
- Copy follows the velista rules: short sentences, the consequence before the action, the
  people named. No word warns that a free choice is permanent.
- The sheet must first be correct on a cold load (velista `0158`, F3.2). Build `0158`
  first or in the same branch, because a sheet that starts with the switch off cannot tell
  "off" from "turned off".

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change `ListApi`, the list models,
  the gateway or core.
- A race between the access read and the write (a member granted in between) is accepted.
  Do not add a version check to the PUT.

### Progress evidence

- New specs, each failing before the change:
  - sharing on, two non manage rows and one manage row: turning it off draws the tick with
    "2 people" and two names;
  - with the tick on, save sends the PATCH and then `setListAccess` with two entries whose
    permissions are empty, and reloads access;
  - with the tick off, save sends the PATCH only;
  - the revoke pane with two joiners reads the "people" sentence;
  - an empty list with `sharedWithZone` false and no other holder draws the private body.
- `npx nx run-many -t lint test -p velista/feature-lists velista/feature-shopping-lists`
  passes.
- `npx nx build velista` passes.

## 1. Not in this plan

- Changing the cascade to remove guests only. Backend plan `0114` chose that an account
  holder who came by a leaked link goes too, and the owner can add a member back by name.
  Counting guests alone would need a new field across the contract, the gateway and the
  OpenAPI document and would change a security rule. If the owner wants that rule, it is a
  backend plan.
- A "private" mark on the list row of the group page (the report notes the row looks like
  a shared one). A small follow up once the owner says what the mark is.

## 2. Choices that are mine

- **A tick in the same sheet, not a second confirm.** The person is already in the
  settings sheet with the switch in hand; the revoke pane set the pattern.
- **Names under the tick.** "2 people" alone hides who, and the list of names is what lets
  the owner decide.

## What the build decided

- **The switch still saves on the flip.** The tick appears only after a flip from on to off
  succeeds in this sheet, and it is a pending change that the footer Save sends, like a row
  edit. So "Save sends the PATCH, then the revoke" is the flip and then Save. Cancel after a
  flip leaves the list private and nobody revoked, which is today's behaviour.
- **Who counts as a holder:** an approved member who is not group staff, whose row as read
  holds anything and not `MANAGE`. Read from the loaded rows, not from edits. The revoke
  entries go in the same `setListAccess` as any row edits, and win over an edit of the same
  row.
- **The hint:** hidden only after a turn off that leaves nobody holding the list. Drawn as
  before in every other case, including beside the tick.
- **A refused take back** (the accepted race of rule 3) rereads access and names the people
  among the ones sent who now hold `MANAGE` (`list.settings.sharedWithZone.keepers`). The
  PUT is one transaction, so the copy opens with "Nothing changed". The tick then counts
  the rest, and Save again takes it from them. Any other failure shows the ordinary error.
- **The private body** needs the access read, which needs `MANAGE`. The page reads it once
  per list, only for an empty list that is not shared with the group and that the reader
  manages. "Somebody else" is a row with a non empty set whose membership is not the
  reader's. A failed read, or an unknown membership of the reader, keeps the shared
  wording. Copy: "Write the first thing. You have not shared this list with anybody yet",
  which stays true beside the derived access of group staff.
