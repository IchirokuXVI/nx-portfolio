#!/usr/bin/env bash
#
# After the rollout, so that the harvester pod carries the command: take the
# wash count off every product whose size is a wash count printed as a sum
# (`35+18 lavados`, `30+6lav`) or as El Jamón's short word (`40lav`, `60lv`)
# (backend plan 0279). It runs
# `node wash-sizes.js --selection sum-and-short-word` inside the harvester pod,
# the command of task 0007 with this task's selection, which is disjoint from
# task 0007's: neither depends on the other having run. No pack count is
# cleared, because neither shape prints a pack. The command selects the rows in the harvester's database, asks catalog for
# their products, and sends an ordinary item update for each one with the
# harvester's actor: one catalog transaction per product, audited and refused
# by the same rules as any edit. No price changes and nothing is deleted. The
# dump of catalog that the runner took before `helm upgrade` is the way back.
#
# It counts first, with `--count`, and refuses above MAX_PRODUCTS of this
# environment (task.env) before it changes anything. It then passes the same
# ceiling as `--max`, so the command refuses too if the count grew in between.
#
# The run writes the review list (plan 0271, section 5, with the columns of
# task 0007) to a file inside the pod, and the notes beside it: the rows that
# look like a wash count and that the task does not correct, one line per row
# and kind (`pack-of-units` and `mercadona-per-wash` only). This file copies both
# into the ConfigMap `release-task-<NNNN>-review` of the namespace, keys
# `review.tsv` and `notes.tsv`, through `kubectl apply --server-side`, so a second run replaces the object and never stacks a copy.
# Server side, because a client side apply also copies the whole object into
# the `last-applied-configuration` annotation, and an annotation is capped at
# 256 KiB, far below the 1 MiB a ConfigMap holds.
#
# A list never loses a line that an earlier run saved. This file reads the
# ConfigMap as it stands before the run and hands it to the command
# (`--recorded -`, on standard input), and the command keeps every line it
# holds, with the old size it recorded, adding only lines it does not hold yet
# (`mergeList` in the harvester, which the specs prove). The review list's last
# column, `outcome`, says where a line stands. `corrected`: the product's wash
# count was taken off. `planned`: the task meant to correct this product and
# has no confirmation that it did, so check the product. A run can correct a
# product and not learn it (it stops before it writes its lists, the save
# after it fails, an answer times out), so a later run confirms each planned
# line by reading its product: a product catalog now holds as `UNIT` with no
# size turns the line `corrected`. A planned line whose product holds any
# size, or that catalog lacks or merged, stays `planned`. A `corrected` line
# never goes back. A run that fails after correcting some products and the run
# that finishes them thus leave every product on the list, once, with its
# outcome. It prints line counts and the ConfigMap's name, never a line of
# either list: the deploy log is public.
#
# A ConfigMap whose keys do not start with this task's headers (an earlier
# shape of the task, or a file of an earlier rehearsal) is refused before any
# write. Delete it, or restore its headers, and run again.
# Nothing deletes that ConfigMap; the owner does when the curator has worked
# through it.
#
# It refuses where the harvester deployment's pod has no `wash-sizes.js`, or
# one that does not know `--selection` (it answers with its usage): the
# rollout did not happen there. The runner then leaves the task at
# `pre-done`, and the next deploy runs this file again.
#
# Safe to run again. A corrected product has no size, so it no longer matches
# the selection, and a second run counts 0 and corrects nothing. With nothing
# to correct it still saves the lists when a recorded line is `planned` (to
# confirm it) or this run found a note the ConfigMap does not hold, and
# otherwise writes nothing. It does nothing where there is no harvester
# deployment.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: luna-shopper)
#   WASH_SIZES    command that runs wash-sizes.js of the harvester
#   REVIEW_APPLY  command that receives the ConfigMap's JSON on stdin
#                 (default: kubectl -n <namespace> apply --server-side
#                 --force-conflicts --field-manager=release-task-<NNNN> -f -)
#   REVIEW_GET    command that prints the ConfigMap as JSON, or nothing when
#                 there is none (default: kubectl -n <namespace> get
#                 configmap <name> -o json, where NotFound prints nothing)
#
# The overrides are for a rehearsal against a local stack. Run it only on
# databases that you made for the rehearsal. With WASH_SIZES set the command
# runs on this machine, so its lists are written and read here. Its
# environment must hold HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID.
# The ConfigMap is read once, before anything is saved, so one file can stand
# for it, and a second rehearsal run reads what the first saved:
#   touch configmap.json
#   ENVIRONMENT=staging \
#     WASH_SIZES='node dist/apps/luna-shopper-backend-harvester/wash-sizes.js' \
#     REVIEW_GET='cat configmap.json' \
#     REVIEW_APPLY='tee configmap.json' \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"
SVC=luna-shopper-backend-harvester
CONFIGMAP="release-task-$NUMBER-review"
# The selection of this task, appended to every run of the command.
SELECTION='--selection sum-and-short-word'

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
# The same command with standard input attached, for the runs that read the
# recorded lists. Only those get it, so no other run waits on this shell's
# input.
if [ -n "${WASH_SIZES:-}" ]; then
  cmd_in="$cmd"
else
  cmd_in="kubectl -n $NAMESPACE exec -i deploy/$SVC -c $SVC -- node wash-sizes.js"
fi

# shellcheck disable=SC2086
if ! out="$($cmd --count $SELECTION 2> "$ERR")"; then
  # A command of an earlier release refuses the flag with its usage, before it
  # reads anything: the rollout of this release did not happen there.
  case "$(cat "$ERR")" in *'usage: node wash-sizes.js'*)
    echo "  the harvester pod runs a wash-sizes.js that does not know this selection, so the" >&2
    echo "  rollout of this release did not happen there. Nothing was changed. Deploy again to finish this task." >&2
    exit 1
    ;;
  esac
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
  echo "  $unread rows print a sum or a short wash word that is not a whole number above 0. Nothing was changed." >&2
  exit 1
fi
if [ "$products" -gt "$max" ]; then
  echo "  $products products sized by a sum or a short wash word, above the ceiling of $max. Nothing was changed." >&2
  exit 1
fi
# The pod's /tmp, or a directory of this machine for a rehearsal.
if [ -n "${WASH_SIZES:-}" ]; then
  list="$WORK/run-review.tsv"
else
  list="/tmp/$CONFIGMAP.tsv"
fi
notes="${list%.tsv}.notes.tsv"

# Prints the ConfigMap as earlier runs left it, as JSON, or nothing when there
# is none. Anything else it cannot read is a refusal: a list that could not be
# read must never be replaced by one that forgot it.
recorded_lists() {
  if [ -n "${REVIEW_GET:-}" ]; then
    $REVIEW_GET
    return
  fi
  local answer
  if answer="$(kubectl -n "$NAMESPACE" get configmap "$CONFIGMAP" -o json 2> "$ERR")"; then
    printf '%s\n' "$answer"
    return 0
  fi
  case "$(cat "$ERR")" in *NotFound* | *'not found'*) return 0 ;; esac
  echo "  cannot read the ConfigMap $CONFIGMAP: $(cat "$ERR")" >&2
  return 1
}

# Saves both lists the command wrote in the ConfigMap, replacing the object,
# and prints their line counts. Never a line of either. The command already
# merged in every line the ConfigMap held before the run.
save_lists() {
  fetch "$list" "$WORK/review.tsv"
  fetch "$notes" "$WORK/notes.tsv"
  kubectl create configmap "$CONFIGMAP" -n "$NAMESPACE" \
    --from-file=review.tsv="$WORK/review.tsv" \
    --from-file=notes.tsv="$WORK/notes.tsv" \
    --dry-run=client -o json \
    | ${REVIEW_APPLY:-kubectl -n "$NAMESPACE" apply --server-side --force-conflicts --field-manager="release-task-$NUMBER" -f -} > /dev/null
  # Each list has a header line, which is not a product. Only the last column
  # of the review list and the first of the notes are counted: an outcome and
  # a kind, which name nothing.
  local lines planned corrected noted kinds
  lines=$(($(wc -l < "$WORK/review.tsv") - 1))
  planned="$(awk -F '\t' 'NR > 1 && $NF == "planned"' "$WORK/review.tsv" | wc -l | tr -d ' ')"
  corrected="$(awk -F '\t' 'NR > 1 && $NF == "corrected"' "$WORK/review.tsv" | wc -l | tr -d ' ')"
  noted=$(($(wc -l < "$WORK/notes.tsv") - 1))
  kinds="$(awk -F '\t' 'NR > 1 && $1 ~ /^[a-z-]+$/ { n[$1]++ } END { for (k in n) printf " %s=%d", k, n[k] }' "$WORK/notes.tsv")"
  echo "  $1: the review list holds $lines lines (planned=$planned corrected=$corrected) and the notes $noted lines${kinds:+ (${kinds# })}, in the ConfigMap $CONFIGMAP"
}

# What earlier runs saved, read once, before this run saves anything. Both
# runs below merge into this. The write run lists every product it counted,
# so the `planned` lines of the first are in its list too, as `corrected`
# where the update went through.
recorded="$WORK/recorded.json"
if ! recorded_lists > "$recorded"; then
  echo "  Nothing was changed." >&2
  exit 1
fi

# With nothing to correct, the lists are still written once: the command
# confirms each recorded `planned` line by reading its product, and adds the
# notes this run found. It prints `save 1` when there is something to keep (a
# recorded `planned` line, or a note the ConfigMap does not hold yet), and
# only then is the ConfigMap replaced. Otherwise an earlier one stays as it is.
if [ "$products" -eq 0 ]; then
  echo "  no product holds a sum or a short wash word as its size, so nothing to change"
  # shellcheck disable=SC2086
  if ! out="$($cmd_in --review "$list" --recorded - $SELECTION < "$recorded" 2> "$ERR")"; then
    echo "  the lists could not be written, and nothing was changed: $(cat "$ERR")" >&2
    exit 1
  fi
  save="$(count_of save "$out")"
  if [ -z "$save" ]; then
    echo "  the review run printed no answer to whether the lists are saved" >&2
    exit 1
  fi
  if [ "$save" -gt 0 ]; then
    save_lists "with nothing to correct"
  fi
  exit 0
fi

# The list of what is about to change goes in first, every line `planned`. A
# run that stops after its writes and before its own list is saved thus still
# leaves every product it may have corrected on the list, with its old size.
# shellcheck disable=SC2086
if ! out="$($cmd_in --review "$list" --recorded - $SELECTION < "$recorded" 2> "$ERR")"; then
  echo "  the review list could not be written, and nothing was changed: $(cat "$ERR")" >&2
  exit 1
fi
save_lists "before the run"

echo "  taking the wash count off $products products"
# shellcheck disable=SC2086
if ! out="$($cmd_in --max "$max" --review "$list" --recorded - $SELECTION < "$recorded" 2> "$ERR")"; then
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  echo "  the run failed: $(cat "$ERR")" >&2
  echo "  Each product is its own transaction, so the products before the failure are done" >&2
  echo "  and the rest are not. The next deploy runs this file again and finishes them." >&2
  failed=1
else
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  failed=0
fi

# A run that printed `corrected` finished its loop and wrote its list: every
# line earlier runs saved, and every product it counted, `corrected` where its
# update was answered and `planned` where it was not. That replaces the list
# above. A run that printed no `corrected` stopped before its list, so the
# list above stays, every line of this run `planned`, and the next run
# confirms those lines by reading their products.
corrected="$(count_of corrected "$out")"
if [ -n "$corrected" ]; then
  save_lists "after the run"
fi

# Counted again for the record.
# shellcheck disable=SC2086
if out="$($cmd --count $SELECTION 2> "$ERR")"; then
  echo "  after the run: products=$(count_of products "$out") content=$(count_of content "$out")"
fi
exit "$failed"
