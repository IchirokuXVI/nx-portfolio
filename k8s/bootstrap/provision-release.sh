#!/usr/bin/env bash
#
# Make a cluster ready for the chart (k8s/plans/0006).
#
# `install.sh` turns a machine into a cluster; this turns a cluster into one the
# chart can be deployed to: the namespace, and the six Secrets the templates read
# through `secretKeyRef`. Both halves of the same job, which is why they sit
# together.
#
# Usage:
#   ./k8s/bootstrap/provision-release.sh --env staging          # provision
#   ./k8s/bootstrap/provision-release.sh --check --env staging  # verify only
#   ./k8s/bootstrap/provision-release.sh --env production --rotate
#
# Idempotent. Re-running it changes nothing, because it keeps every value that
# already exists; see --rotate below for the one exception and why it is opt in.
#
# Options:
#   --env <production|staging>  which values file --check renders against
#   --check                     verify, create nothing (see section 3 of the plan)
#   --rotate                    regenerate secrets that already exist (dangerous)
#   --out <path>                where to write the operator's plaintext copy
#   --namespace <name>          default: nx-portfolio

set -euo pipefail

ENVIRONMENT=""
CHECK_ONLY=false
ROTATE=false
NAMESPACE="${NAMESPACE:-nx-portfolio}"
OUT_PATH=""

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_DIR="$REPO_ROOT/k8s/helm"

# ---------------------------------------------------------------------------
# The kubeconfig, for the CI deploy user's sake.
#
# CI reaches this script as `ssh host "bash ~/k8s/bootstrap/..."`, which is non
# interactive, so none of the shell profile that would export KUBECONFIG runs.
# Without this the script fails at its first kubectl as the deploy user while
# working perfectly by hand, which is the worst shape a failure can take.
#
# k3s puts its kubeconfig at the path below and install.sh makes it readable by
# every local user (--write-kubeconfig-mode 644), so no sudo is involved. The
# readability test keeps a laptop run, where that file does not exist, on its
# own ~/.kube/config instead of pointing it at nothing.
# ---------------------------------------------------------------------------
if [ -z "${KUBECONFIG:-}" ] && [ -r /etc/rancher/k3s/k3s.yaml ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --env)       ENVIRONMENT="$2"; shift 2 ;;
    --check)     CHECK_ONLY=true;  shift ;;
    --rotate)    ROTATE=true;      shift ;;
    --out)       OUT_PATH="$2";    shift 2 ;;
    --namespace) NAMESPACE="$2";   shift 2 ;;
    -h|--help)   sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$ENVIRONMENT" ]; then
  echo "--env is required (production or staging)." >&2
  exit 1
fi
if [ "$ENVIRONMENT" != "production" ] && [ "$ENVIRONMENT" != "staging" ]; then
  echo "--env must be production or staging, got '$ENVIRONMENT'." >&2
  exit 1
fi

VALUES_FILE="$CHART_DIR/values.${ENVIRONMENT}.yaml"
if [ ! -f "$VALUES_FILE" ]; then
  echo "No values file at $VALUES_FILE." >&2
  exit 1
fi

APP_SECRET=luna-shopper-backend-secrets
AUTH_DB_SECRET=luna-shopper-backend-auth-db-secret
CORE_DB_SECRET=luna-shopper-backend-core-db-secret
CATALOG_DB_SECRET=luna-shopper-backend-catalog-db-secret
BACKUP_SECRET=luna-shopper-backend-backup-secret

# ---------------------------------------------------------------------------
# --check: the preflight (plan 0006, section 3)
#
# Provisioning correctly is worth less than knowing you provisioned correctly.
# This renders the chart, extracts every Secret and ConfigMap key the manifests
# actually reference, and asserts each one exists in the cluster.
#
# It inverts the failure. Instead of a pod crashlooping on a missing environment
# variable — a message that names AUTH_JWT_PRIVATE_KEY rather than the Secret
# that was supposed to supply it, one indirection away from its cause — you get a
# list of exactly which Secret is missing which key, before anything is deployed.
#
# It also catches the reverse drift, where the chart starts referencing a key
# provisioning was never taught to create. That is the shape this defect will take
# the next time a configuration value is added.
# ---------------------------------------------------------------------------
run_check() {
  local failures=0

  echo "Rendering the chart for $ENVIRONMENT..."
  local rendered
  rendered="$(helm template nx-portfolio "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --values "$CHART_DIR/values.yaml" \
    --values "$VALUES_FILE")"

  # Every `secretKeyRef` / `configMapKeyRef` in the render, as "kind name key".
  # awk over the YAML rather than a parser: the two are always name-then-key on
  # consecutive lines in this chart, and this keeps the script dependency free.
  local refs
  refs="$(printf '%s\n' "$rendered" | awk '
    /secretKeyRef:/    { kind = "secret";    name = ""; next }
    /configMapKeyRef:/ { kind = "configmap"; name = ""; next }
    kind != "" && /^[[:space:]]*name:/ { sub(/^[[:space:]]*name:[[:space:]]*/, ""); gsub(/"/, ""); name = $0; next }
    kind != "" && /^[[:space:]]*key:/  { sub(/^[[:space:]]*key:[[:space:]]*/, "");  gsub(/"/, ""); print kind, name, $0; kind = ""; name = ""; next }
    { if (kind != "" && $0 !~ /^[[:space:]]*(name|key):/) { kind = ""; name = "" } }
  ' | sort -u)"

  if [ -z "$refs" ]; then
    echo "The render references no Secret or ConfigMap keys at all, which cannot" >&2
    echo "be right. Is lunaShopperBackend.enabled true in $VALUES_FILE?" >&2
    return 1
  fi

  echo
  echo "Checking $(printf '%s\n' "$refs" | wc -l | tr -d ' ') referenced keys against the cluster..."
  echo

  while read -r kind name key; do
    [ -z "$kind" ] && continue
    if ! kubectl -n "$NAMESPACE" get "$kind" "$name" >/dev/null 2>&1; then
      echo "  MISSING $kind/$name (needed for key $key)"
      failures=$((failures + 1))
      continue
    fi
    if ! kubectl -n "$NAMESPACE" get "$kind" "$name" -o "jsonpath={.data.$key}" 2>/dev/null | grep -q .; then
      echo "  MISSING key '$key' in $kind/$name"
      failures=$((failures + 1))
      continue
    fi
    echo "  ok      $kind/$name $key"
  done <<< "$refs"

  echo
  if [ "$failures" -gt 0 ]; then
    echo "$failures reference(s) cannot be satisfied. The deploy would fail." >&2
    echo "Run this script without --check to provision them." >&2
    return 1
  fi
  echo "Every key the chart references exists. The deploy can proceed."
  return 0
}

if [ "$CHECK_ONLY" = true ]; then
  run_check
  exit $?
fi

# ---------------------------------------------------------------------------
# Refuse to write secrets into the repository (plan 0006, section 2.2)
#
# A path check rather than reading a git ignore file, which is fragile. A
# worktree is exactly the kind of place a hurried operator would put this file.
# ---------------------------------------------------------------------------
if [ -z "$OUT_PATH" ]; then
  OUT_PATH="$HOME/luna-shopper-${ENVIRONMENT}-secrets.txt"
fi
OUT_DIR="$(cd "$(dirname "$OUT_PATH")" 2>/dev/null && pwd || true)"
if [ -z "$OUT_DIR" ]; then
  echo "The directory for --out ($OUT_PATH) does not exist." >&2
  exit 1
fi
case "$OUT_DIR/" in
  "$REPO_ROOT"/*)
    echo "Refusing to write secrets inside the repository ($OUT_DIR)." >&2
    echo "Pass --out with a path outside $REPO_ROOT." >&2
    exit 1
    ;;
esac

echo "Provisioning $ENVIRONMENT in namespace $NAMESPACE"
echo

# 1. The namespace, from the committed manifest rather than a bare `create`.
kubectl apply -f "$REPO_ROOT/k8s/namespace.yaml"

# ---------------------------------------------------------------------------
# Keep what already exists, unless --rotate.
#
# `kubectl create secret` fails when the object exists, which makes it unusable
# for a script anyone might run twice, so everything below is the apply form. But
# idempotent creation is not the whole problem: **re-running with newly generated
# passwords would rotate the Secret and not the database.** Postgres reads
# POSTGRES_PASSWORD only when it initialises an empty data directory, so on an
# existing volume the new Secret and the old database disagree and every service
# fails to connect.
#
# So an existing value is kept by default, and regenerating is an explicit flag
# that prints what else has to happen. Silently generating a fresh password on a
# second run would turn a convenience into an outage.
# ---------------------------------------------------------------------------
existing() {
  # Prints the current value of one key, or nothing.
  kubectl -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null \
    | { base64 -d 2>/dev/null || true; }
}

keep_or_generate() {
  local secret="$1" key="$2" generator="$3"
  local current
  current="$(existing "$secret" "$key")"
  if [ -n "$current" ] && [ "$ROTATE" = false ]; then
    printf '%s' "$current"
    return
  fi
  if [ -n "$current" ] && [ "$ROTATE" = true ]; then
    echo "  ROTATING $secret/$key" >&2
    ROTATED=true
  fi
  eval "$generator"
}

ROTATED=false

echo "Resolving credentials (existing values are kept; --rotate to regenerate)..."

AUTH_DB_PASSWORD="$(keep_or_generate "$AUTH_DB_SECRET" POSTGRES_PASSWORD 'openssl rand -base64 24 | tr -d "\n"')"
CORE_DB_PASSWORD="$(keep_or_generate "$CORE_DB_SECRET" POSTGRES_PASSWORD 'openssl rand -base64 24 | tr -d "\n"')"
CATALOG_DB_PASSWORD="$(keep_or_generate "$CATALOG_DB_SECRET" POSTGRES_PASSWORD 'openssl rand -base64 24 | tr -d "\n"')"

# The JWT keypair. Losing it does not lose data, but every issued access and
# refresh token becomes unverifiable at once, which logs out every user
# simultaneously (plan 0005, section 5). It is written to the operator's copy
# below for exactly that reason.
JWT_PRIVATE_KEY="$(existing "$APP_SECRET" AUTH_JWT_PRIVATE_KEY)"
JWT_PUBLIC_KEY="$(existing "$APP_SECRET" AUTH_JWT_PUBLIC_KEY)"
if [ -z "$JWT_PRIVATE_KEY" ] || [ "$ROTATE" = true ]; then
  echo "  generating a new RSA keypair for JWT signing"
  tmp_key="$(mktemp)"
  tmp_pub="$(mktemp)"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp_key" 2>/dev/null
  openssl pkey -in "$tmp_key" -pubout -out "$tmp_pub" 2>/dev/null
  JWT_PRIVATE_KEY="$(cat "$tmp_key")"
  JWT_PUBLIC_KEY="$(cat "$tmp_pub")"
  rm -f "$tmp_key" "$tmp_pub"
fi

# What cannot be generated. Both may be empty: since plan 0026 that is a
# supported configuration rather than a broken one — the Google routes answer 501
# and registration answers 501, instead of the service failing to boot.
GOOGLE_CLIENT_SECRET="$(existing "$APP_SECRET" GOOGLE_CLIENT_SECRET)"
SMTP_PASS="$(existing "$APP_SECRET" SMTP_PASS)"
if [ -t 0 ]; then
  if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    read -rsp "  Google client secret (blank to leave Google unconfigured): " GOOGLE_CLIENT_SECRET
    echo
  fi
  if [ -z "$SMTP_PASS" ]; then
    read -rsp "  SMTP password (blank to leave email unconfigured): " SMTP_PASS
    echo
  fi
else
  echo "  not a terminal: leaving GOOGLE_CLIENT_SECRET and SMTP_PASS as they are"
fi

# ---------------------------------------------------------------------------
# The point of the whole script (plan 0006, section 2, item 3).
#
# The connection strings are DERIVED from the same shell variables that go into
# the per instance Secrets, so the two cannot disagree. The documentation used to
# enforce that with the sentence "must match", and there were three such pairs,
# which is three chances to make a mistake that presents as somebody else's bug:
# a SASL authentication error reads as a broken credential rather than as two
# credentials that were meant to be one.
# ---------------------------------------------------------------------------
AUTH_DB_URL="postgres://luna_auth:${AUTH_DB_PASSWORD}@luna-shopper-backend-auth-db:5432/luna_auth"
CORE_DB_URL="postgres://luna_core:${CORE_DB_PASSWORD}@luna-shopper-backend-core-db:5432/luna_core"
CATALOG_DB_URL="postgres://luna_catalog:${CATALOG_DB_PASSWORD}@luna-shopper-backend-catalog-db:5432/luna_catalog"

apply_secret() {
  # `create --dry-run=client -o yaml | apply -f -` is the idempotent form:
  # `create` alone fails when the object exists.
  kubectl create secret generic "$@" \
    --namespace "$NAMESPACE" \
    --dry-run=client -o yaml | kubectl apply -f -
}

echo
echo "Applying Secrets..."

apply_secret "$AUTH_DB_SECRET"    --from-literal=POSTGRES_PASSWORD="$AUTH_DB_PASSWORD"
apply_secret "$CORE_DB_SECRET"    --from-literal=POSTGRES_PASSWORD="$CORE_DB_PASSWORD"
apply_secret "$CATALOG_DB_SECRET" --from-literal=POSTGRES_PASSWORD="$CATALOG_DB_PASSWORD"

apply_secret "$APP_SECRET" \
  --from-literal=AUTH_DB_URL="$AUTH_DB_URL" \
  --from-literal=CORE_DB_URL="$CORE_DB_URL" \
  --from-literal=CATALOG_DB_URL="$CATALOG_DB_URL" \
  --from-literal=AUTH_JWT_PRIVATE_KEY="$JWT_PRIVATE_KEY" \
  --from-literal=AUTH_JWT_PUBLIC_KEY="$JWT_PUBLIC_KEY" \
  --from-literal=GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  --from-literal=SMTP_PASS="$SMTP_PASS"

# The backup credentials (plan 0005). Only production renders the CronJobs, but
# creating an empty placeholder in staging would be worse than nothing: --check
# would pass against a Secret whose values cannot write to any bucket. So this is
# provisioned only where it is used, and only from values the operator supplies.
if [ "$ENVIRONMENT" = "production" ]; then
  S3_ENDPOINT="$(existing "$BACKUP_SECRET" S3_ENDPOINT)"
  if [ -z "$S3_ENDPOINT" ]; then
    echo
    echo "  No $BACKUP_SECRET yet. Backups (plan 0005) need one holding"
    echo "  S3_ENDPOINT, S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
    echo "  Use a bucket scoped, ideally write only key: a backup credential that"
    echo "  can delete its own bucket turns a compromised cluster into a"
    echo "  compromised backup. Create it with:"
    echo
    echo "    kubectl -n $NAMESPACE create secret generic $BACKUP_SECRET \\"
    echo "      --from-literal=S3_ENDPOINT=... --from-literal=S3_BUCKET=... \\"
    echo "      --from-literal=AWS_ACCESS_KEY_ID=... \\"
    echo "      --from-literal=AWS_SECRET_ACCESS_KEY=..."
  fi
fi

# ---------------------------------------------------------------------------
# The operator's own copy (plan 0006, section 2, item 6; plan 0005, section 5).
#
# Generating a keypair and three passwords is a moment that happens once. If
# nothing captures them at that instant the only copy lives in the cluster that
# uses them, which is the thing plan 0005 identifies as worth fixing, and this is
# the natural place to fix it because the values exist in plaintext here anyway.
# ---------------------------------------------------------------------------
umask 077
cat > "$OUT_PATH" <<EOF
# Luna Shopper ${ENVIRONMENT} secrets, written by provision-release.sh.
#
# FILE THIS SOMEWHERE SAFE (a password manager) AND DELETE IT.
# Do not commit it, encrypted or otherwise, and do not put it in the backup
# bucket that the cluster itself can write to.

namespace: ${NAMESPACE}

${AUTH_DB_SECRET}/POSTGRES_PASSWORD: ${AUTH_DB_PASSWORD}
${CORE_DB_SECRET}/POSTGRES_PASSWORD: ${CORE_DB_PASSWORD}
${CATALOG_DB_SECRET}/POSTGRES_PASSWORD: ${CATALOG_DB_PASSWORD}

${APP_SECRET}/AUTH_DB_URL: ${AUTH_DB_URL}
${APP_SECRET}/CORE_DB_URL: ${CORE_DB_URL}
${APP_SECRET}/CATALOG_DB_URL: ${CATALOG_DB_URL}
${APP_SECRET}/GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
${APP_SECRET}/SMTP_PASS: ${SMTP_PASS}

${APP_SECRET}/AUTH_JWT_PRIVATE_KEY:
${JWT_PRIVATE_KEY}

${APP_SECRET}/AUTH_JWT_PUBLIC_KEY:
${JWT_PUBLIC_KEY}
EOF

echo
echo "Wrote the plaintext copy to $OUT_PATH (mode 600)."
echo "File it somewhere safe and delete it."

if [ "$ROTATED" = true ]; then
  cat <<'EOF'

ROTATION WARNING
----------------
A Postgres password was regenerated. Postgres reads POSTGRES_PASSWORD only when
it initialises an EMPTY data directory, so on an existing volume the Secret and
the database now disagree and every service will fail to connect.

Run the matching ALTER ROLE inside each instance whose password changed:

  kubectl -n NAMESPACE exec -it luna-shopper-backend-auth-db-0 -- \
    psql -c "ALTER ROLE luna_auth WITH PASSWORD 'the-new-password';"

then restart the deployments so they pick the new Secret up.
EOF
fi

echo
echo "Now verify what you just created actually satisfies the chart:"
echo "  $0 --check --env $ENVIRONMENT"
