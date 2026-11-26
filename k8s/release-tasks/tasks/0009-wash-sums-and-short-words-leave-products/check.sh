#!/usr/bin/env bash
#
# What this task expects of the data (backend plan 0279, section 4.2): at most
# MAX_PRODUCTS_<ENVIRONMENT> products whose size is a wash count printed as a
# sum (`35+18 lavados`, `30+6lav`) or as El Jamón's short word (`40lav`,
# `60lv`), and no such row whose count is not a whole number above 0. It only
# reads: `node wash-sizes.js --selection sum-and-short-word --count` inside the
# harvester pod selects the rows, asks catalog for their products, and prints
# counts, never a product.
#
# The selection is disjoint from task 0007's (`40 lavados`), so this count does
# not depend on task 0007 having run on this cluster: the check phase runs for
# every due task before any task writes.
#
# It exits 0 when the data is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to
# change: no harvester deployment, or `products 0`. The second is also how the
# task finds its own earlier run, because a corrected product has no size and
# no longer matches the selection.
#
# It passes, too, where the pod has no `wash-sizes.js`, or one that does not
# know `--selection` (it answers with its usage). This file runs before
# `helm upgrade`, and the release that carries the task is the one that adds
# the selection. post.sh runs after the rollout, counts again, and refuses
# above the ceiling.
#
# Anything else it cannot read is a refusal: a ceiling that is not a number, a
# deployment that cannot be looked up, a command that fails or prints no count.
#
# Environment overrides:
#   NAMESPACE    kubernetes namespace (default: luna-shopper)
#   WASH_SIZES   command that runs wash-sizes.js of the harvester
#
# The override is for a rehearsal against a local stack. The command gets the
# arguments appended, and its environment must hold HARVESTER_DB_URL, NATS_URL
# and HARVESTER_ACTOR_ID, with a catalog on that NATS that knows the actor as a
# service:
#   ENVIRONMENT=staging \
#     WASH_SIZES='node dist/apps/luna-shopper-backend-harvester/wash-sizes.js' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"
SVC=luna-shopper-backend-harvester
# The selection of this task, appended to every run of the command.
SELECTION='--selection sum-and-short-word'

# What a command wrote to stderr is kept aside and never read as its answer. It
# is printed only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Cleared first, so that a variable of the caller's shell cannot stand in for a
# ceiling that task.env does not state.
MAX_PRODUCTS_STAGING=''
MAX_PRODUCTS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) field=MAX_PRODUCTS_STAGING ;;
  production) field=MAX_PRODUCTS_PRODUCTION ;;
  *)
    echo "$NUMBER cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'"
    exit 1
    ;;
esac
max="${!field}"
# A checkout with CRLF line endings leaves a carriage return on the value.
max="${max%$'\r'}"
case "$max" in '' | *[!0-9]*)
  echo "$NUMBER states no ceiling: $field is '$max', which is not a number"
  exit 1
  ;;
esac

# Prints the command that runs wash-sizes.js in the harvester, `absent` when
# there is no harvester deployment, or `old` when its pod has no such file.
command_for() {
  local deploy answer
  if [ -n "${WASH_SIZES:-}" ]; then
    printf '%s' "$WASH_SIZES"
    return 0
  fi
  # A missing kubectl answers "command not found", which would read as no
  # deployment below.
  if ! command -v kubectl > /dev/null 2>&1; then
    echo "$NUMBER cannot read the cluster: kubectl is not on the PATH" >&2
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
    echo "$NUMBER cannot look up $deploy: $answer" >&2
    return 1
  fi
  local run="kubectl -n $NAMESPACE exec $deploy -c $SVC --"
  # shellcheck disable=SC2086
  if ! $run test -f wash-sizes.js 2> "$ERR"; then
    answer="$(cat "$ERR")"
    # `test` answered no, which kubectl reports as exit code 1. Anything else
    # is a pod that could not be reached.
    case "$answer" in '' | *'exit code 1'*)
      printf 'old'
      return 0
      ;;
    esac
    echo "$NUMBER cannot read the harvester pod: $answer" >&2
    return 1
  fi
  printf '%s node wash-sizes.js' "$run"
}

# Prints the number on the line `<group> <n>` of the command's output.
count_of() {
  printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1 \\([0-9][0-9]*\\)\$/\\1/p" | tail -n 1
}

later="The harvester pod runs no wash-sizes.js that knows this selection before this release, and post.sh counts after the rollout"

if ! cmd="$(command_for)"; then exit 1; fi
case "$cmd" in
  absent)
    echo "$NUMBER has nothing to change: there is no harvester deployment"
    exit 0
    ;;
  old)
    echo "$NUMBER would take the wash count off at most $max products. $later"
    exit 0
    ;;
esac

# shellcheck disable=SC2086
if ! out="$($cmd --count $SELECTION 2> "$ERR")"; then
  # A command of an earlier release refuses the flag with its usage, before it
  # reads anything. That is the one failure that passes.
  case "$(cat "$ERR")" in *'usage: node wash-sizes.js'*)
    echo "$NUMBER would take the wash count off at most $max products. $later"
    exit 0
    ;;
  esac
  echo "$NUMBER cannot count the products sized by a sum or a short wash word: $(cat "$ERR") $out"
  exit 1
fi
products="$(count_of products "$out")"
unread="$(count_of unread "$out")"
content="$(count_of content "$out")"
if [ -z "$products" ] || [ -z "$unread" ]; then
  echo "$NUMBER cannot count the products sized by a sum or a short wash word: the command printed '$out'"
  exit 1
fi

if [ "$unread" -gt 0 ]; then
  echo "$NUMBER expects every sum and short wash word to be a whole number above 0, and found $unread rows that are not"
  exit 1
fi
if [ "$products" -gt "$max" ]; then
  echo "$NUMBER expects at most $max products sized by a sum or a short wash word, and found $products"
  exit 1
fi

echo "$NUMBER would take the wash count off $products products (ceiling $max): content=${content:-?}"
