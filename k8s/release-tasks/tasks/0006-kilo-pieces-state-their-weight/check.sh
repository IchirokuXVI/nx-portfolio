#!/usr/bin/env bash
#
# What this task expects of the data (backend plan 0244, section 7.5): at most
# MAX_KILO_<ENVIRONMENT> sized Mercadona pieces sold by the kilo (7.1), at most
# MAX_PIECE_<ENVIRONMENT> sized pieces priced as one (7.2, Mercadona and LIDL
# together), and at most MAX_SPLIT_<ENVIRONMENT> products that hold two or more
# Mercadona pieces (7.4). It only reads: `node kilo-pieces.js --count` inside
# the harvester pod selects the queue rows, asks catalog for their products,
# and prints one count per group.
#
# It exits 0 when the data is what the task was written for, and prints the
# reason and exits 1 when it is not. It passes where there is nothing to change:
# no harvester deployment, or three counts of 0. The second is also how the
# task finds its own earlier run, because a product it converted or split no
# longer matches any selection.
#
# It passes, too, where the pod does not have `kilo-pieces.js` yet. This file
# runs before `helm upgrade`, and the release that carries the task is the one
# that adds the command and the catalog columns it writes. A check that asked
# for them would refuse the deploy that brings them. post.sh runs after the
# rollout, counts again, and refuses above the ceilings.
#
# Anything it cannot read is a refusal: a ceiling that is not a number, a
# deployment that cannot be looked up, a command that fails or prints no count.
#
# Environment overrides:
#   NAMESPACE    kubernetes namespace (default: luna-shopper)
#   KILO_PIECES  command that runs kilo-pieces.js of the harvester
#
# The override is for a rehearsal against a local stack. The command gets the
# arguments appended, and its environment must hold HARVESTER_DB_URL, NATS_URL
# and HARVESTER_ACTOR_ID, with a catalog on that NATS that knows the actor as a
# service:
#   ENVIRONMENT=staging \
#     KILO_PIECES='node dist/apps/luna-shopper-backend-harvester/kilo-pieces.js' \
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
MAX_KILO_STAGING=''
MAX_KILO_PRODUCTION=''
MAX_PIECE_STAGING=''
MAX_PIECE_PRODUCTION=''
MAX_SPLIT_STAGING=''
MAX_SPLIT_PRODUCTION=''
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

# Prints the ceiling task.env states for one group in this environment.
ceiling_of() {
  local field="MAX_${1}_${suffix}" value
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
if ! max_kilo="$(ceiling_of KILO)"; then exit 1; fi
if ! max_piece="$(ceiling_of PIECE)"; then exit 1; fi
if ! max_split="$(ceiling_of SPLIT)"; then exit 1; fi

# Prints the command that runs kilo-pieces.js in the harvester, `absent` when
# there is no harvester deployment, or `old` when its pod has no such file.
command_for() {
  local deploy answer
  if [ -n "${KILO_PIECES:-}" ]; then
    printf '%s' "$KILO_PIECES"
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
  if ! $run test -f kilo-pieces.js 2> "$ERR"; then
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
  printf '%s node kilo-pieces.js' "$run"
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
    echo "$NUMBER would correct the kilo pieces (at most $max_kilo, $max_piece and $max_split). The harvester pod runs no kilo-pieces.js before this release, and post.sh counts after the rollout"
    exit 0
    ;;
esac

# shellcheck disable=SC2086
if ! out="$($cmd --count 2> "$ERR")"; then
  echo "$NUMBER cannot count the kilo pieces: $(cat "$ERR") $out"
  exit 1
fi
kilo="$(count_of kilo "$out")"
piece="$(count_of piece "$out")"
split="$(count_of split "$out")"
unweighed="$(count_of unweighed "$out")"
if [ -z "$kilo" ] || [ -z "$piece" ] || [ -z "$split" ]; then
  echo "$NUMBER cannot count the kilo pieces: the command printed '$out'"
  exit 1
fi

refused=''
if [ "$kilo" -gt "$max_kilo" ]; then
  refused="$refused; at most $max_kilo sized pieces sold by the kilo, and found $kilo"
fi
if [ "$piece" -gt "$max_piece" ]; then
  refused="$refused; at most $max_piece sized pieces priced as one, and found $piece"
fi
if [ "$split" -gt "$max_split" ]; then
  refused="$refused; at most $max_split products with two Mercadona pieces, and found $split"
fi
if [ -n "$refused" ]; then
  echo "$NUMBER expects${refused#;}"
  exit 1
fi

echo "$NUMBER would correct the kilo pieces: kilo=$kilo piece=$piece split=$split (ceilings $max_kilo, $max_piece, $max_split), and ${unweighed:-?} kilo pieces wait for a weight from the next run"
