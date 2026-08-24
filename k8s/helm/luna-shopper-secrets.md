# Luna Shopper runtime Secrets

The Luna Shopper chart (`lunaShopper` in `values.yaml`, plan 0002) reads its
sensitive values from Kubernetes Secrets that are **created out of band and never
committed** — the same principle as the production image tag file. Nothing secret
lives in the chart, `values.yaml`, an image, or a build arg. Non secret config
(hosts, log level, mail sender, token TTLs, the JWT key id) is in the rendered
ConfigMaps; only the values below are Secrets.

`lunaShopper.enabled` defaults to `false`; turn it on only once these Secrets
exist and the `api.` / `rt.` DNS records point at the cluster.

## Secrets the chart references

Per environment application secret — `luna-shopper-secrets-production` and, if
staging is enabled, `luna-shopper-secrets-staging`:

| Key                    | What it is                                             |
| ---------------------- | ------------------------------------------------------ |
| `AUTH_DB_URL`          | `postgres://<user>:<pw>@luna-shopper-auth-db:5432/<db>`|
| `CORE_DB_URL`          | `postgres://<user>:<pw>@luna-shopper-core-db:5432/<db>`|
| `AUTH_JWT_PRIVATE_KEY` | PEM private key — **only** the auth pod receives it    |
| `AUTH_JWT_PUBLIC_KEY`  | PEM public key — every service verifies tokens with it |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                             |
| `SMTP_PASS`            | SMTP submission password                               |

Per Postgres instance — `luna-shopper-auth-db-secret` and
`luna-shopper-core-db-secret`:

| Key                 | What it is                                    |
| ------------------- | --------------------------------------------- |
| `POSTGRES_PASSWORD` | Password for that instance's `POSTGRES_USER`  |

The password inside `AUTH_DB_URL` must match `POSTGRES_PASSWORD` of
`luna-shopper-auth-db-secret` (same for core).

## Creating them

Generate the asymmetric JWT keypair once (RS256 shown; EdDSA is also fine):

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.key
openssl pkey -in jwt.key -pubout -out jwt.pub
```

Postgres passwords:

```sh
kubectl -n nx-portfolio create secret generic luna-shopper-auth-db-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 24)"
kubectl -n nx-portfolio create secret generic luna-shopper-core-db-secret \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 24)"
```

Application secret (repeat with `-staging` for staging, using the staging DB
names / credentials):

```sh
kubectl -n nx-portfolio create secret generic luna-shopper-secrets-production \
  --from-literal=AUTH_DB_URL="postgres://luna_auth:PW@luna-shopper-auth-db:5432/luna_auth" \
  --from-literal=CORE_DB_URL="postgres://luna_core:PW@luna-shopper-core-db:5432/luna_core" \
  --from-file=AUTH_JWT_PRIVATE_KEY=jwt.key \
  --from-file=AUTH_JWT_PUBLIC_KEY=jwt.pub \
  --from-literal=GOOGLE_CLIENT_SECRET="..." \
  --from-literal=SMTP_PASS="..."
```

## Environment isolation note

Production and staging services currently share the two Postgres instances and
the one NATS server. Keep their data apart by giving staging its own database
names (e.g. `luna_auth_staging`) in `luna-shopper-secrets-staging` and creating
those databases in the instances, and its own JetStream stream/subject prefix.
Fully separate stateful instances per environment is a later refinement.
