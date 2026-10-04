#!/usr/bin/env bash
#
# What this task expects of the data: a catalog that holds at most
# MAX_ITEMS_<ENVIRONMENT> products (task.env). It only reads.
#
# It exits 0 when the catalog is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change:
# no database pod, or every database that exists already carries the comment
# that pre.sh leaves on a database it recreated, because pre.sh then drops
# nothing.
#
# The ceiling applies as soon as pre.sh would drop either database. A harvester
# without its comment beside a catalog with one still counts the products: the
# harvester rows point at them.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a pod
# that cannot be looked up, a query that fails. That includes a catalog pod
# whose `luna_catalog` database is gone, which is what a pre.sh that stopped
# between its drop and its create leaves behind. A person looks at that one.
#
# Environment overrides:
#   NAMESPACE       kubernetes namespace (default: nx-portfolio)
#   CATALOG_PSQL    command that runs psql against catalog, reading SQL on stdin
#   HARVESTER_PSQL  command that runs psql against harvester, reading SQL on
#                   stdin. Set it to an empty string where there is no harvester
#
# The overrides are the ones k8s/catalog-reset/remove-catalog-products.sh takes,
# for a rehearsal against a local stack. Naming CATALOG_PSQL skips the lookup of
# both pods, so name HARVESTER_PSQL beside it, or leave it out for no harvester:
#   ENVIRONMENT=staging \
#     CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog' \
#     HARVESTER_PSQL='docker exec -i luna-slot1-harvester-db-1 psql -U luna_harvester -d luna_harvester' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
NUMBER="${TASK_NAME%%-*}"
MARKER="reset by release task ${TASK_NAME}"

# What a command wrote to stderr is kept aside and never read as its answer. A
# warning from Postgres on connect, or a note from kubectl about the container
# it chose, would otherwise turn a good answer into a refusal. It is printed
# only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

MAX_ITEMS_STAGING=''
MAX_ITEMS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) ceiling="$MAX_ITEMS_STAGING" field=MAX_ITEMS_STAGING ;;
  production) ceiling="$MAX_ITEMS_PRODUCTION" field=MAX_ITEMS_PRODUCTION ;;
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
  if ! CATALOG_PSQL="$(through_pod catalog)"; then exit 1; fi
  if ! HARVESTER_PSQL="$(through_pod harvester)"; then exit 1; fi
fi
HARVESTER_PSQL="${HARVESTER_PSQL:-}"

# -X ignores any psqlrc, -A -t prints the bare value.
ask() {
  local psql="$1" answer
  if ! answer="$(echo "$2" | $psql -X -A -t -v ON_ERROR_STOP=1 2> "$ERR")"; then
    echo "$NUMBER cannot read a database: $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s' "$answer" | tr -d '\r'
}

COMMENT_SQL="SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database();"

# Would pre.sh drop anything? It leaves alone a database that carries its comment.
pending=''
for db in catalog harvester; do
  case "$db" in
    catalog) psql="$CATALOG_PSQL" ;;
    harvester) psql="$HARVESTER_PSQL" ;;
  esac
  [ -n "$psql" ] || continue
  if ! comment="$(ask "$psql" "$COMMENT_SQL")"; then exit 1; fi
  [ "$comment" = "$MARKER" ] || pending="${pending:+$pending }$db"
done

if [ -z "$pending" ]; then
  echo "$NUMBER has nothing to change: every database it resets is absent or already carries its comment"
  exit 0
fi
if [ -z "$CATALOG_PSQL" ]; then
  echo "$NUMBER would reset $pending, and there is no catalog whose products it could count"
  exit 0
fi

if ! exists="$(ask "$CATALOG_PSQL" "SELECT to_regclass('public.items') IS NOT NULL;")"; then exit 1; fi
if [ "$exists" = f ]; then
  echo "$NUMBER would reset $pending, and the catalog has no items table, so it holds no products"
  exit 0
fi
if [ "$exists" != t ]; then
  echo "$NUMBER cannot tell whether the items table exists: the catalog answered '$exists'"
  exit 1
fi

if ! found="$(ask "$CATALOG_PSQL" 'SELECT count(*) FROM public.items;')"; then exit 1; fi
case "$found" in '' | *[!0-9]*)
  echo "$NUMBER cannot count the products: the catalog answered '$found'"
  exit 1
  ;;
esac

if [ "$found" -gt "$ceiling" ]; then
  echo "$NUMBER expects at most $ceiling products and found $found"
  exit 1
fi
echo "$NUMBER would reset $pending. It expects at most $ceiling products and found $found"
