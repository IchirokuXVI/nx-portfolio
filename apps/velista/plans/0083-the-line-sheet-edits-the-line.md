# 0083: the line sheet edits the line

> Server half: backend `0112`, which makes a rename onto a taken name a merge the caller
> must confirm. This plan does not work without it.
>
> A zone list row has a three dots menu with edit, comments and delete, and a tap that
> opens the line's detail sheet. Editing opens a second sheet. This plan removes the menu
> and makes the detail sheet the one place a line is changed: the name and the amount are
> edited in it, with a Save button, and comments and delete are reached from it.
>
> The design is drawn in `mocks/line-sheet/`, published at
> https://claude.ai/artifact/4zbiAsWxFJFQokU29JouLs. Three of its five artboards are this
> plan: the sheet at rest, while typing and saved; the merge question, a refusal and
> saving; the other readers and the row without its menu.
>
> Prerequisite reading: `0043` (the detail sheet), `0076`'s client half in
> `edit-line-sheet/` (what each permission can edit, and the unapproval warning), backend
> `0112` in full, and the sheet rules in CLAUDE.md.

## Brief for the agent

### Objective

Move `EditLineSheet`'s fields into `LineDetailSheet` with an explicit Save, add the merge
confirmation backend `0112` requires, move comments and delete into the detail sheet, and
delete the row menu and the edit sheet.

### Context

- Row menu: `libs/velista/ui/src/lib/list/line-row.html` (`lib-ellipsis-icon`,
  `role="menu"`), options from `actionsFor` in `feature-lists/src/lib/select-list-state.ts`
  (`edit`, `comments`, `delete`), handled by `ListPage.act`.
- `EditLineSheet` (`feature-lists/src/lib/edit-line-sheet/`): the content input, the
  quantity reel in `full` scope or plain text in `content` scope, the `list.edit.unapproves`
  notice, Save and Cancel. It calls `LineStore.updateLine`, handles `failed` and
  `overwritten`, sets `realtime.setEditingLine` on open.
- `editScopeFor` decides `full`, `content` or `null`.
- `LineDetailSheet` (`line-detail-sheet/`): title, products phrase, facts, "I bought this",
  "They did not have it", the how many step with a stepper, the link to the line page. Its
  shell has **no `[dismissible]` binding**, so it closes during a settle request.
- Routes: `lines/:lineId/detail`, `lines/:lineId/edit`, `lines/:lineId/comments`,
  `lines/:lineId/confirm/delete`, all through `sheet()` in `feature-shell/src/lib/routes.ts`.
- Sheet over sheet (`stale-entity-answer-after-delegated-write` memory): `leaveTo` replaces
  the history entry. A sheet that must be returned to opens the next one with
  `router.navigateByUrl`, and the next one dismisses on every way out.
- There is no autosave anywhere in velista, and this plan does not add one.

### Target state

Tapping a row opens the detail sheet, which edits the name and amount with Save, confirms a
merge, opens comments and delete, and returns to itself from both. No row has a menu, the
edit sheet and its route do not exist, and every spec passes.

### Scope

- Work only in: `libs/velista/feature-lists/src/lib/` (detail sheet, list page, select list
  state, error copy, the edit sheet's deletion), `libs/velista/ui/src/lib/list/line-row.*`
  and `line-list.*`, `libs/velista/data-access/src/lib/lines/` (the update call and its
  answer), `libs/velista/feature-shell/src/lib/routes.ts`, the translation files.
- Do NOT touch: the line page's own product editing, the basket, any backend project.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill for
  the sheet's layout.
- Save is explicit. Nothing is written while typing or on blur.
- Map every answer from `unknown` (rule D4). `absorbedLineId` is optional in the answer.
- A route provided service is never destroyed: presence and pending state clear from the
  component's `DestroyRef`.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask if backend `0112` is not on `dev`, if `GatewayError` does not carry an
  error's `details` and `messageArgs` to the client, or if another screen uses the row menu.

### Progress evidence

Report after the menu removal, after the fields and Save, after the merge confirmation,
and after comments and delete work from the sheet, each with its spec run.

## 1. What is being built

| Piece                                         | Where                                                           |
| --------------------------------------------- | --------------------------------------------------------------- |
| The row menu removed                          | `line-row`, `line-list`, `select-list-state.ts`, `list-page.ts` |
| Name and amount in the detail sheet, and Save | `line-detail-sheet`                                             |
| The merge confirmation                        | `line-detail-sheet`, a pane, not a route                        |
| `confirmMerge` and `absorbedLineId`           | `line-api.ts`, `LineStore.updateLine`                           |
| Comments and delete from the sheet            | `line-detail-sheet`                                             |
| The edit sheet and its route deleted          | `edit-line-sheet/`, `routes.ts`, `index.ts`                     |
| The sheet cannot close mid request            | `line-detail-sheet.html`                                        |
| Copy                                          | `en.json`, `es.json`                                            |

## 2. The row

The row loses its menu, its `actions` input and the output that carried a chosen action.
`actionsFor` keeps answering what the reader can do, because the sheet needs it.
Approve, reject and restore stay under the row. A tap on the row opens the detail sheet, as
today.

## 3. The sheet, top to bottom

For a reader with an edit scope:

1. **Name**, a text input with a visible label, holding the line's name, limited to
   `LINE_CONTENT_MAX_LENGTH`. The sheet's `h2` keeps the saved name for the dialog's label
   and is visually hidden while the input is shown.
2. **Asked for**, the quantity reel in `full` scope, the number as text in `content` scope.
   The number as text sits where the reel's pill would, so the sheet does not change shape
   between two readers.
3. The `list.edit.unapproves` notice, shown once the name or the amount differs from the
   saved line and `warnsAboutUnapproval` is true.
4. **Save**, enabled only when something changed and the name is not blank. It shows the
   spinner and `aria-busy` while saving. Errors show under it with `role="alert"`.
5. A rule, and then what the sheet shows today: the products phrase, the facts, the settle
   actions and their how many step.
6. **Comments** and **Delete line**, one row of two buttons under a second rule, below the
   settle actions. Comments is drawn for every reader, as the menu offered it, and carries
   the line's comment count, so the row's count and the sheet agree. Delete line is drawn
   only when `actionsFor` includes `delete`, in the danger colour, and Comments takes the
   whole row when it is absent.
7. "See more details", the link to the line page.

A reader with no edit scope sees the static title and sections 5 to 7.

The reel for "Asked for" and the stepper of the how many step are both on the sheet, with
their labels, by decision of the product owner.

Three things the mock settles about the shape of it:

- **The header's quantity pill goes** for a reader with an edit scope, because the reel
  above it is the same number. A reader with no scope keeps today's header, pill included.
- **Save takes the quiet accent** (`--app-action-quiet-bg`, `--app-action-quiet-border`,
  `--app-action-quiet-fg`), not the solid `.primary` this library's `_sheet-form.scss`
  gives a sheet's one button. The solid amber stays on "I bought this", which is what a
  reader opened the sheet to press, and two solid buttons on one sheet compete for the
  thumb. Disabled is the same dimming `.primary` uses.
- **The rule above section 5 is what scopes Save.** Save writes the name and the amount and
  nothing below it, and the rule is what says so.

## 4. Saving

- Save sends only what changed: `content` when the trimmed name differs, `quantity` when the
  amount differs and the scope is `full`.
- A successful save keeps the sheet open on the saved values and announces
  `list.detail.saved` politely. The button itself says it: it holds `list.detail.saved` and
  a check, disabled, until the next change turns it back into Save. It is where the reader
  is already looking, it costs no height, and the live region is the button, so the
  announcement happens once.
- A realtime update to this line while nothing is edited redraws the fields. While something
  is edited, it does not overwrite what the reader typed.

## 5. The merge confirmation

When Save answers `line_merge_required`, the sheet shows a confirmation pane in place of
its content, built from the error's details. Three lines, in this order:

> **"Milk" is already on this list, asking for 2.**
> Merge them into one line asking for 5?
> Comments and what was bought move with it.

The fact comes first and the question second, each on its own line, because the fact is
what the reader did not know. The third line answers the worry the question raises, and it
is true by backend `0112` section 4: comments and settlements move to the survivor.

Then **Merge** and **Keep editing**. Merge is the solid `.primary` here, because in this
pane it is the only thing to do, and it repeats the save with `confirmMerge: true`. Keep
editing returns to the fields with the typed values intact.

After a confirmed merge:

- If the answer's line id differs from the sheet's `lineId`, the sheet navigates with
  `leaveTo` to the survivor's detail sheet URL, so the reader stays on the line that
  remains.
- The line named by `absorbedLineId` leaves the store at once. The `LineDeleted` event that
  follows finds nothing to remove.

The two other refusals show as errors under Save, and the fields keep their values:

- `line_merge_needs_approval`: `list.error.mergeNeedsApproval`.
- `line_merge_too_many_products`: `list.error.mergeTooManyProducts`, with `max`.

## 6. Comments and delete

- Comments opens `lines/:lineId/comments` with `router.navigateByUrl`, so it pushes. The
  comments sheet dismisses on every way out and lands back on the detail sheet.
- Delete opens `lines/:lineId/confirm/delete` the same way. Cancel dismisses back to the
  detail sheet. A confirmed delete leaves to the list page with `leaveTo`. Check with
  `AppHistory` that back from the list page does not reopen a detail sheet for the deleted
  line. If it does, stop and report.

## 7. Presence and closing

- `realtime.setEditingLine` starts when the name input takes focus or the reel first moves,
  and clears after a save, when the reader leaves both fields with nothing changed, and on
  destroy.
- The shell gets `[dismissible]="!submitting()"`, covering a save and a settle.
- **While a save is in flight, nothing else on the sheet writes.** The fields are read only,
  and the settle actions, Comments, Delete line and "See more details" are disabled. Two
  writes to one line never race, and nobody leaves the sheet with a save still in flight.
- The sheet keeps `initialFocus` on the panel (`0081`, PR #371), so opening it over a line
  raises no keyboard. The keyboard comes up when the name input is tapped, and the name,
  the amount, the notice and Save all stand above it at 390 by 844.

## 8. What goes

`EditLineSheet`, its route, its export, and its specs. `routes.spec.ts`'s sheet count and
any dismissal table that names the edit sheet change with it. Keys only the edit sheet used
move to the detail sheet under their existing names, and keys nothing uses any more are
deleted.

## 9. Copy

| Key                               | English                                                                   | Spanish                                                           |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `list.detail.name`                | Name                                                                      | Nombre                                                            |
| `list.detail.askedFor`            | Asked for                                                                 | Pedido                                                            |
| `list.detail.save`                | Save                                                                      | Guardar                                                           |
| `list.detail.saved`               | Saved                                                                     | Guardado                                                          |
| `list.detail.comments`            | Comments                                                                  | Comentarios                                                       |
| `list.detail.commentsLabel`       | Comments, {count}                                                         | Comentarios, {count}                                              |
| `list.detail.delete`              | Delete line                                                               | Borrar línea                                                      |
| `list.merge.taken`                | "{other}" is already on this list, asking for {otherQuantity}.            | «{other}» ya está en esta lista y pide {otherQuantity}.           |
| `list.merge.question`             | Merge them into one line asking for {total}?                              | ¿Juntarlas en una línea que pida {total}?                         |
| `list.merge.keeps`                | Comments and what was bought move with it.                                | Los comentarios y lo comprado se van con ella.                    |
| `list.merge.confirm`              | Merge                                                                     | Juntar                                                            |
| `list.merge.keepEditing`          | Keep editing                                                              | Seguir editando                                                   |
| `list.error.mergeNeedsApproval`   | That name belongs to an approved line, and this line is not approved yet. | Ese nombre es de una línea aprobada, y esta línea aún no lo está. |
| `list.error.mergeTooManyProducts` | Together they have more than {max} products.                              | Juntas tienen más de {max} productos.                             |

Reuse an existing key wherever one already says the same thing, and name it in the PR.

## 10. Accessibility

- The name input has a visible label. The dialog stays labelled by the saved name.
- The confirmation pane moves focus to its question, and Keep editing returns focus to Save.
- Delete is a button, not a link.

## 11. Tests

1. A row renders no menu, and a tap emits the open event.
2. The sheet shows the name input and Save for `full` and `content` scopes, the reel only for
   `full`, and neither for a reader with no scope.
3. Save is disabled until something changes, and disabled for a blank name.
4. Save sends only changed fields.
5. The unapproval notice shows only with a change and `warnsAboutUnapproval`.
6. `line_merge_required` shows the pane with the other line's name and both amounts. Merge
   resends with `confirmMerge`, Keep editing returns with the typed values.
7. A merge whose survivor is another line calls `leaveTo` with the survivor's detail URL,
   asserted on the `SheetNavigation` double.
8. `absorbedLineId` removes that line from the store.
9. The other two refusals show their sentences.
10. Comments and delete navigate with `navigateByUrl`, not `leaveTo`.
11. The sheet is not dismissible while saving or settling.
12. A socket update redraws clean fields and leaves edited fields alone.
13. `routes.spec.ts` no longer finds the edit route.
14. A save puts `list.detail.saved` on the button, and the next change puts Save back.
15. While a save is in flight the fields are read only, and the settle actions, Comments,
    Delete line and the link are disabled.
16. Comments carries the count, and its accessible name carries it too.

## 12. Acceptance criteria

- [ ] No zone list row has a three dots menu.
- [ ] A line's name and amount are changed from its detail sheet, with Save.
- [ ] Renaming onto a taken name asks before merging, and merging lands on the line that
      remains.
- [ ] Comments and delete open from the sheet, and back returns to it.
- [ ] The edit sheet no longer exists.

## 13. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/data-access velista/feature-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista --backend-slot <slot with 0112>
```

On the slot, rename a line onto another line's name, confirm, and check the list. `--down`
when finished.
