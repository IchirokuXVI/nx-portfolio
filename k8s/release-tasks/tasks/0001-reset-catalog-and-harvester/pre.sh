#!/usr/bin/env bash
#
# Drop and recreate the catalog and harvester databases, before helm upgrade.
#
# The upgrade that follows runs the migration hooks against the empty databases,
# and the reference seed is off, so they come back with the schema and nothing
# else. It also scales the two services back up: helm's three way merge restores
# the replica count this script sets to zero, and post.sh checks that it did.
#
# Safe to run again. Each recreated database carries a comment naming this task,
# and a database that already carries it is left alone, so a second run cannot
# empty a catalog that has filled up again since.

set -euo pipefail

MARKER="reset by release task ${TASK_NAME}"

reset() {
  local db="$1"
  local name="luna_${db}" pod="luna-shopper-backend-${db}-db-0" deploy="luna-shopper-backend-${db}"

  if ! kubectl -n "$NAMESPACE" get pod "$pod" > /dev/null 2>&1; then
    echo "  $db: no database pod, so nothing to reset"
    return 0
  fi

  psql_admin() {
    kubectl -n "$NAMESPACE" exec -i "$pod" -- \
      psql -X -q -v ON_ERROR_STOP=1 -U "$name" -d postgres "$@"
  }

  local comment
  comment="$(psql_admin -A -t -c \
    "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${name}'")"
  if [ "$comment" = "$MARKER" ]; then
    echo "  $db: already reset by this task, left alone"
    return 0
  fi

  if kubectl -n "$NAMESPACE" get "deployment/$deploy" > /dev/null 2>&1; then
    echo "  $db: stopping $deploy"
    kubectl -n "$NAMESPACE" scale "deployment/$deploy" --replicas=0 > /dev/null
    if kubectl -n "$NAMESPACE" get pods -l "app=$deploy" -o name | grep -q .; then
      kubectl -n "$NAMESPACE" wait --for=delete pod -l "app=$deploy" --timeout=3m > /dev/null
    fi
  fi

  echo "  $db: dropping and recreating $name"
  psql_admin \
    -c "DROP DATABASE IF EXISTS ${name} WITH (FORCE)" \
    -c "CREATE DATABASE ${name} OWNER ${name}" \
    -c "COMMENT ON DATABASE ${name} IS '${MARKER}'"
}

reset catalog
reset harvester
