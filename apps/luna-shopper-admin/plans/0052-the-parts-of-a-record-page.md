> **PR:** [#637](https://github.com/IchirokuXVI/nx-portfolio/pull/637)

# 0052 The parts of a record page

> First of a series that gives the back office one page for every record: `0052` (this one, the
> parts and the contract), `0053` (the page), `0054` (the collections of a record, and the
> brand), `0055` (the product and the product group), `0056` (the chain and the shop), `0057`
> (the zone and the person), `0058` (the list and the shopping list), `0059` (the chain
> source), `0060` (the last forms, and the removal). Each one is a pull request that leaves a
> working app. Build them in that order.
>
> Needs `0041` to `0047`, all merged, and `0049`, `0050` and `0051`, which are open pull
> requests today. Start this plan after all three are in `dev`. It builds on the typeahead of
> `0050` and on `recordIdIn` and `lib-record-id` of `0051`.
>
> Mock: `plans/mocks/record-page/` in this app, published at
> <https://claude.ai/artifact/9w1HHBNWQHyy3GTJWtjcYM>. The boards for this plan are `Parts`
> and `Contract`. The owner approved the mock on 2026-10-05, with every recommendation on its
> orange notes. Section 6 copies those decisions, so this file is enough without the canvas.

The back office draws a record in two ways. A resource with nothing special gets the generic
form, which is always a form: a record opens ready to be changed by accident. A resource
with something special gets a page written by hand, and seven of those pages disagree about
where Save is, what an empty value looks like and where Delete lives.

The series replaces both with one page that reads a record first and becomes a form on
"Edit". This plan builds what that page is made of and uses none of it in a page yet.

## Brief for the agent

### Objective

Build the twelve parts of the record page in `libs/luna-shopper-admin/ui`, and the descriptor
contract they read in `libs/luna-shopper-admin/models`, each with its specs. Darken the
outline of every control. No page is changed to use the parts. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-human` and `antislop-layoutmobile` skills.

### Context

- **The descriptor** is `ResourceDescriptor` in
  `libs/luna-shopper-admin/models/src/lib/resource/resource-descriptor.ts`. A field is a
  `FieldDescriptor` in `resource-field.ts`, one of ten kinds. `toCell` in `resource-view.ts`
  turns one field of one row into a table cell. `changedFields`, `validateDraft` and
  `toInput` in `resource-draft.ts` are the rules of a form.
- **The controls** are in `libs/luna-shopper-admin/ui/src/lib/resource/`. `FieldControl` is
  the one switch over the field kinds. `ReferencePicker` is the typeahead (a combobox since
  `0050`, and it takes a record ID since `0051`). `ReferencesControl` holds several
  references as chips. `LocalizedTextControl` draws one input for each language.
  `RecordId` (`lib-record-id`, plan `0051`) draws an ID small, in the mono face, with a Copy
  button.
- **Other uses of those controls.** `ReferencesControl` is used directly by
  `feature-harvest` (`entries-queue-page.ts`, `scope-copies.ts`) and by `feature-catalog`
  (`chains/shop-page.ts`, `set-categories-panel.ts`). `FieldControl` is drawn by
  `ResourceForm`, which five form pages and the price rules page still use. A change to a
  control shows on all of them at once.
- **The frame** is plan `0041`: `PageHeader`, `PageTabs`, `PopoverSheet`, `InfoButton`,
  `CautionLine`, `ConfirmDialog`, and `Viewport` with `compact` below 48 rem.
- **Tokens** are in `ui/src/lib/styles/_tokens.scss`. `--admin-border-strong` is `#c3c8c0`,
  and 35 rules in 24 files read it. Two specs guard the colors: `ink-on-wash.spec.ts` and
  `wash-contrast.spec.ts`.
- **Two guards in the app decide what this plan may export.**
  `apps/luna-shopper-admin/src/app/no-unused-public-export.spec.ts` fails when a name in the
  `index.ts` of a library has no importer in another project.
  `no-unread-translation-key.spec.ts` fails when a key of `en.json` has no reader in a source
  file. A spec is not a reader of a key.
- **Icons** are components in `libs/shared/ui`. `warning-icon`, `more-icon`,
  `chevron-left-icon` and `trash-icon` exist. `close-icon` exists and is not exported. A lock
  and a check mark do not exist.
- The app has one locale file: `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Target state

1. **The contract is in `models`.** Section 2 gives every name and type. The descriptor
   gains `record`, a field gains `setBy` and `check`, a text field gains the formats `code`
   and `image`, and a named action gains `danger` and `after`. Nothing that exists changes its meaning,
   so every descriptor of the app compiles with no edit.
2. **One function says how a value reads.** `toRecordValue(field, row, options)` in `models`
   answers a `RecordValue` (section 2.4). An empty value is `{ kind: 'none' }` for every
   kind. No component decides this for itself.
3. **One function says what a page draws.** `recordLayout(descriptor, mode)` in `models`
   answers the sections of the page for a mode, and the fields of the Record block
   (section 2.3).
4. **The twelve parts are in `ui`.** Section 3 gives each one: what it reads as, what it
   changes with, its component, its inputs and its outputs. Seven components are new. Five
   exist and gain an input or a look.
5. **A control is 36 px high beside a pointer and 44 px under a thumb.** Focus is a 2 px
   ring in `--admin-accent`. A corner is `--admin-radius-control` on a control,
   `--admin-radius` on a panel and `--admin-radius-state` on a state.
6. **An error is said in words.** A control that was refused has `aria-invalid`, a red edge,
   and one line under it with `warning-icon` and the sentence. The line is tied to the
   control with `aria-describedby`.
7. **The picker is a sheet on a phone.** Below 48 rem `ReferencePicker` opens its list in a
   `PopoverSheet` from the bottom edge. The search field is at the top of the sheet, the
   empty choice is first, and a row is 48 px high. At 48 rem and above it is the combobox of
   plan `0050`, unchanged.
8. **The outline of a control is `#8d948c`.** `--admin-border-strong` takes that value. On
   `--admin-surface-raised` it is 3 to 1 or more, and a spec proves it. A rule that used the
   token for the edge of a panel or for a line between rows takes `--admin-border`.
9. **Nothing uses the parts yet.** No file of a `feature-*` library and no file of the app
   imports a new part. The barrel of `ui` gains no name. The barrel of `models` gains only
   the names that `ui` imports.

### Scope

- In: `libs/luna-shopper-admin/models/src/lib/resource/**` and its `index.ts`,
  `libs/luna-shopper-admin/ui/src/lib/record/**` (new), `ui/src/lib/resource/**`,
  `ui/src/lib/styles/**`, `ui/src/lib/info/caution-line.ts`, `en.json`,
  `apps/luna-shopper-admin/src/styles.scss`, two new icons in `libs/shared/ui`, and each
  rule in a `feature-*` library that reads `--admin-border-strong` for something that is not
  the edge of a control.
- Out: `feature-resource` and every page, every descriptor, every route, the gateway,
  `openapi.json`, `wire-types.ts`, `PageHeader` (plan `0053` changes it), and the row
  switches of the price rules page, the Setup page and the roles of a person.

### Constraints

- A part holds no data and calls no service. It takes inputs and says what the operator
  did. The page of plan `0053` holds the store.
- One switch over the field kinds for reading (`FieldValue`) and one for changing
  (`FieldControl`). A new kind is one case in each.
- Twelve parts and no others. If a part seems to be missing, stop and say which record
  cannot be drawn without it.
- No component library, no new dependency, inline `template` and `styles`, and nothing
  imports `@angular/core/rxjs-interop`.
- No svg in a component. An icon is a component of `libs/shared/ui`. Look in the directory,
  not only in its `index.ts`, before you add one.
- No text in a template. Every new text is a key in `en.json`.
- `-ink` goes on the solid color and `-on-wash` on the wash, as `0018` says. Every text pair
  is 4.5 to 1 or more. The edge of a control is 3 to 1 or more.
- No motion, except the 120 ms fade of a sheet that `0041` allows, and none under
  `prefers-reduced-motion`.
- A value of the typeahead still changes only through a choice, in the sheet as in the
  combobox. A typed record ID is still read as plan `0051` says.
- An empty value reads "None". It is never a blank and never a dash.

### Action boundaries

- Do not change a page, a descriptor or a route. If a spec of a page fails because a control
  looks different, change the spec and say so in the pull request.
- Do not export a new part from the barrel of `ui`. Plan `0053` exports each part when it
  reads it.
- Do not start, stop or migrate Luna slot 0, 1 or 3. For the walk, a front end slot of your
  own may point at a backend that is already listening. Save nothing through it.
- Do not build any part of `0053` to `0060`.
- Stop and ask before you add a dependency or a second scheme of colors.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/models`,
  `luna-shopper-admin/ui`, `shared-ui` (use the name `nx show projects` gives for
  `libs/shared/ui`), every feature library with a changed rule, and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green. The pull request checks never build this app.
- The contrast checker of the `antislop-human` skill, run on every new text pair and on the
  new outline. Put the numbers in the pull request.
- The browser walk of section 5, at 1360 px and at 390 px, with screenshots.

## 1. Not in this plan

- The record page, its routes, its store and the save. That is `0053`.
- The More menu of the header. It is a change to `PageHeader`, and `0053` makes it with the
  page that needs it.
- A collection read from the gateway. `RecordCollection` draws rows it is handed. `0054`
  reads them.
- A switch that writes at once. The row switches of the price rules, of Setup and of a
  person's roles are not record pages, and they stay as they are.
- A file upload, a map, two fields in one row and a list of sections to jump to. Section 6
  says why.

## 2. The contract

All of it is in `libs/luna-shopper-admin/models/src/lib/resource/`. New types go in a new
file, `record-block.ts`, and `record-value.ts` holds section 2.4.

### 2.1 What a field can state

Added to `FieldBase` in `resource-field.ts`, so every kind has both:

```ts
/**
 * A translation key for the words beside this value while the page is a form
 * and the value cannot be changed: "Set by the harvester".
 */
readonly setBy?: string;

/**
 * What a person must look at in this value, or `null`. Drawn as an amber
 * state beside the value: "Guessed from the city. Check it."
 * A method for the reason `read` is one.
 */
check?(row: T): FieldCheck | null;
```

```ts
/** An amber state beside a value. Amber means only this. */
export interface FieldCheck {
  /** A translation key. */
  readonly label: string;
  readonly args?: Readonly<Record<string, string | number>>;
}
```

`TextField.format` becomes `'plain' | 'url' | 'code' | 'image'`.

| Format | Reads as | Changes with |
| --- | --- | --- |
| `plain` | the text | one line, or a box when `multiline` |
| `url` | a link | one line, checked as an address |
| `code` | the text in the mono face | one short line in the mono face |
| `image` | a picture 56 px square beside its address, which is a link | one line for the address, with the picture beside it once it loads |

`validateDraft` checks an `image` value as it checks a `url` value. A picture that does not
load draws the grey square with no picture, and the address stays a link.

### 2.2 What an action can state

Added to `NamedAction` in `resource-descriptor.ts`:

```ts
/** Whether the action destroys. It is then drawn last, under a line, in red. */
readonly danger?: true;

/**
 * What the page does when the action went through. `'reload'` reads the
 * record again and is the default. `'leave'` goes to the list, for an action
 * after which the record is gone.
 */
readonly after?: 'reload' | 'leave';
```

### 2.3 The `record` block

Added to `ResourceDescriptor`: `readonly record?: RecordBlock<T>;`

```ts
export interface RecordBlock<T extends ResourceRow = ResourceRow> {
  /** The order of the page. */
  readonly sections: readonly RecordSection<T>[];
  /** The collections that belong to the record. Plan 0054 reads them. */
  readonly children?: readonly RecordChild<T>[];
  /** The Record block: who made it, when it changed, and its ID. */
  readonly facts?: RecordFacts<T>;
  /** Where the app goes after a new record is saved. `'open'` when left out. */
  readonly afterAdd?: 'open' | 'list';
  /**
   * Where the Details tab sits among the tabs. `'first'` when left out. A
   * record opens on its first tab.
   */
  readonly details?: 'first' | 'last';
  /**
   * The counts beside the tabs that no field of the record holds, by the
   * `name` of the child. Built in an injection context, as `rowStates` is.
   */
  counts?(): (id: string) => Signal<Readonly<Record<string, number | null>>>;
}

export interface RecordSection<T extends ResourceRow = ResourceRow> {
  /** A translation key. */
  readonly title: string;
  readonly fields: readonly FieldName<T>[];
}

export interface RecordFacts<T extends ResourceRow = ResourceRow> {
  /** The field that holds when the record was made. */
  readonly added?: FieldName<T>;
  /** The field that holds who made it. Drawn only when the row carries a value. */
  readonly addedBy?: FieldName<T>;
  /** The field that holds when it last changed. */
  readonly changed?: FieldName<T>;
  /** The field that holds who changed it. Drawn only when the row carries a value. */
  readonly changedBy?: FieldName<T>;
  /** Other words for the two headings: "Signed up" on an account. */
  readonly labels?: { readonly added?: string; readonly changed?: string };
  /** More fields of the block, such as the source of a row. */
  readonly also?: readonly FieldName<T>[];
}

export type RecordChild<T extends ResourceRow = ResourceRow> =
  | RecordChildList<T>
  | RecordChildPart<T>;

/** A collection of another resource, read through that resource's list. */
export interface RecordChildList<T extends ResourceRow = ResourceRow> {
  /** `tab`: a tab beside Details. `panel`: a short list. `link`: a count. */
  readonly as: 'tab' | 'panel' | 'link';
  /** The `name` of the resource the rows belong to. */
  readonly resource: string;
  /** The filter of that resource's list that takes this record's ID. */
  readonly by: string;
  /** A translation key for the heading. The resource's `labels.many` when left out. */
  readonly label?: string;
  /** How many rows a panel shows. 5 when left out. */
  readonly rows?: number;
  /** The field of this record that holds how many rows there are. */
  readonly count?: FieldName<T>;
  /** A translation key for what an empty panel says. */
  readonly empty?: string;
  /**
   * A translation key for one small button in the heading of a panel. It
   * opens the form that adds a row of `resource`, with `by` filled in.
   */
  readonly add?: string;
}

/** A tab or a panel that the record's own library draws. */
export interface RecordChildPart<T extends ResourceRow = ResourceRow> {
  readonly as: 'tab' | 'panel';
  /** The route segment of a tab, and the key of a panel. */
  readonly name: string;
  /** A translation key. */
  readonly label: string;
  /** The component. It reads the record from `RECORD_CONTEXT` (plan 0054). */
  readonly component: Type<unknown>;
  /** The field of this record that holds the count beside the label. */
  readonly count?: FieldName<T>;
}
```

`recordLayout` is the one reader of the block:

```ts
export type RecordMode = 'read' | 'edit' | 'create';

export interface RecordLayout {
  readonly sections: readonly {
    readonly title: string;
    readonly fields: readonly FieldDescriptor[];
  }[];
  readonly facts: {
    readonly added: FieldDescriptor | null;
    readonly addedBy: FieldDescriptor | null;
    readonly changed: FieldDescriptor | null;
    readonly changedBy: FieldDescriptor | null;
    readonly addedLabel: string;
    readonly changedLabel: string;
    readonly also: readonly FieldDescriptor[];
  };
}

export function recordLayout<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  mode: RecordMode
): RecordLayout;
```

Its rules, each with a case in `record-block.spec.ts`:

- A field named in `facts`, and the field `idFieldOf` names, are in no section. The ID is
  always in the Record block and nowhere else.
- In `read` and in `edit` a section holds every field it names. In `create` it holds only
  the fields that `isEditable(field, 'create')` allows, and the parent field
  (`descriptor.parent.filter`), which the page draws as a locked value.
- A field that a child names as its `count` is in no section. It is drawn beside the tab
  or the heading of that child.
- A section with no field in this mode is left out.
- A field of the descriptor that no section names goes in a last section,
  `record.section.other`, in the order of `fields`. A new field can then never be missing
  from the page.
- With no `record` block there is one section, `record.section.details`, with every field in
  the order of `fields`, and the Record block holds the ID alone.
- In `create` the facts are empty. A record that does not exist has no ID and no date.

### 2.4 How a value reads

```ts
export type RecordValue = (
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true }
  | { readonly kind: 'word'; readonly key: string;
      readonly args?: Readonly<Record<string, string | number>> }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'lines';
      readonly lines: readonly { readonly locale: string; readonly text: string | null }[] }
  | { readonly kind: 'reference'; readonly resource: string; readonly id: string;
      readonly name: string | null }
  | { readonly kind: 'references'; readonly resource: string;
      readonly ids: readonly string[]; readonly ordered: boolean }
  | { readonly kind: 'json'; readonly text: string }
) & {
  readonly scope?: ScopeMarkView;
  readonly check?: FieldCheck;
};

export function toRecordValue<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  row: T,
  options: RenderOptions
): RecordValue;
```

- It formats a number, an amount of money, a date, a choice and a yes or no exactly as
  `toCell` does. Share the code and do not write the formats twice.
- A localized text is `lines`, one for each locale of the field, in the order the field
  gives. A language with no words has `text: null`, and the part writes "Not written yet"
  there. When every language is empty the value is `none`.
- A reference with a name on the row (`nameFrom`) carries the name. Without one, `name` is
  `null` and the page resolves it through the lookup, as the list does. The part never
  shows the ID in place of a name: while the name is read it shows a short line that says
  so, and for a record that is gone it says "This points at a record that is gone".
- `references` with no ID is `none`.
- `check` is `field.check?.(row)` when it answers a value.

## 3. The twelve parts

New components go in `libs/luna-shopper-admin/ui/src/lib/record/`. Every component has a
spec beside it.

| # | Part | Reads as | Changes with | Component |
| --- | --- | --- | --- | --- |
| 1 | Section and field row | a panel with a heading, and rows of label and value | the same rows, each with a control | `RecordSection`, `FieldRow` (new) |
| 2 | Text | the text, a link, mono text, or a picture and its address | one line | `FieldValue` (new), `FieldControl` |
| 3 | Longer text | the text, with its line breaks | a box four lines high | `FieldValue`, `FieldControl` |
| 4 | Number, money, date | the number, the amount and its currency, the day | a short field, 168 px wide | `FieldValue`, `FieldControl` |
| 5 | Switch | "Yes" or "No" | a switch with "Yes" or "No" beside it | `Switch` (new), in `FieldControl` |
| 6 | Select | the label of the choice | a select, with the arrow of `0050` | `FieldControl` |
| 7 | Picker, for one reference | the name, as a link | the typeahead of `0050` | `ReferencePicker` |
| 8 | Rows, for several references | the names, one for each line, "Main" on the first when the order counts | one row each, with arrows and a button that takes it away, and a picker under them | `ReferencesControl` |
| 9 | Text in several languages | one line for each language | one field for each language | `FieldValue`, `LocalizedTextControl` |
| 10 | Value that cannot be changed | the value | the value, a lock, and who set it | `LockedValue` (new), `RecordId` |
| 11 | Collection | a heading with a count, rows that are links, "See all" | the same | `RecordCollection` (new) |
| 12 | Save bar | not drawn | one bar with the state of the form, Cancel and Save | `SaveBar` (new) |

### 3.1 `RecordSection` and `FieldRow`

`lib-record-section`: a panel with one heading.

| Input | Type | Says |
| --- | --- | --- |
| `heading` | `string` | The heading, already translated. |
| `count` | `number \| null`, default `null` | A count beside the heading. |
| `level` | `2 \| 3`, default `2` | The level of the heading. A pane uses 3. |

It has two slots: `[sectionAction]` for one small button at the end of the heading row, and
the default slot for the rows.

`lib-field-row`: one field, label first.

| Input | Type | Says |
| --- | --- | --- |
| `label` | `string` | The label, already translated. |
| `controlId` | `string \| null`, default `null` | The control the label is for. `null` while reading. |
| `required` | `boolean`, default `false` | A star after the label. |
| `changed` | `boolean`, default `false` | "Changed" beside the label. |
| `help` | `string \| null`, default `null` | A translation key for the line under the control. |
| `messages` | `readonly FieldMessage[]`, default `[]` | The refusals, each one a line with `warning-icon`. |
| `loading` | `boolean`, default `false` | A grey bar in place of the value. |

- At 48 rem and above the label is a column 168 px wide at the left and the value takes the
  rest. Below 48 rem the label is above the value.
- One field for each row, at every width. Never two.
- The star is `aria-hidden`, and the control itself carries `required`.
- A screen reader hears label and value as a pair while reading (a description list), and a
  label tied to its control while changing. The spec checks both.
- The id of each message line is `controlId + '-error-' + index`. The row hands the ids to
  the control through the output of a small exported function, `errorIdsOf(controlId,
  count)`, so the control can set `aria-describedby` without reading the row.

### 3.2 `FieldValue`

`lib-field-value`: one value while the page reads.

| Input | Type | Says |
| --- | --- | --- |
| `value` | `RecordValue` | What to draw. |
| `name` | `string \| null`, default `null` | The resolved name of a reference whose value carries none. |
| `names` | `Readonly<Record<string, string \| null>>`, default `{}` | The resolved names of several references, by ID. |
| `link` | `readonly string[] \| null`, default `null` | Router commands to the record a reference points at. |
| `links` | `Readonly<Record<string, readonly string[]>>`, default `{}` | The same for several references, by ID. |

- `none` draws "None" in `--admin-ink-muted`.
- `check` draws the amber state after the value, with `--admin-waiting-wash` and
  `--admin-waiting-on-wash`.
- `scope` draws `ScopeMark` before the value.
- `image` draws the picture with an empty `alt`, because the address beside it names it.
- A reference with no `link` is text and not a link. A link that leads to a 404 is worse.

### 3.3 `FieldControl`, changed

It keeps its inputs and gains two:

| Input | Type | Says |
| --- | --- | --- |
| `invalid` | `boolean`, default `false` | Sets `aria-invalid` and the red edge. |
| `describedBy` | `string \| null`, default `null` | The ids of the error and help lines. |

- A boolean that is not nullable is a `Switch`. A nullable boolean stays the select with
  three answers, because the column has three.
- A text field of format `code` is in the mono face and 168 px wide. Format `image` draws
  the picture beside the field.
- A number, an amount of money and a date are 168 px wide at 48 rem and above. Every other
  control is at most 420 px wide. Below 48 rem every control fills its row.
- A `references` field hands `ordered` to `ReferencesControl`.

### 3.4 `Switch`

`lib-switch`: a `button` with `role="switch"`.

| Input | Type | Says |
| --- | --- | --- |
| `checked` | `boolean` | The value. |
| `controlId` | `string` | The id of the button. |
| `label` | `string` | The accessible name: the label of the field. |
| `disabled` | `boolean`, default `false` | |

Output: `checkedChange` with the new boolean.

- 36 by 20 px beside a pointer and 44 by 26 px under a thumb. The track is `#8d948c` off
  and `--admin-accent` on.
- "Yes" or "No" is written beside it, so the state is never color alone.
- It says what was pressed and writes nothing. The form holds the value until Save.

### 3.5 `ReferencePicker`, changed

No input changes. Below 48 rem (`Viewport.compact`):

- The field is a button that shows the name, with the same arrow.
- A press opens a `PopoverSheet` with `[sheet]="true"`. Its heading is the `label` input.
- The sheet holds the search field first, then the list. The empty choice of plan `0050` is
  the first row. A row is 48 px high.
- A choice closes the sheet and puts the focus back on the button. Escape and the scrim
  close it and change nothing.
- A typed record ID is read and chosen as plan `0051` says.

This replaces target 9 of plan `0050`, which opened the list under the field on a phone. The
owner approved the sheet with the mock. Section 4 of plan `0050` and its spec for the phone
change with it.

### 3.6 `ReferencesControl`, changed

It gains two inputs:

| Input | Type | Says |
| --- | --- | --- |
| `ordered` | `boolean`, default `false` | The order counts. Each row has "Move up" and "Move down", and the first row says "Main". |
| `addKey` | `string`, default `'resource.references.add'` | The placeholder of the picker under the rows: "Add a category". |

- A held reference is a row 36 px high (44 px under a thumb) and not a chip: the name, then
  "Main", then the arrows, then the button that takes it away.
- "Move up" is off on the first row and "Move down" on the last. Each button names the row
  in its `aria-label`: "Move Lácteos, Leche down".
- After a move the focus stays on the button that was pressed, on the row at its new place.
- A locked row has no button that takes it away, as today.
- The four direct uses named in Context get the rows with no change to their templates.

### 3.7 `LocalizedTextControl`, changed

- The tag before each field is the code of the language in capitals, and it is
  `aria-hidden`. The field has an `aria-label` that says the language in words: "Name in
  Spanish". It takes a new input, `label`, for the first word.
- It takes `invalid` and `describedBy`, as `FieldControl` does, and hands them to the field
  of the first language.

### 3.8 `LockedValue`

`lib-locked-value`: a value that the form shows and cannot change.

| Input | Type | Says |
| --- | --- | --- |
| `reason` | `string` | A translation key for the words after the lock. |

The value is the content of the element, usually a `lib-field-value`. After it comes a new
`lock-icon`, 14 px and `aria-hidden`, and the words in `--admin-ink-muted`.

The page of `0053` picks the reason in this order:

1. `field.setBy`, when the descriptor states it.
2. `record.locked.fromAddress` for the parent of a new record: "Set by where you came
   from".
3. `record.locked.fixedOnAdd` for a field with `editable: 'create'` on a saved record:
   "Fixed when it was added".
4. `record.locked.system`: "Set by the system".

### 3.9 `RecordCollection`

`lib-record-collection`: a collection of the record, as a panel or as one link.

| Input | Type | Says |
| --- | --- | --- |
| `heading` | `string` | The heading, already translated. |
| `shape` | `'panel' \| 'link'` | A short list, or one row with a count. |
| `count` | `number \| null`, default `null` | The count. `null` draws none. |
| `rows` | `readonly RecordCollectionRow[]`, default `[]` | The rows of a panel. |
| `more` | `boolean`, default `false` | Whether the list holds more rows than were handed. |
| `all` | `CollectionLink \| null`, default `null` | Where "See all" and the link shape lead. |
| `emptyKey` | `string \| null`, default `null` | What an empty panel says. |
| `status` | `'loading' \| 'ready' \| 'error'`, default `'ready'` | |

```ts
export interface RecordCollectionRow {
  readonly id: string;
  readonly title: string;
  /** A short second value at the end of the row: "41 products". */
  readonly trailing: string | null;
  /** Router commands to the row's own page, or `null` for a row that does not open. */
  readonly link: readonly string[] | null;
}

export interface CollectionLink {
  readonly commands: readonly string[];
  readonly queryParams?: Readonly<Record<string, string>>;
}
```

Output: `retry`, when the read failed and the operator asks again. Slot: `[sectionAction]`,
handed on to the heading row.

- A panel draws the rows as links with a chevron, then "See all 12" when `more` is true or
  when `count` is larger than the rows. With a `count` of `null` it says "See all".
- An empty panel says the sentence of `emptyKey`. An empty link says "None yet" and is not
  a link.
- Below 48 rem a panel is drawn as the link shape: one row that opens the list.

### 3.10 `SaveBar`

`lib-save-bar`: the one place Save and Cancel live. The type of its state is in `models`,
in `record-block.ts`, because the store of plan `0053` works it out:

```ts
export type SaveBarState =
  | { readonly kind: 'clean' }
  | { readonly kind: 'dirty'; readonly changes: number }
  | { readonly kind: 'missing'; readonly required: number }
  | { readonly kind: 'saving' }
  | { readonly kind: 'invalid'; readonly fields: number }
  | { readonly kind: 'refused' };
```

| Input | Type | Says |
| --- | --- | --- |
| `state` | `SaveBarState` | What the form is in. |
| `saveLabel` | `string` | The words of the button, already translated: "Save", "Add product". |

Outputs: `save`, `cancel`, `goToFirst`.

| State | The bar says | Save | Cancel |
| --- | --- | --- | --- |
| `clean` | "No changes yet" | off | on |
| `dirty` | "2 unsaved changes" | on | on |
| `missing` | "* Required. 2 required fields are still empty." | off | on |
| `saving` | "Saving…", and the button says it too | off | off |
| `invalid` | "Not saved. 2 fields need a look." and a link, "Go to the first" | on | on |
| `refused` | "Not saved. Your changes are still here." | on | on |

- The words are in an element with `role="status"`. For `invalid` it is `role="alert"`.
- The bar is 56 px high. It sticks to the bottom edge of the window, above
  `--admin-bar`, so on a phone it sits just above the bar of the app and both stay.
- Below 48 rem the bar is 60 px high and has no room for the words. Save takes the rest of
  the row and carries the count: "Save 2 changes". The words are still said to a screen
  reader. For `invalid` and `refused` the button says "Save" and the page moves to the
  first field that was refused, which is the page's job in `0053`.
- A saved form has no bar. The page reads again and says so in one line (section 3.11).

### 3.11 `CautionLine`, with a tone

The page needs three lines that are not parts of their own: the caution, the refusal that
belongs to no field, and the line that says a save went through. All three are one line
with an icon, so `CautionLine` gains an input and a slot:

| Input | Type | Says |
| --- | --- | --- |
| `tone` | `'caution' \| 'refused' \| 'saved'`, default `'caution'` | Amber with `warning-icon`, red with `warning-icon`, or pine with a new `check-icon`. |

The default slot comes after the text, for one link: "Open that brand", "Add another
product". `refused` has `role="alert"` and `saved` has `role="status"`.

## 4. Tokens

| Token | Was | Is | Why |
| --- | --- | --- | --- |
| `--admin-border-strong` | `#c3c8c0` | `#8d948c` | The edge of a control was 1.7 to 1 on the raised surface. It reaches 3 to 1. |

- `wash-contrast.spec.ts` gains the pair: `--admin-border-strong` on
  `--admin-surface-raised` and on `--admin-surface`, 3 to 1 or more.
- Plan `0041` gave the token one use, the outline of a control. Read each of the 35 rules
  that use it. The edge of a field, a select, a button, a picker and a check box keeps it.
  The edge of a panel, a menu, a sheet or a card, and a line between rows, takes
  `--admin-border`.
- The table of section 2 in plan `0041` changes its value with this plan.

## 5. Specs, and the walk

### Specs this plan adds

| Spec | Proves |
| --- | --- |
| `models/.../record-block.spec.ts` | Every rule of `recordLayout` in section 2.3. |
| `models/.../record-value.spec.ts` | One case for each kind and each format, the empty value of each, and that a number, an amount and a date read as `toCell` reads them. |
| `models/.../resource-draft.spec.ts`, extended | An `image` value is checked as an address. |
| `ui/.../record/*.spec.ts`, one for each new component | The inputs and outputs of section 3, the roles, and each state of `SaveBar`. |
| `ui/.../resource/references-control.spec.ts`, extended | The rows, the arrows, "Main", the focus after a move, a locked row. |
| `ui/.../resource/reference-picker.spec.ts`, extended | The sheet on a phone: it opens, a choice closes it, the focus goes back, Escape changes nothing, a typed ID is chosen. |
| `ui/.../resource/field-control.spec.ts`, extended | The switch, `aria-invalid`, `aria-describedby`, the mono field, the picture. |
| `ui/.../styles/wash-contrast.spec.ts`, extended | The outline pair of section 4. |
| `ui/.../record/no-empty-dash.spec.ts` (new guard) | No file of `ui/src/lib/record` writes a dash or an empty string for an empty value. It reads the sources and fails on a string that is only a hyphen or a longer dash. |

### The walk

No page uses the new parts, so the walk is of what changed on the pages that exist. At
1360 px and at 390 px:

- The outline of a field, a select and a typeahead on the Products filters and on one form.
  It is darker, and a panel beside it kept its light edge.
- A form with a boolean: the switch, pressed with the mouse and with Space, and the value
  does not leave the page until Save.
- The scopes of a shop and "Set categories" on Products: the rows, the button that takes a
  row away, and on the categories the arrows and "Main".
- At 390 px: a typeahead of a form opens as a sheet, the search field takes text, a choice
  closes it and the field shows the name.
- No sideways scroll at either width, and no error in the console.

Say in the pull request what was walked and what was not.

## 6. Decisions made

The owner approved the mock on 2026-10-05, and every recommendation on it. These are the
ones this plan builds on.

- **Twelve parts and no others.** A thirteenth is refused unless a record cannot be drawn
  without it.
- **One field for each row**, label left and value right, and the label above on a phone.
  Two short fields never share a row. One rule for every record is worth more than a
  shorter page.
- **An empty value reads "None".** Never a blank and never a dash, so an empty field and a
  field that failed to load do not look the same.
- **A reference is a picker that looks like a select.** It shows names. It never shows an
  ID and never asks for one. On a phone it is a sheet from the bottom.
- **A text in several languages is one field with one line for each language.**
- **A list of references has one row for each reference.** When the order means something
  the rows have arrows and the first is "Main".
- **A value a person may not change says who set it.** A value a person must check is
  amber, and amber means only that.
- **A switch never writes while the page reads.** It changes with Save like every other
  field. A change that must be fast is a named action with its own question.
- **An image is a link with a preview.** The catalog stores an address and has no place to
  keep a file.
- **No map for coordinates.** Two numbers and a link to a map site, which is a `url` field.
- **No list of sections to jump to yet.** Add it when a record passes six sections.
- **The outline of a control darkens to `#8d948c`.**

Decisions this plan made, for the owner to confirm:

- **`addedBy` and `changedBy` are fields of `facts`.** The board of the contract shows
  `added` and `changed` only, and the boards of the pages show "by Dev Admin". The owner
  agreed that the line is drawn only when the row carries the value, so the descriptor has
  to say where the value is.
- **A child of a record can be a component** (`RecordChildPart`). The board shows a child
  that is a list of another resource. The owner also agreed that each record that has a
  page today "keeps only what is special to it, as a tab or a panel", and that needs a
  child the record's own library draws.
- **A field that no section names is drawn in a last section, "Other".** The other choice
  was to leave it out, and a field added to a descriptor later would then be missing from
  the page with nothing to say so.
- **The combobox of `0050` stays on a wide screen.** The board draws a button that opens a
  panel with a search field in it. The decision on the note is about how the picker
  behaves (the arrow, no typing needed, "None" first, names only), and the combobox does
  all of it with one field.
- **A nullable boolean keeps its select of three answers.** The mock draws a switch, which
  has two.
- **The save bar sticks to the bottom edge at every width.** Plan `0041` says nothing is
  fixed on a wide screen. A bar that tells the state of the form has to be seen from the
  thirtieth field too.

## 7. What this plan adds, and what it deletes

Adds:

- In `models`: `record-block.ts` (`RecordBlock`, `RecordSection`, `RecordFacts`,
  `RecordChild`, `RecordChildList`, `RecordChildPart`, `RecordMode`, `RecordLayout`,
  `recordLayout`, `SaveBarState`), `record-value.ts` (`RecordValue`, `toRecordValue`), `FieldCheck`,
  `setBy`, `check`, the two formats, `danger` and `after`.
- In `ui`: `RecordSection`, `FieldRow`, `FieldValue`, `Switch`, `LockedValue`,
  `RecordCollection`, `SaveBar`, and the inputs of sections 3.3 and 3.5 to 3.7 and 3.11.
- In `libs/shared/ui`: `lock-icon` and `check-icon`, exported from its `index.ts`. Export
  `close-icon` there too if a part needs it. Do not add a second copy.
- In `en.json`: the keys under `record.*`, and `resource.references.add`,
  `resource.references.main`, `resource.references.moveUp` and
  `resource.references.moveDown`.

Deletes:

- The chips of `ReferencesControl`, with their styles and `resource.references.removeShort`
  if nothing reads it any more.
- The check box of `FieldControl`.
- The list that `ReferencePicker` opened under the field on a phone.
