#!/usr/bin/env bash
#
# After the rollout, so that the harvester pod carries the command: take the
# wash count off every product whose size came from a printed wash count
# (backend plan 0271). It runs `node wash-sizes.js` inside the harvester pod.
# The command selects the rows in the harvester's database, asks catalog for
# their products, and sends an ordinary item update for each one with the
# harvester's actor: one catalog transaction per product, audited and refused
# by the same rules as any edit. No price changes and nothing is deleted. The
# dump of catalog that the runner took before `helm upgrade` is the way back.
#
# It counts first, with `--count`, and refuses above MAX_PRODUCTS of this
# environment (task.env) before it changes anything. It then passes the same
# ceiling as `--max`, so the command refuses too if the count grew in between.
#
# The run writes the review list of what it corrected (plan 0271, section 5)
# to a file inside the pod, and the Mercadona note beside it. This file copies
# both into the ConfigMap `release-task-<NNNN>-review` of the namespace, keys
# `review.tsv` and `mercadona-per-wash.tsv`, through `kubectl apply`, so a
# second run replaces it. It prints the line counts and the ConfigMap's name,
# never a line of either list: the deploy log is public. A run that corrected
# nothing leaves an earlier list in place. Nothing deletes that ConfigMap; the
# owner does when the curator has worked through it.
#
# It refuses where the harvester deployment's pod has no `wash-sizes.js`: the
# rollout did not happen there. The runner then leaves the task at
# `pre-done`, and the next deploy runs this file again.
#
# Safe to run again. A corrected product has no size, so it no longer matches
# the selection, and a second run counts 0 and writes nothing. It does nothing
# where there is no harvester deployment.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: luna-shopper)
#   WASH_SIZES    command that runs wash-sizes.js of the harvester
#   REVIEW_APPLY  command that receives the ConfigMap's YAML on stdin
#                 (default: kubectl -n <namespace> apply -f -)
#
# The overrides are for a rehearsal against a local stack. Run it only on
# databases that you made for the rehearsal. With WASH_SIZES set the command
# runs on this machine, so its lists are written and read here. Its
# environment must hold HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID:
#   ENVIRONMENT=staging \
#     WASH_SIZES='node dist/apps/luna-shopper-backend-harvester/wash-sizes.js' \
#     REVIEW_APPLY='tee configmap.yaml' \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"
SVC=luna-shopper-backend-harvester
CONFIGMAP="release-task-$NUMBER-review"

# What a command wrote to stderr is kept aside and never read as its answer.
ERR="$(mktemp)"
WORK="$(mktemp -d)"
trap 'rm -rf "$ERR" "$WORK"' EXIT

MAX_PRODUCTS_STAGING=''
MAX_PRODUCTS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) field=MAX_PRODUCTS_STAGING ;;
  production) field=MAX_PRODUCTS_PRODUCTION ;;
  *)
    echo "  cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'" >&2
    exit 1
    ;;
esac
max="${!field}"
max="${max%$'\r'}"
case "$max" in '' | *[!0-9]*)
  echo "  task.env states no ceiling for $ENVIRONMENT: $field is '$max', which is not a number" >&2
  exit 1
  ;;
esac

# Prints the command that runs wash-sizes.js in the harvester, or `absent`
# when there is no harvester deployment. A pod without the file is a refusal.
command_for() {
  local deploy answer
  if [ -n "${WASH_SIZES:-}" ]; then
    printf '%s' "$WASH_SIZES"
    return 0
  fi
  # A missing kubectl answers "command not found", which would read as no
  # deployment below.
  if ! command -v kubectl > /dev/null 2>&1; then
    echo "  kubectl is not on the PATH, so the cluster cannot be read" >&2
    return 1
  fi
  deploy="deploy/$SVC"
  if ! kubectl -n "$NAMESPACE" get "$deploy" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*)
      printf 'absent'
      return 0
      ;;
    esac
    # The runner writes `done` after an exit 0, and `done` is final. A cluster
    # that could not be read must never be recorded as corrected.
    echo "  cannot look up $deploy: $answer" >&2
    return 1
  fi
  local run="kubectl -n $NAMESPACE exec $deploy -c $SVC --"
  # shellcheck disable=SC2086
  if ! $run test -f wash-sizes.js 2> "$ERR"; then
    echo "  the harvester pod runs no wash-sizes.js, so the rollout of this release" >&2
    echo "  did not happen there. Nothing was changed. Deploy again to finish this task. $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s node wash-sizes.js' "$run"
}

# Prints the number on the line `<group> <n>` of a run's output.
count_of() {
  printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1 \\([0-9][0-9]*\\)\$/\\1/p" | tail -n 1
}

# Copies a list the command wrote into $WORK: from this machine when the
# command runs here, else out of the pod.
fetch() {
  local from="$1" to="$2"
  if [ -n "${WASH_SIZES:-}" ]; then
    cp "$from" "$to"
    return 0
  fi
  kubectl -n "$NAMESPACE" exec "deploy/$SVC" -c "$SVC" -- cat "$from" > "$to"
}

if ! cmd="$(command_for)"; then exit 1; fi
if [ "$cmd" = absent ]; then
  echo "  no harvester deployment, so nothing to correct"
  exit 0
fi

# shellcheck disable=SC2086
if ! out="$($cmd --count 2> "$ERR")"; then
  echo "  the count failed, and nothing was changed: $(cat "$ERR") $out" >&2
  exit 1
fi
products="$(count_of products "$out")"
unread="$(count_of unread "$out")"
if [ -z "$products" ] || [ -z "$unread" ]; then
  echo "  the count printed no number of products: '$out'" >&2
  exit 1
fi
printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'

if [ "$unread" -gt 0 ]; then
  echo "  $unread rows print a wash count that is not a whole number above 0. Nothing was changed." >&2
  exit 1
fi
if [ "$products" -gt "$max" ]; then
  echo "  $products products sized by a wash count, above the ceiling of $max. Nothing was changed." >&2
  exit 1
fi
if [ "$products" -eq 0 ]; then
  echo "  no product holds a wash count as its size, so nothing to change"
  exit 0
fi

# The pod's /tmp, or a directory of this machine for a rehearsal.
if [ -n "${WASH_SIZES:-}" ]; then
  list="$WORK/run-review.tsv"
else
  list="/tmp/$CONFIGMAP.tsv"
fi
note="${list%.tsv}.mercadona-per-wash.tsv"

# Saves both lists the command wrote in the ConfigMap, replacing what it held,
# and prints their line counts. Never a line of either.
save_lists() {
  fetch "$list" "$WORK/review.tsv"
  fetch "$note" "$WORK/mercadona-per-wash.tsv"
  kubectl create configmap "$CONFIGMAP" -n "$NAMESPACE" \
    --from-file=review.tsv="$WORK/review.tsv" \
    --from-file=mercadona-per-wash.tsv="$WORK/mercadona-per-wash.tsv" \
    --dry-run=client -o yaml \
    | ${REVIEW_APPLY:-kubectl -n "$NAMESPACE" apply -f -} > /dev/null
  # Each list has a header line, which is not a product.
  local lines notes
  lines=$(($(wc -l < "$WORK/review.tsv") - 1))
  notes=$(($(wc -l < "$WORK/mercadona-per-wash.tsv") - 1))
  echo "  $1: the review list holds $lines lines and the Mercadona note $notes, in the ConfigMap $CONFIGMAP"
}

# The list of what is about to change goes in first. A run that stops after
# its writes and before the list of what it corrected is saved thus still
# leaves every product it may have corrected on a list, with its old size.
# shellcheck disable=SC2086
if ! out="$($cmd --review "$list" 2> "$ERR")"; then
  echo "  the review list could not be written, and nothing was changed: $(cat "$ERR")" >&2
  exit 1
fi
save_lists "before the run"

echo "  taking the wash count off $products products"
# shellcheck disable=SC2086
if ! out="$($cmd --max "$max" --review "$list" 2> "$ERR")"; then
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  echo "  the run failed: $(cat "$ERR")" >&2
  echo "  Each product is its own transaction, so the products before the failure are done" >&2
  echo "  and the rest are not. The next deploy runs this file again and finishes them." >&2
  failed=1
else
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  failed=0
fi

# The list of what the run corrected replaces the one above. A run that
# corrected nothing leaves it in place.
corrected="$(count_of corrected "$out")"
if [ -n "$corrected" ] && [ "$corrected" -gt 0 ]; then
  save_lists "after the run"
fi

# Counted again for the record.
# shellcheck disable=SC2086
if out="$($cmd --count 2> "$ERR")"; then
  echo "  after the run: products=$(count_of products "$out") pack=$(count_of pack "$out") content=$(count_of content "$out")"
fi
exit "$failed"
