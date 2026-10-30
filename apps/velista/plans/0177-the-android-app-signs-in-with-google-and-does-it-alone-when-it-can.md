> **PR:** [#877](https://github.com/IchirokuXVI/nx-portfolio/pull/877)

# 0177: the Android app signs in with Google, and does it alone when it can

> In the Android app, email and password sign in already works: the WebView runs on the
> app's own origin (`0167`, D1), and the pair lives in `localStorage` as on the web. Google
> does not. `authTerms` (`libs/velista/feature-auth/src/lib/auth-terms.ts`) and the landing
> page hide the button when `APP_RUNTIME` is `'native'`, because Google refuses its sign in
> page inside an embedded WebView, so `GoogleSignIn.start()` (`0171`) cannot run there.
>
> The owner asked on 2026-10-30 for two things: Android users sign in with Google, and the
> app signs them in by itself whenever it can. Android's Credential Manager does both. It
> shows the system account picker and returns a Google ID token, and it can return that
> token with no tap when one Google account on the phone already approved Velista. Backend
> `0238` adds the two routes this plan calls: `POST /v1/auth/google/nonce` and
> `POST /v1/auth/google/id-token`.
>
> Google Cloud is ready (backend `0238` lists the clients). The Android clients are
> registered with the release key, so a debug APK cannot sign in with Google. Build with
> the release key to test.
>
> Prerequisite reading: backend `0238` (the routes, the silent rule, D1 to D4), `0171` (the
> web flow and the callback page), `0173` (terms on the Google button), `0166` (the runtime
> axis and the native tokens), `0167` (the Android project, the flavors, the build script),
> and in the code `libs/velista/data-access/src/lib/auth/google-sign-in.ts`,
> `auth-api.ts`, `token-store.ts`, `libs/velista/native/src/lib/provide-native-shell.ts`,
> `native-plugins.ts`, `feature-auth/src/lib/auth-terms.ts`, `sign-in-page`,
> `register-page`, `upgrade-page`, `feature-landing/src/lib/landing-page/landing-page.ts`,
> `feature-account/src/lib/account-page/account-page.ts` (`signOut`).
>
> **Build order.** After backend `0238` is merged. Nothing else.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write Angular code.

### Objective

In `apps/velista/android`, `libs/velista/platform`, `libs/velista/native`,
`libs/velista/data-access` and the auth, landing and account features: add a Capacitor
plugin that asks Credential Manager for a Google ID token, expose it to Angular through a
platform token with a native implementation, give `GoogleSignIn` a native path that trades
the ID token for the pair, show the Google button in the app, and try a silent sign in on
the front door of a signed out app. Sign out stops the automatic sign in until the person
picks Google again.

### Context

- One bundle, a runtime axis (`0166`). Web code never imports `@capacitor/*`; only
  `libs/velista/native` does, and it provides native implementations of platform tokens
  in `provideNativeShell()`. Follow `GEOLOCATION_READER` and `SHARE_TARGET` as the pattern.
- `GoogleSignIn.start()` is the one entry of the web flow. The sign in, register and
  upgrade pages and the front door call it and show a refusal in their own way.
- `TokenStore.set(tokens)` is how a pair arrives, as the callback page does it.
- A guest has a session. A guest that picks Google on the upgrade page links Google onto
  the guest (the bearer goes with the nonce mint, as with the state mint).
- The terms line under the button names a version, and that version goes with the mint
  (`0173`).

### Target state

1. **The plugin.** A local Capacitor plugin in `apps/velista/android` (Java, package
   `app.velista`), registered in `MainActivity`, named `VelistaGoogle`, over
   `androidx.credentials` and `com.google.android.libraries.identity.googleid`. Two methods:
   - `getIdToken({ serverClientId, nonce, silent })`. Silent: `GetGoogleIdOption` with
     `filterByAuthorizedAccounts(true)` and `autoSelectEnabled(true)`; Android answers with
     no UI or not at all. Interactive: `GetSignInWithGoogleOption` (the "Sign in with
     Google" sheet, which also offers adding an account). Resolves `{ idToken }`, or
     rejects with one of `cancelled`, `no_credential`, `unavailable` (no Play services),
     `failed`.
   - `forget()`: `clearCredentialState`, so Android stops auto selecting.
   A local plugin and not a package: it is about eighty lines, it handles a credential,
   and the owner then controls every option it passes. Pin the AndroidX versions in
   `variables.gradle`. Check that a release build keeps the classes it needs (R8 rules if
   minify is on).
2. **The tokens.** In `libs/velista/platform`: `GOOGLE_CREDENTIAL`, an interface with
   `getIdToken(options): Promise<string | null>` (null for cancelled and no credential;
   throws for the rest) and `forget(): Promise<void>`. The web default is `null` (no
   provider), so code asks "is there one" and the web path never changes. The native
   implementation lives in `libs/velista/native` and is provided by `provideNativeShell()`.
3. **The native path of `GoogleSignIn`.** `start()` checks `GOOGLE_CREDENTIAL`. With one:
   mint a nonce (`silent: false`, the terms version, the guest's bearer through the
   interceptor), ask the credential with the `clientId` and `nonce` of that answer, post
   the ID token, `TokenStore.set` the pair, go home as the callback page does. A null
   (cancelled) resolves quietly with no error, so the page shows nothing. Every other
   failure rejects as today, and the pages keep their own refusal copy. A new method
   `trySilent(): Promise<boolean>` does the same with `silent: true` and no terms version,
   and never throws: any failure, `google_sign_in_needs_consent` included, is `false`.
   The `AuthApi` gains `mintGoogleNonce` and `signInWithGoogleIdToken`, mapped from
   `unknown` into velista's own models (rule D4).
4. **The button shows in the app.** `authTerms().googleOffered` and the landing page drop
   their `!native` condition. They still follow `features.googleSignIn`.
5. **Automatic sign in.** On the front door, in the native runtime, with no session, with
   `features.googleSignIn` on, and when the automatic sign in is not switched off: call
   `trySilent()` once per document. While it runs (at most four seconds, then it is
   abandoned), the auth actions show the busy state they already have, so nobody taps
   "Sign in" over a sign in that is about to land. On `true` the app goes home. On
   `false` the front door stays as it is, with no message.
6. **Sign out switches it off.** `signOut` on the account page, and the account deletion
   that clears the pair, call `forget()` and write a local flag
   (`StorageKeys.googleAutoSignInOff`). The flag stops step 5. A successful interactive
   Google sign in removes it. Without this, a person who signs out is signed in again on
   the next open, which reads as a broken sign out.

### Scope

In: the plugin, the two tokens and their native implementation, the `GoogleSignIn` and
`AuthApi` changes, the button, the automatic sign in, the sign out flag, specs, a rebuilt
release APK of each flavor.

Out: the backend (`0238`), the web flow, any new screen or copy beyond what the busy state
already shows, iOS, Google Play publishing.

### Constraints

- Only `libs/velista/native` imports `@capacitor/*`. Specs use doubles (see
  `native-plugin-doubles.ts`).
- Never log, store or keep the ID token past the post.
- No `@angular/core/rxjs-interop` in a service.
- The silent attempt never shows an error and never blocks the front door longer than
  four seconds.
- Build APKs with `apps/velista/scripts/build-android.mjs` from a checkout with no slot
  `.env` pointing at localhost (the trap recorded in `0167`'s follow ups).

### Action boundaries

Do not change the backend, the web redirect flow, or any Google Cloud setting. If the
automatic sign in seems to need a new screen or new copy, stop and describe it; a mock
comes before UI changes here.

### Progress evidence

- Specs: `GoogleSignIn` takes the native path when `GOOGLE_CREDENTIAL` exists and the web
  path when it does not; cancelled resolves quietly; `trySilent` answers false on every
  failure; the front door tries once, respects the flag and the feature switch, and gives
  up after four seconds; sign out calls `forget()` and sets the flag; an interactive
  success clears it.
- `nx test`, `lint` and `build` of every touched project pass.
- On a phone or a Play image emulator signed in to a **test user** of the consent screen,
  with the staging release APK: the first open shows the front door, "Continue with
  Google" opens the system sheet and lands home; closing and reopening the app after
  clearing its data signs in with no tap; sign out, then reopen, stays on the front door;
  a guest upgraded with Google keeps its groups. Screenshots of each step.

## Decisions taken in this plan

- **D1. Credential Manager, not a Custom Tab over the web flow.** A Custom Tab needs the
  server redirect to hand off to an App Link, which Chrome does not do reliably, and the
  verifier dies with the WebView if Android kills the app behind the tab.
- **D2. A local plugin.** Small, auditable, and no third party code holds the credential.
- **D3. Silent only from the front door, only once per document.** A session that exists
  is kept by its refresh token; the silent path is for a reinstall, cleared data or an
  expired session.
- **D4. Sign out turns automatic sign in off** until the next deliberate Google sign in.

## Open for the owner

- The busy state on the front door during the silent attempt is the existing one. If it
  reads wrong on the phone, a mock follows.

## What the build decided

- **Plugin options.** Silent: `GetGoogleIdOption` with `filterByAuthorizedAccounts(true)`,
  `autoSelectEnabled(true)`, the server client and the nonce. Interactive:
  `GetSignInWithGoogleOption` with the server client and the nonce. A provider
  configuration or unsupported error is `unavailable`. Pinned: `androidx.credentials`
  1.6.0 with `credentials-play-services-auth`, and `googleid` 1.2.1.
- **R8.** The release build type has `minifyEnabled false`, so nothing is shrunk and no
  keep rules are needed. The built APK holds `VelistaGooglePlugin`, `CredentialManager`
  and `GetSignInWithGoogleOption`.
- **`start()` answers `'leaving' | 'cancelled'`.** The four Google buttons kept their busy
  state after a successful start, because the web document leaves. On `'cancelled'` they
  let go of it. Their refusal handling is unchanged.
- **The four seconds live in `GoogleSignIn.trySilent`**, where the pair is stored. The
  attempt starts when the operator settings arrive, and they arrive only after the
  backend answered.
- **The busy state is the existing held state** (the four ways in dimmed, with "Connecting.
  This will work in a moment."), plus `aria-busy` on the Google button. `googleBusy` alone
  does not stop a tap on "Sign in". No new copy.
- **No silent attempt while a session is held**, a guest included (D3).
- **`invalid_google_token` skips the refresh and retry of the interceptor**, as
  `not_a_participant` does. Without that, a guest whose token is refused is refreshed,
  refused again and signed out. Both new codes joined `ERROR_CODES`.
- **A late silent answer still signs in when that is safe.** A silent request can show a
  picker when two approved accounts are on the phone, so a person may pick after four
  seconds. The front door lets go at four seconds, but the attempt goes on. The app uses
  a late token or pair only when no session exists, nobody pressed Google since, and the
  router still shows the front door. In all other cases the app drops it.
- **Emulator.** `Medium_Phone_API_37.0` has a Play image. With no Google account, the
  staging APK opened on the front door, held the ways in for about two seconds and let them
  go with no message, and drew "Continue with Google". Staging had no nonce route yet (404),
  so a press showed the page's refusal sentence and the system sheet was not reached.
