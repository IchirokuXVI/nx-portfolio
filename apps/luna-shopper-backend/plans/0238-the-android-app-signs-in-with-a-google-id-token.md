# 0238: the Android app signs in with a Google ID token

> The Android app (velista `0166` and `0167`) hides "Continue with Google". Google refuses
> its sign in page inside an embedded WebView (`disallowed_useragent`), so the redirect
> flow of plans `0023` and `0230` cannot run there. Android has its own way: Credential
> Manager shows the system account picker and hands the app a Google **ID token**, a JWT
> that Google signed, whose audience is the web client of the project. No redirect, no
> callback, no code.
>
> This plan adds the server half: a single use nonce that the app mints before it asks
> Android, and a route that takes the ID token, verifies it, spends the nonce inside the
> token, and signs in through the same `googleLogin` that the redirect flow uses. Velista
> `0175` builds the client half, including the automatic sign in that the owner asked
> for on 2026-10-30.
>
> **Google Cloud is ready.** Project `velista-512817` holds the web client `velista-web`
> (`717012688744-diupovqba48a48vpjpbta5caipv9bn16.apps.googleusercontent.com`, the
> `googleClientId` of both `values.staging.yaml` and `values.production.yaml`) and, since
> 2026-10-30, two Android clients: `velista-android` (`app.velista`) and
> `velista-android-staging` (`app.velista.staging`). Both carry the SHA1 of the release key
> (`05:F5:DF:70:ED:DE:BB:E9:9D:F9:6B:3A:1A:08:48:4C:33:B9:19:CA`). The Android clients are
> never named in code: Google checks the package and the signature on the device, and the
> token that comes back names the **web** client as its audience. So no new configuration
> value exists on the server.
>
> Prerequisite reading: `0023` (the Google flow), `0230` (state, handoff, PKCE, why
> nothing permanent happens before the caller proves itself), `0210` target state 2
> (`TokenGrantService`), `0231` section 4 (terms at the start of a Google sign in), `0020`
> (the optional guard), and in the code `gateway/src/app/auth/google.controller.ts`,
> `auth/src/app/identity/identity.service.ts` (`mintOAuthState`, `exchangeGoogleSignIn`,
> `googleLogin`), `libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts`.
>
> **Build order.** Before velista `0175`. Independent of every other open plan. Open PR
> [#871](https://github.com/IchirokuXVI/nx-portfolio/pull/871) adds a branch to
> `googleLogin` (link onto the account that already holds the address). This plan calls
> `googleLogin` and does not edit it, so the two merge in either order.

## Brief for the agent

### Objective

Across `libs/luna-shopper/contracts`, `apps/luna-shopper-backend/auth` and
`apps/luna-shopper-backend/gateway`: add `POST /v1/auth/google/nonce`, which mints a single
use nonce bound to the caller, the terms version and a `silent` flag; and add
`POST /v1/auth/google/id-token`, which verifies a Google ID token, spends the nonce it
carries, checks the caller, and signs in through `googleLogin`. A silent nonce signs in
only to an account that this Google identity already opens and never creates or links
anything. Regenerate the OpenAPI document and the admin wire types.

### Context

- The redirect flow stays exactly as it is. The web keeps using it. This plan adds a
  second way in and changes nothing in `mintOAuthState`, the callback or the exchange.
- `TokenGrantService` (`0210`) issues and spends single use grants with a conditional
  spend, keyed by a hash. The nonce is one more grant table of it, beside `oauth_states`
  and `oauth_handoffs`.
- The guards of the two routes are those of the state mint and the exchange:
  `RefuseImpersonation`, `GoogleConfiguredGuard`, `OptionalJwtAuthGuard`. The reasons in
  the comments of `google.controller.ts` apply word for word.
- `GOOGLE_CLIENT_ID` already reaches auth (`app-config.ts`). It is the audience to check.
- The velista app runs on the origin `https://velista.app` (or the staging origin) inside
  the WebView. CORS needs no change.

### Target state

1. **`POST /v1/auth/google/nonce`.** Body: `{ silent?: boolean, acceptedTermsVersion?: string }`.
   Answers 201 `{ nonce: string, clientId: string }`.
   - The caller is the verified bearer or nobody, as on the state mint. A guest that mints
     a nonce names the account an interactive sign in links onto.
   - `acceptedTermsVersion` goes through `terms.assertAcceptable` now, as the state mint
     does (`terms_version_stale` before Android is asked). A silent nonce refuses a terms
     version in its body: a silent sign in accepts nothing on the person's behalf.
   - The nonce is 32 random bytes in base64url, stored only as its hash, valid ten
     minutes, single use. The row holds `userId` (or null), `silent`, `termsVersion`,
     `locale`.
   - `clientId` is `GOOGLE_CLIENT_ID`: the app passes it to Android as the server client
     id. So the audience the app asks for and the audience the server checks come from
     one value, and a change of web client needs no new APK.
2. **`POST /v1/auth/google/id-token`.** Body: `{ idToken: string }`. Answers 201 with the
   `AuthTokens` pair, as the exchange does.
   - Auth verifies the token with `google-auth-library` (`OAuth2Client.verifyIdToken`):
     signature against Google's published keys, `aud` equal to `GOOGLE_CLIENT_ID`, `iss`
     `accounts.google.com` or `https://accounts.google.com`, `exp` in the future. A token
     whose `email_verified` is not true signs in to nothing.
   - The token's `nonce` claim is spent as the grant, in the same transaction as the
     sign in. A missing, unknown or spent nonce is `invalid_google_token`, the same code
     as a bad signature: a caller learns nothing about which check failed.
   - When the grant names a user, the caller must be that user, exactly as
     `caller_mismatch` in `exchangeGoogleSignIn`.
   - **Interactive grant:** `googleLogin` with `providerUserId` = `sub`, `email`,
     `displayName` = `name`, `linkUserId` = the grant's user, `acceptedTermsVersion` = the
     grant's version. Whatever `googleLogin` does for the redirect flow, it does here, also
     the branch of #871 once that merges.
   - **Silent grant:** only the first branch of `googleLogin` is allowed: an
     `oauth_identities` row for this `sub` already exists. Every other case answers
     `google_sign_in_needs_consent` and changes nothing: no account, no link, no claim by
     address, no terms row. The app then shows its button.
   - The pair is issued as the exchange issues it, and the audit and log lines name the
     way in (`google_id_token`), never the token.
3. **Contracts.** Two new message patterns in `AUTH_PATTERNS`, their request and result
   types, and the DTOs in the gateway. Two new error codes: `invalid_google_token` (401)
   and `google_sign_in_needs_consent` (409), each with its English and Spanish copy where
   the other auth codes keep theirs.
4. **Throttle.** Both routes take the throttle of the state mint. Neither carries
   `@SkipThrottle()`.

### Scope

In: the two routes, the grant table and its migration, the verifier wrapper, the error
codes, specs, the OpenAPI document and the wire types.

Out: any client code (velista `0175`), the redirect flow, `googleLogin` itself, the Google
Cloud project, the publishing status of the consent screen.

### Constraints

- Wrap `google-auth-library` behind a small injectable (`GoogleIdTokenVerifier`) so every
  spec hands in a double and no spec reaches Google. Pin the package version.
- The nonce compare is on the hash, through `TokenGrantService`, never a plain `findOne`
  then `save` (the race that the token review called F1).
- A token is never logged, stored or echoed, not even on failure.
- Rule of the gateway: every POST is 201 with a contract body. No 204.
- Regenerate, never hand edit: `npx nx run luna-shopper-backend-gateway:openapi`, then
  `npx nx run luna-shopper-admin/models:wire-types`.

### Action boundaries

Do not touch the redirect flow, `googleLogin`, the Helm values or any Google Cloud
setting. Do not add an environment variable. If the silent rule seems to need a change in
`googleLogin`, stop and say why instead.

### Progress evidence

- Specs in auth: interactive sign in creates, signs in and links onto a guest; a silent
  nonce signs in a linked identity; a silent nonce with an unknown `sub`, with a known
  address but no identity, and with a guest caller each answer
  `google_sign_in_needs_consent` and write no row; a spent nonce, an unknown nonce, a
  wrong audience, an expired token and `email_verified: false` each answer
  `invalid_google_token`; a caller that is not the grant's user is refused; a silent
  nonce with a terms version is refused at the mint.
- One spec runs two spends of one nonce in parallel and sees one pair.
- `nx test`, `lint` and `build` of auth and gateway pass, and the OpenAPI document and
  wire types are current.
- An integration run on an ephemeral Luna slot with a fake verifier that answers fixed
  claims proves the route end to end over NATS.

## Decisions taken in this plan

- **D1. A nonce from the server, not from the app.** A nonce the app made would stop
  nothing: a stolen ID token carries whatever nonce its app chose. A server nonce is
  single use and names the caller, which is what `0230` asked of the redirect flow.
- **D2. The client id travels in the nonce answer.** One source for the audience, and no
  build argument in the APK.
- **D3. A silent sign in only opens what this Google account already opens.** It creates
  nothing and accepts no terms, because nobody pressed anything.
- **D4. One error code for every failed check of the token.** A caller gets no oracle.

## Owner steps outside the code

- The consent screen of project `velista-512817` is in **Testing**: only the seven test
  users on its Audience page can sign in with Google, on the web and in the app alike.
  To open Google sign in to everyone, complete the Branding page and press "Publish app".
- If the app ever ships through Google Play with Play App Signing, Play signs with its own
  key. Add that key's SHA1 (Play Console, App integrity) as one more Android client for
  `app.velista`, or Google sign in fails in the store build only.
