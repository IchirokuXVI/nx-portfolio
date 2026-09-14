# 0084: renaming a line from the basket

> Server half: backend `0113`, which renames a basket line and the zone lines it came from.
> This plan does not work without it.
>
> In the aisle, a line called "leche" is the milk the household means, and fixing its name
> from the basket fixes it on the lists too. This plan puts the name in the settle sheet,
> with Save and the same merge confirmation `0083` gives a zone line, naming every list the
> merge touches.
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
blank. The rest of the pane is unchanged. A successful save announces `basket.rename.saved`
and leaves the sheet open.

## 4. The confirmation

When Save answers `line_merge_required`, a pane replaces the settle pane:

- One sentence per list in `details.lists`: the list and zone names, the other line's name
  and amount.
- One sentence for `details.basket` when present: the other basket line's name and amount.
- **Merge** repeats the rename with `confirmMerge: true`. **Keep editing** returns with the
  typed name intact.

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
| `basket.rename.mergeList`           | In {list} ({zone}), "{other}" already asks for {quantity}.                          | En {list} ({zone}), «{other}» ya pide {quantity}.                      |
| `basket.rename.mergeBasket`         | This basket already has "{other}", {quantity} to get.                               | Esta cesta ya tiene «{other}», {quantity} por coger.                   |
| `basket.rename.mergeQuestion`       | Merge them?                                                                         | ¿Juntarlas?                                                            |
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
3. `line_merge_required` draws one sentence per list and one for the basket, and Merge
   resends with `confirmMerge`.
4. An answer with `absorbedLineId` removes that line, and a different survivor calls
   `leaveTo` with its settle URL.
5. Each refusal shows its sentence with the list name.
6. The removal event removes a line from another participant's basket.

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
