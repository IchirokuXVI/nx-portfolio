# 0148: a forgotten password has a way back

> Asked for by the owner on 2026-10-14, together with backend `0210`: a reset screen that can
> be skipped to sign in with the password kept, a reset mail with a reset link and a sign in
> link that share one token, and no error for a person who opens the sign in link while
> already signed in as the owner of the link.
>
> **The whole reset flow is missing in velista**, which is why this is its own plan. The
> backend has served `forgot-password` and `reset-password` since backend `0022`. Velista
> calls only the first, from the account page, so a person who is signed in can ask for a
> link that opens a page that does not exist, and a person who is signed out cannot ask at
> all. The reset mail points at `/reset-password`, and the staging values file calls that "a
> placeholder for a page the app does not have".
>
> **Build backend `0210` first.** It adds the sign in route, moves the mail URL to
> `/auth/reset-password` and puts the second link in the mail.
>
> **Every page is mocked before development** (the velista rule). Stage 0 of this plan is the
> mock, and the owner picks before stage 1 starts.
>
> Prerequisite reading: backend `0210` and `0022`, velista `0009` (credential flows), `0015`
> sections 5.6 to 5.9 (the account page and its password row), `0133` (the support session
> handoff page), the page rule, the sheet rule and the back rule in `CLAUDE.md`,
> `apps/velista/plans/mocks/auth/`, `libs/velista/feature-auth/src/lib/` (all five pages and
> `_credential-form.scss`, `auth-error-copy.ts`), `libs/velista/feature-shell/src/lib/routes.ts`
> (the `auth/*` routes), `libs/velista/data-access/src/lib/auth/` (`auth-api.ts`,
> `auth-service.ts`, `auth-memory.ts`, `account-notice.ts`) and
> `libs/velista/feature-account/src/lib/account-page/account-page.ts` (`changePassword`).

## The owner's picks of 2026-10-14

The mock of stage 0 is in pull request #713 (canvas
https://claude.ai/artifact/CLPwYdPNXmALuLm9X3G593). The owner answered it. **Where this
section and a later section disagree, this section is right.**

1. **Reset mode is design C** of `ResetModeOptions.dc.html`: the OR rule and the outlined
   "Keep my password and sign in" button.
2. **Sign in mode shows no screen.** The sign in link spends the grant as the page loads and
   lands on the home page (`SIGNED_IN`, or `ALREADY_SIGNED_IN` for the owner, with no error).
   The only screen it can show is the confirm of item 3, when a different account is signed in
   on this device, and the dead link screen. The confirm has no "set a new password" option.
   `SignInModeOptions.dc.html` is thus dropped. While the request runs, the page shows the
   quiet loading state the auth pages already use, and nothing else.
   - The risk the owner accepted: a mail scanner that runs scripts (Microsoft Defender Safe
     Links is one) can spend the grant before the person clicks, and the link then arrives
     dead. The reset link still waits for a button press.
3. **The confirm for a different registered account stays** (`OtherAccount.dc.html`). It is an
   informative message and one button that continues.
4. **The guest confirm is the same informative message and one button.** Its last paragraph
   carries a plain text link to the upgrade page (`auth/upgrade`), which keeps the groups. No
   second button.
5. **Each confirm shows the email and the username** of the account signed in on this device,
   always. Never only a first name.
6. **A sign in link opened while a different account is signed in goes home and asks in a
   sheet** (the owner, later the same day). The page sends one `recoverySignIn` with the
   bearer and no `switchAccount`. That request spends nothing for another account: it answers
   `recovery_other_account` and leaves the grant live. The page then navigates to the home
   page and opens a sheet over it (a child route built with `sheet()`), which explains that
   the person must sign out to use the link. The token stays in memory and never enters the
   sheet URL. The sheet button retries with `switchAccount: true`. Dismissing the sheet, or
   leaving, spends nothing, and the link works again later. The owner chose this one request
   over putting the user id in the link. This replaces the in-page confirm of picks 3 and 4
   for sign in mode; their content (one button, the email and the username, the text link for
   a guest) moves into the sheet. The confirm before a reset in reset mode is unchanged.
7. **No support session frame.** A recovery link is how support hands a person a way back in
   when they lost access to their email. It has nothing to do with a support session (velista
   `0133`). The backend still refuses the route inside one; velista shows that answer as the
   dead link screen, with no copy of its own.

## Brief for the agent

### Objective

A person who forgot their password can ask for a link from the sign in page. The link opens
a page that sets a new password, or signs them in with the old one kept. The sign in link
from the mail opens the same page ready to sign in. Nothing is spent until the person presses
a button.

### Context

Each statement below was read on `dev` at `c6962472`. Read each file again before you rely on
a line of it.

- **`AuthService.forgotPassword(email)`** exists and answers a `ResendOutcome`. Only the
  account page calls it. The sign in page has no "forgot password" entry.
- **No `resetPassword` exists** in velista data access, and no route serves
  `auth/reset-password`.
- **The auth pages share `_credential-form.scss`** and one error copy file. `VerifyEmailPage`
  is the closest page in shape: public, `NO_NAV_CHROME`, reads `?token=`.
- **Sign in answers one error** for an unknown address and a wrong password, and
  `forgot-password` answers the same for every address. The page never says whether an
  account exists and never claims delivery.
- **Rule C2.** A guest must never be shown register, because a new account strands the
  groups of the guest. Replacing the session of a guest with another account strands them
  the same way.
- **Support sessions** (velista `0133`) run in this app. Backend `0210` refuses the sign in
  route inside one.
- After backend `0210`: `POST /v1/auth/recovery-sign-in` `{ token, switchAccount? }`, optional
  bearer, answers `{ outcome: 'SIGNED_IN', tokens }` or `{ outcome: 'ALREADY_SIGNED_IN' }`, or
  `recovery_other_account` (409) when another user is signed in and a live grant is not yet
  spent. `POST /v1/auth/reset-password` `{ token, password }` answers a token pair and signs
  every other device out. A sign in signs nobody out.

### Target state

**Stage 0: the mock.** Load `design-taste-frontend`, `antislop`, `antislop-ui`,
`antislop-copywriting` and `antislop-human` before drawing. Add artboards to
`apps/velista/plans/mocks/auth/` beside the existing ones, built with the same chrome, tokens
and credential form, and regenerate `index.html` with `build-index.mjs`. Draw:

1. The sign in page with the "Forgot your password?" entry.
2. The forgot password page: the address field, the sent state (never a claim of delivery),
   the wait.
3. The reset page in reset mode: the new password field, the primary "Save new password",
   and the quiet "Keep my password and sign in".
4. The reset page in sign in mode: one primary "Sign in", and a quiet "Set a new password
   instead".
5. The confirm when somebody else is signed in on this device, once for a registered account
   and once for a guest. The guest version says plainly that their lists stay with the guest
   account on this device and will be lost.
6. The used or expired link, with a way to ask for a new one.

Draw two or three alternatives for items 3 and 4 on one canvas, quiet first and at most one
louder. Follow the owner's taste: no tinted containers, reuse what the auth pages already
have, the reason before the request, short sentences in ordinary words. Publish the canvas
and **stop for the owner's pick**.

**Stage 1: the build**, from the picked artboards.

1. **Data access** (`libs/velista/data-access/src/lib/auth/`). `AuthService` gains
   `resetPassword(token, password)` and `recoverySignIn(token, { switchAccount })`. The api
   implementation maps each body from `unknown` into velista models (rule D4), persists a
   token pair through `TokenStore` as `login` does, and answers a union the page switches
   on: `signed-in`, `already-signed-in`, `other-account`, `link-dead`, `refused-in-support`,
   `failed`. `auth-memory.ts` and the store doubles gain both.
2. **Routes** (`feature-shell/src/lib/routes.ts`). `auth/forgot-password` with the guard that
   `auth/login` carries, and `auth/reset-password`, public, beside `auth/verify`. Both
   `NO_NAV_CHROME`. A route spec asserts both.
3. **The sign in page** gets the entry, which carries the typed address to the forgot page.
4. **The forgot password page** calls `forgotPassword` and shows the outcome with the wait
   from the server (rule C3).
5. **The reset page** (`feature-auth/src/lib/reset-password-page/`).
   - It reads `token` and `mode` once, keeps the token in the component, and replaces the URL
     without them, so the token is not left in history or sent as a referrer.
   - **Reset mode never spends on load.** Each action is a button press (design C).
   - **Sign in mode spends on load** (the owner's pick 2), once per page instance.
   - Reset mode submits `resetPassword` and lands on the home page with an account notice:
     "Password changed. Other devices are signed out."
   - "Keep my password and sign in" and the sign in mode both call `recoverySignIn`.
     `already-signed-in` lands on the home page with no error. `other-account` shows the
     confirm of the owner's picks 3 to 5, and its button retries with `switchAccount: true`.
   - When somebody else is signed in and the person submits a new password, the page shows
     the same confirm first, because a reset replaces the session too.
   - `link-dead` and `refused-in-support` both show the dead link screen.
   - The back control is `PageNavigation.back` with the sign in page as the fallback.
6. **Copy** in English and Spanish in `libs/velista/ui/assets/i18n/` (the assets live outside
   `src`). No product name in a key (rule N1).
7. **The account page** keeps its password row. Its copy still says that a reset signs other
   devices out, which stays true for the reset link.

### Scope

- `apps/velista/plans/mocks/auth/` (stage 0).
- `libs/velista/data-access/src/lib/auth/` and its testing doubles.
- `libs/velista/feature-auth`, `libs/velista/feature-shell/src/lib/routes.ts`,
  `libs/velista/ui/assets/i18n/`.

### Constraints

- Follow the velista UI rules: tokens only (no raw pixels), the 4px space scale, `100svh`,
  `Intl.DateTimeFormat` for any date, a local `visually-hidden`, focus on the first field only
  where the page exists to type one value.
- Reuse `_credential-form.scss`, the existing error copy pattern and the existing icons from
  `libs/shared/ui`. No raw `<svg>`.
- No `@angular/core/rxjs-interop` in a service.
- Never say whether an address has an account. Never claim a mail was delivered.
- A guest is never sent to register (rule C2), and a guest session is never replaced without
  the confirm of stage 0 item 5.

### Action boundaries

- Stop after stage 0 and wait for the owner's pick. Do not write stage 1 code before it.
- Stop and ask before you add an authenticated "change password with the current password"
  flow. Velista `0015` section 5.6 decided against it.
- Do not touch the backend or the admin app. Backend `0210` owns both.

### Progress evidence

- Stage 0: the published canvas link and the artboard list in the report.
- Stage 1: `npx nx affected -t lint test` is green, and `npx nx build velista` is green.
- A browser walk on a slot against a Luna slot with backend `0210`, pasted in the report:
  forgot password from the sign in page, both links read from Mailpit, the sign in link used
  while signed out, a second link opened by its owner while signed in (home, no error), a
  link opened while a guest is signed in (the confirm), a reset, and a used link refused.

## 1. Not in this plan

- The backend and the admin actions. Backend `0210`.
- A change of password with the current password.
- A sign in link for a Google only account, or for a guest (backend `0210` section 1).

## 2. Decisions

- **One page with two modes**, not two pages. The owner's "skip the restore screen" is a
  button on the reset page, and the sign in link opens the same page in the other mode.
- **The confirm before replacing a session** is mine. Without it a link opened on a shared
  device signs the current person out with no word, and on a guest device it strands the
  groups of the guest. **Owner** can drop it for registered accounts.
- **The token leaves the URL** as soon as the page reads it.
