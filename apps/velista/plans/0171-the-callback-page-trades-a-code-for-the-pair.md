> **PR:** [#849](https://github.com/IchirokuXVI/nx-portfolio/pull/849)

# 0171: the callback page trades a code for the pair

> Backend plan `0230` closes finding F2 of the session token review of 2026-10-27
> (`apps/velista-luna-e2e/reviews/2026-10-27-session-tokens/report.md`, PR #844). After it,
> `POST /v1/auth/google/state` wants a `codeChallenge`, the Google callback redirects to
> `/{locale}/auth/callback#code=<code>` with no pair in the fragment, and
> `POST /v1/auth/google/exchange` trades the code plus the verifier for the pair. The
> verifier is the secret that only the browser that started the flow holds. This plan is
> that browser's half.
>
> It also closes the overwrite half of finding F8 for velista: today `AuthCallbackPage`
> stores any pair that a URL fragment carries (test 7 of the review battery), and a link
> is enough to sign a guest into somebody else's account and lose their groups. After this
> plan the page stores nothing from a fragment. A pair arrives only in the body of an XHR
> that the page made with a verifier it read from its own session storage.
>
> The Google button stays as it is. It records its tap and navigates nowhere (`0009`
> section 5.6, `sign-in-page.ts`, `register-page.ts`, `landing-page.ts`). Offering Google is
> the owner's call and another plan. This plan builds `start()` so that offering it is one
> line in each of those three places.
>
> Prerequisite reading: backend `0230` sections 2 to 4 (the three routes and the
> verifier), `0009` sections 4.1 and 5.6, `0133` (`replaceDocument` and the session
> storage rules of the facade), rule D2 (no browser global outside the facade) and rule D4
> (map from `unknown`) in `libs/velista/data-access`, and in the code
> `libs/velista/feature-auth/src/lib/auth-callback-page/auth-callback-page.ts`,
> `libs/velista/data-access/src/lib/auth/auth-api.ts` (`_authenticate`, the anonymous
> context), `libs/velista/data-access/src/lib/auth/token-store.ts` (`set`),
> `libs/velista/platform/src/lib/browser-facade.ts` (the session storage methods,
> `replaceDocument`, `openExternal`).
>
> **Build order.** After backend `0230` is merged. The routes it defines are the contract
> here. If `POST /v1/auth/google/exchange` is not in `gateway/docs/openapi.json` on `dev`,
> say so and stop.
>
> Skills: `nx-portfolio-angular-developer`.

## Brief for the agent

### Objective

In `libs/velista/data-access` add `GoogleSignIn` with `start()`: make a verifier, keep it
in session storage, mint a state with its challenge, and send the document to
`GET /v1/auth/google?state=…`. In `libs/velista/feature-auth` make `AuthCallbackPage`
read `code` from the fragment, trade it with the verifier through
`POST /v1/auth/google/exchange`, store the pair from the body, and store nothing from a
fragment ever again.

### Context

- `AuthCallbackPage` reads `ActivatedRoute.snapshot.fragment`, maps it with
  `toSessionTokens`, calls `TokenStore.set` and navigates home. With no fragment it
  navigates to the front door. It is inert for a guest today only because no button
  navigates to Google.
- `AuthApi._authenticate` posts to a route in the anonymous HTTP context (`http-context.ts`),
  so no bearer goes out and a 401 starts no refresh. The exchange is not anonymous: a
  guest who links must present their bearer, and the interceptor sends it, refreshing
  first when the access token has expired. `0230` section 4.2 refuses a link without it.
- `BrowserFacade` has `readSessionStorage`, `writeSessionStorage`,
  `removeSessionStorage`, each a no-op on the server. It has no method that assigns a new
  document and keeps the current one in history: `replaceDocument` replaces, and it makes
  every later session storage write a no-op in this document, which the start of a flow
  must not do before the verifier is written. `window.crypto` is not exposed.
- `ApiUrl.gateway(path)` builds a gateway URL. `SessionTokens` is the client model and
  `toSessionTokens(raw: unknown)` maps a body to it or to null.
- The review battery's test 7 sends the page `#accessToken=…&refreshToken=…&userId=…`
  with a different user's pair while a guest pair is held, and asserts the held pair
  survives. It fails today.

### Target state

- `npx nx test velista-data-access`, `npx nx test velista-feature-auth`,
  `npx nx test velista-platform`, `lint` for the three, and `npx nx build velista` pass.
- Test 7 of the review battery passes on its overwrite assertion against a velista slot
  pointed at a Luna slot that runs `0230`.
- On that slot, in a browser console on the sign in page,
  `inject(GoogleSignIn).start()` (through the Angular dev tools, or a temporary call
  wired for the check and removed) sends the document to the gateway's Google route with a
  `state` query, the gateway answers 302 to Google, and session storage holds the verifier
  under `google-verifier:velista`. The slot has no Google credentials, so the gateway
  answers 501 before the redirect, which is the expected end of the check.
- `AuthCallbackPage` at `/en/auth/callback#code=abc` with no verifier in session storage
  posts nothing and lands on the front door. With a verifier, it posts
  `{ code, codeVerifier }` to the exchange, stores the body's pair, removes the verifier
  and lands on home. With `#error=unauthorized` it lands on the front door.

### Scope

- Work only in: `libs/velista/data-access/src/lib/auth/google-sign-in.ts` (new) and its
  spec, `libs/velista/data-access/src/lib/auth/auth-api.ts` and spec (the two calls),
  `libs/velista/data-access/src/index.ts`,
  `libs/velista/platform/src/lib/browser-facade.ts` and spec (two methods, section 2.3),
  `libs/velista/feature-auth/src/lib/auth-callback-page/**`, and this plan file.
- Do NOT touch: the sign in, register, landing, upgrade and account pages, any `ui`
  component, `token-store.ts`, the interceptor, the routes, the Android project,
  anything under `apps/luna-shopper-backend`, the review folder, `package.json`.

### Constraints

- Angular 21, zoneless, signals, **no `@angular/core/rxjs-interop`** in `data-access` or
  `platform` (CLAUDE.md says why).
- Rule D2: no `window`, `crypto` or `location` outside `BrowserFacade`. Rule D4: the
  exchange body is mapped with `toSessionTokens` from `unknown`.
- The verifier is 32 random bytes as base64url (43 characters). The challenge is
  base64url of SHA-256 of the verifier's ASCII bytes, as RFC 7636 states it. One fixed
  test vector in the spec pins both.
- The verifier is written before the mint request goes out and removed in the callback
  page whether the exchange succeeds or fails. A second `start()` overwrites it.
- The page never writes a pair that came from the URL. `toSessionTokens` is not called on
  a fragment.
- SSR rules of `0166` section 2: the new code reads no global at construction and runs
  no timer.
- Prose in files has no dashes as punctuation (the owner's rule).
- Only make the changes this plan names. No feature, refactor or abstraction beyond them.

### Acceptance criteria

- [ ] `BrowserFacade` has `randomBytes(length)` and `sha256(bytes)` as section 2.3 states,
      and `assignDocument(url)`, each a no-op or a rejected promise on the server, with a
      spec.
- [ ] `GoogleSignIn.start()` does the four steps of section 2.1 in order, and its spec
      asserts the storage write before the mint, the request body `{ codeChallenge }`
      with the vector's challenge, and the final URL with the returned state.
- [ ] `AuthCallbackPage` does section 3, and its spec covers the four cases of the
      target state plus the old fragment shape with a pair, which stores nothing.
- [ ] `AuthApi` has `mintGoogleState(codeChallenge)` and `exchangeGoogleCode(code,
      codeVerifier)`, the first anonymous or bearer as the interceptor decides, the
      second never anonymous.
- [ ] Test 7's overwrite assertion passes, and its observed annotation is in the PR body.

### Action boundaries

- Proceed with in-scope edits, specs, lint, build and the slot check.
- Stop and ask before touching a page that offers the button, a backend file, the
  routes, or a file outside the scope.

### Progress evidence

Report when the three suites pass, when the build passes, and when test 7 passes. Ground
each claim in a command's output.

## 1. The flow, from the button to home

1. A page calls `GoogleSignIn.start()`. Nothing does yet.
2. `start()` makes the verifier, writes it to session storage, posts the challenge, and
   assigns the document to the gateway's start route with the state.
3. The gateway sends the browser to Google, Google sends it to the gateway's callback, the
   gateway stages what Google said and sends the browser to `/{locale}/auth/callback#code=…`.
4. `AuthCallbackPage` reads the code and the verifier, posts both, stores the pair from the
   body, removes the verifier, and navigates home.

A link that somebody else made lands at step 4 with a code and no verifier in this
browser. The page posts nothing and goes to the front door. The held session is untouched.

## 2. `GoogleSignIn`

### 2.1 `start()`

`libs/velista/data-access/src/lib/auth/google-sign-in.ts`, `providedIn: 'root'`,
injecting `BrowserFacade`, `AuthApi` and `ApiUrl`.

1. `verifier = base64url(facade.randomBytes(32))`.
2. `facade.writeSessionStorage(GOOGLE_VERIFIER_KEY, verifier)`, with
   `GOOGLE_VERIFIER_KEY = 'google-verifier:velista'`, named beside the other storage keys
   of the scope.
3. `challenge = base64url(await facade.sha256(ascii(verifier)))`, then
   `state = await api.mintGoogleState(challenge)`.
4. `facade.assignDocument(urls.gateway('/v1/auth/google?state=' + encodeURIComponent(state)))`.

A failure at step 3 (401 from a stale guest token the interceptor could not refresh, 501
with Google unconfigured, a network error) rejects the promise and removes the verifier.
The caller decides what to show. This plan has no caller.

### 2.2 Session storage, on purpose

The verifier belongs to this tab and this flow. `sessionStorage` dies with the tab and is
never adopted by another document through the `storage` event, so a second tab cannot
finish a flow the first one started, and nothing on the origin's `localStorage` ever
holds it. In a support session the facade's session methods are the same methods, and
`0230` refuses the mint under a support session before any of this matters.

### 2.3 Three facade methods

- `randomBytes(length: number): Uint8Array` over `window.crypto.getRandomValues`. On the
  server it throws, because a verifier that is not random is not a verifier and a silent
  empty array would make one.
- `sha256(bytes: Uint8Array): Promise<ArrayBuffer>` over `window.crypto.subtle.digest`.
  Rejects on the server.
- `assignDocument(url: string): void` over `location.assign`. Unlike `replaceDocument` it
  leaves the current page in history, so the browser's back from Google's consent screen
  returns to the sign in page, and it does not close the session storage of this
  document, because step 2 of `start()` has just written to it.

`base64url` of bytes is a small pure function beside `GoogleSignIn`, with a spec. No
dependency.

## 3. `AuthCallbackPage`

The page keeps its template and its route. `_consume` becomes:

1. Parse the fragment with `URLSearchParams`. Read `code` and `error`. Read nothing else.
2. No fragment, an `error`, or no `code`: navigate to the front door, as today.
3. `verifier = facade.readSessionStorage(GOOGLE_VERIFIER_KEY)`. Remove the key at once,
   before the request, so a reload of this page cannot post the same verifier twice.
4. No verifier: navigate to the front door. Nothing is posted.
5. `tokens = await api.exchangeGoogleCode(code, verifier)`. A refusal (401), a 501 or a
   network error: navigate to the front door. A later plan can show why.
6. `TokenStore.set(tokens)`, navigate home.

`_fragmentTokens` and the import of `toSessionTokens` leave this file. The doc comment of
the page says what it does now, not what it waited for in `0009`.

Navigation with `navigateByUrl` replaces the callback URL as it does today. Test 7 found
no history entry that kept the fragment, and this plan keeps that.

### 3.1 The two API calls

In `AuthApi`:

- `mintGoogleState(codeChallenge: string): Promise<string>` posts `{ codeChallenge }` to
  `/v1/auth/google/state` in the ordinary context, so a held bearer goes out and the
  state carries the guest. The body's `state` is read as a string or the call rejects.
- `exchangeGoogleCode(code: string, codeVerifier: string): Promise<SessionTokens>` posts
  both to `/v1/auth/google/exchange` in the ordinary context and maps the body with
  `toSessionTokens`. A null map rejects.

## 4. Proof

- `google-sign-in.spec.ts`: a fake facade that returns fixed bytes and a real SHA-256 of
  the vector (Node's `webcrypto` in the spec is fine, the facade is the seam). Asserts the
  order of section 2.1, the body of the mint, the final URL, and that a mint failure
  removes the verifier.
- `auth-callback-page.spec.ts`: the four target state cases, plus the old fragment with
  a pair of another user while a guest pair is held, and the held pair survives.
- `browser-facade.spec.ts`: the three methods on the server path.
- Test 7 of the review battery.

## 5. Out of scope

- Offering the button, and what the three pages show after a failed `start()`.
- A screen for a failed exchange. The front door is the floor, not the design.
- Google inside the Android app (`0167`). The verifier lives in the WebView's session
  storage, and the design holds when a system browser flow brings the code back by App
  Link, but that flow is not built.
- The rest of F8: a held temporary session is still replaced by a successful exchange
  that signs in as somebody else, when a person starts that flow themselves.
