#!/usr/bin/env bash
#
# After the rollout, so that it runs against the migrated schema: delete every
# product from catalog, send the harvester rows that were bound to one back to
# the queue, then clear core's references to the products.
#
# Safe to run again. The catalog step leaves a comment on the items table and
# does nothing when it finds it, and the other two steps keep every id that
# catalog still holds.

set -euo pipefail

if ! kubectl -n "$NAMESPACE" get pod luna-shopper-backend-catalog-db-0 > /dev/null 2>&1; then
  echo "  no catalog database pod, so nothing to remove"
  exit 0
fi

export NAMESPACE KUBECONFIG
export MARKER="products removed by release task ${TASK_NAME}"
if ! kubectl -n "$NAMESPACE" get pod luna-shopper-backend-harvester-db-0 > /dev/null 2>&1; then
  export HARVESTER_PSQL=''
fi

bash "$K8S_DIR/catalog-reset/remove-catalog-products.sh" --apply
bash "$K8S_DIR/catalog-reset/cleanup-core-catalog-refs.sh" --apply
