# 0026 Make Google sign in genuinely optional

The gateway already treats Google as optional and says so in three separate comments. The
auth service does not, and auth is the one that decides whether the deployment boots. This
plan closes that gap and gives the Google routes a real answer when the feature is off,
instead of the 500 they produce today.

## 1. Why, and what is already done

Half of this is built. `apps/luna-shopper-backend/gateway/src/app/config/app-config.ts`
declares all three Google variables as `Joi.string().allow('').default('')`, derives a
`google.enabled` boolean from all three being set, and makes `APP_BASE_URL` required only
`.when('GOOGLE_CLIENT_ID', ...)` is non empty. `auth.module.ts` builds the `GoogleStrategy`
through a factory that returns `null` when the feature is off. `google.controller.ts`
explains the intent directly: the routes stay registered so the published OpenAPI document
describes the same API everywhere, and what is conditional is the strategy behind them.

Two things break that intent.

**The auth service contradicts it.** `apps/luna-shopper-backend/auth/src/app/config/app-config.ts:50-52`
marks `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` as
`Joi.string().required()` with no `.allow('')`. Joi rejects an empty string for a required
string, and `k8s/helm/values.yaml` ships `googleClientId: ''`. So the auth pod fails
validation and dies during boot, before it reaches the database, in exactly the deployment
the gateway was carefully written to support. The chart's own comment claims an unset client
id leaves boot unaffected. That is true of the gateway and false of auth, which is why the
inconsistency has gone unnoticed: nothing has ever booted this stack in a cluster.

**An inert route is not an answer.** `GET /v1/auth/google` is guarded by
`GoogleAuthGuard extends AuthGuard('google')`. With the strategy provider resolving to
`null`, passport has no strategy registered under that name, so the guard throws
`Unknown authentication strategy "google"`, which the global filter renders as a 500 with
the `internal` code. A caller cannot tell "this deployment has no Google" from "the gateway
is broken", and the log fills with internal errors for a configuration that is deliberate.

## 2. Target behaviour

Google unset is a supported configuration, in every service, and it is visible:

- Every service boots with all three variables empty.
- `GET /v1/auth/google` and `POST /v1/auth/google/state` answer **501 Not Implemented** with
  the house error envelope and a stable code, not a 500.
- `GET /v1/auth/google/callback` keeps its existing contract, which is that it never renders
  an error page: it redirects back to the app with an `#error=` fragment. That guard already
  turns every failure into "no user", so it needs no new branch, only the same code in the
  fragment.
- The published OpenAPI document keeps describing all three routes in every environment, as
  it does now.

501 rather than 503 or 404. 503 says "try again later", which is wrong for a deployment that
will never have Google. 404 says the route does not exist, which contradicts the decision to
keep it in the document. 501 is exactly "this server does not implement that", which is the
truth.

## 3. Work

### 3.1 A new error code

`libs/luna-shopper/platform/src/lib/errors/error-codes.ts` currently has seven codes and none
of them fits. Add:

```ts
NOT_CONFIGURED: 'not_configured',
```

`error-catalog.ts` needs an `en` and an `es` message for it. Something that reads as a
statement about the deployment rather than about the caller, because the caller did nothing
wrong:

```
en: 'That sign in method is not available on this server.'
es: 'Ese método de inicio de sesión no está disponible en este servidor.'
```

`error-catalog.spec.ts` asserts every code has a message in every locale, so a missing
translation fails the suite rather than shipping.

The global exception filter needs `NOT_CONFIGURED` mapped to HTTP 501 wherever it maps codes
to statuses.

### 3.2 Auth's schema

Mirror the gateway's, exactly:

```ts
GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').default(''),
```

and derive the same `enabled` boolean into `AuthConfig`, so the two services agree on what
"configured" means rather than each deciding for itself. The definition is all three set and
non empty.

Auth's message handlers for the Google link and create patterns then throw a domain
exception carrying `NOT_CONFIGURED` when `enabled` is false, rather than attempting a lookup
against credentials it does not have.

### 3.3 The gateway routes

A small guard that runs before the passport one and short circuits on configuration:

```ts
@Injectable()
export class GoogleConfiguredGuard implements CanActivate {
  canActivate(): boolean {
    if (!this.config.google.enabled) {
      throw new DomainException(ERROR_CODES.NOT_CONFIGURED);
    }
    return true;
  }
}
```

Applied to `GET /v1/auth/google` ahead of `GoogleAuthGuard`, and to
`POST /v1/auth/google/state`. Minting a state for a flow that cannot proceed is the same
error one step earlier, and answering it at the state endpoint is what lets the frontend hide
the button before the user clicks it.

The callback keeps `GoogleCallbackGuard` untouched.

### 3.4 SMTP has the identical problem

Not Google, but the same shape and the same blast radius, so it belongs in the same change.
`auth/src/app/config/app-config.ts:55` marks `SMTP_HOST: Joi.string().required()`, and
`values.yaml` ships `smtpHost: ''`. Auth dies on that line whether or not Google is fixed.

The decision is different, though, and it should be made deliberately rather than by
copying. Google sign in is one way in among several. Email is load bearing: without it,
`POST /v1/auth/register` accepts a signup whose confirmation link is never sent, and the
account is unreachable. Two options:

1. **Make it optional the same way**, with an `email.enabled` flag, and have registration
   fail with `NOT_CONFIGURED` when it is off. Honest, and it makes an SMTP-less staging
   cluster a supported configuration.
2. **Keep it required** and give staging real SMTP credentials.

Prefer 1 for the first smoke test, because it removes a dependency on an external service
from the thing being smoke tested, and adopt 2 before staging is used to exercise the signup
flow. Whichever is chosen, it must be chosen: leaving `.required()` against an empty default
is the current state, and the current state does not boot.

### 3.5 Regenerate the OpenAPI document

Adding a 501 response to two routes changes the document, and
`apps/luna-shopper-backend/gateway/src/app/docs/openapi-document.spec.ts` fails when the
committed copy is stale. Per `CLAUDE.md`, before finishing:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

Commit the diff. Never hand edit `openapi.json`.

## 4. Verification

- `luna-shopper-backend-auth` boots with all Google and SMTP variables empty. This is the
  assertion that matters, and it is the one no existing test makes: add a spec over
  `authValidationSchema` that validates an environment with the empty strings the chart
  actually sends.
- `GET /v1/auth/google` with the feature off answers 501 and the `not_configured` code, with
  a localized message in both `en` and `es`.
- The callback with the feature off still redirects rather than rendering.
- With Google configured, every existing spec still passes unchanged. Nothing in this plan
  changes the configured path.
