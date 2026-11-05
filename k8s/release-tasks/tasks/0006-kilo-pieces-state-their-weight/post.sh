#!/usr/bin/env bash
#
# After the rollout, so that catalog stores `approxWeight`, the harvester's
# queue rows have their `approxWeight` column, and the harvester pod carries
# the command: correct the products that hold the weight of a piece as a fixed
# size, and split the products that hold two Mercadona pieces (backend plan
# 0244, section 7). It runs `node kilo-pieces.js` inside the harvester pod. The
# command selects the queue rows in the harvester's database, asks catalog for
# their products, and sends an ordinary item update (or create) for each one,
# with the harvester's actor: one catalog transaction per product, audited and
# refused by the same rules as any edit. No price changes. The dumps that the
# runner took before `helm upgrade` are the way back.
#
# It counts first, with `--count`, and refuses above MAX_KILO, MAX_PIECE or
# MAX_SPLIT of this environment (task.env) before it changes anything. It then
# passes the same ceilings as `--max-kilo`, `--max-piece` and `--max-split`, so
# the command refuses too if a count grew in between.
#
# It refuses where the harvester deployment's pod has no `kilo-pieces.js`: the
# rollout did not happen there. The runner then leaves the task at `pre-done`,
# and the next deploy runs this file again.
#
# Safe to run again. A product it converted no longer matches its selection,
# and a product it split holds one Mercadona row. A piece priced as one whose
# product was converted and whose queue row was not is counted under `rows`,
# and the next run writes the row alone. A split that created a product and
# failed before it moved the row is finished by the next run: the create named
# the row in `createdFromEntry`, catalog answers that product to
# `item.findCreatedFromEntry`, and the row is bound to it instead of to a
# second one, on a line that starts with `adopted`. It does nothing where
# there is no harvester deployment.
#
# Environment overrides:
#   NAMESPACE    kubernetes namespace (default: luna-shopper)
#   KILO_PIECES  command that runs kilo-pieces.js of the harvester
#
# The override is for a rehearsal against a local stack. Run it only on
# databases that you made for the rehearsal. The command's environment must
# hold HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID:
#   ENVIRONMENT=staging \
#     KILO_PIECES='node dist/apps/luna-shopper-backend-harvester/kilo-pieces.js' \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="${NAMESPACE:-luna-shopper}"
SVC=luna-shopper-backend-harvester

# What a command wrote to stderr is kept aside and never read as its answer.
ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

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
    echo "  cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'" >&2
    exit 1
    ;;
esac

ceiling_of() {
  local field="MAX_${1}_${suffix}" value
  value="${!field}"
  value="${value%$'\r'}"
  case "$value" in '' | *[!0-9]*)
    echo "  task.env states no ceiling for $ENVIRONMENT: $field is '$value', which is not a number" >&2
    return 1
    ;;
  esac
  printf '%s' "$value"
}
if ! max_kilo="$(ceiling_of KILO)"; then exit 1; fi
if ! max_piece="$(ceiling_of PIECE)"; then exit 1; fi
if ! max_split="$(ceiling_of SPLIT)"; then exit 1; fi

# Prints the command that runs kilo-pieces.js in the harvester, or `absent`
# when there is no harvester deployment. A pod without the file is a refusal.
command_for() {
  local deploy answer
  if [ -n "${KILO_PIECES:-}" ]; then
    printf '%s' "$KILO_PIECES"
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
  if ! $run test -f kilo-pieces.js 2> "$ERR"; then
    echo "  the harvester pod runs no kilo-pieces.js, so the rollout of this release" >&2
    echo "  did not happen there. Nothing was changed. Deploy again to finish this task. $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s node kilo-pieces.js' "$run"
}

# Prints the number on the line `<group> <n>` of a run's output.
count_of() {
  printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1 \\([0-9][0-9]*\\)\$/\\1/p" | tail -n 1
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
kilo="$(count_of kilo "$out")"
piece="$(count_of piece "$out")"
split="$(count_of split "$out")"
rows="$(count_of rows "$out")"
if [ -z "$kilo" ] || [ -z "$piece" ] || [ -z "$split" ] || [ -z "$rows" ]; then
  echo "  the count printed no number for every group: '$out'" >&2
  exit 1
fi
printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'

refused=0
if [ "$kilo" -gt "$max_kilo" ]; then
  echo "  $kilo sized pieces sold by the kilo, above the ceiling of $max_kilo." >&2
  refused=1
fi
if [ "$piece" -gt "$max_piece" ]; then
  echo "  $piece sized pieces priced as one, above the ceiling of $max_piece." >&2
  refused=1
fi
if [ "$split" -gt "$max_split" ]; then
  echo "  $split products with two Mercadona pieces, above the ceiling of $max_split." >&2
  refused=1
fi
if [ "$refused" -ne 0 ]; then
  echo "  Nothing was changed." >&2
  exit 1
fi
if [ "$kilo" -eq 0 ] && [ "$piece" -eq 0 ] && [ "$split" -eq 0 ] && [ "$rows" -eq 0 ]; then
  echo "  every kilo piece is already corrected, so nothing to change"
  exit 0
fi

echo "  correcting $kilo kilo pieces, $piece pieces priced as one and $split merged products"
# shellcheck disable=SC2086
if ! out="$($cmd --max-kilo "$max_kilo" --max-piece "$max_piece" --max-split "$max_split" 2> "$ERR")"; then
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  echo "  the run failed: $(cat "$ERR")" >&2
  echo "  Each product is its own transaction, so the products before the failure are done" >&2
  echo "  and the rest are not. The next deploy runs this file again and finishes them." >&2
  exit 1
fi
printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'

# The products a split bound to a product that an earlier, interrupted run had
# created (plan 0244, section 7.4).
adopted="$(printf '%s\n' "$out" | tr -d '\r' | grep '^adopted ' || true)"
if [ -n "$adopted" ]; then
  echo "  rows bound to a product an earlier run of this task created:"
  printf '%s\n' "$adopted" | sed 's/^/    /'
fi

# Counted again for the record. `unweighed` is what the next Mercadona run
# fills (7.3), so a number above 0 is printed and not refused.
# shellcheck disable=SC2086
if out="$($cmd --count 2> "$ERR")"; then
  echo "  after the run: kilo=$(count_of kilo "$out") piece=$(count_of piece "$out") split=$(count_of split "$out") rows=$(count_of rows "$out"), unweighed=$(count_of unweighed "$out")"
fi
