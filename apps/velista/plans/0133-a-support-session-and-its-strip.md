# 0133: a support session and its strip

> Asked for by the owner on 2026-10-07. An operator opens the app as a user to see a bug
> that happens only with the data of that user. While that lasts, a strip at the top of
> every screen says so, and nothing can put it away.
>
> **Needs backend plan `0194` first** (an operator opens the app as a user). It serves the
> exchange route, the end route, the `act` claim and the error codes named here. If its
> contract is not on your base branch, stop and say so. Admin plan `0062` is the other
> client of `0194`, and this plan does not need it.
>
> The mock is `apps/velista/plans/mocks/impersonation/`. The owner chose the strip at the
> top on 2026-10-07, with no frame round the screen. The canvas with the four placements
> that were compared is https://claude.ai/artifact/KwRJ4dV4AZbnVFjgvDhb76.
>
> Prerequisite reading: backend `0194` (all of it), velista `0067` (two documents on one
> origin), `0097` (the bar at the bottom), `0106` (the page slot scrolls), `0130` (one
> header), `libs/velista/platform/src/lib/browser-facade.ts`, `storage-keys.ts`,
> `libs/velista/data-access/src/lib/auth/token-store.ts`, `access-token-expiry.ts`,
> `libs/velista/feature-auth/src/lib/auth-callback-page/`,
> `libs/velista/ui/src/lib/layout/app-layout.html` and `app-layout.scss`.

## Brief for the agent

### Objective

Take a handoff code from the address, trade it for the session of a user, and keep that
session inside one tab. Draw a strip above the app for as long as the session lasts, with
the name of the user, the time that is left and a control that ends it.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills, and read the velista UI rules in `CLAUDE.md`
before you touch a template.

### Context

Every statement below was read on `dev` at `b9eece51`.

- **The session is in `localStorage`**, under `StorageKeys.session`. `TokenStore` writes
  it there, and it follows the `storage` event: a pair that another document wrote is
  adopted, and a removal signs this document out (plan `0067`).
- **That is the trap.** An operator often has an account of their own in this browser. A
  support session written to `localStorage` replaces that account in every tab, and two
  hours later it signs every tab out.
- **`BrowserFacade` is the door to storage.** It has `readStorage`, `writeStorage`,
  `removeStorage` and `watchStorage` over `localStorage`, and the same three reads and
  writes over `sessionStorage`. Other files name storage too: `session-validation.ts`,
  `theme-store.ts`, `basket-page.ts` and `walk-db.ts` (IndexedDB). Read each one.
- **The client already decodes the access token** for its `exp`
  (`libs/velista/platform/src/lib/access-token-expiry.ts`).
- **`AuthCallbackPage`** is the one page that takes a session from the address. It reads a
  fragment, calls `TokenStore.set` and goes to home. Its route is `auth/callback` in
  `libs/velista/feature-shell/src/lib/routes.ts`.
- **`AppLayout`** is the chrome. Its `main` holds the page slot and the bar. The tour and
  the connection cover are drawn outside `main`. The whole app is `100svh` tall
  (`app-layout.scss`). `libs/velista/ui` reads state from `@portfolio/velista/platform`
  and never from `data-access` (rule D1).
- **No strip exists today** that every page shows. The guest banner belongs to home, and a
  person can put it away.

### Target state

1. **A tab knows that it holds a support session.** `sessionStorage` holds a marker under a
   new key in `StorageKeys`. A new platform service, `ImpersonationState`, reads it one
   time as the document starts. It answers `active` for the life of the document.

2. **An active tab keeps everything to itself.** While `ImpersonationState` is active,
   `BrowserFacade.readStorage`, `writeStorage` and `removeStorage` use `sessionStorage`,
   and `watchStorage` delivers nothing. So the session of the user, the last list, the
   view of the basket and every other key of `StorageKeys` live in the tab and end with
   it. The account of the operator in `localStorage` is neither read nor written. Each
   storage door that does not go through the facade is moved behind it, or the report
   names it and says why it is safe.

3. **The handoff page.** A new route `auth/impersonate`, beside `auth/callback`, with no
   guard that needs a session:
   - It reads `code` from the fragment and removes the fragment from the address with a
     replace, before any request.
   - It posts the code to `POST /v1/auth/impersonation/exchange`.
   - On success it writes the marker, then the pair through the facade, and then loads the
     home address as a new document (`location.replace`). A new document is what makes
     every store start from the storage of the tab and not from the account it held.
   - On `impersonation_code_invalid`, or with no code, it draws one sentence: the link is
     used or too old, and the operator opens a new one from the back office. It offers no
     way into the app.

4. **The state the strip reads.** `ImpersonationState` exposes a signal: `null`, or
   `{ username, until }`. `data-access` writes it from the pair: the name from
   `SessionTokens`, and `until` from the `act` claim of the access token. A pair with no
   `act` in an active tab is a defect, and the tab then ends the session (point 7).

5. **The strip.** A new presentational component in `libs/velista/ui`, drawn by
   `AppLayout` as the first thing in the document, above `main`, and only while the signal
   is not `null`:
   - 44px tall, plus the top safe area inset. Full width. One row: an eye icon, "Viewing
     as **marta_r**", the time left, and an "End" button.
   - The name takes the room that is left and ends in an ellipsis. The time and the button
     never shrink.
   - The time reads "1 h 42 min left", then "42 min left", then "Less than a minute left".
     It is worked out from `until` and the clock, and it changes on the minute.
   - Two new semantic tokens give its colours: the ground of the strip is the primary text
     colour of the theme, and its text is the ground colour of the theme. So it is dark on
     Day and light on Night, and the amber of an action is never on it. `contrast.spec.ts`
     covers the pair.
   - It has no close control, and no setting hides it.
   - It stays above every cover: the sheet scrim, the tour, the startup screen, the update
     screen and the connection cover. A press on "End" works under each of them.
   - The eye is a new icon component in `libs/shared/ui`, unless one exists there already.

6. **The app is shorter by the strip.** One custom property holds the height of the strip,
   and it is `0px` when no strip is drawn. `AppLayout` takes it from `100svh`, so the bar
   at the bottom stays on the screen and the page slot loses 44px. Every other rule that
   names `100svh` in velista takes it too, or the report says why it does not need to
   (`shop-map-page.scss`, `record-page.scss`, `apps/velista/src/styles.scss`).

7. **Ending.** Three things end the session in the tab, and all three do the same:
   - A press on "End". It first posts `POST /v1/auth/impersonation/end`, and it does not
     wait for the answer for longer than a few seconds.
   - The clock reaching `until`.
   - A 401 with `impersonation_ended`, or a refresh that the server refuses.

   The tab then removes the pair and the marker and draws the ended page: a new route
   `auth/support-ended` with one sentence ("This support session has ended. You can close
   this tab.") and no link into the app. A reload of that tab is an ordinary tab again.

8. **A refused act says why.** A 403 with `impersonation_not_allowed` shows the message
   "This cannot be done in a support session" where the page shows its other refusals.

9. **Both run modes.** The route and the strip work standalone and mounted in the shell.
   Each difference goes through `appRootRoute(mount)`.

10. **The copy**, in English and Spanish, in the translation assets of the library that
    draws it. No key, class or component carries the name of the product (rule N1).

### Scope

- `libs/velista/platform` (the key, `ImpersonationState`, the facade).
- `libs/velista/data-access` (the exchange and end calls, writing the state, the 401 and
  403 codes in the interceptor, the claim in the token decoder).
- `libs/velista/feature-auth` and `libs/velista/feature-shell` (two pages, two routes).
- `libs/velista/ui` (the strip, the tokens, `AppLayout`), `libs/shared/ui` (the icon).
- `apps/velista/plans/mocks/impersonation/` only if the built strip differs from it.

### Constraints

- **An ordinary tab does not change.** With no marker, the facade, `TokenStore` and
  `AppLayout` behave exactly as on `dev`. A spec asserts each.
- **The marker is read one time.** A document does not become active or stop being active
  while it runs. The handoff page and the ended page are the two places that write it,
  and each one leaves the document behind.
- **Rule D4.** Map the answer of the exchange from `unknown` into `SessionTokens`. Do not
  pass a backend type through.
- **No `@angular/core/rxjs-interop`** in `ImpersonationState`. It is provided per app.
- **The time is not a live region.** A screen reader hears the strip one time, as the page
  loads, and not each minute.
- **`100svh`, never `dvh`.** Raw pixels fail `token-hygiene.spec.ts`: add a token.
- **No raw `Location.back()`**, and the two new pages take no `sheet` segment.
- **The service worker is not touched.** `provideServiceWorker` stays in `app.config.ts`.

### Action boundaries

- Stop and ask before you change how an ordinary session is stored or refreshed.
- Stop and ask if a storage door cannot go behind the facade.
- Do not hide, disable or restyle any control of a page because a support session is
  active. The server decides what a session cannot do, and the page shows the refusal.
- Do not touch the backend or the admin app.

### Progress evidence

- `npx nx affected -t lint test` is green and `npx nx build velista` is green.
- A walk in a browser on a slot, through the shell and standalone, with screenshots of
  home, a list and the Shopping list tab in both themes: start a session over the gateway,
  open the link, see the strip, open a sheet and see the strip above its scrim, press
  "End", see the ended page.
- The same walk with an account of the operator signed in on a second tab: that tab keeps
  its account from start to end. Say so in the report with what you saw.

## Tests

- **The facade.** Active: a write lands in `sessionStorage` and `localStorage` is
  unchanged, and `watchStorage` never calls back. Not active: as today.
- **The handoff page.** The fragment is gone from the address before the request. A good
  code writes the marker and the pair and replaces the document. A bad code and a missing
  code draw the sentence and write nothing.
- **The time.** "1 h 42 min left", "42 min left" and "Less than a minute left" at the
  three boundaries, in both languages, under fake timers.
- **Ending.** Each of the three causes removes the pair and the marker and lands on the
  ended page. "End" still ends the tab when the request fails.
- **The strip.** It is drawn while the signal holds a value and absent otherwise. It has
  no control other than "End". `contrast.spec.ts` passes on both themes.
- **The layout.** With the strip, the height of the app is `100svh` less the strip.
- **The routes.** `routes.spec.ts` passes: the two pages carry no fall guard and no `sheet`
  segment. `app-root-route.spec.ts` passes for both mounts.

## What this plan does not do

- **It draws no frame round the screen.** The owner declined it.
- **It hides nothing from the operator.** The operator sees and can change what the user
  can, less the routes that backend `0194` refuses.
- **It does not tell the user.** No notice reaches the account that was opened.
- **It does not install.** A support session lives in a browser tab. The installed app is
  a separate document, and it keeps the account it had.
