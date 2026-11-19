#!/usr/bin/env bash
#
# After the rollout, so that the harvester pod carries the command and the
# split of this release: re-key every stored DEZA walk row whose key the
# deployed split no longer builds (backend plan 0272). It runs `node
# deza-keys.js` inside the harvester pod. The command reads the rows of the
# chain whose source is `deza-web`, builds each row's key again with the same
# `splitSize` and `entryKey` the walk calls, and rewrites the key, the name
# and the size text of each row that moved, in one transaction under a table
# lock. Nothing is deleted or inserted, and no decision, price, availability
# or presence row changes. The dump of the harvester database that the runner
# took before `helm upgrade` is the way back.
#
# It counts first, with `--count`, and refuses above the ceilings of this
# environment (task.env) before it changes anything. While a run of the chain
# is in flight it waits, counting again every 30 seconds, for at most 15
# minutes. It then passes MAX_MOVES as `--max`, so the command refuses too if
# the count grew in between.
#
# The run and its record arrive in one `kubectl exec`. The record of plan 0272
# section 4.1 holds, per re-keyed or skipped row, its id, old key, new key and
# outcome, no name. The command streams it on standard output right after the
# commit, each line behind `record` and a tab, then `record-end <lines>`. This
# file takes those lines out into a file and prints only the count lines. A
# second exec to copy the record out, which could fail after the commit and
# lose it, does not exist.
#
# The record goes into the ConfigMap `release-task-<NNNN>-record` of the
# namespace, key `record.tsv`, through `kubectl apply --server-side`, so a
# second run replaces the object and never stacks a copy. Server side, because
# a client side apply also copies the whole object into the
# `last-applied-configuration` annotation, and an annotation is capped at
# 256 KiB, far below the 1 MiB a ConfigMap holds. It prints the line count and
# the ConfigMap's name, never a line: the deploy log is public. A run that
# re-keyed nothing leaves an earlier record in place. Nothing deletes that
# ConfigMap; the owner does.
#
# A record is kept on this host until the ConfigMap holds it (RECORD_KEEP).
# After the commit the old keys exist nowhere else: a second run counts
# `moves 0` and has nothing to build a record from. So the record is written
# to the keep file before the apply, and removed only after the apply
# succeeded. When the apply fails, this file exits 1, the runner leaves the
# task at `pre-done`, and the next deploy's run writes the kept record into
# the ConfigMap before it counts. The deploy host is the cluster's own VPS,
# and the keep file lies outside the directory the deploy rsyncs with
# --delete. The one case that loses a record is a commit whose stream breaks
# before `record-end` arrives; this file then says so in plain words, and the
# dump of the harvester database still holds the old keys.
#
# It refuses where the harvester deployment's pod has no `deza-keys.js`: the
# rollout did not happen there. The runner then leaves the task at
# `pre-done`, and the next deploy runs this file again.
#
# Safe to run again. A re-keyed row holds the key its text builds, so a second
# run counts `moves 0` and writes nothing. It does nothing where there is no
# harvester deployment.
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace (default: luna-shopper)
#   DEZA_KEYS     command that runs deza-keys.js of the harvester
#   RECORD_APPLY  command that receives the ConfigMap's JSON on stdin
#                 (default: kubectl -n <namespace> apply --server-side
#                 --force-conflicts --field-manager=release-task-<NNNN> -f -)
#   RECORD_KEEP   the file that keeps a record until the ConfigMap holds it
#                 (default: ~/release-task-records/<namespace>-<configmap>.tsv)
#   WAIT_SECONDS  the pause between two counts while a run is in flight
#                 (default: 30), and WAIT_ROUNDS the most counts (default: 30)
#
# The overrides are for a rehearsal against a local stack. Run it only on a
# database that you made for the rehearsal. With DEZA_KEYS set the command
# runs on this machine. Its environment must hold HARVESTER_DB_URL:
#   ENVIRONMENT=staging \
#     DEZA_KEYS='node dist/apps/luna-shopper-backend-harvester/deza-keys.js' \
#     RECORD_APPLY='tee configmap.json' \
#     RECORD_KEEP="$PWD/kept-record.tsv" \
#     bash post.sh

set -euo pipefail
shopt -s inherit_errexit

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NAME="${TASK_NAME:-$(basename "$HERE")}"
NAMESPACE="${NAMESPACE:-luna-shopper}"
NUMBER="${TASK_NAME%%-*}"
SVC=luna-shopper-backend-harvester
CONFIGMAP="release-task-$NUMBER-record"
WAIT_SECONDS="${WAIT_SECONDS:-30}"
WAIT_ROUNDS="${WAIT_ROUNDS:-30}"
if [ -z "${RECORD_KEEP:-}" ] && [ -z "${HOME:-}" ]; then
  echo "  neither RECORD_KEEP nor HOME is set, so a record has nowhere to wait for its ConfigMap. Nothing was changed." >&2
  exit 1
fi
RECORD_KEEP="${RECORD_KEEP:-$HOME/release-task-records/$NAMESPACE-$CONFIGMAP.tsv}"

# What a command wrote to stderr is kept aside and never read as its answer.
ERR="$(mktemp)"
WORK="$(mktemp -d)"
trap 'rm -rf "$ERR" "$WORK"' EXIT

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
    echo "  cannot tell which environment this is: ENVIRONMENT is '${ENVIRONMENT:-}'" >&2
    exit 1
    ;;
esac

ceiling() {
  local field="MAX_$1_$suffix" value
  value="${!field}"
  value="${value%$'\r'}"
  case "$value" in '' | *[!0-9]*)
    echo "  task.env states no ceiling for $ENVIRONMENT: $field is '$value', which is not a number" >&2
    return 1
    ;;
  esac
  printf '%s' "$value"
}
if ! max_moves="$(ceiling MOVES)"; then exit 1; fi
if ! max_unkeyed="$(ceiling UNKEYED)"; then exit 1; fi
if ! max_collisions="$(ceiling COLLISIONS)"; then exit 1; fi

# Prints the command that runs deza-keys.js in the harvester, or `absent`
# when there is no harvester deployment. A pod without the file is a refusal.
command_for() {
  local deploy answer
  if [ -n "${DEZA_KEYS:-}" ]; then
    printf '%s' "$DEZA_KEYS"
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
    # that could not be read must never be recorded as re-keyed.
    echo "  cannot look up $deploy: $answer" >&2
    return 1
  fi
  local run="kubectl -n $NAMESPACE exec $deploy -c $SVC --"
  # shellcheck disable=SC2086
  if ! $run test -f deza-keys.js 2> "$ERR"; then
    echo "  the harvester pod runs no deza-keys.js, so the rollout of this release" >&2
    echo "  did not happen there. Nothing was changed. Deploy again to finish this task. $(cat "$ERR")" >&2
    return 1
  fi
  printf '%s node deza-keys.js' "$run"
}

# Prints the number on the line `<group> <n>` of a run's output.
count_of() {
  printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1 \\([0-9][0-9]*\\)\$/\\1/p" | tail -n 1
}

# Counts, prints the counts and refuses above a ceiling. Leaves the output in
# $out and the numbers in $moves and $active.
count() {
  # shellcheck disable=SC2086
  if ! out="$($cmd --count 2> "$ERR")"; then
    echo "  the count failed, and nothing was changed: $(cat "$ERR") $out" >&2
    return 1
  fi
  moves="$(count_of moves "$out")"
  active="$(count_of active-runs "$out")"
  local unkeyed collisions
  unkeyed="$(count_of unkeyed "$out")"
  collisions="$(count_of collisions "$out")"
  if [ -z "$moves" ] || [ -z "$active" ] || [ -z "$unkeyed" ] || [ -z "$collisions" ]; then
    echo "  the count printed no number of moves: '$out'" >&2
    return 1
  fi
  printf '%s\n' "$out" | tr -d '\r' | sed 's/^/    /'
  if [ "$unkeyed" -gt "$max_unkeyed" ]; then
    echo "  $unkeyed DEZA walk rows hold a key their text does not build, above the ceiling of $max_unkeyed. Nothing was changed." >&2
    return 1
  fi
  if [ "$collisions" -gt "$max_collisions" ]; then
    echo "  $collisions moved DEZA rows have a new key another row holds, above the ceiling of $max_collisions. Nothing was changed." >&2
    return 1
  fi
  if [ "$moves" -gt "$max_moves" ]; then
    echo "  $moves DEZA rows to re-key, above the ceiling of $max_moves. Nothing was changed." >&2
    return 1
  fi
}

# What a failed apply wrote to stderr, with anything shaped like an entry id
# or a key taken out: an error about the object can quote a piece of it.
apply_error() {
  tr -d '\r' < "$ERR" | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{40}/<id or key>/g'
}

# Writes a record file into the ConfigMap, replacing the object, and prints
# its line count. Never a line of it.
save_record() {
  local file="$1" lines
  if ! kubectl create configmap "$CONFIGMAP" -n "$NAMESPACE" \
    --from-file=record.tsv="$file" \
    --dry-run=client -o json \
    | ${RECORD_APPLY:-kubectl -n "$NAMESPACE" apply --server-side --force-conflicts --field-manager="release-task-$NUMBER" -f -} > /dev/null 2> "$ERR"; then
    return 1
  fi
  # The header line is not a row.
  lines=$(($(wc -l < "$file") - 1))
  echo "  $2: the record holds $lines lines, in the ConfigMap $CONFIGMAP"
}

# A record an earlier run kept because its ConfigMap could not be written.
# It goes in first, before anything is counted or changed.
save_kept() {
  [ -f "$RECORD_KEEP" ] || return 0
  if ! save_record "$RECORD_KEEP" "the record an earlier run kept"; then
    echo "  the ConfigMap $CONFIGMAP could not be written: $(apply_error)" >&2
    echo "  The record an earlier run kept stays in $RECORD_KEEP on this host. Nothing was changed." >&2
    return 1
  fi
  rm -f "$RECORD_KEEP"
}

if ! cmd="$(command_for)"; then exit 1; fi
if [ "$cmd" = absent ]; then
  echo "  no harvester deployment, so nothing to re-key"
  exit 0
fi
if ! save_kept; then exit 1; fi

out='' moves='' active=''
if ! count; then exit 1; fi
if [ "$moves" -eq 0 ]; then
  echo "  every stored DEZA key is the key the deployed split builds, so nothing to change"
  exit 0
fi

# Only a leaflet import can be in flight here: the guard refuses a walk while
# a row waits for its key.
round=1
while [ "$active" -gt 0 ]; do
  if [ "$round" -ge "$WAIT_ROUNDS" ]; then
    echo "  $active runs of the chain are still in flight. Nothing was changed. Deploy again to finish this task." >&2
    exit 1
  fi
  echo "  $active runs of the chain are in flight; counting again in $WAIT_SECONDS seconds"
  sleep "$WAIT_SECONDS"
  round=$((round + 1))
  if ! count; then exit 1; fi
done
if [ "$moves" -eq 0 ]; then
  echo "  every stored DEZA key is the key the deployed split builds, so nothing to change"
  exit 0
fi

# The run and its record in one exec. Standard output goes to a file: the
# count lines are printed from it, and the record lines are taken out of it
# into a file of their own and never printed.
echo "  re-keying $moves DEZA rows"
run_out="$WORK/run.out"
record="$WORK/record.tsv"
# shellcheck disable=SC2086
if $cmd --max "$max_moves" --record - > "$run_out" 2> "$ERR"; then
  status=0
else
  status=1
fi
printed="$(sed $'/^record\t/d' "$run_out" | tr -d '\r')"
sed -n $'s/^record\t//p' "$run_out" | tr -d '\r' > "$record"
printf '%s\n' "$printed" | sed 's/^/    /'

committed="$(count_of committed "$printed")"
record_end="$(count_of record-end "$printed")"
whole=false
if [ -n "$record_end" ] && [ "$(wc -l < "$record")" -eq "$record_end" ]; then
  whole=true
fi

if [ -z "$committed" ]; then
  # The command prints `committed` first after the commit: without it,
  # nothing was committed.
  echo "  the run failed: $(cat "$ERR")" >&2
  echo "  One transaction holds every update, so no row was re-keyed. The next deploy" >&2
  echo "  runs this file again." >&2
  exit 1
fi
if [ "$status" -ne 0 ]; then
  echo "  the run committed and then failed: $(cat "$ERR")" >&2
fi

# The record of what the run did replaces the one the ConfigMap held. A run
# that re-keyed nothing leaves it in place.
if [ "$committed" -gt 0 ]; then
  if [ "$whole" != true ]; then
    echo "  The run re-keyed $committed DEZA rows and committed, but its record did not arrive whole." >&2
    echo "  The record of this run is lost: no ConfigMap $CONFIGMAP holds it, and a second run" >&2
    echo "  counts moves 0. The dump of the harvester database taken before helm upgrade" >&2
    echo "  still holds every old key." >&2
    exit 1
  fi
  # Kept on this host first. Once the ConfigMap holds it, the keep file goes.
  kept=false
  if mkdir -p "$(dirname "$RECORD_KEEP")" && (umask 077 && cp "$record" "$RECORD_KEEP"); then
    kept=true
  fi
  if ! save_record "$record" "after the run"; then
    echo "  the ConfigMap $CONFIGMAP could not be written: $(apply_error)" >&2
    if [ "$kept" = true ]; then
      echo "  The run re-keyed $committed DEZA rows and committed. Its record is kept in" >&2
      echo "  $RECORD_KEEP on this host, and the next deploy writes it into the" >&2
      echo "  ConfigMap before anything else." >&2
    else
      echo "  The run re-keyed $committed DEZA rows and committed, and its record could not be" >&2
      echo "  kept on this host either: the record of this run is lost. The dump of the" >&2
      echo "  harvester database taken before helm upgrade still holds every old key." >&2
    fi
    exit 1
  fi
  if [ "$kept" = true ]; then
    rm -f "$RECORD_KEEP"
  fi
fi

# Counted again for the record.
# shellcheck disable=SC2086
if out="$($cmd --count 2> "$ERR")"; then
  echo "  after the run: moves=$(count_of moves "$out") collisions=$(count_of collisions "$out") unkeyed=$(count_of unkeyed "$out")"
fi
exit "$status"
