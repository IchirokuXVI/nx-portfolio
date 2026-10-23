#!/usr/bin/env bash
#
# After the rollout, so that it runs against the migrated schema: delete every
# row of the four tables of chain sections (backend plan 0200, section 6), in
# this order: supermarket_item_sections, location_sections, section_categories,
# supermarket_sections. The tables stay. A later plan drops them.
#
# The migration of the same release copied the selection of each shop into
# shop_sections before this runs, and nothing reads the four tables after it.
# The dump that the runner took before `helm upgrade` is the way back.
#
# It refuses in one case: the four tables hold rows and shop_sections does not
# exist. The migration did not run there, so the rows are still what the
# service reads, and a delete would remove the sections of every shop. The
# runner then leaves the task at `pre-done`, and the next deploy runs this
# file again.
#
# A selection with no copy does not stop it. The migration copied every
# selection, so a missing copy means that a person or a map walk removed that
# section of the shop after the migration. That was a decision about the new
# rows. This file prints how many such selections there are, and deletes the
# old rows anyway.
#
# Safe to run again. All four deletes are one transaction, and a run after it
# finds four empty tables and does nothing. It does nothing where there is no
# catalog database pod, and where the four tables do not exist.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: luna-shopper)
#   CATALOG_PSQL  command that runs psql against catalog, reading SQL on stdin
#
# The override is for a rehearsal against a local stack. Run it only on a
# database that you made for the rehearsal:
#   CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d luna_catalog' \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

NAMESPACE="${NAMESPACE:-luna-shopper}"

# In the order they are deleted.
TABLES='supermarket_item_sections location_sections section_categories supermarket_sections'

# What a command wrote to stderr is kept aside and never read as its answer.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

if [ -z "${CATALOG_PSQL:-}" ]; then
  pod=luna-shopper-backend-catalog-db-0
  if ! kubectl -n "$NAMESPACE" get pod "$pod" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*)
      echo "  no catalog database pod, so nothing to remove"
      exit 0
      ;;
    esac
    # The runner writes `done` after an exit 0, and `done` is final. A cluster
    # that could not be read must never be recorded as emptied.
    echo "  cannot look up pod/$pod: $answer" >&2
    exit 1
  fi
  CATALOG_PSQL="kubectl -n $NAMESPACE exec -i $pod -- psql -U luna_catalog -d luna_catalog"
fi

# -X ignores any psqlrc, -A -t prints the bare value.
ask() {
  local answer
  # shellcheck disable=SC2086
  if ! answer="$(echo "$1" | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1 2> "$ERR")"; then
    echo "  cannot read the catalog: $(cat "$ERR")" >&2
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
      echo "  cannot tell whether the $1 table exists: the catalog answered '$found'" >&2
      return 1
      ;;
  esac
}

# Prints how many rows a table holds, and 0 for a table that does not exist.
rows() {
  local there found
  if ! there="$(exists "$1")"; then return 1; fi
  if [ "$there" = f ]; then
    printf '0'
    return 0
  fi
  if ! found="$(ask "SELECT count(*) FROM public.$1;")"; then return 1; fi
  case "$found" in '' | *[!0-9]*)
    echo "  cannot count $1: the catalog answered '$found'" >&2
    return 1
    ;;
  esac
  printf '%s' "$found"
}

# Prints the rows of each table and their sum, as "<sum> <table>=<rows> ...".
census() {
  local table count total=0 each=''
  for table in $TABLES; do
    if ! count="$(rows "$table")"; then return 1; fi
    total=$((total + count))
    each="$each $table=$count"
  done
  printf '%s%s' "$total" "$each"
}

if ! before="$(census)"; then exit 1; fi
total="${before%% *}"
if [ "$total" -eq 0 ]; then
  echo "  the four tables of chain sections hold no row, so nothing to remove"
  exit 0
fi

if ! copies="$(exists shop_sections)"; then exit 1; fi
if [ "$copies" = f ]; then
  echo "  the four tables of chain sections hold $total rows and shop_sections does not exist." >&2
  echo "  The migration of backend plan 0200 did not run here, so these rows are still what the" >&2
  echo "  service reads. Nothing was deleted. Run the migrations, then deploy again to finish this task." >&2
  exit 1
fi

# A selection is a row of location_sections. Its copy is the section of the
# same shop with the slug of the chain section, which is how the migration
# wrote it.
if ! orphans="$(ask '
  SELECT count(*)
    FROM public.location_sections ls
    JOIN public.supermarket_sections s ON s."id" = ls."sectionId"
   WHERE NOT EXISTS (
           SELECT 1 FROM public.shop_sections copy
            WHERE copy."supermarketLocationId" = ls."supermarketLocationId"
              AND copy."slug" = s."slug");')"; then
  exit 1
fi
case "$orphans" in '' | *[!0-9]*)
  echo "  cannot count the selections with no copy: the catalog answered '$orphans'" >&2
  exit 1
  ;;
esac
echo "  selections with no copy in shop_sections: $orphans"
if [ "$orphans" -gt 0 ]; then
  echo "  The migration copied every selection, so a person or a map walk removed these $orphans"
  echo "  after it. The old rows are deleted anyway. The dump of this task holds them."
fi

echo "  removing $total rows: ${before#* }"
# One transaction: all four tables are emptied, or none is.
# shellcheck disable=SC2086
if ! echo '
  BEGIN;
  DELETE FROM public.supermarket_item_sections;
  DELETE FROM public.location_sections;
  DELETE FROM public.section_categories;
  DELETE FROM public.supermarket_sections;
  COMMIT;' | $CATALOG_PSQL -X -q -v ON_ERROR_STOP=1 > /dev/null 2> "$ERR"; then
  echo "  the delete failed, and it removed nothing: $(cat "$ERR")" >&2
  exit 1
fi

if ! after="$(census)"; then exit 1; fi
if [ "${after%% *}" -ne 0 ]; then
  echo "  the delete answered success and rows are left: ${after#* }" >&2
  exit 1
fi
echo "  removed $total rows. The four tables are empty, and shop_sections is untouched"
