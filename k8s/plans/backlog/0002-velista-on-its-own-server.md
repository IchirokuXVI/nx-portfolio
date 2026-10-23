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
k3s cluster of its own, with the portfolio unit untouched on the old server, with no change
to a pipeline or an application, and with one template change at most (D2).

### Context

After `0014` to `0017`:

- The velista unit is release `velista` in namespace `luna-shopper` on the shared server,
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
of velista, `k8s/helm/portfolio/values.*.yaml` and one template of the library chart (the
external route becomes a redirect or an external backend, D2), `k8s/helm/velista/values.*.yaml`
(no ReferenceGrant), the new address in the `install.sh --ip` call of the new host, `.github/workflows/host-maintenance.yml` (a
job for the new host), `k8s/bootstrap/provision-release.sh` (`--from-file`).

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

### D1. The namespace stays `luna-shopper`

The unit keeps the namespace it got in `0016`, named after the databases it holds, so
nothing in `unit.env` changes. The `release-tasks` ConfigMap is copied with the data,
because an empty ledger would rerun every task whose window is still open, and `0015` D9
treats a present ledger as a release that already ran.

### D2. What `ichirokuxvi.com/velista` does afterwards

Two options, each a `redirect` or `externalBackend` field on an `externalRoutes` entry,
which is the one template change this plan needs in the library chart:

- **Redirect.** The external route becomes a `RequestRedirect` filter to
  `https://velista.app` with the path kept. The nginx `sub_filter` block of
  `apps/velista/src/nginx.conf` and the portfolio origin in `corsOrigins` are then dead and
  go. This is what `apps/velista/plans/0013` D5 planned and plan 0165 D1 postponed. Sessions
  are per origin already, so a user loses nothing but the address.
- **Proxy.** Envoy Gateway's `Backend` resource with an FQDN endpoint lets the route send
  `/velista` to `velista.app` over TLS. It needs the Backend API switched on in the Envoy
  Gateway install (`extensionApis.enableBackend`, an `install.sh` change). The address
  survives, at the cost of a second TLS hop and a backend that can be slow for reasons the
  portfolio cannot see.

The recommendation is the redirect.

### D3. Concurrency per host

The velista callers take the groups `staging-deploy-velista` and `production-release-velista`,
and `host-maintenance.yml` gains a `staging-velista` and a `production-velista` job that hold
them, with the soak between the two velista hosts as between the two portfolio hosts.

### D4. Let's Encrypt and App Links

HTTP-01 cannot issue on the new cluster before DNS points there, and each host would have
a TLS outage after its DNS move while the challenge runs. So step 2 copies the four `*-tls`
Secrets from the old cluster, as the cutover of `0016` D5 does for the portfolio: the new
Gateway serves valid certificates from the first request, and the new Issuer re-issues them
in the background once DNS has moved. The Android app verifies
`https://velista.app/.well-known/assetlinks.json` against the live site over valid TLS,
which the copied Secret provides on the day of the move.

## 2. The order

1. Provision the machine (`provision-host.sh`, `install.sh --ip`), one unit.
2. `provision-release.sh --unit velista --env production --from-file <the copied secrets>`,
   then copy the four `*-tls` Secrets and the `release-tasks` ConfigMap from the old
   cluster (D1, D4).
3. Install `velista` from the current release tag with `harvestEnabled` and
   `schedulerEnabled` off (a second scheduler would double what the chains see and write
   rows that the delta restore then overwrites), restore the four databases from the last
   backup with the procedure of `0005` and `0012` (`restore-database.sh` restores into a
   scratch database, and the rename step of `0012` follows), verify on the new address with
   a hosts file.
4. Point the velista GitHub environments at the new host. A redeploy proves the pipeline.
5. The window: stop the API on the old cluster, take a final dump, restore the delta, move
   the DNS records in the order of the constraints, turn the harvest switches back on,
   watch the certificates re-issue.
6. Switch the portfolio's external route to the redirect (D2), remove the grant, drop the
   portfolio origin from `corsOrigins`.
7. Uninstall `velista` on the old cluster after a week, keep the backups.
