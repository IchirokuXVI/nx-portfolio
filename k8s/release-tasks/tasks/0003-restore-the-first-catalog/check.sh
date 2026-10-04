#!/usr/bin/env bash
#
# What this task expects of the data: a catalog that holds at most
# MAX_ITEMS_REPLACED_<ENVIRONMENT> products and a harvester that holds at most
# MAX_SOURCE_ENTRIES_REPLACED_<ENVIRONMENT> source_catalog_entries (task.env).
# It only reads.
#
# It exits 0 when the data is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change:
# no catalog database pod, or a live catalog that already carries the comment
# this restore leaves on the databases it swaps in.
#
# It refuses in every other case, and it refuses what it cannot read: a ceiling
# that is not a number, a pod that cannot be looked up, a query that fails. It
# also refuses a cluster with no backup Secret, because the restore downloads
# the two dumps with the credentials that Secret holds.
#
# Environment overrides:
#   NAMESPACE       kubernetes namespace (default: nx-portfolio)
#   BACKUP_SECRET   secret holding the S3 credentials
#                   (default: luna-shopper-backend-backup-secret)
#   CATALOG_PSQL    command that runs psql against catalog, reading SQL on stdin
#   HARVESTER_PSQL  command that runs psql against harvester, reading SQL on stdin
#
# The overrides are the ones k8s/catalog-import/restore-first-catalog.sh takes,
# for a rehearsal against a local stack. Naming CATALOG_PSQL means that there is
# no cluster, so no pod and no Secret is looked up:
#   ENVIRONMENT=staging \
#     CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d luna_catalog' \
#     HARVESTER_PSQL='docker exec -i my-harvester-db psql -U luna_harvester -d luna_harvester' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
BACKUP_SECRET="${BACKUP_SECRET:-luna-shopper-backend-backup-secret}"
NUMBER="${TASK_NAME%%-*}"
MARKER="first catalog restored by release task ${TASK_NAME}"

# What a command wrote to stderr is kept aside and never read as its answer. A
# warning from Postgres on connect, or a note from kubectl about the container
# it chose, would otherwise turn a good answer into a refusal. It is printed
# only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Cleared first, so that a variable of the caller's shell cannot stand in for a
# ceiling that task.env does not state. Each is read by name further down.
# shellcheck disable=SC2034
MAX_ITEMS_REPLACED_STAGING='' MAX_SOURCE_ENTRIES_REPLACED_STAGING=''
# shellcheck disable=SC2034
MAX_ITEMS_REPLACED_PRODUCTION='' MAX_SOURCE_ENTRIES_REPLACED_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) suffix=STAGING ;;
  production) suffix=PRODUCTION ;;
  *)
    echo "$NUMBER cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'"
    exit 1
    ;;
esac
items_field="MAX_ITEMS_REPLACED_${suffix}"
entries_field="MAX_SOURCE_ENTRIES_REPLACED_${suffix}"
# A checkout with CRLF line endings leaves a carriage return on each value.
items_ceiling="${!items_field%$'\r'}"
entries_ceiling="${!entries_field%$'\r'}"
case "$items_ceiling" in '' | *[!0-9]*)
  echo "$NUMBER states no ceiling: $items_field is '$items_ceiling', which is not a number"
  exit 1
  ;;
esac
case "$entries_ceiling" in '' | *[!0-9]*)
  echo "$NUMBER states no ceiling: $entries_field is '$entries_ceiling', which is not a number"
  exit 1
  ;;
esac

# Prints the command that reaches one database through its pod, or nothing when
# the pod does not exist.
through_pod() {
  local db="$1" pod="luna-shopper-backend-$1-db-0" answer
  if ! kubectl -n "$NAMESPACE" get pod "$pod" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*) return 0 ;; esac
    echo "$NUMBER cannot look up pod/$pod: $answer" >&2
    return 1
  fi
  printf 'kubectl -n %s exec -i %s -- psql -U luna_%s -d luna_%s' "$NAMESPACE" "$pod" "$db" "$db"
}

if [ -z "${CATALOG_PSQL:-}" ]; then
  CLUSTER=true
  if ! CATALOG_PSQL="$(through_pod catalog)"; then exit 1; fi
  if ! HARVESTER_PSQL="$(through_pod harvester)"; then exit 1; fi
else
  CLUSTER=false
fi
HARVESTER_PSQL="${HARVESTER_PSQL:-}"

if [ -z "$CATALOG_PSQL" ]; then
  echo "$NUMBER has nothing to change: there is no catalog database pod"
  exit 0
fi

# -X ignores any psqlrc, -A -t prints the bare value.
ask() {
  local psql="$1" answer
  # shellcheck disable=SC2086
  if ! answer="$(echo "$2" | $psql -X -A -t -v ON_ERROR_STOP=1 2> "$ERR")"; then
    echo "$NUMBER cannot read a database: $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s' "$answer" | tr -d '\r'
}

if ! comment="$(ask "$CATALOG_PSQL" "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database();")"; then exit 1; fi
if [ "$comment" = "$MARKER" ]; then
  echo "$NUMBER already ran here: the live catalog carries its comment, so it restores nothing"
  exit 0
fi

if [ -z "$HARVESTER_PSQL" ]; then
  echo "$NUMBER restores catalog and harvester together, and there is no harvester database"
  exit 1
fi

if [ "$CLUSTER" = true ]; then
  if ! kubectl -n "$NAMESPACE" get secret "$BACKUP_SECRET" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*)
      echo "$NUMBER cannot download the dumps: secret/$BACKUP_SECRET does not exist in this cluster"
      exit 1
      ;;
    esac
    echo "$NUMBER cannot look up secret/$BACKUP_SECRET: $answer"
    exit 1
  fi
fi

# Prints how many rows a table holds, and 0 for a table that does not exist: a
# database with no schema holds none of the rows this task counts.
rows() {
  local psql="$1" table="$2" exists found
  if ! exists="$(ask "$psql" "SELECT to_regclass('public.$table') IS NOT NULL;")"; then return 1; fi
  case "$exists" in
    f)
      printf '0'
      return 0
      ;;
    t) ;;
    *)
      echo "$NUMBER cannot tell whether the $table table exists: the database answered '$exists'" >&2
      return 1
      ;;
  esac
  if ! found="$(ask "$psql" "SELECT count(*) FROM public.$table;")"; then return 1; fi
  case "$found" in '' | *[!0-9]*)
    echo "$NUMBER cannot count $table: the database answered '$found'" >&2
    return 1
    ;;
  esac
  printf '%s' "$found"
}

if ! items="$(rows "$CATALOG_PSQL" items)"; then exit 1; fi
if ! entries="$(rows "$HARVESTER_PSQL" source_catalog_entries)"; then exit 1; fi

if [ "$items" -gt "$items_ceiling" ]; then
  echo "$NUMBER expects at most $items_ceiling products to replace and found $items"
  exit 1
fi
if [ "$entries" -gt "$entries_ceiling" ]; then
  echo "$NUMBER expects at most $entries_ceiling source_catalog_entries to replace and found $entries"
  exit 1
fi
echo "$NUMBER would replace $items products (at most $items_ceiling) and $entries source_catalog_entries (at most $entries_ceiling)"
