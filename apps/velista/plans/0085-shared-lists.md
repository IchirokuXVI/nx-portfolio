> **PR:** [#382](https://github.com/IchirokuXVI/nx-portfolio/pull/382)

# 0085: shared lists

> Server half: backend `0114`. This plan does not work without it.
>
> The owner of a basket chooses people from their groups when creating it, and adds or
> removes them later from the share sheet. The history gains a second tab, "Shared lists",
> where a signed in person finds every basket shared with them, with its owner and the date
> it was shared. A member can leave a basket they were given.
>
> Prerequisite reading: `0044` (the share sheet and the people sheet), `0045` and `0049`
> (the history), `0048` (the basket socket), backend `0114` in full, and the memory note
> on the refused checkbox (`plans-0074-0078-basket-filter`).

## Brief for the agent

### Objective

Build the people picker, use it in the get list sheet and the share sheet, add the Shared
lists tab to the history, and let a registered member leave, following sections 2 to 7.

### Context

- `GetListSheet` (`libs/velista/feature-home/src/lib/get-list-sheet/`) creates a basket from
  a zone and list checkbox tree.
- `ShareSheet` (`feature-shopping-lists/src/lib/share-sheet/`) knows only the link. The
  `PeopleSheet` lists participants and lets the owner remove one.
- `ShoppingListsPage` and `GeneratedListStore` hold one list with one cursor. There is no tab
  component in velista.
- `BasketSocket` mints a fresh participant token on every connect, and `ParticipantGuard`
  accepts an account token, so opening a shared basket needs no new session work.
- `BasketSocket.revoked` already drives `basket.revoked.*` on the basket page.
- Dates are formatted with `Intl.DateTimeFormat` into the view model (`velista-ui-rules`).
- A native checkbox flips before `change`, so a refused tick must set `event.target.checked`
  back by hand.

### Target state

Sections 2 to 7 hold, the tests in section 10 pass, and
`npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-home velista/feature-shopping-lists velista/feature-shell`
plus `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/ui/src/lib/` (the picker and the tabs), `libs/velista/data-access/src/lib/`
  (contacts, the shared list store, the participant calls, realtime mapping),
  `libs/velista/models`, `feature-home/src/lib/get-list-sheet/`,
  `feature-shopping-lists/src/lib/` (share sheet, people sheet, history page, history row),
  `feature-shell/src/lib/routes.ts` if the tab needs it, and the translation files.
- Do NOT touch: the backend, the join page, the guest flow.

### Constraints

- Use the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill for
  the picker, the tabs and the shared row.
- Rule D1: `ui` components take plain values. Rule D4: map from `unknown`.
- Ticks save at once. There is no Save button in the share sheet.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask if backend `0114` is not on `dev`.

### Progress evidence

Report after the picker, after each of its two uses, after the tabs, and after leaving,
each with its spec run.

## 1. What is being built

| Piece                              | Where                                          |
| ---------------------------------- | ---------------------------------------------- |
| Contacts                           | `data-access`, a contacts service and store    |
| `lib-people-picker`                | `velista/ui`                                   |
| "Share with" when creating         | `get-list-sheet`                               |
| People in the share sheet          | `share-sheet`                                  |
| `lib-tabs`                         | `velista/ui`                                   |
| The Shared lists tab and its store | `shopping-lists-page`, a new `SharedListStore` |
| The shared row                     | `shopping-list-row`, `models`                  |
| Leaving                            | `people-sheet`                                 |
| Copy                               | `en.json`, `es.json`                           |

## 2. The people picker

`lib-people-picker` takes the contacts grouped by group, the selected user ids, and the ids
busy saving, and emits a toggle with a user id and the new state.

- One section per group, headed by the group name, one row per member with their name in
  that group and a checkbox.
- **Selection is by person.** A person in two groups is ticked in both as soon as one is
  ticked.
- A busy row keeps its checkbox and sets `aria-busy`.
- With no contacts it says `share.people.none`.

## 3. Choosing people when creating

`GetListSheet` gains a "Share with" section after the sources, drawn when the contacts have
at least one person. The choice is kept in the sheet and sent as `memberUserIds` in the
create request. Nobody is chosen by default.

## 4. People in the share sheet

The share sheet gains a "People" section, owner only as the sheet is, with the picker. The
ticked people are the basket's live registered participants, so a person who joined by link
shows ticked.

- **Tick** sends `POST /v1/generated-lists/:id/participants` at once.
- **Untick** removes the participant with the existing route at once. Unticking a person who
  joined by link removes them for good, and the row says so before the untick through its
  hint `share.people.linkJoined`.
- A failure puts the checkbox back by hand and shows the error under the section.
- The participant list and the joined count follow the answers and the socket.

## 5. The history has two tabs

- `lib-tabs`: an ARIA `tablist` with roving `tabindex`, arrow keys, Home and End, each tab
  controlling one `tabpanel`.
- `ShoppingListsPage` draws "My lists" (the default) and "Shared lists". The chosen tab is
  the query parameter `tab=shared`, so reload and back keep it.
- **My lists** is the page as it is today.
- **Shared lists** reads `SharedListStore`: `GET /v1/generated-lists/shared`, its own cursor,
  loading, failure, empty state and load more on scroll, with the existing page announcement
  per page loaded.
- A shared row shows what a row shows today, plus `history.shared.byOn` with the owner's name
  and the shared date. The empty state says `history.shared.empty` and offers no Get list
  button.
- `GeneratedListShared` and `GeneratedListUnshared` on the user's own socket refresh the
  shared store quietly, coalesced as `GeneratedListStore` coalesces its refreshes.

## 6. Opening a shared basket

A shared row opens `shopping-lists/:id`, the route every basket uses. When the basket page
receives `GeneratedListUnshared` for the basket on screen, or its socket is revoked, it
shows the revoked state it already has.

## 7. Leaving

In the people sheet, a registered participant who is not the owner sees "Leave this list"
on their own row's detail pane. It opens a confirmation pane in the same sheet. Confirming
calls `DELETE .../participants/mine` and leaves to `shopping-lists?tab=shared` with
`leaveTo`. A guest never sees it.

The participant view now arrives without `joinedAt` for some readers (backend `0114` section 11). The
people sheet already has `basket.people.joinedUnknown` for that case, and the mapper must
treat the field as optional.

## 8. Copy

| Key                           | English                                                                   | Spanish                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `getList.people.label`        | Share with                                                                | Compartir con                                                  |
| `share.people.title`          | People                                                                    | Personas                                                       |
| `share.people.none`           | Nobody else is in your groups yet.                                        | Aún no hay nadie más en tus grupos.                            |
| `share.people.linkJoined`     | Joined with the link. Removing them also stops the link working for them. | Entró con el enlace. Si lo quitas, el enlace deja de servirle. |
| `share.people.failed`         | That did not save. Try again.                                             | No se ha guardado. Inténtalo de nuevo.                         |
| `history.tabs.mine`           | My lists                                                                  | Mis listas                                                     |
| `history.tabs.shared`         | Shared lists                                                              | Listas compartidas                                             |
| `history.shared.byOn`         | Shared by {owner} on {date}                                               | Compartida por {owner} el {date}                               |
| `history.shared.empty`        | Nobody shared a list with you yet.                                        | Todavía nadie ha compartido una lista contigo.                 |
| `basket.people.leave`         | Leave this list                                                           | Salir de esta lista                                            |
| `basket.people.leaveQuestion` | Leave "{name}"? You can come back with the link if you have it.           | ¿Salir de «{name}»? Puedes volver con el enlace si lo tienes.  |
| `basket.people.leaveConfirm`  | Leave                                                                     | Salir                                                          |

## 9. Accessibility

- The picker's group headings are headings, and each checkbox has the person's name as its
  label.
- The tabs follow the ARIA tabs pattern, and the tab panel is labelled by its tab.
- The leave confirmation moves focus to its question.

## 10. Tests

1. The picker ticks a person in every group once they are ticked in one, and emits one
   toggle.
2. The get list sheet sends `memberUserIds` for the chosen people and none when nobody is
   chosen.
3. The share sheet ticks live registered participants, posts on tick, deletes on untick, and
   restores the checkbox on failure.
4. `lib-tabs` moves with arrow keys, Home and End, and selects on activation.
5. The history opens on My lists, keeps `tab=shared` through a reload, and loads each tab's
   store only when it is first shown.
6. A shared row formats the owner and date with `Intl`, and the empty state has no Get list
   button.
7. A `GeneratedListShared` event refreshes the shared store once for a burst.
8. Leaving is offered to a registered participant only, and a confirmed leave calls the
   route and `leaveTo`.
9. The participant mapper accepts a view without `joinedAt`.

## 11. Acceptance criteria

- [ ] An owner chooses people when creating a basket, and adds or removes them later.
- [ ] A person in several groups is chosen once.
- [ ] The history has My lists and Shared lists, and a shared basket shows its owner and
      date.
- [ ] A member leaves a shared basket from the people sheet.
- [ ] Losing access to an open basket shows the revoked state.

## 12. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/models velista/data-access velista/feature-home velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
tools/dev/ng-slot.sh --up --apps velista --backend-slot <slot with 0114>
```

On the slot, share a basket with a second account in a second browser, check the tab,
leave, and `--down` when finished.
