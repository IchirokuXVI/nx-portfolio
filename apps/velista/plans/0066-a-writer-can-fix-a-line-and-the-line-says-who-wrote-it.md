# 0066: a writer can fix a line, and the line says who wrote it

> **Depends on backend `0076`** for the first half, which owns every rule about who may
> edit an approved line and what happens to its approval afterwards. Nothing in section 2
> or section 3 can ship before it: the sheet would open onto a save the server refuses.
>
> The second half depends on nothing. `Line.createdByUserId` has been on the wire and
> through the mapper since `0012`, and the line page already injects the resolver that
> turns it into a name.
>
> Prerequisite reading: `0030` section 4, which built the edit sheet's two modes and the
> `editScopeFor` expression this revises; `0047` section 1, which built the line page;
> and `0065` section 7, whose decision to leave the line detail sheet alone this plan
> follows.

Two changes to the line screens, unrelated in the product and adjacent in the code, which
is why they are one plan and not two. A writer can fix a line they typed wrong. And the
line says who typed it.

## 1. What is being built

| Piece                                               | Where                                     |
| --------------------------------------------------- | ----------------------------------------- |
| The edit sheet opens on an approved line            | `select-list-state.ts`, `edit-line-sheet` |
| A third edit scope, and one that dies               | `libs/velista/models/list-view.ts`        |
| The sentence saying the save un-approves it         | `edit-line-sheet`                         |
| A stale sentence about a line that is never created | `edit-line-sheet`                         |
| Who added the line                                  | `line-page`, `select-line-page.ts`        |

## 2. The sheet opens on an approved line

`editScopeFor` is the whole of it. It answers, per row, which fields the sheet may make
live, and it is the same expression the row's overflow reads to decide whether to offer
the sheet at all, so the menu entry and the sheet behind it cannot disagree. It moves to
match backend `0076` section 1 exactly:

| Row                                  | Today      | After     |
| ------------------------------------ | ---------- | --------- |
| Not approved, caller holds `WRITE`   | `full`     | `full`    |
| Approved, caller holds `MANAGE`      | `full`     | `full`    |
| Approved, caller holds `DECIDE`      | `quantity` | `full`    |
| Approved, caller holds `WRITE` alone | none       | `content` |
| Anything else                        | none       | none      |

### 2.1 `quantity` dies and `content` replaces it

`LineEditScope` becomes `'full' | 'content'`. The `quantity` member is not renamed, it is
**deleted**, because after the table above nothing can produce it: every caller who could
edit an approved line's number now gets the whole sheet. Leaving it in the union would
leave a mode the sheet still branches on and no row can reach, which is the kind of thing
that survives three plans and then gets a feature built on it.

`content` is its mirror image, and the sheet already knows how to draw one of these. In
`quantity` mode the content was shown and not editable, as a paragraph rather than a
disabled field, because a greyed out input invites a tap that does nothing. `content`
mode does the same thing to the number: the stepper becomes a paragraph showing the
quantity, for the same reason and drawn the same way. The `quantity-row` is currently
outside every branch and gains one.

### 2.2 The row's overflow needs no change

It offers the edit entry when `editScope` is not null and hides it otherwise, which is
already the correct behaviour for a third value. Nothing in `actionsFor` reads which
scope it is.

## 3. It says the save will un-approve the line

Before the save, not after it, as a `role="status"` line in the slot the sheet already
has for this kind of sentence. A row that quietly went back to "awaiting approval" under
somebody who was fixing a typo is confusing exactly once per person, which is once too
many for a sentence this cheap.

**The condition is the server's, read off the same two facts the sheet already holds.**
`warnsAboutRemainder` reads `_approved()` and `_autoApproves()` today, so the new
condition needs only the third term: the line is `APPROVED`, the list does not auto
approve, and the caller holds neither `DECIDE` nor `MANAGE`. That is backend `0076`
section 2 with nothing restated in different words. In practice it is the same as asking
whether the scope is `content`, and it should be written that way rather than as three
conditions that can drift from `editScopeFor`.

### 3.1 The remainder sentence goes

While in this file: `warnsAboutRemainder` and `list.edit.remainder` still render, and
what they promise has not been true since `0047`.

The sentence says the server keeps the difference as a second line marked as not in the
shop, citing backend `0037` section 4. Backend `0047` deleted that behaviour, and
`LineService.update`'s own doc comment says so: the rule died with the trip status it was
written in, and what a shopper found is a `line_settlements` row now. So the sheet warns
about a row that is never created, on the exact edit the new sentence is about, and
shipping the new one beside it would give a writer two warnings, one of them false.

Delete `warnsAboutRemainder`, `remainder`, `_openedAt` if nothing else reads it, the
`list.edit.remainder` key in both locales, and the `.remainder` rule in the stylesheet if
the new sentence does not reuse it. **This is a correction, not a feature**, and it is
listed here so it is not mistaken for one.

## 4. Who added the line

One caption on the line page, under the "where this line lives" line and before the two
number tiles, because it answers the same kind of question: not what this line is, but
where it came from.

`Line.createdByUserId` is already mapped (`mapping/mappers.ts`), and `LinePage` already
injects `MemberNames` and passes `nameOf: (userId) => this._names.nameOf(zoneId, userId)`
into its selector. So this is a view model field and a caption, and no data-access change
of any kind.

`selectLinePage` gains `addedBy: string | null`, resolved in the selector and never in
the template, following `claimedBy` beside it. Three cases and the null is one of them:

| `createdByUserId`             | `addedBy`                      |
| ----------------------------- | ------------------------------ |
| The reader's own id           | the `list.page.you` string     |
| A name the zone can resolve   | that name                      |
| Resolves to nothing, or empty | the `list.page.someone` string |

The third case is two situations drawn the same way, and that is deliberate rather than
lazy: the author has left the zone and their name is no longer this reader's to have, or
the mapper defaulted a missing field to the empty string (`strOr(raw['createdByUserId'],
'')`, which is what a line from a server that predates the field produces). Neither is
worth a distinct sentence, and "somebody" is true of both.

**No control, ever.** This is a caption, it is not a link to a profile, and tapping it
does nothing. There is no profile screen for a member and inventing an affordance into
one is a plan of its own.

### 4.1 It is not the same question as `list.page.addedByYou`

That key exists, it is `0065`'s, and it heads the cluster of products a person put on the
line rather than the catalog. Two things named "added by you" on one screen, meaning
different things, one of them about products and one about the line, is a collision worth
avoiding by naming: this caption's key is `list.page.addedBy`, it takes a `{{who}}`
argument, and it never appears without one.

### 4.2 The basket already does this, and the copy should match it

`BasketLine.createdBy` and the row's `added()` caption answer the same question on the
basket screen, and its copy is the copy this should read like. A reader moving between the
two screens must not find the same fact phrased two ways.

### 4.3 The line detail sheet is not changed

Following `0065` section 7. The sheet is the fast look at a line from the list, the page
is the whole of it, and the page is where a fact about the line's origin belongs. Adding
it to both means two places for the copy to drift. The sheet can gain it later without
anything here moving, because `selectLineDetail` already takes the same `nameOf`.

## 5. Copy

| Key                    | English                                                    | Spanish                                                         |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `list.page.addedBy`    | `Added by {{who}}`                                         | `Añadido por {{who}}`                                           |
| `list.edit.unapproves` | `Saving this will put the line back to awaiting approval.` | `Al guardar, la línea volverá a estar pendiente de aprobación.` |

`list.page.you` (`you` / `tú`) and `list.page.someone` (`somebody` / `alguien`) already
exist in the lowercase form these interpolate into, and are the ones to use. Removed:
`list.edit.remainder`, in both locales.

## 6. Tests

In `select-list-state.spec.ts`:

1. `editScopeFor` returns `content` for a `WRITE` only caller on an `APPROVED` line, where
   it returned null.
2. It returns `full` for a `DECIDE` holder on an `APPROVED` line, where it returned
   `quantity`.
3. It returns `full` for `MANAGE` on an approved line and for `WRITE` on a pending one,
   both unchanged.
4. It returns null for a `READ` only caller on every approval state.
5. No input to it produces `quantity`, which is the deletion proved rather than assumed.

In `edit-line-sheet.spec.ts`:

6. In `content` mode the content field is editable and the quantity stepper is not
   rendered as a control.
7. The un-approval sentence is drawn in `content` mode and absent in `full` mode.
8. It is absent on an approved line whose list auto approves, which is the case that
   reaches `full` and must not warn.
9. Nothing renders `list.edit.remainder`, and lowering the quantity draws no warning.

In `select-line-page.spec.ts`:

10. `addedBy` is the "you" string when `createdByUserId` is the caller's.
11. It is the resolved name when the zone knows it.
12. It is the "somebody" string when `nameOf` returns null, and again when
    `createdByUserId` is the empty string.

Assertions on any sentence carrying `{{interpolation}}` go on the view model, never on
rendered text: the testing translator does not interpolate.

## 7. Out of scope

- **Letting a writer change an approved line's quantity.** Backend `0076` section 3 is
  why, and the sheet's `content` mode is what that decision looks like on screen.
- **Telling the rest of the household that an edit un-approved a line.** The row's
  existing "awaiting approval" caption is the whole of it.
- **The line detail sheet**, per section 4.3.
- **Making the author's name a link**, per section 4.
- **Showing who approved a line**, which is a second id on the same model and a second
  caption, and nobody has asked for it.
- **Any change to the list page's rows.** A reverted line draws its existing caption
  through `captionKeyFor` with no work.
