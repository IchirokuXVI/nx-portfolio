#!/usr/bin/env bash
#
# What this task expects of the data: a catalog that holds at most
# MAX_ITEMS_<ENVIRONMENT> products (task.env). It only reads.
#
# It exits 0 when the catalog is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change
# (no catalog database pod, no `items` table) and where the comment this task
# leaves on `items` is already there, because post.sh then deletes nothing.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a pod
# that cannot be looked up, a query that fails.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: nx-portfolio)
#   CATALOG_PSQL  command that runs psql against catalog, reading SQL on stdin
#
# The override is the one k8s/catalog-reset/remove-catalog-products.sh takes,
# for a rehearsal against a local stack:
#   ENVIRONMENT=staging \
#     CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
NUMBER="${TASK_NAME%%-*}"
MARKER="products removed by release task ${TASK_NAME}"

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

if [ -z "${CATALOG_PSQL:-}" ]; then
  pod=luna-shopper-backend-catalog-db-0
  if ! answer="$(kubectl -n "$NAMESPACE" get pod "$pod" -o name 2>&1)"; then
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
  if ! answer="$(echo "$1" | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1 2>&1)"; then
    echo "$NUMBER cannot read the catalog: $answer" >&2
    return 1
  fi
  printf '%s' "$answer" | tr -d '\r'
}

if ! exists="$(ask "SELECT to_regclass('public.items') IS NOT NULL;")"; then exit 1; fi
if [ "$exists" = f ]; then
  echo "$NUMBER has nothing to change: the catalog has no items table"
  exit 0
fi
if [ "$exists" != t ]; then
  echo "$NUMBER cannot tell whether the items table exists: the catalog answered '$exists'"
  exit 1
fi

if ! comment="$(ask "SELECT obj_description(to_regclass('public.items'), 'pg_class');")"; then exit 1; fi
if [ "$comment" = "$MARKER" ]; then
  echo "$NUMBER already ran here: the items table carries its comment, so it deletes nothing"
  exit 0
fi

if ! found="$(ask 'SELECT count(*) FROM public.items;')"; then exit 1; fi
case "$found" in '' | *[!0-9]*)
  echo "$NUMBER cannot count the products: the catalog answered '$found'"
  exit 1
  ;;
esac

if [ "$found" -gt "$ceiling" ]; then
  echo "$NUMBER expects at most $ceiling products and found $found"
  exit 1
fi
echo "$NUMBER expects at most $ceiling products and found $found"
