# 0173: a person accepts the terms when an account is made

> Asked for by the owner on 2026-10-27, with plan `0172` (the two documents) and backend
> `0231` (the operator's settings and the recorded acceptance). Every account velista makes
> carries the version of the terms the person accepted, on all four ways an account is made:
> the email form, Google, the guest account a group creates, and the upgrade of a guest. A
> person who has not accepted the current version (everybody on the day this ships, and
> everybody again after the terms change) accepts it before the app goes on.
>
> The privacy policy is **linked, never accepted**. Only the terms are accepted.
>
> Every fact below was read on `docs/velista-privacy-terms-plans` (from `origin/dev` at
> `c6241a693`) on 2026-10-27, and backend `0231` as written in the same batch.
>
> "PR #846's Google plans" are its velista plan "the callback page trades a code for the
> pair" and its backend plan "a google sign in lands only on the account that asked for it".
>
> Prerequisite reading: backend `0231` sections 2 and 4 (the settings, the five paths, the
> two error codes, `AccountMeView.terms`, the accept route) and 6 (the rollout); velista
> `0172` target 1 (`OperatorSettingsStore`) and target 6 (the two routes); PR #846's velista
> Google plan (`GoogleSignIn.start()`); plan `0009` (credential flows, rules C1 to C3, section
> 5.5 on why rules are not conditions on the button, section 5.6 on Google); plan `0160` (a
> form says what is wrong before the request); plan `0071` (the startup gate) and `0072`
> (the update screen, the precedent for a cover in `AppLayout`); plan `0133` (support
> sessions); plan `0168` section 1 D5 (state `ui` draws lives in `platform`); rule D4.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code, `design-taste-frontend`
before you draw the prompt and the form, and `antislop` with `antislop-copywriting` before
you write copy. Draw the mock first (target 1).

### Objective

Register and upgrade share one form that carries a required "I accept the Terms" checkbox
and a linked privacy line, and both offer Google. Under every Google button (front door,
sign in, register, upgrade) one line says that continuing accepts the terms. Beside every
action that makes a guest account (create a group, join with a code, join from a link) one
line says that an account is made and the terms are accepted. Every one of these requests
sends `acceptedTermsVersion`. A signed in person whose account must accept the current
version sees a prompt that blocks the app until they accept, except on the pages they need
to read first. A stale version is answered by showing the new terms, never by a dead end.

### Context

- **Two forms, nearly the same.** `register-page.html` (96 lines) and `upgrade-page.html`
  (76 lines) draw the same three fields, the error and the submit; register adds the Google
  option (L86 to L88) and a sign in footer, upgrade adds the keepsafe note (L9) and a "Not
  now" footer (L71 to L75). Shared styles are a Sass mixin, `_credential-form.scss`, whose
  header records why plan `0009` chose a mixin over a shared component ("a form framework by
  the end of it"). The owner now asks for one form.
- **Upgrade offers no Google**, and its template says why (L68 to L70: "Google would lose the
  groups this screen just promised to keep"). That reason is gone: the gateway mints a state
  with the caller's `userId` (`google.controller.ts` L96 to L120) and the callback passes it
  as `linkUserId` (L230), which makes `googleLogin` convert the guest in place
  (`identity.service.ts` L1470).
- **No Google button goes anywhere.** `GoogleOption` (`libs/velista/ui/src/lib/auth/google-option.ts`
  L26 to L32) "records its tap and goes nowhere"; `continueWithGoogle()` pushes
  `'auth.google'` into `pendingRoutes` on sign in (`sign-in-page.ts` L197), register
  (`register-page.ts` L243) and the front door (`landing-page.ts` L248). `AuthActions`
  draws its own Google button on the front door (`ui/src/lib/home/auth-actions.html` L37 to
  L46). `googleOffered` is `!isGuest()` only, and nothing reads whether the deployment has
  Google at all. PR #846's velista Google plan builds `GoogleSignIn.start()` and says
  "offering Google is the owner's call and another plan": this is that plan.
- **Sign in with Google makes accounts.** `googleLogin` creates a user for a new person
  (`identity.service.ts` L1447 onward), so the sign in page's Google button is a way to make
  an account, and backend `0231` section 4.2 records an acceptance on it for existing
  accounts too.
- **Guest accounts.** The gateway mints a temporary user when an anonymous caller creates or
  joins a zone (`zone.controller.ts` L103 to L117, `identity.service.ts` L202). Velista calls
  `POST /v1/zones` and `POST /v1/zones/join` from `ZoneApi.createZone` and `joinZone`
  (`libs/velista/data-access/src/lib/zones/zone-api.ts` L96 and L141). Three screens start
  them for an anonymous person: `CreateGroupSheet` (its account notice shows only while
  submitting, `create-group-sheet.html` L66 to L74), `JoinCodeSheet` (no notice), and
  `JoinLinkPage` (a standing `guestNotice`, `join-link-page.html` L92 to L97). A share link
  join (`s/:secret`) makes a basket participant, not an account
  (`basket-sharing.controller.ts` L333 to L387), and is not in this plan.
- **The account read.** `ProfileStore` (`libs/velista/data-access/src/lib/account/profile-store.ts`)
  reads `GET /v1/account/me` (`account-api.ts` L126) and holds `appState` and
  `setupPending`. Backend `0231` section 4.4 adds `terms: { currentVersion, acceptedVersion,
  acceptanceRequired }` to that body, for guests too.
- **Covers in `AppLayout`.** `app-layout.html` L29 to L74 replaces the outlet with the update
  screen (`mustUpdate`) or the startup screen; `app-layout.ts` L88 reads `ConnectionState`
  from `platform`. `ui` may not inject `Router` or anything in `data-access`
  (`ui/src/lib/layering.spec.ts` L42). `app-providers.ts` is the one file that sees both
  libraries and wires them (`tour.setHoldings`, L443).
- **Support sessions.** `AppLayout` draws `lib-support-strip` from `supportSession()`
  (L5 to L16). Backend `0231` refuses the accept route in a support session
  (`@RefuseImpersonation()`).
- **The rollout of backend `0231`** (section 6): acceptance enforcement is a deployment
  switch, `TERMS_ACCEPTANCE_REQUIRED`, false everywhere until this plan ships; then the owner
  turns it on per cluster in the PR that raises `minClientVersion` to the first build of this
  plan, so an installed build from before cannot meet `terms_acceptance_missing`.
- **The staging gates.** `k8s/e2e/velista-luna/gate.sh` runs `velista-e2e` (stubbed, L126
  to L131) and `velista-luna-e2e` (real backend, L136 to L139). `velista-luna-e2e` signs in
  seeded demo users nine times through `support/app.ts` `signIn` (L20 to L26) and never
  registers or creates a group through the UI.

### Target state

1. **Mock first.** A mock folder `apps/velista/plans/mocks/terms/` in the shape of the other
   folders (`*.dc.html` artboards, `canvas.json`, `build-index.mjs terms`): the shared form
   in register and upgrade mode, the Google line under each of the four buttons, the guest
   notice in the three entry screens, the prompt, and the stale state. Night only, unless a
   colour role is new. Build it, then go on; the owner reviews it in the PR.
2. **The wire.** In `libs/velista/data-access`:
   - `AuthApi.register(email, password, acceptedTermsVersion)` and
     `upgrade(email, password, acceptedTermsVersion)` send the field (`0231` section 4.2).
   - `ZoneApi.createZone` and `joinZone` take an optional `acceptedTermsVersion` and send it
     only when the call is anonymous (no session held), because the gateway records nothing
     for a signed in caller (`0231` section 4.2, last rule) and a stale version would still
     be refused.
   - `AccountApi.acceptTerms(version)` posts `POST /v1/account/terms-acceptances` with
     `{ version }` and maps the 201 body (`TermsAcceptanceView { version, acceptedAt }`) from
     `unknown`.
   - The account mapper reads `terms` into the profile model as
     `terms: { currentVersion: string; acceptedVersion: string | null; acceptanceRequired: boolean }`;
     a missing block maps to `acceptanceRequired: false` (an older backend asks nothing).
   - `GatewayError` already carries `details` (`errors.ts` L40). A small pure function
     `termsRefusal(error): { kind: 'stale' | 'missing'; currentVersion: string } | null`
     reads `terms_version_stale` (409) and `terms_acceptance_missing` (400) and their
     `details.currentVersion`, with a spec.
3. **One form.** A component `AccountForm` in `libs/velista/feature-auth/src/lib/account-form/`,
   used by `RegisterPage` and `UpgradePage`, replacing their three fields, error and submit.
   It owns the email, the two passwords, the checkbox, the privacy line, the error slot, the
   submit, and the Google option with its line. Inputs: `mode: 'register' | 'upgrade'`
   (decides ids and the submit label), `submitting`, `error`, `termsUrl`, `privacyUrl`,
   `googleOffered`. Outputs: `submitted` with `{ email, password }`, `continueWithGoogle`,
   and the error action. The pages keep what differs: which call they make, register's
   conflict action and sign in footer, upgrade's keepsafe note and "Not now". Update the
   header of `_credential-form.scss` to say the form is now a component, and why (the owner,
   2026-10-27).
   - The checkbox is a native `input type="checkbox"` with its own `label`: "I accept the
     [Terms]", the link inside the label. Required. **Not a condition on the button**
     (plan `0009` section 5.5, plan `0160`): a submit with the box clear shows the
     sentence "Tick the box to accept the Terms" under it, sets `aria-invalid` and
     `aria-describedby`, focuses the box, and sends nothing.
   - Under it, not in a label: "Read how we use your data in the [Privacy Policy]".
   - Both links open the document as a **sheet over the form** (target 6), so nothing typed
     is lost.
   - The version sent is `settings().terms.version` of `OperatorSettingsStore` at the moment
     of the press.
4. **Google, offered.** This target needs PR #846's velista Google plan merged
   (`GoogleSignIn.start()` on `dev`). If it is not, build everything else, leave the buttons
   inert as today, and say so.
   - `GoogleSignIn.start()` gains an argument `{ acceptedTermsVersion }` and sends it in the
     body of `POST /v1/auth/google/state` beside the `codeChallenge` (`0231` section 4.2,
     `MintOAuthStateDto`). Coordinate in that file only.
   - The button is drawn when `features.googleSignIn` is true, on the front door, sign in,
     register and upgrade. Upgrade's guest is linked in place, because the state carries
     their bearer. Remove the upgrade comment at L68 to L70 and `GoogleOption`'s "records
     rather than navigates" section, and their `pendingRoutes` recordings.
   - Under every Google button, one line: "By continuing with Google you accept the
     [Terms]". `GoogleOption` and `AuthActions` take a `termsUrl` input and draw it; the
     line is part of the button's component so a fifth button cannot be added without it.
   - A refusal of the state (`terms_version_stale`, or any other) is shown beside the button
     on the screen the person pressed it on; see target 7.
5. **The guest notice.** On `CreateGroupSheet`, `JoinCodeSheet` and `JoinLinkPage`, while
   no session is held: one standing line beside the primary action, before it is pressed,
   "When you create or join a group, an account is made for you on this phone, and you
   accept the [Terms]" (the join screens say "join"). It replaces `entry.joinLink.guestNotice`
   and stands before the press on create (the `mintingAccount` line during submit may stay
   or merge; decide in the mock). The calls pass the version. No checkbox (the owner).
6. **The documents as sheets.** `feature-legal` (plan `0172`) gains `LegalSheet`: the same
   renderer and document inside `SheetShell`, with a link at its foot to the full page.
   `routes.ts` declares `sheet({ path: 'privacy' })` and `sheet({ path: 'terms' })`
   (through the `sheet()` helper, so `routes.spec.ts`'s rule holds) as children of
   `auth/login`, `auth/register` and `auth/upgrade`. The entry sheets and the front door
   link to the pages, because a sheet over a sheet is not a pattern this app has and the
   only typed value there is a short name.
7. **Stale and missing.** One helper per screen family maps `termsRefusal(error)`:
   - `stale`: reload `OperatorSettingsStore`, clear the checkbox, and show "The Terms changed
     while this page was open. Read them again, then accept them." with the link. The new
     version is the one sent next time.
   - `missing`: the same sentence without "changed" (it means this build sent no version
     where the server wants one, which `minClientVersion` should prevent).
   Keys in `auth-error-copy.ts` and `entry-error-copy.ts`, with specs.
8. **The prompt.** A root service `TermsGate` in `libs/velista/platform/src/lib/terms-gate.ts`
   with `required: Signal<boolean>` (default false), `version: Signal<string | null>`,
   `state: Signal<'idle' | 'accepting' | 'failed'>`, `report(required, version)` and
   `accept(): Promise<void>`, which calls an acceptor registered once by `app-providers.ts`
   (the data-access call, then a reread of `ProfileStore`). `app-providers.ts` feeds
   `report` from `ProfileStore.profile().terms`, as it feeds the tour (L443).
   - `AppLayout` draws `lib-terms-prompt` (new, `ui/src/lib/legal/terms-prompt.ts`) **in
     place of the outlet**, as the update screen does (`app-layout.html` L29 to L51), while
     `TermsGate.required()` is true, the session is not a support session, and the deepest
     route does not carry the new route data flag `READ_BEFORE_TERMS` (a constant in
     `platform`, read the way `StartupGate` reads its flags, `startup-gate.ts` L144 to
     L157).
   - `READ_BEFORE_TERMS: true` goes on `privacy`, `terms`, `auth/callback`, `auth/verify`,
     `auth/reset-password` and `auth/support-ended`: the pages somebody must be able to
     read, or a link they must be able to finish, before accepting.
   - The prompt: a heading ("We have new Terms" when an accepted version exists, "Before you
     go on" when none does), two sentences, links to the Terms and the Privacy Policy (the
     pages), one primary "Accept and continue", and a quiet "Sign out" (the only other way
     forward). No checkbox: the press is the acceptance, and the button says what it does.
     On `failed`, one sentence and the button again. On a stale answer, `ProfileStore`
     rereads and the prompt redraws with the new version.
   - In a support session the prompt is never drawn and accept is never called; the strip
     says nothing new (an operator must not accept for somebody).
   - Spec: drawn with required true; not drawn on a flagged route, in a support session, or
     with required false; accept calls the acceptor once and a second press while accepting
     does nothing.
9. **When the operator has published nothing.** With `published` false (plan `0172`), there
   are no terms to accept: the checkbox, the Google line and the guest notice are not drawn,
   and no version is sent. Backend `0231` refuses to boot with acceptance required and no
   documents (section 5.1), so this cannot meet the prompt.
10. **e2e.** Section 4.

### Scope

- Work only in: `libs/velista/feature-auth/src/lib/**`, `libs/velista/feature-entry/src/lib/**`,
  `libs/velista/feature-landing/src/lib/landing-page/*`, `libs/velista/feature-legal/src/lib/**`
  (the sheet), `libs/velista/feature-shell/src/lib/routes.ts` and `routes.spec.ts`,
  `libs/velista/data-access/src/lib/auth/**`, `.../zones/zone-api.ts` and `zone-store.ts`,
  `.../account/**`, the mappers and `testing/` doubles they touch,
  `libs/velista/platform/src/lib/terms-gate.ts` and its spec and barrel line,
  `libs/velista/ui/src/lib/auth/google-option.*`, `ui/src/lib/home/auth-actions.*`,
  `ui/src/lib/legal/terms-prompt.*`, `ui/src/lib/layout/app-layout.*`, `ui/assets/i18n/en.json`
  and `es.json`, `libs/velista/models/src/lib/` (the profile's `terms`),
  `apps/velista/src/app/app-providers.ts`, `apps/velista/plans/mocks/terms/**`,
  `apps/velista-e2e/src/**`, `apps/velista-luna-e2e/src/**`, `k8s/e2e/velista-luna/gate.env`
  and `compose.yml` (section 4.3 only). `GoogleSignIn` only for its one argument.
- Do not touch: anything under `apps/luna-shopper-backend`, `libs/luna-shopper/**`, the
  values files, `minClientVersion` (the owner raises it), the share link join, and plan
  `0174`'s composers.

### Constraints

- Angular 21, zoneless, standalone, signals, `inject()`. No `@angular/core/rxjs-interop` in
  `data-access` or `platform`.
- Rule D4 for every new body. Rule N1: no product name in a key, file or class.
- Rule C2 holds: a guest is never shown register. The shared form changes no route guard.
- Copy for people not at home with apps: short, ordinary words, the reason before the ask.
- The privacy policy is never a checkbox and never "accepted" in any copy.
- Prose in files has no dashes as punctuation.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs, lint, builds, slot runs and e2e.
- Stop and ask before changing a backend contract, turning acceptance on in a values file,
  editing a file outside the scope, or offering Google without PR #846's plan on `dev`.

### Progress evidence

Report each numbered target when done. Ground claims in tool results: specs, lint,
`npx nx build velista`, the two e2e runs (section 4), and a browser walk on a slot pointed at
a Luna slot running `0231` with `TERMS_ACCEPTANCE_REQUIRED=true`: register, upgrade a guest,
create a group signed out, the prompt for a seeded user, a stale version (change
`LEGAL_TERMS_REVISION` on the backend slot and restart it with the page open). Record in
"What the build decided".

## 1. Decisions

- **D1. The press is the acceptance where there is no form.** A checkbox only on the email
  form (the owner). Elsewhere a line under the action names what pressing it means, and the
  prompt's button says "Accept".
- **D2. One form component.** The owner asked; the 0009 objection (inputs for every label)
  falls away because the two modes differ by ids, one label and one note.
- **D3. The prompt replaces the outlet.** A cover over a live page would let presses reach
  it. The update screen is the precedent, and the pages a person must read first say so in
  route data rather than being listed in the layout.
- **D4. The flag lives on routes, not in a list.** As `RENDERS_WHILE_CONNECTING` and
  `WORKS_WITHOUT_BACKEND` do.
- **D5. Sheets over the auth forms, pages elsewhere.** Keeps typed passwords; avoids a sheet
  over a sheet.
- **D6. Google is offered here.** The line under the button is a promise about what the
  press does; a button that goes nowhere cannot keep it, and the consent screen is being
  published (PR #841).

## 2. Not in this plan

- The documents and the store (plan `0172`).
- The backend, the version and the switch (backend `0231`).
- `GoogleSignIn.start()` and the callback exchange (PR #846's plans).
- A share link participant accepting anything: no account is made.
- Raising `minClientVersion` and turning `termsAcceptanceRequired` on (the owner, `0231`
  section 6 steps 4 and 5).

## 3. Dependencies

- **Velista `0172`**: target 1 (the store) and target 6 (the routes). Without the routes the
  links have nowhere to go; stop.
- **Backend `0231`**: sections 2 and 4 on `dev` and in `openapi.json`. Stop without them.
- **PR #846's velista Google plan**: only target 4 waits on it.

## 4. e2e

### 4.1 Do the gates break?

- With `TERMS_ACCEPTANCE_REQUIRED` false (the default, `0231` section 6 step 1), the backend
  refuses nothing for a missing version and `acceptanceRequired` is false for everybody, so
  no prompt appears and every existing `velista-luna-e2e` spec passes unchanged. The new
  checkbox is on register and upgrade only, which no spec drives.
- `velista-e2e` stubs the gateway. An unstubbed `GET /v1/account/me` `terms` block reads as
  not required (target 2), so no prompt. The front door's Google button now depends on the
  settings stub (`features.googleSignIn`, false when the stub is absent). I found no spec of
  `velista-e2e` that names the Google button; `startup-gate.spec.ts` L26 and L70 find the
  create button by name, which the guest notice does not change. Run all three files.
- The review battery (`apps/velista-luna-e2e/reviews/2026-10-27-session-tokens`) registers
  through the API with no version. It is not in the gate; it breaks only once acceptance is
  on, and its `register` helper then needs `acceptedTermsVersion` read from
  `GET /v1/legal/settings`. Note it in its report rather than fix it here.

### 4.2 New specs

- `velista-e2e/src/terms.spec.ts`, stubbed: `me` with `acceptanceRequired: true` draws the
  prompt over home, `/en/terms` opens under it, Accept posts the version and the prompt
  goes; register with the box clear shows the sentence and sends nothing.
- `velista-luna-e2e/src/terms.spec.ts`, real backend with acceptance on: register through
  the UI with the box ticked and land on home (then `GET /v1/account/me` says accepted);
  create a group signed out, see the notice, land in the group, and read `acceptedVersion`.

### 4.3 Turning acceptance on in the gate

`0231` section 6 step 5 leaves this to this plan: in `k8s/e2e/velista-luna`, give the compose
invented operator values (`LEGAL_CONTROLLER_NAME=Example Controller`,
`LEGAL_CONTACT_EMAIL=privacy@example.org`, keys of `0231` section 5.1) and
`TERMS_ACCEPTANCE_REQUIRED=true`. Then the seeded demo users have accepted nothing, and
every `signIn` would meet the prompt. Fix that **once, in `global-setup.ts`**: after seeding,
for each demo user the specs sign in as, `POST /v1/auth/login` then
`POST /v1/account/terms-acceptances` with the version from `GET /v1/legal/settings`
(helpers in `support/api.ts`). Specs stay about their subject, and the prompt is proved by
the stubbed spec. Do this in the same PR, after the UI sends the version everywhere, never
before (the gate would turn red for a UI that does not exist).

## 5. Decisions that are the owner's

- **O1.** Whether the gate runs with acceptance on (section 4.3) or keeps the default.
- **O2.** The order on the day: this plan deployed, then `termsAcceptanceRequired: true` with
  the `minClientVersion` raise, staging then production (`0231` section 6).
- **O3.** Google offered on all four screens once PR #846 lands (D6).
- **O4.** "Sign out" as the only way past the prompt besides accepting. The alternative is
  to also offer "Delete my account", which is a right the policy names; I left it on the
  account page, which the prompt blocks. If the owner wants it reachable without accepting,
  add `READ_BEFORE_TERMS` to `account/sheet/confirm/delete` and a link on the prompt.

## 6. Choices that are mine

- `AccountForm`, `TermsGate`, `READ_BEFORE_TERMS`, `termsRefusal`, `LegalSheet`,
  `lib-terms-prompt`, and every key name.
- The routes flagged `READ_BEFORE_TERMS`.
- The guest notice text and its place before the press.
- The checkbox answered on submit rather than disabling the button.
- Accepting the e2e demo users in global setup rather than in the seed (the seed is backend
  tooling outside velista's scope; a later backend change may move it there).
