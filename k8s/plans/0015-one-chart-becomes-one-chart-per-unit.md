> **PR:** [#815](https://github.com/IchirokuXVI/nx-portfolio/pull/815)

# 0015 One chart becomes one chart per unit

> Second plan of the deploy unit series (`0014` defines the unit, `0016` deploys it, `0017`
> releases it). This plan splits the Helm chart and prepares the bootstrap. It leaves the
> deployed clusters, the workflows and the old chart untouched: the old chart keeps deploying
> until `0016` switches the workflows and performs the cutover. Every statement below was
> read on the branch of PR #810 at `e5320be3`.
>
> Prerequisite reading: `0001` (the Gateway API migration and why the Gateway has one
> listener per host), `0002`, `0006`, `0011`, `0014`, `apps/velista/plans/0165` D2, D6 and
> D7 (the portfolio path of velista), `k8s/README.md`, `k8s/README-new-cluster.md`.

## Brief for the agent

### Objective

Turn `k8s/helm` into a library chart and two unit charts, so that each unit renders only its
own objects into its own namespace, owns its own Gateway, its own certificates and its own
issuer, and can be installed on a cluster that has never seen the other unit. Make the
provisioning scripts take a unit. Keep the rendered objects of each unit equal to what the
old chart renders for them today, except for the differences this plan names.

Use `antislop` with `antislop-code` for every comment you write or move.

### Context

Every statement below was read on the branch of PR #810 at `e5320be3`.

- **The chart ignores `.Release.Namespace`.** Every template writes
  `namespace: {{ .Values.namespace }}` (for example `templates/apps/deployment.yaml.tpl:7`
  and `templates/gateway/gateway.yaml.tpl:40`), the value is hard coded at
  `values.yaml:1`, and `helm --namespace` is passed separately. The two can diverge
  silently. `templates/luna-shopper-backend/configmap.yaml.tpl:186` builds
  `GATEWAY_INTERNAL_URL` from it, and `migration-job.yaml.tpl:15` looks the namespace up
  to choose the hook phase.
- **One Gateway named `portfolio`** (`gateway.yaml.tpl:39`) carries one shared `http`
  listener on port 80 with no hostname and one HTTPS listener per host across both units.
  Every listener admits routes from the `Same` namespace only (`:61-63`, `:75-77`). Every
  HTTPRoute names `parentRefs: portfolio` (`httproute.yaml.tpl:52`, `:98`,
  `https-redirect.yaml.tpl:23`). The redirect route sits on the shared `http` listener.
- **Envoy Gateway makes one data plane per Gateway.** The data plane Service
  (`envoy-<namespace>-<name>-<hash>` in `envoy-gateway-system`) is type LoadBalancer and
  takes the one MetalLB address. k3s runs with servicelb disabled and MetalLB from
  `install.sh`. A second Gateway on the same node would create a second LoadBalancer Service
  with no address to take. Envoy Gateway's `EnvoyProxy` resource has `mergeGateways: true`,
  which merges every Gateway of a GatewayClass into one data plane, and the GatewayClass
  names the `EnvoyProxy` through `parametersRef`. In that mode the tuple of port, protocol
  and hostname must be unique across all listeners. `install.sh` creates GatewayClass `eg`
  with no `parametersRef` (`:274-281`).
- **The cert issuer is pinned to that Gateway.** `install.sh:314-333` creates
  `ClusterIssuer letsencrypt-prod` whose HTTP-01 solver creates its challenge HTTPRoute
  with `parentRefs` to `Gateway ${GATEWAY_NAME}` in `${GATEWAY_NAMESPACE}` (defaults
  `portfolio`, `nx-portfolio`). cert-manager creates a Certificate and its Secret in the
  Gateway's namespace. A Gateway in a second namespace cannot get a certificate as written.
- **The MetalLB pool is rendered by the chart** into `metallb-system` with fixed names
  `main-pool` and `main-advertisement` (`templates/ipadd-pool.yaml.tpl`). It is cluster
  level. Two releases that both render it collide on Helm ownership.
- **`PriorityClass luna-stateful`** (`templates/luna-shopper-backend/priorityclass.yaml.tpl`)
  is cluster scoped and belongs to the velista side only.
- **The portfolio path of velista** (PR #809, plan 0165 D6): the `velista` entry of
  `values.yaml:178-186` carries `mounts: [{name: portfolio, hostPrefix: '', path:
  /velista, keepPrefix: true}]`. `httproute.yaml.tpl:25-41` renders one more route per
  mount, named `<entry>-<mount>`, on the host the mount composes, with the entry's own
  Service as backend and no URLRewrite when `keepPrefix` is true. `gateway.yaml.tpl:24-27`
  adds mount hosts to the listener set. The velista pod owns the prefix with its own
  `apps/velista/src/nginx.conf`.
- **Global values span both units**: `imageTag` (`values.yaml:65`), `baseDomain` (`:24`,
  velista's hosts are exceptions through `hostOverrides` in the environment files),
  `gateway.*` (`:81-110`), `appImagePullPolicy`, `imagePullSecrets`, `metallb.*`,
  `ipAddress`.
- **`provision-release.sh`** takes `--env production|staging` (`:66-73`), always applies
  `k8s/namespace.yaml` (`:443`, hard coded `nx-portfolio`), writes the Luna Secrets, and
  `--check` renders the whole chart as `nx-portfolio` (`:259`) and fails a render that
  references no Secret key at all (`:277`).
- **`run-release-tasks.sh`** defaults `NAMESPACE` and `RELEASE_NAME` to `nx-portfolio`
  (`:98-99`), keeps its ledger in ConfigMap `release-tasks` of that namespace (`:105`), and
  detects a first install with `helm status nx-portfolio` (`:347`).
- **Local and homelab values files**: `values.local.yaml`, `values.localhost.yaml` and
  `values.localhost-mfe.yaml` redefine `apps` with the four portfolio apps and keep Luna
  off. `values.homelab.yaml` inherits the full `apps` list and enables Luna on one domain
  with `ClusterIssuer letsencrypt-dns01` (`cluster-issuer-dns01.sh`, scoped to the
  `ichirokuxvi.com` zone).
- `Chart.yaml` is generator boilerplate (`name: charts`, version never bumped), and
  `charts.fullname`, `charts.labels` and `charts.serviceAccountName` in `_helpers.tpl` have
  no caller.

### Target state

- `k8s/helm/common` is a library chart. `k8s/helm/portfolio` and `k8s/helm/velista` are
  installable charts that depend on it. Each has `values.yaml`, `values.staging.yaml` and
  `values.production.yaml`. The portfolio chart also has the three local files. Both have a
  `values.homelab.yaml`.
- Every object takes its namespace from `.Release.Namespace`. The `namespace` values key is
  gone.
- Each unit chart renders one Gateway named after the unit, with one `http` and one `https`
  listener per host, and an `Issuer` of its own when the environment uses ACME.
  `install.sh` turns on merged gateways and no longer creates `letsencrypt-prod` or the
  MetalLB pool through the chart.
- The portfolio chart renders the `/velista` route on the portfolio host with a cross
  namespace backend. The velista chart renders the `ReferenceGrant` that allows it.
- `provision-release.sh --unit <u> --env <e>` provisions one unit. `--check` renders that
  unit's chart. `run-release-tasks.sh`, `deploy-release.sh`, `deploy-homelab.sh`,
  `restore-database.sh` and the catalog scripts take the unit too.
- The old chart (`k8s/helm/Chart.yaml`, `k8s/helm/templates/`, `k8s/helm/values*.yaml`)
  is untouched and still renders byte for byte what it rendered before. `0016` deletes it.

### Scope

`k8s/helm/common/**`, `k8s/helm/portfolio/**`, `k8s/helm/velista/**`,
`k8s/helm/.helmignore`, `k8s/bootstrap/install.sh`, `k8s/bootstrap/install.ps1`,
`k8s/bootstrap/provision-release.sh`, `k8s/release-tasks/run-release-tasks.sh`,
`k8s/release-tasks/check-tasks.mjs` and its test, `k8s/release-tasks/tasks/*/task.env`,
`k8s/helm/deploy-release.sh`, `k8s/helm/deploy-homelab.sh`, `k8s/helm/restore-database.sh`,
`k8s/catalog-import/*.sh`, `k8s/catalog-reset/*.sh`, `k8s/catalog-seed/*.sh`,
`tools/deploy/units.mjs` (the render check of `0014` D4), `k8s/README.md`,
`k8s/README-new-cluster.md`, `k8s/README-homelab.md`, `k8s/helm/luna-shopper-backend-secrets.md`.

### Constraints

- The old chart must not change. `helm template nx-portfolio k8s/helm -f values.yaml -f
  values.staging.yaml` before and after this PR must be identical. The workflows keep
  deploying it until `0016`.
- The objects of a unit that the new chart renders must equal the objects the old chart
  renders for that unit, after a normalisation of namespace and release labels, except for
  the differences in D3, D4, D5, D6 and D12. The builder posts the diff in the PR.
- Names of Deployments, Services, StatefulSets, PVC templates, Secrets, ConfigMaps and
  CronJobs do not change. The cutover of `0016` adopts them by name.
- No chart renders a cluster scoped object that another chart could also render.
- Templates stay `*.yaml.tpl`, formatted by the go template prettier plugin as today.

### Action boundaries

- Do not edit the workflows, the e2e gates or `CLAUDE.md`'s deploy instructions. `0016`
  owns them.
- Do not run anything against the staging or production clusters. Render locally and
  install on Docker Desktop Kubernetes only.
- Stop and ask before you rename or delete any Secret key.

### Progress evidence

`helm lint` and `helm template` for both charts and both environments. The normalised diff
against the old chart, with every difference traceable to a decision below. Both charts
installed on Docker Desktop Kubernetes with merged gateways and a self signed issuer, the
portfolio answering on its hosts and the velista chart installed with `lunaShopperBackend`
on against locally provisioned Secrets. `provision-release.sh --check --unit portfolio
--env staging` and `--unit velista --env staging` both exit 0 against those renders.

## 1. Purpose

A chart per unit is what makes "deploy velista alone" a Helm command and not a filter. A
release owns its objects, rolls back as a whole, waits as a whole and is uninstalled as a
whole. One chart with `enabled` switches is still one release, one namespace and one
rollback scope, so it gives no isolation. The shared pieces (how a static app deploys, how a
route is written, how a host is composed) move into a library chart, so the two unit charts
stay small and a third one is a copy of the smaller.

## 2. What stays true

- One HTTPS listener per host, one certificate per host, cert-manager through the Gateway
  annotation, the HTTPS redirect on the plain listener (plan 0001).
- The chart describes one environment, chosen by the cluster and the values file (plan
  0002). The `environment` key stays.
- Luna's templates, env helpers, hooks, backups and switches move as they are. The three
  harvester switches keep their meaning.
- `apps/velista/src/nginx.conf` and the gate curls of plan 0165 D7 are unchanged. The
  portfolio path still reaches the velista pod with the prefix kept.

## 3. Decisions

### D1. Layout

```
k8s/helm/
  common/                 type: library, name common
    Chart.yaml
    templates/_app.tpl    static app: Deployment, Service, HTTPRoute(s)
    templates/_gateway.tpl  Gateway from a host set, Issuer, https redirect
    templates/_helpers.tpl  charts.host, imagePullSecrets, labels
  portfolio/
    Chart.yaml            dependencies: common, file://../common
    values.yaml, values.staging.yaml, values.production.yaml
    values.local.yaml, values.localhost.yaml, values.localhost-mfe.yaml, values.homelab.yaml
    templates/            thin: calls the library templates, plus the external route (D6)
  velista/
    Chart.yaml            dependencies: common, file://../common
    values.yaml, values.staging.yaml, values.production.yaml, values.homelab.yaml
    templates/            thin app calls, the whole luna-shopper-backend/ directory moved,
                          the ReferenceGrant (D6), the PriorityClass
  Chart.yaml, values*.yaml, templates/   the OLD chart, untouched until 0016
```

`Chart.lock` of each unit chart is committed. `charts/` is ignored. `helm dependency build
--skip-refresh` (which packages `file://../common` offline against the committed lock and
rewrites nothing) runs in the deploy preflight and in `--check`. `helm dependency update`
is run by hand when `common` changes, and its lock diff is committed with the change. The old chart's `.helmignore` lists `common/`, `portfolio/` and `velista/` so
its package stays what it was.

Chart names are `portfolio` and `velista`, version `0.1.0`, `appVersion` removed. Nothing
reads them; the image tag is the version that matters.

### D2. The namespace is `.Release.Namespace`

Every template writes `namespace: {{ .Release.Namespace }}`. The `namespace` values key is
removed from both unit charts. `GATEWAY_INTERNAL_URL` and the migration hook lookup read
`.Release.Namespace`. `helm --namespace <ns>` is then the one place that decides, and the
`NAMESPACE` of `unit.env` is what every script passes.

### D3. A Gateway per unit, merged into one data plane

Each unit chart renders `Gateway <unit>` in its namespace with, for every host of the unit:

- `<host>-http`, HTTP, port 80, `hostname: <host>`, routes from `Same`
- `<host>-https`, HTTPS, port 443, `hostname: <host>`, TLS from Secret `<host>-tls`, routes
  from `Same`

The hostname less `http` listener goes away, because two merged Gateways cannot both own
port 80 with no hostname. The HTTPS redirect route lists the unit's hosts in `hostnames`
and attaches to each `<host>-http` listener by `sectionName`. The ACME challenge route that
cert-manager creates carries the host in `hostnames`, so it intersects the right `http`
listener without a `sectionName`. Gateway API precedence keeps the exact challenge path
above the catch all redirect, as today.

`install.sh` and `install.ps1` create, beside the GatewayClass:

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: merged
  namespace: envoy-gateway-system
spec:
  mergeGateways: true
```

and give GatewayClass `eg` a `parametersRef` to it. One Envoy fleet then serves every
Gateway of the class, and its one LoadBalancer Service takes the MetalLB address. On a
cluster with one unit nothing changes except the Service name, so a single unit server runs
the same bootstrap. The `GATEWAY_NAME` and `GATEWAY_NAMESPACE` variables of `install.sh`
lose their reader (D4) and are removed. The verification text at the end of the script
names the merged Service.

Alternative considered: one shared Gateway in an infrastructure namespace with
`allowedRoutes.namespaces.from: Selector`, routes attached across namespaces. It keeps one
data plane without merging, but every new host is an edit to shared infrastructure and
every certificate lives outside the unit that uses it. A unit that moves server would leave
its certificates behind. `ListenerSet` (Gateway API v1.5) would fix that later, but
cert-manager's support for it is alpha. Merged Gateways give each unit its own listeners,
certificates and issuer now, and a move is a `helm install` elsewhere.

### D4. A unit brings its own issuer

`gateway.tls.issuer` becomes an object:

```yaml
gateway:
  tls:
    enabled: true
    issuer:
      kind: Issuer            # Issuer | ClusterIssuer
      name: letsencrypt
      create: true            # render the Issuer below; false to use one that exists
      acme:
        server: https://acme-v02.api.letsencrypt.org/directory
        email: ''             # required when create is true
```

When `create` is true the chart renders a namespaced `Issuer` with an ACME account Secret
`<name>-account-key` and an HTTP-01 `gatewayHTTPRoute` solver whose `parentRefs` is the
unit's own Gateway. The Gateway annotation is `cert-manager.io/issuer` for kind `Issuer`
and `cert-manager.io/cluster-issuer` otherwise. Staging and production of both units set
`create: true` and the owner's email. The local files keep `kind: ClusterIssuer, name:
selfsigned, create: false`. Homelab keeps `kind: ClusterIssuer, name: letsencrypt-dns01,
create: false`.

`install.sh` stops creating `ClusterIssuer letsencrypt-prod`; its `--issuer letsencrypt`
branch becomes a no op with a message, and `--issuer selfsigned` stays. The
`letsencrypt-prod` object on the two existing clusters is deleted by the cutover (`0016`
D5) after each unit's Certificates are Ready under their own Issuer.

Each unit thus registers its own ACME account. The Let's Encrypt limits that matter here
are per registered domain and per exact name set, and the per account order limits are far
above this volume, so two accounts cost nothing. Never issue one certificate that covers
hosts of both units.

### D5. MetalLB leaves the chart

`install.sh` gains `--ip <address>` and applies `IPAddressPool main-pool` and
`L2Advertisement main-advertisement` itself, idempotently, with `serviceAllocation.namespaces:
[envoy-gateway-system]` (the only namespace that holds a LoadBalancer Service now). The
`metallb.*` and `ipAddress` keys are removed from the unit charts. `README-new-cluster.md`
step 4 moves the address from the values file to the `install.sh` call. The objects that
the old release owns are taken over by the cutover (`0016` D5).

The fresh install path of `install.sh` and `install.ps1` also creates the merged
`EnvoyProxy` of D3 and the `parametersRef`. The `--merge-only` entry point that switches an
existing cluster, and the takeover of the live pool, belong to `0016`.

### D6. The portfolio path of velista is a portfolio route with a velista grant

The `mounts` field of plan 0165 D6 is retired. Its one user becomes two explicit objects:

In `k8s/helm/portfolio/values.yaml`:

```yaml
externalRoutes:
  - name: velista
    hostPrefix: ''          # the portfolio root host, composed by charts.host as any entry
    path: /velista
    keepPrefix: true
    backend:
      service: velista
      namespace: luna-shopper   # the velista unit's NAMESPACE; staging and production agree
      port: 80
```

renders HTTPRoute `velista-portfolio` in the portfolio namespace on the portfolio host,
with a `backendRefs` entry that names the namespace, no URLRewrite, and the same
`sectionName` pinning as the app routes. The object keeps the name that PR #809 gave it, so
the gate curls and the dashboards read the same route.

In `k8s/helm/velista/values.yaml`:

```yaml
referenceGrants:
  - name: portfolio-reaches-velista
    fromNamespace: portfolio          # the portfolio unit's NAMESPACE
    toServices: [velista]
```

renders a `ReferenceGrant` in the velista namespace from `HTTPRoute` in `portfolio` to
`Service velista`. The grant is the velista unit's consent, written in its own chart. The
route is the portfolio's decision about its own host, written in the portfolio's chart.
When velista moves server (backlog `0002`) the portfolio changes this route to a redirect
or to an external backend, and the velista chart drops the grant. Neither change touches the
other unit's release.

The `hostOverrides` by mount name and the `keepPrefix` branch of the app route template go
with `mounts`. `charts.host` and the entry level `host` and `hostOverrides` stay.

The two namespace literals (`backend.namespace` in the portfolio values, `fromNamespace` in
the velista values) are the one place where a unit names the other's namespace.
`provision-release.sh --check` (D8) asserts that each equals the `NAMESPACE` of the other
unit's `unit.env`, so a rename (`0014` D3, backlog `0002` D1) fails the preflight until both
values follow.

### D7. Values per unit

Portfolio `values.yaml`: `baseDomain`, `environment`, `imageTag`, `appImagePullPolicy`,
`imagePullSecrets`, `gateway`, `apps` (shell, odontogram, damoclessword, landingv2),
`externalRoutes`. The three local files move in unchanged except for the removed keys.
`values.homelab.yaml` of the portfolio keeps its portfolio half.

Velista `values.yaml`: `baseDomain: velista.app` with `hostPrefix` `''`, `admin`, `api`,
`rt` on the entries and routed services, so the hosts compose from the unit's own domain and
`hostOverrides` is empty in staging and production (staging sets `baseDomain:
staging.velista.app`). `apps` (velista, luna-shopper-admin), `referenceGrants`, and the
whole `lunaShopperBackend` block with its `enabled` switch kept (a web only render is still
useful locally). `corsOrigins` keeps the portfolio origin, because the portfolio path
still serves velista from that origin. The homelab file names velista's hosts under the
owner's one domain through `hostOverrides` (`velista.ichirokuxvi.com`, `admin.`, `api.`,
`rt.`), because the velista root entry with `hostPrefix: ''` would otherwise claim the
portfolio's root host and the merged data plane rejects the duplicate listener. It turns
the ReferenceGrant off.

`imageTag` stays one value per chart, and is now per unit, which is what `0017` needs.

### D8. `provision-release.sh --unit`

`--unit <u>` is required beside `--env`. The script sources `k8s/units/<u>/unit.env`,
ensures the namespace with `kubectl create namespace --dry-run=client -o yaml | kubectl
apply -f -` (and `k8s/namespace.yaml` is deleted), provisions exactly the Secrets listed in
`SECRETS` (the velista list is today's six, with the backup Secret still printed and not
created; the portfolio list is empty, so the script creates the namespace and stops), and
writes the plaintext copy to `~/<unit>-<env>-secrets.txt`. `--check` runs `helm
dependency build --skip-refresh` and `helm template <RELEASE_NAME> <CHART> --namespace
<NAMESPACE> -f values.yaml -f values.<env>.yaml`, then the existing assertions. The "no
keys at all" guard applies only when `SECRETS` is non empty. `--check` also fails when the
rendered Gateway hostnames differ from `HOSTS_<ENV>` of `unit.env`, and when a cross unit
namespace literal (D6) differs from the other unit's `NAMESPACE`. These two are the render
half of the registry check; `units.mjs check` (`0014` D4) stays Node only.

### D9. Release tasks take a unit

`run-release-tasks.sh --unit <u>` sources `unit.env` for `NAMESPACE` and `RELEASE_NAME`,
runs `helm status <RELEASE_NAME>` for first install detection, and exits 0 at once with a
line in the summary when `RELEASE_TASKS` is false. Each `task.env` gains `UNIT=velista`,
and `check-tasks.mjs` requires the key and asserts the directory exists. The ledger is
ConfigMap `release-tasks` in the unit's namespace; the cutover of `0016` D5 copies it into
`luna-shopper` together with the data.

A release counts as a first install only when `helm status <RELEASE_NAME>` fails **and**
the ledger ConfigMap is absent. Before the cutover of `0016` D5 the release `velista` does
not exist while the ledger does, and the rule as it stands today (`run-release-tasks.sh:338-352`)
would record every due task as `skipped`, which is final.

### D10. Every host script takes the unit

`deploy-release.sh <unit> <version>` and `deploy-homelab.sh <unit>` source `unit.env`,
run `helm dependency build --skip-refresh` on the chart, and pass `--namespace`.
`deploy-release.sh` waits on the Deployments of its own release (`helm get manifest |
kubectl rollout status -f -` over the Deployment documents), not on every Deployment in the
namespace. Its recovery path (`:76-100`), which uninstalls a release whose only revision is
`failed` on the assumption that it never served traffic, refuses when the namespace holds a
StatefulSet or the release carries the adoption annotation that `0016` D5 writes: a release
that adopted live objects is never one that never served. `deploy-homelab.sh` reads the
live tag from the first Deployment of the unit's own chart, not from `shell`.
`restore-database.sh`, `catalog-import`, `catalog-reset` and `catalog-seed` default
`NAMESPACE` from the velista `unit.env`.

### D11. `install.ps1` follows `install.sh`

The two bootstraps stay equivalent: merged gateways, no `letsencrypt-prod`, MetalLB pool by
flag.

### D12. The PriorityClass stays with velista

`PriorityClass luna-stateful` renders from the velista chart only. The cutover adopts it.

### D13. The render diff is the proof

The builder writes a throwaway script (kept under `tmp/`, not committed) that renders the
old chart and both new charts for staging and production, normalises namespace and release
labels, sorts documents by kind and name, and diffs. Selectors, `volumeClaimTemplates` and
the other immutable fields are compared without normalisation, because a change there makes
the adopting install of `0016` D5 fail. Expected differences, and no others:

- Gateway: two objects instead of one, `<host>-http` listeners instead of `http`, the
  annotation kind (D3, D4).
- Issuer: new in each namespace (D4).
- HTTPRoute `https-redirect`: one per unit, `hostnames` and `sectionName` set (D3).
- HTTPRoute `velista-portfolio`: in the portfolio namespace with a namespaced backend
  (D6). `ReferenceGrant`: new (D6).
- `IPAddressPool`, `L2Advertisement`: gone (D5).
- `GATEWAY_INTERNAL_URL`: same string, now from `.Release.Namespace` (D2).

## 4. Who edits what

One builder, one PR, title `refactor(helm): one chart per deploy unit over a library chart
(plan 0015)`. The scope list of section "Scope" is the file list.

## 5. Acceptance

- `helm lint k8s/helm/portfolio k8s/helm/velista` passes.
- `helm template` of each unit chart for staging and production renders, and the normalised
  diff of D13 shows only the listed differences. The old chart renders byte for byte what it
  rendered at the base commit.
- `node tools/deploy/units.mjs check` passes with the render half on.
- On Docker Desktop Kubernetes (`k8s/docker-desktop-kubernetes-wsl2.md`), after
  `install.sh --issuer selfsigned` with merged gateways: `helm install portfolio
  k8s/helm/portfolio -n portfolio --create-namespace -f values.yaml -f values.local.yaml`
  answers on its hosts; `provision-release.sh --unit velista --env staging` against that
  cluster writes the Secrets into `luna-shopper`, and `helm install velista
  k8s/helm/velista -n luna-shopper -f values.yaml -f values.staging.yaml --set
  gateway.tls.issuer.kind=ClusterIssuer --set gateway.tls.issuer.name=selfsigned --set
  gateway.tls.issuer.create=false` brings every Luna pod to Ready. One Envoy Service exists
  in `envoy-gateway-system`.
- `bash k8s/bootstrap/provision-release.sh --check --unit portfolio --env production` and
  `--unit velista --env production` exit 0 against a render (the cluster half may be skipped
  with the existing `--check` conventions where no cluster is reachable).
- `pr.yml` is green. `docker-ci.yml` and `release.yml` are untouched and still deploy the
  old chart.

## 6. `k8s/README.md` and the runbook

`k8s/README.md` gains a section "Two charts, one library" with the layout of D1 and the
rule "a unit renders only into `.Release.Namespace` and owns its Gateway, its Issuer and its
certificates". `README-new-cluster.md` changes step 4 (the address goes to `install.sh
--ip`), step 5 (`provision-release.sh --unit <u> --env <e>`, one time per unit), step 8 and
9 (one release per unit) and the ordered list in step 12. `README-homelab.md` and
`deploy-homelab.sh` describe two releases.

## 7. Decisions left for the owner

1. **D4, one ACME account per unit** (recommended) or one `ClusterIssuer` in the bootstrap
   whose solver lists both Gateways in `parentRefs`. The second keeps the bootstrap aware of
   the unit list.
2. **D6, the portfolio path stays served** (plan 0165 D1) or becomes a redirect now. A
   redirect deletes the external route, the grant, the `keepPrefix` nginx block and the
   portfolio origin in `corsOrigins`.
3. **D7, `baseDomain: velista.app`** for the velista unit, or keep `hostOverrides` as today.
