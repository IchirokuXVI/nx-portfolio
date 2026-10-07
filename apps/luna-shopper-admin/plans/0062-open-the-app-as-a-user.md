# 0062 Open the app as a user

> Backend half: `apps/luna-shopper-backend/plans/0194` (an operator opens the app as a
> user). Build this plan only after `0194` is merged. Every route, field and error code
> named here is defined there, and `wire-types.ts` holds them once `0194` regenerated it.
> Velista `0133` draws what the operator sees after the link opens. This plan does not
> need it to be merged, but the link leads to a page that says nothing until it is.
>
> Asked for by the owner on 2026-10-07. A person reports a bug that happens only with
> their data, and the operator cannot see the app as that person sees it.

The page of a person gains one action. It asks why, starts a support session, and gives
the operator a link that opens the app as that person in a new tab.

## Brief for the agent

### Objective

Add "Open the app as this user" to the actions of a person. Ask for a reason in a dialog,
start the session, and show a link that the operator presses. Offer the action only where
the deployment allows it. Use the `nx-portfolio-angular-developer`,
`design-taste-frontend`, `antislop`, `antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read in the file it names, on `dev` at `b9eece51`.

- **The actions of a person** are the `named` list of the `USERS` descriptor
  (`libs/luna-shopper-admin/feature-people/src/lib/users.ts`). Today it holds "Resend
  confirmation", the role actions and "Delete account". Each has `available`, `confirm`
  and `run`.
- **One place declares an action** (admin plan `0045`). The list page and the record page
  both draw from the descriptor, and `row-actions.ts` runs an action from a page that is
  not a list.
- **A confirmation is a question with two buttons** (`ConfirmDialog` in
  `libs/luna-shopper-admin/ui`). It takes no field. Look in that library for a dialog
  that holds a form before you write one.
- **The directory calls** are in `libs/luna-shopper-admin/data-access/src/lib/directory/`
  (`ADMIN_USERS_PATH` is `/v1/admin/users`).
- **The app already asks the deployment what it is.** `GET /v1/admin/environment` gives
  the name that colours the rail (`libs/luna-shopper-admin/ui/src/lib/chrome/app-shell.ts`).
- **The view models are the wire types** (admin plan `0004`, section 2). Do not write a
  type beside `wire-types.ts`.
- **A browser blocks a window that a script opens after a request.** `window.open` is
  allowed only inside the press itself. A request that the press started is already too
  late.

### Target state

1. **The deployment says whether the action exists.** The data access layer reads
   `GET /v1/admin/impersonation` one time for the session of the operator and keeps
   `enabled`. A failed read counts as `false`.

2. **The action.** One entry in the `named` list of `USERS`, before "Delete account":
   - Its label is "Open the app as this user".
   - It is `available` only while `enabled` is true. It is offered for a guest too.
   - It is not `danger`. Red stays for what cannot be undone.

3. **The dialog.** The action opens a dialog and not a confirmation:
   - A sentence says what will happen: the app opens as this person, a strip says so on
     every screen, and the session ends by itself after two hours.
   - A `<select>` with a label, "Why are you opening this account?". Its options are the
     four codes of `ImpersonationReason`, in this order: "A reported bug", "A support
     request", "Testing", "Other". Nothing is chosen at first, and the first button is
     disabled until something is.
   - "Other" shows a `<textarea>` with a label, "What for?", required, 500 characters at
     most. The other three options show no text field and send no note.
   - The buttons are "Start session" and "Cancel".

4. **After the start.** "Start session" posts `POST /v1/admin/users/:id/impersonation`
   with `{ reason, note?, locale }`. `locale` is the language of the back office. The
   dialog then changes in place:
   - It shows one real link, `<a target="_blank" rel="noopener noreferrer">`, with the
     `url` of the answer and the text "Open as {name}". The operator presses it. No script
     opens a window.
   - It says that the link works one time and for one minute, and it counts down to
     `codeExpiresAt`. After that moment the link is replaced by "This link is too old" and
     a "Start again" button that returns to the reason.
   - After the press the link is gone, and the dialog says that the session is open in
     another tab and ends at the time of `expiresAt`, written with `Intl.DateTimeFormat`.
   - "Close" is always there.

5. **Refusals.** `impersonation_disabled` says that this deployment does not allow support
   sessions. A 404 says that the account no longer exists, and the page reads its list
   again. Every other refusal uses the sentence that `gatewayErrorKey` gives.

6. **The copy** is in the content language of the back office, in the translation assets
   of `feature-people`.

### Scope

- `libs/luna-shopper-admin/data-access` (two calls, the `enabled` read).
- `libs/luna-shopper-admin/feature-people` (the action, the dialog, the copy).
- `libs/luna-shopper-admin/ui` only if a dialog that holds a form does not exist and the
  new one belongs to every section.

### Constraints

- **The address of the app comes from the answer.** The back office holds no origin of the
  app, in the bundle or in its environment.
- **The `url` is shown only as the `href` of the link.** It is not written to the console,
  to a toast or to any storage, and the dialog drops it as it closes.
- **The reason is sent as its code.** The words of an option are copy, and they change.
- Every field has a `<label>`. The dialog closes on Escape and returns the focus to the
  control that opened it.
- No generated file is edited by hand.

### Action boundaries

- Stop and ask before you change `ConfirmDialog` or the contract of a named action.
- Do not add a list of sessions, a way to end one, or a history tab. Backend `0194`,
  section 1, leaves those out.
- Do not touch the backend or velista.

### Progress evidence

- `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` is green.
  The checks of a pull request never build the admin app, so run the build yourself.
- A walk in a browser on a slot with screenshots: the action on the page of a person, the
  dialog with "Other" chosen, the link, and the tab that it opens.
- The same page against a backend with the switch off: the action is absent.

## 1. Not in this plan

- **A page of past sessions.** The audit trail of auth holds them, and nothing reads it yet.
- **Ending a session from the back office.** The strip in the app ends it, and it ends by
  itself.
- **Opening the app from the list of people.** The action is declared one time, so the list
  draws it where it draws the others. This plan adds no second way in.

## 2. Decisions

- **A link that the operator presses, not a window that opens by itself.** A window opened
  after the request is blocked by the browser. A window opened before the request shows a
  blank tab while the request runs, and it stays blank when the request fails.
- **`noopener`.** The new tab gets a `sessionStorage` of its own and no handle on the back
  office. Velista `0133` keeps the whole support session in that storage.
- **"Testing" asks for no text.** The owner wanted one option that costs nothing to pick,
  so that a quick check does not teach an operator to type nonsense into a required field.
