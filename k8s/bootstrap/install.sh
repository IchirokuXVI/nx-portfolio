#!/usr/bin/env bash
#
# Cluster prerequisites for the Gateway API routing layer (k8s/plans/0001).
#
# These install once per cluster and are deliberately NOT part of the application
# chart: the chart names the implementation only through `gateway.className`, so
# swapping it is this script plus one values key.
#
# Usage:
#   ./k8s/bootstrap/install.sh --k3s                            # bare VPS, start here
#   ./k8s/bootstrap/install.sh                                  # envoy + letsencrypt
#   ./k8s/bootstrap/install.sh --issuer selfsigned --no-metallb # local (Docker Desktop)
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
# Chart version, which tracks the app version one for one. Check what is current
# with `helm search repo metallb/metallb --versions`.
METALLB_VERSION="${METALLB_VERSION:-0.16.1}"

IMPLEMENTATION=envoy
ISSUER=letsencrypt
# Installing a Kubernetes distribution is too large a side effect to do
# implicitly, so k3s is opt in: pass --k3s on a machine that has no cluster yet.
# It is still idempotent, and skips itself if k3s is already installed.
INSTALL_K3S=false
# MetalLB, by contrast, is on by default. This script is the Linux/VPS path (the
# local one is install.ps1), and on a bare metal cluster the chart's IPAddressPool
# has nothing to bind to without it. --no-metallb is for a Docker Desktop cluster,
# which surfaces LoadBalancer services on localhost by itself.
INSTALL_METALLB=true
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
    --k3s)            INSTALL_K3S=true;    shift ;;
    --metallb)        INSTALL_METALLB=true;  shift ;;
    --no-metallb)     INSTALL_METALLB=false; shift ;;
    -h|--help)        sed -n '2,17p' "$0"; exit 0 ;;
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

# ---------------------------------------------------------------------------
# 0. k3s.
#
# Two of k3s's defaults actively fight this stack, so both are disabled:
#
#   traefik   would take ports 80 and 443, which is exactly what Envoy Gateway
#             needs. Two ingress implementations on one node is one too many.
#   servicelb k3s's built in LoadBalancer (Klipper) races MetalLB for the same
#             Service objects. Whichever answers first wins, which is not a
#             property you want in the layer that decides whether the site is
#             reachable.
#
# --write-kubeconfig-mode 644 lets a non root user (and the CI deploy user) read
# /etc/rancher/k3s/k3s.yaml without sudo.
#
# No version is pinned here. Gateway API v1.5+ CRDs need a Kubernetes API server
# of 1.31 or newer, and the current k3s stable channel has been past that since
# well before this script existed, so pinning would only mean a stale channel to
# maintain. Pass INSTALL_K3S_VERSION or INSTALL_K3S_CHANNEL through the
# environment if a specific release is ever needed.
# ---------------------------------------------------------------------------
if [ "$INSTALL_K3S" = true ]; then
  if command -v k3s >/dev/null 2>&1; then
    echo "==> k3s already installed, skipping (k3s $(k3s --version | head -1 | awk '{print $3}'))"
  else
    echo "==> installing k3s (traefik and servicelb disabled)"
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="\
      --disable traefik \
      --disable servicelb \
      --write-kubeconfig-mode 644" sh -
  fi

  export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

  # k3s reports ready before the API server accepts connections, so the steps
  # below would fail on a fresh install without waiting for the node.
  #
  # Two waits, because `kubectl wait --all` does not do what it looks like it
  # does: given zero matching objects it fails immediately with "error: no
  # matching resources found" instead of waiting for one to appear. On a fresh
  # k3s the API server starts answering a few seconds before the kubelet
  # registers its Node, and that gap is precisely the window this step exists to
  # cover, so the object is polled for first and only then is its condition
  # waited on. The symptom otherwise is an install that fails instantly on a
  # cluster which is about to be perfectly healthy.
  echo "==> waiting for the node to register"
  waited=0
  while [ -z "$(kubectl get nodes -o name 2>/dev/null)" ] && [ "$waited" -lt 300 ]; do
    sleep 5
    waited=$((waited + 5))
  done
  if [ -z "$(kubectl get nodes -o name 2>/dev/null)" ]; then
    echo "No node registered after ${waited}s. k3s is installed but not healthy." >&2
    echo "Check:  systemctl status k3s" >&2
    echo "        journalctl -u k3s -n 50 --no-pager" >&2
    exit 1
  fi

  echo "==> waiting for the node to become Ready"
  kubectl wait --for=condition=Ready node --all --timeout=180s

  # helm does not ship with k3s, and every step after this one needs it.
  if ! command -v helm >/dev/null 2>&1; then
    echo "==> installing helm"
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  fi
fi

# The kubeconfig for a run that did NOT install k3s.
#
# The export above only happens inside the --k3s branch, so re-running this
# script without the flag on a k3s host, or running it through sudo, which drops
# the caller's environment, left every kubectl below pointed at no cluster at
# all. Only adopted when the file is readable, so a workstation aimed at a
# remote cluster keeps its own ~/.kube/config.
if [ -z "${KUBECONFIG:-}" ] && [ -r /etc/rancher/k3s/k3s.yaml ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
fi

for tool in kubectl helm; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "$tool is required and not on PATH. On a bare VPS, run with --k3s." >&2
    exit 1
  }
done

echo "==> cluster: $(kubectl config current-context)"
echo "==> implementation: $IMPLEMENTATION, issuer: $ISSUER, metallb: $INSTALL_METALLB"

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
# 2. MetalLB.
#
# The controller only. The address pool itself stays in the application chart
# (templates/ipadd-pool.yaml.tpl, from .Values.ipAddress), because which address
# this cluster answers on is a property of the deployment, not of the machine.
# That split is also why this step has to exist: the chart declares an
# IPAddressPool and an L2Advertisement, so without the CRDs installed here the
# very first `helm upgrade` fails with `no matches for kind "IPAddressPool"`.
#
# L2 mode, which is what a single node with one address in front of it wants:
# MetalLB answers ARP for the pool address on the node's own interface. No BGP
# peer, no FRR, nothing to configure beyond the pool.
# ---------------------------------------------------------------------------
if [ "$INSTALL_METALLB" = true ]; then
  echo "==> installing MetalLB $METALLB_VERSION"
  helm repo add metallb https://metallb.github.io/metallb >/dev/null
  helm repo update metallb >/dev/null
  helm upgrade --install metallb metallb/metallb \
    --version "$METALLB_VERSION" \
    --namespace metallb-system --create-namespace \
    --wait
else
  echo "==> skipping MetalLB (--no-metallb)"
fi

# ---------------------------------------------------------------------------
# 3. The implementation.
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
# 4. cert-manager, with the Gateway API integration enabled.
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
# 5. The ClusterIssuer.
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
if [ "$INSTALL_METALLB" = true ]; then
  echo "==> metallb-system (controller + one speaker per node)"
  kubectl get pods -n metallb-system
  echo
fi
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
