#!/usr/bin/env bash
#
# After the rollout, so that the pods run the release that brings the command
# and the auth subject it asks: unlink every account that was deleted before
# backend plan 0232 (section 7). In core and then in catalog, it runs
# `node reconcile-deletions.js` inside the pod. The command collects the user
# ids of the tables of section 2, asks auth `auth.existingUserIds` in batches of
# 500, and runs the deletion of the plan for each id auth does not know: the
# deletion a `user.deleted` on the stream runs. Profiles, voice recordings and
# app state go; lines, comments, purchases and walks stay with a tombstone in
# place of the id. The dump that the runner took before `helm upgrade` is the
# way back.
#
# Per service it counts first, with `--count`, and refuses above
# MAX_UNKNOWN_IDS_<ENVIRONMENT> (task.env) before it changes anything. It then
# passes the same ceiling as `--max`, so the command refuses too if the count
# grew in between.
#
# It refuses where a service has a deployment whose pod has no
# `reconcile-deletions.js`: the rollout did not happen there. The runner then
# leaves the task at `pre-done`, and the next deploy runs this file again.
#
# Safe to run again. Each deletion is one transaction in its service, and a run
# after it finds no id that auth does not know: a tombstone is no candidate,
# and an id it already deleted is gone from every table. It does nothing where
# a service has no deployment.
#
# Environment overrides:
#   NAMESPACE          kubernetes namespace (default: luna-shopper)
#   CORE_RECONCILE     command that runs reconcile-deletions.js of core
#   CATALOG_RECONCILE  command that runs reconcile-deletions.js of catalog
#
# The overrides are for a rehearsal against a local stack. Run it only on
# databases that you made for the rehearsal:
#   ENVIRONMENT=staging \
#     CORE_RECONCILE='node dist/apps/luna-shopper-backend-core/reconcile-deletions.js' \
#     CATALOG_RECONCILE='node dist/apps/luna-shopper-backend-catalog/reconcile-deletions.js' \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="${NAMESPACE:-luna-shopper}"

# What a command wrote to stderr is kept aside and never read as its answer.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

MAX_UNKNOWN_IDS_STAGING=''
MAX_UNKNOWN_IDS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) ceiling="$MAX_UNKNOWN_IDS_STAGING" ;;
  production) ceiling="$MAX_UNKNOWN_IDS_PRODUCTION" ;;
  *)
    echo "  cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'" >&2
    exit 1
    ;;
esac
ceiling="${ceiling%$'\r'}"
case "$ceiling" in '' | *[!0-9]*)
  echo "  task.env states no ceiling for $ENVIRONMENT: '$ceiling' is not a number" >&2
  exit 1
  ;;
esac

# Prints the command that runs reconcile-deletions.js in a service, or `absent`
# when the service has no deployment. A pod without the file is a refusal.
command_for() {
  local svc="$1" override deploy answer
  case "$svc" in
    core) override="${CORE_RECONCILE:-}" ;;
    catalog) override="${CATALOG_RECONCILE:-}" ;;
  esac
  if [ -n "$override" ]; then
    printf '%s' "$override"
    return 0
  fi
  deploy="deploy/luna-shopper-backend-$svc"
  if ! kubectl -n "$NAMESPACE" get "$deploy" -o name > /dev/null 2> "$ERR"; then
    answer="$(cat "$ERR")"
    case "$answer" in *NotFound* | *'not found'*)
      printf 'absent'
      return 0
      ;;
    esac
    # The runner writes `done` after an exit 0, and `done` is final. A cluster
    # that could not be read must never be recorded as reconciled.
    echo "  cannot look up $deploy: $answer" >&2
    return 1
  fi
  local run="kubectl -n $NAMESPACE exec $deploy -c luna-shopper-backend-$svc --"
  # shellcheck disable=SC2086
  if ! $run test -f reconcile-deletions.js 2> "$ERR"; then
    echo "  the $svc pod runs no reconcile-deletions.js, so the rollout of this release" >&2
    echo "  did not happen there. Nothing was changed. Deploy again to finish this task. $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s node reconcile-deletions.js' "$run"
}

# Prints the count a run of the command printed as `unknown <n>`.
unknown_of() {
  printf '%s\n' "$1" | tr -d '\r' | sed -n 's/^unknown \([0-9][0-9]*\)$/\1/p' | tail -n 1
}

for svc in core catalog; do
  if ! cmd="$(command_for "$svc")"; then exit 1; fi
  if [ "$cmd" = absent ]; then
    echo "  $svc: no deployment, so nothing to unlink"
    continue
  fi

  # shellcheck disable=SC2086
  if ! out="$($cmd --count 2> "$ERR")"; then
    echo "  $svc: the count failed, and nothing was changed: $(cat "$ERR") $out" >&2
    exit 1
  fi
  count="$(unknown_of "$out")"
  if [ -z "$count" ]; then
    echo "  $svc: the count printed no number: '$out'" >&2
    exit 1
  fi
  if [ "$count" -eq 0 ]; then
    echo "  $svc: auth knows every id, so nothing to unlink"
    continue
  fi
  if [ "$count" -gt "$ceiling" ]; then
    echo "  $svc: $count ids are unknown to auth, above the ceiling of $ceiling. Nothing was changed." >&2
    exit 1
  fi

  echo "  $svc: unlinking $count ids that auth does not know"
  # shellcheck disable=SC2086
  if ! out="$($cmd --max "$ceiling" 2> "$ERR")"; then
    echo "  $svc: the run failed: $(cat "$ERR") $out" >&2
    echo "  Each deletion is its own transaction, so the ids before the failure are done and" >&2
    echo "  the rest are not. The next deploy runs this file again and finishes them." >&2
    exit 1
  fi
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'

  # Counted again for the record. A deletion that auth made a second ago can
  # be in flight on the stream, so a number above 0 is printed and not refused.
  # shellcheck disable=SC2086
  if out="$($cmd --count 2> "$ERR")"; then
    echo "  $svc: ids auth does not know after the run: $(unknown_of "$out")"
  fi
done
