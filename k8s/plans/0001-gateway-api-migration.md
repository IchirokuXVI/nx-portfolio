# 0001 Move routing to the Gateway API

First plan in `k8s/`. It replaces the hand templated nginx reverse proxy with the
Kubernetes **Gateway API**, served by **Envoy Gateway**, with **cert-manager** issuing the
certificates. The cluster stays a single k3s node on the VPS, and the datastore stays
SQLite. Nothing about the applications themselves changes: the images, the module
federation topology, the hostnames, and the paths are all identical before and after.

The plan is written so that swapping Envoy Gateway for another implementation later is a
values edit plus a bootstrap flag, not a chart rewrite.

## 1. Why

`k8s/helm/templates/reverse-proxy/` is 288 lines across seven files, roughly a third of
the chart's 936 template lines and by far its least approachable third. It is unreadable
for a structural reason rather than a stylistic one: it uses Helm's Go templates to
generate nginx's configuration language. Two templating systems are nested, the inner one
has no schema and no validation, and a single app's routing cannot be inspected in
isolation.

Three specific symptoms:

- **A group by host loop.** nginx requires one `server` block per `server_name` with the
  `location` blocks nested inside, but `.Values.apps` is flat. `_nginx.conf.tpl` carries
  twelve lines of `dict` / `hasKey` / `set` / `append` that exist only to bridge that
  mismatch.
- **The same guard copied twelve times.** `if or (ne .env "staging") $.Values.staging.enabled`
  appears in ten template files, five of those occurrences inside `reverse-proxy/` alone
  (`_nginx.conf.tpl` twice, the proxy deployment twice, `_init_container-certs.tpl` once).
  Extracting it into a `_helpers.tpl` define that returns the filtered list is worth doing
  regardless of this migration, and removing the proxy takes five of the twelve with it.
- **A certificate pipeline built by hand.** An init container that shells out to
  `openssl` for dummy certs, a certbot sidecar fed by a second deduplication loop,
  `shareProcessNamespace: true` so certbot can signal nginx, and two PVCs.

There is also a latent bug. `proxy_pass http://{{ .name }}:80;` uses a literal hostname
with no `resolver` directive, so nginx resolves it once at config load and caches the
result for the life of the process. Service ClusterIPs are stable, so this works until a
Service is deleted and recreated (a rename, a `helm uninstall`, or editing an immutable
field), at which point the proxy sends traffic to an address that no longer exists until
the pod is restarted. An ingress implementation watches the Endpoints API instead and
tracks pod IPs live.

## 2. Target architecture

The proxy pod disappears from the chart. The chart stops describing *how* to route and
starts describing *what* the routes are, and the data plane becomes something the
implementation manages.

```
values.yaml (.apps, unchanged)
      |
      +--> Gateway   "portfolio"     one listener per distinct host, TLS via cert-manager
      +--> HTTPRoute per app         host + path + backend + prefix strip
                     |
                     v
       Envoy Gateway controller  (namespace envoy-gateway-system)
                     |  watches Gateway API objects, and for each Gateway
                     |  provisions a data plane of its own
                     v
       Deployment + Service  envoy-nx-portfolio-portfolio-<hash>
                     |        (namespace envoy-gateway-system, type LoadBalancer)
                     v
            MetalLB assigns 46.62.204.230
```

Three object kinds replace seven template files:

| Kind | Count | Replaces |
| --- | --- | --- |
| `GatewayClass` | 1, installed by the bootstrap | nothing (new concept) |
| `Gateway` | 1, in the chart | the `server` block headers, `listen`, `ssl_certificate`, the proxy Deployment and Service |
| `HTTPRoute` | one per routed app | each `location` block, its `rewrite`, and its `proxy_set_header` lines |

### 2.1 What Envoy Gateway does differently, and why it was chosen

The one behaviour to internalise before reading the rest of this plan:

> Creating a `Gateway` object causes the Envoy Gateway controller to **provision a
> Deployment and a Service for it**, named `envoy-<namespace>-<gateway-name>-<hash>`, in
> the `envoy-gateway-system` namespace. Neither object is in this chart, neither is in the
> application namespace, and the Service defaults to `type: LoadBalancer`.

Traefik works the other way around: Traefik itself *is* the data plane, one Deployment
behind one Service, and Gateways merely attach to it. That model is closer to the shape
the chart has today, which makes Traefik marginally simpler to drop in.

Envoy Gateway is chosen anyway, and the reason is the portability requirement in section 6.
Traefik supports three overlapping ways to express the same route (Ingress, its own
`IngressRoute` CRD, and the Gateway API), so staying portable there means continuously
declining to use the proprietary path. Envoy Gateway has **no proprietary routing CRDs at
all**: routing is the Gateway API or nothing. Its own CRDs (`EnvoyProxy`,
`BackendTrafficPolicy`, `ClientTrafficPolicy`, `SecurityPolicy`) are *policy attachments*
that decorate standard objects rather than replace them, so the drift this plan is trying
to prevent is structurally harder to introduce.

The cost is honest and worth stating: two pods instead of one (a controller plus a data
plane) and roughly 200 to 300Mi more memory on a VPS that is not large. With a single
Gateway there is a single data plane, so this does not grow with the number of apps.

## 3. Cluster prerequisites (the bootstrap)

These install once per cluster and are **not** part of the application chart. Keeping
them out is what makes the implementation swappable: the chart never names Envoy Gateway
except through a single values key.

Add `k8s/bootstrap/` with a script pair, following the existing `luna-slot.sh` /
`luna-slot.ps1` precedent so Windows is a first class path:

- `k8s/bootstrap/install.sh` and `k8s/bootstrap/install.ps1`
- Both take an implementation argument defaulting to `envoy`, plus an issuer argument
  (`letsencrypt` or `selfsigned`) so the local and production paths differ by a flag
  rather than by mechanism.

What the script does, in order:

1. **Gateway API CRDs.** Apply the standard channel release explicitly. Envoy Gateway's
   chart bundles them, but applying them from a pinned URL keeps the version recorded in
   the repo and keeps the CRDs from being torn out when the implementation is uninstalled.
2. **The implementation.**

   ```sh
   helm install eg oci://docker.io/envoyproxy/gateway-helm \
     --version <pinned> -n envoy-gateway-system --create-namespace
   ```

   The chart creates a `GatewayClass` named `eg` whose controller is
   `gateway.envoyproxy.io/gatewayclass-controller`. Unlike the Traefik alternative there
   is no provider to switch on and no default Gateway to switch off: the controller does
   nothing until this chart's `Gateway` object appears.
3. **cert-manager**, with the Gateway integration enabled. This is off by default and the
   flag name has moved between versions, so verify against the installed chart: recent
   versions take `config.enableGatewayAPI=true`, older ones take
   `extraArgs={--enable-gateway-api}`.
4. **The ClusterIssuer**, either the ACME one or a `selfSigned: {}` one, from the issuer
   argument.

Verification the script should print at the end:

```sh
kubectl get gatewayclass                       # expect `eg`, and Accepted=True
kubectl get pods -n envoy-gateway-system
kubectl get pods -n cert-manager
```

The `gatewayclass` output is what feeds `gateway.className` in section 6, so it is worth
surfacing rather than assuming.

After the chart's Gateway is deployed, one more check matters more here than it would
with Traefik, because the object being checked is one the chart does not declare:

```sh
kubectl get svc -n envoy-gateway-system        # the provisioned envoy-... LoadBalancer
```

### 3.1 MetalLB namespace allocation (blocking, found during analysis)

`k8s/helm/templates/ipadd-pool.yaml.tpl` currently restricts the pool:

```yaml
serviceAllocation:
  namespaces:
    - {{ .Values.namespace }}     # nx-portfolio only
```

The data plane Service that Envoy Gateway provisions lives in `envoy-gateway-system`, not
in `nx-portfolio`, so under the current pool it would **never** be allocated
`46.62.204.230` and would sit at `<pending>` forever. This is silent: nothing errors, the
site simply never comes up.

It is also harder to spot than it would be with Traefik, because the stuck Service is not
one this chart declares. `kubectl get svc -n nx-portfolio` looks entirely healthy while
the site is unreachable, which is why section 3 makes checking `envoy-gateway-system` an
explicit bootstrap step.

Fix it as part of this plan by making the allocation a list:

```yaml
# values.yaml
metallb:
  enabled: true
  # Namespaces allowed to claim the pool. The gateway implementation provisions its
  # data plane Service in its own namespace, so that namespace needs an entry here.
  # This is the one value that must change when swapping implementations.
  serviceNamespaces:
    - nx-portfolio
    - envoy-gateway-system
```

An alternative is to pin the data plane into `nx-portfolio` with an `EnvoyProxy` resource
(see 8.1), which would need no pool change. It is not worth it: it mixes a cluster wide
component into the application namespace and trades a one line values edit for an
implementation specific CRD, which is exactly the trade section 6 is trying to avoid.

## 4. Chart additions

### 4.1 `templates/gateway/gateway.yaml.tpl`

One Gateway, one listener per distinct host. The dedup is over hosts only, which is the
same set the certbot `DOMAINS` variable already computes, so this is the one place a
grouping loop survives, and it becomes the only one in the chart instead of one of three.

```gotemplate
{{- $hosts := dict }}
{{- range .Values.apps }}
{{- if or (ne .env "staging") $.Values.staging.enabled }}
{{- $_ := set $hosts .host true }}
{{- end }}
{{- end }}
{{- if .Values.lunaShopperBackend.enabled }}
{{- range .Values.lunaShopperBackend.services }}
{{- if and .routed (or (ne .env "staging") $.Values.staging.enabled) }}
{{- $_ := set $hosts .host true }}
{{- end }}
{{- end }}
{{- end }}
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: portfolio
  namespace: {{ .Values.namespace }}
  {{- if .Values.gateway.tls.enabled }}
  annotations:
    cert-manager.io/cluster-issuer: {{ .Values.gateway.tls.issuer }}
  {{- end }}
spec:
  gatewayClassName: {{ .Values.gateway.className }}
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Same
    {{- if .Values.gateway.tls.enabled }}
    {{- range $host, $_ := $hosts }}
    - name: {{ $host | replace "." "-" }}-https
      protocol: HTTPS
      port: 443
      hostname: {{ $host }}
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: {{ $host | replace "." "-" }}-tls
      allowedRoutes:
        namespaces:
          from: Same
    {{- end }}
    {{- end }}
```

cert-manager watches the Gateway, sees each `certificateRefs` Secret that does not exist,
and provisions it from the ClusterIssuer named in the annotation. The init container and
the certbot sidecar both become unnecessary, and so do both PVCs, because certificates
now live in Secrets rather than on a volume.

### 4.2 `templates/gateway/httproute.yaml.tpl`

One route per app. Flat, no grouping, no shared state between iterations.

```gotemplate
{{- range .Values.apps }}
{{- if or (ne .env "staging") $.Values.staging.enabled }}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ .name }}
  namespace: {{ $.Values.namespace }}
spec:
  parentRefs:
    - name: portfolio
  hostnames:
    - {{ .host }}
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: {{ .path }}
      {{- if ne .path "/" }}
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      {{- end }}
      backendRefs:
        - name: {{ .name }}
          port: 80
{{- end }}
{{- end }}
```

`parentRefs` deliberately omits `sectionName`. With `hostnames` set on the route, the
Gateway attaches it to whichever listener's hostname intersects, so hostname matching
does the work the `$appsByHost` dict used to do.

`ReplacePrefixMatch: /` is an exact behavioural match for the current
`rewrite ^{{ .path }}/?(.*)$ /$1 break;`, including the optional trailing slash:
`/landing/main.js` becomes `/main.js`, and a bare `/landing` becomes `/`.

The four `proxy_set_header` lines are not carried over because setting `Host` and the
`X-Forwarded-*` family is default behaviour in every conformant implementation.

### 4.3 `templates/gateway/https-redirect.yaml.tpl`

Today `listen 80;` and `listen 443 ssl;` share a server block with the same locations,
which means **plain HTTP currently serves the site unencrypted**. Adding a redirect is a
behaviour change, so it goes behind a value that is on in production and off locally.

```gotemplate
{{- if and .Values.gateway.tls.enabled .Values.gateway.tls.redirectHttp }}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
  namespace: {{ .Values.namespace }}
spec:
  parentRefs:
    - name: portfolio
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
{{- end }}
```

This does not break ACME HTTP-01. cert-manager creates a temporary solver route with an
**exact** path match on the challenge token, and the Gateway API specifies route
precedence (exact beats prefix, longer prefix beats shorter, ties broken by creation
timestamp), so the challenge wins over this catch all deterministically. Under Ingress
that ordering was implementation defined, which is a classic cause of renewals that fail
months after the initial issuance.

## 5. Chart deletions

Delete after the cutover in section 10 is verified, not before.

| Path | Lines | Note |
| --- | --- | --- |
| `templates/reverse-proxy/_nginx.conf.tpl` | 92 | |
| `templates/reverse-proxy/deployment.yaml.tpl` | 96 | |
| `templates/reverse-proxy/_init_container-certs.tpl` | 43 | |
| `templates/reverse-proxy/service.yaml.tpl` | 18 | |
| `templates/reverse-proxy/pvc.yaml.tpl` | 16 | |
| `templates/reverse-proxy/letsencrypt-pvc.yaml.tpl` | 13 | |
| `templates/reverse-proxy/configmap.yaml.tpl` | 10 | |
| **total** | **288** | replaced by roughly 90 lines across three files |

Values keys that become dead and should be removed in the same commit: `proxyImage`,
`certbotImage`, `certbot`, `reverseProxy`, `certsVolume`, and `replicaCount` (which was
only ever read by the proxy Deployment).

Two Nx projects also become unused: `apps/docker/reverse-proxy` and `apps/docker/certbot`.
CI derives its docker app list from the `type:static-docker` tag rather than a hardcoded
list, so deleting the project directories removes them from the build with **no workflow
edit required**. Confirm with `npx nx show projects --type app --with-target build` before
and after.

The PVCs are the one deletion with a side effect: removing them releases the volumes
holding the current Let's Encrypt account and certificates. Take a copy before the
cutover (section 10) so a rollback does not have to re-issue against rate limits.

## 6. Values shape and the portability contract

```yaml
# values.yaml
gateway:
  # Swapping the implementation should mean editing this block, plus the one
  # namespace in metallb.serviceNamespaces, and nothing else.
  # Read the installed class name from `kubectl get gatewayclass`.
  className: eg

  tls:
    enabled: true
    issuer: letsencrypt-prod   # selfsigned locally
    redirectHttp: true         # false locally, where everything is plain HTTP

  # Escape hatch for implementation specific annotations. Empty by design; anything
  # landing here is a signal to check whether the core spec covers it first.
  extraAnnotations: {}
```

The discipline that keeps the swap cheap is a single rule: **use only core
`gateway.networking.k8s.io/v1` types and in spec `filters`.**

| Portable | Implementation specific |
| --- | --- |
| `Gateway`, `HTTPRoute`, `GatewayClass`, `ReferenceGrant` | Envoy Gateway: `EnvoyProxy`, `BackendTrafficPolicy`, `ClientTrafficPolicy`, `SecurityPolicy`, `EnvoyPatchPolicy` |
| `filters`: `URLRewrite`, `RequestRedirect`, `RequestHeaderModifier`, `ResponseHeaderModifier`, `RequestMirror` | Traefik, for comparison: `IngressRoute`, `Middleware`, `TraefikService`, `ServersTransport`, and `traefik.io/*` annotations |
| `matches` on path, header, query, method | any `*.io/v1alpha1` policy CRD |
| `backendRefs` with `weight` | |

Everything this chart needs today is in the left column, with the single exception in 8.2.

The distinction worth keeping in mind is that Envoy Gateway's CRDs are **policy
attachments**, not alternative routing objects: an `EnvoyProxy` or a
`BackendTrafficPolicy` decorates a standard `Gateway` or `HTTPRoute` rather than
replacing it. So even where the chart is forced to use one, the routing itself stays
expressed in portable objects and only the decoration has to be re-devised. That is a
materially better failure mode than a proprietary route type, and it is the main reason
Envoy Gateway suits this requirement.

Swapping to another implementation would be: run the bootstrap with a different
implementation argument, change `gateway.className`, change the namespace in
`metallb.serviceNamespaces`, and re-express the one policy in 8.2.

## 7. Local development on Docker Desktop

The whole stack has to keep working on Windows with Docker Desktop Kubernetes, which it
does, because Gateway API is CRDs plus a controller Deployment and needs no cloud
infrastructure. The provisioned data plane Service is a LoadBalancer, and Docker Desktop
publishes those on `localhost`, exactly as the reverse proxy Service is published today.

Two Envoy Gateway specifics change the local muscle memory, and both belong in the README
update in step 8:

- The Service to inspect or port forward is in **`envoy-gateway-system`**, not
  `nx-portfolio`, and its name carries a hash. `kubectl get svc -n envoy-gateway-system`
  rather than a name that can be memorised.
- `metallb.enabled` is already `false` in every local overlay, so the namespace allocation
  from 3.1 is a production only concern and needs no local counterpart.

Effect on each existing overlay:

| Overlay | Effect |
| --- | --- |
| `values.localhost.yaml` (port mode, the default) | **Unaffected.** It sets `reverseProxy.enabled: false` and gives each app its own `lbPort`, bypassing the routing layer entirely. It needs no Envoy Gateway, no bootstrap, and no Gateway object. This stays the zero setup path. |
| `values.localhost-mfe.yaml` | Becomes one Gateway with a `localhost` listener plus five HTTPRoutes. Same host, same paths. |
| `values.local.yaml` | Becomes one Gateway with `portfolio.localhost` and `mfe.localhost` listeners. Same hosts. |

Both proxy using overlays gain:

```yaml
gateway:
  tls:
    enabled: true
    issuer: selfsigned
    redirectHttp: false
```

and **lose** `certsVolume.storageClassName: hostpath`. That override exists only because
the certs PVC defaults to k3s's `local-path`, which Docker Desktop does not have. Once
certificates live in Secrets there is no PVC and no storage class to reconcile, so the
local and production paths converge.

That convergence is the real gain here. Today the local certificate path (an init
container running `openssl req -x509`) is entirely different code from the production
path (certbot plus ACME), so a local deploy never exercises production's certificate
wiring at all. After this change both paths are the same objects and only the issuer name
differs.

One convenience worth testing before assuming otherwise: Chrome and Edge resolve
`*.localhost` to loopback internally, so `mfe.localhost` may work in a browser with no
hosts file entry and no administrator rights. The Windows resolver does not do this, so
`curl`, Node, and Playwright still need the entries.

## 8. Luna Shopper backend routes

`_nginx.conf.tpl` also renders server blocks for the routed Luna Shopper services, so
they must be ported or the chart breaks the moment `lunaShopperBackend.enabled` is
flipped. They are currently disabled, so this is not on the critical path, but it is not
optional either.

The gateway service is a plain host root route and maps directly onto the template in
4.2 with `path: /` and no rewrite.

### 8.1 `EnvoyProxy`, and why this plan does not need one

`EnvoyProxy` is the resource that configures the provisioned data plane: Service type and
annotations, replica count, resources, and which namespace it lands in. It attaches to a
Gateway through `spec.infrastructure.parametersRef`.

This plan deliberately uses none. The defaults are already what is wanted (a
`LoadBalancer` Service, one replica), and section 3.1 fixes the MetalLB allocation with a
one line values change rather than reaching for this CRD. Recording that as a decision
matters, because `EnvoyProxy` is the obvious tool to grab when the Service sits
`<pending>` and it would quietly make the chart implementation specific for no gain.

### 8.2 The one portability wart

The realtime service is the single place section 6's rule is knowingly broken. Its nginx
block carries WebSocket upgrade headers and `proxy_read_timeout 3600s` /
`proxy_send_timeout 3600s`. The upgrade headers need nothing (HTTP/1.1 upgrade is handled
for a normal `HTTPRoute`), but the long lived connection timeouts have no core spec
equivalent yet and must be expressed per implementation:

- Envoy Gateway: a `BackendTrafficPolicy` with a `targetRef` at the realtime `HTTPRoute`,
  setting the stream idle and request timeouts
- Traefik, if ever swapped back to: a `ServersTransport`, or an entrypoint level timeout

Keep it in a single clearly named file, `templates/gateway/_implementation-envoy.yaml.tpl`,
gated on `.Values.gateway.className`, so the port is mechanical and the blast radius is
one file. It should carry a comment saying it is the deliberate exception.

Because a `BackendTrafficPolicy` only decorates the `HTTPRoute`, the realtime route itself
stays a portable object: swapping implementations loses the timeout tuning, not the
routing, and the symptom would be sockets dropping at the default idle timeout rather
than the service failing to route at all.

## 9. Out of scope

- **`k8s/e2e/portfolio-frontend/`.** That stack is Docker Compose, not Kubernetes, and it
  hand mirrors the routing in its own `nginx.conf`. It exists to test the published
  **images** (the shell's baked MFE host, each remote's static server headers), not the
  cluster's routing layer, and Gateway API has nothing to offer it. It keeps its nginx.
  Its prefix stripping semantics must stay equivalent to the HTTPRoute filters, so a
  change to one is a prompt to check the other.
- **Multiple nodes, load balancing across hosts, spread constraints, PodDisruptionBudgets
  for the frontend apps.** The cluster is one VPS.
- **Migrating SQLite to etcd.** Only multiple *server* nodes require it; agents never
  touch the datastore, and there is one server. Revisit only if a second control plane is
  ever wanted, and note that the migration is one way.
- **Readiness probes and replica counts on the frontend apps.** Worth doing, unrelated to
  routing, and better as its own plan so this one stays reviewable.
- **`docker/prod/`.** A legacy Compose setup with its own nginx and certbot. Nothing in
  the repo references it. Deleting it is a separate cleanup.

## 10. Cutover order

Steps 1 through 4 are non destructive and reversible; the running nginx proxy keeps
serving throughout.

1. **Rehearse locally.** Bootstrap Docker Desktop with `install.ps1`, deploy with
   `values.localhost-mfe.yaml`, and confirm the shell and all four remotes load. This is
   where listener and route attachment problems get found, at zero cost.
2. **Back up the certificates.** On the VPS, copy the contents of the `certs-pvc` and
   `letsencrypt-pvc` volumes off the node. Let's Encrypt rate limits make a lost account
   annoying rather than fatal, but there is no reason to find out.
3. **Bootstrap the VPS.** Run `install.sh`, then apply the MetalLB pool change from 3.1.
   The bundled k3s Traefik must be disabled (`--disable=traefik`) so it does not contend
   for ports 80 and 443; check the existing k3s flags first, since MetalLB's presence
   suggests `--disable=servicelb` is already set.
4. **Deploy the Gateway and HTTPRoutes alongside the existing proxy**, staging hostnames
   only. Both stacks coexist: the nginx proxy still holds `46.62.204.230`, so the
   provisioned Service will sit `<pending>` at this stage, which is expected rather than
   the 3.1 failure. Verify through `kubectl port-forward` against the
   `envoy-gateway-system` Service. Confirm certificate issuance, prefix stripping on every
   remote, and the HTTP to HTTPS redirect.
5. **Cut over.** Delete the reverse-proxy templates and values keys from section 5, then
   `helm upgrade`. The provisioned Service takes the LoadBalancer IP once the proxy
   Service releases it; confirm with `kubectl get svc -n envoy-gateway-system` before
   testing hostnames. Watch route attachment status rather than guessing:

   ```sh
   kubectl get httproute -n nx-portfolio -o wide
   kubectl describe gateway portfolio -n nx-portfolio
   ```

   Unlike Ingress, a route that fails to attach says so, and says why.
6. **Verify production hostnames**, then run the e2e suites against the deployment.
7. **Delete the Nx projects** `apps/docker/reverse-proxy` and `apps/docker/certbot`, and
   confirm CI's affected list shrinks on the next run with no workflow edit.
8. **Update `k8s/README.md`** for the new local flow: the bootstrap step, the removal of
   the `certsVolume` override, and the fact that port mode still needs none of it.

## 11. Rollback

Until step 5, rollback is doing nothing, because nginx is still serving. After step 5 it
is `helm rollback nx-portfolio`, which restores the proxy Deployment, its ConfigMap, and
the PVC references. The PVCs themselves survive a `helm rollback` only if they were not
deleted; Helm does not delete PVCs it did not create, but it does delete the ones declared
in these templates, which is why step 2 exists.

## 12. Exit criteria

- Production and staging serve on all four hostnames through Envoy Gateway, with valid
  Let's Encrypt certificates issued by cert-manager, and no nginx proxy pod in the
  namespace.
- The provisioned Service in `envoy-gateway-system` holds `46.62.204.230` rather than
  sitting `<pending>`.
- `templates/reverse-proxy/` is gone, and the chart's routing is three files totalling
  roughly 90 lines.
- Plain HTTP redirects to HTTPS in production.
- `helm template` renders no `gateway.envoyproxy.io` object except the single file named
  in 8.2, and no `EnvoyProxy` at all.
- All three local overlays work on Windows with Docker Desktop, `values.localhost.yaml`
  still with no bootstrap at all, and no overlay sets a storage class for certificates.
- `apps/docker/reverse-proxy` and `apps/docker/certbot` are deleted and CI is green with
  no workflow changes.
- `k8s/README.md` documents the bootstrap and the revised local modes.
