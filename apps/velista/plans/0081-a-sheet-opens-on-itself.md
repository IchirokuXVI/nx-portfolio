# 0081: a sheet opens on itself

> Every sheet in velista moves focus to its first focusable element when it opens, and in
> thirteen of the twenty one sheets that element is a text field, so the phone keyboard
> covers half of a sheet the reader has not read yet. This plan makes a sheet focus itself
> by default, and keeps focusing the first control as an option for the few sheets whose
> only job is to type one value.
>
> Prerequisite reading: `libs/velista/ui/src/lib/entry/sheet-shell.ts` in full, and the
> sheet rules in CLAUDE.md ("Sheets are addressed under a `sheet` segment").

## Brief for the agent

### Objective

Change `SheetShell`'s initial focus to the panel, add an opt in input that restores
first control focus, and decide for every one of the 21 sheets in section 4 whether it
opts in, using the rule in section 3.

### Context

- `SheetShell` focuses `this._focusable()[0]` in `afterNextRender` and restores focus on
  dismiss. `wrapFocus` traps Tab inside `.panel`.
- The panel is `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, with **no
  `tabindex`**, so it cannot take focus today.
- `sheet-shell.spec.ts` asserts the current rule ("moves to the first control inside, which
  is the field").
- No sheet moves focus itself. `LineDetailSheet`'s title already has `tabindex="-1"`.

### Target state

Opening any sheet that does not opt in puts focus on the panel and opens no keyboard. The
sheets section 4 marks `first` focus their first control as today. Tab from the panel
reaches the first control, Shift+Tab reaches the last. All specs pass.

### Scope

- Work only in: `libs/velista/ui/src/lib/entry/sheet-shell.*`, the templates of the sheets
  that opt in (section 4), and the specs beside them.
- Do NOT touch: any sheet's content, copy or layout beyond adding the input binding.

### Constraints

- Use the `nx-portfolio-angular-developer` skill.
- The input is `initialFocus = input<'panel' | 'first'>('panel')`. No other values.
- The panel's focus must not draw a focus ring for programmatic focus. It must still draw
  one if a keyboard user reaches it. Use `app-focus-ring` from `_semantic.scss` with
  `:focus-visible`.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in-scope edits and tests.
- Stop and ask if a sheet's first control is not what section 4 says, and the difference
  changes the decision.

### Progress evidence

Report the shell change with its spec run first, then one line per sheet with the decision
taken and the reason.

## 1. What is being built

| Piece                                        | Where                                |
| -------------------------------------------- | ------------------------------------ |
| Panel focus by default, `initialFocus` input | `sheet-shell.ts`, `sheet-shell.html` |
| `tabindex="-1"` on the panel                 | `sheet-shell.html`                   |
| Tab from the panel enters the controls       | `wrapFocus` in `sheet-shell.ts`      |
| The opt in, per sheet                        | the templates in section 4           |

## 2. The shell

- On open, `initialFocus() === 'panel'` focuses `.panel`, and `'first'` keeps today's code
  path unchanged.
- `wrapFocus`: with focus on the panel itself, Tab moves to the first focusable element and
  Shift+Tab to the last.
- Focus return on dismiss does not change.
- A screen reader hears the dialog's label on open, because the labelled dialog is what
  takes focus. This is the reason to focus the panel and not the title.

## 3. The rule for opting in

A sheet opts in to `first` **only when its whole purpose is to type one value, and there is
nothing on it to read or choose before typing**. A sheet with a warning to read, a list to
look at, or more than one kind of control stays on `panel`. A typed confirmation of a
destructive act stays on `panel`, because the warning comes first.

## 4. Every sheet, and the proposed decision

Read each template before deciding. The "first focusable" column is what the code had on
2026-09-13.

| Sheet                                          | First focusable today          | Proposed | Reason to verify                 |
| ---------------------------------------------- | ------------------------------ | -------- | -------------------------------- |
| `ui/.../zone/confirm-sheet`                    | primary button, or typed input | panel    | a warning comes first            |
| `feature-lists/.../list-settings-sheet`        | name input                     | panel    | several settings                 |
| `feature-lists/.../line-detail-sheet`          | a settle button                | panel    | reading the line comes first     |
| `feature-lists/.../edit-line-sheet`            | content input                  | panel    | deleted by `0083` if built first |
| `feature-lists/.../comments-sheet`             | audio button or textarea       | panel    | the thread comes first           |
| `feature-account/.../rename-sheet`             | name input                     | first    | one field                        |
| `feature-account/.../location-sheet`           | primary button                 | panel    | a choice                         |
| `feature-account/.../delete-account-sheet`     | typed input                    | panel    | a warning comes first            |
| `feature-account/.../confirm-email-sheet`      | resend link or Close           | panel    | a message                        |
| `feature-home/.../get-list-sheet`              | History button or name input   | panel    | several sections                 |
| `feature-entry/.../join-code-sheet`            | code input                     | first    | one field                        |
| `feature-entry/.../create-group-sheet`         | name input                     | first    | check for other controls         |
| `feature-shopping-lists/.../finish-sheet`      | Cancel                         | panel    | a decision                       |
| `feature-shopping-lists/.../shop-picker-sheet` | back chevron                   | panel    | a list                           |
| `feature-shopping-lists/.../filter-sheet`      | Reset                          | panel    | choices                          |
| `feature-shopping-lists/.../share-sheet`       | Copy                           | panel    | several actions                  |
| `feature-shopping-lists/.../settle-sheet`      | Change or Got all              | panel    | a decision                       |
| `feature-shopping-lists/.../people-sheet`      | first person                   | panel    | a list                           |
| `feature-zones/.../group-settings-sheet`       | name input                     | panel    | several settings                 |
| `feature-zones/.../member-action-sheet`        | rename input                   | panel    | several actions                  |
| `feature-zones/.../create-list-sheet`          | name input                     | first    | check for other controls         |

The sheets that reuse `lib-confirm-sheet` (delete line, delete profile, group delete,
member actions) inherit its decision.

## 5. Tests

1. `SheetShell` with no input focuses `.panel` on open.
2. With `initialFocus="first"` it focuses the first control, as the existing spec asserted.
3. Tab from the focused panel lands on the first control, Shift+Tab on the last.
4. Focus returns to the opener on dismiss in both modes.
5. One spec per opted in sheet asserts its first control has focus after open.
6. One spec for `group-settings-sheet` and one for `list-settings-sheet` assert that no
   input has focus after open.

## 6. Acceptance criteria

- [ ] Opening group settings or list settings on a phone opens no keyboard.
- [ ] Every sheet in section 4 has a recorded decision in the PR description.
- [ ] Keyboard users can still reach every control from the panel with Tab.
- [ ] `npx nx run-many -t lint test -p velista/ui velista/feature-lists velista/feature-account velista/feature-home velista/feature-entry velista/feature-shopping-lists velista/feature-zones`
      is green.

## 7. Verification

```sh
npx nx run-many -t lint test -p velista/ui velista/feature-lists velista/feature-account velista/feature-home velista/feature-entry velista/feature-shopping-lists velista/feature-zones
npx nx build velista
```

Then, on a slot (`tools/dev/ng-slot.sh --up --apps shell,velista`), open group settings,
list settings and the join code sheet with a phone viewport and check which one raises the
keyboard.
