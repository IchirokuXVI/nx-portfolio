#!/usr/bin/env bash
#
# nx-log-retention: no container log line on this node outlives its rule (k8s
# plan 0018).
#
# provision-host.sh installs this file as /usr/local/sbin/nx-log-retention and a
# systemd timer that runs it every hour. The privacy policy states how long logs
# are kept, and Kubernetes bounds the kubelet's log files by size and by the life
# of the pod, never by age. This program puts the age on the files themselves.
#
#   nx-log-retention                      apply the rules
#   nx-log-retention --dry-run            print what it would do, change nothing
#   nx-log-retention version              the version of this tool
#
# Options:
#   --now <time>                 the clock to measure ages against, in any form
#                                `date -d` reads (tests and dry runs)
#   --root <dir>                 default /var/log/pods
#   --config <file>              default /etc/nx-log-retention.conf
#   --only <namespace>/<container>   one container only (V1 of the plan)
#
# The config holds one rule per line, `<namespace>/<container> <days>`. `*` is a
# whole segment wildcard. The most specific rule wins: a named container counts
# more than a named namespace, and on a tie the later line wins.
#
#   */* 30
#   */luna-shopper-backend-assistant 7
#
# A line is dropped once it is older than `days` minus two hours. The timer runs
# hourly, so no line is ever older than its rule between two runs.
#
# Each container directory holds the live file `<n>.log`, which containerd has
# open, and rotated files `<n>.log.<stamp>`, gzipped or not, which nothing
# writes. For each container:
#
#   1. A rotated file last written before the cutoff is deleted.
#   2. A rotated file that starts before the cutoff is rewritten from its first
#      kept line and renamed over itself.
#   3. A live file that starts before the cutoff is trimmed in place: the kept
#      bytes are copied out, the file is truncated and the copy appended back.
#      containerd appends with O_APPEND, so its next write lands at the new end.
#      A line written between the copy and the truncate is lost, the same window
#      logrotate's copytruncate has, and each trim is logged.
#
# The age of a line is read from the line: the CRI format starts every line with
# an RFC 3339 timestamp. A line whose timestamp cannot be read is kept, and so is
# everything after it.

set -euo pipefail

TOOL_VERSION=1
MARGIN_SECONDS=7200

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH

ROOT=/var/log/pods
CONFIG=/etc/nx-log-retention.conf
DRY_RUN=false
NOW=""
ONLY=""

die() { echo "nx-log-retention: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    version)   echo "$TOOL_VERSION"; exit 0 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --now)     [ $# -ge 2 ] || die "--now needs a value"; NOW="$2"; shift 2 ;;
    --root)    [ $# -ge 2 ] || die "--root needs a value"; ROOT="$2"; shift 2 ;;
    --config)  [ $# -ge 2 ] || die "--config needs a value"; CONFIG="$2"; shift 2 ;;
    --only)    [ $# -ge 2 ] || die "--only needs a value"; ONLY="$2"; shift 2 ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [ -n "$ONLY" ] && [[ "$ONLY" != */* || "$ONLY" == */*/* ]]; then
  die "--only takes <namespace>/<container>"
fi

if [ -n "$NOW" ]; then
  NOW_EPOCH="$(date -d "$NOW" +%s 2>/dev/null)" || die "--now: date cannot read '$NOW'"
else
  NOW_EPOCH="$(date +%s)"
fi

# ---------------------------------------------------------------------------
# The rules.
# ---------------------------------------------------------------------------
[ -f "$CONFIG" ] || die "no config at $CONFIG"

RULE_NS=()
RULE_CT=()
RULE_DAYS=()
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line="${line%%#*}"
  line="${line%$'\r'}"
  read -r selector days extra <<< "$line" || true
  [ -n "${selector:-}" ] || continue
  [ -z "${extra:-}" ] || die "$CONFIG:$lineno: one rule per line, '<namespace>/<container> <days>'"
  [[ "$selector" == */* && "$selector" != */*/* ]] \
    || die "$CONFIG:$lineno: '$selector' is not <namespace>/<container>"
  [[ "${days:-}" =~ ^[1-9][0-9]*$ ]] || die "$CONFIG:$lineno: days must be a whole number above zero"
  RULE_NS+=("${selector%%/*}")
  RULE_CT+=("${selector#*/}")
  RULE_DAYS+=("$days")
done < "$CONFIG"
[ "${#RULE_DAYS[@]}" -gt 0 ] || die "$CONFIG holds no rule"

# The days of the most specific rule for a container, or nothing.
days_for() {
  local ns="$1" ct="$2" i score best=-1 found=""
  for i in "${!RULE_DAYS[@]}"; do
    [ "${RULE_NS[$i]}" = '*' ] || [ "${RULE_NS[$i]}" = "$ns" ] || continue
    [ "${RULE_CT[$i]}" = '*' ] || [ "${RULE_CT[$i]}" = "$ct" ] || continue
    score=0
    [ "${RULE_NS[$i]}" = '*' ] || score=$((score + 1))
    [ "${RULE_CT[$i]}" = '*' ] || score=$((score + 2))
    if [ "$score" -ge "$best" ]; then
      best="$score"
      found="${RULE_DAYS[$i]}"
    fi
  done
  echo "$found"
}

# ---------------------------------------------------------------------------
# The first line to keep.
#
# Prints the number of the first line that is not older than the cutoff, or the
# line count plus one when every line is. The date arithmetic is done by hand,
# because mawk, Debian's awk, has no mktime, and a line may carry an offset
# rather than Z.
# ---------------------------------------------------------------------------
FIRST_KEPT_AWK='
function epoch(ts,    y, mo, d, h, mi, s, rest, off, era, yoe, mp, doy, doe) {
  if (ts !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/) return -1
  y = substr(ts, 1, 4) + 0; mo = substr(ts, 6, 2) + 0; d = substr(ts, 9, 2) + 0
  h = substr(ts, 12, 2) + 0; mi = substr(ts, 15, 2) + 0; s = substr(ts, 18, 2) + 0
  rest = substr(ts, 20)
  sub(/^\.[0-9]+/, "", rest)
  if (rest == "Z" || rest == "z") off = 0
  else if (rest ~ /^[+-][0-9][0-9]:[0-9][0-9]$/) {
    off = substr(rest, 2, 2) * 3600 + substr(rest, 5, 2) * 60
    if (substr(rest, 1, 1) == "+") off = -off
  } else return -1
  if (mo <= 2) y--
  era = int((y >= 0 ? y : y - 399) / 400)
  yoe = y - era * 400
  mp = (mo + 9) % 12
  doy = int((153 * mp + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  return (era * 146097 + doe - 719468) * 86400 + h * 3600 + mi * 60 + s + off
}
{
  e = epoch($1)
  if (e < 0 || e >= cutoff) { print NR; found = 1; exit }
}
END { if (!found) print NR + 1 }
'

first_kept() {
  local file="$1" cutoff="$2"
  case "$file" in
    *.gz) { gzip -dc "$file" 2>/dev/null || true; } | awk -v cutoff="$cutoff" "$FIRST_KEPT_AWK" ;;
    *)    awk -v cutoff="$cutoff" "$FIRST_KEPT_AWK" "$file" ;;
  esac
}

# The bytes of the first `n` lines, uncompressed.
leading_bytes() {
  local file="$1" n="$2"
  [ "$n" -gt 0 ] || { echo 0; return; }
  case "$file" in
    *.gz) { gzip -dc "$file" 2>/dev/null || true; } | head -n "$n" | wc -c ;;
    *)    head -n "$n" "$file" | wc -c ;;
  esac
}

TMP_FILE=""
trap '[ -z "$TMP_FILE" ] || rm -f "$TMP_FILE"' EXIT

# A name the kubelet does not take for one of its own: it lists `<n>.log.*`.
make_tmp() { TMP_FILE="$(mktemp "$1/.nx-log-retention.XXXXXX")"; }

copy_owner() {
  chmod --reference="$1" "$2"
  chown --reference="$1" "$2" 2>/dev/null || true
}

deleted=0
trimmed=0
checked=0

# Step 1 and 2: a file nothing writes.
handle_rotated() {
  local file="$1" cutoff="$2" mtime keep total dropped
  mtime="$(stat -c %Y "$file")"
  if [ "$mtime" -lt "$cutoff" ]; then
    echo "delete $file ($(stat -c %s "$file") bytes, last written $(date -u -d "@$mtime" +%FT%TZ))"
    [ "$DRY_RUN" = true ] || rm -f "$file"
    deleted=$((deleted + 1))
    return
  fi
  keep="$(first_kept "$file" "$cutoff")"
  [ "$keep" -gt 1 ] || return 0
  dropped="$(leading_bytes "$file" $((keep - 1)))"
  total="$(case "$file" in *.gz) { gzip -dc "$file" 2>/dev/null || true; } | wc -l ;; *) wc -l < "$file" ;; esac)"
  if [ "$keep" -gt "$total" ]; then
    echo "delete $file (every line is older than the cutoff)"
    [ "$DRY_RUN" = true ] || rm -f "$file"
    deleted=$((deleted + 1))
    return
  fi
  echo "trim $file: drop $((keep - 1)) lines, $dropped bytes"
  trimmed=$((trimmed + 1))
  [ "$DRY_RUN" = false ] || return 0
  make_tmp "$(dirname "$file")"
  case "$file" in
    *.gz) { gzip -dc "$file" 2>/dev/null || true; } | tail -n +"$keep" | gzip -c > "$TMP_FILE" ;;
    *)    tail -n +"$keep" "$file" > "$TMP_FILE" ;;
  esac
  copy_owner "$file" "$TMP_FILE"
  # Its mtime is still the time of its newest line, so step 1 deletes it on time.
  touch -r "$file" "$TMP_FILE"
  mv -f "$TMP_FILE" "$file"
  TMP_FILE=""
}

# Step 3: the file containerd has open.
handle_live() {
  local file="$1" cutoff="$2" keep dropped
  keep="$(first_kept "$file" "$cutoff")"
  [ "$keep" -gt 1 ] || return 0
  # Counted over the lines the scan saw, so a line appended since is kept.
  dropped="$(leading_bytes "$file" $((keep - 1)))"
  echo "trim $file in place: drop $((keep - 1)) lines, $dropped bytes"
  trimmed=$((trimmed + 1))
  [ "$DRY_RUN" = false ] || return 0
  make_tmp "$(dirname "$file")"
  tail -c +"$((dropped + 1))" "$file" > "$TMP_FILE"
  truncate -s 0 "$file"
  cat "$TMP_FILE" >> "$file"
  rm -f "$TMP_FILE"
  TMP_FILE=""
}

if [ ! -d "$ROOT" ]; then
  echo "nx-log-retention: $ROOT does not exist, nothing to do"
  exit 0
fi

# One run at a time, so an hourly run never meets a slow one from the hour before.
if [ "$(id -u)" -eq 0 ] && [ -d /run ]; then
  exec 9>/run/nx-log-retention.lock
  flock -n 9 || die "another run holds /run/nx-log-retention.lock"
fi

shopt -s nullglob
[ "$DRY_RUN" = false ] || echo "dry run: nothing is changed"

for container_dir in "$ROOT"/*/*/; do
  container_dir="${container_dir%/}"
  container="$(basename "$container_dir")"
  pod_dir="$(basename "$(dirname "$container_dir")")"
  # <namespace>_<pod>_<uid>. Neither a namespace nor a pod name may hold `_`.
  namespace="${pod_dir%%_*}"
  if [ -n "$ONLY" ] && [ "$namespace/$container" != "$ONLY" ]; then
    continue
  fi
  days="$(days_for "$namespace" "$container")"
  if [ -z "$days" ]; then
    echo "skip $namespace/$container: no rule matches"
    continue
  fi
  cutoff=$((NOW_EPOCH - days * 86400 + MARGIN_SECONDS))
  for file in "$container_dir"/*.log.*; do
    case "$file" in *.tmp) continue ;; esac
    checked=$((checked + 1))
    handle_rotated "$file" "$cutoff"
  done
  for file in "$container_dir"/*.log; do
    checked=$((checked + 1))
    handle_live "$file" "$cutoff"
  done
done

echo "checked $checked files under $ROOT: $deleted deleted, $trimmed trimmed"
