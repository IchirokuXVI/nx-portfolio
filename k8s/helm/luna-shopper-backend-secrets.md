# Luna Shopper runtime Secrets

The Luna Shopper chart (`lunaShopperBackend` in `values.yaml`, plan 0002) reads its
sensitive values from Kubernetes Secrets that are **created out of band and never
committed**. Nothing secret lives in the chart, `values.yaml`, an image, or a build
arg. Non secret config (hosts, log level, mail sender, token TTLs, the JWT key id)
is in the rendered ConfigMap; only the values below are Secrets.

`lunaShopperBackend.enabled` defaults to `false`; turn it on only once these Secrets
exist and the `api.` / `rt.` DNS records point at the cluster.

## Creating them

**Do not create these by hand.** Run:

```sh
./k8s/bootstrap/provision-release.sh --env staging
./k8s/bootstrap/provision-release.sh --check --env staging
```

This document used to be a block of `kubectl create secret` commands to copy,
edit and paste. Plan 0006 replaced that with the script, for reasons that are
about correctness rather than convenience:

- **Nothing checked that the values agreed with each other.** The password inside
  `AUTH_DB_URL` must match `POSTGRES_PASSWORD` in
  `luna-shopper-backend-auth-db-secret`, and that was enforced by a sentence.
  There are three such pairs, so three chances to make a mistake that presents as
  somebody else's bug: the pod fails with a SASL authentication error, which reads
  as a broken credential rather than as two credentials that were meant to be one.
  The script derives each URL from the same shell variable that goes into the
  instance Secret, so they cannot disagree.
- **Nothing checked that the key names were right.** A Secret with a mistyped key
  is a perfectly valid Secret. The pod then fails on the missing environment
  variable, and the message names `AUTH_JWT_PRIVATE_KEY` rather than the Secret
  that was supposed to supply it — one indirection away from its cause, every
  time. `--check` renders the chart, extracts every `secretKeyRef` and
  `configMapKeyRef` it actually references, and names exactly which Secret is
  missing which key, before anything is deployed.
- **Two clusters drift.** Provisioned by hand months apart, staging and production
  would differ in some small way nobody chose — which destroys the entire value of
  having a staging environment, where a difference from production should be
  deliberate.
- **The one moment the values exist in plaintext is unrepeatable.** The script
  writes a copy for the operator's own records at that instant, outside the
  repository, and refuses to write it inside the working tree.

Prose and executable steps in the same document always drift, and the prose always
loses. So the how lives in the script; what each Secret is *for* lives here.

## Secrets the chart references

Since plan 0002 each cluster is one environment, so there is one set of these per
cluster and the names carry no `-production` / `-staging` suffix.

The application secret — `luna-shopper-backend-secrets`:

| Key                    | What it is                                             |
| ---------------------- | ------------------------------------------------------ |
| `AUTH_DB_URL`          | `postgres://<user>:<pw>@luna-shopper-backend-auth-db:5432/<db>`|
| `CORE_DB_URL`          | `postgres://<user>:<pw>@luna-shopper-backend-core-db:5432/<db>`|
| `CATALOG_DB_URL`       | `postgres://<user>:<pw>@luna-shopper-backend-catalog-db:5432/<db>`|
| `AUTH_JWT_PRIVATE_KEY` | PEM private key — **only** the auth pod receives it    |
| `AUTH_JWT_PUBLIC_KEY`  | PEM public key — every service verifies tokens with it |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. May be empty (plan 0026)   |
| `SMTP_PASS`            | SMTP submission password. May be empty (plan 0026)     |

The split is the point of `_env.tpl`: `role` decides which of these a pod
receives, so only the auth pod ever sees the private half of the keypair, and a
service only holds the URL of the database it owns.

Per Postgres instance — `luna-shopper-backend-auth-db-secret`,
`luna-shopper-backend-core-db-secret`, `luna-shopper-backend-catalog-db-secret`:

| Key                 | What it is                                    |
| ------------------- | --------------------------------------------- |
| `POSTGRES_PASSWORD` | Password for that instance's `POSTGRES_USER`  |

Backups, production only — `luna-shopper-backend-backup-secret` (plan 0005):

| Key                     | What it is                                     |
| ----------------------- | ---------------------------------------------- |
| `S3_ENDPOINT`           | S3 compatible endpoint URL                     |
| `S3_BUCKET`             | Destination bucket                             |
| `AWS_ACCESS_KEY_ID`     | Bucket scoped key, ideally write only          |
| `AWS_SECRET_ACCESS_KEY` | Its secret                                     |

Write only matters: a backup credential that can delete its own bucket turns a
compromised cluster into a compromised backup.

This table is what `--check` is checking against, so keeping it accurate is worth
the effort — but note that the check reads the *chart*, not this file, so the
table being stale cannot make the check wrong, only make this document wrong.

## Rotation

Re-running the script keeps every value that already exists. That is not just
convenience: **regenerating a Postgres password rotates the Secret and not the
database.** Postgres reads `POSTGRES_PASSWORD` only when it initialises an empty
data directory, so on an existing volume the new Secret and the old database
disagree and every service fails to connect.

`--rotate` regenerates deliberately, and prints the `ALTER ROLE` that has to run
inside each instance to make the database agree.

## Keeping a copy outside the cluster

`AUTH_JWT_PRIVATE_KEY` exists only inside a Secret in the cluster that uses it.
Losing it loses no data, but every issued access and refresh token becomes
unverifiable at once, which logs out every user simultaneously. The script writes
the plaintext copy for exactly this reason (plan 0005, section 5) — file it in a
password manager and delete the file.

Do not commit it, encrypted or otherwise, and do not put it in the backup bucket
that the cluster itself can write to.
