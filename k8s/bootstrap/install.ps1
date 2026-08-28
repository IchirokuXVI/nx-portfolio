<#
.SYNOPSIS
  Cluster prerequisites for the Gateway API routing layer (k8s/plans/0001).
  PowerShell twin of install.sh.

.DESCRIPTION
  Installs, once per cluster: the Gateway API CRDs (standard channel), a Gateway
  API implementation, cert-manager with its Gateway integration enabled, and a
  ClusterIssuer. These are deliberately NOT part of the application chart: the
  chart names the implementation only through `gateway.className`, so swapping it
  is this script plus one values key.

  Idempotent: every step is an `apply` or a `helm upgrade --install`.

.EXAMPLE
  ./k8s/bootstrap/install.ps1 -Issuer selfsigned
  # Docker Desktop: self signed certs, no public DNS needed.

.EXAMPLE
  ./k8s/bootstrap/install.ps1 -Issuer letsencrypt -Email you@example.com
#>
[CmdletBinding()]
param(
  [ValidateSet('envoy')]
  [string]$Implementation = 'envoy',

  [ValidateSet('letsencrypt', 'selfsigned')]
  [string]$Issuer = 'letsencrypt',

  # Let's Encrypt wants a contact address for expiry warnings. Only the ACME
  # issuer reads it; the self signed one ignores it.
  [string]$Email = 'danieliyo65@gmail.com',

  # The Gateway the ACME HTTP-01 solver attaches its challenge routes to. Must
  # match the Gateway the chart renders (templates/gateway/gateway.yaml.tpl).
  [string]$GatewayName = 'portfolio',
  [string]$GatewayNamespace = 'nx-portfolio'
)

$ErrorActionPreference = 'Stop'

# Pinned versions. Envoy Gateway v1.9.0 bundles Gateway API v1.6.1, so the two
# below are a matched pair; bump them together, and re-check the pairing with
#   helm pull oci://docker.io/envoyproxy/gateway-helm --version <v> --untar
#   grep -rh bundle-version gateway-helm/
$gatewayApiVersion = if ($env:GATEWAY_API_VERSION) { $env:GATEWAY_API_VERSION } else { 'v1.6.1' }
$envoyGatewayVersion = if ($env:ENVOY_GATEWAY_VERSION) { $env:ENVOY_GATEWAY_VERSION } else { 'v1.9.0' }
$certManagerVersion = if ($env:CERT_MANAGER_VERSION) { $env:CERT_MANAGER_VERSION } else { 'v1.21.1' }

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "command failed with exit code $LASTEXITCODE" }
}

Write-Host "==> cluster: $(kubectl config current-context)"
Write-Host "==> implementation: $Implementation, issuer: $Issuer"

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
Write-Host "==> installing Gateway API CRDs $gatewayApiVersion (standard channel)"
$crdUrl = "https://github.com/kubernetes-sigs/gateway-api/releases/download/$gatewayApiVersion/standard-install.yaml"
Invoke-Checked { kubectl apply --server-side --force-conflicts -f $crdUrl }

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
Write-Host "==> installing Envoy Gateway $envoyGatewayVersion"

# Envoy Gateway's own CRDs, from the chart being installed so the two cannot
# drift. Server side apply because two of them (envoyproxies, securitypolicies)
# are larger than the 262144 byte last-applied-configuration annotation that a
# client side apply would try to write.
$egChartDir = Join-Path ([System.IO.Path]::GetTempPath()) "eg-chart-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $egChartDir | Out-Null
try {
  Invoke-Checked {
    helm pull oci://docker.io/envoyproxy/gateway-helm `
      --version $envoyGatewayVersion --untar --untardir $egChartDir | Out-Null
  }
  $egCrds = Join-Path $egChartDir 'gateway-helm/charts/crds/crds/generated/'
  Invoke-Checked { kubectl apply --server-side --force-conflicts -f $egCrds }
}
finally {
  Remove-Item -Recurse -Force $egChartDir -ErrorAction SilentlyContinue
}

Invoke-Checked {
  helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm `
    --version $envoyGatewayVersion `
    --namespace envoy-gateway-system --create-namespace `
    --skip-crds `
    --wait
}

# The GatewayClass. Contrary to what is sometimes assumed, the Envoy Gateway
# chart does NOT create one: it only sets the controller name it will answer to.
# The class is what `gateway.className` in values.yaml points at, so it is part
# of the bootstrap rather than the application chart, which keeps the chart free
# of any reference to the implementation beyond that one value.
Write-Host '==> creating GatewayClass eg'
$gatewayClassYaml = @'
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
'@
$gcFile = Join-Path ([System.IO.Path]::GetTempPath()) 'nx-portfolio-gatewayclass.yaml'
Set-Content -Path $gcFile -Value $gatewayClassYaml -Encoding utf8
try {
  Invoke-Checked { kubectl apply -f $gcFile }
}
finally {
  Remove-Item $gcFile -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 3. cert-manager, with the Gateway API integration enabled.
#
# Off by default, and the flag name has moved between versions: v1.21 takes
# `config.gatewayAPI.enabled`, earlier ones took `config.enableGatewayAPI`, older
# ones still `extraArgs={--enable-gateway-api}`. Verify against the chart you are
# actually installing:
#   helm show values jetstack/cert-manager --version <v> | Select-String gatewayAPI
# ---------------------------------------------------------------------------
Write-Host "==> installing cert-manager $certManagerVersion"
Invoke-Checked { helm repo add jetstack https://charts.jetstack.io | Out-Null }
Invoke-Checked { helm repo update jetstack | Out-Null }
Invoke-Checked {
  helm upgrade --install cert-manager jetstack/cert-manager `
    --version $certManagerVersion `
    --namespace cert-manager --create-namespace `
    --set crds.enabled=true `
    --set config.gatewayAPI.enabled=true `
    --wait
}

# ---------------------------------------------------------------------------
# 4. The ClusterIssuer.
#
# The local and production paths differ by this flag rather than by mechanism:
# both end up as cert-manager issued Secrets referenced from the Gateway's
# listeners, so a local deploy exercises the same wiring production uses.
# ---------------------------------------------------------------------------
if ($Issuer -eq 'letsencrypt') {
  Write-Host '==> creating ClusterIssuer letsencrypt-prod (ACME HTTP-01 via the Gateway)'
  $issuerYaml = @"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: $Email
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
                name: $GatewayName
                namespace: $GatewayNamespace
"@
}
else {
  Write-Host '==> creating ClusterIssuer selfsigned'
  $issuerYaml = @"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}
"@
}

$issuerFile = Join-Path ([System.IO.Path]::GetTempPath()) 'nx-portfolio-clusterissuer.yaml'
Set-Content -Path $issuerFile -Value $issuerYaml -Encoding utf8
try {
  Invoke-Checked { kubectl apply -f $issuerFile }
}
finally {
  Remove-Item $issuerFile -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Verification. The gatewayclass name is what feeds `gateway.className` in
# values.yaml, so it is printed rather than assumed.
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "==> gatewayclass (expect 'eg', ACCEPTED=True; this is gateway.className)"
kubectl get gatewayclass
Write-Host ''
Write-Host '==> envoy-gateway-system'
kubectl get pods -n envoy-gateway-system
Write-Host ''
Write-Host '==> cert-manager'
kubectl get pods -n cert-manager
Write-Host ''
Write-Host '==> clusterissuers'
kubectl get clusterissuer
Write-Host ''
Write-Host 'Bootstrap done. After deploying the chart, check the data plane Service that'
Write-Host 'Envoy Gateway provisions for the Gateway. It is NOT declared by the chart and'
Write-Host 'it lives in envoy-gateway-system, not the application namespace:'
Write-Host ''
Write-Host '  kubectl get svc -n envoy-gateway-system'
