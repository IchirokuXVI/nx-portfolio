# 0231: the operator states who runs it, and every account accepts the terms

> Luna Shopper is open source and anybody may deploy it. Velista is one deployment of it. A
> privacy policy and Terms of Service must name who runs a deployment, how to reach them and
> which optional parts are switched on, and those facts belong to the operator, not to the
> repository. This plan gives the gateway one public route that answers them, gives the
> operator one way to supply them that never puts the owner's own values in git, and records
> for every account which version of the terms it accepted and when, on every path that
> creates an account. Velista plans `0172` (the public pages) and `0173` (the acceptance UI)
> read the contract fixed here.
>
> Prerequisite reading: `0005` sections 4.1 to 4.5 (the four ways an account starts), `0023`
> sections 4.1 and 4.2 (the OAuth state), `0230` sections 3 and 4 (the callback stages a
> handoff and `exchangeGoogleSignIn` signs in; this plan assumes `0230` is built and changes
> that flow, not the one before it), `0026` (an unconfigured feature answers 501 and
> never breaks boot), `0194` (support sessions, and why production waits for the policy to
> name them), `0224` (the provider switch), and in the k8s tree `bootstrap/provision-release.sh`
> and `helm/velista/templates/luna-shopper-backend/_env.tpl`.

## Brief for the agent

### Objective

Add a public `GET /v1/legal/settings` route that answers the operator's legal settings, an
effective terms version, and a record of terms acceptance in auth that register, upgrade,
Google sign in and guest creation all write. Add `POST /v1/account/terms-acceptances` and a
`terms` block on `GET /v1/account/me`. Make the operator's values reach the gateway and auth
from deploy configuration, with chart keys that default to empty and a Secret that
`provision-release.sh` writes from a file outside git.

### Context

Every statement below was read on `dev` on 2026-10-27.

- An account starts in four places in auth: `createTemporaryUser`
  (`auth/src/app/identity/identity.service.ts:202`), `register` (`:215`), `upgrade` (`:974`) and
  `googleLogin` (`:1448`), which either upgrades a guest through `linkUserId` (`:1469` to
  `:1478`) or creates a registered user (`:1481` to `:1497`). The sign in page therefore creates
  accounts too, for a person who has never used the app.
- The gateway mints a guest only on zone create and join (`gateway/src/app/zones/zone.controller.ts:102`
  to `:113`), and the request contract for it is empty: `CreateTemporaryUserRequest =
  Record<string, never>` (`libs/luna-shopper/contracts/src/lib/messages/auth.messages.ts:157`).
- The Google flow starts with `POST /v1/auth/google/state` (`gateway/src/app/auth/google.controller.ts:96`
  to `:117`), which takes no body today, and ends in the callback, which spends the state.
  After plan `0230` the callback copies what the state carried into an `oauth_handoffs` row,
  and `exchangeGoogleSignIn` spends that row and calls `googleLogin`. The state row is
  `oauth_states` (`auth/src/app/entities/oauth-state.entity.ts:25`), holding `userId` and
  `locale`. Whatever must cross the Google round trip has to ride in that row and then in the
  handoff row.
- `GET /v1/account/me` composes auth's `UserProfileView` with core's app state and the token's
  permissions (`gateway/src/app/account/account.controller.ts:113` to `:127`). The view is
  `AccountMeView` (`contracts/src/lib/messages/app-state.messages.ts:77`) and its schema is
  composed by the gateway (`contracts/src/schemas/messages/app-state.schemas.ts:77`).
- The gateway already knows whether Google is configured (`gateway/src/app/config/app-config.ts:394`
  to `:398`). It does not know whether the assistant can answer: there is deliberately no
  `enabled` switch, and an absent provider key is a supported deployment that answers 501
  (`k8s/helm/velista/values.yaml:431` to `:457`). It does not read `IMPERSONATION_ENABLED`
  either: auth alone does (`helm/velista/templates/luna-shopper-backend/configmap.yaml.tpl`,
  the support sessions comment, and `_env.tpl:314`).
- The chart ConfigMap belongs to the chart, and a helm upgrade overwrites anything written into
  it. That is why `HARVESTER_ACTOR_ID` lives in the provisioned Secret instead
  (`configmap.yaml.tpl`, the comment beginning "SERVICE_ACTOR_IDS and HARVESTER_ACTOR_ID ARE
  NOT HERE").
- `provision-release.sh` keeps every existing value on a rerun (`existing` and
  `keep_or_generate`, `k8s/bootstrap/provision-release.sh:565` to `:600`), names the keys
  allowed to be empty (`:163`), and `--check` asserts every `secretKeyRef` the render names
  (`:113` to `:143`). The Secrets of the unit are listed in `k8s/units/velista/unit.env`
  (`SECRETS=`). CI runs only `--check`; the owner runs the provisioning half by hand on the
  host.
- Error codes live in `libs/luna-shopper/platform/src/lib/errors/error-codes.ts` (codes at
  `:13` to `:477`, `ERROR_STATUS` at `:501`), their sentences in `error-catalog.ts`, their
  exceptions in `domain-exception.ts`, and the per route documentation switch in
  `gateway/src/app/docs/api-problem-responses.decorator.ts:12`.
- Backups are rendered from `lunaShopperBackend.backups.enabled` and `suspend`
  (`values.yaml:860` to `:864`); the 14 day expiry is an object storage lifecycle rule on the
  bucket, not a cluster setting (`values.yaml:855` to `:859`).

### Target state

- `GET /v1/legal/settings` answers section 2's shape with no token, on every deployment,
  configured or not.
- Every account created or upgraded after this plan, on any of the five paths of section 4,
  has a `terms_acceptances` row when the client sent a version, and is refused with a named
  code when the version is stale.
- `GET /v1/account/me` says whether this account must accept the terms now.
- With `TERMS_ACCEPTANCE_REQUIRED` false (the default everywhere), no request that worked
  before this plan is refused.
- No value of the owner's deployment is in the repository: not in `values.production.yaml`,
  not in `values.staging.yaml`, not in a test fixture.
- `openapi.json` and `wire-types.ts` are regenerated and committed.

### Scope

- Work in: `libs/luna-shopper/contracts` (a new `lib/legal/` folder, `auth.messages.ts`,
  `app-state.messages.ts`, `assistant.messages.ts`, their schemas), `libs/luna-shopper/platform`
  (error codes, catalog, exceptions), `auth/src/app` (a new entity, a migration, `identity/`,
  config), `gateway/src/app` (a new `legal/` folder, `auth/`, `account/`, `zones/`, config,
  docs), `assistant/src/app` (one capability handler), `k8s/helm/velista` (values, ConfigMap,
  `_env.tpl`), `k8s/bootstrap/provision-release.sh`, `k8s/units/velista/unit.env`, the two
  generated files, and this plan file.
- Do NOT touch: velista or the back office sources, the texts of the documents (velista `0172`
  writes them), any `values.*.yaml` beyond the keys section 5 names, `.github/workflows`,
  `package.json`, `package-lock.json`.

### Constraints

- No new dependency.
- The owner's values (app name, controller, contact address, processor names) are never
  written to a tracked file, also not as an example. Examples use `Example Shopper`,
  `Jane Example` and `privacy@example.invalid`.
- No route except the two named in section 4 refuses a request because of the terms. The
  prompt that blocks the app is velista's (plan `0173`).
- Every POST answers 201 with a contract body. No 204.
- Prettier on each changed file, never on a directory, with `--end-of-line auto`.

### Acceptance criteria

- [ ] `GET /v1/legal/settings` answers section 2 with `Cache-Control: public, max-age=300`, and
      a gateway spec covers an unconfigured and a configured deployment.
- [ ] Each path of section 4.2 records a row when given the current version, refuses
      `terms_version_stale` when given another, and with `TERMS_ACCEPTANCE_REQUIRED=true`
      refuses `terms_acceptance_missing` when given none.
- [ ] A Google sign in keeps working when the version changed inside the ten minutes of its
      state: it records nothing and the account then reads `acceptanceRequired: true`.
- [ ] `POST /v1/account/terms-acceptances` is idempotent and refuses a support session.
- [ ] An auth integration spec on real Postgres proves the migration, the unique key and the
      cascade on account delete.
- [ ] `provision-release.sh --operator-file` refuses a path inside the repository and an
      unknown key, and `--check` refuses a render that requires acceptance with no controller
      or contact.
- [ ] `npx nx run luna-shopper-backend-gateway:openapi` and
      `npx nx run luna-shopper-admin/models:wire-types` leave no diff after the commit.

### Action boundaries

- Proceed with in-scope edits, specs, lint, build, integration specs on an ephemeral slot.
- Stop and ask before changing a route that this plan does not name, before making any value
  required at boot, and before running `provision-release.sh` against a real cluster.

### Progress evidence

Report after the contracts compile, after the auth integration spec passes, and after the two
generators leave a clean tree. Ground each claim in a command's output.

## 1. The terms version

The text of the documents is velista's, written by plan `0172`. The repository's template has
a version, and an operator may amend their own deployment's terms on top of it. One string has
to name both, because it is what a person accepted.

`libs/luna-shopper/contracts/src/lib/legal/legal-documents.ts`:

```ts
/** The repository's templates. Bumped in the PR that changes their meaning. */
export const LEGAL_TEMPLATES = {
  terms: { version: '2026-11-01' },
  privacy: { updatedOn: '2026-11-01' },
} as const;

/** `2026-11-01` alone, or `2026-11-01+2026-12-15` with an operator revision. */
export function effectiveTermsVersion(operatorRevision: string): string;

/** The later of the template date and the operator revision, as `YYYY-MM-DD`. */
export function termsUpdatedOn(operatorRevision: string): string;
export function privacyUpdatedOn(operatorRevision: string): string;
```

- The template version is a date, the day its text last changed in meaning. The builder sets
  it to the day this plan merges. Velista `0172` sets it again, in the PR that adds the texts,
  and adds a velista spec that its text and this constant name the same date. A wording fix
  that changes no meaning does not bump it, because a bump asks every account to accept again.
- `LEGAL_TERMS_REVISION` (section 5) is the operator's own date, empty by default. When the
  operator changes their terms they set it to that day, and every account is asked again.
- Acceptance compares the strings exactly. Nothing parses them for order: a version is either
  the current one or it is not.
- Auth and the gateway both compute the version from the constant and the same env key, with
  the same function. They cannot disagree unless the two pods were given different values,
  and the chart gives both the same key.

## 2. `GET /v1/legal/settings`

Public, unauthenticated, under the default throttle. A new `LegalController` in
`gateway/src/app/legal/`, documented with `ApiComposedResponse` like `GET /v1/account/me`,
because the gateway composes it. It answers with `Cache-Control: public, max-age=300`.

```ts
export interface LegalSettingsView {
  /** Defaults to "Luna Shopper". */
  appName: string;
  /** The data controller: a person or a company. Null until the operator sets it. */
  controllerName: string | null;
  /** Where a person sends a data request. Null until the operator sets it. */
  contactEmail: string | null;
  /** True when both of the above are set. False means: draw no documents, say the operator has published none. */
  published: boolean;
  terms: {
    /** The effective version of section 1. What a client sends back as `acceptedTermsVersion`. */
    version: string;
    /** `YYYY-MM-DD`. */
    updatedOn: string;
    /** `TERMS_ACCEPTANCE_REQUIRED` of this deployment. */
    acceptanceRequired: boolean;
  };
  privacy: { updatedOn: string };
  features: {
    googleSignIn: boolean;
    assistant: boolean;
    /** Voice: spoken assistant turns and voice comment transcripts. Velista hides voice when false. */
    transcription: boolean;
    offsiteBackups: boolean;
    /** Support sessions (plan 0194). */
    supportAccess: boolean;
  };
  processors: {
    hosting: string | null;
    email: string | null;
    /** Who answers a typed assistant turn. Null when `features.assistant` is false. */
    aiText: AiTextProvider | null;
    offsiteBackups: string | null;
  };
  retention: {
    auditTrailDays: number;
    adminLoginFailureDays: number;
    expiredGrantDays: number;
    applicationLogDays: number;
    assistantLogDays: number;
    /** Null when `features.offsiteBackups` is false. */
    backupDays: number | null;
  };
}

export enum AiTextProvider {
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
}
```

The brief's feature list maps onto it like this: Google sign in, assistant, voice
transcription and off-site backups are `features`; the email provider name is
`processors.email`, and a null there means the policy has no email section.

Where each field comes from, and why each source is the one that cannot lie:

| Field | Source |
|---|---|
| `appName`, `controllerName`, `contactEmail`, `processors.hosting`, `processors.email`, `processors.offsiteBackups` | The operator's values, section 5. Empty reads as null; `appName` falls back to `Luna Shopper`. |
| `terms.*`, `privacy.updatedOn` | Section 1, from `LEGAL_TERMS_REVISION` and `LEGAL_PRIVACY_REVISION`. |
| `terms.acceptanceRequired` | `TERMS_ACCEPTANCE_REQUIRED`, chart owned. |
| `features.googleSignIn` | `config.google.enabled`, which already decides whether the Google routes answer 501. |
| `features.assistant`, `features.transcription`, `processors.aiText` | Asked of the assistant, section 3. |
| `features.offsiteBackups` | `LEGAL_OFFSITE_BACKUPS`, which the chart renders from `backups.enabled and not backups.suspend`, so it is true exactly where the CronJobs run nightly. |
| `features.supportAccess` | `IMPERSONATION_ENABLED`, which `_env.tpl` now also gives the gateway. The gateway only reports it; auth still alone enforces it. |
| `retention.auditTrailDays`, `adminLoginFailureDays`, `expiredGrantDays` | `RETENTION_AUDIT`, `RETENTION_ADMIN_LOGIN_FAILURES`, `RETENTION_EXPIRED_GRANTS`, the very keys plan `0233` enforces with, converted to whole days. Defaults `180d`, `90d`, `14d`. |
| `retention.applicationLogDays`, `assistantLogDays` | `LEGAL_APPLICATION_LOG_DAYS` (30) and `LEGAL_ASSISTANT_LOG_DAYS` (7), chart owned. k8s plan `0018` enforces them and may change the assistant default; the gateway only reports the number it is given. |
| `retention.backupDays` | `LEGAL_BACKUP_RETENTION_DAYS` (14), chart owned under `backups.retentionDays`, documenting the bucket's lifecycle rule. |

A deployment that has published nothing still answers this route, with `published: false`.
That is the 0026 rule again: an unconfigured feature is a supported deployment.

## 3. What the assistant can do, asked of the assistant

A new subject, `ASSISTANT_PATTERNS.capabilities: 'assistant.capabilities'`, empty request,
reply:

```ts
export interface AssistantCapabilities {
  /** A typed turn can be answered: the selected provider has its key. */
  answers: boolean;
  /** A recording can be transcribed by whatever transcribes in this deployment. */
  hears: boolean;
  /** Who answers a typed turn, when `answers` is true. */
  textProvider: AiTextProvider | null;
}
```

The assistant computes it from its own config, with the same checks that today decide its 501
(plan `0224` section 5 for the provider and its key). `hears` is true today when the Gemini key
is set, because Gemini hears in both provider modes (`assistant/src/app/config/app-config.ts:257`).
Plan `0235` replaces what transcribes with a self hosted transcriber, and it changes how
`hears` is computed and nothing else here: a deployment with no transcriber says false, and
velista hides voice. If `0235` moves transcription to a service of its own, that service
answers this field instead, and `0235` says so.

The gateway asks once at boot and every 60 seconds, keeps the last answer, and serves the last
answer. Before the first answer arrives it serves `assistant: true` (a policy that describes
an assistant that is off says too much, which is the harmless direction) and `transcription:
false` (a voice button that does nothing is the harmful direction for the UI), and logs a
warning. It never makes the public route wait on NATS.

## 4. Recording acceptance

### 4.1 The table

Auth gains `terms_acceptances`:

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `userId` | uuid not null | FK `users.id` `ON DELETE CASCADE`, so an account delete takes it (plan `0232`) |
| `version` | varchar not null | The effective version of section 1 |
| `acceptedAt` | timestamptz not null default now() | |
| `via` | enum `terms_acceptance_via` | `REGISTER`, `UPGRADE`, `GOOGLE`, `GUEST`, `PROMPT` |

Unique `(userId, version)`: accepting the same version twice is one fact. A history rather
than two columns on `users`, because the question somebody asks later is "which version did
this account accept, and when", for every version, not only the last one. The migration takes
the next timestamp after the newest entry of `auth/src/app/db/migrations/index.ts` at build
time (`1772800000000-RecoveryGrants` today) and is registered there.

`TermsService` in `auth/src/app/identity/terms.service.ts` owns the one rule, used by every path:

```ts
/** Throws when `supplied` is present and not current, or absent while acceptance is required. */
assertAcceptable(supplied: string | undefined): void;
/** Inserts `(userId, version, via)` ON CONFLICT DO NOTHING, inside the caller's transaction. */
record(manager: EntityManager, userId: string, version: string, via: TermsAcceptanceVia): Promise<void>;
/** The newest row of the account, or null. */
latest(userId: string): Promise<{ version: string; acceptedAt: Date } | null>;
```

### 4.2 The five paths

Each request contract gains one optional field, `acceptedTermsVersion?: string`, and the
matching gateway DTO gains it with `@IsOptional() @IsString() @MaxLength(64)`.

| Path | Contract that gains the field | Where auth checks and records |
|---|---|---|
| Register (`POST /v1/auth/register`) | `RegisterRequest` | `register`, before the transaction; recorded inside it, `via REGISTER` |
| Upgrade with a typed address (`POST /v1/auth/upgrade`) | `UpgradeRequest` | `upgrade`, before the transaction; recorded inside it, `via UPGRADE` |
| Guest creation (`POST /v1/zones`, `POST /v1/zones/join`, anonymous only) | `CreateTemporaryUserRequest` becomes `{ acceptedTermsVersion?: string }`; `CreateZoneDto` and `JoinZoneDto` gain the field, and the gateway passes it only on the anonymous branch of `resolveIdentity` | `createTemporaryUser`, one transaction with the user insert, `via GUEST` |
| Google, start (`POST /v1/auth/google/state`) | The route gains a body DTO `MintOAuthStateDto { acceptedTermsVersion? }`; `MintOAuthStateRequest` and `OAuthStatePayload` gain the field; `oauth_states` gains a nullable `termsVersion` column in the same migration | `mintOAuthState` checks; nothing is recorded yet, because no account may exist yet |
| Google, finish (the callback stages, the exchange signs in, plan `0230`) | The callback copies the state's version into `stageGoogleSignIn`'s request, and `oauth_handoffs` gains a nullable `termsVersion` column in the same migration; `GoogleLoginRequest` gains the field, filled by `exchangeGoogleSignIn` from the spent handoff | Nothing at the callback; `exchangeGoogleSignIn` passes the version to `googleLogin`, which records `via GOOGLE` on all three branches: an existing identity, a guest upgraded in place (passed on to `upgrade`, which records `via GOOGLE` rather than `UPGRADE`), and a new account |

Rules that are easy to get wrong:

- **The Google check happens at the start and not at the finish.** The start is a JSON POST,
  so a refusal there reaches velista as a problem it can show; the finish is a redirect, where
  a refusal costs the person the whole sign in. At the exchange, a version that is no longer
  current (it changed inside the state's ten minutes) is recorded as nothing, the sign in
  succeeds, and `GET /v1/account/me` then says acceptance is required. Never fail a sign in
  over it.
- **An existing account that signs in with Google records an acceptance too.** Velista shows
  "By continuing with Google you accept the Terms" on the sign in page, so continuing is
  accepting. An email sign in records nothing: it carries no version, and the prompt of
  velista `0173` covers it.
- **A supplied version that is stale is refused even while acceptance is not required.** Only
  a client that drew a version sends one, so a mismatch means the person read a text that is
  no longer the text.
- **An authenticated caller of zone create or join records nothing**, whatever the body says:
  the notice beside those buttons speaks about the account that is created for you.

### 4.3 Error codes

Added to `ERROR_CODES`, `ERROR_STATUS`, the catalog in both languages, and
`api-problem-responses.decorator.ts` as a `terms: true` option on the five routes and the
accept route:

| Code | Status | When | `details` |
|---|---|---|---|
| `terms_version_stale` | 409 | A version was sent and it is not the current one | `{ currentVersion: string }` |
| `terms_acceptance_missing` | 400 | No version was sent and `TERMS_ACCEPTANCE_REQUIRED` is true | `{ currentVersion: string }` |

Catalog sentences: "The Terms changed while this page was open. Read the new version and
accept it to continue." / "Los Términos han cambiado mientras tenías esta página abierta. Lee
la nueva versión y acéptala para continuar." for the first; "Accept the Terms to continue." /
"Acepta los Términos para continuar." for the second. Velista `0173` may word its own copy;
these are what a client without its own sentence shows.

### 4.4 The read and the accept route

`UserProfileView` gains `termsAcceptedVersion: string | null` and `termsAcceptedAt: string |
null`, from `latest`. `AccountMeView` gains:

```ts
terms: {
  currentVersion: string;
  acceptedVersion: string | null;
  /** True when TERMS_ACCEPTANCE_REQUIRED and acceptedVersion !== currentVersion. */
  acceptanceRequired: boolean;
};
```

The gateway computes `terms` from the profile and its own config. A guest is an account and
reads the same way.

`POST /v1/account/terms-acceptances`, body `{ version: string }`, bearer required,
`@RefuseImpersonation()` (an operator in a support session must not accept on somebody's
behalf), throttled with a new bucket `termsAccept` of 10 per minute. It sends
`AUTH_PATTERNS.acceptTerms: 'auth.acceptTerms'` with `{ userId, version }`; auth refuses a
stale version with `terms_version_stale`, records `via PROMPT` otherwise, and answers 201:

```ts
export interface TermsAcceptanceView {
  version: string;
  acceptedAt: string;
}
```

A repeat answers the existing row with 201. The route is the only way to accept outside the
five paths.

## 5. How the operator's values reach the pods

Three kinds of value, and each has its own home.

### 5.1 The operator's own values

Eight keys, read by the gateway (all eight) and by auth (`LEGAL_TERMS_REVISION` only):

| Key | Meaning |
|---|---|
| `LEGAL_APP_NAME` | The name the documents use |
| `LEGAL_CONTROLLER_NAME` | The data controller |
| `LEGAL_CONTACT_EMAIL` | The address for data requests; validated as an email when set |
| `LEGAL_HOSTING_PROVIDER` | Optional name of the host |
| `LEGAL_EMAIL_PROVIDER` | Name of the mail provider; empty hides the section |
| `LEGAL_BACKUP_PROVIDER` | Optional description of the off-site storage |
| `LEGAL_TERMS_REVISION` | Section 1; `YYYY-MM-DD` or empty |
| `LEGAL_PRIVACY_REVISION` | The same, for the policy |

All default to empty in the Joi schemas of both services. The gateway's schema also refuses to
boot with `TERMS_ACCEPTANCE_REQUIRED=true` and an empty controller or contact, because
requiring acceptance of terms nobody published is the one combination that is wrong in every
deployment.

For a self hoster on Docker Compose these are eight environment variables and nothing else.
For the chart there are two sources, chosen per key at render time so the pod gets exactly one
env entry for each:

- **Chart values**, `lunaShopperBackend.legal.{appName, controllerName, contactEmail,
  hostingProvider, emailProvider, backupProvider, termsRevision, privacyRevision}`, all `''`
  in `values.yaml`. A self hoster with a private values file sets them there, and the
  template renders a non empty one as a literal `value:`.
- **The operator Secret**, `luna-shopper-backend-operator`, used for every key whose chart
  value is empty, through `secretKeyRef`. This is the owner's path: his chart values are in a
  public repository until k8s backlog `0003`, so his entries stay empty and his values live
  only in the cluster.

The values are not secret. A Secret rather than a ConfigMap because it is provisioned by the
script and never by the chart, which is exactly the property `HARVESTER_ACTOR_ID` needed, and
because `--check` already knows how to assert a provisioned Secret. A Secret of its own rather
than keys in `luna-shopper-backend-secrets`, so that rewriting the operator's name can never
touch a database password or a signing key.

### 5.2 `provision-release.sh`

- `luna-shopper-backend-operator` is added to `SECRETS` in `k8s/units/velista/unit.env`, and
  its eight keys to `OPTIONAL_EMPTY_KEYS`: every one of them may be empty in a valid
  deployment.
- A new option `--operator-file <path>` reads a file of `KEY=value` lines. It refuses a path
  inside the repository (the resolved path starts with `$REPO_ROOT`), refuses a key that is not
  one of the eight, and writes the Secret with exactly the file's keys, absent keys empty. The
  file is the whole statement, so what is in it is what is live.
- Without the option, existing values are kept, by `existing`, like every other key. A fresh
  cluster gets the Secret with eight empty keys, so the deploy that first renders the
  `secretKeyRef`s passes `--check`.
- The plaintext `--out` copy does not include them. They are not credentials, and the file
  they came from is already the operator's copy.
- `--check` gains one assertion: when the render sets `TERMS_ACCEPTANCE_REQUIRED` to `true`,
  `LEGAL_CONTROLLER_NAME` and `LEGAL_CONTACT_EMAIL` must be non empty in the render or in the
  cluster Secret. With `--render-only` it checks the render and says it skipped the cluster
  half.

The owner's file sits outside git, for example `~/velista-operator.production.env`, with his
values in it. This plan writes no example of his values anywhere.

### 5.3 Chart owned deployment facts

These describe the shape of a deployment and are fine to commit. Added to the chart ConfigMap
and to the gateway's list in `_env.tpl:130`:

| Key | Values key | Default |
|---|---|---|
| `TERMS_ACCEPTANCE_REQUIRED` | `config.termsAcceptanceRequired` | `false` (auth gets it too) |
| `LEGAL_OFFSITE_BACKUPS` | derived from `backups.enabled` and `backups.suspend` | |
| `LEGAL_BACKUP_RETENTION_DAYS` | `backups.retentionDays` | `14` |
| `LEGAL_APPLICATION_LOG_DAYS` | `config.legal.applicationLogDays` | `30` |
| `LEGAL_ASSISTANT_LOG_DAYS` | `config.legal.assistantLogDays` | `7` |
| `RETENTION_AUDIT`, `RETENTION_ADMIN_LOGIN_FAILURES`, `RETENTION_EXPIRED_GRANTS` | `config.retention.*` | `180d`, `90d`, `14d`; plan `0233` adds the keys and gives them to auth, core and catalog, and this plan gives the same keys to the gateway |
| `IMPERSONATION_ENABLED` | the existing `config.impersonationEnabled` | now also on the gateway |

If `0233` is not built yet, this plan adds the three `RETENTION_*` keys itself with those
defaults, and `0233` then only gives them to the services that enforce them.

## 6. Rollout, in order

1. Merge and deploy this plan. `TERMS_ACCEPTANCE_REQUIRED` is false everywhere, so nothing is
   refused for a missing version, and the e2e gates are untouched. The Secret must exist
   first: the owner runs `provision-release.sh --unit velista --env staging` (and later
   production) on the host once, with or without `--operator-file`, before the deploy that
   renders it.
2. The owner provisions his values with `--operator-file` on staging, and velista `0172`
   publishes the documents there.
3. Velista `0173` ships and sends the version on every path.
4. The owner sets `termsAcceptanceRequired: true` in `values.staging.yaml`, then in
   `values.production.yaml`, in the same PR that raises `minClientVersion` to the first build
   of `0173`. Without the floor, an installed velista from before `0173` would meet
   `terms_acceptance_missing` on register with no idea what it means.
5. Velista `0173` (or this plan's follow up) gives the e2e compose of
   `k8s/e2e/velista-luna` invented operator values and turns acceptance on there, so the gate
   proves the flow. Not before step 3, or the gate turns red for a UI that does not exist.

Plan `0233` should be deployed before step 2, because the policy states retention periods that
only `0233` enforces.

## 7. Tests

- Contracts: `effectiveTermsVersion` and the two `updatedOn` functions, including an empty
  revision and a revision earlier than the template (the later date wins for `updatedOn`; the
  version still carries both).
- Auth unit specs, `identity-terms.spec.ts`: each path of 4.2 with the current version, a
  stale one, none with acceptance off, none with acceptance on; the Google exchange with a handoff
  whose version went stale; an existing Google identity recording a new version; the accept
  route twice.
- Auth integration spec on real Postgres, `terms-acceptance.integration.spec.ts`, in a scratch
  schema like `tokens/token-grant.integration.spec.ts`: the migration, the unique key under two
  concurrent accepts, the new `oauth_states.termsVersion` column, and that deleting the user
  removes its rows.
- Gateway specs: the settings route unconfigured, configured, before and after the first
  capability answer; `me` with each combination of required and accepted; the accept route
  refusing a support session.
- Assistant spec: `capabilities` for each provider with and without its key.
- `provision-release.sh`: run `--check --render-only` against both environment files and a
  values file that sets acceptance on with nothing else, and show the refusal.

Then regenerate and commit, in this order:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 8. Dependencies

- None blocks this plan. It reads three retention keys that plan `0233` enforces and adds them
  itself if `0233` is not built (section 5.3).
- Plan `0232` relies on the cascade of 4.1 and adds nothing for this table.
- Plan `0235` changes how `hears` is computed (section 3) and nothing else here.
- Plans `0226` and `0227` (provider registry, unbuilt) would move the provider choice into
  rows. If they land, `textProvider` is read from the registry's model for the turn job, and
  the reply shape stays.
- Velista `0172` and `0173` consume sections 2 and 4 as written.

## 9. Decisions

The owner's, from the brief: two documents, templates filled from operator settings, a
recorded version and time on every path including guests and upgrade, a prompt that blocks the
app for existing accounts and after a version change, a checkbox only on the email forms, no
age gate, no export endpoint, and nothing of the owner's deployment committed.

Mine, for the owner to change:

1. **Acceptance enforcement is a switch, off by default**, so the backend can ship before
   velista `0173` without refusing anybody (section 6).
2. **No route outside the five paths and the accept route refuses an account that has not
   accepted.** The blocking prompt is the UI's. A server gate on every route would break the
   socket, the assistant and every open screen at the moment of a version bump.
3. **A history table with a `via` column** rather than two columns on `users`.
4. **An existing account that signs in with Google records an acceptance.**
5. **A stale version in a Google handoff signs the person in and asks afterwards**, rather
   than refusing at the exchange.
6. **The operator's values live in a Secret of their own, written from a file outside the
   repository**, with chart values winning per key when a self hoster sets them.
7. **`features.supportAccess` and the `retention` block** were not in the brief's list. The
   first exists because production waits for the policy to name support sessions
   (`values.yaml`, `impersonationEnabled`); the second because a policy that states a period
   should read it from the setting that enforces it.
8. **The assistant's capability is asked over NATS** rather than declared in the chart, since
   the chart cannot know whether a provider key is present. Unknown means "assistant on,
   transcription off".
9. **The version is a date string**, compared for equality, `template+revision` when the
   operator amends.

## 10. What the build decided

The builder's choices where the plan left room. Each is the owner's to change.

1. **The template version is `2026-10-28`**, the day of the build, not the `2026-11-01` of
   section 1. Section 1 says the builder sets it to the merge day. Velista `0172` sets it
   again when it adds the texts.
2. **`hears` is `answers && transcriptionSupported`**, the exact test `transcribe` applies
   before its 501. With `ASSISTANT_PROVIDER=claude`, no Anthropic key and a Gemini key, the
   assistant answers 501 to a recording today, so `hears` is false there too.
3. **The capability probe has a 5 second timeout per question.** Nest's NATS client waits
   forever, and a question that never returns would hold the next poll back. A failed poll
   keeps the last answer.
4. **`lunaShopperBackend.legal.secret`** names the operator Secret, as `backups.secret` names
   the backup Secret. Its default is `luna-shopper-backend-operator`.
5. **`provision-release.sh --values <path>`** layers one more values file after the
   environment's, with `--check` only. Section 7 asks for a run against a values file that
   sets acceptance on, and the script had no way to take one.
6. **`--check --render-only` cannot refuse a controller or contact that comes from the
   Secret.** It reads no cluster, so it says it skipped those keys. A literal in the values
   is checked. The full `--check` on the host refuses an empty Secret value. The build
   proved that half against a stub `kubectl`, not a cluster.
7. **The operator file is read before anything is written.** A file inside the repository,
   a line that is not `KEY=value`, or an unknown key stops the script before it creates the
   namespace. One pair of quotes around a value and a trailing carriage return are removed.
8. **`TermsVersionStaleException` and `TermsAcceptanceMissingException` publish their
   details**, so `details.currentVersion` reaches the client. Velista's `problem.ts` and
   `errors.ts` do not know the two codes yet. Plan `0173` adds them.
9. **The deploy that follows the merge needs the operator Secret first.** The gateway and
   auth now read eight (auth: one) `secretKeyRef`s from `luna-shopper-backend-operator`, and
   the deploy preflight refuses a cluster that does not have it. Run
   `provision-release.sh --unit velista --env staging` on the host before the staging deploy,
   and the same with `--env production` before the next release (section 6, step 1).
