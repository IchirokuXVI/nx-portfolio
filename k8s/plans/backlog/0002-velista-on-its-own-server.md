# 0002 (backlog) velista on its own server

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.
>
> This is the move that the deploy unit series (`0014` to `0017`) exists to make possible.
> The owner said on 2026-10-23: "this is to allow velista to work on its own, so I have the
> option to create new servers without deploying the whole portfolio". It is written now so
> that the series is judged against the move it has to allow, and parked because no server is
> ordered. It needs `0014` to `0017` built, and it leans on `0005` (backups and restore),
> `0006` (scripted provisioning) and `0012` (a catalog reaches a cluster by restore).

## Brief for the agent

### Objective

Run the velista unit (velista, the back office, the seven Luna services and their data) on a
k3s cluster of its own, with the portfolio unit untouched on the old server, and with no
change to a chart template, a pipeline or an application.

### Context

After `0014` to `0017`:

- The velista unit is release `velista` in namespace `nx-portfolio` on the shared server,
  with its own Gateway, Issuer, certificates and Secrets. Its hosts are `velista.app`,
  `admin.`, `api.` and `rt.` (one label down in staging). Its deploy reads the host and key
  from the environments `velista-staging` and `velista-production`.
- The portfolio unit serves `ichirokuxvi.com/velista` through HTTPRoute `velista-portfolio`
  with a cross namespace backend to the velista Service, allowed by a ReferenceGrant in the
  velista chart (`0015` D6). The landing links to `/velista/<locale>` and the backend's
  `corsOrigins` lists the portfolio origin.
- The backups of the four databases go to S3 on a schedule (`0005`), and
  `restore-database.sh` restores one dump. `README-new-cluster.md` brings up a machine from
  nothing in twelve steps, with `provision-host.sh`, `install.sh` and `provision-release.sh
  --unit --env`.
- Host patching (`0013`) patches one staging host and one production host, with a two day
  soak between them, and holds the deploy concurrency group of each host.

### Target state

Two servers per environment, or one new production server first and staging later. The
velista unit answers on its hosts from the new cluster, with its data restored, its
certificates issued there, and its Android App Links verified against the new origin. The
portfolio host still answers `/velista`, as a redirect or as a proxy to the new origin
(D2). Host patching covers the new host.

### Scope

`k8s/README-new-cluster.md` (a unit flag on the steps), the four GitHub environment values
of velista, `k8s/helm/portfolio/values.*.yaml` (the external route becomes a redirect or an
external backend), `k8s/helm/velista/values.*.yaml` (no ReferenceGrant, the namespace
`velista`, a new `ipAddress` in `install.sh --ip`), `.github/workflows/host-maintenance.yml`
and the staging and production callers of velista (a concurrency group per host),
`k8s/units/velista/unit.env` (`NAMESPACE=velista`).

### Constraints

- The data moves by restore from the last backup plus a final dump taken with the API in
  read only or stopped, inside a window the owner announces. `0012` is the pattern.
- Secrets are copied, never regenerated: `HARVESTER_ACTOR_ID` and both JWT keypairs must be
  the same bytes on the new cluster. `provision-release.sh` gains `--from-file` for that.
- DNS moves per host, api and rt first, then admin, then velista, so that a client app that
  resolves early finds a backend.

### Action boundaries

The owner orders the machine, holds the DNS, and chooses the window. The builder prepares
the scripts and the runbook and runs the staging move.

### Progress evidence

`helm list -A` on the new cluster shows `velista` only; on the old one `portfolio` only. The
four velista URLs answer from the new address. A restored list is readable in the app.
`host-maintenance.yml` patches three hosts.

## 1. Decisions to take when this is picked up

### D1. The namespace becomes `velista`

A restore into a fresh cluster is the one moment where the namespace of the velista unit
changes at no cost (`0014` D3). `unit.env` says `NAMESPACE=velista`, and the release task
ledger starts empty there, which `run-release-tasks.sh` treats as a first install.

### D2. What `ichirokuxvi.com/velista` does afterwards

Two options, both one values change in the portfolio chart:

- **Redirect.** The external route becomes a `RequestRedirect` filter to
  `https://velista.app` with the path kept. The nginx `sub_filter` block of
  `apps/velista/src/nginx.conf` and the portfolio origin in `corsOrigins` are then dead and
  go. This is what `apps/velista/plans/0013` D5 planned and plan 0165 D1 postponed. Sessions
  are per origin already, so a user loses nothing but the address.
- **Proxy.** Envoy Gateway's `Backend` resource with an FQDN endpoint lets the route send
  `/velista` to `velista.app` over TLS. The address survives, at the cost of a second TLS hop
  and a backend that can be slow for reasons the portfolio cannot see.

The recommendation is the redirect.

### D3. Concurrency per host

The velista callers take the groups `staging-deploy-velista` and `production-release-velista`,
and `host-maintenance.yml` gains a `staging-velista` and a `production-velista` job that hold
them, with the soak between the two velista hosts as between the two portfolio hosts.

### D4. Let's Encrypt and App Links

The new Issuer registers a new ACME account and issues four new certificates; the old
Secrets stay on the old cluster until the velista release there is uninstalled. The Android
app verifies `https://velista.app/.well-known/assetlinks.json` against the live site, so
the file must be served from the new cluster before the DNS of `velista.app` moves.

## 2. The order

1. Provision the machine (`provision-host.sh`, `install.sh --ip`), one unit.
2. `provision-release.sh --unit velista --env production --from-file <the copied secrets>`.
3. Restore the four databases from the last backup (`restore-database.sh`), install
   `velista` from the current release tag, verify on the new address with a hosts file.
4. Point the velista GitHub environments at the new host. A redeploy proves the pipeline.
5. The window: stop the API on the old cluster, take a final dump, restore the delta, move
   the DNS records in the order of the constraints, watch the certificates issue.
6. Switch the portfolio's external route to the redirect (D2), remove the grant, drop the
   portfolio origin from `corsOrigins`.
7. Uninstall `velista` on the old cluster after a week, keep the backups.
