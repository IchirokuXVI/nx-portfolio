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
#   ./deploy-release.sh 1.1.3     # deploy release 1.1.3
#   ./deploy-release.sh 1.0.0     # roll back to 1.0.0
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
#   RELEASE_NAME    helm release name        (default: nx-portfolio)
#   NAMESPACE       kubernetes namespace     (default: nx-portfolio)
#   TIMEOUT         helm/rollout wait        (default: 10m, 20m on a first install)
#   KUBECONFIG      kubeconfig path          (default: /etc/rancher/k3s/k3s.yaml)

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <release-version>" >&2
  echo "Example: $0 1.1.3" >&2
  exit 1
fi

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_NAME="${RELEASE_NAME:-nx-portfolio}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# ---------------------------------------------------------------------------
# What state is the release in before anything touches it?
#
# helm refuses to work on a release stuck in a pending state, with "another
# operation (install/upgrade/rollback) is in progress". A release gets stuck
# that way when a deploy is KILLED rather than failed: helm records pending
# before it starts waiting, and if the process dies in between, nothing ever
# writes the outcome. The way that happens here is the SSH connection CI runs
# this over going away mid `--wait`, which sends the whole remote process group
# a SIGHUP.
#
# Without this block the next attempt fails on the wreckage of the previous one
# instead of on anything real, and the message names an operation that is not in
# progress and has not been for hours. That is a considerably more confusing
# failure than whatever caused the original disconnect.
# ---------------------------------------------------------------------------
RELEASE_STATUS="$(helm status "$RELEASE_NAME" --namespace "$NAMESPACE" 2>/dev/null \
  | sed -n 's/^STATUS: //p' | head -1 || true)"
RELEASE_STATUS="${RELEASE_STATUS:-none}"

case "$RELEASE_STATUS" in
  pending-install)
    # Cleared automatically, because there is provably nothing to lose. A
    # pending-install release has never completed once, so no revision of it has
    # ever served traffic, and there is no earlier revision to roll back to:
    # removing the record and installing again is the only way forward.
    #
    # It does not take the databases with it either. The only persistent storage
    # in this chart comes from StatefulSet volumeClaimTemplates (postgres and
    # nats), and Kubernetes deliberately leaves those PVCs behind when the
    # StatefulSet goes away. There are no standalone PVCs in the chart, so
    # `helm uninstall` cannot delete a volume.
    echo "Release '${RELEASE_NAME}' is stuck in pending-install from an earlier"
    echo "attempt that was killed rather than finished. Removing that record and"
    echo "installing again; no revision of it ever served traffic, and the"
    echo "postgres and nats volumes are not helm's to delete."
    helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE" --wait --timeout 5m
    RELEASE_STATUS=none
    ;;
  pending-upgrade|pending-rollback)
    # NOT cleared automatically, because here an earlier revision did deploy and
    # its pods may be serving production right now. Choosing between rolling
    # back and letting the operation stand is a judgement about live traffic,
    # and a deploy script that silently makes it is a script nobody can trust
    # with the next release. It says what to run instead.
    echo "Release '${RELEASE_NAME}' is stuck in ${RELEASE_STATUS}, left behind by a" >&2
    echo "deploy that was killed mid flight. An earlier revision is still live, so" >&2
    echo "this script will not decide for you. Look at what is running, then:" >&2
    echo >&2
    echo "  helm history ${RELEASE_NAME} --namespace ${NAMESPACE}" >&2
    echo "  helm rollback ${RELEASE_NAME} --namespace ${NAMESPACE}   # to the last deployed revision" >&2
    echo >&2
    echo "and run this script again." >&2
    exit 1
    ;;
esac

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
echo "Waiting for every deployment to report ready..."
kubectl rollout status deployment -n "$NAMESPACE" --timeout=5m

echo "Production is now serving release ${VERSION}"
echo "Helm revision history (use 'helm rollback ${RELEASE_NAME} <rev>' as an alternative):"
helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 10
