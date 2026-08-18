#!/usr/bin/env bash
#
# Deploy (or roll back) the production environment to a specific release version.
#
# Production apps are pinned to an immutable image tag (the release version, e.g.
# 1.1.3). This script records the chosen version in a small file on the deploy
# host and runs `helm upgrade` with it. Because the version lives outside the
# rsynced chart directory, it survives staging deploys and can be hand-edited.
#
# Rolling back is the same operation with an older version whose images still
# exist in the registry:
#
#   ./deploy-release.sh 1.1.3     # deploy release 1.1.3
#   ./deploy-release.sh 1.0.0     # roll back to 1.0.0
#
# Environment overrides:
#   RELEASE_NAME    helm release name        (default: nx-portfolio)
#   NAMESPACE       kubernetes namespace     (default: nx-portfolio)
#   PROD_TAG_FILE   persisted version file   (default: /root/helm-live/prod-tag.yaml)
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
PROD_TAG_FILE="${PROD_TAG_FILE:-/root/helm-live/prod-tag.yaml}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

echo "Pinning production to release ${VERSION}"
mkdir -p "$(dirname "$PROD_TAG_FILE")"
cat > "$PROD_TAG_FILE" <<EOF
# Managed by deploy-release.sh. The live production release version.
productionImageTag: "${VERSION}"
EOF

echo "Upgrading helm release '${RELEASE_NAME}' in namespace '${NAMESPACE}'"
helm upgrade "$RELEASE_NAME" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$CHART_DIR/values.yaml" \
  --values "$PROD_TAG_FILE"

echo "Production is now serving release ${VERSION}"
echo "Helm revision history (use 'helm rollback ${RELEASE_NAME} <rev>' as an alternative):"
helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 10
