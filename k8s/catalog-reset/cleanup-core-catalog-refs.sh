#!/usr/bin/env bash
#
# Remove every catalog reference in core that catalog no longer holds.
#
# Core stores catalog ids as opaque uuids with no foreign key, because catalog is
# another service with its own database. When the catalog database is reset,
# those ids point at nothing. This script reads the ids that catalog still holds,
# copies them into temporary tables in core, and clears every reference that is
# not among them. It does not assume that catalog is empty, so it is also correct
# after a partial reset.
#
#   ./cleanup-core-catalog-refs.sh           # dry run: prints the counts, then rolls back
#   ./cleanup-core-catalog-refs.sh --apply   # the same, then commits
#
# What it changes in core, all in one transaction:
#
#   list_line_items                 rows whose itemId is gone are deleted
#   list_line_group_removals        rows whose itemId is gone are deleted
#   list_lines.productGroupId       set to null when the group is gone
#   list_lines.itemSetHash          recomputed for every line that lost a product,
#                                   with the algorithm of core's item-set-hash.ts
#   list_lines.version, updatedAt   bumped on every line changed above
#   line_settlements                itemId, supermarketId, supermarketLocationId and
#                                   priceScopeId set to null when gone. The price
#                                   paid, quantity and outcome stay, so the history
#                                   of what people spent survives
#   baskets.supermarketLocationId   set to null when the shop is gone
#   profile_supermarket_preferences rows whose chain is gone are deleted
#   profile_location_preferences    rows whose shop is gone are deleted
#
# Run it after the reset catalog is migrated and before anybody adds catalog
# data again. An id written to catalog between the read and the commit would be
# treated as gone.
#
# Environment overrides:
#   NAMESPACE    kubernetes namespace (default: nx-portfolio)
#   KUBECONFIG   kubeconfig path      (default: /etc/rancher/k3s/k3s.yaml)
#   CATALOG_PSQL command that runs psql against catalog, reading SQL on stdin
#   CORE_PSQL    command that runs psql against core, reading SQL on stdin
#
# The two psql overrides are for a rehearsal against a local stack, for example:
#   CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog'
#   CORE_PSQL='docker exec -i luna-slot1-core-db-1 psql -U luna_core -d luna_core'

set -euo pipefail

MODE=dry-run
case "${1:-}" in
  '') ;;
  --apply) MODE=apply ;;
  *)
    echo "usage: cleanup-core-catalog-refs.sh [--apply]" >&2
    exit 1
    ;;
esac

NAMESPACE="${NAMESPACE:-nx-portfolio}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
CATALOG_PSQL="${CATALOG_PSQL:-kubectl -n $NAMESPACE exec -i luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d luna_catalog}"
CORE_PSQL="${CORE_PSQL:-kubectl -n $NAMESPACE exec -i luna-shopper-backend-core-db-0 -- psql -U luna_core -d luna_core}"

# The catalog tables whose ids core references, and the temporary table in core
# that receives each one.
CATALOG_TABLES=(items product_groups supermarkets supermarket_locations price_scopes)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SQL="$TMP/cleanup.sql"

for table in "${CATALOG_TABLES[@]}"; do
  # -X ignores any psqlrc, -A -t prints bare values, one per line. A missing
  # table stops the script here, before core is touched.
  echo "SELECT id FROM public.\"$table\" ORDER BY id;" \
    | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1 | sed '/^$/d' > "$TMP/$table.ids"
  printf 'catalog still holds %-22s %s\n' "$table" "$(wc -l < "$TMP/$table.ids" | tr -d ' ')"
done

{
  echo '\set ON_ERROR_STOP 1'
  echo 'BEGIN;'
  for table in "${CATALOG_TABLES[@]}"; do
    echo "CREATE TEMP TABLE keep_${table} (id uuid PRIMARY KEY) ON COMMIT DROP;"
    echo "COPY keep_${table} (id) FROM STDIN;"
    cat "$TMP/$table.ids"
    echo '\.'
  done
} > "$SQL"

cat >> "$SQL" <<'SQL'
-- The lines whose product set or group is about to change, captured before the
-- deletes so that their hash and version can be brought up to date after them.
CREATE TEMP TABLE touched_lines ON COMMIT DROP AS
  SELECT DISTINCT "lineId" AS id FROM list_line_items
   WHERE "itemId" NOT IN (SELECT id FROM keep_items)
  UNION
  SELECT id FROM list_lines
   WHERE "productGroupId" IS NOT NULL
     AND "productGroupId" NOT IN (SELECT id FROM keep_product_groups);

WITH d AS (
  DELETE FROM list_line_items
   WHERE "itemId" NOT IN (SELECT id FROM keep_items)
  RETURNING 1)
SELECT 'list_line_items deleted' AS change, count(*) FROM d;

WITH d AS (
  DELETE FROM list_line_group_removals
   WHERE "itemId" NOT IN (SELECT id FROM keep_items)
  RETURNING 1)
SELECT 'list_line_group_removals deleted' AS change, count(*) FROM d;

WITH u AS (
  UPDATE list_lines SET "productGroupId" = NULL
   WHERE "productGroupId" IS NOT NULL
     AND "productGroupId" NOT IN (SELECT id FROM keep_product_groups)
  RETURNING 1)
SELECT 'list_lines.productGroupId cleared' AS change, count(*) FROM u;

-- The same digest as core's item-set-hash.ts: the distinct ids sorted by code
-- unit (COLLATE "C"), joined by commas, sha256, hex. Null when the set is empty.
WITH u AS (
  UPDATE list_lines l
     SET "itemSetHash" = (
           SELECT encode(sha256(convert_to(
                    string_agg(DISTINCT i."itemId"::text COLLATE "C", ','
                               ORDER BY i."itemId"::text COLLATE "C"),
                    'UTF8')), 'hex')
             FROM list_line_items i
            WHERE i."lineId" = l.id),
         version = l.version + 1,
         "updatedAt" = now()
   WHERE l.id IN (SELECT id FROM touched_lines)
  RETURNING 1)
SELECT 'list_lines hash and version updated' AS change, count(*) FROM u;

-- All four together: the CHECK constraints allow a chain only beside a shop and
-- a shop only beside a scope, so each column is cleared when its own id is gone
-- or when the column it depends on is being cleared.
WITH s AS (
  SELECT id,
         ("priceScopeId" IS NOT NULL
            AND "priceScopeId" NOT IN (SELECT id FROM keep_price_scopes)) AS scope_gone,
         ("supermarketLocationId" IS NOT NULL
            AND "supermarketLocationId" NOT IN (SELECT id FROM keep_supermarket_locations)) AS shop_gone,
         ("supermarketId" IS NOT NULL
            AND "supermarketId" NOT IN (SELECT id FROM keep_supermarkets)) AS chain_gone,
         ("itemId" IS NOT NULL
            AND "itemId" NOT IN (SELECT id FROM keep_items)) AS item_gone
    FROM line_settlements),
u AS (
  UPDATE line_settlements t
     SET "itemId" = CASE WHEN s.item_gone THEN NULL ELSE t."itemId" END,
         "priceScopeId" = CASE WHEN s.scope_gone THEN NULL ELSE t."priceScopeId" END,
         "supermarketLocationId" =
           CASE WHEN s.scope_gone OR s.shop_gone THEN NULL ELSE t."supermarketLocationId" END,
         "supermarketId" =
           CASE WHEN s.scope_gone OR s.shop_gone OR s.chain_gone THEN NULL ELSE t."supermarketId" END
    FROM s
   WHERE t.id = s.id
     AND (s.item_gone OR s.scope_gone OR s.shop_gone OR s.chain_gone)
  RETURNING 1)
SELECT 'line_settlements catalog ids cleared' AS change, count(*) FROM u;

WITH u AS (
  UPDATE baskets SET "supermarketLocationId" = NULL
   WHERE "supermarketLocationId" IS NOT NULL
     AND "supermarketLocationId" NOT IN (SELECT id FROM keep_supermarket_locations)
  RETURNING 1)
SELECT 'baskets.supermarketLocationId cleared' AS change, count(*) FROM u;

WITH d AS (
  DELETE FROM profile_supermarket_preferences
   WHERE "supermarketId" NOT IN (SELECT id FROM keep_supermarkets)
  RETURNING 1)
SELECT 'profile_supermarket_preferences deleted' AS change, count(*) FROM d;

WITH d AS (
  DELETE FROM profile_location_preferences
   WHERE "supermarketLocationId" NOT IN (SELECT id FROM keep_supermarket_locations)
  RETURNING 1)
SELECT 'profile_location_preferences deleted' AS change, count(*) FROM d;
SQL

if [ "$MODE" = apply ]; then
  echo 'COMMIT;' >> "$SQL"
else
  echo 'ROLLBACK;' >> "$SQL"
fi

$CORE_PSQL -X -q -v ON_ERROR_STOP=1 < "$SQL"

if [ "$MODE" = apply ]; then
  echo "applied"
else
  echo "dry run: nothing was changed. Run again with --apply to commit."
fi
