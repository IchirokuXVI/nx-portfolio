#!/usr/bin/env bash
#
# What this task expects of the data: at most MAX_UNKNOWN_IDS_<ENVIRONMENT> user
# ids in core, and as many in catalog, that auth no longer knows (task.env,
# backend plan 0232 section 7). It only reads: `node reconcile-deletions.js
# --count` inside each pod collects the ids, asks auth `auth.existingUserIds`,
# and prints `unknown <n>`.
#
# It exits 0 when the data is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change:
# no deployment of the service, or no id that auth does not know. The second is
# also how the task finds its own earlier run, because that run replaced every
# such id with a tombstone, and a tombstone is no candidate.
#
# It passes, too, where the pod does not have `reconcile-deletions.js` yet. This
# file runs before `helm upgrade`, and the release that carries the task is the
# one that adds the command and the auth subject it asks. A check that asked
# for them would refuse the deploy that brings them. post.sh runs after the
# rollout, counts again, and refuses above the ceiling.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a
# deployment that cannot be looked up, a command that fails or prints no count.
#
# Environment overrides:
#   NAMESPACE          kubernetes namespace (default: luna-shopper)
#   CORE_RECONCILE     command that runs reconcile-deletions.js of core
#   CATALOG_RECONCILE  command that runs reconcile-deletions.js of catalog
#
# The overrides are for a rehearsal against a local stack. Each command gets
# the arguments appended, and its environment must hold the service's database
# URL and NATS_URL:
#   ENVIRONMENT=staging \
#     CORE_RECONCILE='node dist/apps/luna-shopper-backend-core/reconcile-deletions.js' \
#     CATALOG_RECONCILE='node dist/apps/luna-shopper-backend-catalog/reconcile-deletions.js' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"

# What a command wrote to stderr is kept aside and never read as its answer. It
# is printed only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Cleared first, so that a variable of the caller's shell cannot stand in for a
# ceiling that task.env does not state.
MAX_UNKNOWN_IDS_STAGING=''
MAX_UNKNOWN_IDS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) ceiling="$MAX_UNKNOWN_IDS_STAGING" field=MAX_UNKNOWN_IDS_STAGING ;;
  production) ceiling="$MAX_UNKNOWN_IDS_PRODUCTION" field=MAX_UNKNOWN_IDS_PRODUCTION ;;
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

# Prints the command that runs reconcile-deletions.js in a service, `absent`
# when the service has no deployment, or `old` when its pod has no such file.
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
    echo "$NUMBER cannot look up $deploy: $answer" >&2
    return 1
  fi
  local run="kubectl -n $NAMESPACE exec $deploy -c luna-shopper-backend-$svc --"
  # shellcheck disable=SC2086
  if ! $run test -f reconcile-deletions.js 2> "$ERR"; then
    answer="$(cat "$ERR")"
    # `test` answered no, which kubectl reports as exit code 1. Anything else
    # is a pod that could not be reached.
    case "$answer" in '' | *'exit code 1'*)
      printf 'old'
      return 0
      ;;
    esac
    echo "$NUMBER cannot read the $svc pod: $answer" >&2
    return 1
  fi
  printf '%s node reconcile-deletions.js' "$run"
}

# Prints how many ids of a service auth does not know.
unknown_in() {
  local svc="$1" cmd="$2" out found
  # shellcheck disable=SC2086
  if ! out="$($cmd --count 2> "$ERR")"; then
    echo "$NUMBER cannot count the $svc ids auth does not know: $(cat "$ERR") $out" >&2
    return 1
  fi
  found="$(printf '%s\n' "$out" | tr -d '\r' | sed -n 's/^unknown \([0-9][0-9]*\)$/\1/p' | tail -n 1)"
  if [ -z "$found" ]; then
    echo "$NUMBER cannot count the $svc ids auth does not know: the command printed '$out'" >&2
    return 1
  fi
  printf '%s' "$found"
}

summary=''
for svc in core catalog; do
  if ! cmd="$(command_for "$svc")"; then exit 1; fi
  case "$cmd" in
    absent)
      summary="$summary $svc=no-deployment"
      continue
      ;;
    old)
      summary="$summary $svc=not-yet"
      continue
      ;;
  esac
  if ! count="$(unknown_in "$svc" "$cmd")"; then exit 1; fi
  if [ "$count" -gt "$ceiling" ]; then
    echo "$NUMBER expects at most $ceiling ids in $svc that auth does not know, and found $count"
    exit 1
  fi
  summary="$summary $svc=$count"
done

case "$summary" in
  *not-yet*)
    echo "$NUMBER would unlink the deleted accounts (at most $ceiling per service):${summary}. A service marked not-yet runs no reconcile-deletions.js before this release, and post.sh counts it after the rollout"
    ;;
  *)
    echo "$NUMBER would unlink the deleted accounts (at most $ceiling per service):${summary}"
    ;;
esac
