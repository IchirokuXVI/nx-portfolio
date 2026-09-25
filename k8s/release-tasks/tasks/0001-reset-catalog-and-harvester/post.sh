#!/usr/bin/env bash
#
# After the rollout: make sure that helm brought the two services back, then
# clear core's references to catalog rows that no longer exist.
#
# Safe to run again. The cleanup keeps every id that catalog still holds, so a
# second run changes nothing.

set -euo pipefail

for deploy in luna-shopper-backend-catalog luna-shopper-backend-harvester; do
  if ! kubectl -n "$NAMESPACE" get "deployment/$deploy" > /dev/null 2>&1; then
    continue
  fi
  replicas="$(kubectl -n "$NAMESPACE" get "deployment/$deploy" -o jsonpath='{.spec.replicas}')"
  if [ "${replicas:-0}" -eq 0 ]; then
    # `kubectl rollout status` reports success for a deployment of zero pods, so
    # this is the check that would otherwise be missing. Stop here, before the
    # task is marked done, so the next deploy finishes it.
    echo "  $deploy still has 0 replicas after the upgrade. Scale it to the count" >&2
    echo "  in values.yaml, then deploy again to finish this task." >&2
    exit 1
  fi
done

NAMESPACE="$NAMESPACE" KUBECONFIG="$KUBECONFIG" \
  bash "$K8S_DIR/catalog-reset/cleanup-core-catalog-refs.sh" --apply
