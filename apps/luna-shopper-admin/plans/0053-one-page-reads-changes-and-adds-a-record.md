> **PR:** [#638](https://github.com/IchirokuXVI/nx-portfolio/pull/638)

# 0053 One page reads, changes and adds a record

> Second plan of the record page series (`0052` to `0060`). Needs `0052` (the parts and the
> contract), merged. Plans `0054` to `0059` each move one kind of record onto the page that
> this plan builds, and `0060` deletes what is left of the old form.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are `Main`,
> `Brand-Edit`, `Create`, `Actions`, `Save-States`, `Page-States`, `Phone-Brand`,
> `Phone-Create` and `Phone-Actions`. The mock shows a brand. This plan builds the page and
> gives it to the records that have no page of their own. The brand moves in `0054`.

A record of the back office opens as a form today. Every value is a control from the first
moment, Save is at the foot of the fields, and a row that was opened to be read can be
changed by a slip of the hand. Only the form's own Cancel and its back link ask before
they throw typed text away. A tab, the rail and the Back button of the browser do not.

This plan builds the page of the mock: a record opens to be read, "Edit" turns the same
page into a form, and one bar holds Save and Cancel.

## Brief for the agent

### Objective

Build `RecordPage` in `libs/luna-shopper-admin/feature-resource` from the parts of plan
`0052`: one page that reads a record, changes it and adds one. Mount it for every resource
that the generic form serves directly today. Use the `nx-portfolio-angular-developer`,
`design-taste-frontend`, `antislop`, `antislop-ui`, `antislop-human` and
`antislop-layoutmobile` skills.

### Context

- **The form today** is `ResourceFormPage`
  (`feature-resource/src/lib/resource-form-page.ts`), over `ResourceFormStore`
  (`data-access/src/lib/resource/resource-form-store.ts`) and `ResourceForm`
  (`ui/src/lib/resource/resource-form.ts`). The route factory is
  `feature-resource/src/lib/routes.ts`: `new` and `:id` mount
  `descriptor.editor ?? ResourceFormPage`.
- **It has five subclasses and two pages that embed it**: `ItemFormPage`,
  `SupermarketFormPage`, `LocationFormPage`, `PriceFormPage` and `PriceRuleForm` extend it,
  and `BrandDetailPage` and `ProductGroupDetailPage` draw `<lib-resource-form-page />`. So
  the old form cannot be deleted here. Plans `0054` to `0060` take its users away one at a
  time.
- **The resources this plan moves** are the ones whose rows open the generic form with no
  page of their own around it:

  | Resource | Where its form is mounted today |
  | --- | --- |
  | `categories` | `/products/categories/new` and `/:id`, through `resourceFormBranch` |
  | `price-scopes` | `/chains/:chainId/scopes/new` and `/:id`, through `resourceFormBranch` |
  | `sections` | `/chains/:chainId/sections/new` and `/:id`, through `resourceFormBranch` |
  | `location-items` | `/chains/:chainId/shops/:shopId/products/new` and `/:id`, through `resourceFormBranch` |
  | `memberships` | `…/zones/:zoneId/members/:id`, by hand in `feature-people/src/lib/shoppers-routes.ts` |
  | `list-lines` | `…/lists/:listId/lines/:id`, by hand in the same file |

- **What the old page knows and the new one must keep**: the parent that the address names
  (`parentsFromRoute`, and `RESOURCE_ID_FROM` for an ID on a route above), a create form
  filled from the query string (`_prefill`), `ResourceChanges.wrote(name)` after a write,
  `errorFields` and `errorLinks`, the stray errors of the server, and `caution`.
- **Reading one record** is `readRecordById` of plan `0051`
  (`data-access/src/lib/resource/read-record-by-id.ts`). It answers the row, or `null` for
  "no record has this ID".
- **The header** is `PageHeader` (`ui/src/lib/page/page-header.ts`). Its `pageMoreAction`
  slot is a row of buttons on a wide screen and a menu on a phone.
- **No guard exists.** The app has no `canDeactivate` and no `beforeunload` handler.
- The app has one locale file: `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Target state

1. **A record opens to be read.** At `:id` the page draws the header, the sections of
   `recordLayout(descriptor, 'read')` and the Record block. Every value is a
   `lib-field-value`. Nothing on the page is a control, and nothing writes.
2. **"Edit" turns the same page into a form.** Each value becomes its control in the same
   row, so nothing moves. The header shows the state "Editing" and loses "Edit" and the
   More menu. A field the form cannot change is a `lib-locked-value`.
3. **One bar holds Save and Cancel**, and it says the state of the form. Section 3 gives
   the six states. Save is off until something changed.
4. **A changed field says "Changed"** beside its label until the save.
5. **A save goes back to reading.** The page reads the saved row, and one line under the
   header says "Saved at 12:04." A screen reader hears it.
6. **Adding uses the same page**, at `new`. The heading is "New product". Fields the system
   fills in are not drawn. The parent that the address names is a locked value. A required
   field has a star, and the bar counts the required fields that are still empty. Defaults
   are filled in.
7. **After a new record is saved the app opens it**, in reading mode, with one line:
   "Product added." and the link "Add another product". A descriptor that says
   `afterAdd: 'list'` goes back to the list.
8. **A refusal is said where it belongs.** A refusal about a field is under that field, and
   the bar counts the fields that need a look. A refusal about no field is one line above
   the first section, with a link when `errorLinks` names a row. What was typed stays.
9. **Every action that is not Edit is in the More menu.** Actions that destroy come last,
   under a line, in red. On a phone the menu is a sheet. A delete always asks first.
10. **Leaving with changes asks first.** The back link, a tab, the rail, a link in the page,
    Cancel and the Back button of the browser all ask "Leave without saving?". Closing the
    tab or reloading it gets the question of the browser.
11. **Four page states**: loading, not found, no answer, and nothing yet (section 4).
12. **The Record block** holds when the record was made and changed, by whom when the row
    says so, the fields of `facts.also`, and the ID as `lib-record-id`. It sits beside the
    sections when the page is 60 rem wide or more, and after them when it is not.
13. **The six resources of Context open on this page.** Their `new` and `:id` routes mount
    `RecordPage`. No descriptor needs a `record` block for that: without one the page has
    one section.
14. **The old form still serves its other users**, unchanged, and nothing new may start to
    use it.

### Scope

- In: `feature-resource/src/lib/` (new `record-page.ts`, `record-view.ts`,
  `record-leave-guard.ts`, and `routes.ts`, `resource-route-data.ts`, `index.ts`),
  `data-access/src/lib/resource/record-store.ts` (new), `ui/src/lib/page/page-header.ts`,
  the barrel of `ui` (the parts this plan reads), `feature-people/src/lib/shoppers-routes.ts`
  (the two routes of Context), `en.json`, and one new spec in
  `apps/luna-shopper-admin/src/app`.
- Out: every page written by hand and every subclass of `ResourceFormPage`, the descriptors
  (no `record` block is added here), the lists, the gateway, `openapi.json` and
  `wire-types.ts`.

### Constraints

- The page is built from the twelve parts and from `PageHeader`, `PageTabs`,
  `PopoverSheet`, `InfoButton`, `CautionLine` and `ConfirmDialog`. It draws no control of
  its own.
- The whole page is edited at once. One Save, one answer from the gateway, one bar.
- A switch never writes while the page reads. No value on a reading page is a control.
- Delete has no section at the foot of the page. It lives in the More menu and nowhere
  else.
- The bar of the app stays on a phone while a form is open.
- Under counting is the safe side for the leave question: when the page cannot tell
  whether something changed, it asks.
- A read that failed is never drawn as "not found", and "not found" is never drawn as an
  empty record.
- No text in a template, no svg in a component, nothing imports
  `@angular/core/rxjs-interop`, inline `template` and `styles`.
- No motion.

### Action boundaries

- Do not change or delete `ResourceFormPage`, `ResourceForm` or `ResourceFormStore`. Do not
  move any of their seven users. Plans `0054` to `0060` do that.
- Do not add a `record` block to a descriptor. Each record gets its sections in the plan
  that moves it.
- Do not change a gateway route. If the page needs something the gateway does not serve,
  name it in the pull request.
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk saves and deletes, so it
  needs a Luna slot of your own. Claim one with `luna-slot.sh --up`, and give it back with
  `--down` when the walk is done.
- Stop and ask before you add a dependency.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/models`,
  `luna-shopper-admin/data-access`, `luna-shopper-admin/ui`,
  `luna-shopper-admin/feature-resource`, `luna-shopper-admin/feature-catalog`,
  `luna-shopper-admin/feature-people` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green. The pull request checks never build this app.
- The browser walk of section 7, at 1360 px and at 390 px, with screenshots of each state
  of the bar.

## 1. Not in this plan

- Tabs, panels and links for the collections of a record. That is `0054`. A page of this
  plan has no tabs.
- The records that have a page of their own: the brand, the product, the product group,
  the chain, the shop, the zone, the person, the list, the shopping list and the chain
  source (`0054` to `0059`).
- The price rule form and the price form (`0060`).
- Who made or changed a record. The line is drawn when a row carries the value, and no row
  of the six resources carries one today. Section 6 names the backend work.
- The page as a pane of a split screen. The page already lays itself out by its own width
  (target 12), and `0056` is the first plan that mounts it in a pane.

## 2. The pieces

### 2.1 `RecordStore`

`libs/luna-shopper-admin/data-access/src/lib/resource/record-store.ts`. A plain class, like
`ResourceFormStore`, built by the page.

```ts
export type RecordStatus = 'loading' | 'ready' | 'missing' | 'error';

export class RecordStore<T extends ResourceRow> {
  constructor(
    descriptor: ResourceDescriptor<T>,
    gateway: ResourceGateway<T>,
    /** `null` for a record that does not exist yet. */
    id: string | null,
    /** Values a new record opens with. Ignored when `id` is not `null`. */
    prefill?: ResourceDraft
  );

  readonly mode: Signal<RecordMode>;
  readonly status: Signal<RecordStatus>;
  readonly row: Signal<T | null>;
  readonly draft: Signal<ResourceDraft>;
  /** The failure of the last read or the last save. */
  readonly error: Signal<GatewayError | null>;
  readonly busy: Signal<boolean>;
  /** The names of the fields that differ from what was read. */
  readonly changed: Signal<readonly string[]>;
  /** The required fields that are still empty. */
  readonly missing: Signal<readonly string[]>;
  /** The fields that carry a refusal, after a save that was refused. */
  readonly invalid: Signal<readonly string[]>;
  readonly bar: Signal<SaveBarState>;
  /** When the last save went through, or `null`. */
  readonly savedAt: Signal<Date | null>;
  readonly strayErrors: Signal<readonly string[]>;

  messagesFor(name: string): readonly FieldMessage[];
  load(): Promise<void>;
  /** From `read` to `edit`. The draft starts from the row. */
  edit(): void;
  /** From `edit` to `read`. The draft is thrown away. */
  cancel(): void;
  set(name: string, value: DraftValue): void;
  /** The saved row, or `null` when nothing was saved. */
  submit(): Promise<T | null>;
  /** `true` when the record was deleted. A refusal is in `error`. */
  remove(): Promise<boolean>;
}
```

- `mode` is `create` when `id` is `null`. If not, it is `read` until `edit()`.
- `load()` reads through `readRecordById`. `null` is `missing`. Any other failure is
  `error`.
- It uses `draftFor`, `validateDraft`, `changedFields` and `toInput` of `models`. It adds
  no rule of its own about what a value means.
- After a save in `edit`, `row` is the saved row, `mode` is `read` and `savedAt` is now.
  After a save in `create` the store changes nothing, because the page leaves.
- `bar` follows this table. The first row that fits wins.

  | When | `bar` |
  | --- | --- |
  | a save is on its way | `saving` |
  | the last save was refused about fields, and none of them was changed since | `invalid`, with their count |
  | the last save was refused about no field, and nothing was changed since | `refused` |
  | `create`, and a required field is empty | `missing`, with their count |
  | nothing differs from what was read | `clean` |
  | otherwise | `dirty`, with the count of `changed` |

### 2.2 `RecordView`

`lib-record-view`, in `feature-resource/src/lib/record-view.ts`. The body of the page: the
lines, the sections, the Record block and the bar. It has no header, so that a later plan
can put it in a tab or in a pane.

| Input | Type | Says |
| --- | --- | --- |
| `descriptor` | `AnyResourceDescriptor` | |
| `store` | `RecordStore<ResourceRow>` | |
| `parents` | `KnownParents`, default `{}` | The rows above this one that the address names. |
| `added` | `boolean`, default `false` | Draw the line "added", with "Add another". |

Outputs: `cancel` (the operator pressed Cancel), `saved` (with the row), `addAnother`.

- The order from the top: the line "Saved" or "added", the lines of `descriptor.notices`,
  the caution (only while the page is a form), the refusal about no field, the stray
  errors, then the sections with the Record block beside or after them, then the bar (only
  while the page is a form).
- It resolves the name of every reference of the record through `ResourceReferences`,
  whatever `nameLookup` says. One record is a handful of reads. A list is not, and the rule
  of plan `0023` still holds there.
- A reference is a link when `ResourceRegistry` knows a page for its target.
- While `status` is `loading` it draws the sections of the descriptor with their labels,
  and `lib-field-row` with `loading` for each value.
- While the save is on its way every control is off.
- "Go to the first" of the bar puts the focus on the first control of `store.invalid()`,
  in the order of the page. Below 48 rem the view does that by itself after a refused save.

### 2.3 `RecordPage`

`lib-record-page`, in `feature-resource/src/lib/record-page.ts`. The route component: the
header, the More menu, the questions and where the app goes.

It reads the route as `ResourceFormPage` does: `RESOURCE_DESCRIPTOR`, `RESOURCE_FORM_MODE`
(`'create'` or absent), `RESOURCE_ID_FROM`, the parents of the address and the query string
of a create.

| Mode | Heading | States | Controls of the header |
| --- | --- | --- | --- |
| read | `descriptor.title(row)` | `descriptor.rowStates` | info, "Edit", More |
| edit | the same | "Editing" | info |
| create | `resource.form.create` with the noun: "New product" | none | info |

- The back link names the list: "Brands". It leads to the list, or to the row above when
  the resource has a `parent`. It is a link (`backLink`), so the leave guard is what asks.
- "Edit" is drawn when `actions.edit` is true and at least one field can be changed.
- `?edit=1` in the address opens the page as a form. The page takes the parameter out of
  the address at once, with `replaceUrl`. The mode is otherwise a state of the page and not
  of the address: a reload of a form comes back reading.
- After a save in `create`: `ResourceChanges.wrote(name)`, then the app goes to the new
  record with the navigation state `{ added: true }`, or to the list for
  `afterAdd: 'list'`. The line is drawn once. A reload does not draw it again.
- After a save in `edit`: `ResourceChanges.wrote(name)`, and the page stays.
- While the page reads, it reads the record again when `ResourceChanges.version(name)`
  changes. Another screen that wrote the resource says so there. A form is never read
  again under the operator.

### 2.4 The More menu

`PageHeader` gains two inputs:

| Input | Type | Says |
| --- | --- | --- |
| `overflow` | `'row' \| 'menu'`, default `'row'` | `'menu'` puts every `pageMoreAction` in the More menu at every width. `'row'` is what the header does today. |
| `moreLabel` | `string \| null`, default `null` | The accessible name of the button: "More actions for Hacendado". |

It gains one slot, `[pageMoreDanger]`, drawn after a line.

- With `overflow="menu"` the button is `more-icon` with `aria-haspopup="menu"` and
  `aria-expanded`. The list has `role="menu"` and each button in it `role="menuitem"`.
  Arrow Down and Arrow Up move and wrap, Escape closes and puts the focus back on the
  button, and a press outside closes.
- At 48 rem and above the menu is a panel 264 px wide under the button. Below 48 rem it is
  a `PopoverSheet` from the bottom, and a row is 48 px high.
- The record page fills it in this order: each named action whose `available(row)` is not
  false and that has no `danger`, then the line, then each named action with `danger`,
  then "Delete this brand" when `actions.delete` is true. An action with `danger` is in
  `--admin-danger`, with `trash-icon` when it is the delete.
- A menu with no entry is not drawn.

### 2.5 The questions

All three are `ConfirmDialog`. If the dialog has no input for the words of the button that
dismisses, add one (`dismissKey`).

| Question | Heading | Body | Buttons |
| --- | --- | --- | --- |
| Leave with changes | "Leave without saving?" | "You changed 2 fields of Hacendado. They are lost if you leave." | "Leave and lose them" (danger), "Stay here" (primary, and it has the focus) |
| Delete | "Delete the brand Hdo.?" | "This cannot be taken back." | "Keep it", "Delete Hdo." (danger) |
| A named action with `confirm` | its own three keys | its own | its own |

- A delete that goes through: `ResourceChanges.wrote(name)`, then the list.
- A delete that is refused: a dialog with the heading "Hacendado cannot be deleted", the
  sentence of the error, the link of `errorLinks` when the code has one ("See the 212
  products"), and "Close".
- A delete that takes other rows with it is a named action with `danger`, its own `confirm`
  and `after: 'leave'`, as the zone and the account already declare theirs. Its question
  then says what goes with it.
- A named action that goes through reads the record again (`after: 'reload'`) or goes to
  the list (`after: 'leave'`). One that fails draws its refusal as the line above the
  first section.

### 2.6 The leave guard

`recordLeaveGuard` in `feature-resource/src/lib/record-leave-guard.ts`:

```ts
export interface LeaveAware {
  /** Answers `true` when the route may be left. It may ask the operator first. */
  canLeave(): boolean | Promise<boolean>;
}

export const recordLeaveGuard: CanDeactivateFn<LeaveAware>;
```

- The route factory puts it on every route that mounts `RecordPage`.
- `RecordPage.canLeave()` answers `true` at once when nothing changed. If something
  changed, it opens the question and answers what the operator chose.
- Cancel in the bar asks the same question when something changed, and then calls
  `store.cancel()`.
- While something changed, the page holds a `beforeunload` handler, so the browser asks
  before the tab closes or reloads. It takes the handler away when the form is clean.
- A refused navigation from the Back button must leave the history as it was. Check it in
  the walk. If the address and the page disagree after "Stay here", set
  `canceledNavigationResolution: 'computed'` in the router of the app and say so in the
  pull request.

### 2.7 The routes

In `feature-resource/src/lib/routes.ts`:

- `resourceFormRoutes` mounts `RecordPage` at `new` and at `:id` for a descriptor with no
  `detail` and no `editor`, with `canDeactivate: [recordLeaveGuard]`. A descriptor with
  either keeps the route it has today.
- A new exported function, `recordRoute(descriptor, options)`, answers one route for a
  caller that mounts by hand:

  ```ts
  export function recordRoute(
    descriptor: AnyResourceDescriptor,
    options: {
      readonly path: string;
      readonly mode?: 'create';
      /** The route parameter that holds the ID, when it is on a route above. */
      readonly idFrom?: string;
    }
  ): Route;
  ```

  `feature-people/src/lib/shoppers-routes.ts` uses it for `memberships` and `list-lines`.
  The `edit` routes of the zone, the person and the list keep the old form until `0057`
  and `0058`.

## 3. The bar, state by state

| State | When | What the operator sees |
| --- | --- | --- |
| Nothing changed yet | the form just opened | "No changes yet", Save off |
| Something changed | one field or more differs | "2 unsaved changes", Save on |
| Required fields are empty | a new record | "* Required. 2 required fields are still empty.", "Add product" off |
| Saving | after Save | "Saving…", every field and both buttons off |
| Refused by fields | the gateway or the rules of the app refused values | "Not saved. 2 fields need a look." and "Go to the first". Each field says why under itself. |
| Refused by the gateway | a refusal about no field | "Not saved. Your changes are still here." and the line above the first section |
| Saved | the save went through | no bar. The page reads, and one line says "Saved at 12:04." |

On a phone the bar is 60 px, just above the 58 px bar of the app. Both stay, and together
they take 118 px of 844. The bar has no words there: Save carries the count, "Save 2
changes", and a refusal moves the page to the first field that was refused.

## 4. The page states

| State | Heading | What is drawn |
| --- | --- | --- |
| Loading | a grey bar in place of the name | The header, the back link, the section frames and the labels at once. Only the values wait. The page has `aria-busy`, and a line for a screen reader says "Loading the brand". |
| Not found | "Brand not found" | "This brand is not here. It was deleted, or the link is old." and one button, "Go to Brands". |
| No answer | the noun: "Brand" | One refused line: "The gateway did not answer, so this brand could not be read." and "Try again". No section is drawn, so nothing can be taken for the record. |
| Nothing yet | the name | An empty value reads "None". |

## 5. Specs

| Spec | Proves |
| --- | --- |
| `data-access/.../record-store.spec.ts` | Each row of the `bar` table. `load` for a row, for `null` and for a failure. `edit` and `cancel`. A save that goes through in each mode. A refused save keeps the draft. `remove`. |
| `feature-resource/.../record-view.spec.ts` | Reading draws no `input`, `select`, `textarea` or `role="switch"`. The same rows in the same order while reading and while changing. The locked value and each of its four reasons. "Changed". The loading frame. The order of the lines. Every reference is resolved. The focus after "Go to the first". |
| `feature-resource/.../record-page.spec.ts` | The header in each mode. `?edit=1`. Where the app goes after a save in each mode, and for `afterAdd: 'list'`. The line "added" once. The four page states. The order of the More menu, and no menu when it is empty. The three questions. A refused delete with its link. `after: 'leave'`. |
| `feature-resource/.../record-leave-guard.spec.ts` | Clean leaves at once. Changed asks. "Stay here" keeps the route and the draft. "Leave" lets the navigation through. The `beforeunload` handler is there only while something changed. |
| `feature-resource/.../routes.spec.ts`, extended | A descriptor with no `detail` and no `editor` gets `RecordPage` and the guard at `new` and `:id`. A descriptor with either keeps its component. |
| `ui/.../page/page-header.spec.ts`, extended | `overflow="menu"`: the roles, the keys, the focus after Escape, the danger slot after the line, the sheet below 48 rem. `overflow="row"` is as before. |
| `apps/.../no-new-old-form.spec.ts` (new guard) | The files that import `ResourceFormPage`, `ResourceForm` or `ResourceFormStore` are a list written in the spec. A file that is not in the list fails. An entry that no longer imports one fails too, so the list can only shrink. Plan `0060` deletes the spec with the last entry. |

`people-screens.spec.ts`, `catalog-screens.spec.ts` and `actions-declared-once.spec.ts`
read the forms of the six resources. Change what they assert about the old form to what
the new page draws, and keep every case.

## 6. What the gateway does not serve yet

- **Who made a record and who changed it.** No view of a catalog table or of the harvester
  carries a person, and most catalog views carry no date: `CatalogItemView`,
  `CatalogSupermarketView`, `CatalogSupermarketLocationView`,
  `CatalogSupermarketSectionView` and `CatalogPriceScopeView` have neither `createdAt` nor
  `updatedAt`, though every one of those tables has both columns. The page draws each line
  only when the row carries the value, so it needs no change when a view gains one. A
  backend plan decides which views get the dates and which tables get a person. It is not
  written yet. The three audit tables (`CatalogAudit`, `CoreAudit`, `AuthAudit`) already
  hold an actor for each write, and that plan starts there.
- **A read by ID for price scopes** (plan `0051`, section 5). `readRecordById` walks the
  collection for them, as it does today. The page of a price scope works for a scope the
  walk reaches.

## 7. The walk

On a front end slot and a Luna slot of your own, at 1360 px and at 390 px.

At both widths:

- A category opens to be read. No control on the page. The Record block is beside the
  sections at 1360 px and after them at 390 px. The ID copies.
- "Edit": no row moves. Change the name: "Changed", "1 unsaved change", Save on. Save:
  the page reads, and it says "Saved at" with the time.
- Empty a required field and save: the sentence under the field, the count in the bar, and
  "Go to the first" puts the focus in the field.
- Add a section of a chain: the chain is a locked value, the bar counts the empty required
  fields, "Add section" is off until they are filled. After the save the new section is
  open, reading, with "Section added." and "Add another section".
- A price scope: "Make default" is in the More menu. Delete asks first and names the
  scope.
- Delete a category that holds products: the refusal names the reason and links to the
  products.
- Change a field, then press the back link, an entry of the rail and the Back button of
  the browser. Each asks. "Stay here" keeps the text. Then reload the tab: the browser
  asks.
- An ID that no record has: "not found" and the way to the list. With the Luna slot
  stopped: "no answer" and "Try again".
- A slow read (throttle the network): the frame and the labels are there before the
  values.
- Tab reaches every control with a ring that can be seen. Escape closes the More menu and
  the focus is on its button.

At 390 px also:

- The header is 48 px and scrolls away. "Edit" is in the header and the other actions are
  in the More sheet.
- The save bar sits above the bar of the app, both stay, and together they are 118 px.
  Save says "Save 1 change".
- A refused save moves the page to the first refused field.
- A picker opens as a sheet.
- No sideways scroll.

## 8. Decisions made

From the mock, which the owner approved on 2026-10-05:

- **Reading comes first.** A record is read many more times than it is changed, and a page
  that is always a form can be changed by accident.
- **The whole page is edited at once**, and not one section at a time. A section at a time
  means several bars and a record that can be half saved.
- **Save and Cancel live in one bar at the foot of the page and nowhere else.**
- **After a new record is saved the app goes to the new record**, in reading mode, with
  "added" and "Add another". The next step is usually on that record. Until this plan the
  app went back to the list.
- **Every action that is not Edit lives in the More menu.** The header keeps to two
  controls and the info button.
- **Delete has no section of its own.** One place for every action is easier to learn, and
  a red button that is always on the page gets pressed by mistake.
- **A delete always asks first**, names the record and says what goes with it. A refusal
  says why and links to the rows that hold the record.
- **A switch never writes while the page reads.**
- **The bar of the app does not hide on a phone while a form is open.** It would give
  58 px and take away the way out.
- **Who made and who changed a record is drawn only when the row carries it.**

Decisions this plan made, for the owner to confirm:

- **The mode is not in the address.** A reload of a form comes back reading, and the
  browser asks before the reload when something changed. `?edit=1` exists so that another
  screen can link straight to the form.
- **Cancel asks too, when something changed.** The mock lists the back link, a tab and the
  rail. One press on Cancel can throw away thirty fields, and the question costs one press
  when it was meant.
- **The whole ID is drawn.** The mock cuts it in the middle. Plan `0051` drew
  `lib-record-id` whole, because half an ID copied by hand finds nothing, and this page
  uses that component.
- **A page with no `record` block has one section.** The six resources of this plan get no
  block here, so their fields come in the order of the descriptor. Each can get sections
  later in one small change.
- **The More menu of the other pages is not changed.** Their `pageMoreAction` buttons stay
  a row on a wide screen until each page moves onto this one.

## 9. What this plan adds, and what it deletes

Adds `RecordStore`, `RecordView`, `RecordPage`, `recordLeaveGuard`, `recordRoute`, the two
inputs and the slot of `PageHeader`, the exports of the parts that the page reads, and the
keys under `record.*` that the page draws.

Deletes nothing but the uses: the six resources stop opening `ResourceFormPage`. The
component, its form and its store stay for their seven other users, and
`no-new-old-form.spec.ts` holds the list.
