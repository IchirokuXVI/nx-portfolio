#!/usr/bin/env bash
#
# Cluster prerequisites for the Gateway API routing layer (k8s/plans/0001).
#
# These install once per cluster and are deliberately NOT part of the application
# chart: the chart names the implementation only through `gateway.className`, so
# swapping it is this script plus one values key.
#
# Usage:
#   ./k8s/bootstrap/install.sh                                  # envoy + letsencrypt
#   ./k8s/bootstrap/install.sh --issuer selfsigned              # local (Docker Desktop)
#   ./k8s/bootstrap/install.sh --implementation envoy --issuer letsencrypt \
#     --email you@example.com
#
# Idempotent: every step is an `apply` or a `helm upgrade --install`.

set -euo pipefail

# Pinned versions. Envoy Gateway v1.9.0 bundles Gateway API v1.6.1, so the two
# below are a matched pair; bump them together, and re-check the pairing with
#   helm pull oci://docker.io/envoyproxy/gateway-helm --version <v> --untar
#   grep -rh bundle-version gateway-helm/
GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.6.1}"
ENVOY_GATEWAY_VERSION="${ENVOY_GATEWAY_VERSION:-v1.9.0}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.21.1}"

IMPLEMENTATION=envoy
ISSUER=letsencrypt
# Let's Encrypt wants a contact address for expiry warnings. Only the ACME issuer
# reads it; the self signed one ignores it.
ACME_EMAIL="${ACME_EMAIL:-danieliyo65@gmail.com}"
# The Gateway the ACME HTTP-01 solver attaches its challenge routes to. Must
# match the Gateway the chart renders (templates/gateway/gateway.yaml.tpl).
GATEWAY_NAME="${GATEWAY_NAME:-portfolio}"
GATEWAY_NAMESPACE="${GATEWAY_NAMESPACE:-nx-portfolio}"

while [ $# -gt 0 ]; do
  case "$1" in
    --implementation) IMPLEMENTATION="$2"; shift 2 ;;
    --issuer)         ISSUER="$2";         shift 2 ;;
    --email)          ACME_EMAIL="$2";     shift 2 ;;
    --gateway)        GATEWAY_NAME="$2";   shift 2 ;;
    --namespace)      GATEWAY_NAMESPACE="$2"; shift 2 ;;
    -h|--help)        sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$IMPLEMENTATION" in
  envoy) ;;
  *) echo "unsupported implementation: $IMPLEMENTATION (only 'envoy' is wired up)" >&2; exit 1 ;;
esac
case "$ISSUER" in
  letsencrypt|selfsigned) ;;
  *) echo "unsupported issuer: $ISSUER (expected letsencrypt or selfsigned)" >&2; exit 1 ;;
esac

echo "==> cluster: $(kubectl config current-context)"
echo "==> implementation: $IMPLEMENTATION, issuer: $ISSUER"

# ---------------------------------------------------------------------------
# 1. Gateway API CRDs, standard channel.
#
# Envoy Gateway's chart bundles these, but applying them from a pinned URL keeps
# the version recorded in this repo and keeps the CRDs from being torn out if the
# implementation is ever uninstalled.
# ---------------------------------------------------------------------------
#
# Requires Kubernetes >= 1.31: from v1.5 these CRDs use CEL functions (isIP,
# format.dns1123Label) that older API servers cannot compile, and the bundle's
# own admission policy refuses to install anything older than v1.5.0 over it.
echo "==> installing Gateway API CRDs $GATEWAY_API_VERSION (standard channel)"
kubectl apply --server-side --force-conflicts -f \
  "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"

# ---------------------------------------------------------------------------
# 2. The implementation.
#
# --skip-crds because step 1 already installed the Gateway API CRDs from the
# pinned URL above, and letting the chart install its own copy both collides with
# them and hands their lifecycle to the release. Envoy Gateway's OWN CRDs
# (BackendTrafficPolicy and friends) still have to exist, so they are applied
# from the same pinned chart just below.
#
# There is no default Gateway to switch off: the controller does nothing until
# the application chart's Gateway object appears, and then it provisions a data
# plane Deployment + Service for it in envoy-gateway-system.
# ---------------------------------------------------------------------------
echo "==> installing Envoy Gateway $ENVOY_GATEWAY_VERSION"

# Envoy Gateway's own CRDs, from the chart being installed so the two cannot
# drift. Server side apply because two of them (envoyproxies, securitypolicies)
# are larger than the 262144 byte last-applied-configuration annotation that a
# client side apply would try to write.
eg_chart_dir="$(mktemp -d)"
trap 'rm -rf "$eg_chart_dir"' EXIT
helm pull oci://docker.io/envoyproxy/gateway-helm \
  --version "$ENVOY_GATEWAY_VERSION" --untar --untardir "$eg_chart_dir" >/dev/null
kubectl apply --server-side --force-conflicts \
  -f "$eg_chart_dir/gateway-helm/charts/crds/crds/generated/"

helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
  --version "$ENVOY_GATEWAY_VERSION" \
  --namespace envoy-gateway-system --create-namespace \
  --skip-crds \
  --wait

# The GatewayClass. Contrary to what is sometimes assumed, the Envoy Gateway
# chart does NOT create one: it only sets the controller name it will answer to.
# The class is what `gateway.className` in values.yaml points at, so it is part
# of the bootstrap rather than the application chart, which keeps the chart free
# of any reference to the implementation beyond that one value.
echo "==> creating GatewayClass eg"
kubectl apply -f - <<'YAML'
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
YAML

# ---------------------------------------------------------------------------
# 3. cert-manager, with the Gateway API integration enabled.
#
# Off by default, and the flag name has moved between versions: v1.21 takes
# `config.gatewayAPI.enabled`, earlier ones took `config.enableGatewayAPI`, older
# ones still `extraArgs={--enable-gateway-api}`. Verify against the chart you are
# actually installing:
#   helm show values jetstack/cert-manager --version <v> | grep -i gatewayAPI
# ---------------------------------------------------------------------------
echo "==> installing cert-manager $CERT_MANAGER_VERSION"
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo update jetstack >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --version "$CERT_MANAGER_VERSION" \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --set config.gatewayAPI.enabled=true \
  --wait

# ---------------------------------------------------------------------------
# 4. The ClusterIssuer.
#
# The local and production paths differ by this flag rather than by mechanism:
# both end up as cert-manager issued Secrets referenced from the Gateway's
# listeners, so a local deploy exercises the same wiring production uses.
# ---------------------------------------------------------------------------
if [ "$ISSUER" = "letsencrypt" ]; then
  echo "==> creating ClusterIssuer letsencrypt-prod (ACME HTTP-01 via the Gateway)"
  kubectl apply -f - <<YAML
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${ACME_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      # The HTTP-01 solver creates a temporary HTTPRoute with an exact path match
      # on the challenge token, parented to the chart's Gateway. Gateway API
      # specifies route precedence (exact beats prefix), so the challenge wins
      # over the catch all HTTPS redirect deterministically.
      - http01:
          gatewayHTTPRoute:
            parentRefs:
              - kind: Gateway
                name: ${GATEWAY_NAME}
                namespace: ${GATEWAY_NAMESPACE}
YAML
else
  echo "==> creating ClusterIssuer selfsigned"
  kubectl apply -f - <<YAML
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}
YAML
fi

# ---------------------------------------------------------------------------
# Verification. The gatewayclass name is what feeds `gateway.className` in
# values.yaml, so it is printed rather than assumed.
# ---------------------------------------------------------------------------
echo
echo "==> gatewayclass (expect 'eg', ACCEPTED=True; this is gateway.className)"
kubectl get gatewayclass
echo
echo "==> envoy-gateway-system"
kubectl get pods -n envoy-gateway-system
echo
echo "==> cert-manager"
kubectl get pods -n cert-manager
echo
echo "==> clusterissuers"
kubectl get clusterissuer
echo
echo "Bootstrap done. After deploying the chart, check the data plane Service that"
echo "Envoy Gateway provisions for the Gateway. It is NOT declared by the chart and"
echo "it lives in envoy-gateway-system, not the application namespace:"
echo
echo "  kubectl get svc -n envoy-gateway-system"
