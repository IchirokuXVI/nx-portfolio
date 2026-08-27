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
#   TIMEOUT         helm/rollout wait        (default: 10m)
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
TIMEOUT="${TIMEOUT:-10m}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

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
