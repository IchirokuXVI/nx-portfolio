# 0060 The old form goes

> Last plan of the record page series (`0052` to `0060`). Needs `0053` to `0058`, all
> merged. Plan `0059` (the chain source) shares no file with this one and can come before
> or after.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are `Parts`
> and `Save-States`: the two forms that are left are built from the same parts.

When plans `0053` to `0058` are in, the old form has two users left. Both are subclasses
of `ResourceFormPage`, and neither is a page: the form of a price rule opens inside a row
of the price rules, and the form of a new price opens in a panel beside the prices of a
product. This plan moves those two onto the parts of the record page, and then deletes the
old form, its store and its component.

## Brief for the agent

### Objective

Rebuild the price rule form and the price form on `RecordStore` and the parts of plan
`0052`. Then delete `ResourceFormPage`, `ResourceForm` and `ResourceFormStore`, and add the
guard that keeps a record from getting a page of its own again. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui` and
`antislop-human` skills.

### Context

- **`apps/luna-shopper-admin/src/app/no-new-old-form.spec.ts`** (plan `0053`) holds the
  list of the files that still import the old form. Read it first. It must name only the
  two files below and the old form's own files. If it names another one, a plan before
  this one is not finished: stop and say which.
- **`PriceRuleForm`** is in `feature-catalog/src/lib/products/price-rules-page.ts`, beside
  `PriceRulesPage`. A row of the price rules opens, and its `<router-outlet>` holds the
  form at the child route `:id`. The form draws no header and only the fields that can be
  changed (`priority`, `maxAgeDays`). Save and Cancel both close the row. The switch on
  the row turns a rule on and off by itself (plans `0043` and `0049`). `PRICE_POLICIES` has
  a `caution`.
- **`PriceFormPage`** (`feature-catalog/src/lib/price-form-page.ts`, 590 lines) is the
  `editor` of `PRICES`, mounted only as `/products/:productId/prices/new`. It adds a price
  and never changes one. It has controls of its own: the picker of a chain and then a
  scope, a notice that says the kind of the scope and how many shops share it, a proposal
  for the price of one unit that the operator may take, and a check on the day the price
  was seen. Plan `0005` says why a price is the one form that the generic form gets wrong.
- **`POSTAL_CODES`** has `editor: PostalCodeAddPage` and `detail: PostalCodeDetailPage`
  (`feature-harvest`). Neither uses the old form.
- **The route factory** (`feature-resource/src/lib/routes.ts`) still mounts
  `descriptor.editor ?? ResourceFormPage` for a descriptor with a `detail` or an `editor`.

### Target state

1. **The form of a price rule is `RecordView`** inside the open row. It opens as a form at
   once, because the row was opened to change the rule. It has the caution line, the two
   fields, and the save bar. Save and Cancel close the row. Leaving the row with changes
   asks first.
2. **The form of a new price is built from the parts.** Each field is a `lib-field-row`
   with a `lib-field-control`, the save is a `lib-save-bar`, and the state is a
   `RecordStore` in `create`. The scope picker, the notice, the proposal and the check on
   the day stay, and they do what they do today.
3. **After a price is added** the panel closes and the Prices tab shows it, as today.
   `afterAdd` is `'list'` for a price: a price has no page to open.
4. **`ResourceFormPage`, `ResourceForm` and `ResourceFormStore` do not exist.** No file
   imports them, and no key of `en.json` is left that only they read.
5. **The route factory mounts `RecordPage`** for every descriptor with no `editor` and no
   `detail`, and has no other default.
6. **A guard holds the exceptions.** A spec lists the descriptors that still set `editor`
   or `detail`: `prices` (`editor`) and `postal-codes` (both). A third one fails the spec,
   and the list can only shrink.
7. **The comments say what is true.** The doc comments of `ResourceDescriptor.detail` and
   `editor`, of `resourceRoutes` and of `FormMode` describe the record page and no longer
   the generic form.

### Scope

- In: `feature-catalog/src/lib/products/price-rules-page.ts`, `price-form-page.ts`,
  `price-policies.ts`, `prices.ts`, `feature-resource/src/lib/` (`resource-form-page.ts`
  and its spec deleted, `routes.ts`, `index.ts`), `ui/src/lib/resource/resource-form.ts`
  and its spec (deleted) and the barrel of `ui`,
  `data-access/src/lib/resource/resource-form-store.ts` and its spec (deleted) and its
  barrel, `models` (comments, and what only the old form read), `en.json`,
  `apps/.../no-new-old-form.spec.ts` (deleted) and one new spec beside it, and
  `apps/luna-shopper-admin/plans/mocks/README.md` if a board name changed.
- Out: the price rules list and its row switch, the Prices tab, the scope picker, the
  postal code pages, the gateway, `openapi.json` and `wire-types.ts`.

### Constraints

- A price is still stored as it is typed. No field is worked out from another one. The
  proposal for the price of one unit is offered and never written by itself.
- The price rule's switch on the row stays the one place that turns a rule on and off.
  The form does not get the field back.
- The price form adds a `RecordStore` and parts. It adds no part of its own to `ui`.
- Delete, and do not keep for later. A helper that only the old form called goes with it.
- `no-unused-public-export.spec.ts` and `no-unread-translation-key.spec.ts` stay green.

### Action boundaries

- Stop if the list of `no-new-old-form.spec.ts` names a file that this plan does not own.
  Do not move that file here.
- Do not change a gateway route or a DTO.
- Do not move the postal code pages onto the record page (section 1).
- Do not start, stop or migrate Luna slot 0, 1 or 3. The walk adds a price and changes a
  rule, so it needs a Luna slot of your own, given back with `--down`.

### Progress evidence

- `npx nx run-many --target=lint,test` is green for every project whose name starts with
  `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green. Only the build checks types, and this plan
  deletes three classes that many files once read.
- A search of the workspace for `ResourceFormPage`, `ResourceForm\b`, `ResourceFormStore`
  and `lib-resource-form` finds nothing outside the plans.
- The browser walk of section 3, at 1360 px and at 390 px.

## 1. Not in this plan

- **The postal code pages.** A postal code is keyed by the code and not by an ID. Its
  page only reads, from four reads that each fail alone, and its "editor" adds many codes
  at once and reports on each. Neither is a record that is read, changed and added, so
  the record page gives them nothing. They stay the two named exceptions of the guard.
- **The admin accounts.** That screen is a list that only reads.
- **A More menu for the pages that are not records.** The headers of the queues, the
  runs and the overview keep their row of actions.

## 2. The two forms

### 2.1 The price rule

- `PriceRuleForm` stops extending anything. It builds a `RecordStore` for
  `PRICE_POLICIES` and the ID of the row, calls `load()` and then `edit()`, and draws
  `<lib-record-view>` with that store.
- `PRICE_POLICIES` gets a `record` block with one section that names `priority` and
  `maxAgeDays`. `sourceKind` is the ID of a rule and the heading of its row, so it is in
  no section.
- `RecordView` draws the Record block after the sections. A rule in a row needs none.
  Give `RecordView` one input, `facts` (a boolean, `true` when left out), and the row
  passes `false`.
- `saved` and `cancel` of the view both go to `['..']`, which closes the row. Say
  `ResourceChanges.wrote('price-policies')` after a save, as today.
- The child route `:id` gets `canDeactivate: [recordLeaveGuard]`, and the form implements
  `LeaveAware`.
- The bar of a row does not stick to the bottom of the window. Give `SaveBar` one input,
  `sticky` (`true` when left out), and the row passes `false`.

### 2.2 The price

- `PriceFormPage` stops extending anything. It keeps its template and its side reads.
- Its state is a `RecordStore` in `create`, with the product from the address as the
  prefill. The check on the day stays where it is, in front of `submit()`.
- Each row is a `lib-field-row`. The fields that the generic switch can draw go through
  `lib-field-control`. The scope picker and the notice stay the form's own, inside a
  `lib-field-row`, so that the label, the star and the refusal sit where they sit in
  every other form.
- The bar is a `lib-save-bar` with the state of the store, not sticky, and "Add price".
- The panel has no header of its own, as today. Leaving it with changes asks, through
  `recordLeaveGuard` on its route.
- It stays the `editor` of `PRICES`.

## 3. Specs, and the walk

| Spec | Proves |
| --- | --- |
| `products/price-rules-page.spec.ts` | The row opens a form, not a reading page. The caution. The two fields and no "Enabled". Save and Cancel close the row. A refusal stays in the row. Leaving with changes asks. |
| The spec of the Prices tab | Every case about the price form that exists today, over the new form: the scope picker, the notice, the proposal that is offered and not written, the day that is refused, the save. |
| `apps/.../no-page-outside-the-record-page.spec.ts` (new guard) | The descriptors that set `editor` or `detail` are `prices` and `postal-codes`. A third fails. An entry that no longer sets either fails too. |
| `feature-resource/.../routes.spec.ts` | The factory has one default, `RecordPage`. |
| `ui/.../record/save-bar.spec.ts`, `feature-resource/.../record-view.spec.ts` | `sticky` and `facts`. |

The specs of the three deleted files are deleted with them. Before that, read each case
and make sure that `record-store.spec.ts`, `record-view.spec.ts` or `record-page.spec.ts`
holds the same behavior. List in the pull request any case that has no new home.

The walk, on slots of your own, at 1360 px and at 390 px:

- Price rules: open a row. The form is there at once, with the caution. Change the
  priority, save: the row closes and the list shows the new value. Open it again, change
  a value and press another row: the page asks.
- A product, Prices, "Add a price": pick a chain and a scope, and the notice says how
  many shops share it. Type a price: the proposal for one unit is offered and the field
  stays as it is until it is taken. A day in the future is refused under its field. Save:
  the panel closes and the price is in the tab.
- One record of each kind that the series moved, opened once, to see that nothing broke
  when the old form went: a category, a brand, a product, a shop, a zone, a list.
- At 390 px: the price form as a sheet, with its bar inside the sheet.

## 4. Decisions made

From the mock, approved on 2026-10-05:

- **Twelve parts and no others.** The two forms that are not pages are built from them
  too.
- **Save and Cancel live in one bar.**
- **A switch never writes while the page reads.** The price rules list is not a record
  page, and its row switch stays (plans `0043` and `0049`).

Decisions this plan made, for the owner to confirm:

- **A price rule opens as a form at once.** The rule of the series is that a record opens
  to be read. A row that was opened with "Change" is already an answer to "do you want to
  change this", and a second press on "Edit" inside the row would only be in the way.
- **The price form keeps its own layout.** It is the `editor` of `PRICES`, on purpose
  (plan `0005`), and it is not drawn by `RecordView`.
- **`editor` and `detail` stay in the contract**, for the two named exceptions. The guard
  is what keeps a third from being added without a decision.
- **The postal code pages do not move.**

## 5. What this plan deletes

- `feature-resource/src/lib/resource-form-page.ts` and `resource-form-page.spec.ts`.
- `ui/src/lib/resource/resource-form.ts` and `resource-form.spec.ts`, with `ResourceForm`
  and `FieldChange` in the barrel of `ui`, unless `RecordView` reads `FieldChange`.
- `data-access/src/lib/resource/resource-form-store.ts` and its spec.
- `apps/luna-shopper-admin/src/app/no-new-old-form.spec.ts`.
- The `ResourceFormPage` default of `routes.ts`, and `resourceCreateRoute` and
  `resourceFormBranch` if `recordRoute` replaced their last caller.
- In `models`: `FormMode` if `RecordMode` replaced its last reader, and
  `hasDetailScreen`'s mention of the generic form.
- The keys `resource.form.*` and `resource.confirm.discard.*` that nothing reads any
  more.
