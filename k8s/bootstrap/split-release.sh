#!/usr/bin/env bash
#
# The cutover of k8s plan 0016 D5: the one release `nx-portfolio` in namespace
# nx-portfolio becomes the release `portfolio` in namespace portfolio and the
# release `velista` in namespace luna-shopper, at the image tags that run now.
#
#   split-release.sh --env <staging|production|homelab|local>          run what is left
#   split-release.sh --env <staging|production|homelab|local> --plan   print, change nothing
#   split-release.sh --status                                          none, pending or cleanup
#
# The deploy preflight of both units runs it (.github/actions/deploy-unit), and a
# person can run it by hand as the deploy account. It is a no op on a cluster
# with no namespace nx-portfolio, which is every new cluster and every cluster
# after step 7.
#
# Steps, each one safe to run again. The step reached is recorded in ConfigMap
# deploy-cutover of nx-portfolio, portfolio and luna-shopper, so a rerun
# continues from the step that failed.
#
#   1  merge the data plane (install.sh --merge-only)           edge out for seconds
#   2  delete the Helm storage of nx-portfolio; every object stays
#   3  take the MetalLB pool over (install.sh --pool-only --ip)
#   4  namespaces, copied Secrets and ledger, `helm install portfolio`, no routes
#   5  dump, move the volumes, `helm install velista`, no routes  backend out for minutes
#   6  delete the old Gateway and routes, enable both Gateways     edge out for seconds
#   7  after an hour, and every Certificate Ready: delete nx-portfolio and
#      ClusterIssuer letsencrypt-prod
#
# A failure in steps 1 to 4 leaves the old objects serving. A failure in step 5
# leaves the data on retained volumes and in the dump, and the script prints the
# command that rebinds each volume. A failure in step 6 needs a person. Nothing
# here uninstalls a release or runs Helm with --atomic, because an uninstall of
# a release that adopted live objects deletes them.
#
# Environment:
#   SPLIT_HELM_ARGS_PORTFOLIO, SPLIT_HELM_ARGS_VELISTA
#                       extra helm arguments for one unit, split on spaces
#   SPLIT_VALUES_ENV    the values file suffix for --env local (default local)
#   CLEANUP_AFTER       seconds between step 6 and step 7 (default 3600)
#   DUMP_TIMEOUT        seconds to wait for one dump (default 900)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$HERE")"
# shellcheck source=../units/unit-env.sh
. "$K8S_DIR/units/unit-env.sh"
# shellcheck source=./host-lock.sh
. "$HERE/host-lock.sh"

OLD_NS=nx-portfolio
OLD_RELEASE=nx-portfolio
MARKER=deploy-cutover
CLEANUP_AFTER="${CLEANUP_AFTER:-3600}"
DUMP_TIMEOUT="${DUMP_TIMEOUT:-900}"
STEP_NAMES=(
  ''
  'merge the data plane'
  'make Helm forget nx-portfolio'
  'take the MetalLB pool over'
  'prepare both namespaces and install portfolio'
  "move velista's data and install velista"
  'swap the Gateways'
  'clean up'
)

ENVIRONMENT=''
MODE=run
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="${2:-}"; shift 2 ;;
    --plan) MODE=plan; shift ;;
    --status) MODE=status; shift ;;
    -h | --help) sed -n '2,42p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${KUBECONFIG:-}" ] && [ -r /etc/rancher/k3s/k3s.yaml ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
fi

die() { echo "split-release: $*" >&2; exit 1; }

# A kubectl get that answers "absent" only for NotFound. Any other failure
# stops the script: a cluster that does not answer is not an empty one.
get_or_empty() {
  local out
  if out="$(kubectl "$@" 2>&1)"; then
    [ -z "$out" ] || printf '%s\n' "$out"
    return 0
  fi
  case "$out" in *NotFound* | *'not found'*) return 0 ;; esac
  die "kubectl $* failed: $out"
}

namespace_exists() { [ -n "$(get_or_empty get namespace "$1" -o name)" ]; }

marker_get() {
  namespace_exists "$1" || return 0
  get_or_empty -n "$1" get configmap "$MARKER" \
    -o go-template="{{if .data}}{{with index .data \"$2\"}}{{.}}{{end}}{{end}}"
}

# Writes one key into the marker of every namespace of the cutover that exists.
marker_set() {
  local ns
  for ns in "$OLD_NS" portfolio luna-shopper; do
    namespace_exists "$ns" || continue
    kubectl -n "$ns" create configmap "$MARKER" --dry-run=client -o yaml \
      | kubectl apply -f - > /dev/null
    kubectl -n "$ns" patch configmap "$MARKER" --type merge \
      -p "{\"data\":{\"$1\":\"$2\"}}" > /dev/null
  done
}

# The last step finished, 0 when none.
current_step() {
  local step=''
  if namespace_exists "$OLD_NS"; then
    step="$(marker_get "$OLD_NS" step)"
  else
    step="$(marker_get luna-shopper step)"
    [ -n "$step" ] || step=7
  fi
  printf '%s' "${step:-0}"
}

status() {
  local step
  if ! namespace_exists "$OLD_NS"; then
    echo none
    return
  fi
  step="$(current_step)"
  if [ "$step" -ge 6 ]; then echo cleanup; else echo pending; fi
}

if [ "$MODE" = status ]; then
  status
  exit 0
fi

case "$ENVIRONMENT" in
  staging | production | homelab) VALUES_ENV="$ENVIRONMENT" ;;
  local)
    VALUES_ENV="${SPLIT_VALUES_ENV:-local}"
    # A rehearsal on the wrong context would be a cutover of a real cluster.
    context="$(kubectl config current-context 2> /dev/null || true)"
    [ "$context" = docker-desktop ] \
      || die "--env local runs only against the context docker-desktop, and this one is '$context'"
    ;;
  *) die "--env must be staging, production, homelab or local" ;;
esac

load_unit "$K8S_DIR" portfolio > /dev/null
P_NS="$NAMESPACE" P_RELEASE="$RELEASE_NAME" P_CHART="$CHART_PATH"
load_unit "$K8S_DIR" velista > /dev/null
V_NS="$NAMESPACE" V_RELEASE="$RELEASE_NAME" V_CHART="$CHART_PATH" V_SECRETS="$SECRETS"

# The values arguments of one unit, one per line so a path with no space
# survives `mapfile`.
values_args() {
  local chart="$1" extra="$2" file
  printf '%s\n' --values "$chart/values.yaml"
  file="$chart/values.$VALUES_ENV.yaml"
  if [ -f "$file" ]; then
    printf '%s\n' --values "$file"
  elif [ "$ENVIRONMENT" != local ]; then
    die "$file does not exist"
  fi
  # shellcheck disable=SC2086
  [ -z "$extra" ] || printf '%s\n' $extra
}
mapfile -t P_VALUES < <(values_args "$P_CHART" "${SPLIT_HELM_ARGS_PORTFOLIO:-}")
mapfile -t V_VALUES < <(values_args "$V_CHART" "${SPLIT_HELM_ARGS_VELISTA:-}")

render() {
  local unit="$1" tag="$2"
  if [ "$unit" = portfolio ]; then
    helm template "$P_RELEASE" "$P_CHART" --namespace "$P_NS" "${P_VALUES[@]}" \
      --set imageTag="$tag" --set gateway.enabled=true
  else
    helm template "$V_RELEASE" "$V_CHART" --namespace "$V_NS" "${V_VALUES[@]}" \
      --set imageTag="$tag" --set gateway.enabled=true
  fi
}

# The Secret names the rendered Gateway's listeners read their certificates from.
tls_secrets() {
  awk '
    /^---/ { gateway = 0 }
    /^kind:[[:space:]]+Gateway[[:space:]]*$/ { gateway = 1 }
    gateway && /^[[:space:]]+name:[[:space:]]+[^[:space:]]+-tls[[:space:]]*$/ { print $2 }
  ' | sort -u
}

gateway_docs() {
  awk '
    /^---/ { if (gateway) print buffer; buffer = ""; gateway = 0; next }
    { buffer = buffer $0 "\n" }
    /^kind:[[:space:]]+Gateway[[:space:]]*$/ { gateway = 1 }
    END { if (gateway) print buffer }
  '
}

image_tag() {
  local image
  image="$(get_or_empty -n "$OLD_NS" get deployment "$1" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')"
  if [ -n "$image" ]; then printf '%s' "${image##*:}"; fi
}

# The tags the live pods run, read once and kept in the marker, because step 5
# deletes the Deployment the velista tag is read from.
live_tags() {
  P_TAG="$(marker_get "$OLD_NS" portfolioTag)"
  V_TAG="$(marker_get "$OLD_NS" velistaTag)"
  [ -n "$P_TAG" ] || P_TAG="$(image_tag shell)"
  [ -n "$V_TAG" ] || V_TAG="$(image_tag luna-shopper-backend-gateway)"
  [ -n "$P_TAG" ] || die "cannot read the live tag of the portfolio from deployment/shell in $OLD_NS"
  [ -n "$V_TAG" ] || die "cannot read the live tag of velista from deployment/luna-shopper-backend-gateway in $OLD_NS"
}

for tool in kubectl helm; do
  command -v "$tool" > /dev/null 2>&1 || die "$tool is required"
done

if [ "$(status)" = none ]; then
  echo "split-release: no namespace $OLD_NS, so there is nothing to split"
  exit 0
fi

# The script refuses to start when it cannot render both charts.
helm dependency build --skip-refresh "$P_CHART" > /dev/null
helm dependency build --skip-refresh "$V_CHART" > /dev/null
live_tags
P_RENDER="$(render portfolio "$P_TAG")" || die "cannot render $P_CHART"
V_RENDER="$(render velista "$V_TAG")" || die "cannot render $V_CHART"

# ---------------------------------------------------------------------------
# The object lists, which --plan prints and the steps act on.
# ---------------------------------------------------------------------------
helm_storage() {
  get_or_empty -n "$OLD_NS" get secret -l "owner=helm,name=$OLD_RELEASE" -o name
}
# Every claim of nx-portfolio as claim=volume. Kept in the marker once read,
# because step 5 deletes the claims.
volume_pairs() {
  local pairs
  pairs="$(marker_get "$OLD_NS" volumes)"
  if [ -z "$pairs" ]; then
    pairs="$(get_or_empty -n "$OLD_NS" get pvc \
      -o jsonpath='{range .items[*]}{.metadata.name}={.spec.volumeName}{" "}{end}')"
  fi
  printf '%s' "$pairs"
}
luna_statefulsets() {
  get_or_empty -n "$OLD_NS" get statefulset -o name | grep '/luna-shopper-backend-' || true
}
luna_deployments() {
  get_or_empty -n "$OLD_NS" get deployment -o name | grep '/luna-shopper-backend-' || true
}
backup_cronjobs() {
  get_or_empty -n "$OLD_NS" get cronjob -o name | grep -- '-db-backup$' || true
}
pool_address() {
  local address
  address="$(get_or_empty -n metallb-system get ipaddresspool main-pool \
    -o jsonpath='{.spec.addresses[0]}')"
  printf '%s' "${address%/32}"
}

presence() {
  if [ -n "$(get_or_empty -n "$OLD_NS" get "$1" "$2" -o name)" ]; then
    echo "in $OLD_NS"
  else
    echo "absent from $OLD_NS, so not copied"
  fi
}

plan() {
  local step pv pvc pair secret
  step="$(current_step)"
  echo "split-release plan, env $ENVIRONMENT, cluster $(kubectl config current-context 2> /dev/null || echo '?')"
  echo "  status: $(status), last finished step: $step"
  echo "  live tags: portfolio $P_TAG, velista $V_TAG"
  echo
  echo "step 1, merge: GatewayClass eg parametersRef is '$(get_or_empty get gatewayclass eg -o jsonpath='{.spec.parametersRef.name}')'"
  get_or_empty -n envoy-gateway-system get svc -o wide | sed 's/^/  /'
  echo
  echo "step 2, the Helm storage of $OLD_RELEASE to delete:"
  helm_storage | sed 's/^/  /'
  echo
  echo "step 3, the pool: address '$(pool_address)', owner '$(get_or_empty -n metallb-system get ipaddresspool main-pool -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}')'"
  echo
  echo "step 4, copied into $P_NS:"
  for secret in $(printf '%s\n' "$P_RENDER" | tls_secrets); do
    echo "  secret/$secret $(presence secret "$secret")"
  done
  echo "step 4, copied into $V_NS:"
  for secret in $(printf '%s\n' "$V_RENDER" | tls_secrets) $V_SECRETS; do
    echo "  secret/$secret $(presence secret "$secret")"
  done
  echo "  configmap/release-tasks $(presence configmap release-tasks)"
  echo
  echo "step 5, dumps through:"
  backup_cronjobs | sed 's/^/  /'
  echo "step 5, deleted in $OLD_NS:"
  { luna_statefulsets; luna_deployments; } | sed 's/^/  /'
  echo "step 5, volumes rebound to $V_NS (claim, volume, class, size, reclaim policy):"
  for pair in $(volume_pairs); do
    pvc="${pair%%=*}"
    pv="${pair#*=}"
    echo "  $pvc $pv $(get_or_empty get pv "$pv" -o jsonpath='{.spec.storageClassName} {.spec.capacity.storage} {.spec.persistentVolumeReclaimPolicy}')"
  done
  echo "  priorityclass/luna-stateful owner '$(get_or_empty get priorityclass luna-stateful -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}')'"
  echo
  echo "step 6, deleted in $OLD_NS:"
  get_or_empty -n "$OLD_NS" get gateway,httproute -o name | sed 's/^/  /'
  echo "step 6, the Gateway of $P_RELEASE:"
  printf '%s\n' "$P_RENDER" | gateway_docs | sed 's/^/    /'
  echo "step 6, the Gateway of $V_RELEASE:"
  printf '%s\n' "$V_RENDER" | gateway_docs | sed 's/^/    /'
  echo
  echo "step 7, the namespace $OLD_NS is deleted with what is left in it:"
  get_or_empty -n "$OLD_NS" get deployment,statefulset,service,cronjob,configmap,secret,pvc -o name \
    | awk -F/ '{ count[$1]++ } END { for (k in count) printf "  %s: %d\n", k, count[k] }' | sort
  echo "step 7, and clusterissuer/letsencrypt-prod $([ -n "$(get_or_empty get clusterissuer letsencrypt-prod -o name)" ] && echo present || echo absent)"
}

if [ "$MODE" = plan ]; then
  plan
  exit 0
fi

host_lock

STEP=0
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$STEP" -gt 0 ]; then
    echo >&2
    echo "split-release: step $STEP (${STEP_NAMES[$STEP]}) failed. A rerun continues from it." >&2
    if [ "$STEP" -le 4 ]; then
      echo "  The old release still serves: nothing it routes was touched." >&2
    elif [ "$STEP" -eq 5 ]; then
      print_rebind >&2
    else
      echo "  Read both Gateways, both releases and the Envoy status:" >&2
      echo "    kubectl get gateway -A; helm list -A; kubectl get svc -n envoy-gateway-system" >&2
    fi
  fi
}
trap on_exit EXIT

print_rebind() {
  local pair pvc pv
  echo "  The volumes have reclaim policy Retain and keep their data. Each one and"
  echo "  the command that binds it to a claim of the same name in $V_NS:"
  for pair in $(volume_pairs); do
    pvc="${pair%%=*}"
    pv="${pair#*=}"
    echo "    $pv: kubectl patch pv $pv --type merge -p '{\"spec\":{\"claimRef\":{\"namespace\":\"$V_NS\",\"name\":\"$pvc\",\"uid\":null,\"resourceVersion\":null}}}'"
  done
  echo "  then create each claim in $V_NS with spec.volumeName set, or the same in"
  echo "  $OLD_NS to put them back. The dump keys are in configmap/$MARKER, key dumps."
}

begin() {
  STEP="$1"
  STEP_STARTED="$(date +%s)"
  echo
  echo "==> step $STEP: ${STEP_NAMES[$STEP]}"
}
finish() {
  marker_set step "$STEP"
  echo "    step $STEP done in $(($(date +%s) - STEP_STARTED))s"
}

wait_programmed() {
  local ns="$1" name="$2" waited=0
  until [ "$(get_or_empty -n "$ns" get gateway "$name" \
    -o jsonpath='{.status.conditions[?(@.type=="Programmed")].status}')" = True ]; do
    [ "$waited" -lt 300 ] || die "gateway/$name in $ns is not Programmed after 300s"
    sleep 2
    waited=$((waited + 2))
  done
}

# A copy that strips everything but the data, so cert-manager and Helm see a
# plain Secret. Created only when absent: after step 6 cert-manager replaces
# the copied certificate, and a rerun must not put the old one back.
copy_secret() {
  local name="$1" to="$2" source existing
  source="$(get_or_empty -n "$OLD_NS" get secret "$name" -o go-template='type: {{.type}}
data:
{{range $k, $v := .data}}  {{$k}}: {{$v}}
{{end}}')"
  if [ -z "$source" ]; then
    echo "    secret/$name is not in $OLD_NS; skipped"
    return 0
  fi
  existing="$(get_or_empty -n "$to" get secret "$name" -o go-template='type: {{.type}}
data:
{{range $k, $v := .data}}  {{$k}}: {{$v}}
{{end}}')"
  if [ -n "$existing" ]; then
    if [ "$existing" = "$source" ]; then
      echo "    secret/$name already in $to"
      return 0
    fi
    case "$name" in
      *-tls)
        echo "    secret/$name in $to differs from the old one; kept (cert-manager wrote it)"
        return 0
        ;;
    esac
    die "secret/$name exists in $to with other values. A new HARVESTER_ACTOR_ID or new JWT keys break live data and sessions. Compare the two by hand and delete the one in $to only if it is the wrong one."
  fi
  printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\n%s\n' \
    "$name" "$to" "$source" | kubectl create -f - > /dev/null
  echo "    secret/$name copied into $to"
}

copy_ledger() {
  local data
  if [ -n "$(get_or_empty -n "$V_NS" get configmap release-tasks -o name)" ]; then
    echo "    configmap/release-tasks already in $V_NS"
    return 0
  fi
  if [ -z "$(get_or_empty -n "$OLD_NS" get configmap release-tasks -o name)" ]; then
    echo "    configmap/release-tasks is not in $OLD_NS; skipped"
    return 0
  fi
  # The ledger's values are task names, states, dates and s3 keys, which
  # run-release-tasks.sh writes with no character that needs quoting.
  data="$(kubectl -n "$OLD_NS" get configmap release-tasks -o go-template='{{range $k, $v := .data}}  {{printf "%q" $k}}: {{printf "%q" $v}}
{{end}}')"
  printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: release-tasks\n  namespace: %s\ndata:\n%s\n' \
    "$V_NS" "$data" | kubectl create -f - > /dev/null
  echo "    configmap/release-tasks copied into $V_NS"
}

helm_unit() {
  local unit="$1" gateway="$2" timeout="$3"
  if [ "$unit" = portfolio ]; then
    helm upgrade --install "$P_RELEASE" "$P_CHART" --namespace "$P_NS" "${P_VALUES[@]}" \
      --set imageTag="$P_TAG" --set gateway.enabled="$gateway" --wait --timeout "$timeout"
  else
    helm upgrade --install "$V_RELEASE" "$V_CHART" --namespace "$V_NS" "${V_VALUES[@]}" \
      --set imageTag="$V_TAG" --set gateway.enabled="$gateway" --wait --timeout "$timeout"
  fi
}

dump_databases() {
  local cronjob job conditions waited key keys='' found
  found="$(backup_cronjobs)"
  if [ "$ENVIRONMENT" = local ]; then
    echo "    --env local: no object storage, so no dump"
    return 0
  fi
  for sts in $(luna_statefulsets); do
    case "$sts" in
      */*-db)
        [ -n "$(printf '%s\n' "$found" | grep -x "cronjob.batch/${sts#*/}-backup")" ] \
          || die "${sts#*/} has no backup CronJob, so step 5 cannot take its dump"
        ;;
    esac
  done
  for cronjob in $found; do
    job="split-${cronjob#*/}-$(date -u +%Y%m%d%H%M%S)"
    job="${job:0:63}"
    kubectl -n "$OLD_NS" create job "$job" --from="$cronjob" > /dev/null
    waited=0
    while :; do
      conditions="$(kubectl -n "$OLD_NS" get "job/$job" \
        -o jsonpath='{.status.conditions[?(@.status=="True")].type}')"
      case " $conditions " in
        *' Complete '*) break ;;
        *' Failed '*) kubectl -n "$OLD_NS" logs "job/$job" --tail=30 >&2 || true; die "job/$job failed" ;;
      esac
      [ "$waited" -lt "$DUMP_TIMEOUT" ] || die "job/$job did not complete in ${DUMP_TIMEOUT}s"
      sleep 5
      waited=$((waited + 5))
    done
    key="$(kubectl -n "$OLD_NS" logs "job/$job" | sed -n 's/^uploaded //p' | tail -1)"
    [ -n "$key" ] || die "job/$job completed and printed no uploaded key"
    echo "    ${cronjob#*/}: $key"
    keys="$keys ${cronjob#*/}=$key"
  done
  marker_set dumps "${keys# }"
}

wait_pods_gone() {
  local waited=0
  while [ -n "$(get_or_empty -n "$OLD_NS" get pods -o name | grep '/luna-shopper-backend-' || true)" ]; do
    [ "$waited" -lt 300 ] || die "the Luna pods of $OLD_NS did not stop in 300s"
    sleep 3
    waited=$((waited + 3))
  done
}

rebind_volume() {
  local pvc="$1" pv="$2" spec
  kubectl patch pv "$pv" --type merge \
    -p "{\"spec\":{\"claimRef\":{\"apiVersion\":\"v1\",\"kind\":\"PersistentVolumeClaim\",\"namespace\":\"$V_NS\",\"name\":\"$pvc\",\"uid\":null,\"resourceVersion\":null}}}" > /dev/null
  if [ -n "$(get_or_empty -n "$V_NS" get pvc "$pvc" -o name)" ]; then
    echo "    $pvc already in $V_NS"
    return 0
  fi
  spec="$(kubectl get pv "$pv" -o go-template='  storageClassName: {{.spec.storageClassName}}
  accessModes:
{{range .spec.accessModes}}    - {{.}}
{{end}}  resources:
    requests:
      storage: {{index .spec.capacity "storage"}}')"
  printf 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: %s\n  namespace: %s\nspec:\n  volumeName: %s\n%s\n' \
    "$pvc" "$V_NS" "$pv" "$spec" | kubectl create -f - > /dev/null
  echo "    $pv bound to $V_NS/$pvc"
}

STEP_DONE="$(current_step)"
echo "split-release: env $ENVIRONMENT, last finished step $STEP_DONE, live tags portfolio $P_TAG, velista $V_TAG"
marker_set portfolioTag "$P_TAG"
marker_set velistaTag "$V_TAG"

if [ "$STEP_DONE" -lt 1 ]; then
  begin 1
  bash "$HERE/install.sh" --merge-only
  finish
fi

if [ "$STEP_DONE" -lt 2 ]; then
  begin 2
  storage="$(helm_storage)"
  if [ -n "$storage" ]; then
    # shellcheck disable=SC2086
    kubectl -n "$OLD_NS" delete $storage
  fi
  # helm uninstall is never used: it decides what to keep from the stored
  # manifest, not from live annotations, and would delete the pool and Gateway.
  finish
fi

if [ "$STEP_DONE" -lt 3 ]; then
  begin 3
  address="$(pool_address)"
  if [ -z "$address" ]; then
    echo "    no IPAddressPool main-pool on this cluster; nothing to take over"
  else
    # The release's storage is gone, so the pool is unowned. Its Helm
    # annotations are removed too, so that what owns it is plain to read.
    for object in ipaddresspool/main-pool l2advertisement/main-advertisement; do
      kubectl -n metallb-system annotate "$object" \
        meta.helm.sh/release-name- meta.helm.sh/release-namespace- > /dev/null 2>&1 || true
      kubectl -n metallb-system label "$object" app.kubernetes.io/managed-by- > /dev/null 2>&1 || true
    done
    bash "$HERE/install.sh" --pool-only --ip "$address"
  fi
  finish
fi

if [ "$STEP_DONE" -lt 4 ]; then
  begin 4
  for ns in "$P_NS" "$V_NS"; do
    kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - > /dev/null
  done
  marker_set step 3
  for secret in $(printf '%s\n' "$P_RENDER" | tls_secrets); do copy_secret "$secret" "$P_NS"; done
  for secret in $(printf '%s\n' "$V_RENDER" | tls_secrets) $V_SECRETS; do copy_secret "$secret" "$V_NS"; done
  copy_ledger
  echo "    helm install $P_RELEASE at $P_TAG, no Gateway"
  helm_unit portfolio false 10m
  finish
fi

if [ "$STEP_DONE" -lt 5 ]; then
  begin 5
  pairs="$(volume_pairs)"
  [ -n "$pairs" ] || die "no PersistentVolumeClaim in $OLD_NS and none recorded, so there is no data to move"
  marker_set volumes "$pairs"
  if [ "$(marker_get "$OLD_NS" moved)" != yes ]; then
    if [ -z "$(marker_get "$OLD_NS" dumps)" ]; then
      dump_databases
    fi
    for pair in $pairs; do
      kubectl patch pv "${pair#*=}" --type merge \
        -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' > /dev/null
    done
    echo "    volumes set to Retain: $pairs"
    if [ -n "$(get_or_empty get priorityclass luna-stateful -o name)" ]; then
      kubectl annotate --overwrite priorityclass luna-stateful \
        "meta.helm.sh/release-name=$V_RELEASE" "meta.helm.sh/release-namespace=$V_NS" > /dev/null
      kubectl label --overwrite priorityclass luna-stateful app.kubernetes.io/managed-by=Helm > /dev/null
    fi
    # The old backup CronJobs would fail every night against a database that
    # is gone. The velista release renders its own in luna-shopper.
    for cronjob in $(backup_cronjobs); do
      kubectl -n "$OLD_NS" patch "$cronjob" -p '{"spec":{"suspend":true}}' > /dev/null
    done
    echo "    the backend is down from here until velista is Ready"
    BACKEND_DOWN="$(date +%s)"
    marker_set backendDownAt "$BACKEND_DOWN"
    workloads="$(luna_statefulsets; luna_deployments)"
    if [ -n "$workloads" ]; then
      # shellcheck disable=SC2086
      kubectl -n "$OLD_NS" delete $workloads --wait=false
    fi
    wait_pods_gone
    claims=''
    for pair in $pairs; do claims="$claims pvc/${pair%%=*}"; done
    # shellcheck disable=SC2086
    kubectl -n "$OLD_NS" delete $claims --ignore-not-found
    for pair in $pairs; do rebind_volume "${pair%%=*}" "${pair#*=}"; done
    marker_set moved yes
  fi
  echo "    helm install $V_RELEASE at $V_TAG, no Gateway"
  helm_unit velista false 20m
  down_at="$(marker_get "$OLD_NS" backendDownAt)"
  [ -z "$down_at" ] || echo "    the backend was down for $(($(date +%s) - down_at))s"
  finish
fi

if [ "$STEP_DONE" -lt 6 ]; then
  begin 6
  echo "    the edge is down from here until both Gateways are Programmed"
  edge_down="$(date +%s)"
  kubectl -n "$OLD_NS" delete gateway --all --wait=true
  kubectl -n "$OLD_NS" delete httproute --all
  helm_unit portfolio true 10m
  helm_unit velista true 20m
  wait_programmed "$P_NS" "$P_RELEASE"
  wait_programmed "$V_NS" "$V_RELEASE"
  echo "    the edge was down for $(($(date +%s) - edge_down))s"
  marker_set step6At "$(date +%s)"
  finish
fi

if [ "$STEP_DONE" -lt 7 ]; then
  begin 7
  swapped="$(marker_get "$OLD_NS" step6At)"
  ready_at=$((${swapped:-0} + CLEANUP_AFTER))
  if [ "$(date +%s)" -lt "$ready_at" ]; then
    echo "    waits until $(date -u -d "@$ready_at" +%Y-%m-%dT%H:%MZ 2> /dev/null || echo "$ready_at") (one hour after the swap); a later deploy finishes it"
    STEP=0
    exit 0
  fi
  not_ready="$(for ns in "$P_NS" "$V_NS"; do
    kubectl -n "$ns" get certificate -o go-template='{{range .items}}{{$ready := "False"}}{{range .status.conditions}}{{if eq .type "Ready"}}{{$ready = .status}}{{end}}{{end}}{{if or (ne $ready "True") (eq .spec.issuerRef.name "letsencrypt-prod")}}{{.metadata.namespace}}/{{.metadata.name}} {{end}}{{end}}'
  done)"
  if [ -n "$not_ready" ]; then
    echo "    waits for the Certificates to be Ready under their unit's issuer: $not_ready"
    STEP=0
    exit 0
  fi
  kubectl delete namespace "$OLD_NS" --timeout=10m
  kubectl delete clusterissuer letsencrypt-prod --ignore-not-found
  kubectl -n cert-manager delete secret letsencrypt-prod-account-key --ignore-not-found
  marker_set step 7
  echo "    $OLD_NS and ClusterIssuer letsencrypt-prod deleted; the volumes stay, bound in $V_NS"
fi

STEP=0
echo
echo "split-release: done. helm list -A:"
helm list -A
