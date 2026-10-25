#!/usr/bin/env bash
#
# Cluster prerequisites for the Gateway API routing layer (k8s/plans/0001).
#
# These install once per cluster and are deliberately NOT part of the application
# chart: the chart names the implementation only through `gateway.className`, so
# swapping it is this script plus one values key.
#
# Usage:
#   ./k8s/bootstrap/install.sh --k3s --ip 203.0.113.7           # bare VPS, start here
#   ./k8s/bootstrap/install.sh                                  # upgrade the add-ons
#   ./k8s/bootstrap/install.sh --issuer selfsigned --no-metallb # local (Docker Desktop)
#
#   --ip <address>   the public address MetalLB advertises (the pool, step 2)
#   --issuer         letsencrypt (default) or selfsigned (step 5)
#
# Idempotent: every step is an `apply` or a `helm upgrade --install`.
#
# Each unit chart brings its own Gateway and its own ACME Issuer (k8s plan 0015),
# so nothing here names a Gateway, a namespace or a unit.

set -euo pipefail

# Pinned versions. Renovate reads the `# renovate:` line above each one and
# opens a pull request when a new release is out (k8s plan 0013). The
# host-maintenance workflow then applies the merged version to staging first and
# to production after the soak, so a version here is the version both clusters
# run, and the version a rebuilt host gets.
#
# Envoy Gateway v1.9.0 bundles Gateway API v1.6.1, so the two below are a matched
# pair; bump them together, and re-check the pairing with
#   helm pull oci://docker.io/envoyproxy/gateway-helm --version <v> --untar
#   grep -rh bundle-version gateway-helm/
# renovate: datasource=github-releases depName=kubernetes-sigs/gateway-api
GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.6.1}"
# renovate: datasource=docker depName=envoyproxy/gateway-helm
ENVOY_GATEWAY_VERSION="${ENVOY_GATEWAY_VERSION:-v1.9.0}"
# renovate: datasource=helm depName=cert-manager registryUrl=https://charts.jetstack.io
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.21.1}"
# Chart version, which tracks the app version one for one. Check what is current
# with `helm search repo metallb/metallb --versions`.
# renovate: datasource=helm depName=metallb registryUrl=https://metallb.github.io/metallb
METALLB_VERSION="${METALLB_VERSION:-0.16.1}"
# The k3s release a new host installs and nx-host-patch upgrades to. Both
# clusters ran this one when it was pinned (2026-10-22).
# renovate: datasource=github-releases depName=k3s-io/k3s
K3S_VERSION="${K3S_VERSION:-v1.36.3+k3s1}"

IMPLEMENTATION=envoy
ISSUER=letsencrypt
# Installing a Kubernetes distribution is too large a side effect to do
# implicitly, so k3s is opt in: pass --k3s on a machine that has no cluster yet.
# It is still idempotent, and skips itself if k3s is already installed.
INSTALL_K3S=false
# MetalLB, by contrast, is on by default. This script is the Linux/VPS path (the
# local one is install.ps1), and on a bare metal cluster the Envoy LoadBalancer
# Service gets no address without it. --no-metallb is for a Docker Desktop
# cluster, which surfaces LoadBalancer services on localhost by itself.
INSTALL_METALLB=true
# The address the MetalLB pool advertises, the machine's public IP. Empty leaves
# the pool as it is, which is what an add-on upgrade from host maintenance wants.
POOL_IP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --implementation) IMPLEMENTATION="$2"; shift 2 ;;
    --issuer)         ISSUER="$2";         shift 2 ;;
    --ip)             POOL_IP="$2";        shift 2 ;;
    --k3s)            INSTALL_K3S=true;    shift ;;
    --metallb)        INSTALL_METALLB=true;  shift ;;
    --no-metallb)     INSTALL_METALLB=false; shift ;;
    -h|--help)        sed -n '2,20p' "$0"; exit 0 ;;
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
if [ -n "$POOL_IP" ]; then
  if [ "$INSTALL_METALLB" = false ]; then
    echo "--ip names the address of the MetalLB pool, and --no-metallb skips MetalLB." >&2
    exit 1
  fi
  if ! [[ "$POOL_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "--ip takes one IPv4 address, got '$POOL_IP'." >&2
    exit 1
  fi
fi

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
# write-kubeconfig-mode 644 lets a non root user (and the CI deploy user) read
# /etc/rancher/k3s/k3s.yaml without sudo.
#
# The flags live in /etc/rancher/k3s/config.yaml, not on the installer's command
# line (k8s plan 0013). The installer rewrites the systemd unit from whatever
# arguments it is given, so an upgrade that forgot them would quietly bring
# traefik back onto ports 80 and 443. k3s reads config.yaml on every start, so an
# upgrade needs no arguments at all. The file is written on every --k3s run,
# which also moves a host installed before this change onto it.
#
# The version is pinned (K3S_VERSION above), and so is the installer, which comes
# from the same tag. A rebuilt host therefore gets the k3s the other cluster
# runs, not whatever the stable channel holds that day. Gateway API v1.5+ CRDs
# need a Kubernetes API server of 1.31 or newer, which every pinned k3s is.
# ---------------------------------------------------------------------------
if [ "$INSTALL_K3S" = true ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "--k3s writes /etc/rancher/k3s and installs a system service. Run it as root." >&2
    exit 1
  fi
  install -d -m 755 /etc/rancher/k3s
  cat > /etc/rancher/k3s/config.yaml <<'YAML'
# Written by k8s/bootstrap/install.sh. Read by k3s on every start.
disable:
  - traefik
  - servicelb
write-kubeconfig-mode: '0644'
YAML

  if command -v k3s >/dev/null 2>&1; then
    echo "==> k3s already installed, skipping (k3s $(k3s --version | head -1 | awk '{print $3}'))"
    echo "    upgrades go through nx-host-patch, which the host-maintenance workflow"
    echo "    runs (k8s plan 0013)"
  else
    echo "==> installing k3s $K3S_VERSION (traefik and servicelb disabled)"
    curl -sfL "https://raw.githubusercontent.com/k3s-io/k3s/${K3S_VERSION}/install.sh" \
      | INSTALL_K3S_VERSION="$K3S_VERSION" sh -
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
echo "==> implementation: $IMPLEMENTATION, issuer: $ISSUER, metallb: $INSTALL_METALLB, pool address: ${POOL_IP:-unchanged}"

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
# 2. MetalLB, and its pool when --ip names the address.
#
# The pool belongs to the machine and not to a unit (k8s plan 0015 D5): every
# unit's Gateway is served by the one merged Envoy Service of step 3, and that
# Service is the only LoadBalancer that takes the address. Two unit releases
# that both rendered the pool would collide on Helm ownership.
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

if [ -n "$POOL_IP" ]; then
  # A pool is a Helm release's only while `helm status` finds that release. The
  # cutover of plan 0016 deletes the release's storage and leaves the Helm
  # annotations on the live objects, so a pool whose release is gone is taken over.
  pool_release="$(kubectl -n metallb-system get ipaddresspool main-pool \
    -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null || true)"
  pool_release_ns="$(kubectl -n metallb-system get ipaddresspool main-pool \
    -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-namespace}' 2>/dev/null || true)"
  if [ -n "$pool_release" ] \
    && helm status "$pool_release" -n "${pool_release_ns:-default}" >/dev/null 2>&1; then
    echo "==> IPAddressPool main-pool belongs to the Helm release '$pool_release'; left as it is"
    echo "    (k8s plan 0016 takes it over when it splits that release)"
  else
    if [ -n "$pool_release" ]; then
      echo "==> the Helm release '$pool_release' of IPAddressPool main-pool is gone; taking the pool over"
      for obj in ipaddresspool/main-pool l2advertisement/main-advertisement; do
        if kubectl -n metallb-system get "$obj" >/dev/null 2>&1; then
          kubectl -n metallb-system annotate "$obj" \
            meta.helm.sh/release-name- meta.helm.sh/release-namespace- >/dev/null
          kubectl -n metallb-system label "$obj" app.kubernetes.io/managed-by- >/dev/null
        fi
      done
    fi
    echo "==> applying IPAddressPool main-pool ($POOL_IP) and L2Advertisement main-advertisement"
    pool_manifest="$(cat <<YAML
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: main-pool
  namespace: metallb-system
spec:
  addresses:
    - ${POOL_IP}/32
  # Only the Envoy data plane may take the address. A LoadBalancer Service in an
  # application namespace would otherwise race it for the one address.
  serviceAllocation:
    namespaces:
      - envoy-gateway-system
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: main-advertisement
  namespace: metallb-system
spec:
  ipAddressPools:
    - main-pool
YAML
)"
    # MetalLB's validating webhook can refuse for a few seconds after its install.
    attempt=1
    until printf '%s\n' "$pool_manifest" | kubectl apply -f -; do
      if [ "$attempt" -ge 6 ]; then
        echo "ERROR: the MetalLB pool could not be applied after $attempt attempts." >&2
        exit 1
      fi
      echo "==> retrying the pool in 5s (attempt $attempt of 6 failed)"
      attempt=$((attempt + 1))
      sleep 5
    done
  fi
elif [ "$INSTALL_METALLB" = true ] \
  && ! kubectl -n metallb-system get ipaddresspool main-pool >/dev/null 2>&1; then
  echo "==> WARNING: no IPAddressPool main-pool and no --ip. The Envoy Service will"
  echo "    stay <pending> until one exists. Re-run with --ip <public address>."
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
# The class is what `gateway.className` in the unit charts points at, so it is
# part of the bootstrap rather than a chart.
#
# Merged gateways (k8s plan 0015 D3). Each unit chart renders a Gateway of its
# own, and Envoy Gateway would give each one a data plane and a LoadBalancer
# Service, while MetalLB has one address. The EnvoyProxy `merged` makes the class
# serve every Gateway from one data plane with one Service.
echo "==> creating EnvoyProxy merged"
kubectl apply -f - <<'YAML'
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: merged
  namespace: envoy-gateway-system
spec:
  mergeGateways: true
YAML

# Switching a cluster that already serves Gateways replaces their data plane
# Service, and the new one waits <pending> while the old one holds the address.
# That switch is the cutover of plan 0016 (`--merge-only`), so here the class is
# merged only on a cluster with no Gateway yet, or one that is merged already.
merge_class=false
if [ "$(kubectl get gatewayclass eg -o jsonpath='{.spec.parametersRef.name}' 2>/dev/null || true)" = merged ]; then
  merge_class=true
else
  # A failed query is a stop, never "no Gateway": that would merge a live class.
  if ! gateway_classes="$(kubectl get gateways --all-namespaces \
    -o custom-columns=CLASS:.spec.gatewayClassName --no-headers)"; then
    echo "ERROR: kubectl could not list the Gateways, so it is unknown whether the" >&2
    echo "       GatewayClass eg may be merged. Fix cluster access and run again." >&2
    exit 1
  fi
  if ! printf '%s\n' "$gateway_classes" | grep -x eg > /dev/null; then
    merge_class=true
  fi
fi

if [ "$merge_class" = true ]; then
  echo "==> creating GatewayClass eg (merged gateways)"
  kubectl apply -f - <<'YAML'
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: merged
    namespace: envoy-gateway-system
YAML
else
  echo "==> GatewayClass eg serves Gateways on a data plane each; left unmerged"
  echo "    (k8s plan 0016 merges it when it splits the release)"
  kubectl apply -f - <<'YAML'
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
YAML
fi

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
# 5. The issuer.
#
# A public cluster needs nothing here: each unit chart renders a namespaced ACME
# Issuer that solves HTTP-01 through the unit's own Gateway (k8s plan 0015 D4).
# A local cluster has no public DNS, so it gets one self signed ClusterIssuer
# that the local values files name. Both end up as cert-manager issued Secrets
# referenced from the Gateway's listeners, so a local deploy exercises the same
# wiring production uses.
# ---------------------------------------------------------------------------
if [ "$ISSUER" = "letsencrypt" ]; then
  echo "==> no ClusterIssuer: each unit chart brings its own ACME Issuer"
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
  kubectl get ipaddresspool -n metallb-system
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
echo "Bootstrap done. After deploying a unit chart, check the one merged data plane"
echo "Service that Envoy Gateway provisions for every Gateway of class eg. No chart"
echo "declares it, and it lives in envoy-gateway-system. With MetalLB, its"
echo "EXTERNAL-IP is the pool address:"
echo
echo "  kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gatewayclass=eg"
