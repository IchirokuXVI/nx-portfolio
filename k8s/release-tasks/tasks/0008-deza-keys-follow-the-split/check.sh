#!/usr/bin/env bash
#
# What this task expects of the data (backend plan 0272, section 6.3): at most
# MAX_MOVES_<ENVIRONMENT> stored DEZA walk rows whose key the deployed split no
# longer builds, at most MAX_UNKEYED_<ENVIRONMENT> walk rows whose key their
# own text does not build, and at most MAX_COLLISIONS_<ENVIRONMENT> moved rows
# whose new key another row already holds. It only reads: `node deza-keys.js
# --count` inside the harvester pod prints counts, never a row.
#
# It exits 0 when the data is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to
# change: no harvester deployment, or `moves 0`. The second is also how the
# task finds its own earlier run, because a re-keyed row holds the key its
# text builds and no longer moves.
#
# It passes, too, where the pod does not have `deza-keys.js` yet. This file
# runs before `helm upgrade`, and the release that carries the task is the one
# that adds the command. post.sh runs after the rollout, counts again, and
# refuses above the ceilings.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a
# deployment that cannot be looked up, a command that fails or prints no count.
#
# Environment overrides:
#   NAMESPACE    kubernetes namespace (default: luna-shopper)
#   DEZA_KEYS    command that runs deza-keys.js of the harvester
#
# The override is for a rehearsal against a local stack. The command gets the
# arguments appended, and its environment must hold HARVESTER_DB_URL:
#   ENVIRONMENT=staging \
#     DEZA_KEYS='node dist/apps/luna-shopper-backend-harvester/deza-keys.js' \
#     bash check.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"
SVC=luna-shopper-backend-harvester

# What a command wrote to stderr is kept aside and never read as its answer. It
# is printed only when the command fails.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# Cleared first, so that a variable of the caller's shell cannot stand in for a
# ceiling that task.env does not state.
MAX_MOVES_STAGING=''
MAX_MOVES_PRODUCTION=''
MAX_UNKEYED_STAGING=''
MAX_UNKEYED_PRODUCTION=''
MAX_COLLISIONS_STAGING=''
MAX_COLLISIONS_PRODUCTION=''
# shellcheck disable=SC1091
. "$HERE/task.env"
case "${ENVIRONMENT:-}" in
  staging) suffix=STAGING ;;
  production) suffix=PRODUCTION ;;
  *)
    echo "$NUMBER cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'"
    exit 1
    ;;
esac

# Prints the ceiling of one group for this environment, or refuses.
ceiling() {
  local field="MAX_$1_$suffix" value
  value="${!field}"
  # A checkout with CRLF line endings leaves a carriage return on the value.
  value="${value%$'\r'}"
  case "$value" in '' | *[!0-9]*)
    echo "$NUMBER states no ceiling: $field is '$value', which is not a number" >&2
    return 1
    ;;
  esac
  printf '%s' "$value"
}
if ! max_moves="$(ceiling MOVES)"; then exit 1; fi
if ! max_unkeyed="$(ceiling UNKEYED)"; then exit 1; fi
if ! max_collisions="$(ceiling COLLISIONS)"; then exit 1; fi

# Prints the command that runs deza-keys.js in the harvester, `absent` when
# there is no harvester deployment, or `old` when its pod has no such file.
command_for() {
  local deploy answer
  if [ -n "${DEZA_KEYS:-}" ]; then
    printf '%s' "$DEZA_KEYS"
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
  if ! $run test -f deza-keys.js 2> "$ERR"; then
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
  printf '%s node deza-keys.js' "$run"
}

# Prints the number on the line `<group> <n>` of the command's output.
count_of() {
  printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1 \\([0-9][0-9]*\\)\$/\\1/p" | tail -n 1
}

if ! cmd="$(command_for)"; then exit 1; fi
case "$cmd" in
  absent)
    echo "$NUMBER has nothing to change: there is no harvester deployment"
    exit 0
    ;;
  old)
    echo "$NUMBER would re-key at most $max_moves DEZA rows. The harvester pod runs no deza-keys.js before this release, and post.sh counts after the rollout"
    exit 0
    ;;
esac

# shellcheck disable=SC2086
if ! out="$($cmd --count 2> "$ERR")"; then
  echo "$NUMBER cannot count the DEZA rows to re-key: $(cat "$ERR") $out"
  exit 1
fi
rows="$(count_of rows "$out")"
moves="$(count_of moves "$out")"
unkeyed="$(count_of unkeyed "$out")"
collisions="$(count_of collisions "$out")"
if [ -z "$rows" ] || [ -z "$moves" ] || [ -z "$unkeyed" ] || [ -z "$collisions" ]; then
  echo "$NUMBER cannot count the DEZA rows to re-key: the command printed '$out'"
  exit 1
fi

if [ "$unkeyed" -gt "$max_unkeyed" ]; then
  echo "$NUMBER expects at most $max_unkeyed DEZA walk rows whose key their text does not build, and found $unkeyed"
  exit 1
fi
if [ "$collisions" -gt "$max_collisions" ]; then
  echo "$NUMBER expects at most $max_collisions moved DEZA rows whose new key another row holds, and found $collisions"
  exit 1
fi
if [ "$moves" -gt "$max_moves" ]; then
  echo "$NUMBER expects at most $max_moves DEZA rows to re-key, and found $moves"
  exit 1
fi

echo "$NUMBER would re-key $moves of $rows DEZA walk rows (ceiling $max_moves): active=$(count_of moves-active "$out") unresolved=$(count_of moves-unresolved "$out") other=$(count_of moves-other "$out") collisions=$collisions unkeyed=$unkeyed"
