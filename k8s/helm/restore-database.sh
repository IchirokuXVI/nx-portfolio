#!/usr/bin/env bash
#
# Restore one Luna Shopper database from a backup dump (plan 0005, section 4).
#
# A backup that has never been restored is a hypothesis. This is the script that
# turns it into a fact, and running it once is what completes plan 0005 — not
# dumps appearing in the bucket.
#
#   ./restore-database.sh luna-shopper-backend-auth-db luna_auth/20260827T021700Z.dump
#   ./restore-database.sh luna-shopper-backend-core-db  latest
#
# It restores into a SCRATCH database alongside the real one, never over it. A
# restore script whose default target is production is a foot gun waiting for a
# bad night, so promoting a scratch database to the real one stays manual and
# deliberate: it means stopping the service, renaming, and restarting, and that
# sequence should be typed by a person who has decided to do it.
#
# ---------------------------------------------------------------------------
# MEASURED RECOVERY TIME
#
#   Not yet measured. Run the drill and record the wall clock time here, so the
#   recovery objective is a number somebody observed rather than a hope. Include
#   the database size it was measured at, because the two are only meaningful
#   together.
#
#     luna_auth     <size>   <duration>   <date>
#     luna_core     <size>   <duration>   <date>
#     luna_catalog  <size>   <duration>   <date>
# ---------------------------------------------------------------------------
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace          (default: nx-portfolio)
#   BACKUP_SECRET secret holding S3 credentials (default: luna-shopper-backend-backup-secret)
#   APP_SECRET    secret holding the DB URLs    (default: luna-shopper-backend-secrets)
#   SCRATCH_SUFFIX suffix for the scratch db    (default: _restore)
#   KUBECONFIG    kubeconfig path               (default: /etc/rancher/k3s/k3s.yaml)

set -euo pipefail

INSTANCE="${1:-}"
OBJECT_KEY="${2:-}"

if [ -z "$INSTANCE" ] || [ -z "$OBJECT_KEY" ]; then
  cat >&2 <<'USAGE'
Usage: restore-database.sh <instance> <object-key|latest>

  instance     the Postgres StatefulSet, e.g. luna-shopper-backend-auth-db
  object-key   the key under the bucket, e.g. luna_auth/20260827T021700Z.dump
               or the word "latest" for the most recent dump of that database

Examples:
  ./restore-database.sh luna-shopper-backend-auth-db latest
  ./restore-database.sh luna-shopper-backend-core-db luna_core/20260827T023700Z.dump
USAGE
  exit 1
fi

NAMESPACE="${NAMESPACE:-nx-portfolio}"
BACKUP_SECRET="${BACKUP_SECRET:-luna-shopper-backend-backup-secret}"
APP_SECRET="${APP_SECRET:-luna-shopper-backend-secrets}"
SCRATCH_SUFFIX="${SCRATCH_SUFFIX:-_restore}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# Which database and which secret key belong to this instance. Kept here rather
# than derived from the name so an unknown instance fails with a list of the real
# ones instead of a confusing connection error.
case "$INSTANCE" in
  luna-shopper-backend-auth-db)    DB_NAME=luna_auth;    URL_KEY=AUTH_DB_URL ;;
  luna-shopper-backend-core-db)    DB_NAME=luna_core;    URL_KEY=CORE_DB_URL ;;
  luna-shopper-backend-catalog-db) DB_NAME=luna_catalog; URL_KEY=CATALOG_DB_URL ;;
  *)
    echo "Unknown instance '$INSTANCE'." >&2
    echo "Expected one of: luna-shopper-backend-{auth,core,catalog}-db" >&2
    exit 1
    ;;
esac

SCRATCH_DB="${DB_NAME}${SCRATCH_SUFFIX}"

echo "Instance : $INSTANCE"
echo "Database : $DB_NAME"
echo "Scratch  : $SCRATCH_DB  (the real database is never written to)"
echo "Object   : $OBJECT_KEY"
echo

# The restore runs INSIDE the instance's own pod: it already has the matching
# pg_restore, it is already on the database's network, and nothing has to be
# exposed outside the cluster for this.
POD="${INSTANCE}-0"

if ! kubectl -n "$NAMESPACE" get pod "$POD" >/dev/null 2>&1; then
  echo "Pod $POD not found in namespace $NAMESPACE." >&2
  exit 1
fi

# Read the credentials once, here, and pass them into the pod's environment for
# the single command below rather than baking them into a manifest.
secret_value() {
  kubectl -n "$NAMESPACE" get secret "$1" -o "jsonpath={.data.$2}" | base64 -d
}

S3_ENDPOINT="$(secret_value "$BACKUP_SECRET" S3_ENDPOINT)"
S3_BUCKET="$(secret_value "$BACKUP_SECRET" S3_BUCKET)"
AWS_ACCESS_KEY_ID="$(secret_value "$BACKUP_SECRET" AWS_ACCESS_KEY_ID)"
AWS_SECRET_ACCESS_KEY="$(secret_value "$BACKUP_SECRET" AWS_SECRET_ACCESS_KEY)"
DB_URL="$(secret_value "$APP_SECRET" "$URL_KEY")"

start=$(date +%s)

kubectl -n "$NAMESPACE" exec -i "$POD" -- env \
  S3_ENDPOINT="$S3_ENDPOINT" \
  S3_BUCKET="$S3_BUCKET" \
  AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  DB_URL="$DB_URL" \
  DB_NAME="$DB_NAME" \
  SCRATCH_DB="$SCRATCH_DB" \
  OBJECT_KEY="$OBJECT_KEY" \
  /bin/sh -ec '
    set -o pipefail
    apk add --no-cache aws-cli > /dev/null

    key="$OBJECT_KEY"
    if [ "$key" = "latest" ]; then
      # Keys are ISO 8601 UTC stamps, so lexical order is chronological order.
      key="$(aws s3 ls "s3://${S3_BUCKET}/${DB_NAME}/" \
        --endpoint-url "$S3_ENDPOINT" \
        | awk "{print \$4}" | sort | tail -1)"
      if [ -z "$key" ]; then
        echo "No dumps found under s3://${S3_BUCKET}/${DB_NAME}/" >&2
        exit 1
      fi
      key="${DB_NAME}/${key}"
      echo "latest resolves to $key"
    fi

    aws s3 cp "s3://${S3_BUCKET}/${key}" /tmp/restore.dump \
      --endpoint-url "$S3_ENDPOINT"

    # Validate before touching the server, so a corrupt object is a failed
    # download rather than a half restored database.
    pg_restore --list /tmp/restore.dump > /dev/null
    echo "dump is readable: $(wc -c < /tmp/restore.dump) bytes"

    # Alongside the real one, never over it. Dropped first so a repeated drill is
    # idempotent; this is the scratch database and nothing else.
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\";"

    scratch_url="$(echo "$DB_URL" | sed "s|/${DB_NAME}\([?]\|$\)|/${SCRATCH_DB}\1|")"
    pg_restore --dbname "$scratch_url" --no-owner --no-privileges /tmp/restore.dump

    echo
    echo "Row counts in ${SCRATCH_DB}:"
    # The shape of what came back, so the operator sees more than "it exited 0".
    psql "$scratch_url" -v ON_ERROR_STOP=1 -c "
      SELECT relname AS table, n_live_tup AS approx_rows
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC, relname
      LIMIT 25;"

    rm -f /tmp/restore.dump
  '

elapsed=$(( $(date +%s) - start ))

cat <<EOF

Restored into ${SCRATCH_DB} in ${elapsed}s.

The real database was not touched. To inspect it:

  kubectl -n ${NAMESPACE} exec -it ${POD} -- psql -d ${SCRATCH_DB}

To drop it when the drill is done:

  kubectl -n ${NAMESPACE} exec -it ${POD} -- psql -c 'DROP DATABASE "${SCRATCH_DB}";'

Record the ${elapsed}s above in this script's header if this was a drill, so the
recovery objective stays a measured number.
EOF
