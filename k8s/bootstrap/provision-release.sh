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
# The harvester's database (plan 0038). Provisioned unconditionally even though
# `harvester.enabled` is false in both clusters: a Secret that exists and is
# unused costs nothing, and the alternative is that turning the harvester on is
# two operations with a CreateContainerConfigError in between. --check only
# asserts the keys the RENDERED chart references, so this stays quiet until the
# harvester is actually deployed.
HARVESTER_DB_SECRET=luna-shopper-backend-harvester-db-secret
BACKUP_SECRET=luna-shopper-backend-backup-secret

# ---------------------------------------------------------------------------
# --check: the preflight (plan 0006, section 3)
#
# Provisioning correctly is worth less than knowing you provisioned correctly.
# This renders the chart, extracts every Secret and ConfigMap key the manifests
# actually reference, and asserts each one can be satisfied.
#
# It inverts the failure. Instead of a pod crashlooping on a missing environment
# variable, a message that names AUTH_JWT_PRIVATE_KEY rather than the Secret that
# was supposed to supply it, one indirection away from its cause, you get a list
# of exactly which Secret is missing which key, before anything is deployed.
#
# It also catches the reverse drift, where the chart starts referencing a key
# provisioning was never taught to create. That is the shape this defect will take
# the next time a configuration value is added.
#
# A reference is satisfied by one of two things, and treating them as one thing
# deadlocked the first deploy to a fresh cluster:
#
#   * An object THIS SCRIPT provisions has to exist in the cluster. Those are the
#     prerequisites, and asserting them is the whole point.
#
#   * An object THE CHART creates, today only luna-shopper-backend-config, is
#     checked against the render instead. It cannot exist yet: helm creates it
#     during the very deploy this check gates, so demanding it in the cluster made
#     the gate unpassable on a cluster nothing had been deployed to, while the
#     only thing that could have created it was the deploy the gate was refusing.
#     CI deadlocked the same way, because both workflows run --check before their
#     helm upgrade. Checking the render still catches the drift worth catching, a
#     manifest naming a key its own ConfigMap does not define, and it catches it
#     one deploy earlier than the cluster ever could.
#
# Emptiness is the second distinction. A key that is present but empty starts a
# pod perfectly well; only an absent key holds it in CreateContainerConfigError.
# GOOGLE_CLIENT_SECRET and SMTP_PASS are legitimately empty (plan 0026: the Google
# routes and registration answer 501 rather than the service refusing to boot), so
# an operator who left both prompts blank, which the provisioning half explicitly
# invites, was then told by this half that the deploy would fail when it would
# not. They are allowed to be empty by name. Every other key still may not be,
# because an empty AUTH_JWT_PRIVATE_KEY is an outage that boots cleanly.
# ---------------------------------------------------------------------------

# The only keys allowed to exist with no value. See the note above.
#
# GEMINI_API_KEY joins them for the same reason and by the same rule (plan 0039,
# section 11): with it empty the assistant boots, its health probes pass, and
# /v1/assistant answers 501 not_configured. An operator who never wanted an
# assistant should not be told their deploy will fail when it will not.
OPTIONAL_EMPTY_KEYS="GOOGLE_CLIENT_SECRET SMTP_PASS GEMINI_API_KEY"

is_optional_empty() {
  case " $OPTIONAL_EMPTY_KEYS " in
    *" $1 "*) return 0 ;;
    *)        return 1 ;;
  esac
}

cluster_has_key() {
  # Present-but-empty has to be distinguishable from absent, and
  # `jsonpath={.data.KEY}` prints nothing for either, so ask for the key NAMES and
  # look for this one among them.
  kubectl -n "$NAMESPACE" get "$1" "$2" \
    -o go-template='{{if .data}}{{range $k, $_ := .data}}{{println $k}}{{end}}{{end}}' \
    2>/dev/null | grep -qxF "$3"
}

decoded_secret_value() {
  # run_check runs before the provisioning half is even parsed, so it cannot use
  # `existing` below; this is the same two lines, local to the preflight.
  kubectl -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null \
    | base64 -d 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# A connection string that a URL parser accepts.
#
# The password is interpolated into postgres://user:PASSWORD@host:5432/db, and a
# '/' in the password ends the authority early: the parser takes everything
# between ':' and that slash as the port, finds it is not a number, and throws
# ERR_INVALID_URL from inside pg, nine frames deep, naming neither the variable
# nor the Secret that supplied it.
#
# It reached production shaped like something else entirely. Whether a 32
# character base64 string contains a '/' is close to a coin flip, so it struck
# one database in three: two services migrated cleanly and the third failed in a
# way that read as a bug in its own migration rather than in its credential.
#
# Hence both halves of this. Generation uses base64url, the same entropy over an
# alphabet that is unreserved in a URL userinfo, so nothing downstream has to
# encode or decode anything. The preflight then asserts the property directly,
# because a cluster provisioned before this fix still holds the old URL and
# nothing else would report it.
# ---------------------------------------------------------------------------
assert_url_safe() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*)
      echo "Generated a password that is not URL safe. This is a bug in this" >&2
      echo "script: see the note above generate_db_password." >&2
      return 1
      ;;
  esac
  return 0
}

# ---------------------------------------------------------------------------
# The uuid catalog knows the harvester by (plan 0081, section 11).
#
# It lives in the app Secret rather than in a values file, and the reason is
# storage rather than secrecy: a uuid is not a secret, but it has to EXIST in
# both clusters now, and the Secret is the only per environment store this
# script owns. The chart owns the ConfigMap and a helm upgrade would overwrite
# anything written into it, while a values field is a hand edit somebody forgets
# and `--check` cannot see.
#
# `keep_or_generate` is what makes it stable: the id is generated once and kept
# on every later run, because catalog's audit trail attributes every row a run
# wrote to it and a new id would orphan the old ones.
# ---------------------------------------------------------------------------
generate_actor_id() {
  # `uuidgen` is not everywhere; openssl is, and this script already needs it.
  local hex
  hex="$(openssl rand -hex 16 | tr -d '\r\n')"
  # Version 4, variant 10xx, the way any uuid library would set them.
  printf '%s-%s-4%s-%s%s-%s' \
    "${hex:0:8}" "${hex:8:4}" "${hex:13:3}" \
    "$(printf '%x' $(( 0x8 + (0x${hex:16:1} % 4) )))" "${hex:17:3}" \
    "${hex:20:12}"
}

generate_db_password() {
  # '\r' as well as '\n': an openssl that emits CRLF (Git Bash on Windows does,
  # and this script is edited there) would otherwise leave a carriage return on
  # the end of the password, where it survives into the Secret and corrupts the
  # credential invisibly. assert_url_safe is what caught it.
  local password
  password="$(openssl rand -base64 24 | tr -d '\r\n' | tr '+/' '-_')"
  assert_url_safe "$password" || return 1
  printf '%s' "$password"
}

db_url_is_parseable() {
  local url="$1" rest userinfo
  case "$url" in postgres://*|postgresql://*) ;; *) return 1 ;; esac
  rest="${url#*://}"
  case "$rest" in *@*) ;; *) return 1 ;; esac
  # The password may contain no '/', and cannot contain an '@', so the userinfo
  # is everything up to the first one.
  userinfo="${rest%%@*}"
  case "$userinfo" in */*) return 1 ;; esac
  return 0
}

run_check() {
  local failures=0
  local chart_failures=0

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

  # What the chart DEFINES, as "object kind name" per Secret/ConfigMap document
  # and "key kind name KEY" for each key that document carries.
  #
  # Only a column-zero `kind:` opens a document, which is what keeps the Gateway's
  # indented `- kind: Secret` (a certificateRef, not a Secret of its own) out of
  # this list. Data keys are read one per line, true of every value this chart
  # renders; a block scalar would need a real parser rather than awk.
  local defined
  defined="$(printf '%s\n' "$rendered" | awk '
    /^---/ { kind = ""; name = ""; section = ""; next }
    /^kind:[[:space:]]/ {
      kind = ""
      if ($2 == "ConfigMap") { kind = "configmap" }
      if ($2 == "Secret")    { kind = "secret" }
      name = ""; section = ""; next
    }
    kind == "" { next }
    /^metadata:/ { section = "metadata"; next }
    /^(data|stringData):/ { section = "data"; next }
    /^[^[:space:]#]/ { section = ""; next }
    section == "metadata" && /^[[:space:]]+name:[[:space:]]/ {
      sub(/^[[:space:]]+name:[[:space:]]*/, ""); gsub(/"/, "")
      name = $0
      print "object", kind, name
      next
    }
    section == "data" && name != "" && /^[[:space:]]+[A-Za-z0-9_.-]+:/ {
      sub(/^[[:space:]]+/, ""); sub(/:.*$/, "")
      print "key", kind, name, $0
    }
  ')"

  local chart_objects chart_keys
  chart_objects="$(printf '%s\n' "$defined" | awk '$1 == "object" { print $2, $3 }' | sort -u)"
  chart_keys="$(printf '%s\n' "$defined" | awk '$1 == "key" { print $2, $3, $4 }' | sort -u)"

  echo
  echo "Checking $(printf '%s\n' "$refs" | wc -l | tr -d ' ') referenced keys."
  echo "What this script provisions is checked against the cluster. What the chart"
  echo "creates is checked against the render, and marked (chart)."
  echo

  while read -r kind name key; do
    [ -z "$kind" ] && continue

    # 1. The chart's own object. It does not exist before the first deploy, so
    #    the render is the only thing that can answer for it.
    if printf '%s\n' "$chart_objects" | grep -qxF "$kind $name"; then
      if printf '%s\n' "$chart_keys" | grep -qxF "$kind $name $key"; then
        echo "  ok      $kind/$name $key (chart)"
      else
        echo "  MISSING key '$key' in $kind/$name, which the chart renders (chart)"
        chart_failures=$((chart_failures + 1))
        failures=$((failures + 1))
      fi
      continue
    fi

    # 2. A prerequisite. It has to be in the cluster already.
    if ! kubectl -n "$NAMESPACE" get "$kind" "$name" >/dev/null 2>&1; then
      echo "  MISSING $kind/$name (needed for key $key)"
      failures=$((failures + 1))
      continue
    fi
    if ! cluster_has_key "$kind" "$name" "$key"; then
      echo "  MISSING key '$key' in $kind/$name"
      failures=$((failures + 1))
      continue
    fi
    if kubectl -n "$NAMESPACE" get "$kind" "$name" -o "jsonpath={.data.$key}" 2>/dev/null | grep -q .; then
      case "$kind/$key" in
        secret/*_DB_URL)
          # Present is not enough for a connection string: see the note above
          # db_url_is_parseable for the failure this catches.
          if db_url_is_parseable "$(decoded_secret_value "$name" "$key")"; then
            echo "  ok      $kind/$name $key"
          else
            echo "  INVALID $key in $kind/$name is not a parseable postgres:// URL"
            echo "          A '/' in the password ends the authority early. Re-provision"
            echo "          this database's credential; see the note in this script."
            failures=$((failures + 1))
          fi
          ;;
        *) echo "  ok      $kind/$name $key" ;;
      esac
    elif is_optional_empty "$key"; then
      echo "  ok      $kind/$name $key (empty, which this key is allowed to be)"
    else
      echo "  EMPTY   key '$key' in $kind/$name exists but has no value"
      failures=$((failures + 1))
    fi
  done <<< "$refs"

  # The development autologin must not exist in a cluster, in any form (plan 0071,
  # section 8).
  #
  # It mints an operator token with no password, so if it is ever on in production
  # it is total compromise of every user's data. Auth refuses to boot with it on
  # against a non local database, which catches it at the pod; this catches it
  # before the deploy, in the render, which is seconds rather than a rollout.
  #
  # It greps the whole render rather than one ConfigMap on purpose: the variable
  # could arrive as a literal `value:` on a container, from a Secret, or from a
  # ConfigMap key nobody thought to check, and all three are the same mistake.
  if printf '%s
' "$rendered" | grep -q 'ADMIN_DEV_AUTOLOGIN'; then
    echo
    echo "  REFUSED ADMIN_DEV_AUTOLOGIN appears in the rendered chart." >&2
    echo "          That switch signs an operator in with no password. It belongs" >&2
    echo "          to a developer machine and to nothing else; neither" >&2
    echo "          values.production.yaml nor values.staging.yaml may set it." >&2
    failures=$((failures + 1))
  fi

  echo
  if [ "$failures" -gt 0 ]; then
    echo "$failures reference(s) cannot be satisfied. The deploy would fail." >&2
    if [ "$chart_failures" -gt 0 ]; then
      echo "The lines marked (chart) are a chart bug rather than a provisioning gap:" >&2
      echo "a manifest reads a key that the ConfigMap beside it does not render." >&2
    fi
    if [ "$failures" -gt "$chart_failures" ]; then
      echo "For the rest, run this script without --check to provision them." >&2
    fi
    return 1
  fi
  echo "Every key the chart references can be satisfied. The deploy can proceed."
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
  #
  # It must also SUCCEED when there is nothing, which the obvious one line
  # version does not. `kubectl get secret` exits non zero for a Secret that does
  # not exist, `set -o pipefail` carries that status through the decoder, and
  # `VALUE="$(existing ...)"` therefore aborted the whole script under `set -e`.
  # Silently, because the error text goes to /dev/null. The effect was that
  # provisioning a fresh namespace died at the first key it looked for, right
  # after "Resolving credentials...", with no output and no clue. An absent
  # Secret is the normal case on a new cluster, not an error, so it returns
  # empty and succeeds.
  local encoded
  encoded="$(kubectl -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null || true)"
  [ -n "$encoded" ] || return 0
  printf '%s' "$encoded" | base64 -d 2>/dev/null || true
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

AUTH_DB_PASSWORD="$(keep_or_generate "$AUTH_DB_SECRET" POSTGRES_PASSWORD generate_db_password)"
CORE_DB_PASSWORD="$(keep_or_generate "$CORE_DB_SECRET" POSTGRES_PASSWORD generate_db_password)"
CATALOG_DB_PASSWORD="$(keep_or_generate "$CATALOG_DB_SECRET" POSTGRES_PASSWORD generate_db_password)"
HARVESTER_DB_PASSWORD="$(keep_or_generate "$HARVESTER_DB_SECRET" POSTGRES_PASSWORD generate_db_password)"

# The harvester's identity in catalog. Kept once generated: every price row a
# run wrote is attributed to this uuid, and a fresh one would orphan them.
HARVESTER_ACTOR_ID="$(keep_or_generate "$APP_SECRET" HARVESTER_ACTOR_ID generate_actor_id)"

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

# The OPERATOR keypair (plan 0071, section 3), generated beside the one above so a
# fresh cluster gets one with no manual step.
#
# A second keypair rather than the auth key with a different audience, and the
# argument is concrete: five services already hold AUTH_JWT_PUBLIC_KEY, so one key
# for both kinds of token would leave every one of them finding an admin token
# structurally valid and rejecting it only if it remembered to check the audience.
# Realtime, which authenticates sockets, is exactly where forgetting that is
# plausible and expensive.
#
# Losing it logs out every operator at once and loses nothing else, because an
# admin session holds no refresh token; it is written to the operator's copy below
# all the same.
ADMIN_JWT_PRIVATE_KEY="$(existing "$APP_SECRET" ADMIN_JWT_PRIVATE_KEY)"
ADMIN_JWT_PUBLIC_KEY="$(existing "$APP_SECRET" ADMIN_JWT_PUBLIC_KEY)"
if [ -z "$ADMIN_JWT_PRIVATE_KEY" ] || [ "$ROTATE" = true ]; then
  echo "  generating a new RSA keypair for admin token signing"
  tmp_key="$(mktemp)"
  tmp_pub="$(mktemp)"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp_key" 2>/dev/null
  openssl pkey -in "$tmp_key" -pubout -out "$tmp_pub" 2>/dev/null
  ADMIN_JWT_PRIVATE_KEY="$(cat "$tmp_key")"
  ADMIN_JWT_PUBLIC_KEY="$(cat "$tmp_pub")"
  rm -f "$tmp_key" "$tmp_pub"
fi

# What cannot be generated. All three may be empty: since plan 0026 that is a
# supported configuration rather than a broken one — the Google routes answer 501,
# registration answers 501, and (plan 0039) the assistant answers 501, instead of
# the service failing to boot.
GOOGLE_CLIENT_SECRET="$(existing "$APP_SECRET" GOOGLE_CLIENT_SECRET)"
SMTP_PASS="$(existing "$APP_SECRET" SMTP_PASS)"
GEMINI_API_KEY="$(existing "$APP_SECRET" GEMINI_API_KEY)"
if [ -t 0 ]; then
  if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    read -rsp "  Google client secret (blank to leave Google unconfigured): " GOOGLE_CLIENT_SECRET
    echo
  fi
  if [ -z "$SMTP_PASS" ]; then
    read -rsp "  SMTP password (blank to leave email unconfigured): " SMTP_PASS
    echo
  fi
  if [ -z "$GEMINI_API_KEY" ]; then
    read -rsp "  Gemini API key (blank to leave the assistant unconfigured): " GEMINI_API_KEY
    echo
  fi
else
  echo "  not a terminal: leaving GOOGLE_CLIENT_SECRET, SMTP_PASS and GEMINI_API_KEY as they are"
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
HARVESTER_DB_URL="postgres://luna_harvester:${HARVESTER_DB_PASSWORD}@luna-shopper-backend-harvester-db:5432/luna_harvester"

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
apply_secret "$HARVESTER_DB_SECRET" --from-literal=POSTGRES_PASSWORD="$HARVESTER_DB_PASSWORD"

apply_secret "$APP_SECRET" \
  --from-literal=AUTH_DB_URL="$AUTH_DB_URL" \
  --from-literal=CORE_DB_URL="$CORE_DB_URL" \
  --from-literal=CATALOG_DB_URL="$CATALOG_DB_URL" \
  --from-literal=HARVESTER_DB_URL="$HARVESTER_DB_URL" \
  --from-literal=HARVESTER_ACTOR_ID="$HARVESTER_ACTOR_ID" \
  --from-literal=AUTH_JWT_PRIVATE_KEY="$JWT_PRIVATE_KEY" \
  --from-literal=AUTH_JWT_PUBLIC_KEY="$JWT_PUBLIC_KEY"   --from-literal=ADMIN_JWT_PRIVATE_KEY="$ADMIN_JWT_PRIVATE_KEY"   --from-literal=ADMIN_JWT_PUBLIC_KEY="$ADMIN_JWT_PUBLIC_KEY" \
  --from-literal=GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  --from-literal=SMTP_PASS="$SMTP_PASS" \
  --from-literal=GEMINI_API_KEY="$GEMINI_API_KEY"

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
${HARVESTER_DB_SECRET}/POSTGRES_PASSWORD: ${HARVESTER_DB_PASSWORD}

${APP_SECRET}/AUTH_DB_URL: ${AUTH_DB_URL}
${APP_SECRET}/CORE_DB_URL: ${CORE_DB_URL}
${APP_SECRET}/CATALOG_DB_URL: ${CATALOG_DB_URL}
${APP_SECRET}/HARVESTER_DB_URL: ${HARVESTER_DB_URL}
${APP_SECRET}/HARVESTER_ACTOR_ID: ${HARVESTER_ACTOR_ID}
${APP_SECRET}/GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
${APP_SECRET}/SMTP_PASS: ${SMTP_PASS}
${APP_SECRET}/GEMINI_API_KEY: ${GEMINI_API_KEY}

${APP_SECRET}/AUTH_JWT_PRIVATE_KEY:
${JWT_PRIVATE_KEY}

${APP_SECRET}/AUTH_JWT_PUBLIC_KEY:
${JWT_PUBLIC_KEY}

${APP_SECRET}/ADMIN_JWT_PRIVATE_KEY:
${ADMIN_JWT_PRIVATE_KEY}

${APP_SECRET}/ADMIN_JWT_PUBLIC_KEY:
${ADMIN_JWT_PUBLIC_KEY}
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
