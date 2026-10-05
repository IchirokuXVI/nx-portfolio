> **PR:** [#643](https://github.com/IchirokuXVI/nx-portfolio/pull/643)

# 0057 A zone and a person on the record page

> Sixth plan of the record page series (`0052` to `0060`). Needs `0054` (the collections of
> a record) and `0056` (the page as a pane, and the rules for a record in a split), merged.
> It moves the zone and the person.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are
> `Actions` and `Phone-Actions`. They show an account with the More menu open.

Plan `0045` gave a zone and a person a page each inside the Shoppers split. Each page has a
Details tab that is a list of facts written by hand, and an "Edit" link to the old form at
`…/edit`, which is a second page. The roles of a person are switches on the Details tab
that write at once. Every action of the record is a button in the header.

After this plan both are record pages: Details reads and changes in one place, the actions
are in the More menu, and a role is given and taken away there too.

## Brief for the agent

### Objective

Draw the zone and the person with `RecordPage`. Delete `ZonePage`, `ZoneDetailsTab`,
`PersonPage` and `PersonDetailsTab`, and the two `edit` routes. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-human` and `antislop-layoutmobile` skills.

### Context

All under `feature-people/src/lib/`.

- **The routes** are `shoppers-routes.ts`, inside `ShoppersPage`, which draws the header
  above two splits.
  - `…/zones/:zoneId` is `ZonePage`, which opens on `members` (`ZoneMembersTab`), with
    `lists` (the list of `LISTS`), `shopping-lists` (the list of `ZONE_BASKETS`) and
    `details` (`ZoneDetailsTab`). `…/zones/:zoneId/edit` is the old form.
  - `…/people/:userId` is `PersonPage`, which opens on `details` (`PersonDetailsTab`), with
    `zones` (`PersonZonesTab`) and `shopping-lists` (the list of `BASKETS`).
    `…/people/:userId/edit` is the old form.
- **`ZONES`** (`zones.ts`): fields `id`, `name` (required), `config` (json), `ownerName`
  (never editable, and it reads the owner's ID when the owner has no name), `joinCode`,
  `status`, `markedForDeletionAt`, `memberCount`, `listCount`, `pendingCount`, `createdAt`.
  The view also carries `ownerUserId` and `updatedAt`. Four named actions:
  `regenerate-join-code`, `mark-for-deletion`, `restore-zone`, `delete-zone`. `caution` is
  set. `actions.edit` is true.
- **`USERS`** (`users.ts`): `idField: 'userId'`, fields `userId`, `username` (required),
  `displayName`, `email`, `kind`, `emailVerifiedAt`, `createdAt`, `roles` (never editable).
  The view also carries `updatedAt`, `hasPassword` and `providers`. Two named actions:
  `resend-verification` and `delete-account`.
- **The roles** are on `PersonDetailsTab` (`person-tabs.ts`): one switch for each role of
  `USER_ROLE_OPTIONS`. A press asks, then calls `directory.setUserRoles`. A guest gets a
  notice and no switch.
- **The actions** are run by `ActionRunner` and `lib-action-confirm` (`row-actions.ts`),
  which the two pages, `ZoneMembersTab` and `ListPage` share. `isDangerAction` names the
  actions that destroy. `actions-declared-once.spec.ts` guards that an action is declared
  in one place.
- **The record context** of the two pages is `ZoneContext` and `PersonContext`
  (`shopper-contexts.ts`). `ZoneMembersTab` and `PersonZonesTab` inject them.
- `fact-list.ts` is also used by `ListPage` and `BasketPage`, which move in `0058`.

### Target state

1. **A zone is a record page.** Its tabs are "Members", "Lists", "Shopping lists" and
   "Details", in that order, with the counts of today, and it opens on "Members".
2. **Details of a zone** reads first: "Zone" (name, owner, join code), "State" (status,
   when it was marked, the three counts) and "Settings" (the config, printed). The owner is
   a link to the person. The Record block has "Added", "Last changed" and the ID.
3. **A person is a record page.** Its tabs are "Details", "Zones" and "Shopping lists", and
   it opens on "Details".
4. **Details of a person** is the board `Actions`: "Account" (username, shown as, email,
   kind), "Access" (roles, email confirmed, has a password, sign in providers), two links
   ("Zones this account owns" and "Zones it is a member of"), and the Record block with
   "Signed up", "Last changed" and the ID.
5. **An email that is not confirmed is amber**: "Not yet", in the row and as a state in the
   header.
6. **Every action is in the More menu.** For a zone: a new join code, mark for deletion or
   restore, and "Delete this zone" last, in red. For a person: send the confirmation again,
   one entry for each role ("Give the admin role" or "Take the admin role away"), and
   "Delete this account" last, in red. Each one asks first where it asks today.
7. **A role is not a switch any more.** The row "Roles" reads the roles the person holds.
8. **"Edit" changes Details in place.** `…/edit` of a zone and of a person leads to
   `details?edit=1`. The caution of a zone is one line above the first section while the
   page is a form.
9. **`ZonePage`, `ZoneDetailsTab`, `PersonPage` and `PersonDetailsTab` are gone.** The
   Members tab, the Zones tab of a person and the three lists work as before.

### Scope

- In: `feature-people/src/lib/` (`zones.ts`, `users.ts`, `user-roles.ts`,
  `shoppers-routes.ts`, `zone-page.ts`, `zone-details-tab.ts`, `person-page.ts`,
  `person-tabs.ts`, `shopper-contexts.ts`, `zone-members-tab.ts` only for how it learns the
  zone, `row-actions.ts` only for what the two pages no longer need), their specs,
  `en.json`, and `apps/.../no-new-old-form.spec.ts` if its list names a file of this plan.
- Out: `ShoppersPage` and its header, `ListPage`, `BasketPage`, `fact-list.ts`, the
  Members tab's own row actions, the Admins section, the gateway, `openapi.json` and
  `wire-types.ts`.

### Constraints

- An action is declared once, on the descriptor. The More menu, and any row that still
  offers it, read the same declaration. `actions-declared-once.spec.ts` stays green.
- A role changes only through a named action with its question. Nothing on a reading page
  writes.
- The owner of a zone is shown by name. An owner whose account has no name is shown as
  the page shows any reference it cannot name, and never as a bare ID.
- The page never offers a role to a guest.
- The constraints of plans `0053`, `0054` and `0056` hold.

### Action boundaries

- Do not change a gateway route or a DTO.
- Do not move `ListPage` or `BasketPage`, and do not delete `fact-list.ts`. That is
  `0058`.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk gives and takes a role and
  deletes an account, so it needs a Luna slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-people`,
  `luna-shopper-admin/feature-resource` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 4, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- The admin accounts of the Admins section. That screen is a list that only reads: an
  admin is made with the command line, and there is no page for one account. The board
  `Actions` shows a person who holds the admin role, and that is the person of this plan.
- `usernamePropagation`. The DTO takes it and the form has never offered it.
- Who made or changed a zone or a person. Both views carry the dates and no person.

## 2. The descriptors

### 2.1 `ZONES`

```ts
record: {
  details: 'last',
  sections: [
    { title: 'people.zones.section.zone',
      fields: ['name', 'ownerUserId', 'joinCode'] },
    { title: 'people.zones.section.state',
      fields: ['status', 'markedForDeletionAt', 'pendingCount'] },
    { title: 'people.zones.section.settings', fields: ['config'] },
  ],
  children: [
    { as: 'tab', name: 'members', label: 'people.zones.tab.members',
      component: ZoneMembersTab, count: 'memberCount' },
    { as: 'tab', resource: 'lists', by: 'zoneId', count: 'listCount' },
    { as: 'tab', resource: 'zone-baskets', by: 'zoneId' },
  ],
  facts: { added: 'createdAt', changed: 'updatedAt' },
},
```

- `ownerName` is replaced by `ownerUserId`: a reference to `users`, `nameFrom:
  'ownerName'`, `editable: false`. The list column that showed the owner keeps its text,
  because a reference with `nameFrom` reads the same name.
- `updatedAt` becomes a field, a date with the time, never editable.
- `joinCode` gets `format: 'code'`.
- Each named action gets `danger` where `isDangerAction` names it today, and `delete-zone`
  gets `after: 'leave'`. After a zone is deleted the page also does what `ZonePage._deleted`
  does: it tells `ShoppersStatus` to read again. Put that in the action's `run`.
- Use the keys of the tabs that the page reads today. The names above are examples.

### 2.2 `USERS`

```ts
record: {
  sections: [
    { title: 'people.users.section.account',
      fields: ['username', 'displayName', 'email', 'kind'] },
    { title: 'people.users.section.access',
      fields: ['roles', 'emailVerifiedAt', 'hasPassword', 'providers'] },
  ],
  children: [
    { as: 'tab', name: 'zones', label: 'people.users.tab.zones',
      component: PersonZonesTab },
    { as: 'tab', resource: 'baskets', by: 'ownerUserId' },
    { as: 'link', resource: 'zones', by: 'ownerUserId',
      label: 'people.users.record.zonesOwned' },
    { as: 'link', resource: 'zones', by: 'userId',
      label: 'people.users.record.zonesJoined' },
  ],
  facts: { added: 'createdAt', changed: 'updatedAt',
           labels: { added: 'people.users.record.signedUp' } },
},
```

- `updatedAt`, `hasPassword` (a boolean) and `providers` (a text that `read` joins) become
  fields, never editable.
- `emailVerifiedAt` gets `check`: for a registered account with no date it answers
  `{ label: 'people.users.notConfirmed' }`.
- The two links have no count, because the view carries none.
- **The roles as named actions.** `named()` adds two actions for each entry of
  `USER_ROLE_OPTIONS`: one that gives the role, `available` when the person does not hold
  it and is not a guest, and one that takes it away, `available` when the person holds it.
  Each has the `confirm` that `askToSwitch` shows today and calls
  `directory.setUserRoles` with the new list. Build them in one function in
  `user-roles.ts`, so that a new role is one entry.
- `delete-account` gets `danger` and `after: 'leave'`, and its `run` also says that the
  zones changed, as `PersonPage._deleted` does.

### 2.3 The routes and the contexts

- `shoppers-routes.ts` builds both pages with `recordRoute`. The lists under a zone and a
  person have routes of their own (`…/lists/:listId`, `…/shopping-lists/:basketId`), so
  hand those tab routes over through `tabs`.
- Both pages are panes of a split under the header of `ShoppersPage`. Their headings are a
  level lower, through `PAGE_HEADING_LEVEL`, as today.
- `ZoneMembersTab` and `PersonZonesTab` read the record from `RECORD_CONTEXT`.
  `ZoneContext` and `PersonContext` are deleted if nothing else reads them. `ListPage`
  reads a zone for its redirect, so check before you delete.
- `…/zones/:zoneId/edit` and `…/people/:userId/edit` become redirects to
  `details?edit=1`.

## 3. Specs

- `people-screens.spec.ts` (1,129 lines) holds the cases of both pages. Keep every case
  about behavior, over `RecordPage` with the two descriptors: the tabs, their counts and
  the first tab, each action and its question, the refusal of an action, where the app
  goes after a delete, a guest. The cases that find a `role="switch"` for a role become
  cases about the entries of the More menu.
- `people-descriptors.spec.ts`: the two `record` blocks, the owner as a reference, `check`
  on an email that is not confirmed, and the role actions: which are offered to a person
  who holds a role, to one who does not, and to a guest.
- `actions-declared-once.spec.ts` stays green. If it reads the template of a deleted page,
  point it at the descriptor.
- List in the pull request any case of a rewritten spec that has no new home.

## 4. The walk

On slots of your own, at 1360 px and at 390 px:

- A person: two sections, the roles as words, the two links, "Signed up" in the Record
  block. A person whose email is not confirmed has the amber state in the row and in the
  header.
- The More menu of a person who is not an admin: "Give the admin role". It asks. After
  it, the row "Roles" says "Admin" and the menu says "Take the admin role away".
- A guest: no role entry in the menu.
- "Delete this account" is last, in red, under a line. It asks and names the account.
  After it the app is on the list of people.
- A zone opens on "Members". Details: the owner is a link to the person, the join code is
  in the mono face, the config is printed.
- "Edit" on a zone: the caution line is above the first section. Change the name, save.
  Break the config so it is not an object, save: the refusal is under the field.
- "New join code" asks, and the code changes on the page with no reload.
- "Mark for deletion", then "Restore": the state in the header follows.
- `…/zones/<id>/edit` opens Details as a form.
- Change a field, then press a person in the column: the page asks.
- At 390 px: the More menu is a sheet with rows 48 px high, and the red entry is last.
  No sideways scroll.

## 5. Decisions made

From the mock, approved on 2026-10-05:

- **Every action that is not Edit lives in the More menu.** Actions that destroy come
  last, under a line, in red words. On a phone the same list is a sheet.
- **A switch never writes while the page reads.** A change that must be fast is a named
  action in the More menu, with its own question. The roles of a person are the case the
  board draws: "Take the admin role away".
- **The record's own facts** are who made it, when it changed, and its ID in small mono
  type with a Copy button. The ID is never the name of anything.

Decisions this plan made, for the owner to confirm:

- **The header of a zone loses the owner and the join code.** Plan `0045` drew both as
  states beside the name. They are fields of Details now, and the header keeps the states
  that say something is wrong or waits: requests, and marked for deletion.
- **"Zones" of a person stays a tab, and the two links are added.** The tab shows the
  zones with the person's part in each. The links open the zones list narrowed to the
  person, as the board draws them.
- **Details stays the last tab of a zone**, as plan `0045` has it, because the members are
  what a zone is opened for.

## 6. What this plan deletes

- `feature-people/src/lib/zone-page.ts` and `zone-details-tab.ts`.
- `feature-people/src/lib/person-page.ts`, and `PersonDetailsTab` in `person-tabs.ts`.
- The two `edit` routes as pages of their own.
- `ownerName` as a field of `ZONES`.
- `ZoneContext` and `PersonContext`, when nothing reads them.
- The keys of `en.json` that only those files read.
