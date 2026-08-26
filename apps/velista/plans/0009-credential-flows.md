# 0009. Credentials: signing in, registering, and keeping a guest account

> Prerequisite reading: `0008` (the other two ways in, and rule E1 on routing),
> `0004` sections 5 and 9 (the token lifecycle and the DI token inventory), and
> `0003` section 3 for the guest banner this plan finally connects.
>
> **This is a page plan** and follows the template in `0001` section 9.
>
> It finishes the front door. After this, every control drawn on `0003`'s anonymous
> screen leads somewhere real, and the remaining `pendingRoutes` entries all belong to
> pages further in.
>
> **One flow in here is designed but deliberately not built: Google.** Section 5.6 says
> why, and it is not a frontend limitation. Everything else in this plan ships.

## 1. Purpose

`0008` built the two ways in that need no account. This plan builds the two that do,
plus the one that matters most and is easiest to get wrong: **turning the guest account
somebody already has into one they cannot lose.**

Three different people arrive at these screens and they need three different things:

- Somebody with an account on another phone, who needs to sign in and find their groups
  waiting.
- Somebody new who wants an account before they have anything to lose.
- **Somebody who already has groups, held only by this phone's storage.** They are the
  reason this plan is delicate: the obvious screen for them is the wrong one, and
  picking it would silently strand everything they have made.

## 2. Mock

**https://claude.ai/code/artifact/5bc9cb60-284c-4f4a-9fc9-63e6ace1109a**

Sources are committed in `mocks/auth/`. Phone frames are 390 by 844, Night theme only,
for the reason `0008` section 2 gives.

| Artboard | Frames |
| --- | --- |
| `SignIn.dc.html` | Arrived, filled with the keyboard up, and rejected |
| `Register.dc.html` | The two field form, and the dashboard it lands on |
| `Upgrade.dc.html` | Securing a guest account, and the dashboard afterwards |
| `VerifyEmail.dc.html` | A confirmation link that worked, and one that did not |
| `ResendStates.dc.html` | The resend sentence in all three of its states |

## 3. States

### 3.1 Sign in and register

| State | Drawn | Behaviour |
| --- | --- | --- |
| Arrived | Yes | Email focused, keyboard up, primary disabled until both fields are non empty |
| Filled | Yes | Primary enabled. No inline validation of the email's shape while typing, only on submit |
| Submitting | No, described | Primary shows a spinner and keeps its accessible name, both fields go read only |
| Rejected | Yes, on `SignIn` | One message under the pair of fields, never under one of them. See section 5.4 |
| Rate limited | No, described | The same inline treatment, with the section 5.5 copy. Five per minute on login, three on register |

### 3.2 The guest upgrade

| State | Drawn | Behaviour |
| --- | --- | --- |
| Arrived | Yes | Reached only from the guest banner. It counts the caller's groups back at them, which is the whole argument for doing it |
| Done | Yes | Returns to the dashboard with the banner gone and a confirmation that names the email |
| Already registered | No, described | A 409 that only happens if two tabs raced. Treated as success: reload the session and go to the dashboard |

### 3.3 The confirmation link

| State | Drawn | Behaviour |
| --- | --- | --- |
| Working | No, described | A brief centred spinner. The token is consumed on arrival, with no button to press first |
| Confirmed | Yes | One action, into the app |
| Expired, used, or wrong | Yes | One screen for all three, because the server returns one error for all three. It carries the same resend sentence when the viewer is signed in. See section 5.7 |
| Resend ready | Yes | One amber sentence inside the nudge. No button, by decision |
| Resend just sent | Yes | The sentence answers itself and counts down, then returns to ready |
| Resend refused | Yes | The server's own wait, which can be much longer than a minute |

## 4. Anatomy

### 4.1 These are routes, not sheets

`0008` rule E1 made the entry actions sheets because each completes one field in place
over a page that keeps its context. None of these does. Each has two fields, its own
alternative path at the bottom, and in two cases a Google button, so each is a
destination.

Per `0008` section 4.1.1, every one of these is declared **before** the `''` front door.

| Route | Renders | Access |
| --- | --- | --- |
| `auth/login` | `SignInPage` | Anonymous only |
| `auth/register` | `RegisterPage` | Anonymous only |
| `auth/upgrade` | `UpgradePage` | **Guest only.** See section 4.2 |
| `auth/verify` | `VerifyEmailPage`, reading `?token=` | Public |
| `auth/callback` | `AuthCallbackPage` | Public, and inert until section 5.6 lands |

### 4.2 Rule C1: a guard decides who may see which screen, not a template

> **Rule C1.** `auth/register` is barred to a guest, and `auth/upgrade` is barred to
> everybody else.

`anonymousOnlyGuard` already exists and covers `auth/login` and `auth/register`, and it
is what makes the register screen unreachable by somebody holding a guest token.
`auth/upgrade` needs a new `guestOnlyGuard`, which is `SessionStore.isGuest` and nothing
more.

This is the same reasoning `0007` used when it replaced the adaptive home component with
two guarded routes: which person may see which screen is a property of the route, where
it can be tested, rather than a branch in a template. Here it is also a safety rule,
because section 5.3 shows what the wrong screen costs.

### 4.3 Libraries

| Library | Adds |
| --- | --- |
| `libs/velista/feature-auth` **(new)** | `SignInPage`, `RegisterPage`, `UpgradePage`, `VerifyEmailPage`, `AuthCallbackPage` |
| `libs/velista/ui` | `AuthScreen` (the back row, title, lede and footer alternative, shared by four screens), `EmailField`, `PasswordField` (with its reveal toggle), `FormError` |
| `libs/velista/data-access` | `AuthApi` **(new)** behind an `AUTH_SERVICE` token, plus `AuthMemory`. This is the one plan since `0004` that genuinely adds transport |
| `libs/velista/feature-shell` | The five routes, and `guestOnlyGuard` |
| `libs/velista/feature-home` | The guest banner's action becomes a link to `auth/upgrade` |
| `libs/velista/feature-landing` | Two of the four `pendingRoutes` entries become links |

`PasswordField` is the only genuinely new input in the app. Its reveal toggle is a
button with an `aria-label` that changes with state, never an icon that only looks
different.

## 5. Data

### 5.1 The endpoints

| Call | Auth | Body | Returns | Throttle |
| --- | --- | --- | --- | --- |
| `POST /v1/auth/register` | none | `{ email, password, displayName? }` | `AuthTokens` | 3 per minute |
| `POST /v1/auth/login` | none | `{ email, password }` | `AuthTokens` | 5 per minute |
| `POST /v1/auth/upgrade` | **bearer** | `{ email, password, displayName? }` | `AuthTokens` | default |
| `POST /v1/auth/verify-email` | none | `{ token }` | `{ userId }` | 3 per 10 minutes |
| `POST /v1/auth/refresh` | none | `{ refreshToken }` | `AuthTokens` | exempt |

`refresh` is listed for completeness only: `TokenStore` already owns it, single flight,
from `0004`.

`AuthTokens` is `{ userId, kind, username, accessToken, refreshToken }`. It carries **no
expiry**, so the client decodes the JWT `exp` itself, which `TokenStore` already does.

**Password rules are the DTO's, not ours:** at least 8 characters, at most 200. The form
states the minimum up front rather than only on rejection. There is no confirm password
field and no strength meter; neither is backed by anything the server checks.

**`displayName` is not asked for on any screen.** The backend generates a username
regardless of what is sent, and the comment in `identity.service` says why: the username
is a public cross zone handle and the display name is not. Nothing in the app renders a
display name today.

### 5.2 Registering signs you in, and there is no wall

`register()` issues tokens as its last act, and sends the confirmation email **outside
the transaction** with the comment that delivery failure must not roll back a successful
registration, because verification is optional. `login()` never looks at
`emailVerifiedAt` either.

So the second `Register` frame is the dashboard, not a "check your email" screen. The
nudge to confirm is a dismissible card, and everything works whether or not it is ever
acted on. **Do not build a blocking verification step.** It would be a barrier this
product does not have, and users would be stuck behind it whenever mail delivery failed.

### 5.3 Rule C2: a guest upgrades, and must never register

> **Rule C2.** If `SessionStore.isGuest` is true, the only path offered is
> `POST /v1/auth/upgrade`.

`register()` creates a **new** `User` row. `upgrade()` loads the caller's existing user,
refuses unless its kind is `TEMPORARY`, attaches the email and password hash, flips the
kind to `REGISTERED`, and returns tokens for **the same userId**. Memberships are keyed
by that userId, so upgrade keeps every group and register keeps none of them.

Nothing warns anybody. A guest who reached the register screen would fill in a perfectly
valid form, land on an empty dashboard, and have no way back: the groups still exist,
owned by an account whose only credential was the token this app just replaced.

This is the email shaped twin of rule D3 in `0004`, and it is guarded the same way, at
the route.

The upgrade screen leans on this rather than hiding it. It states the group count back
at the person, because "your 2 groups stay exactly where they are" is the reason to
spend thirty seconds on a form, and the count is already in `ZoneStore`.

### 5.4 One rejection message, on purpose

`login()` throws the same `UnauthorizedException` whether the email is unknown or the
password is wrong, with a comment saying this is so the response does not reveal which
emails are registered.

So the client shows one message, placed under the **pair** of fields:

> That email and password do not match. Check both and try again.

**Never write "no account with that email".** It would be a guess, it would sometimes be
wrong, and it would undo a deliberate privacy decision in the service.

### 5.5 The rest of the failures

`ERROR_CODES` has seven generic codes and one message each, so as in `0008` the copy is
keyed on code plus operation.

| Code | Operation | Means | Copy |
| --- | --- | --- | --- |
| `unauthorized` | `auth.login` | Wrong pair, or no such email | Section 5.4 |
| `conflict` | `auth.register` | The email is registered already | That email already has an account. Sign in instead |
| `conflict` | `auth.upgrade` | Email taken, or already registered | See section 3.2 and the row above |
| `validation_failed` | `auth.register`, `auth.upgrade` | Bad email shape, or a password under 8 | Shown against the field it belongs to, which is the one case a message is not shared |
| `rate_limited` | any | Throttled | Too many tries. Wait a minute and try again |
| `validation_failed` | `auth.verifyEmail` | Expired, consumed, or unknown token | Section 5.7 |

The `conflict` on register offers a route, not just a refusal: the message carries a
link to `auth/login` with the typed email already filled in.

### 5.6 Google is designed and cannot be wired, for two backend reasons

Both are in the gateway, both are small, and **neither is a frontend problem**. The
button keeps recording its tap until they land.

1. **The callback answers with JSON.** `GoogleController.callback` returns
   `Promise<AuthTokens>`, so a browser that followed the OAuth redirect lands on a page
   of JSON with no way back into the app. It needs to **302 to the app with the pair in
   the URL fragment**, which is what `auth/callback` and `AuthCallbackPage` exist to
   consume. The fragment specifically, because a query string is sent to the server and
   written into logs.
2. **The callback never links a guest.** It sends `{ ...profile }` and nothing else,
   while `GoogleLoginRequest.linkUserId` is the parameter that makes `googleLogin` call
   `upgrade()` and convert the caller in place. Without it, `googleLogin` finds no linked
   identity, takes the create branch, and mints a **fresh registered user**. A guest who
   taps Continue with Google therefore loses every group, exactly as rule C2 describes
   for register. The gateway must read the optional bearer token and pass its userId as
   `linkUserId`.

Until item 2 ships, **Google must not be offered to a guest at all**, even if item 1
lands first. That is a one line condition on the button and it is an acceptance
criterion below.

`AuthCallbackPage` is built now regardless, because it is inert without a fragment and
it is where item 1 will land.

### 5.7 Resending, and why the countdown is not sixty

**The user is implementing two backend changes for this plan** (section 5.8), so unlike
Google these are designed to be built, not deferred. This section assumes both exist.

**Resending is one sentence, not a button** (user decision, 2026-08-26). Inside the
nudge card, under the body text, in three states and no other chrome:

| State | Text | Colour |
| --- | --- | --- |
| Ready | Did not get it? **Send it again** | The action words amber, the question muted |
| Just sent | Sent again. You can ask for another in `0:52`. | Mint |
| Refused | Too many requests. You can ask for another in `7:31`. | Coral |

It is deliberately quiet. Confirming an email is optional here, so the affordance must
not compete with the group actions below it, and a full button would say otherwise.
After the countdown reaches zero the sentence returns to Ready.

The same sentence appears on the expired link screen, and **only when the viewer is
signed in**: resending needs to know whose email to send to, and somebody who opened the
link on a phone that never signed in is anonymous. There, it sits under the explanation
rather than inside a card.

> **Rule C3.** The countdown is the number the server returned, never a hardcoded 60.

This is the part that is easy to get wrong. The `verifyResend` throttle bucket is **three
per ten minutes**, so the fourth ask in a window waits far longer than a minute. A
hardcoded sixty would count down to zero, invite the tap, and fail again, which is worse
than not offering it. So the client renders whatever wait it was told about, and the
Refused row above is why that state is drawn at all.

**The number arrives in the response body, not a header.** `main.ts` calls
`enableCors({ origin, credentials: true })` with **no `exposedHeaders`**, so a browser
cannot read a `Retry-After` header from this API cross origin: only the CORS safelisted
response headers are readable, and `Retry-After` is not one of them. That matches the
decision `0004` already recorded for the correlation id, which is in the body for the
same reason.

`ZoneStore` is not involved. The countdown is component state in the nudge and on the
expired screen, driven by one interval that is cleared on destroy.

### 5.8 What this plan needs from the backend, and what it does without

Two changes are being implemented by the user, and this plan is written against them:

1. **A resend endpoint**, bearer authenticated, returning the wait in the body.
2. **`upgrade()` sends a verification**, so an upgraded account can be confirmed at all.

Until they land, the frontend behaviour is defined and is not a blocker: the resend
sentence is **not rendered**, exactly as the Google button is not rendered for a guest.
Everything else on all five screens works. The nudge without its last sentence is the
screen `0009` would have shipped anyway.

One thing this plan does **not** work around, because nothing can: `login()` never checks
`emailVerifiedAt`, so confirming still changes nothing observable. The nudge is honest
about that, saying confirming keeps the account yours rather than claiming it unlocks
anything.

## 6. Localization

New keys under `auth`. Rule N1 holds: no key names the product.

| Key | English | Spanish |
| --- | --- | --- |
| `auth.signIn.title` | Welcome back | Hola de nuevo |
| `auth.signIn.body` | Sign in and your groups come with you, on any phone | Entra y tus grupos te acompañan, en cualquier teléfono |
| `auth.signIn.submit` | Sign in | Entrar |
| `auth.signIn.newHere` | New here? | ¿Es tu primera vez? |
| `auth.signIn.createAccount` | Create an account | Crear una cuenta |
| `auth.register.title` | Make an account | Crea una cuenta |
| `auth.register.body` | So your lists are not tied to one phone | Para que tus listas no dependan de un solo teléfono |
| `auth.register.submit` | Create account | Crear cuenta |
| `auth.register.haveOne` | Already have one? | ¿Ya tienes una? |
| `auth.upgrade.title` | Keep what you have | Conserva lo que tienes |
| `auth.upgrade.body` | Add an email and a password to the account already on this phone. Nothing moves and nothing is lost | Añade un correo y una contraseña a la cuenta que ya está en este teléfono. Nada se mueve y nada se pierde |
| `auth.upgrade.keepsafe_one` | Your group and everything in it stay exactly where they are. This is the same account, with a way back into it | Tu grupo y todo lo que hay dentro se quedan donde están. Es la misma cuenta, con una forma de volver a entrar |
| `auth.upgrade.keepsafe_other` | Your {{count}} groups and everything in them stay exactly where they are. This is the same account, with a way back into it | Tus {{count}} grupos y todo lo que hay dentro se quedan donde están. Es la misma cuenta, con una forma de volver a entrar |
| `auth.upgrade.submit` | Secure my account | Proteger mi cuenta |
| `auth.upgrade.later` | Not now | Ahora no |
| `auth.upgrade.done` | Your account is secured. Sign in anywhere with {{email}} | Tu cuenta está protegida. Entra desde donde quieras con {{email}} |
| `auth.field.email` | Email | Correo |
| `auth.field.password` | Password | Contraseña |
| `auth.field.emailPlaceholder` | you@example.com | tu@ejemplo.com |
| `auth.field.passwordPlaceholder` | Your password | Tu contraseña |
| `auth.field.passwordRule` | At least 8 characters | Al menos 8 caracteres |
| `auth.field.showPassword` | Show password | Mostrar contraseña |
| `auth.field.hidePassword` | Hide password | Ocultar contraseña |
| `auth.verify.confirmedTitle` | Email confirmed | Correo confirmado |
| `auth.verify.confirmedBody` | {{email}} is yours. You can sign in with it on any phone | {{email}} es tuyo. Puedes entrar con él desde cualquier teléfono |
| `auth.verify.expiredTitle` | That link has run out | Ese enlace ha caducado |
| `auth.verify.expiredBody` | Confirmation links last a short while and work once. Nothing is wrong with your account: signing in and everything else works exactly the same | Los enlaces de confirmación duran poco y sirven una vez. Tu cuenta está bien: entrar y todo lo demás funciona igual |
| `auth.verify.toGroups` | Go to my groups | Ir a mis grupos |
| `auth.nudge.title` | Confirm your email | Confirma tu correo |
| `auth.nudge.body` | We sent a link to {{email}}. You can carry on without it, but confirming keeps the account yours | Te hemos enviado un enlace a {{email}}. Puedes seguir sin él, pero confirmarlo mantiene la cuenta a tu nombre |
| `auth.nudge.dismiss` | Dismiss | Descartar |
| `auth.resend.prompt` | Did not get it? | ¿No te ha llegado? |
| `auth.resend.action` | Send it again | Envíalo otra vez |
| `auth.resend.promptExpired` | Still want to confirm it? | ¿Aún quieres confirmarlo? |
| `auth.resend.sent` | Sent again. You can ask for another in {{wait}} | Enviado otra vez. Puedes pedir otro en {{wait}} |
| `auth.resend.refused` | Too many requests. You can ask for another in {{wait}} | Demasiadas peticiones. Puedes pedir otro en {{wait}} |
| `auth.error.badCredentials` | That email and password do not match. Check both and try again | Ese correo y esa contraseña no coinciden. Revisa los dos e inténtalo de nuevo |
| `auth.error.emailTaken` | That email already has an account | Ese correo ya tiene una cuenta |
| `auth.error.emailTakenAction` | Sign in instead | Entrar en su lugar |
| `auth.error.badEmail` | That does not look like an email address | Eso no parece un correo |
| `auth.error.shortPassword` | Passwords need at least 8 characters | Las contraseñas necesitan al menos 8 caracteres |
| `auth.error.tooMany` | Too many tries. Wait a minute and try again | Demasiados intentos. Espera un minuto e inténtalo de nuevo |

`auth.resend.sent` and `auth.resend.refused` take `{{wait}}` as an already formatted
`m:ss` string rather than a number of seconds, so neither language has to own the
clock format inside a translation, and neither needs a plural.

`auth.upgrade.keepsafe` is a plural pair, and `0006` records that the Angular wrapper
only learned to pass `count` after the fix in rokutranslator `0004`. Spanish agreement is
handled by writing the whole phrase per form, per `0001`.

`home.action.google` and `home.action.emailSignIn` already exist and are reused.

## 7. Accessibility and input

- **Fields are real fields.** `type="email"` with `inputmode="email"`,
  `autocomplete="email"`; passwords are `type="password"` with
  `autocomplete="current-password"` on sign in and `new-password` on register and
  upgrade, so a password manager offers to save the right thing.
- **The reveal toggle** is a `button` whose `aria-label` swaps between Show password and
  Hide password, and it never removes `autocomplete`.
- **Submit works from the keyboard.** Both screens are a real `<form>` with a submit
  button, so the phone keyboard's Go key works and does not need a separate handler.
- **The error is associated, not merely nearby.** `role="alert"`, referenced by both
  fields' `aria-describedby` on sign in, because the message is about the pair.
- **Focus after failure** returns to the first field rather than staying on the button,
  so the fix begins where the correction is made.
- **44 by 44 minimum** on the back button, the reveal toggle, the footer link, and the
  nudge's dismiss.
- **The primary keeps its name while busy** and gains `aria-busy="true"`.
- **`auth/verify` announces its outcome**: the page's heading receives focus once the
  call settles, so a screen reader reads the result rather than an empty page.

## 8. Acceptance criteria

- [ ] `auth/login`, `auth/register`, `auth/upgrade`, `auth/verify` and `auth/callback`
      are all declared before the `''` front door, and the `0008` ordering spec still passes.
- [ ] A guest hitting `auth/register` is redirected, and a non guest hitting
      `auth/upgrade` is redirected. Both are covered by guard specs, not by inspection.
- [ ] Registering lands on the dashboard signed in, with a dismissible confirm nudge and
      no blocking step anywhere.
- [ ] Upgrading keeps the **same** `userId`, and the groups listed before the upgrade are
      the groups listed after it. This is the criterion that matters most in this plan.
- [ ] The guest banner's action goes to `auth/upgrade` and never to `auth/register`.
- [ ] A rejected sign in shows exactly one message, under both fields, and it never
      claims the email is unknown.
- [ ] A `conflict` on register offers a link to sign in that carries the typed email.
- [ ] `auth/verify` consumes its token on arrival with nothing to press.
- [ ] The resend sentence renders the wait the **server** returned, and a spec proves a
      refusal longer than a minute counts down from that number rather than from 60.
- [ ] The resend sentence is absent for an anonymous viewer on the expired screen, and
      absent everywhere until the section 5.8 endpoint exists.
- [ ] The countdown's interval is cleared on destroy, proven by a spec rather than by
      reading the component.
- [ ] The Google button is **not rendered at all for a guest**, and for everybody else it
      still records rather than navigates, until section 5.6 lands.
- [ ] No `ui` component injects a service token, per rule D1.
- [ ] `npx nx lint`, `npx nx test` and `npx nx build velista` pass.

## 9. Out of scope

- **Google, as built.** Designed here, blocked on section 5.6, and the button stays
  recorded. When the backend lands, wiring it is `AuthCallbackPage` plus removing one
  condition.
- **Password reset.** There is no endpoint and no token type for it. Somebody who forgets
  their password today has no route back, which is worth saying plainly and is the most
  valuable thing the next backend plan could add.
- **The account screen**: changing a username, deleting an account, and reading
  `GET /v1/account/me`. `SessionStore` already gets the username from the token pair, so
  nothing here needs that endpoint.
- **Session expiry as a screen.** `TokenStore` already signs the user out on a failed
  refresh, and where that drops them is the account plan's problem, not this one's.
- **Biometric or device unlock**, which needs the standalone origin.
