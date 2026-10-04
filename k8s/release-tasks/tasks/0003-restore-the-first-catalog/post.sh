#!/usr/bin/env bash
#
# After the rollout: restore the first catalog over the catalog and harvester
# databases (k8s/catalog-import/restore-first-catalog.sh).
#
# It is a post.sh and not a pre.sh, because the restore compares the migrations
# of the dumps with the ones this release just ran.
#
# Safe to run again. The script leaves a comment on both databases it swaps in,
# and does nothing to them when it finds that comment on the live catalog.
#
# The ceilings of task.env reach the script as MAX_ITEMS_REPLACED and
# MAX_SOURCE_ENTRIES_REPLACED. Naming CATALOG_PSQL makes this a rehearsal with
# no cluster, as it does for the script.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${K8S_DIR:-$(cd "$HERE/../../.." && pwd)}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"

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
    echo "  cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'" >&2
    exit 1
    ;;
esac
items_field="MAX_ITEMS_REPLACED_${suffix}"
entries_field="MAX_SOURCE_ENTRIES_REPLACED_${suffix}"
# A checkout with CRLF line endings leaves a carriage return on each value. The
# script refuses a ceiling that is not a number.
export MAX_ITEMS_REPLACED="${!items_field%$'\r'}"
export MAX_SOURCE_ENTRIES_REPLACED="${!entries_field%$'\r'}"
export NAMESPACE

if [ -n "${CATALOG_PSQL:-}" ]; then
  bash "$K8S_DIR/catalog-import/restore-first-catalog.sh" --apply
  exit 0
fi

# No lookup of the database pod here. The script refuses a pod that does not
# exist and a pod that cannot be looked up, and a refusal is what this hook must
# pass on: the runner writes `done` after an exit 0, and `done` is final. A
# cluster that could not take the restore must never be recorded as restored.
bash "$K8S_DIR/catalog-import/restore-first-catalog.sh" --apply

for deploy in luna-shopper-backend-catalog luna-shopper-backend-harvester; do
  if ! err="$(kubectl -n "$NAMESPACE" get "deployment/$deploy" -o name 2>&1 > /dev/null)"; then
    case "$err" in *NotFound* | *'not found'*) continue ;; esac
    echo "  cannot look up deployment/$deploy: $err" >&2
    exit 1
  fi
  replicas="$(kubectl -n "$NAMESPACE" get "deployment/$deploy" -o jsonpath='{.spec.replicas}')"
  if [ "${replicas:-0}" -eq 0 ]; then
    # A run that was cut while the two services were down leaves them at zero,
    # and the run after it finds the databases already restored. Stop here,
    # before the task is marked done, so that somebody scales them.
    echo "  $deploy has 0 replicas after the restore. Scale it to the count in" >&2
    echo "  values.yaml, then deploy again to finish this task." >&2
    exit 1
  fi
done
