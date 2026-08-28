# 0006 Script the namespace and the Secrets

Everything a cluster needs before its first `helm upgrade` exists today as prose. The
namespace is a committed manifest applied out of band, and the six Secrets are a block of
`kubectl create secret` commands in `k8s/helm/luna-shopper-backend-secrets.md` for a human to
copy, edit and paste.

That was tolerable while there was one cluster that had already been set up. Plan
`k8s/plans/0002` makes it two, and a second one is where hand transcription starts costing
real time.

## 1. Why prose is the wrong medium for this

**Nothing checks that the values agree with each other.** The secrets document says the
password inside `AUTH_DB_URL` "must match" `POSTGRES_PASSWORD` in
`luna-shopper-backend-auth-db-secret`, and enforces that with a sentence. When they disagree,
the auth pod fails to connect with a SASL authentication error, which reads as a broken
credential rather than as two credentials that were meant to be one. There are three such
pairs, so there are three chances to make a mistake that presents as somebody else's bug.

**Nothing checks that the key names are right.** The chart reads Secret keys through
`secretKeyRef`, and a Kubernetes Secret with a mistyped key is a valid Secret. The pod then
fails on the missing environment variable, and the message names `AUTH_JWT_PRIVATE_KEY`
rather than the Secret that was supposed to supply it. The failure is one indirection away
from its cause, every time.

**Two clusters will drift.** Provisioned by hand months apart, staging and production will
differ in some small way nobody chose. The whole value of a staging environment is that a
difference between it and production is deliberate, and hand provisioning quietly erodes
exactly that.

**The one time the values exist in plaintext is unrepeatable.** Generating a JWT keypair and
three passwords is a moment that happens once. If nothing captures them for the operator's own
records at that instant, the only copy lives in the cluster, which plan `k8s/plans/0005`
section 5 identifies as a thing to fix and this script is the natural place to fix it.

## 2. What the script does

`k8s/bootstrap/provision-release.sh`, sitting beside `install.sh` because it is the second
half of the same job: `install.sh` makes a machine into a cluster, this makes a cluster ready
for the chart.

```sh
./k8s/bootstrap/provision-release.sh --env staging
```

1. **Creates the namespace**, applying the existing `k8s/namespace.yaml`.
2. **Generates what can be generated.** An RSA keypair for JWT signing if none is supplied,
   and one strong password per Postgres instance from `openssl rand`.
3. **Derives the connection strings from those same passwords**, rather than accepting them
   separately. This is the point of the whole script: `AUTH_DB_URL` is built from the
   password that went into `luna-shopper-backend-auth-db-secret`, in the same shell variable,
   so the two cannot disagree. The "must match" sentence in the documentation stops being a
   rule a human follows and becomes a property of how the value is produced.
4. **Prompts for what cannot be generated**: the Google client secret, the SMTP password.
   Both may be empty, which after `apps/luna-shopper-backend/plans/0026` is a supported
   configuration rather than a broken one.
5. **Applies every Secret idempotently.**
6. **Writes a plaintext copy to a path outside the repository** and tells the operator to file
   it somewhere safe and delete it.

### 2.1 Idempotent, not `create`

`kubectl create secret` fails when the object exists, which makes it unusable for a script
anyone might run twice. Use the apply form throughout:

```sh
kubectl create secret generic luna-shopper-backend-auth-db-secret \
  --namespace "$NAMESPACE" \
  --from-literal=POSTGRES_PASSWORD="$AUTH_DB_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
```

With one caveat that has to be handled rather than discovered: **re-running the script with
newly generated passwords rotates the Secret but not the database.** Postgres reads
`POSTGRES_PASSWORD` only when it initialises an empty data directory, so on an existing volume
the new Secret and the old database disagree and every service fails to connect. The script
must therefore detect an existing Secret and keep its value by default, regenerating only
under an explicit `--rotate` flag that also prints what else has to happen (an `ALTER ROLE`
inside the running instance). Silently generating a fresh password on a second run would turn
a convenience into an outage.

### 2.2 Refuse to write secrets into the repository

If the output path resolves inside the working tree, the script exits rather than writing.
Reading a git ignore file to decide is fragile; a path check is not, and a worktree is exactly
the kind of place a hurried operator would put a file.

## 3. The preflight is the valuable half

Provisioning correctly is worth less than knowing you provisioned correctly. Add a second
mode that answers the question directly:

```sh
./k8s/bootstrap/provision-release.sh --check --env staging
```

It renders the chart, extracts every `secretKeyRef` and `configMapKeyRef` name and key that
the manifests reference, and asserts each one exists in the cluster:

```sh
helm template nx-portfolio k8s/helm -n "$NAMESPACE" \
  --values k8s/helm/values.yaml --values "k8s/helm/values.${ENV}.yaml" \
  | grep -A2 -E 'secretKeyRef|configMapKeyRef' ...
```

This inverts the failure. Instead of a pod crashlooping on a missing environment variable,
you get a list of exactly which Secret is missing which key, before anything is deployed. It
also catches the reverse drift, where the chart starts referencing a key that provisioning
was never taught to create, which is the shape this defect will take the next time a
configuration value is added.

Run it in CI against the target cluster as a step before `helm upgrade`, so a deploy that
cannot possibly work is rejected in seconds rather than diagnosed in minutes. That pairs
directly with `k8s/plans/0003`: 0003 makes a broken deploy fail loudly, this makes a
predictably broken deploy not start.

## 4. Fold the documentation into the script

`luna-shopper-backend-secrets.md` stops being a list of commands to copy and becomes an
explanation of what each Secret is for and why the split exists, pointing at the script for
the how. Prose and executable steps in the same document always drift, and the prose always
loses.

Keep the table of keys. It is genuinely useful and it is what the preflight is checking
against.

## 5. Verification

- Running the script twice in a row produces no error and no change on the second run.
- Running it against a fresh cluster produces a namespace and six Secrets, and
  `--check` passes immediately afterwards.
- `--check` against a cluster with one key deliberately deleted names that key and that
  Secret, and fails.
- The auth pod connects on the first attempt, which is the end to end assertion that the
  derived connection strings and the instance passwords agree.
- Deliberately re-running without `--rotate` on a cluster with existing data leaves the
  Postgres password untouched and the services connected.
