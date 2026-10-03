# 0045 A zone holds its members and lists

> Fifth of the seven remodel plans. Needs `0041` (the frame) and the `parent` field that `0042`
> adds to a descriptor. Prerequisite reading: `0041`, `0042` targets 2 to 5, `0007` (the people
> and what they share), `0009` (editing), `0038` (roles).
>
> Mock: `plans/mocks/remodel/`, boards `Shoppers` and `Phone-Zone`, published at
> <https://claude.ai/artifact/KJTKDyRWfdJTL9PCUPwjQv>.

Shoppers has six screens in a flat row: People, Zones, Memberships, Lists, List lines and
Shopping lists. Memberships cannot load without a zone, and List lines cannot load without a
list. The data has a shape. A zone holds its members and its lists. A list holds its lines. A
person is in zones and owns shopping lists.

This plan makes that shape the navigation. Shoppers has two tabs, People and Zones, and the
other four screens become tabs of a zone or of a person.

## Brief for the agent

### Objective

Replace the six Shoppers screens with a People tab and a Zones tab, where a zone page holds
its members, lists and shopping lists, and a person page holds their zones and shopping lists.
Use the `nx-portfolio-angular-developer` skill.

### Context

- **Descriptors**: `USERS`, `ZONES`, `MEMBERSHIPS`, `LISTS`, `LIST_LINES` and `BASKETS` in
  `libs/luna-shopper-admin/feature-people/src/lib/`.
- **Detail pages**: `UserDetailPage`, `ZoneDetailPage`, `ListDetailPage` and
  `BasketDetailPage`, all on `DetailPage` and `detail-frame.ts`.
- **A zone read already carries** `members[]` and `lists[]`. A list read carries `lines[]`. A
  basket read carries its rows and their settlements.
- **Named actions are declared twice** for users and zones: once on the descriptor and again
  as hand written buttons on the detail page. Kick and ban have two sets of translation keys.
- **The count of join requests** is `core.memberships.pending` on `GET /v1/admin/dashboard`.

### Target state

1. **Section "Shoppers"** has two tabs: People (`/shoppers/people`) and Zones
   (`/shoppers/zones`). `/shoppers` redirects to People. The rail entry shows the count of
   join requests that wait.
2. **People tab**: the `USERS` list with its filters. At 72 rem and above the list is 340 px
   wide and the open person sits beside it.
3. **A person**, `/shoppers/people/:userId`, redirects to `details`. The header shows the
   name, the kind (Registered or Guest), and "Email not confirmed" as a waiting state when
   that is so. Actions: "Edit", and under "More actions": "Resend confirmation" and "Delete
   account". Tabs:
   - **Details**: the facts, and the role switches with their confirmation.
   - **Zones**: the zones this person is in, each with their role and state there. A row
     opens the zone.
   - **Shopping lists**: the `BASKETS` list for this owner. A row opens the shopping list at
     `/shoppers/people/:userId/shopping-lists/:basketId`: its rows, what was bought, and each
     settlement. The shop of a settlement links to the shop page of `0042`.
4. **Zones tab**: the `ZONES` list. A row shows the name, the owner, the member and list
   counts, and the state "Marked for deletion". The same split as People.
5. **A zone**, `/shoppers/zones/:zoneId`, redirects to `members`. The header shows the name,
   the owner as a link to that person, and the join code in the mono face. Actions: "Edit
   zone", and under "More actions": "New join code", "Mark for deletion" or "Restore", and
   "Delete zone". Tabs:
   - **Members**: requests that wait come first, on the waiting wash, each with "Reject" and
     "Approve". Then the other members with their role and state. Each name links to the
     person. A menu on each row holds "Make owner", "Change role or name", "Remove from the
     zone" and "Ban from the zone". The owner row has no menu.
   - **Lists**: the lists of the zone with their line counts. A list opens at
     `/shoppers/zones/:zoneId/lists/:listId`: its settings, and its lines with "Approve" and
     "Reject" on a line that waits, and edit and delete on every line.
   - **Shopping lists**: the `BASKETS` list filtered by this zone. A row opens the shopping
     list under its owner.
   - **Details**: the facts and the configuration.
6. **One caution, said once.** A page that edits a zone, a member, a list or a line shows the
   line "Everybody in the zone sees a change here at once." It replaces `people.broadcast`.
7. **Texts.** Info of Shoppers: "A zone is a household. It holds its members and its lists."
   "A person is in one or more zones and owns their shopping lists." Info of a list: "An
   operator corrects a line. Only a member of the zone adds one." Info of a shopping list: "A
   shopping list is the record of one trip, so it is read only. To correct something, change
   the list it came from."
8. **Old addresses redirect.** `/shoppers/users...` to People. `/shoppers/memberships` and
   `/shoppers/lists` to Zones, or to the zone when a `zoneId` query parameter is present.
   `/shoppers/lists/:id` and `/shoppers/list-lines/:id` read the row and go to the list under
   its zone. `/shoppers/shopping-lists/:id` reads the row and goes to it under its owner.

### Scope

- In: `feature-people`, `apps/luna-shopper-admin/src/app/sections.ts`, `en.json`, specs.
- Out: the gateway (section 2), what an action does, the Overview (`0046`).

### Constraints

- One place declares an action. The descriptor's `named` actions are the source, and the
  person page and the zone page draw them. Delete the hand written copies and the second set
  of kick and ban keys.
- Every action that was confirmed stays confirmed. "Restore" stays without a confirmation.
- An owner cannot be removed or banned, and a guest has no roles. Keep both rules.
- `MEMBERSHIPS` and `LIST_LINES` take their parent from the route through `parent` and are no
  longer sections of their own.
- The split view has three states, as in `0041`.

### Action boundaries

- Do not add a way to create a person, a zone, a list or a line.
- Do not change a gateway route unless the owner agreed to a follow up of section 2.

### Progress evidence

- `npx nx lint` and `npx nx test` for `luna-shopper-admin/feature-people` and
  `luna-shopper-admin`. `npx nx build luna-shopper-admin`.
- A spec for each redirect of target 8, and one that proves each action is declared once.
- A browser walk on a Luna slot with the demo seed, at 390 px and 1360 px: approve a request,
  change a role, open a person from a zone, open a list and reject a line, open a shopping
  list. Attach screenshots that match the two boards.

## 1. What this plan deletes

- The sections entries Memberships, Lists, List lines and Shopping lists, and their routes.
- `PeopleDashboard` and `people-dashboard-view.ts`, once `0046` has drawn their numbers on the
  Overview. If `0046` is not built yet, move the block there as it is.
- The action buttons written by hand in `user-detail-page.ts` and `zone-detail-page.ts`.
- `people.zones.confirm.kickMember` and `banMember` (the membership keys stay).
- `people.lines.note`, `people.baskets.note`, `people.broadcast`.
- The six `*_OPTIONS` constants and `PendingConfirm` from the public `index.ts`.
- The section, button and row styles repeated in the four detail pages. They take `PageHeader`,
  `PageTabs` and the panel styles of `0041`.

## 2. What the gateway does not serve yet

| The mock shows | Today | In this plan |
| --- | --- | --- |
| "1 request" on a zone row, and a filter for zones with requests | The zone row has no such count, and the zones list has no such filter | Out. The row shows no request state. Follow up: `pendingCount` on the zone row and a `hasPending` filter. |
| The date a member joined | `createdAt` is on the membership | In. |

## 3. Decisions for the owner

- **The follow up in section 2.** Without it, the Overview says that three requests wait and
  the operator must look for the zones. With it, one press finds them.
- **Lists by who made them.** The filter `createdByUserId` has no home in this design. Say so
  if you use it, and a person gets a fourth tab.
