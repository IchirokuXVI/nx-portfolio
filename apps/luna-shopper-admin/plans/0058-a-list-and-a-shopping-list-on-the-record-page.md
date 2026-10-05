# 0058 A list and a shopping list on the record page

> Seventh plan of the record page series (`0052` to `0060`). Needs `0057` (the zone and the
> person), merged, because both pages of this plan sit under those two.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. No board draws a list or a shopping
> list. The boards `Main` (a small record with a panel) and `Page-States` are the pattern.

A list of a zone and a shopping list of a person each have a page written by hand:
`ListPage` and `BasketPage`. Both draw a list of facts and then the lines of the record.
The list has an "Edit" link to the old form on a second page. These are the last two pages
of the Shoppers section that draw a record in their own way.

A list is also the first record of the app whose row says who made it, so it is where the
"by" line of the Record block is drawn for the first time.

## Brief for the agent

### Objective

Draw the list of a zone and the shopping list with `RecordPage`, each with its lines as a
panel of its own. Delete `ListPage`, `BasketPage` and `FactList`. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-human` and `antislop-layoutmobile` skills.

### Context

All under `feature-people/src/lib/`.

- **`ListPage`** (`list-page.ts`, 481 lines) is mounted by hand at
  `…/zones/:zoneId/lists/:listId`. It draws a header, the caution of a zone, a
  `lib-fact-list`, and the lines of the list. A line has the named actions `approve-line`
  and `reject-line` and a delete. The page deletes the list itself too. When the address
  names another zone than the list's own, it goes to the right address.
  `…/lists/:listId/edit` is the old form.
- **`LISTS`** (`lists.ts`): `parent` is the zone. Fields: `id`, `name`, `zoneName` (never
  editable), `createdByUserId` (a reference to `users`, never editable), `lineCount`,
  `autoApproveLines` and `sharedWithZone` (booleans), `createdAt`. The view also carries
  `updatedAt`. `actions` are `edit` and `delete`. `info` and `caution` are set.
- **`LIST_LINES`** (`list-lines.ts`): `parent` is the list. Its rows already open on
  `RecordPage` since plan `0053`, at `…/lists/:listId/lines/:id`. Its view carries
  `createdByUserId`, `createdAt` and `updatedAt`.
- **`BasketPage`** (`basket-page.ts`, 474 lines) is the `detail` of `BASKETS` and of
  `ZONE_BASKETS`, both built by `basketResource()` in `baskets.ts`. It is mounted by hand at
  `…/people/:userId/shopping-lists/:basketId`, and the address under a zone redirects
  there. It only reads: a header, a `lib-fact-list`, and the lines with what was settled
  for each. The descriptors have no `actions` at all.
- **A shopping list with no name** is called by its day since plan `0051`.
- **`fact-list.ts`** (59 lines) has no reader left after this plan.

### Target state

1. **A list is a record page.** It has no tabs. Details has one section, "List" (name,
   lines approved by themselves, shared with the zone), and one panel, "Lines".
2. **The Record block of a list says who made it**: "Added", the date, and "by" the
   person's name as a link. Then "Last changed" and the ID. The zone is not a row: the back
   link names it.
3. **The Lines panel** is what `ListPage` draws today: every line, its state, "Approve"
   and "Reject" where a line waits, and the delete of a line. A press on a line opens the
   line's own record.
4. **The two booleans of a list are switches under "Edit"**, saved with Save. The caution
   of a zone is one line above the first section while the page is a form.
5. **"Delete this list" is in the More menu.** After it the app is on the lists of the
   zone.
6. **`…/lists/:listId/edit` leads to the list with `?edit=1`.**
7. **A line's own record says who added it**, in its Record block.
8. **A shopping list is a record page that only reads.** It has no "Edit" and no More
   menu, because the resource has no action. Details has one section (name, kind, status,
   lines), the panel "Lines" with what was settled, and the Record block with "Made" and
   the ID.
9. **`ListPage`, `BasketPage` and `FactList` are gone.**

### Scope

- In: `feature-people/src/lib/` (`lists.ts`, `list-lines.ts`, `baskets.ts`,
  `list-page.ts`, `basket-page.ts`, `fact-list.ts`, `shoppers-routes.ts`,
  `shopper-redirects.ts`, `row-actions.ts` only for what a panel needs), their specs, and
  `en.json`.
- Out: the zone and the person, the Members tab, `basket-settlements.ts` (the rules of a
  settlement stay as they are), the gateway, `openapi.json` and `wire-types.ts`.

### Constraints

- The lines of a list keep their actions and their questions. An action is declared once,
  on `LIST_LINES`.
- The "by" line is drawn from the row. It is never guessed, and a row with no value draws
  no line.
- A person is shown by name. A person whose account is gone reads as the page reads any
  reference it cannot name, and never as a bare ID.
- The constraints of plans `0053`, `0054` and `0056` hold. The rule of plan `0056` for a
  record under the wrong parent replaces the redirect of `ListPage`.

### Action boundaries

- Do not change a gateway route or a DTO.
- Do not change what a settlement means or how it is worked out.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk approves a line and deletes
  a list, so it needs a Luna slot of your own, given back with `--down`.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-people`,
  `luna-shopper-admin/feature-resource` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- The browser walk of section 4, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- The name of a participant of a shopping list. The view carries the participant's ID and
  no name (plan `0051`, section 4). It needs a read in the gateway.
- A way to change a shopping list. The gateway offers none.
- The postal code page of the harvester. It is the `detail` of `POSTAL_CODES`, it only
  reads, and it is keyed by the code. Plan `0060` says why it stays.

## 2. The descriptors

### 2.1 `LISTS`

```ts
record: {
  sections: [
    { title: 'people.lists.section.list',
      fields: ['name', 'autoApproveLines', 'sharedWithZone'] },
  ],
  children: [
    { as: 'panel', name: 'lines', label: 'people.lists.record.lines',
      component: ListLinesPanel, count: 'lineCount' },
  ],
  facts: { added: 'createdAt', addedBy: 'createdByUserId', changed: 'updatedAt' },
},
```

- `updatedAt` becomes a field, a date with the time, never editable.
- `zoneName` is in no section. Give it to `facts.also` if the walk shows that a list
  reached from a link does not say which zone it is in.
- `ListLinesPanel` is the lines block of `ListPage`, moved into `list-lines-panel.ts`. It
  reads the list from `RECORD_CONTEXT`, and it is a part and not a list tab because its
  rows have buttons.

### 2.2 `LIST_LINES`

```ts
record: {
  sections: [
    { title: 'people.listLines.section.line',
      fields: ['content', 'quantity', 'approvalStatus'] },
  ],
  facts: { added: 'createdAt', addedBy: 'createdByUserId', changed: 'updatedAt' },
},
```

`updatedAt` becomes a field. `listId` and `listName` are in no section: the list is the
parent, and the back link names it.

### 2.3 `basketResource()`

```ts
record: {
  sections: [
    { title: 'people.baskets.section.list',
      fields: ['name', 'kind', 'status', 'lineCount'] },
  ],
  children: [
    { as: 'panel', name: 'lines', label: 'people.baskets.record.lines',
      component: BasketLinesPanel },
  ],
  facts: { added: 'generatedAt',
           labels: { added: 'people.baskets.record.made' } },
},
```

- `detail` is deleted from both descriptors.
- `BasketLinesPanel` is the lines of `BasketPage` with their settlements, moved into
  `basket-lines-panel.ts`.
- The reference to the owner or to the zone is the parent, and it is in no section.

### 2.4 The routes

`shoppers-routes.ts` builds `…/lists/:listId` and `…/shopping-lists/:basketId` with
`recordRoute`. The `edit` route of a list becomes a redirect. The redirect from the address
under a zone to the one under a person stays.

## 3. Specs

- The cases of `people-screens.spec.ts` about a list and its lines move to
  `list-record.spec.ts`, over `RecordPage` with `LISTS` and over `ListLinesPanel`: the
  section, the two switches under "Edit", approve and reject, the delete of a line, the
  delete of the list and where the app goes, the list under the wrong zone.
- New cases: the Record block draws "by" with the name of the person, draws no "by" line
  for a row with no `createdByUserId`, and says so when the person is gone.
- `basket-settlements.spec.ts` keeps its cases. A new `basket-record.spec.ts` proves that
  a shopping list has no "Edit" and no More menu, and that a list with no name has its day
  as the heading.
- `people-descriptors.spec.ts`: the three `record` blocks.
- List in the pull request any case of a rewritten spec that has no new home.

## 4. The walk

On slots of your own, at 1360 px and at 390 px:

- A list: one section, the two values as "Yes" or "No", the lines, and the Record block
  with "Added … by" a name that opens the person.
- "Edit": the two switches, the caution line, "1 unsaved change" after a press, Save.
- Approve a line that waits. Its state changes in the panel with no reload.
- Open a line: its own record, with who added it.
- "Delete this list" asks and names the list. After it the app is on the lists of the
  zone.
- A shopping list: no "Edit", no More menu, the lines with what was settled. A list with
  no name is headed by its day.
- At 390 px: the Record block is the last section, the lines are readable with no
  sideways scroll.

## 5. Decisions made

From the mock, approved on 2026-10-05:

- **The Record block says who made a record and when it changed, only when the row
  carries the value.** A list and a line carry who made them. A shopping list does not.
- **A record with 3 fields is one short panel.**
- **A switch changes with Save.**

Decisions this plan made, for the owner to confirm:

- **The lines of a list are a panel that holds every line**, and not five rows and "See
  all". The contract says a panel is short. The lines are what a list is opened for, there
  is no list of lines anywhere else to lead to, and the block has buttons on its rows. A
  list tab cannot hold those buttons.
- **A shopping list gets the record page though it can only be read.** The page then has
  the same places for the same things as every other record.

## 6. What this plan deletes

- `feature-people/src/lib/list-page.ts` and `basket-page.ts`.
- `feature-people/src/lib/fact-list.ts`.
- `detail` in `basketResource()`.
- The `edit` route of a list as a page of its own.
- The keys of `en.json` that only those files read.
