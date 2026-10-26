<#
.SYNOPSIS
  Cluster prerequisites for the Gateway API routing layer (k8s/plans/0001).
  PowerShell twin of install.sh.

.DESCRIPTION
  Installs, once per cluster: the Gateway API CRDs (standard channel), Envoy
  Gateway with merged gateways, cert-manager with its Gateway integration
  enabled, and for a local cluster a self signed ClusterIssuer. These are
  deliberately NOT part of a chart: the unit charts name the implementation only
  through `gateway.className`, and each brings its own Gateway and ACME Issuer
  (k8s plan 0015).

  It installs no MetalLB controller, because Docker Desktop publishes a
  LoadBalancer Service on localhost. -Ip applies the MetalLB pool on a cluster
  where install.sh installed the controller.

  Idempotent: every step is an `apply` or a `helm upgrade --install`.

.EXAMPLE
  ./k8s/bootstrap/install.ps1 -Issuer selfsigned
  # Docker Desktop: self signed certs, no public DNS needed.

.EXAMPLE
  ./k8s/bootstrap/install.ps1 -Ip 203.0.113.7
  # A cluster with MetalLB: the unit charts issue their own certificates.
#>
[CmdletBinding()]
param(
  [ValidateSet('envoy')]
  [string]$Implementation = 'envoy',

  [ValidateSet('letsencrypt', 'selfsigned')]
  [string]$Issuer = 'letsencrypt',

  # The address the MetalLB pool advertises. Empty leaves the pool as it is.
  [ValidatePattern('^$|^[0-9]{1,3}(\.[0-9]{1,3}){3}$')]
  [string]$Ip = ''
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

# Runs a kubectl read and returns its output and exit code. Windows PowerShell
# 5.1 turns native stderr into a terminating error under 'Stop', so the read runs
# under 'Continue' and the caller decides what a failure means.
function Invoke-KubectlRead {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & kubectl @Arguments 2>$null
    [pscustomobject]@{ Output = @($output); ExitCode = $LASTEXITCODE }
  }
  finally {
    $ErrorActionPreference = $previous
  }
}

Write-Host "==> cluster: $(kubectl config current-context)"
Write-Host "==> implementation: $Implementation, issuer: $Issuer, pool address: $(if ($Ip) { $Ip } else { 'unchanged' })"

# Applies a YAML document through a temporary file, which is how this script
# hands kubectl a document without a Bash heredoc.
function Invoke-KubectlApply {
  param([string]$Yaml, [string]$Name)
  $file = Join-Path ([System.IO.Path]::GetTempPath()) "nx-portfolio-$Name.yaml"
  Set-Content -Path $file -Value $Yaml -Encoding utf8
  try {
    Invoke-Checked { kubectl apply -f $file }
  }
  finally {
    Remove-Item $file -ErrorAction SilentlyContinue
  }
}

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
# The class is what `gateway.className` in the unit charts points at, so it is
# part of the bootstrap rather than a chart.
#
# Merged gateways (k8s plan 0015 D3): every unit's Gateway is served by one data
# plane with one LoadBalancer Service. See install.sh for why a cluster that
# already serves Gateways is left unmerged here.
Write-Host '==> creating EnvoyProxy merged'
Invoke-KubectlApply -Name 'envoyproxy' -Yaml @'
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: merged
  namespace: envoy-gateway-system
spec:
  mergeGateways: true
'@

$classParams = (Invoke-KubectlRead @('get', 'gatewayclass', 'eg', '-o', 'jsonpath={.spec.parametersRef.name}')).Output
# custom-columns, because PowerShell 5.1 strips the quotes of a jsonpath "\n".
# A failed query is a stop, never "no Gateway": that would merge a live class.
$gateways = Invoke-KubectlRead @('get', 'gateways', '--all-namespaces', '-o', 'custom-columns=CLASS:.spec.gatewayClassName', '--no-headers')
if ($gateways.ExitCode -ne 0) {
  throw "kubectl could not list the Gateways (exit code $($gateways.ExitCode)), so it is unknown whether the GatewayClass eg may be merged. Fix cluster access and run again."
}
$mergeClass = ($classParams -contains 'merged') -or -not ($gateways.Output -contains 'eg')

$gatewayClassYaml = @'
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: eg
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
'@
if ($mergeClass) {
  Write-Host '==> creating GatewayClass eg (merged gateways)'
  $gatewayClassYaml += @'

  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: merged
    namespace: envoy-gateway-system
'@
}
else {
  Write-Host '==> GatewayClass eg serves Gateways on a data plane each; left unmerged'
  Write-Host '    (k8s plan 0016 merges it when it splits the release)'
}
Invoke-KubectlApply -Name 'gatewayclass' -Yaml $gatewayClassYaml

# ---------------------------------------------------------------------------
# The MetalLB pool, when -Ip names the address (k8s plan 0015 D5). Only the
# Envoy data plane may take it. A pool is a Helm release's only while
# `helm status` finds that release; one whose release is gone is taken over.
# ---------------------------------------------------------------------------
if ($Ip) {
  if ((Invoke-KubectlRead @('get', 'crd', 'ipaddresspools.metallb.io')).ExitCode -ne 0) {
    throw '-Ip applies a MetalLB pool, and MetalLB is not installed here. install.sh installs it.'
  }
  $poolRelease = "$((Invoke-KubectlRead @('-n', 'metallb-system', 'get', 'ipaddresspool', 'main-pool', '-o', 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-name}')).Output)"
  $poolReleaseNs = "$((Invoke-KubectlRead @('-n', 'metallb-system', 'get', 'ipaddresspool', 'main-pool', '-o', 'jsonpath={.metadata.annotations.meta\.helm\.sh/release-namespace}')).Output)"
  if (-not $poolReleaseNs) { $poolReleaseNs = 'default' }
  $poolOwned = $false
  if ($poolRelease) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      helm status $poolRelease -n $poolReleaseNs *> $null
      $poolOwned = ($LASTEXITCODE -eq 0)
    }
    finally {
      $ErrorActionPreference = $previous
    }
  }
  if ($poolOwned) {
    Write-Host "==> IPAddressPool main-pool belongs to the Helm release '$poolRelease'; left as it is"
  }
  else {
    if ($poolRelease) {
      Write-Host "==> the Helm release '$poolRelease' of IPAddressPool main-pool is gone; taking the pool over"
      foreach ($obj in @('ipaddresspool/main-pool', 'l2advertisement/main-advertisement')) {
        if ((Invoke-KubectlRead @('-n', 'metallb-system', 'get', $obj)).ExitCode -eq 0) {
          Invoke-Checked { kubectl -n metallb-system annotate $obj meta.helm.sh/release-name- meta.helm.sh/release-namespace- | Out-Null }
          Invoke-Checked { kubectl -n metallb-system label $obj app.kubernetes.io/managed-by- | Out-Null }
        }
      }
    }
    Write-Host "==> applying IPAddressPool main-pool ($Ip) and L2Advertisement main-advertisement"
    $poolYaml = @"
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: main-pool
  namespace: metallb-system
spec:
  addresses:
    - $Ip/32
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
"@
    # MetalLB's validating webhook can refuse for a few seconds after its install.
    for ($attempt = 1; ; $attempt++) {
      try {
        Invoke-KubectlApply -Name 'metallb-pool' -Yaml $poolYaml
        break
      }
      catch {
        if ($attempt -ge 6) { throw "the MetalLB pool could not be applied after $attempt attempts: $_" }
        Write-Host "==> retrying the pool in 5s (attempt $attempt of 6 failed)"
        Start-Sleep -Seconds 5
      }
    }
  }
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
# 4. The issuer.
#
# A public cluster needs nothing here: each unit chart renders a namespaced ACME
# Issuer that solves HTTP-01 through the unit's own Gateway (k8s plan 0015 D4).
# A local cluster gets one self signed ClusterIssuer that the local values files
# name.
# ---------------------------------------------------------------------------
if ($Issuer -eq 'letsencrypt') {
  Write-Host '==> no ClusterIssuer: each unit chart brings its own ACME Issuer'
}
else {
  Write-Host '==> creating ClusterIssuer selfsigned'
  Invoke-KubectlApply -Name 'clusterissuer' -Yaml @'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}
'@
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
Write-Host 'Bootstrap done. After deploying a unit chart, check the one merged data plane'
Write-Host 'Service that Envoy Gateway provisions for every Gateway of class eg. No chart'
Write-Host 'declares it, and it lives in envoy-gateway-system:'
Write-Host ''
Write-Host '  kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gatewayclass=eg'
