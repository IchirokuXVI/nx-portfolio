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
#   ./restore-database.sh luna-shopper-backend-catalog-db imports/2026-10-first-catalog/catalog.dump <sha256>
#
# With a third argument, the download is held to that SHA-256 (k8s plan 0012).
# A file that does not match is refused before the scratch database is created,
# so a wrong or half uploaded object leaves nothing behind.
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
#     luna_auth      <size>   <duration>   <date>
#     luna_core      <size>   <duration>   <date>
#     luna_catalog   <size>   <duration>   <date>
#     luna_harvester <size>   <duration>   <date>
# ---------------------------------------------------------------------------
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace          (default: nx-portfolio)
#   BACKUP_SECRET secret holding S3 credentials (default: luna-shopper-backend-backup-secret)
#   APP_SECRET    secret holding the DB URLs    (default: luna-shopper-backend-secrets)
#   SCRATCH_SUFFIX suffix for the scratch db    (default: _restore)
#   KUBECONFIG    kubeconfig path               (default: /etc/rancher/k3s/k3s.yaml)
#
# For a rehearsal against a local container, where there is no cluster to ask
# (k8s plan 0012). Naming RESTORE_POD_EXEC skips every kubectl call, so the
# other five must be named beside it:
#   RESTORE_POD_EXEC              command that runs a command inside the database
#                                 container, e.g. `docker exec -i my-catalog-db`
#   RESTORE_DB_URL                URL of the real database, as that container
#                                 reaches it
#   RESTORE_S3_ENDPOINT           what the backup Secret holds in a cluster
#   RESTORE_S3_BUCKET
#   RESTORE_S3_ACCESS_KEY_ID
#   RESTORE_S3_SECRET_ACCESS_KEY

set -euo pipefail

INSTANCE="${1:-}"
OBJECT_KEY="${2:-}"
EXPECTED_SHA256="${3:-}"

if [ -z "$INSTANCE" ] || [ -z "$OBJECT_KEY" ]; then
  cat >&2 <<'USAGE'
Usage: restore-database.sh <instance> <object-key|latest> [<sha256>]

  instance     the Postgres StatefulSet, e.g. luna-shopper-backend-auth-db
  object-key   the key under the bucket, e.g. luna_auth/20260827T021700Z.dump
               or the word "latest" for the most recent dump of that database
  sha256       the SHA-256 the downloaded file must have, as 64 hex digits.
               A file that does not match is refused and nothing is restored

Examples:
  ./restore-database.sh luna-shopper-backend-auth-db latest
  ./restore-database.sh luna-shopper-backend-core-db luna_core/20260827T023700Z.dump
USAGE
  exit 1
fi

# A checksum that is not a checksum would compare unequal to every file, which
# reads as a corrupt download. Say what is wrong instead.
if [ -n "$EXPECTED_SHA256" ] && ! [[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "'$EXPECTED_SHA256' is not a SHA-256: expected 64 lowercase hex digits." >&2
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
  # The harvester's database (k8s plan 0008, section 6). It looks like the one
  # instance that would not need this, because running discovery again brings the
  # places back. The places come back; the DECISIONS do not. DiscoveredPlaceStatus
  # records which places an admin imported and which they rejected, and a re-run
  # deliberately does not resurrect a rejected place, so losing this database
  # replays every rejection ever made as new work.
  #
  # Only present where harvester.enabled is true, so this arm answers on a cluster
  # that has the instance and the instance's absence is the error on one that does
  # not, which is the same shape as the other three.
  luna-shopper-backend-harvester-db) DB_NAME=luna_harvester; URL_KEY=HARVESTER_DB_URL ;;
  *)
    echo "Unknown instance '$INSTANCE'." >&2
    echo "Expected one of: luna-shopper-backend-{auth,core,catalog,harvester}-db" >&2
    exit 1
    ;;
esac

SCRATCH_DB="${DB_NAME}${SCRATCH_SUFFIX}"

echo "Instance : $INSTANCE"
echo "Database : $DB_NAME"
echo "Scratch  : $SCRATCH_DB  (the real database is never written to)"
echo "Object   : $OBJECT_KEY"
[ -z "$EXPECTED_SHA256" ] || echo "SHA-256  : $EXPECTED_SHA256"
echo

# The restore runs INSIDE the instance's own pod: it already has the matching
# pg_restore, it is already on the database's network, and nothing has to be
# exposed outside the cluster for this.
POD="${INSTANCE}-0"

if [ -n "${RESTORE_POD_EXEC:-}" ]; then
  # A rehearsal: the caller names the container and everything a Secret would
  # have held. A value left out is an error here, not a question to a cluster
  # that the rehearsal must never reach.
  POD_EXEC="$RESTORE_POD_EXEC"
  S3_ENDPOINT="${RESTORE_S3_ENDPOINT:?RESTORE_POD_EXEC is set, so RESTORE_S3_ENDPOINT must be set too}"
  S3_BUCKET="${RESTORE_S3_BUCKET:?RESTORE_POD_EXEC is set, so RESTORE_S3_BUCKET must be set too}"
  AWS_ACCESS_KEY_ID="${RESTORE_S3_ACCESS_KEY_ID:?RESTORE_POD_EXEC is set, so RESTORE_S3_ACCESS_KEY_ID must be set too}"
  AWS_SECRET_ACCESS_KEY="${RESTORE_S3_SECRET_ACCESS_KEY:?RESTORE_POD_EXEC is set, so RESTORE_S3_SECRET_ACCESS_KEY must be set too}"
  DB_URL="${RESTORE_DB_URL:?RESTORE_POD_EXEC is set, so RESTORE_DB_URL must be set too}"
else
  POD_EXEC="kubectl -n $NAMESPACE exec -i $POD --"

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
fi

start=$(date +%s)

# The script below is in single quotes on purpose: it expands inside the pod.
# shellcheck disable=SC2016
$POD_EXEC env \
  S3_ENDPOINT="$S3_ENDPOINT" \
  S3_BUCKET="$S3_BUCKET" \
  AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  DB_URL="$DB_URL" \
  DB_NAME="$DB_NAME" \
  SCRATCH_DB="$SCRATCH_DB" \
  OBJECT_KEY="$OBJECT_KEY" \
  EXPECTED_SHA256="$EXPECTED_SHA256" \
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

    # The file is the one the caller named, or nothing is restored. Checked
    # before the scratch database is dropped, so a refusal changes nothing.
    if [ -n "$EXPECTED_SHA256" ]; then
      actual="$(sha256sum /tmp/restore.dump | cut -d" " -f1)"
      if [ "$actual" != "$EXPECTED_SHA256" ]; then
        echo "SHA-256 mismatch for s3://${S3_BUCKET}/${key}" >&2
        echo "  expected $EXPECTED_SHA256" >&2
        echo "  found    $actual" >&2
        echo "Nothing was restored, and no scratch database was created." >&2
        rm -f /tmp/restore.dump
        exit 1
      fi
      echo "SHA-256 matches: $actual"
    fi

    # Validate before touching the server, so a corrupt object is a failed
    # download rather than a half restored database.
    pg_restore --list /tmp/restore.dump > /dev/null
    echo "dump is readable: $(wc -c < /tmp/restore.dump) bytes"

    # The same URL with the scratch database as its path. The expression this
    # replaced used | as the delimiter of the s command and \| inside it, which
    # is then a literal bar and not an alternation. It matched nothing, the URL
    # stayed the URL of the real database, and pg_restore wrote into the real
    # database (found by the rehearsal of k8s plan 0012). So the result is also
    # checked: a URL that did not change is a refusal, before anything is created.
    scratch_url="$(echo "$DB_URL" | sed "s#/${DB_NAME}\([?].*\)\{0,1\}\$#/${SCRATCH_DB}\1#")"
    if [ "$scratch_url" = "$DB_URL" ]; then
      echo "Cannot derive the URL of ${SCRATCH_DB}: the database URL does not end in /${DB_NAME}." >&2
      echo "Nothing was restored, and no scratch database was created." >&2
      rm -f /tmp/restore.dump
      exit 1
    fi

    # Alongside the real one, never over it. Dropped first so a repeated drill is
    # idempotent; this is the scratch database and nothing else.
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\";"

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
