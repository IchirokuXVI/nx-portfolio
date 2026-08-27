# Serving production from the home machine

A bridge for the window between losing the VPS and netcup provisioning the
replacement. Everything here is meant to be deleted afterwards.

The images served are the **same published artefacts CI built, tested and pushed**
for a release. Nothing is built locally for this deploy, which is what keeps the
window from becoming an untested build of anything, and makes the move to netcup
a change of address rather than a change of software.

Read section 1 before doing anything else. It is a go or no go test, and if it
comes back no, section 8 is where to go instead.

## 1. First: can this machine be reached at all?

Three things have to be true, and only the first is under your control.

**a. The router forwards 80 and 443 to this machine.** DNS-01 certificates
(section 4) remove the need for inbound port 80 *for the certificate challenge
only*. Visitors still arrive on 443, and the HTTP to HTTPS redirect answers on 80.
Forward both.

**b. The ISP does not block them.** Inbound 80 and 443 are blocked on many Spanish
residential lines. Test from outside your own network, not from a browser on this
PC, which short circuits through the router.

**c. You are not behind CGNAT.** This is the one that ends the plan. Compare the
WAN address your router reports against `curl https://ifconfig.me`. If they
differ, the address on the router is private, you do not own the public one, and
no amount of port forwarding will help.

If (b) or (c) fails, stop and read section 8.

## 2. What you are actually deploying

The three `values.localhost*.yaml` files are **not** what you want. They serve
`localhost` or `*.localhost` with self signed certificates, and their `apps` lists
predate both velista and the Luna Shopper backend, so they cover the shell and
three remotes and nothing else. Deploying one would put up a site missing half of
production.

`k8s/helm/values.homelab.yaml` is the file for this. It is production's hostnames,
production's backend config and production's five certificates, running the
published `ghcr.io` images at a pinned release version. It sets no `apps` list and
no `services` list of its own: both are inherited from `values.yaml`, so the image
paths are literally production's.

## 3. Point the domain here

The public address of a domestic line changes without notice, so the records
cannot be set once by hand.

1. Create a Cloudflare API token: My Profile, API Tokens, Create Token, "Edit zone
   DNS", scoped to `ichirokuxvi.com`. It needs **Zone:DNS:Edit and
   Zone:Zone:Read**. The second is easy to skip, because ddclient works without it
   and cert-manager does not.

2. Set up the updater. One token serves both it and cert-manager.

   ```sh
   mkdir -p docker/ddns/config
   cp docker/ddns/ddclient.conf.example docker/ddns/config/ddclient.conf
   # put the token in the password= line
   chmod 600 docker/ddns/config/ddclient.conf
   docker compose -f docker/ddns/compose.yml up -d
   ```

3. Confirm it did something, rather than assuming:

   ```sh
   docker compose -f docker/ddns/compose.yml logs -f
   docker exec nx-portfolio-ddns ddclient -verbose -force -noquiet
   ```

   The forced run reports, per record, whether it updated or found the address
   already current. Then check the Cloudflare dashboard shows your address on all
   five names.

4. **Set all five records to DNS only (grey cloud), not proxied.** Proxied records
   would hide your home address, which is genuinely attractive here, but the proxy
   terminates TLS itself and expects a reachable origin certificate, and
   `rt.ichirokuxvi.com` carries WebSocket traffic that wants the timeouts the chart
   sets on its own Gateway. Grey cloud now; revisit only if the address leaking
   bothers you more than the extra moving parts.

   The consequence, plainly: your home IP address is public information for as
   long as this runs.

The five records are the apex, `mfe`, `velista`, `api` and `rt`. Staging is
deliberately not among them.

## 4. Certificates

```sh
CLOUDFLARE_API_TOKEN=... ./k8s/bootstrap/cluster-issuer-dns01.sh
```

This creates `letsencrypt-dns01` beside whatever `install.sh` created. It proves
domain control by writing a TXT record through the Cloudflare API, so Let's
Encrypt never connects to this machine and a blocked inbound port 80 stops
mattering for issuance.

Expect a couple of minutes per name while TXT records propagate. Five names are
issued. Watch with `kubectl -n nx-portfolio get certificate -w`.

**Do not iterate blindly here.** Let's Encrypt rate limits failed validations far
more tightly than successful ones. If one fails, read
`kubectl describe certificate <name>` and fix the cause before retrying.

## 5. First deploy

**Registry credentials.** The VPS authenticated to ghcr.io at the node level. This
machine has no such credential, and if the packages are private every pod fails as
`ImagePullBackOff` carrying an authentication error that names no fix. Create the
Secret once, with a GitHub personal access token carrying only `read:packages`:

```sh
kubectl create namespace nx-portfolio
kubectl -n nx-portfolio create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=IchirokuXVI \
  --docker-password=<token with read:packages>
```

Harmless if the packages are public: Kubernetes simply will not need it.

**Backend Secrets.** Once. The script generates its own passwords and JWT keypair,
so this cluster's credentials are its own and share nothing with the VPS that is
gone:

```sh
./k8s/bootstrap/provision-release.sh --env production
```

**Deploy a release.** Nothing is built; the images come from the registry:

```sh
./k8s/helm/deploy-homelab.sh 0.1.1
```

## 6. Switching versions

This is the whole point of pinning to immutable release tags. Rolling forward and
rolling back are the same command with a different argument:

```sh
./k8s/helm/deploy-homelab.sh --current   # what is being served, per workload
./k8s/helm/deploy-homelab.sh --list      # versions actually published
./k8s/helm/deploy-homelab.sh 0.1.0       # roll back
./k8s/helm/deploy-homelab.sh 0.1.1       # roll forward again
```

`--current` reads the live Deployment rather than the Helm release, because those
two can disagree: a failed upgrade leaves the release recording a version no pod
ever ran. `--list` asks the registry rather than listing git tags, because a
rollback is only possible to a version whose images still exist.

> **Rolling the application back does not roll the database back.** Migrations are
> expand and contract, which is exactly what makes going backwards safe: the older
> code meets a newer but backward compatible schema and keeps working. What it
> does not do is undo anything. There is no down migration, and 0.1.0's
> `migrate.js` will not remove what 0.1.1's added. If a release did something
> destructive to data, restore from a dump instead (`k8s/helm/restore-database.sh`).

**Where new versions come from.** Publishing a GitHub Release still builds, tests
and pushes every image exactly as before. Only the SSH deploy is skipped while no
`SSH_DEPLOY_HOST` secret exists, and the run says so in a notice and in the job
summary rather than failing. So the flow is: publish the release, wait for the
workflow, then `deploy-homelab.sh <version>` here. Staging behaves the same way
against `SSH_DEPLOY_HOST_STAGING`.

## 7. Keeping development and production apart

The requirement is that the two stacks never share infrastructure or read each
other's values. They already do not, and it is worth knowing exactly why rather
than trusting it.

| | Development | Production (here) |
| --- | --- | --- |
| Runtime | Docker Compose | Docker Desktop Kubernetes |
| Project / namespace | `luna-shopper-backend` (slot 0) | namespace `nx-portfolio` |
| Postgres, NATS, Redis | containers publishing host ports | StatefulSets on **ClusterIP, no host ports** |
| Storage | compose named volumes | Kubernetes PVCs (local-path) |
| Config source | `.env` files generated by `luna-slot` | ConfigMap + six Secrets |
| Images | built locally, `:dev` | pulled from ghcr.io, `:<version>` |
| Host ports | 5432/5433/5434, 4222, 6379, 1025, 8025, 9090, 3010, 16686 | **80 and 443 only**, via Envoy |

The infrastructure is therefore already duplicated: two Postgres sets, two NATS,
two Redis, none of them shared. Production's databases publish no host port at
all, so nothing on this machine can reach them by accident, and the services find
each other by in-cluster DNS (`luna-shopper-backend-auth-db`) which resolves
nowhere else. A dev service pointed at `localhost:5432` cannot reach production's
Postgres even deliberately.

**If you want dev off the default ports as well**, the slot mechanism already does
it, no new machinery:

```powershell
./k8s/e2e/luna-shopper-backend/luna-slot.ps1 -Slot 1
```

That moves every dev port by +100 (Postgres 5532/5533/5534, NATS 4322, Redis 6479,
services 3100 to 3104), renames the compose project to `luna-slot1`, and rewrites
the `.env` files to match. Production is untouched because it never used those
ports.

One real hazard remains, and nothing in the setup prevents it:

> **`docker system prune -a` deletes the pulled release images** and the site goes
> down at the next pod restart, because `imagePullPolicy: IfNotPresent` will not
> re-fetch them on its own. Running pods survive, so it looks fine until something
> restarts and then everything is `ImagePullBackOff` at once. Recover by
> re-running `deploy-homelab.sh <version>`, which re-pulls.

## 8. If the home line will not work, or you would rather not

Two alternatives, both better than fighting a residential connection.

**A cheap VPS for four days.** Providers with hourly billing (netcup's own G12
line, Scaleway, Vultr, DigitalOcean) will rent something adequate for roughly one
or two euros over a long weekend. Static address, open ports, and the same shape
as every deploy you have done: point DNS at it, `install.sh --k3s`,
`provision-release.sh`, `deploy-release.sh <version>`. No dynamic DNS, no port
forwarding, no CGNAT question, and your PC stays yours. This is the cheapest way
out and it is what to do if section 1 came back no.

**Cloudflare Tunnel.** `cloudflared` dials out from this machine, so there is no
inbound connection to block and CGNAT stops mattering. It also removes ddclient
entirely, since the tunnel is addressed by name rather than by IP. The cost is
that TLS terminates at Cloudflare rather than at your Gateway, so the chart's own
certificate and WebSocket timeout handling stop being exercised, and it is a
different shape from what netcup will run.

## 9. Tearing this down

When netcup is ready:

1. Take a database dump first. `values.homelab.yaml` has backups off, so this
   window produced none.
   ```sh
   kubectl -n nx-portfolio exec luna-shopper-backend-core-db-0 -- \
     pg_dump -U luna_core luna_core > core.sql
   ```
   Repeat for `auth` and `catalog`, then restore with `k8s/helm/restore-database.sh`.
2. Set `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER` and `SSH_DEPLOY_KEY` in the repository
   secrets. The release workflow starts deploying again on its own; nothing in it
   needs editing back.
3. Stand up netcup with `install.sh --k3s`, `provision-release.sh --env production`
   and `values.production.yaml`, setting `ipAddress` to the new address.
4. `docker compose -f docker/ddns/compose.yml down`, then point the five records at
   the netcup address by hand. Do this last: while ddclient runs it will happily
   put your home address back.
5. Delete `values.homelab.yaml`, `deploy-homelab.sh`, `cluster-issuer-dns01.sh`,
   `docker/ddns/` and this file. They describe a situation that no longer exists,
   and a stale runbook for serving production from a desktop is worse than none.

The `imagePullSecrets` support added to the chart can stay: it renders nothing
when the list is empty, which is what both cluster values files leave it as.
