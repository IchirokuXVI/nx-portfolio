#!/usr/bin/env bash
#
# What this task expects of the data: a catalog whose four tables of chain
# sections hold at most MAX_ROWS_<ENVIRONMENT> rows together (task.env). The
# tables are supermarket_sections, section_categories, location_sections and
# supermarket_item_sections (backend plan 0200). It only reads.
#
# It exits 0 when the catalog is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change:
# no catalog database pod, none of the four tables, or four tables with no row.
# The last case is also how the task finds its own earlier run, because that
# run leaves the tables empty and nothing writes to them after it.
#
# It does not ask for shop_sections. This file runs before `helm upgrade`, and
# the release that carries the task is the one whose migration creates that
# table. A check that asked for it would refuse the deploy that makes it.
# post.sh runs after the migration, and it is the one that refuses to delete
# without the table.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a pod
# that cannot be looked up, a query that fails.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: luna-shopper)
#   CATALOG_PSQL  command that runs psql against catalog, reading SQL on stdin
#
# The override is for a rehearsal against a local stack:
#   ENVIRONMENT=staging \
#     CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"

# In the order post.sh deletes them.
TABLES='supermarket_item_sections location_sections section_categories supermarket_sections'

# What a command wrote to stderr is kept aside and never read as its answer. A
# warning from Postgres on connect, or a note from kubectl about the container
# it chose, would otherwise turn a good answer into a refusal. It is printed
# only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Cleared first, so that a variable of the caller's shell cannot stand in for a
# ceiling that task.env does not state.
MAX_ROWS_STAGING=''
MAX_ROWS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) ceiling="$MAX_ROWS_STAGING" field=MAX_ROWS_STAGING ;;
  production) ceiling="$MAX_ROWS_PRODUCTION" field=MAX_ROWS_PRODUCTION ;;
  *)
    echo "$NUMBER cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'"
    exit 1
    ;;
esac
# A checkout with CRLF line endings leaves a carriage return on the value.
ceiling="${ceiling%$'\r'}"
case "$ceiling" in '' | *[!0-9]*)
  echo "$NUMBER states no ceiling: $field is '$ceiling', which is not a number"
  exit 1
  ;;
esac

if [ -z "${CATALOG_PSQL:-}" ]; then
  pod=luna-shopper-backend-catalog-db-0
  if ! kubectl -n "$NAMESPACE" get pod "$pod" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*)
      echo "$NUMBER has nothing to change: there is no catalog database pod"
      exit 0
      ;;
    esac
    echo "$NUMBER cannot look up pod/$pod: $answer"
    exit 1
  fi
  CATALOG_PSQL="kubectl -n $NAMESPACE exec -i $pod -- psql -U luna_catalog -d luna_catalog"
fi

# -X ignores any psqlrc, -A -t prints the bare value.
ask() {
  local answer
  # shellcheck disable=SC2086
  if ! answer="$(echo "$1" | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1 2> "$ERR")"; then
    echo "$NUMBER cannot read the catalog: $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s' "$answer" | tr -d '\r'
}

# Prints whether a table exists, as t or f.
exists() {
  local found
  if ! found="$(ask "SELECT to_regclass('public.$1') IS NOT NULL;")"; then return 1; fi
  case "$found" in
    t | f) printf '%s' "$found" ;;
    *)
      echo "$NUMBER cannot tell whether the $1 table exists: the catalog answered '$found'" >&2
      return 1
      ;;
  esac
}

# Prints how many rows a table holds, and 0 for a table that does not exist: a
# later plan drops the four tables, and a catalog without them holds none of
# the rows this task counts.
rows() {
  local there found
  if ! there="$(exists "$1")"; then return 1; fi
  if [ "$there" = f ]; then
    printf '0'
    return 0
  fi
  if ! found="$(ask "SELECT count(*) FROM public.$1;")"; then return 1; fi
  case "$found" in '' | *[!0-9]*)
    echo "$NUMBER cannot count $1: the catalog answered '$found'" >&2
    return 1
    ;;
  esac
  printf '%s' "$found"
}

total=0
found_in=''
for table in $TABLES; do
  if ! count="$(rows "$table")"; then exit 1; fi
  total=$((total + count))
  found_in="$found_in $table=$count"
done

if [ "$total" -eq 0 ]; then
  echo "$NUMBER has nothing to change: the four tables of chain sections hold no row"
  exit 0
fi

if [ "$total" -gt "$ceiling" ]; then
  echo "$NUMBER expects at most $ceiling rows of chain sections and found $total (${found_in# })"
  exit 1
fi

if ! copies="$(exists shop_sections)"; then exit 1; fi
if [ "$copies" = f ]; then
  echo "$NUMBER would remove $total rows (at most $ceiling): ${found_in# }. shop_sections does not exist yet: the migration of this release creates it, and post.sh refuses to delete without it"
  exit 0
fi
echo "$NUMBER would remove $total rows (at most $ceiling): ${found_in# }"
