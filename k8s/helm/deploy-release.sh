#!/usr/bin/env bash
#
# Deploy (or roll back) production to a specific release version.
#
# Production apps are pinned to an immutable image tag (the release version, e.g.
# 1.1.3), passed straight to `helm upgrade` as `--set imageTag`.
#
# Rolling back is the same operation with an older version whose images still
# exist in the registry:
#
#   ./deploy-release.sh velista 1.1.3     # deploy release 1.1.3 of the velista unit
#   ./deploy-release.sh velista 1.0.0     # roll it back to 1.0.0
#
# The unit (k8s plan 0015 D10) names a directory of k8s/units, whose unit.env
# gives the chart, the namespace and the release. With a version and no unit,
# the script deploys the release nx-portfolio of the old chart, which
# release.yml still calls until plan 0016 replaces it:
#
#   ./deploy-release.sh 1.1.3
#
# The `/root/helm-live/prod-tag.yaml` file this used to write is gone (plan 0002,
# section 2.3). It existed only because a staging deploy and a production deploy
# shared one Helm release, so the staging upgrade had to be told the live
# production version in order not to clobber it. Staging is a different cluster
# now, and two releases on two clusters cannot collide — so the pinned version is
# just an argument to this command, and `helm history` remains the record of what
# was deployed when.
#
# Environment overrides:
#   RELEASE_NAME    helm release name        (old chart only, default: nx-portfolio)
#   NAMESPACE       kubernetes namespace     (old chart only, default: nx-portfolio)
#   TIMEOUT         helm/rollout wait        (default: 10m, 20m on a first install)
#   KUBECONFIG      kubeconfig path          (default: /etc/rancher/k3s/k3s.yaml)

set -euo pipefail

HELM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$HELM_DIR")"

UNIT_NAME=""
case $# in
  1) VERSION="$1" ;;
  2) UNIT_NAME="$1"; VERSION="$2" ;;
  *) VERSION="" ;;
esac
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <unit> <release-version>" >&2
  echo "Example: $0 velista 1.1.3" >&2
  exit 1
fi

if [ -n "$UNIT_NAME" ]; then
  # shellcheck source=../units/unit-env.sh
  . "$K8S_DIR/units/unit-env.sh"
  load_unit "$K8S_DIR" "$UNIT_NAME"
  CHART_DIR="$CHART_PATH"
  TASKS_UNIT=(--unit "$UNIT_NAME")
  # The library chart is packaged from the committed Chart.lock, offline.
  helm dependency build --skip-refresh "$CHART_DIR" > /dev/null
else
  CHART_DIR="$HELM_DIR"
  RELEASE_NAME="${RELEASE_NAME:-nx-portfolio}"
  NAMESPACE="${NAMESPACE:-nx-portfolio}"
  TASKS_UNIT=()
  echo "No unit: deploying the release $RELEASE_NAME of the old chart."
fi
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# ---------------------------------------------------------------------------
# What state is the release in before anything touches it?
#
# A first install that does not finish leaves a release record but no chart
# resources, and that combination is a trap helm cannot climb out of on its own.
# The record makes every later deploy an UPGRADE, so it runs the pre-upgrade
# hooks, and those hooks expect the resources a successful install would have
# created. Here that means the migration Job looking for a ConfigMap that has
# never existed, failing CreateContainerConfigError until the timeout, forever.
# Production sat in exactly that loop across 0.2.0, 0.2.1 and 0.2.2.
#
# So the question worth asking is not what the current status is called. It is
# whether any revision of this release has ever been live. Two different labels
# describe the same wreckage, depending only on how the attempt ended:
#
#   pending-install  the deploy process was KILLED. helm writes pending before
#                    it waits, so nothing ever wrote the outcome. That is what a
#                    reaped SSH connection does, via SIGHUP.
#   failed           helm gave up on its own, cleanly, and said so.
#
# Neither has anything to preserve, and both block the install that would fix
# them. Keying on `pending-install` alone caught the first and missed the
# second, which is how 0.2.2 still failed with the guard in place.
# ---------------------------------------------------------------------------
RELEASE_STATUS="$(helm status "$RELEASE_NAME" --namespace "$NAMESPACE" 2>/dev/null \
  | sed -n 's/^STATUS: //p' | head -1 || true)"
RELEASE_STATUS="${RELEASE_STATUS:-none}"

# Has any revision ever been live? `deployed` is the current one, `superseded` a
# previous one, and a release that has neither has never served a request.
#
# Read from the JSON rather than the table, whose UPDATED column contains spaces
# and defeats column counting, and with grep rather than jq, which is not
# installed on the VPS and is not worth requiring for one field.
EVER_DEPLOYED=false
if [ "$RELEASE_STATUS" != none ] \
  && helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --output json 2>/dev/null \
    | grep '"status":"\(deployed\|superseded\)"' > /dev/null; then
  EVER_DEPLOYED=true
fi

if [ "$RELEASE_STATUS" != none ] && [ "$EVER_DEPLOYED" = false ]; then
  # A release that adopted live objects (the cutover of plan 0016 writes the
  # ConfigMap deploy-cutover) has a failed first revision and still serves, and
  # an uninstall would delete what it adopted. A StatefulSet in the namespace is
  # the same warning from the data's side. Both refuse (k8s plan 0015 D10).
  adopted=""
  if kubectl -n "$NAMESPACE" get configmap deploy-cutover >/dev/null 2>&1; then
    adopted="the namespace holds the ConfigMap deploy-cutover, so this release adopted live objects"
  elif [ -n "$(kubectl -n "$NAMESPACE" get statefulsets -o name 2>/dev/null || true)" ]; then
    adopted="the namespace holds a StatefulSet, so a database may live under this release"
  fi
  if [ -n "$adopted" ]; then
    echo "Release '${RELEASE_NAME}' has no deployed revision, and ${adopted}." >&2
    echo "Uninstalling it could delete live data, so this script stops. Read" >&2
    echo "  helm history ${RELEASE_NAME} --namespace ${NAMESPACE}" >&2
    echo "  kubectl -n ${NAMESPACE} get pods,statefulsets" >&2
    echo "and fix the failed revision with a helm upgrade, never an uninstall." >&2
    exit 1
  fi

  # Cleared automatically, because there is provably nothing to lose. No
  # revision has ever served traffic and there is no earlier one to roll back
  # to, so removing the record and installing fresh is the only way forward as
  # well as the safe one.
  #
  # It does not take the databases with it either. The only persistent storage
  # in this chart comes from StatefulSet volumeClaimTemplates (postgres and
  # nats), and Kubernetes deliberately leaves those PVCs behind when the
  # StatefulSet goes away. There are no standalone PVCs in the chart, so
  # `helm uninstall` cannot delete a volume.
  echo "Release '${RELEASE_NAME}' exists in state '${RELEASE_STATUS}' but no revision of"
  echo "it has ever been live, so an earlier first install never finished. Removing"
  echo "the record and installing fresh, which is what lets the install path (and"
  echo "its post-install migrations) run at all. The postgres and nats volumes are"
  echo "not helm's to delete and stay where they are."
  helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE" --wait --timeout 5m
  RELEASE_STATUS=none
elif [ "$RELEASE_STATUS" = pending-upgrade ] || [ "$RELEASE_STATUS" = pending-rollback ]; then
  # NOT cleared automatically. Here a revision did deploy and its pods may be
  # serving production right now. Choosing between rolling back and letting the
  # operation stand is a judgement about live traffic, and a deploy script that
  # silently makes it is a script nobody can trust with the next release. It
  # says what to run instead.
  echo "Release '${RELEASE_NAME}' is stuck in ${RELEASE_STATUS}, left behind by a" >&2
  echo "deploy that was killed mid flight. An earlier revision is still live, so" >&2
  echo "this script will not decide for you. Look at what is running, then:" >&2
  echo >&2
  echo "  helm history ${RELEASE_NAME} --namespace ${NAMESPACE}" >&2
  echo "  helm rollback ${RELEASE_NAME} --namespace ${NAMESPACE}   # to the last deployed revision" >&2
  echo >&2
  echo "and run this script again." >&2
  exit 1
fi

# A first install is a different amount of work from an upgrade, so it gets a
# different budget. 10m is measured against the slowest ordinary path: three
# migration Jobs, then Deployments rolling behind a readiness probe. A first
# install adds every image pull in the chart on a single small node, which is
# the one case that reliably exceeds it, and a --wait that times out fails the
# release rather than merely reporting slowly.
if [ "$RELEASE_STATUS" = none ]; then
  TIMEOUT="${TIMEOUT:-20m}"
  echo "No existing release, so this is a first install. Waiting up to ${TIMEOUT}."
else
  TIMEOUT="${TIMEOUT:-10m}"
fi

# Release tasks (k8s/release-tasks): the pre phase dumps what each due task
# touches and runs its pre.sh, before the upgrade's migrations. A failure stops
# the deploy here, with nothing upgraded. The version goes with it, because a
# task runs in production only in the one release its task.env names (k8s plan
# 0011).
bash "$K8S_DIR/release-tasks/run-release-tasks.sh" "${TASKS_UNIT[@]}" \
  --env production --phase pre --release "$VERSION"

echo "Upgrading helm release '${RELEASE_NAME}' in namespace '${NAMESPACE}' to ${VERSION}"

# --wait, because without it `helm upgrade` returns as soon as the API server has
# accepted the manifests, and this script would report success while pods
# crashloop or a rollout blocks forever (plan 0003).
#
# It also covers the migration Jobs for free: they are pre-upgrade hooks, so a
# migration that fails through its backoffLimit fails the upgrade before any new
# pod takes traffic. That is the behaviour plan 0027 assumes and nothing
# previously enforced.
#
# The one deploy that migrates post-upgrade instead is the one that introduces a
# service's database, which cannot migrate before the StatefulSet that provides
# one; migration-job.yaml.tpl detects that case per cluster and explains it. A
# failure there still fails this script, because --wait covers post hooks too.
# Production reaches that case when the harvester is enabled here (k8s plan
# 0008), after staging's soak.
#
# Deliberately NOT --atomic, unlike the staging deploy. --atomic on production
# turns a partial failure into an automatic rollback of the whole release,
# including the pods that ran alongside database migrations — and migrations do
# not roll back with them. It is in fact safe here, BECAUSE migrations are expand
# and contract and therefore backward compatible, so rolling the pods back leaves
# them talking to a newer but compatible schema. That reasoning is written down
# rather than assumed, and adopting --atomic here is the recommendation once a
# release has been rehearsed on staging with it enabled.
helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$CHART_DIR/values.yaml" \
  --values "$CHART_DIR/values.production.yaml" \
  --set imageTag="$VERSION" \
  --wait --timeout "$TIMEOUT"

# A statement a script makes about the world should be one it verified, or it
# trains the reader to disbelieve the output. This used to print "Production is
# now serving release X" immediately after a command it had not checked.
if [ -n "$UNIT_NAME" ]; then
  # Only this release's Deployments: a namespace may hold another release's,
  # and its rollout is not this deploy's to wait on.
  echo "Waiting for every deployment of release ${RELEASE_NAME} to report ready..."
  for deployment in $(helm get manifest "$RELEASE_NAME" --namespace "$NAMESPACE" | awk '
    /^---/ { deployment = 0; meta = 0 }
    /^kind:[[:space:]]+Deployment[[:space:]]*$/ { deployment = 1 }
    /^metadata:/ { meta = 1; next }
    /^[^[:space:]]/ { meta = 0 }
    deployment && meta && /^  name:/ { print $2; deployment = 0 }
  '); do
    kubectl rollout status "deployment/$deployment" -n "$NAMESPACE" --timeout=5m
  done
else
  echo "Waiting for every deployment to report ready..."
  kubectl rollout status deployment -n "$NAMESPACE" --timeout=5m
fi

# The post phase finishes each task the pre phase started, against the new pods.
bash "$K8S_DIR/release-tasks/run-release-tasks.sh" "${TASKS_UNIT[@]}" \
  --env production --phase post --release "$VERSION"

echo "Production is now serving release ${VERSION}${UNIT_NAME:+ of the unit $UNIT_NAME}"
echo "Helm revision history (use 'helm rollback ${RELEASE_NAME} <rev>' as an alternative):"
helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 10
