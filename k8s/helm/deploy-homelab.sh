#!/usr/bin/env bash
#
# Deploy, or roll between, release versions on the home machine.
#
#   ./k8s/helm/deploy-homelab.sh 0.1.1     # serve release 0.1.1
#   ./k8s/helm/deploy-homelab.sh 0.1.0     # roll back to 0.1.0
#   ./k8s/helm/deploy-homelab.sh --current # what is being served right now
#   ./k8s/helm/deploy-homelab.sh --list    # versions published to the registry
#
# The home twin of deploy-release.sh. Same idea, same immutable version tags, the
# same published images: only the values file and the kubeconfig differ, because
# this cluster is Docker Desktop rather than a k3s VPS.
#
# The two are kept as separate files rather than one with a flag because the VPS
# script runs unattended from CI over SSH and this one is typed by a person at a
# keyboard. Conflating them would mean the CI path growing prompts, or this one
# losing them.
#
# Environment overrides:
#   RELEASE_NAME    helm release name     (default: nx-portfolio)
#   NAMESPACE       kubernetes namespace  (default: nx-portfolio)
#   TIMEOUT         helm/rollout wait     (default: 10m)
#   KUBECONFIG      kubeconfig path       (default: the usual ~/.kube/config)
#   REGISTRY_REPO   owner/repo for --list (default: IchirokuXVI/nx-portfolio)

set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_NAME="${RELEASE_NAME:-nx-portfolio}"
NAMESPACE="${NAMESPACE:-nx-portfolio}"
TIMEOUT="${TIMEOUT:-10m}"
REGISTRY_REPO="${REGISTRY_REPO:-IchirokuXVI/nx-portfolio}"

# Deliberately NOT defaulted to /etc/rancher/k3s/k3s.yaml the way deploy-release.sh
# does. That path is the k3s VPS's kubeconfig; here the target is whatever context
# kubectl is already pointed at, which on this machine is Docker Desktop.
usage() {
  sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------
# What is deployed right now.
#
# Read from the live Deployment rather than from `helm get values`, because the
# question being asked is "what image are the pods running", and those two can
# disagree: a failed upgrade leaves the release recording a version that no pod
# ever ran.
# ---------------------------------------------------------------------------
current_version() {
  kubectl -n "$NAMESPACE" get deployment shell \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null \
    | sed 's/.*://' || true
}

show_current() {
  local v
  v="$(current_version)"
  if [ -z "$v" ]; then
    echo "Nothing is deployed in namespace '${NAMESPACE}' (no 'shell' deployment)."
    return 0
  fi
  echo "Currently serving: ${v}"
  echo
  echo "Image tags in use, per workload:"
  kubectl -n "$NAMESPACE" get deployments \
    -o custom-columns='WORKLOAD:.metadata.name,IMAGE:.spec.template.spec.containers[0].image' \
    --no-headers 2>/dev/null | sed 's/^/  /'
  echo
  echo "Helm revision history:"
  helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 10 2>/dev/null \
    || echo "  (no helm release named '${RELEASE_NAME}' yet)"
}

# ---------------------------------------------------------------------------
# Which versions can actually be rolled to.
#
# A rollback is only possible to a version whose images are still in the
# registry, so this asks the registry rather than listing git tags, which would
# happily offer a version that was never published.
# ---------------------------------------------------------------------------
list_versions() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "The GitHub CLI (gh) is not installed, so the published versions cannot" >&2
    echo "be listed here. Read them from:" >&2
    echo "  https://github.com/${REGISTRY_REPO}/pkgs/container/nx-portfolio%2Fshell" >&2
    return 1
  fi
  echo "Versions published for the shell image (the whole release moves together):"
  gh api --paginate \
    "/users/${REGISTRY_REPO%%/*}/packages/container/nx-portfolio%2Fshell/versions" \
    --jq '.[].metadata.container.tags[]?' 2>/dev/null \
    | grep -v '^latest$' | sort -Vr | head -20 | sed 's/^/  /'
}

case "${1:-}" in
  '')             usage >&2; exit 1 ;;
  -h|--help)      usage; exit 0 ;;
  --current)      show_current; exit 0 ;;
  --list)         list_versions; exit 0 ;;
  -*)             echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
esac

VERSION="$1"

for tool in kubectl helm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required and not on PATH." >&2
    exit 1
  fi
done

PREVIOUS="$(current_version)"
if [ -n "$PREVIOUS" ]; then
  echo "Currently serving: ${PREVIOUS}"
  if [ "$PREVIOUS" = "$VERSION" ]; then
    echo "Already on ${VERSION}. Re-deploying anyway (this is a no-op for the pods,"
    echo "because IfNotPresent will not re-pull an immutable tag)."
  fi
else
  echo "Nothing deployed yet in namespace '${NAMESPACE}'."
fi
echo "Deploying: ${VERSION}"
echo

# ---------------------------------------------------------------------------
# The rollback warning, and it is not boilerplate.
#
# Rolling the APPLICATION back does not roll the DATABASE back. Migrations are
# pre-upgrade hooks and they are expand/contract, which is exactly what makes
# going backwards safe: the old code meets a newer but backward compatible
# schema and keeps working. What it does not do is undo anything. There is no
# down migration, and 0.1.0's migrate.js will not remove what 0.1.1's added.
#
# So this is safe for the case it exists for (0.1.1 is bad, get back to 0.1.0)
# and it is not a time machine. If a release did something destructive to data,
# restore from a dump instead; see k8s/helm/restore-database.sh.
# ---------------------------------------------------------------------------
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ]; then
  printf 'Note: this rolls the application back, not the database. Migrations are\n'
  printf 'expand/contract so %s runs correctly against the newer schema, but nothing\n' "$VERSION"
  printf 'that %s migrated is undone. Restore from a dump if you need that.\n\n' "$PREVIOUS"
fi

# --wait for the same reason deploy-release.sh uses it: without it `helm upgrade`
# returns as soon as the API server accepts the manifests, and this script would
# report success while pods crashloop. It also covers the migration Jobs, which
# are pre-upgrade hooks, so a failed migration fails the upgrade before any new
# pod takes traffic.
#
# Not --atomic, matching production: an automatic rollback of the whole release
# would roll pods back alongside migrations that do not roll back with them.
helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$CHART_DIR/values.yaml" \
  --values "$CHART_DIR/values.homelab.yaml" \
  --set imageTag="$VERSION" \
  --wait --timeout "$TIMEOUT"

echo
echo "Waiting for every deployment to report ready..."
kubectl rollout status deployment -n "$NAMESPACE" --timeout=5m

# Verified before it is claimed, rather than asserted straight after a command
# whose result was never read.
ACTUAL="$(current_version)"
if [ "$ACTUAL" != "$VERSION" ]; then
  echo "The rollout finished but the shell deployment reports '${ACTUAL}', not '${VERSION}'." >&2
  exit 1
fi

echo
echo "Now serving release ${VERSION} at https://ichirokuxvi.com"
echo "Roll back with: $0 ${PREVIOUS:-<older-version>}"
