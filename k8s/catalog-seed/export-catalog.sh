#!/usr/bin/env bash
# Export the catalog's seed data from a local Luna slot, for restoring into
# staging and then production (plan 0038 seeding).
#
# What it writes is DATA ONLY, table by table, in dependency order, as INSERTs
# with ON CONFLICT DO NOTHING. That shape matters:
#
#   - data only, so the target keeps its own schema and its `migrations` table.
#     A full dump would carry that table and make the target disagree with the
#     migrations the chart has actually run.
#   - the tables named explicitly, so nothing else in the database travels.
#   - ON CONFLICT DO NOTHING, so restoring twice is not an error and a partial
#     restore can simply be repeated.
#
# The ids are preserved deliberately. Core references catalog rows by opaque id
# across databases, so a restore that renumbered them would break every shopping
# line that pointed at an item.
#
# Usage: export-catalog.sh <container> [out-file]
#   container  the catalog Postgres container, e.g. luna-slot2-catalog-db-1
set -euo pipefail

CONTAINER="${1:?usage: export-catalog.sh <container> [out-file]}"
OUT="${2:-catalog-seed.sql}"

# Parents first: a location needs its scope, an item may point at a group, and a
# price needs its item. The restore replays them in this order.
TABLES=(
  supermarkets
  price_scopes
  supermarket_locations
  product_groups
  items
  supermarket_items
  supermarket_location_items
)

ARGS=()
for table in "${TABLES[@]}"; do
  ARGS+=(--table="public.${table}")
done

docker exec "$CONTAINER" pg_dump \
  -U luna_catalog -d luna_catalog \
  --data-only --inserts --on-conflict-do-nothing --no-owner --no-privileges \
  "${ARGS[@]}" > "$OUT"

echo "wrote $OUT"
for table in "${TABLES[@]}"; do
  count=$(grep -c "INSERT INTO public.${table} " "$OUT" || true)
  printf '  %-28s %s\n' "$table" "$count"
done
