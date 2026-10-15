> **PR:** [#727](https://github.com/IchirokuXVI/nx-portfolio/pull/727)

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

## What the build decided

The build of 2026-10-15 settled the points below. None was asked of the owner, so each is a
choice of the builder that the owner can overturn. Where this section and a later section
disagree, this section is right.

1. **The dialog is the panel of the action, in the frame backend `0210` built.** Backend
   `0210` gave a named action a second answer, `ActionOutcome` of kind `panel`, drawn in
   `ActionOutcomeDialog` (`feature-resource`). "Open the app as this user" has no `confirm`,
   and its `run` answers at once with `ImpersonationPanel`. The panel asks the reason,
   starts the session and holds the link. So `ConfirmDialog`, the contract of a named
   action and `libs/luna-shopper-admin/ui` are unchanged.
2. **No separate "Cancel".** The frame of every action panel has one way out, "Close", and
   it is there in every step. A "Cancel" beside it would do the same thing. Target state 3
   names both; the build draws "Start session" and the frame's "Close".
3. **The action is on the page of a person only (`recordOnly`).** The list drops every
   action whose answer is a panel, because it has nowhere to draw one. Section 1 already
   leaves the list out.
4. **The write is declared in `users.ts`.** The descriptor builds the function that calls
   `startImpersonation` and hands it to the panel, so `actions-declared-once.spec.ts` still
   finds each write in one file. The same function reads the list again after a 404.
5. **The two calls are on `DirectoryServiceI`**, beside the other person actions:
   `impersonationEnabled()` and `startImpersonation()`. The `enabled` read is
   `ImpersonationStore` in the same folder. It keeps the answer with the operator who
   asked, reads nothing while nobody is signed in, and asks again after a sign in as
   somebody else. The descriptor starts the read as it builds the actions.
6. **No new type.** `ImpersonationStart`, `ImpersonationSession` and `ImpersonationReason`
   are aliases of the wire types. The answer is still read from `unknown`, so that only an
   absolute http(s) `url` can become an `href`.
7. **The memory twin says the switch is on**, with a link on `velista.invalid`, as the
   recovery links do. The dialog can then be driven with no backend.
8. **The copy is in `libs/luna-shopper-admin/ui/assets/i18n/en.json`**, under
   `people.users.impersonate`. Target state 6 names the assets of `feature-people`, which
   has none: every key of the back office is in that one file.
9. **Focus.** The dialog gives the focus back, as it closes, to the control that had it as
   it opened, which is the toggle of the More menu. A step that takes the focused control
   away hands the focus on: to the link, to "Start again", or to the sentence that says the
   tab is open.
10. **The press, and the minute.** A click or a middle click on the link counts as the
    press. "Open in new tab" from the context menu cannot be seen, so there the link stays
    until its minute ends. The minute is counted from the arrival of the answer, on the
    clock of the browser, by the code lifetime of backend `0194` (60 seconds, kept in the
    panel as `IMPERSONATION_CODE_LIFETIME_MS`). `codeExpiresAt` is a time on the clock of
    the server, so it is not compared with the clock of the browser: an operator clock a
    minute fast would make every link too old as it arrives. The `Date` header of the
    answer could correct for that, but a browser does not expose it to a script across
    origins. The cost is that the countdown runs a little long by the time the answer took
    to arrive, and changes by hand if backend `0194` changes its lifetime. The server still
    refuses a code that is too old. Only the address is held in its own signal. The rest
    of the answer is kept without it, so the press and the end of the minute drop it from
    the panel and not only from the page. An answer that arrives after the dialog closed
    is dropped, and starts no clock.
11. **Two refusals are final.** After `impersonation_disabled` or a 404, "Start session"
    stays disabled. Every other refusal leaves it enabled.
12. **`gatewayErrorKey` is unchanged.** Of the five codes of backend `0194`, only
    `impersonation_disabled` can answer an admin route, and the dialog has its own sentence
    for it. The other four answer user tokens.
13. **The record page reads the record again as the dialog opens.** It does that after
    every action that went through, and here the action is only the opening.
14. **`ImpersonationStore` is `providedIn: 'root'`**, as `DashboardStore` and
    `PostalCodeSummaryStore` are. The stores of the session and the deployment are listed
    in `LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS` instead. To move it there, every spec
    that draws the actions of a person would have to provide it, so it stays where it is.
    An answer that arrives after another operator signed in is dropped, so it cannot hide
    the action from that operator.
15. **The lifetime now comes from the answer** (follow up PR [#PRNUM](https://github.com/IchirokuXVI/nx-portfolio/pull/PRNUM)). The start
    answer carries `codeTtlMs`, which is `IMPERSONATION_CODE_TTL_MS` of auth passed through
    by the gateway, and the panel counts the arrival plus that value.
    `IMPERSONATION_CODE_LIFETIME_MS` is gone. An answer with no usable `codeTtlMs`, from a
    gateway older than the field, reads as 60 seconds (`FALLBACK_CODE_TTL_MS`). The rest of
    point 10 holds.

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
