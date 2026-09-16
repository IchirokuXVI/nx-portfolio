> **PR:** [#380](https://github.com/IchirokuXVI/nx-portfolio/pull/380)

# 0084: renaming a line from the basket

> Server half: backend `0113`, which renames a basket line and the zone lines it came from.
> This plan does not work without it.
>
> In the aisle, a line called "leche" is the milk the household means, and fixing its name
> from the basket fixes it on the lists too. This plan puts the name in the settle sheet,
> with Save and the same merge confirmation `0083` gives a zone line, naming every list the
> merge touches.
>
> The design is drawn in `mocks/line-sheet/`, published at
> https://claude.ai/artifact/4zbiAsWxFJFQokU29JouLs. The last two of its five artboards are
> this plan: the settle sheet with the name field, and the merge question with a refusal
> beside it.
>
> Prerequisite reading: `0083` sections 4 and 5 (saving and the merge confirmation on a zone
> line), backend `0113` in full, `0073` (the settle sheet as it is now), and the memory
> note on guest reachable routes.

## Brief for the agent

### Objective

Let a reader who is allowed to rename a basket line do it from the settle sheet, with
Save, a merge confirmation that lists every affected list, and the store following the
answer.

### Context

- `SettleSheet` (`libs/velista/feature-shopping-lists/src/lib/settle-sheet/`) has four panes.
  The settle pane's title is the line's content.
- `BasketStore` (`libs/velista/data-access/src/lib/generated-lists/basket-store.ts`) holds
  the basket, applies answers and socket events, and knows `me` (kind) and `seesZoneData`.
- `seesZoneData` is true only for the owner and for a registered participant with `WRITE`
  on every source list, and every line's origin lists are among the source lists.
- Controls are removed, not disabled, once the trip is finished (`canSettle`).
- `basket-error-copy.ts` maps error codes to copy for basket operations.

### Target state

The owner, and a registered participant who sees zone data, rename a line with origins
from its settle sheet. The owner also renames a line with no origin. Nobody else sees the
field. A merge is confirmed first and the sheet lands on the surviving line.

### Scope

- Work only in: `settle-sheet/`, `basket-error-copy.ts`, `libs/velista/data-access/src/lib/generated-lists/`
  (API, service, store, mappers, realtime handling), `libs/velista/data-access/src/lib/realtime/`
  if a new event name arrives, `libs/velista/models`, and the translation files.
- Do NOT touch: zone list screens, the backend.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill for
  the field and the confirmation pane.
- Save is explicit. Map every answer from `unknown`.
- The client rule in section 2 only decides whether the field is drawn. The server decides
  whether the rename is allowed, and its refusal is shown.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask if backend `0113` is not on `dev`.

### Progress evidence

Report after the field and Save, after the confirmation, and after the store handles the
answer and the removal event, each with its spec run.

## 1. What is being built

| Piece                               | Where                                               |
| ----------------------------------- | --------------------------------------------------- |
| The name field and Save             | `settle-sheet`, settle pane                         |
| The merge confirmation pane         | `settle-sheet`, a fifth pane                        |
| `renameLine` and its answer         | `basket-api.ts`, `basket-service.ts`, `BasketStore` |
| The absorbed line leaves the basket | `BasketStore`, the realtime mapper                  |
| Copy                                | `en.json`, `es.json`                                |

## 2. Who sees the field

The field is drawn when the trip is not finished and:

- the reader is the owner, or
- the reader is a registered participant, `seesZoneData` is true, and the line has origins.

A guest never sees it. A registered participant without zone data sees the title as today.

## 3. The field

The settle pane's title becomes a text input with a visible label, holding the line's
content, and a Save button under it, enabled when the trimmed name changed and is not
blank. The rest of the pane is unchanged, in its order: the outstanding count, the product,
the lists, the three settle buttons and the history link. A shopper who knows where "Got
all" is still finds it there.

Save is drawn as `0083` draws it, and for the same reason: the quiet accent, so the solid
amber stays on "Got all 3". A successful save announces `basket.rename.saved`, puts it on
the button with a check until the next change, and leaves the sheet open. While the save is
in flight the field is read only and the settle controls are disabled.

There is one field here and no amount, so Save sits straight under the field with no rule
under it. The outstanding count already begins the next block.

## 4. The confirmation

When Save answers `line_merge_required`, a pane replaces the settle pane. It is a heading,
a sentence, and **one row per place the name is taken**, not one sentence per place: a
rename here can collide on three lists and in the basket at once, and in an aisle a column
of rows is read at a glance where four sentences are not.

- The heading names the typed name: `basket.rename.mergeTitle`.
- Under it, `basket.rename.mergeExplain` says what merging does.
- One row per list in `details.lists`: the list name, the zone name under it, and what the
  other line asks for on the trailing edge.
- One row for `details.basket` when present: `basket.rename.mergeBasketRow` on the leading
  edge, and how many of the other line are still to get on the trailing one.
- **Merge** repeats the rename with `confirmMerge: true`. **Keep editing** returns with the
  typed name intact.

The other line's own spelling is not drawn on a row. Both names normalize to the same thing
by construction, so a row spelling it again says nothing the heading has not said.

After a confirmed merge:

- If the answer names `absorbedLineId`, that line leaves the store at once.
- If the answer's line is not the sheet's line, the sheet navigates with `leaveTo` to the
  survivor's settle sheet URL.

`line_merge_needs_approval` and `line_merge_too_many_products` show under Save, naming the
list from `messageArgs.listName`. `forbidden` shows `basket.error.renameForbidden`.

## 5. Everybody else's basket

The store applies `GeneratedListLineUpdated` as today, and removes the line named by the
removal event backend `0113` uses. A participant whose settle sheet is open on a line that
was absorbed sees the sheet close, as it does today for a line that disappears.

## 6. Copy

| Key                                 | English                                                                             | Spanish                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `basket.rename.label`               | Name                                                                                | Nombre                                                                 |
| `basket.rename.save`                | Save                                                                                | Guardar                                                                |
| `basket.rename.saved`               | Saved                                                                               | Guardado                                                               |
| `basket.rename.mergeTitle`          | These already have a line called "{name}"                                           | Ya hay una línea llamada «{name}» aquí                                 |
| `basket.rename.mergeExplain`        | Merging makes each of them one line, with the amounts added together.               | Al juntarlas, cada una queda en una línea y se suman las cantidades.   |
| `basket.rename.mergeAsks`           | asks for {quantity}                                                                 | pide {quantity}                                                        |
| `basket.rename.mergeToGet`          | {quantity} to get                                                                   | {quantity} por coger                                                   |
| `basket.rename.mergeBasketRow`      | This basket                                                                         | Esta cesta                                                             |
| `basket.rename.merge`               | Merge                                                                               | Juntar                                                                 |
| `basket.rename.keepEditing`         | Keep editing                                                                        | Seguir editando                                                        |
| `basket.error.mergeNeedsApproval`   | In {list}, that name belongs to an approved line, and this one is not approved yet. | En {list}, ese nombre es de una línea aprobada, y esta aún no lo está. |
| `basket.error.mergeTooManyProducts` | In {list}, together they have more than {max} products.                             | En {list}, juntas tienen más de {max} productos.                       |
| `basket.error.renameForbidden`      | You can no longer change this line's name.                                          | Ya no puedes cambiar el nombre de esta línea.                          |

## 7. Tests

1. The field is drawn for the owner, for a registered participant with `seesZoneData` on a
   line with origins, and for the owner on a line with no origin. It is absent for a guest,
   for a registered participant without zone data, and on a finished trip.
2. Save is disabled until the name changes, and for a blank name.
3. `line_merge_required` draws one row per list and one for the basket, each with what the
   other line asks for, and Merge resends with `confirmMerge`.
4. An answer with `absorbedLineId` removes that line, and a different survivor calls
   `leaveTo` with its settle URL.
5. Each refusal shows its sentence with the list name.
6. The removal event removes a line from another participant's basket.
7. A save puts `basket.rename.saved` on the button, and the next change puts Save back.

## 8. Acceptance criteria

- [ ] A line's name is changed from the basket, and the lists it came from change with it.
- [ ] Nobody sees the field whom the server refuses on the ordinary path.
- [ ] Every merge is shown and confirmed before it happens.

## 9. Verification

```sh
npx nx run-many -t lint test -p velista/data-access velista/models velista/feature-shopping-lists
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps velista --backend-slot <slot with 0113>
```

On the slot, rename a basket line onto a name one of its lists already has, confirm, and
read the list. `--down` when finished.
