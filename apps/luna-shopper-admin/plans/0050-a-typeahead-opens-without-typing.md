> **PR:** [#633](https://github.com/IchirokuXVI/nx-portfolio/pull/633)

# 0050 A typeahead opens without typing

> Needs `0041` to `0047`, all merged. Plan `0049` (other defects of the walk) is built beside
> this one and shares no file with it. Plan `0051` (a search accepts a record ID) is built on
> top of this one.

The owner walked the remodel on 2026-10-04 and asked for two changes to form controls. A
typeahead shows its options from an arrow, the way a select does. The arrow of a select
stops touching the edge of its box.

## Brief for the agent

### Objective

Make `ReferencePicker` in `libs/luna-shopper-admin/ui` a combobox: one text field with the
arrow of a select on its right edge, and a list that opens under it without typed text. Draw
the arrow of every select from the global control rule, so that both arrows sit at the same
distance from the edge. Use the `nx-portfolio-angular-developer`, `antislop`, `antislop-ui`
and `antislop-human` skills.

### Context

- There is one typeahead in the app: `ReferencePicker`
  (`libs/luna-shopper-admin/ui/src/lib/resource/reference-picker.ts`). `FieldControl` draws it
  for a `reference` field. `ResourceFilters` draws it for a `reference` filter.
  `ReferencesControl` draws it under its chips. Thirteen templates in `feature-brands`,
  `feature-catalog` and `feature-harvest` use it directly. Section 2 lists every use.
- Today it has two shapes. With a value it is a line of text with "Change" and "Clear"
  buttons. Without one it is a search box with its list drawn in the page under it. Typing or
  "Change" is what reads the list, so an empty picker says "Nothing matched." before anybody
  typed.
- The other search boxes in the app are not typeaheads, and they stay as they are.
  - The scope picker (`ui/src/lib/catalog/scope-picker.ts`) is a button and a panel in two
    steps.
  - The chain select of the harvester is a real select.
  - Categories, brand suggestions, entries, the import preview and the members of a product
    group each have a plain search over a list.
- "None" already means something in this component. A filter over a column that can be empty
  offers "None". It asks for the rows that point at nothing, and it sends `REFERENCE_NONE`
  (plan `0012`, section 2). That choice stays.
- The global control rule is in `apps/luna-shopper-admin/src/styles.scss`. A select keeps the
  arrow the browser draws, and the browser puts it at the edge of the box whatever the
  padding is. That is the defect the owner saw.
- The app has one locale file: `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Target state

1. **One field.** `ReferencePicker` is always a text field with `role="combobox"`. With a
   value it shows the name the value points at. Without one it shows a placeholder: "Any" in a
   filter, "None" where empty is allowed, "Choose…" where a value is required. The "Change" and
   "Clear" buttons are gone.
2. **The arrow.** A button on the right edge of the field holds a chevron that points down,
   drawn with `ChevronLeftIcon` of `@portfolio/shared/ui` turned a quarter. A click on the
   arrow, a click in the field, Arrow Down, Arrow Up or typing opens the list. A click on the
   arrow of an open list closes it.
3. **The first page without typing.** An open list with no typed text holds the first page
   that `ReferenceLookup.search` answers for an empty term. "Nothing matched." is shown only
   after a read that found nothing.
4. **The empty choice.** While there is no typed text, the list starts with a choice that
   clears the value (it emits `''`). It reads "None" in a form and "Any" in a filter. It is
   offered per use: the `empty` input of the component, and `emptyOption` on a reference field
   and on a reference filter. Section 2 gives the default and every use.
5. **"None" of a filter stays.** A filter whose descriptor says `nullable: true` still offers
   "None", the rows that point at nothing. It comes after "Any", and it goes with typed text.
6. **Keyboard.** Arrow Down and Arrow Up move through the list, and wrap. Enter chooses the
   active option. Escape closes an open list, puts the text back, and does not reach the
   dialog or the panel around it. Tab leaves and closes. Typed text that was not chosen is
   thrown away on blur, and the field shows the value it held.
7. **Screen reader.** The field carries `aria-expanded`, `aria-controls`,
   `aria-autocomplete="list"` and `aria-activedescendant`. The list is a `listbox` of `option`
   elements, and the held value is `aria-selected`. Focus never leaves the field, so there is
   nothing to return. A use that has no `<label for>` passes its visible label as `label`.
8. **A reference that outlived its target** says so in a line under the field, as it does now.
9. **Phone.** The field and every option are 44 px high. The list opens under the field, and
   the page scrolls to show it. **Plan `0052`, section 3.5, replaced this.** Below 48 rem the
   field is a button. The list is a sheet from the bottom edge. The search field is at the
   top of the sheet, and a row is 48 px high.
10. **The select arrow.** The global rule draws the arrow of a select as a background image.
    The arrow sits `--admin-space-3` from the right edge of the box, and the text of the
    select stops before it. The arrow of the typeahead sits at the same distance. Both are
    the same chevron, 20 px (`--admin-caret`), in `--admin-ink-muted`.
11. **One source of options.** Every read of options in the component goes through one
    private method, `_read(term)`. Plan `0051` changes that method and nothing else to make a
    typed record ID select its record.

### Scope

- In: `libs/luna-shopper-admin/ui/src/lib/resource/**`, the `reference` parts of
  `libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts` and
  `resource-descriptor.ts`, `libs/luna-shopper-admin/ui/src/lib/styles/_tokens.scss`,
  `libs/luna-shopper-admin/ui/assets/i18n/en.json`, `apps/luna-shopper-admin/src/styles.scss`,
  one new spec in `apps/luna-shopper-admin/src/app`, and the template of each direct use in
  `feature-brands`, `feature-catalog` and `feature-harvest`.
- Out: the gateway, `openapi.json`, `wire-types.ts`, `ReferenceLookup` and what answers it,
  the scope picker, the chain select, everything plan `0049` names (sign in, the chains
  panel, the harvest lists, the language of the rail, the price rule checkbox), and the
  record ID search of plan `0051`.

### Constraints

- One component. No second typeahead is written, and no use keeps the old shape.
- No svg is written in a component. The arrow of the typeahead is the shared icon. The arrow
  of a select is a CSS background on the global rule, because a select cannot hold a child.
- No text is written in a template. Every new text is a key in `en.json`, and every key the
  change stops reading is deleted, or `no-unread-translation-key.spec.ts` fails.
- `ReferenceLookup` keeps its two methods and their meaning.
- A value is changed only by choosing an option. Emptying the text does not clear the value.
  Under counting is the safe side here: a field cleared by a slip of the hand in a form is
  a saved null.
- Text and edges keep the contrast `0041` proved: `--admin-ink-muted` on the raised surface
  for a placeholder and the arrow, and the wash with its own ink for the active option.

### Action boundaries

- Do not change a gateway route. If a route refuses an empty term, its picker has no first
  page. Name the resource in the pull request and leave the route.
- Do not start, stop or migrate Luna slot 0, 1 or 3. Do not save a form on a backend that is
  not yours.
- Do not build plan `0049` or plan `0051`.

### Progress evidence

- `npx nx test` and `npx nx lint` are green for `luna-shopper-admin/models`,
  `luna-shopper-admin/ui`, each touched feature library and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green. The pull request checks never build this app.
- A browser walk at 1280 px and at 390 px: the Product group and Order filters of Products,
  one form with a required reference, one picker of the harvester. The pull request says
  what was walked and what was not.

## 1. Not in this plan

- A typed record ID that selects its record (plan `0051`).
- A second page of options. The list holds what one read answers. An operator who does not
  see the row types a part of its name.
- A multi select. `ReferencesControl` keeps its chips and adds through the same picker.
- A change to the scope picker or to any plain search over a list.

## 2. The empty choice, use by use

**The default is no empty choice.** A use that says nothing gets a field that can be changed
and cannot be emptied. A forgotten input then costs an operator a missing "None", which
somebody notices. The other default lets a required field be saved empty.

The component takes `empty`: `'none'`, `'any'` or `null`. A descriptor takes `emptyOption`,
a boolean. Left out, a form field follows `nullable` and a filter is `true`. A filter that nobody can
put back to "every row" is a trap.

| Use | Empty choice | Why |
| --- | --- | --- |
| Every `reference` filter of a descriptor (category, product group, parent category, price scope, owner, member, zone, private label chain, canonical brand) | "Any" | An empty filter means every row. It reads like the empty option of the selects beside it. |
| The same filters with `nullable: true` (product group, parent category, owner) | "Any", then "None" | "None" asks for the rows that point at nothing, as before. |
| A `reference` form field with `nullable: true` (product group of a product, parent of a category, default price scope of a chain, canonical brand, private label chain) | "None" | Null is a real answer of the column. |
| A `reference` form field without `nullable` (chain of a shop, product and shop of an availability row, product and scope of a price, chain of a section, zone and person of a membership) | none | The server refuses the row without it. |
| `ReferencesControl` (the scopes of a shop) | none | It adds. A chip is removed with its own button. |
| Brand suggestions: "Private label of" | "None" | Most brands belong to no chain. |
| Places queue: chain, and price scope | "None" | A place is accepted with either one empty. |
| Run prices tab: product | "Any" | It is a filter over the prices of the run. |
| Product page: "Preview at" shop | none | The preview needs a shop. |
| Set group panel: target group | none | The action needs a group. |
| Entries queue: bind to a product | none | The action needs a product. |
| Import upload: chain, and price scope | none | The upload needs both. |
| Run request form: chain, and price scope | none | The run needs both. |
| Shops queue: map to a shop | none | It chooses and holds nothing. |
| Sources: chain of a new source | none | The source needs a chain. |

## 3. Decisions made here, for the owner to confirm

- **"Any" and not "None" in a filter.** The owner asked for "None" as the first option. In a
  filter the choice that clears the value means every row, and "None" already means the rows
  that belong to no group. Two choices called "None" in one list cannot both be right, so the
  clearing one takes the word the selects beside it use. In a form the first option is
  "None", as asked.
- **A click in the field opens the list**, and not only a click on the arrow. The arrow is a
  small target under a thumb.
- **Fields of a form take the border of the global rule.** `FieldControl` restated the
  padding, the border and the background of a control. The restated background hides the
  new arrow of a select, so those lines are deleted. A field of a form now has the same
  outline as a filter (`--admin-border-strong`).

## 4. What the walk found

Walked on 2026-10-05 against a local backend, at 1280 px and at 390 px, with no console
error and no horizontal scroll.

- **Products.** The Product group filter opens from the arrow with "Any", "None" and the
  first twenty groups. A typed word narrows it and Enter takes the first match. "None" and
  "Any" both work, Escape closes the list and keeps the focus, and text that was not chosen
  is gone after the field is left. The arrow of the Order select and the arrow of the
  filter are both 12 px from the edge, 20 px wide, in controls of one height.
- **A form.** "Add a product" has a required reference (Categories) with no empty choice and
  a nullable one (Product group) with "None" first. Enter on an option does not submit the
  form. Tab leaves and closes. Nothing was saved.
- **The harvester.** The chain of a new run and the chain of a new source each open with the
  six chains.
- **Not walked.** The pickers of the places queue, the shops queue, the entries queue, the
  import upload, the brand suggestions and the run prices tab. They are the same component
  with other inputs, and their specs pass. No screen reader was run: the roles and the
  `aria` attributes were read from the page.
- **Not from this plan.** The search of product groups answers nothing for one letter such
  as "a". That is the search of the gateway, and it was so before.

## 5. What this plan deletes

- The "Change" and "Clear" buttons of the picker, `startChanging()`, the `nullable` input of
  the component, and the keys `resource.reference.change`, `resource.reference.clear` and
  `resource.reference.search`.
- The list drawn in the flow of the page under a picker.
- The padding, border, background and height that `FieldControl` restated.
