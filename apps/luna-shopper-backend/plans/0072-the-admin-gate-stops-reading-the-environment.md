# 0072 The admin gate stops reading the environment

`0071` gives an admin a row, a password and a signed token. This plan makes catalog and harvester
believe it, and deletes the mechanism they use today.

That mechanism is `PLATFORM_ADMIN_USER_IDS`: a comma separated list of uuids, read at boot into a
`Set`, checked with `.has(userId)`. It has two problems and only the second one is interesting.
Creating an admin means editing configuration and restarting two services, which is annoying. And a
uuid is not a secret, which means the list was never really the security boundary it looked like.

The fix falls out of `0071`'s separate key at no extra cost: **the gate becomes a signature check.**

Depends on `0071` for the keypair and the token shape. No migrations, no schema, and no change to
what any route does once the caller is through the gate.

## 1. What the gate is today, and how much of it there is

There are **two** implementations, not one. `catalog/src/app/catalog/platform-admin.service.ts` and
`harvester/src/app/harvest/platform-admin.service.ts` are near identical classes with different
error strings, and each has **21 `requireAdmin` call sites**, for 42 in total.

They are not equivalent in reach, and the harvester's own doc comment says so:

> **Every subject on this service is gated**, not just the writes, which is the one way it differs
> from catalog's identical looking class. Nothing the harvester exposes is open to ordinary users:
> not the runs, not the discovered places, not the source configuration.

That matters for the admin app, because `apps/luna-shopper-admin/plans/0006` reads harvest runs and
source configuration on every screen it draws. Those reads pass this gate. Catalog is the looser
one: reads are open to any authenticated user and only writes are gated, which is why velista works
at all.

## 2. The decision

**Admin NATS subjects carry the admin token, and each service verifies it itself** with
`ADMIN_JWT_PUBLIC_KEY`.

`requireAdmin(userId: string)` becomes `requireAdmin(credential)`, where the credential is the
token the gateway forwarded. Verification is offline, against a public key the service already has
a convention for holding: catalog, core, harvester, gateway and realtime all read
`AUTH_JWT_PUBLIC_KEY` from a file today, so adding a second public key is a pattern the tree
already runs, not a new one.

`PLATFORM_ADMIN_USER_IDS` is then **deleted**, not defaulted to empty. Creating an admin is one
database write with no restart anywhere.

## 3. Why not let the gateway decide

The obvious cheaper design is: the gateway verifies the admin token, and passes `isPlatformAdmin:
true` in the NATS payload. Catalog and harvester trust it. It was rejected, and the reason is worth
recording because it is the only real argument in this plan.

Today catalog verifies admin-ness **independently of the gateway**. A gateway route that forgets its
guard, or a new admin route added without one, still cannot write the catalog, because catalog
checks for itself. A trusted boolean throws that property away and replaces it with a convention
nobody can enforce in review.

The counterargument is that the current check is weak: anything able to publish on NATS can already
claim to be an admin by sending an allowlisted uuid, and uuids leak. That is true, and it is an
argument for **strengthening** the downstream check rather than removing it. A forwarded signature
is strictly better than a uuid on exactly that axis, and it costs nothing beyond a public key in
two more `.env` files.

So the property survives and improves. The bus carries a token; every service that acts on it
proves it.

## 4. The harvester stops borrowing the admin role

The harvester writes to catalog as an admin today, holding `HARVESTER_ACTOR_ID`, a uuid that must
be listed in catalog's allowlist. `values.yaml` says so at the point of definition, and
`catalog-client.service.ts` throws an error naming the variable if it is unset. Under this plan the
harvester has no token to forward, so that route disappears.

It should not get one. **The harvester is a service, not an admin**, and giving a machine a
credential shaped like a person's is how the current confusion started. Instead:

- Catalog gains `serviceActorIds`, a small configured set of uuids belonging to **services**, and
  the harvester's actor id is the only member. It is a single stable value that never changes when
  an admin is created, so the complaint that opened this plan is fully answered.
- The admin path and the service path are separate branches of the gate, with separate error
  messages, so a log line says which one refused.
- `catalog-client.service.ts` keeps its actor plumbing and loses its reference to the deleted
  variable. Its error text is rewritten rather than removed.

**One rule from that file survives verbatim and must be carried into `0075`:**

> A run started by the owner still writes as the harvester, because the write is the harvester's:
> attributing it to the person who pressed the button would hide which changes a machine made.

An admin who starts a harvest run from the back office is not the author of the 4,000 rows it
writes, and the audit trail must not claim otherwise.

## 5. Everywhere the variable is written

This is larger than two services, and it is the reason this is its own plan rather than a section
of `0071`. Every one of these is touched:

| File                                                         | What is there                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `catalog/src/app/catalog/platform-admin.service.ts`          | the gate, 21 call sites behind it                                                       |
| `catalog/src/app/config/app-config.ts`                       | Joi schema, the typed field, the parse                                                  |
| `harvester/src/app/harvest/platform-admin.service.ts`        | the second gate, 21 more call sites                                                     |
| `harvester/src/app/config/app-config.ts`                     | Joi schema, the typed field, the parse                                                  |
| `harvester/src/app/harvest/catalog-client.service.ts`        | the actor, and an error message naming the variable                                     |
| `catalog/.env`, `catalog/.env.example`                       | the value and its explanatory comment                                                   |
| `harvester/.env`, `harvester/.env.example`                   | the value and two comments                                                              |
| `k8s/helm/values.yaml`                                       | `platformAdminUserIds`, and a comment at the harvester actor id explaining the coupling |
| `k8s/helm/templates/luna-shopper-backend/configmap.yaml.tpl` | renders it into the ConfigMap                                                           |
| `k8s/helm/templates/luna-shopper-backend/_env.tpl`           | twice: a `secretKeyRef`, and inside the harvester's forwarded key list                  |
| `k8s/e2e/luna-shopper-backend/compose.apps.yml`              | states its environment separately and inherits nothing from the slot scripts            |
| `k8s/e2e/luna-shopper-backend/luna-slot.sh`                  | writes it into two generated `.env` files                                               |
| `k8s/e2e/luna-shopper-backend/luna-slot.ps1`                 | the same, for the PowerShell twin                                                       |

The two slot scripts and the compose file are the ones that break quietly if forgotten. A generated
`.env` missing a newly required variable takes down one service at boot while the gateway stays up
and answers 500s, which reads as an application bug for as long as it takes to remember.

## 6. Tests

- Both gates: a valid admin token passes, an expired one does not, one signed with the **auth** key
  does not, one with the wrong `aud` does not.
- The service path: the configured harvester actor passes catalog's gate; an unconfigured uuid does
  not.
- A velista access token fails both gates.
- `app-config` specs assert the removed variable is gone and the new public key is required.
- The harvester's 21 read subjects still refuse an unauthenticated caller.

Run the backend suites with `nx build` as well as `nx test`, because jest does not type check and
this change moves a parameter type through 42 call sites.

## 7. Exit criteria

- `PLATFORM_ADMIN_USER_IDS` appears nowhere in the repository.
- Creating an admin requires no restart of any service.
- Catalog and harvester each verify the admin token themselves; neither trusts a gateway supplied
  flag.
- The harvester writes to catalog as a configured **service** actor, and its writes are attributed
  to it rather than to whoever started the run.
- `provision-release.sh --check` passes.
- A luna slot brought up from scratch by `luna-slot.sh --up` works, on both scripts.

## 8. Out of scope

- Route URLs, which do not change here: `0073`.
- Recording who did what: `0075`.
