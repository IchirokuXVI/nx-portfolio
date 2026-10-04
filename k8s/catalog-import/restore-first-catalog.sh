#!/usr/bin/env bash
#
# Put the first curated catalog in place of a cluster's empty catalog and
# harvester databases (k8s plan 0012, README.md in this directory).
#
#   ./restore-first-catalog.sh           # dry run: steps 1 to 4, then stops
#   ./restore-first-catalog.sh --apply   # every step
#
# It copies two whole databases and merges nothing. Every id in the dumps
# survives, which is the reason this is a restore and not an import through the
# services.
#
# The steps:
#
#    1  the target holds no more than the owner said it holds (the ceilings)
#    2  both dumps are restored into scratch databases, held to their SHA-256
#    3  the scratch databases are the documented state: every count of the
#       manifest, the migrations of the live databases, no harvest run running
#    4  nothing the target holds is lost, unless expected-losses.txt accepts it
#    5  the scratch harvester gets every source turned off, and both scratch
#       databases get the comment that marks this restore
#    6  the catalog and harvester services are stopped
#    7  each scratch database takes the name of the live one, catalog first
#    8  the two services start again
#    9  core's references to catalog rows that are gone are cleared
#   10  the counts are read back from the live databases
#
# A dry run leaves the two scratch databases in place, so that a person can
# read them. Every check runs before the first write to a live database.
#
# It never deletes a database. The old ones stay beside the new ones as
# `luna_catalog_before_first_catalog` and `luna_harvester_before_first_catalog`,
# and removing them is a manual step (README.md).
#
# Safe to run again. Step 5 writes a comment on each scratch database, and the
# comment moves with the rename. A run that finds it on the live catalog leaves
# both databases alone. With --apply it still runs the core cleanup, which keeps
# every id that catalog holds and so changes nothing a second time. That closes
# a run that was cut between the swap and the cleanup.
#
# Environment:
#   MAX_ITEMS_REPLACED           the most products the live catalog may hold
#                                (default: 0)
#   MAX_SOURCE_ENTRIES_REPLACED  the most source_catalog_entries the live
#                                harvester may hold (default: 0)
#   NAMESPACE                    kubernetes namespace (default: nx-portfolio)
#   KUBECONFIG                   kubeconfig path (default: /etc/rancher/k3s/k3s.yaml)
#   MANIFEST                     the manifest (default: first-catalog.manifest
#                                beside this script)
#   EXPECTED_LOSSES              the accepted losses (default:
#                                expected-losses.txt beside this script)
#
# For a rehearsal against a local stack. Naming CATALOG_PSQL means that there is
# no cluster: the script then calls no kubectl at all, scales nothing, and needs
# every other override of this list. Stop whatever writes to the two databases
# yourself.
#   CATALOG_PSQL                command that runs psql against catalog, reading
#                               SQL on stdin. The script adds `-d <database>`
#                               after it, and psql takes the last -d it is given
#   HARVESTER_PSQL              the same for harvester
#   CORE_PSQL                   the same for core
#   CATALOG_RESTORE_POD_EXEC    command that runs a command inside the catalog
#                               database container (restore-database.sh)
#   CATALOG_RESTORE_DB_URL      URL of the live catalog, as that container
#                               reaches it
#   HARVESTER_RESTORE_POD_EXEC  the same two for harvester
#   HARVESTER_RESTORE_DB_URL
#   RESTORE_S3_ENDPOINT, RESTORE_S3_BUCKET, RESTORE_S3_ACCESS_KEY_ID,
#   RESTORE_S3_SECRET_ACCESS_KEY  where the dumps are (restore-database.sh)
#
#   CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d luna_catalog'

set -euo pipefail
# `x="$(f)"` must stop at the first failing command inside f, and without this
# a command substitution runs with errexit off.
shopt -s inherit_errexit

MODE=dry-run
case "${1:-}" in
  '') ;;
  --apply) MODE=apply ;;
  *)
    echo "usage: restore-first-catalog.sh [--apply]" >&2
    exit 1
    ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$HERE")"
MANIFEST="${MANIFEST:-$HERE/first-catalog.manifest}"
EXPECTED_LOSSES="${EXPECTED_LOSSES:-$HERE/expected-losses.txt}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

TASK='0003-restore-the-first-catalog'
MARKER="first catalog restored by release task ${TASK}"
SCRATCH_SUFFIX='_restore'
OLD_SUFFIX='_before_first_catalog'

refuse() {
  echo >&2
  echo "REFUSED: $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# How each database is reached
# ---------------------------------------------------------------------------

if [ -n "${CATALOG_PSQL:-}" ]; then
  REHEARSAL=true
  for name in HARVESTER_PSQL CORE_PSQL CATALOG_RESTORE_POD_EXEC CATALOG_RESTORE_DB_URL \
    HARVESTER_RESTORE_POD_EXEC HARVESTER_RESTORE_DB_URL RESTORE_S3_ENDPOINT RESTORE_S3_BUCKET \
    RESTORE_S3_ACCESS_KEY_ID RESTORE_S3_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || refuse "CATALOG_PSQL is set, so this is a rehearsal, and a rehearsal names $name too"
  done
else
  REHEARSAL=false
  for name in HARVESTER_PSQL CORE_PSQL; do
    [ -z "${!name:-}" ] || refuse "$name is set and CATALOG_PSQL is not. Name all three for a rehearsal, or none"
  done
  for db in catalog harvester; do
    kubectl -n "$NAMESPACE" get pod "luna-shopper-backend-${db}-db-0" > /dev/null 2>&1 \
      || refuse "pod/luna-shopper-backend-${db}-db-0 was not found. This restore replaces catalog and harvester together"
  done
  CATALOG_PSQL="kubectl -n $NAMESPACE exec -i luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d luna_catalog"
  HARVESTER_PSQL="kubectl -n $NAMESPACE exec -i luna-shopper-backend-harvester-db-0 -- psql -U luna_harvester -d luna_harvester"
fi

psql_of() {
  case "$1" in
    catalog) printf '%s' "$CATALOG_PSQL" ;;
    harvester) printf '%s' "$HARVESTER_PSQL" ;;
  esac
}

# Runs the SQL on stdin against one database of one instance. -X ignores any
# psqlrc, -A -t prints bare values. The trailing -d wins over the one inside
# the command, which is how the scratch database and `postgres` are reached.
sql() {
  local psql database="$2"
  psql="$(psql_of "$1")"
  shift 2
  # shellcheck disable=SC2086
  $psql -d "$database" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}

# One value. A docker or kubectl on Windows can leave a carriage return on it.
ask() {
  local answer
  answer="$(echo "$3" | sql "$1" "$2")"
  printf '%s' "$answer" | tr -d '\r'
}

count() {
  local found
  found="$(ask "$1" "$2" "SELECT count(*) FROM $3;")"
  case "$found" in '' | *[!0-9]*)
    echo "cannot count $3 in $2: the database answered '$found'" >&2
    return 1
    ;;
  esac
  printf '%s' "$found"
}

comment_of() {
  ask "$1" postgres "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '$2';"
}

database_exists() {
  [ "$(ask "$1" postgres "SELECT count(*) FROM pg_database WHERE datname = '$2';")" = 1 ]
}

cleanup_core() {
  echo
  echo "step 9: clear core's references to catalog rows that are gone"
  if [ "$REHEARSAL" = true ]; then
    CATALOG_PSQL="$CATALOG_PSQL" CORE_PSQL="$CORE_PSQL" \
      bash "$K8S_DIR/catalog-reset/cleanup-core-catalog-refs.sh" --apply | sed 's/^/  /'
  else
    NAMESPACE="$NAMESPACE" bash "$K8S_DIR/catalog-reset/cleanup-core-catalog-refs.sh" --apply | sed 's/^/  /'
  fi
}

# ---------------------------------------------------------------------------
# The manifest and the ceilings
# ---------------------------------------------------------------------------

[ -f "$MANIFEST" ] || refuse "the manifest $MANIFEST does not exist"

CATALOG_KEY='' CATALOG_SHA256='' HARVESTER_KEY='' HARVESTER_SHA256=''
CATALOG_LAST_MIGRATION='' CATALOG_MIGRATIONS='' HARVESTER_LAST_MIGRATION='' HARVESTER_MIGRATIONS=''
EXPECT_SUPERMARKETS='' EXPECT_PRICE_SCOPES='' EXPECT_CATEGORIES='' EXPECT_BRANDS=''
EXPECT_ITEMS='' EXPECT_ITEM_PRICES='' EXPECT_SOURCE_ENTRIES='' EXPECT_SOURCE_ENTRIES_ACTIVE=''
# shellcheck disable=SC1090
. "$MANIFEST"

for name in CATALOG_KEY CATALOG_SHA256 HARVESTER_KEY HARVESTER_SHA256 \
  CATALOG_LAST_MIGRATION CATALOG_MIGRATIONS HARVESTER_LAST_MIGRATION HARVESTER_MIGRATIONS \
  EXPECT_SUPERMARKETS EXPECT_PRICE_SCOPES EXPECT_CATEGORIES EXPECT_BRANDS \
  EXPECT_ITEMS EXPECT_ITEM_PRICES EXPECT_SOURCE_ENTRIES EXPECT_SOURCE_ENTRIES_ACTIVE; do
  # A checkout with CRLF line endings leaves a carriage return on each value.
  printf -v "$name" '%s' "${!name%$'\r'}"
  [ -n "${!name}" ] || refuse "the manifest does not state $name"
done
for name in CATALOG_SHA256 HARVESTER_SHA256; do
  [[ "${!name}" =~ ^[0-9a-f]{64}$ ]] || refuse "$name in the manifest is not a SHA-256"
done
for name in CATALOG_MIGRATIONS HARVESTER_MIGRATIONS EXPECT_SUPERMARKETS EXPECT_PRICE_SCOPES \
  EXPECT_CATEGORIES EXPECT_BRANDS EXPECT_ITEMS EXPECT_ITEM_PRICES EXPECT_SOURCE_ENTRIES \
  EXPECT_SOURCE_ENTRIES_ACTIVE; do
  case "${!name}" in *[!0-9]*) refuse "$name in the manifest is '${!name}', which is not a number" ;; esac
done

MAX_ITEMS_REPLACED="${MAX_ITEMS_REPLACED:-0}"
MAX_SOURCE_ENTRIES_REPLACED="${MAX_SOURCE_ENTRIES_REPLACED:-0}"
for name in MAX_ITEMS_REPLACED MAX_SOURCE_ENTRIES_REPLACED; do
  case "${!name}" in '' | *[!0-9]*) refuse "$name is '${!name}', which is not a number" ;; esac
done

# The counts of the manifest, as `instance|what is counted|expected`.
EXPECTATIONS="catalog|supermarkets|$EXPECT_SUPERMARKETS
catalog|price_scopes|$EXPECT_PRICE_SCOPES
catalog|categories|$EXPECT_CATEGORIES
catalog|brands|$EXPECT_BRANDS
catalog|items|$EXPECT_ITEMS
catalog|item_prices|$EXPECT_ITEM_PRICES
harvester|source_catalog_entries|$EXPECT_SOURCE_ENTRIES
harvester|source_catalog_entries WHERE status = 'ACTIVE'|$EXPECT_SOURCE_ENTRIES_ACTIVE"

# Prints every count of the manifest beside what one pair of databases holds,
# and fails when any differs.
check_counts() {
  local catalog_db="$1" harvester_db="$2" instance what expected database found wrong=0
  while IFS='|' read -r instance what expected; do
    case "$instance" in catalog) database="$catalog_db" ;; *) database="$harvester_db" ;; esac
    # Stated, because errexit is off inside a function called before `||`.
    found="$(count "$instance" "$database" "$what")" || return 1
    if [ "$found" = "$expected" ]; then
      printf '  %-48s %8s\n' "$what" "$found"
    else
      printf '  %-48s %8s   the manifest says %s\n' "$what" "$found" "$expected"
      wrong=$((wrong + 1))
    fi
  done <<< "$EXPECTATIONS"
  [ "$wrong" -eq 0 ]
}

echo "restore the first catalog: $MODE$([ "$REHEARSAL" = false ] || echo ', rehearsal (no cluster)')"

# ---------------------------------------------------------------------------
# An earlier run
# ---------------------------------------------------------------------------

database_exists catalog luna_catalog \
  || refuse "the catalog instance holds no database named luna_catalog. A run was cut in the middle of a swap, and a person must look at it (README.md, 'A run that was cut')"
database_exists harvester luna_harvester \
  || refuse "the harvester instance holds no database named luna_harvester. A run was cut in the middle of a swap, and a person must look at it (README.md, 'A run that was cut')"

catalog_comment="$(comment_of catalog luna_catalog)"
harvester_comment="$(comment_of harvester luna_harvester)"
if [ "$catalog_comment" = "$MARKER" ]; then
  [ "$harvester_comment" = "$MARKER" ] \
    || refuse "luna_catalog carries the comment of this restore and luna_harvester does not. The two were swapped apart, and a person must look at it (README.md, 'A run that was cut')"
  echo "already restored: luna_catalog and luna_harvester carry the comment of this restore, so both are left alone"
  if [ "$MODE" = apply ]; then cleanup_core; fi
  exit 0
fi
[ "$harvester_comment" != "$MARKER" ] \
  || refuse "luna_harvester carries the comment of this restore and luna_catalog does not. The two were swapped apart, and a person must look at it (README.md, 'A run that was cut')"

# ---------------------------------------------------------------------------
# Step 1
# ---------------------------------------------------------------------------

echo
echo "step 1: the target holds no more than the owner said it holds"

for db in catalog harvester; do
  ! database_exists "$db" "luna_${db}${OLD_SUFFIX}" \
    || refuse "luna_${db}${OLD_SUFFIX} already exists. It is the database an earlier restore replaced, and this script never deletes one"
done

live_items="$(count catalog luna_catalog items)"
live_entries="$(count harvester luna_harvester source_catalog_entries)"
printf '  %-48s %8s   at most %s\n' 'items' "$live_items" "$MAX_ITEMS_REPLACED"
printf '  %-48s %8s   at most %s\n' 'source_catalog_entries' "$live_entries" "$MAX_SOURCE_ENTRIES_REPLACED"
[ "$live_items" -le "$MAX_ITEMS_REPLACED" ] \
  || refuse "the live catalog holds $live_items products and the ceiling is $MAX_ITEMS_REPLACED. This restore replaces a catalog, it does not merge into one (backend backlog plan 0019)"
[ "$live_entries" -le "$MAX_SOURCE_ENTRIES_REPLACED" ] \
  || refuse "the live harvester holds $live_entries source_catalog_entries and the ceiling is $MAX_SOURCE_ENTRIES_REPLACED. A higher ceiling is the owner's statement that those rows are to be replaced"

# ---------------------------------------------------------------------------
# Step 2
# ---------------------------------------------------------------------------

echo
echo "step 2: restore both dumps into scratch databases"

restore() {
  local db="$1" key="$2" sha="$3" exec_name url_name
  echo "  $key"
  if [ "$REHEARSAL" = true ]; then
    exec_name="${db^^}_RESTORE_POD_EXEC"
    url_name="${db^^}_RESTORE_DB_URL"
    RESTORE_POD_EXEC="${!exec_name}" RESTORE_DB_URL="${!url_name}" \
      RESTORE_S3_ENDPOINT="$RESTORE_S3_ENDPOINT" RESTORE_S3_BUCKET="$RESTORE_S3_BUCKET" \
      RESTORE_S3_ACCESS_KEY_ID="$RESTORE_S3_ACCESS_KEY_ID" \
      RESTORE_S3_SECRET_ACCESS_KEY="$RESTORE_S3_SECRET_ACCESS_KEY" \
      SCRATCH_SUFFIX="$SCRATCH_SUFFIX" \
      bash "$K8S_DIR/helm/restore-database.sh" "luna-shopper-backend-${db}-db" "$key" "$sha" \
      | sed 's/^/    /'
  else
    # Unset, so that a variable of the caller's shell cannot send this restore
    # to a container instead of the pod.
    env -u RESTORE_POD_EXEC NAMESPACE="$NAMESPACE" SCRATCH_SUFFIX="$SCRATCH_SUFFIX" \
      bash "$K8S_DIR/helm/restore-database.sh" "luna-shopper-backend-${db}-db" "$key" "$sha" \
      | sed 's/^/    /'
  fi
}

restore catalog "$CATALOG_KEY" "$CATALOG_SHA256" \
  || refuse "the catalog dump was not restored. The live databases are unchanged"
restore harvester "$HARVESTER_KEY" "$HARVESTER_SHA256" \
  || refuse "the harvester dump was not restored. The live databases are unchanged"

CATALOG_SCRATCH="luna_catalog${SCRATCH_SUFFIX}"
HARVESTER_SCRATCH="luna_harvester${SCRATCH_SUFFIX}"

# ---------------------------------------------------------------------------
# Step 3
# ---------------------------------------------------------------------------

echo
echo "step 3: the scratch databases are the documented state"

TMP="$(mktemp -d)"
WRITERS_STOPPED=false
declare -A REPLICAS=()

start_writers() {
  local deploy
  for deploy in "${!REPLICAS[@]}"; do
    echo "  $deploy: back to ${REPLICAS[$deploy]} replica(s)"
    kubectl -n "$NAMESPACE" scale "deployment/$deploy" --replicas="${REPLICAS[$deploy]}" > /dev/null
  done
  WRITERS_STOPPED=false
}

on_exit() {
  local status=$?
  rm -rf "$TMP"
  if [ "$WRITERS_STOPPED" = true ]; then
    WRITERS_STOPPED=false
    echo "starting the two services again, because the run stopped while they were down" >&2
    start_writers >&2 || echo "could not start them. Scale them by hand: kubectl -n $NAMESPACE scale deployment/<name> --replicas=<n>" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

check_counts "$CATALOG_SCRATCH" "$HARVESTER_SCRATCH" \
  || refuse "the scratch databases do not hold the counts of the manifest. The dumps are not the documented state, and the live databases are unchanged"

MIGRATIONS_SQL='SELECT name FROM migrations ORDER BY "timestamp", id;'
check_migrations() {
  local db="$1" scratch="$2" expected_count="$3" expected_last="$4" live="luna_$1" found_count found_last
  echo "$MIGRATIONS_SQL" | sql "$db" "$scratch" | tr -d '\r' | sed '/^$/d' > "$TMP/$db.scratch.migrations"
  echo "$MIGRATIONS_SQL" | sql "$db" "$live" | tr -d '\r' | sed '/^$/d' > "$TMP/$db.live.migrations"
  found_count="$(wc -l < "$TMP/$db.scratch.migrations" | tr -d ' ')"
  found_last="$(tail -1 "$TMP/$db.scratch.migrations")"
  printf '  %-48s %8s   last %s\n' "$db migrations" "$found_count" "$found_last"
  [ "$found_count" = "$expected_count" ] \
    || refuse "the $db dump holds $found_count migrations and the manifest says $expected_count"
  [ "$found_last" = "$expected_last" ] \
    || refuse "the last $db migration of the dump is $found_last and the manifest says $expected_last"
  if ! diff "$TMP/$db.live.migrations" "$TMP/$db.scratch.migrations" > "$TMP/$db.migrations.diff"; then
    echo "  the migrations of the live $live (<) and of the dump (>) differ:" >&2
    sed 's/^/    /' "$TMP/$db.migrations.diff" >&2
    refuse "the release in this cluster does not carry exactly the migrations of the $db dump. The services would run one, or miss one (initial-catalog-2026-10.md, condition 1)"
  fi
}
check_migrations catalog "$CATALOG_SCRATCH" "$CATALOG_MIGRATIONS" "$CATALOG_LAST_MIGRATION"
check_migrations harvester "$HARVESTER_SCRATCH" "$HARVESTER_MIGRATIONS" "$HARVESTER_LAST_MIGRATION"

# A run that was PENDING or RUNNING when the dump was taken would be picked up,
# or reaped, by the harvester of the cluster.
running="$(count harvester "$HARVESTER_SCRATCH" "harvest_runs WHERE status IN ('PENDING', 'RUNNING')")"
printf '  %-48s %8s\n' 'harvest runs pending or running' "$running"
[ "$running" -eq 0 ] \
  || refuse "the harvester dump holds $running harvest run(s) that are pending or running. Take the dump with every run finished"

# ---------------------------------------------------------------------------
# Step 4
# ---------------------------------------------------------------------------

echo
echo "step 4: nothing the target holds is lost"

# `table|the column that names a row to a person`.
KEPT_TABLES='supermarkets|name
price_scopes|label
supermarket_locations|label
brands|label
product_groups|name'

# An accepted loss is a line `<table> <id> <reason>` of expected-losses.txt.
accepted_reason() {
  [ -f "$EXPECTED_LOSSES" ] || return 0
  tr -d '\r' < "$EXPECTED_LOSSES" | awk -v table="$1" -v id="$2" '
    /^[[:space:]]*#/ { next }
    $1 == table && $2 == id && NF >= 3 && $3 !~ /^</ {
      $1 = ""; $2 = ""; sub(/^ +/, ""); print; exit
    }'
}

: > "$TMP/unaccepted"
lost=0
while IFS='|' read -r table label; do
  echo "SELECT id::text FROM public.\"$table\" ORDER BY id;" \
    | sql catalog "$CATALOG_SCRATCH" | tr -d '\r' | sed '/^$/d' > "$TMP/$table.scratch.ids"
  echo "SELECT id::text || ' ' || replace(coalesce(\"$label\"::text, ''), chr(10), ' ') FROM public.\"$table\" ORDER BY id;" \
    | sql catalog luna_catalog | tr -d '\r' | sed '/^$/d' > "$TMP/$table.live.rows"
  awk 'NR == FNR { kept[$1] = 1; next } !($1 in kept)' \
    "$TMP/$table.scratch.ids" "$TMP/$table.live.rows" > "$TMP/$table.lost"
  printf '  %-48s %8s live, %s of them not in the dump\n' "$table" \
    "$(wc -l < "$TMP/$table.live.rows" | tr -d ' ')" "$(wc -l < "$TMP/$table.lost" | tr -d ' ')"
  while read -r id name; do
    lost=$((lost + 1))
    reason="$(accepted_reason "$table" "$id")"
    if [ -n "$reason" ]; then
      echo "    $table $id ($name): accepted, $reason"
    else
      echo "    $table $id ($name): NOT ACCEPTED"
      echo "$table $id <why losing \"$name\" is intended>" >> "$TMP/unaccepted"
    fi
  done < "$TMP/$table.lost"
done <<< "$KEPT_TABLES"

if [ -s "$TMP/unaccepted" ]; then
  {
    echo
    echo "The live catalog holds $(wc -l < "$TMP/unaccepted" | tr -d ' ') row(s) that the dump does not hold and that"
    echo "$EXPECTED_LOSSES does not accept. To accept one, add its line with a reason:"
    echo
    sed 's/^/  /' "$TMP/unaccepted"
  } >&2
  refuse "the restore would lose rows that nobody accepted. The live databases are unchanged"
fi
[ "$lost" -gt 0 ] || echo "  no row of the live catalog is missing from the dump"

# The harvester has no such list: its rows are replaced as a whole, against the
# ceiling of step 1. What goes and what comes is printed, so that it is seen.
report() {
  echo "$3" | sql "$1" "$2" -F ' ' | tr -d '\r' | sed '/^$/d; s/^/    /'
}

HARVESTER_COUNTS_SQL="
SELECT 'source_catalog_entries ' || status, count(*) FROM source_catalog_entries GROUP BY status ORDER BY 1;
SELECT 'source_entry_prices', count(*) FROM source_entry_prices;
SELECT 'harvest_runs', count(*) FROM harvest_runs;
SELECT 'supermarket_sources ' || CASE WHEN enabled THEN 'on' ELSE 'off' END, count(*) FROM supermarket_sources GROUP BY enabled ORDER BY 1;
SELECT 'discovered_places ' || status, count(*) FROM discovered_places GROUP BY status ORDER BY 1;
SELECT 'postal_code_discovery_requests ' || status, count(*) FROM postal_code_discovery_requests GROUP BY status ORDER BY 1;"

echo
echo "  what the live harvester holds, all of which this restore replaces:"
report harvester luna_harvester "$HARVESTER_COUNTS_SQL"

echo
echo "  the discovered places of the live harvester that a person decided. The dump"
echo "  does not hold these decisions, so store discovery offers each one again:"
decided="$(report harvester luna_harvester "
SELECT id, status, coalesce(\"brandName\", ''), coalesce(name, ''), coalesce(\"postalCode\", ''), coalesce(city, ''),
       coalesce('shop ' || \"supermarketLocationId\"::text, '')
  FROM discovered_places WHERE status <> 'NEW' ORDER BY status, \"brandName\", name;")"
if [ -n "$decided" ]; then echo "$decided"; else echo "    none"; fi

echo
echo "  what the dump brings instead. A harvester that may start runs picks up the"
echo "  postal code requests that wait, and offers every place that is NEW:"
report harvester "$HARVESTER_SCRATCH" "$HARVESTER_COUNTS_SQL"

if [ "$MODE" != apply ]; then
  echo
  echo "dry run: steps 1 to 4 passed, and no live database was changed."
  echo "The scratch databases $CATALOG_SCRATCH and $HARVESTER_SCRATCH stay, so that they can be read."
  echo "Run again with --apply to swap them in."
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 5
# ---------------------------------------------------------------------------

echo
echo "step 5: prepare the scratch databases for a cluster"

# A cluster starts with every chain off (plan 0083). The owner turns one on from
# the back office when the cluster begins to harvest by itself.
echo 'UPDATE supermarket_sources SET enabled = false WHERE enabled;' | sql harvester "$HARVESTER_SCRATCH"
enabled="$(count harvester "$HARVESTER_SCRATCH" 'supermarket_sources WHERE enabled')"
[ "$enabled" -eq 0 ] || refuse "$enabled supermarket_sources row(s) are still on in $HARVESTER_SCRATCH"
echo "  every supermarket_sources row is off"

echo "COMMENT ON DATABASE \"$CATALOG_SCRATCH\" IS '$MARKER';" | sql catalog postgres
echo "COMMENT ON DATABASE \"$HARVESTER_SCRATCH\" IS '$MARKER';" | sql harvester postgres
echo "  both carry the comment '$MARKER'"

# ---------------------------------------------------------------------------
# Step 6
# ---------------------------------------------------------------------------

echo
echo "step 6: stop the writers"

if [ "$REHEARSAL" = true ]; then
  echo "  rehearsal: there is no Deployment to scale, and the caller stopped whatever writes"
else
  for deploy in luna-shopper-backend-catalog luna-shopper-backend-harvester; do
    if ! kubectl -n "$NAMESPACE" get "deployment/$deploy" > /dev/null 2>&1; then
      echo "  $deploy: no such Deployment, so nothing to stop"
      continue
    fi
    replicas="$(kubectl -n "$NAMESPACE" get "deployment/$deploy" -o jsonpath='{.spec.replicas}')"
    REPLICAS[$deploy]="${replicas:-1}"
    WRITERS_STOPPED=true
    echo "  $deploy: ${REPLICAS[$deploy]} replica(s), stopping"
    kubectl -n "$NAMESPACE" scale "deployment/$deploy" --replicas=0 > /dev/null
    if kubectl -n "$NAMESPACE" get pods -l "app=$deploy" -o name | grep . > /dev/null; then
      kubectl -n "$NAMESPACE" wait --for=delete pod -l "app=$deploy" --timeout=3m > /dev/null
    fi
  done
fi

# ---------------------------------------------------------------------------
# Step 7
# ---------------------------------------------------------------------------

echo
echo "step 7: swap by rename"

# Both renames in one transaction, so a database is never left without the live
# name. A session that is still closing makes the rename fail for a moment, so
# it is tried three times.
rename_pair() {
  local db="$1" first_from="$2" first_to="$3" second_from="$4" second_to="$5" attempt
  for attempt in 1 2 3; do
    if echo "BEGIN;
ALTER DATABASE \"$first_from\" RENAME TO \"$first_to\";
ALTER DATABASE \"$second_from\" RENAME TO \"$second_to\";
COMMIT;" | sql "$db" postgres; then
      return 0
    fi
    [ "$attempt" = 3 ] || sleep 3
  done
  return 1
}

rename_pair catalog luna_catalog "luna_catalog${OLD_SUFFIX}" "$CATALOG_SCRATCH" luna_catalog \
  || refuse "the catalog swap failed. No database was renamed, and the live databases are unchanged"
echo "  luna_catalog is the restored database, and the old one is luna_catalog${OLD_SUFFIX}"

if ! rename_pair harvester luna_harvester "luna_harvester${OLD_SUFFIX}" "$HARVESTER_SCRATCH" luna_harvester; then
  # Two databases share no transaction, so this is the one place where the
  # script undoes its own work.
  echo "  the harvester swap failed, so the catalog is renamed back" >&2
  if rename_pair catalog luna_catalog "$CATALOG_SCRATCH" "luna_catalog${OLD_SUFFIX}" luna_catalog; then
    refuse "the harvester swap failed. The catalog is back under its old name, and both live databases are what they were"
  fi
  {
    echo
    echo "THE CATALOG COULD NOT BE RENAMED BACK. luna_catalog is the restored database and"
    echo "luna_harvester is the old one. Against the database postgres of the catalog instance, type:"
    echo "  ALTER DATABASE luna_catalog RENAME TO \"$CATALOG_SCRATCH\";"
    echo "  ALTER DATABASE \"luna_catalog${OLD_SUFFIX}\" RENAME TO luna_catalog;"
  } >&2
  exit 1
fi
echo "  luna_harvester is the restored database, and the old one is luna_harvester${OLD_SUFFIX}"

# ---------------------------------------------------------------------------
# Step 8
# ---------------------------------------------------------------------------

echo
echo "step 8: start the writers"

if [ "$REHEARSAL" = true ]; then
  echo "  rehearsal: start the two services yourself"
else
  start_writers
  for deploy in "${!REPLICAS[@]}"; do
    kubectl -n "$NAMESPACE" rollout status "deployment/$deploy" --timeout=5m | sed 's/^/  /'
  done
fi

# ---------------------------------------------------------------------------
# Steps 9 and 10
# ---------------------------------------------------------------------------

cleanup_core

echo
echo "step 10: read the result back from the live databases"
check_counts luna_catalog luna_harvester \
  || refuse "the live databases do not hold the counts of the manifest after the swap. Something wrote to them. The old databases are still there under ${OLD_SUFFIX}"
enabled="$(count harvester luna_harvester 'supermarket_sources WHERE enabled')"
printf '  %-48s %8s\n' 'supermarket_sources that are on' "$enabled"
[ "$enabled" -eq 0 ] || refuse "$enabled supermarket_sources row(s) are on after the swap"

echo
echo "applied. The databases this restore replaced are luna_catalog${OLD_SUFFIX} and"
echo "luna_harvester${OLD_SUFFIX}. They stay until a person drops them (README.md)."
