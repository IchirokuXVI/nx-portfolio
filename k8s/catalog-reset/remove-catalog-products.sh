#!/usr/bin/env bash
#
# Remove every product from catalog, and every link to a product in harvester.
#
# Unlike the reset of release task 0001, this keeps both databases. Catalog
# keeps its chains, shops, price scopes, price policies, brands, categories,
# sections and product groups. Harvester keeps its runs, sources, discovered
# places, postal code requests and every row a source described, with its
# prices. Only the products go, and whatever pointed at one.
#
#   ./remove-catalog-products.sh           # dry run: prints the counts, then rolls back
#   ./remove-catalog-products.sh --apply   # the same, then commits
#
# What it changes:
#
#   catalog    items                  every row is deleted. The foreign keys
#                                     cascade, so the rows of supermarket_items,
#                                     supermarket_location_items, item_prices,
#                                     item_price_details, item_categories and
#                                     supermarket_item_sections go with them
#   harvester  source_catalog_entries a row bound to a product that is gone goes
#                                     back to the queue: itemId, matchedBy and
#                                     decidedAt null, confidence 0, status
#                                     UNRESOLVED. A REJECTED row keeps its
#                                     status, because that is a decision about
#                                     the row and not about a product
#
# Core also holds product ids. Run cleanup-core-catalog-refs.sh after this
# script, which clears every id that catalog no longer holds.
#
# Safe to run again. The catalog step writes a comment on the items table and
# does nothing when the comment is already there, so a second run cannot empty a
# catalog that filled up again. The harvester step keeps every link to a product
# that catalog still holds.
#
# Environment overrides:
#   NAMESPACE      kubernetes namespace (default: nx-portfolio)
#   KUBECONFIG     kubeconfig path      (default: /etc/rancher/k3s/k3s.yaml)
#   MARKER         the comment written on the items table
#   CATALOG_PSQL   command that runs psql against catalog, reading SQL on stdin
#   HARVESTER_PSQL command that runs psql against harvester, reading SQL on
#                  stdin. Set it to an empty string where there is no harvester
#
# The two psql overrides are for a rehearsal against a local stack, for example:
#   CATALOG_PSQL='docker exec -i luna-slot1-catalog-db-1 psql -U luna_catalog -d luna_catalog'
#   HARVESTER_PSQL='docker exec -i luna-slot1-harvester-db-1 psql -U luna_harvester -d luna_harvester'

set -euo pipefail

MODE=dry-run
case "${1:-}" in
  '') ;;
  --apply) MODE=apply ;;
  *)
    echo "usage: remove-catalog-products.sh [--apply]" >&2
    exit 1
    ;;
esac

NAMESPACE="${NAMESPACE:-nx-portfolio}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
MARKER="${MARKER:-products removed by remove-catalog-products.sh}"
CATALOG_PSQL="${CATALOG_PSQL:-kubectl -n $NAMESPACE exec -i luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d luna_catalog}"
HARVESTER_PSQL="${HARVESTER_PSQL-kubectl -n $NAMESPACE exec -i luna-shopper-backend-harvester-db-0 -- psql -U luna_harvester -d luna_harvester}"

if [ "$MODE" = apply ]; then END='COMMIT;'; else END='ROLLBACK;'; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# -X ignores any psqlrc, -A -t prints bare values. A missing table stops the
# script here, before anything is changed.
comment="$(echo "SELECT obj_description('public.items'::regclass, 'pg_class');" \
  | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1)"

if [ "$comment" = "$MARKER" ]; then
  echo "catalog: products already removed by this task, left alone"
  REMOVED=false
else
  REMOVED=true
  $CATALOG_PSQL -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SELECT 'catalog rows before:', t, n FROM (
  SELECT 'items' AS t, count(*) AS n FROM items
  UNION ALL SELECT 'supermarket_items', count(*) FROM supermarket_items
  UNION ALL SELECT 'supermarket_location_items', count(*) FROM supermarket_location_items
  UNION ALL SELECT 'item_prices', count(*) FROM item_prices
  UNION ALL SELECT 'item_price_details', count(*) FROM item_price_details) c;
DELETE FROM items;
COMMENT ON TABLE items IS '${MARKER}';
SELECT 'catalog rows after:', t, n FROM (
  SELECT 'items' AS t, count(*) AS n FROM items
  UNION ALL SELECT 'supermarket_items', count(*) FROM supermarket_items
  UNION ALL SELECT 'supermarket_location_items', count(*) FROM supermarket_location_items
  UNION ALL SELECT 'item_prices', count(*) FROM item_prices
  UNION ALL SELECT 'item_price_details', count(*) FROM item_price_details) c;
SELECT 'catalog rows kept:', t, n FROM (
  SELECT 'supermarkets' AS t, count(*) AS n FROM supermarkets
  UNION ALL SELECT 'supermarket_locations', count(*) FROM supermarket_locations
  UNION ALL SELECT 'price_scopes', count(*) FROM price_scopes
  UNION ALL SELECT 'brands', count(*) FROM brands
  UNION ALL SELECT 'product_groups', count(*) FROM product_groups) c;
${END}
SQL
fi

if [ -z "$HARVESTER_PSQL" ]; then
  echo "harvester: no database named, so nothing to unlink"
else
  # The ids that catalog still holds. A dry run rolled its delete back, so it
  # states the empty set that an apply leaves behind.
  if [ "$REMOVED" = true ]; then
    : > "$TMP/items.ids"
  else
    echo 'SELECT id FROM public.items ORDER BY id;' \
      | $CATALOG_PSQL -X -A -t -v ON_ERROR_STOP=1 | sed '/^$/d' > "$TMP/items.ids"
  fi

  {
    echo '\set ON_ERROR_STOP 1'
    echo 'BEGIN;'
    echo 'CREATE TEMP TABLE keep_items (id uuid PRIMARY KEY) ON COMMIT DROP;'
    echo 'COPY keep_items (id) FROM STDIN;'
    cat "$TMP/items.ids"
    echo '\.'
    cat <<'SQL'
WITH u AS (
  UPDATE source_catalog_entries
     SET "itemId" = NULL,
         "matchedBy" = NULL,
         confidence = 0,
         "decidedAt" = NULL,
         status = CASE WHEN status = 'REJECTED' THEN status
                       ELSE 'UNRESOLVED'::source_entry_status END
   WHERE "itemId" IS NOT NULL
     AND "itemId" NOT IN (SELECT id FROM keep_items)
  RETURNING 1)
SELECT 'harvester: source_catalog_entries unlinked', count(*) FROM u;
SELECT 'harvester: source_catalog_entries ' || status, count(*)
  FROM source_catalog_entries GROUP BY status ORDER BY 1;
SQL
    echo "$END"
  } > "$TMP/harvester.sql"

  $HARVESTER_PSQL -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 < "$TMP/harvester.sql"
fi

if [ "$MODE" = apply ]; then
  echo "applied"
else
  echo "dry run: nothing was changed. Run again with --apply to commit."
fi
