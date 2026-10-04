#!/usr/bin/env bash
#
# Run the release tasks of one environment (README.md in this directory).
#
#   run-release-tasks.sh --env staging --phase check                        # before anything
#   run-release-tasks.sh --env staging --phase pre                          # before helm upgrade
#   run-release-tasks.sh --env staging --phase post                         # after the rollout
#   run-release-tasks.sh --env production --phase check --release 1.2.3     # the same three,
#   run-release-tasks.sh --env production --phase pre --release 1.2.3       # with the version
#   run-release-tasks.sh --env production --phase post --release 1.2.3      # being deployed
#
# A task is a directory under tasks/, named NNNN-kebab-title, holding task.env,
# check.sh and at least one of pre.sh and post.sh. Tasks run in name order.
#
# check: print what the pre phase would decide for every task, one line each,
#        and change nothing: no dump, no hook except check.sh, no write to the
#        ledger. It exits 1 when a task is refused, after it printed every line.
# pre:   for every task that is due, dump each database it names to object
#        storage, record the dump keys, then run its pre.sh. A dump that fails
#        stops the deploy before the task has changed anything.
# post:  for every task whose pre phase finished, run its post.sh and mark it
#        done.
#
# What decides whether a task with no state in the ledger is due, in this order
# (k8s plan 0011):
#
#   the window of this environment is `never`       nothing happens
#   the window is absent, empty or not a date       refused, exit 1
#   the release is a first install                  recorded as skipped
#   today (UTC) is after the window                 recorded as expired
#   production, and --release is another version    it waits for its release
#   check.sh is absent or fails                     refused, exit 1
#   otherwise                                       due
#
# The window is RUN_UNTIL_STAGING or RUN_UNTIL_PRODUCTION in task.env: a UTC
# date, YYYY-MM-DD, inclusive, or the word `never`. PRODUCTION_RELEASE is the
# one version that runs the task in production.
#
# The ledger is the ConfigMap `release-tasks`: one key per task holding its state
# (`pre-done`, `done`, `skipped` or `expired`, then a UTC timestamp), and
# `<task>.dumps` holding `<database>=<dump key>` pairs, separated by spaces. A
# task in state `done`, `skipped` or `expired` never runs again. A task in state
# `pre-done` always finishes, whatever its window says, because a task stopped
# between its two phases leaves a cluster half changed. Removing the keys of a
# task from the ConfigMap runs it again, if its window is still open, which every
# task must survive (the second rule in README.md).
#
# Environment overrides:
#   NAMESPACE     kubernetes namespace          (default: nx-portfolio)
#   RELEASE_NAME  helm release                  (default: nx-portfolio)
#   KUBECONFIG    kubeconfig path               (default: /etc/rancher/k3s/k3s.yaml)
#   DUMP_TIMEOUT  seconds to wait for one dump  (default: 900)

set -euo pipefail
# `key="$(dump ...)"` must stop at the first failing command inside dump, and
# without this a command substitution runs with errexit off.
shopt -s inherit_errexit

usage() {
  echo "usage: run-release-tasks.sh --env <staging|production> --phase <check|pre|post> [--release <version>]" >&2
  echo "       --release is required with --env production and refused with --env staging" >&2
  exit 1
}

ENVIRONMENT=''
PHASE=''
RELEASE=''
RELEASE_GIVEN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="${2:-}"; shift 2 || usage ;;
    --phase) PHASE="${2:-}"; shift 2 || usage ;;
    --release) RELEASE="${2:-}"; RELEASE_GIVEN=true; shift 2 || usage ;;
    *) usage ;;
  esac
done
case "$PHASE" in check | pre | post) ;; *) usage ;; esac
case "$ENVIRONMENT" in
  staging)
    # Staging deploys the mutable tag `staging`, so no version can gate it. A
    # version given here is a caller that believes it is deploying production.
    [ "$RELEASE_GIVEN" = false ] || usage
    WINDOW_FIELD=RUN_UNTIL_STAGING
    ;;
  production)
    case "$RELEASE" in '' | *[!0-9A-Za-z.+-]*) usage ;; esac
    WINDOW_FIELD=RUN_UNTIL_PRODUCTION
    ;;
  *) usage ;;
esac

NAMESPACE="${NAMESPACE:-nx-portfolio}"
RELEASE_NAME="${RELEASE_NAME:-nx-portfolio}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$HERE")"
LEDGER='release-tasks'
TODAY="$(date -u +%Y-%m-%d)"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Whether the ledger exists. Only an answer of "not found" counts as absent: a
# cluster that cannot be reached must not read as a cluster with an empty ledger.
ledger_present() {
  local out
  if out="$(kubectl -n "$NAMESPACE" get configmap "$LEDGER" -o name 2>&1)"; then
    return 0
  fi
  case "$out" in *NotFound* | *'not found'*) return 1 ;; esac
  echo "cannot read configmap/$LEDGER: $out" >&2
  exit 1
}

ledger_get() {
  [ "$LEDGER_PRESENT" = true ] || return 0
  # go-template rather than jsonpath: `index` reads a key with dots and a
  # leading digit as it is.
  kubectl -n "$NAMESPACE" get configmap "$LEDGER" \
    -o go-template="{{if .data}}{{with index .data \"$1\"}}{{.}}{{end}}{{end}}"
}

ledger_set() {
  # Every value this script writes is task names, dates, words and s3 keys, so
  # nothing in it needs JSON escaping. Refuse anything that would.
  case "$2" in *[!A-Za-z0-9:./_=\ -]*)
    echo "refusing to write '$2' to the ledger" >&2
    return 1
    ;;
  esac
  kubectl -n "$NAMESPACE" patch configmap "$LEDGER" --type merge \
    -p "{\"data\":{\"$1\":\"$2\"}}" > /dev/null
}

# Reads one field from a task's task.env, in a subshell so one task's values
# cannot leak into the next. Every field is cleared first, so a variable of the
# same name in the caller's environment cannot stand in for one the file does
# not state.
task_field() {
  (
    RUN_UNTIL_STAGING=''
    RUN_UNTIL_PRODUCTION=''
    PRODUCTION_RELEASE=''
    DATABASES=''
    # shellcheck disable=SC1090,SC1091
    . "$1/task.env" > /dev/null
    case "$2" in
      RUN_UNTIL_STAGING) value="$RUN_UNTIL_STAGING" ;;
      RUN_UNTIL_PRODUCTION) value="$RUN_UNTIL_PRODUCTION" ;;
      PRODUCTION_RELEASE) value="$PRODUCTION_RELEASE" ;;
      DATABASES) value="$DATABASES" ;;
      *) exit 1 ;;
    esac
    # A checkout with CRLF line endings leaves a carriage return on each value.
    printf '%s' "${value%$'\r'}"
  )
}

# A real calendar day, written YYYY-MM-DD. `date` rejects 2026-02-31.
is_date() {
  [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 1
  [ "$(date -u -d "$1" +%Y-%m-%d 2> /dev/null || true)" = "$1" ]
}

run_hook() {
  local dir="$1" hook="$2"
  [ -f "$dir/$hook" ] || return 0
  echo "  running $hook"
  ENVIRONMENT="$ENVIRONMENT" NAMESPACE="$NAMESPACE" KUBECONFIG="$KUBECONFIG" \
    K8S_DIR="$K8S_DIR" TASK_NAME="$(basename "$dir")" \
    bash "$dir/$hook"
}

# Runs check.sh and prints what it printed. A task with no check.sh has stated
# no expectation, and that is a refusal, not a pass.
run_check() {
  local dir="$1"
  if [ ! -f "$dir/check.sh" ]; then
    echo "it has no check.sh, so it states nothing about the data it expects"
    return 1
  fi
  ENVIRONMENT="$ENVIRONMENT" NAMESPACE="$NAMESPACE" KUBECONFIG="$KUBECONFIG" \
    K8S_DIR="$K8S_DIR" TASK_NAME="$(basename "$dir")" \
    bash "$dir/check.sh" 2>&1
}

# Dump one database through its backup CronJob and print the uploaded key. The
# CronJob prints `uploaded s3://...` last, and that line is what is read here.
cronjob_of() { printf 'luna-shopper-backend-%s-db-backup' "$1"; }

# The databases of a task whose backup CronJob does not exist, one per line.
missing_cronjobs() {
  local db
  for db in $(task_field "$1" DATABASES); do
    kubectl -n "$NAMESPACE" get cronjob "$(cronjob_of "$db")" > /dev/null 2>&1 || echo "$db"
  done
}

dump() {
  local task="$1" db="$2" cronjob job key conditions waited=0
  cronjob="$(cronjob_of "$db")"
  job="rt-${task%%-*}-${db}-$(date -u +%Y%m%d%H%M%S)"
  kubectl -n "$NAMESPACE" create job "$job" --from="cronjob/$cronjob" > /dev/null
  # Polled rather than `kubectl wait`, which watches one condition and would sit
  # out the whole timeout on a Job that has already failed.
  while :; do
    conditions="$(kubectl -n "$NAMESPACE" get "job/$job" \
      -o jsonpath='{.status.conditions[?(@.status=="True")].type}')"
    case " $conditions " in
      *' Complete '*) break ;;
      *' Failed '*) waited=-1; break ;;
    esac
    if [ "$waited" -ge "$DUMP_TIMEOUT" ]; then
      waited=-1
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if [ "$waited" -lt 0 ]; then
    echo "  job/$job did not complete. Its log:" >&2
    kubectl -n "$NAMESPACE" logs "job/$job" --tail=50 >&2 || true
    return 1
  fi
  key="$(kubectl -n "$NAMESPACE" logs "job/$job" | sed -n 's/^uploaded //p' | tail -1)"
  if [ -z "$key" ]; then
    echo "  job/$job completed but printed no uploaded key" >&2
    return 1
  fi
  printf '%s' "$key"
}

# What happens to a task that has no state in the ledger. Sets DECISION to one
# of never, refused, fresh, expired, waits, deferred, due, and DETAIL to the
# words that explain it. It reads and never writes, so both the check phase and
# the pre phase call it and cannot disagree.
decide() {
  local dir="$1" window release databases missing output
  DETAIL=''

  if ! window="$(task_field "$dir" "$WINDOW_FIELD")" \
    || ! release="$(task_field "$dir" PRODUCTION_RELEASE)" \
    || ! databases="$(task_field "$dir" DATABASES)"; then
    DECISION=refused
    DETAIL='its task.env cannot be read'
    return 0
  fi

  if [ "$window" = never ]; then
    DECISION=never
    DETAIL="never in $ENVIRONMENT"
    return 0
  fi
  if [ -z "$window" ]; then
    DECISION=refused
    DETAIL="$WINDOW_FIELD is not set. A task with no window does not run"
    return 0
  fi
  if ! is_date "$window"; then
    DECISION=refused
    DETAIL="$WINDOW_FIELD is '$window', which is neither a date (YYYY-MM-DD) nor the word never"
    return 0
  fi
  if [ "$ENVIRONMENT" = production ] && [ -z "$release" ]; then
    DECISION=refused
    DETAIL='PRODUCTION_RELEASE is not set, and a task with a production window names its release'
    return 0
  fi

  if [ "$FRESH" = true ]; then
    DECISION=fresh
    DETAIL='first install'
    return 0
  fi
  # Both sides are YYYY-MM-DD, so the order of the strings is the order of the days.
  if [[ "$TODAY" > "$window" ]]; then
    DECISION=expired
    DETAIL="its window closed on $window"
    return 0
  fi
  if [ "$ENVIRONMENT" = production ] && [ "$release" != "$RELEASE" ]; then
    DECISION=waits
    DETAIL="waits for release $release"
    return 0
  fi

  if ! output="$(run_check "$dir")"; then
    DECISION=refused
    DETAIL="${output:-check.sh failed and printed no reason}"
    return 0
  fi

  DETAIL="until $window"
  [ "$ENVIRONMENT" != production ] || DETAIL="$DETAIL, release $release"
  DETAIL="$DETAIL, databases: $databases"

  missing="$(missing_cronjobs "$dir")"
  if [ -n "$missing" ]; then
    DECISION=deferred
    DETAIL="no backup CronJob yet for: ${missing//$'\n'/ }"
    return 0
  fi
  DECISION=due
}

if [ "$PHASE" = check ]; then
  # The check phase writes nothing, so it does not create the ledger either. An
  # absent ledger reads as an empty one.
  if ledger_present; then LEDGER_PRESENT=true; else LEDGER_PRESENT=false; fi
else
  # The ledger exists before anything reads it.
  kubectl -n "$NAMESPACE" create configmap "$LEDGER" --dry-run=client -o yaml \
    | kubectl -n "$NAMESPACE" apply -f - > /dev/null
  LEDGER_PRESENT=true
fi

# A first install has no data for a task to change. Every due task is recorded
# as skipped, so a task written for an existing cluster never runs on a new one.
FRESH=false
if [ "$PHASE" != post ] && ! helm status "$RELEASE_NAME" --namespace "$NAMESPACE" > /dev/null 2>&1; then
  FRESH=true
fi

shopt -s nullglob
TASKS=("$HERE"/tasks/[0-9][0-9][0-9][0-9]-*/)
echo "release tasks, $ENVIRONMENT, phase $PHASE${RELEASE:+, release $RELEASE}: ${#TASKS[@]} defined"

WIDTH=0
for dir in "${TASKS[@]}"; do
  task="$(basename "$dir")"
  [ "${#task}" -le "$WIDTH" ] || WIDTH="${#task}"
done

# One line of the check phase: the task, then what happens to it.
line() { printf "%-${WIDTH}s   %s\n" "$1" "$2"; }

REFUSALS=0

for dir in "${TASKS[@]}"; do
  dir="${dir%/}"
  task="$(basename "$dir")"
  ledger="$(ledger_get "$task")"
  state="${ledger%% *}"

  # The state is read before the window, so that a task the ledger already
  # knows is never judged by its window again.
  case "$PHASE:$state" in
    check:done | check:skipped | check:expired)
      line "$task" "$ledger"
      ;;
    *:done | *:skipped | *:expired) continue ;;

    check:pre-done)
      line "$task" "$ledger, and the post phase of this deploy finishes it"
      ;;

    check:)
      decide "$dir"
      case "$DECISION" in
        never) line "$task" "$DETAIL" ;;
        fresh) line "$task" "SKIPPED at this deploy, $DETAIL" ;;
        expired) line "$task" "EXPIRED at this deploy, $DETAIL" ;;
        waits) line "$task" "$DETAIL" ;;
        deferred) line "$task" "DEFERRED to the next deploy, $DETAIL" ;;
        due) line "$task" "DUE   $DETAIL" ;;
        refused)
          # A reason of several lines goes on one, so the list stays a list.
          line "$task" "REFUSED   $(printf '%s' "$DETAIL" | tr '\n' ' ')"
          REFUSALS=$((REFUSALS + 1))
          ;;
      esac
      ;;

    pre:pre-done)
      # A deploy failed between the phases. The dumps and pre.sh are already
      # behind it, and post runs once this deploy's rollout succeeds.
      echo "$task: pre phase already done"
      ;;

    pre:)
      decide "$dir"
      case "$DECISION" in
        never) continue ;;
        refused)
          echo "$task: REFUSED. $DETAIL" >&2
          echo "  Nothing was changed. The deploy stops here." >&2
          exit 1
          ;;
        fresh)
          echo "$task: skipped, first install"
          ledger_set "$task" "skipped $(now) first-install"
          continue
          ;;
        expired)
          echo "$task: EXPIRED, $DETAIL and today is $TODAY. It will never run in this cluster." >&2
          echo "  To run it after all, move its window in a pull request and remove its key from configmap/$LEDGER." >&2
          ledger_set "$task" "expired $(now)"
          continue
          ;;
        waits)
          echo "$task: $DETAIL"
          continue
          ;;
        deferred)
          # The CronJobs come from the chart, and the upgrade that renders them
          # runs after this phase. The first deploy that enables backups in a
          # cluster therefore finds none. Failing here would stop that upgrade
          # too, and every deploy after it, so the task waits for the next deploy.
          # Nothing has changed, so it is still reversible.
          echo "$task: DEFERRED, $DETAIL." >&2
          echo "  It runs at the next deploy, once this upgrade has created them." >&2
          continue
          ;;
      esac
      echo "$task: due, $DETAIL"
      dumps="$(ledger_get "$task.dumps")"
      for db in $(task_field "$dir" DATABASES); do
        echo "  dumping $db"
        key="$(dump "$task" "$db")"
        echo "  $key"
        dumps="${dumps:+$dumps }$db=$key"
        # Written after every dump, so a later failure cannot lose an earlier key.
        ledger_set "$task.dumps" "$dumps"
      done
      run_hook "$dir" pre.sh
      ledger_set "$task" "pre-done $(now)"
      ;;

    post:pre-done)
      echo "$task: finishing"
      run_hook "$dir" post.sh
      ledger_set "$task" "done $(now)"
      echo "$task: done. The dumps that revert it:"
      for entry in $(ledger_get "$task.dumps"); do
        echo "  $entry"
      done
      ;;

    post:)
      # Not started by the pre phase of this deploy: it does not belong here, it
      # waits for its release, or it was added to the checkout after that phase
      # ran. The pre phase of a later deploy decides, and takes its dumps first.
      [ "$(task_field "$dir" "$WINDOW_FIELD" || true)" != never ] || continue
      echo "$task: not started by the pre phase, so the post phase leaves it alone"
      ;;

    *)
      if [ "$PHASE" = check ]; then
        line "$task" "REFUSED   unknown state '$state' in configmap/$LEDGER"
        REFUSALS=$((REFUSALS + 1))
        continue
      fi
      echo "$task: unknown state '$state' in configmap/$LEDGER" >&2
      exit 1
      ;;
  esac
done

if [ "$REFUSALS" -gt 0 ]; then
  echo "$REFUSALS release task(s) refused. Nothing was changed, and the deploy must not start." >&2
  exit 1
fi
