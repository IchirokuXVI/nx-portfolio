# Serving production from the home machine

A bridge for the window between losing the VPS and netcup provisioning the
replacement. Everything here is meant to be deleted afterwards.

Read section 1 before doing anything else. It is a go or no go test, and if it
comes back no, the rest of this document does not apply and section 7 is where to
go instead.

## 1. First: can this machine be reached at all?

Three things have to be true, and only the first is under your control.

**a. The router forwards 80 and 443 to this machine.** DNS-01 certificates (see
below) remove the need for inbound port 80 *for the certificate challenge only*.
Visitors still arrive on 443, and the HTTP to HTTPS redirect still answers on 80.
Forward both.

**b. The ISP does not block them.** Inbound 80 and 443 are blocked on many Spanish
residential lines. Test from outside your own network, not from a browser on this
PC, which will short circuit through the router.

**c. You are not behind CGNAT.** This is the one that ends the plan. Compare the
WAN address your router reports against what `curl https://ifconfig.me` returns.
If they differ, the address on the router is private, you do not own the public
one, and no amount of port forwarding will help.

If (b) or (c) fails, stop and read section 7.

## 2. What you are actually deploying

The three `values.localhost*.yaml` files are **not** what you want. They serve
`localhost` or `*.localhost` with self signed certificates, and their `apps` lists
predate both velista and the Luna Shopper backend, so they cover the shell and
three remotes and nothing else. Deploying one would put up a site missing half of
production.

`k8s/helm/values.homelab.yaml` is the file for this. It is production's hostnames,
production's backend config, and production's five certificates, on locally built
images under their own tag.

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
   would hide your home address, which is genuinely attractive here, but the
   proxy terminates TLS itself and expects a reachable origin certificate, and
   `rt.ichirokuxvi.com` carries WebSocket traffic that wants the timeouts the
   chart sets on its own Gateway. Grey cloud now; revisit only if the address
   leaking bothers you more than the extra moving parts.

   The consequence is worth stating plainly: your home IP address becomes public
   information for as long as this runs.

The five records are the apex, `mfe`, `velista`, `api` and `rt`. Staging is
deliberately not in the list, and `staging.*` can be left pointing wherever it
points; nothing will answer.

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
more tightly than successful ones. If a certificate fails, read
`kubectl describe certificate <name>` and fix the cause before retrying.

## 5. Build and deploy

The backend Secrets come first, once. The script generates its own passwords and
JWT keypair, so this cluster's credentials are its own and share nothing with the
VPS that is gone:

```sh
./k8s/bootstrap/provision-release.sh --env production
```

Then build every image under the `homelab` tag. Note `--configuration=production`
and the explicit tag; both matter, and section 6 explains why:

```sh
DOCKER_IMAGE_TAG=homelab MFE_BASE_URL=https://mfe.ichirokuxvi.com \
  npx nx run shell:build:docker --configuration=production

for app in odontogram damoclesSword landingV2 velista; do
  DOCKER_IMAGE_TAG=homelab npx nx run $app:build:docker --configuration=production
done

for svc in gateway realtime auth core catalog; do
  DOCKER_IMAGE_TAG=homelab \
    npx nx run luna-shopper-backend-$svc:build:docker --configuration=production
done
```

The shell bakes `MFE_BASE_URL` in at build time, so it has to be the public
micro-frontend host and not a localhost variant, or the deployed shell will try
to load its remotes from your machine's loopback in the visitor's browser.

Deploy:

```sh
helm upgrade --install nx-portfolio k8s/helm --namespace nx-portfolio \
  --create-namespace \
  --values k8s/helm/values.yaml --values k8s/helm/values.homelab.yaml
```

## 6. Keeping development and production apart

This is the part that bites, because both live in one Docker daemon on one
machine. Three separations, and all three are already in place:

**Images are separated by tag.** Development builds produce `:dev`
(`--configuration=development`). The public deploy reads `:homelab` and nothing
else. Your ordinary `nx build`, `nx serve` and e2e work never touches `homelab`,
so no rebuild you do can change what the public site serves. The rule is simply:
never type `DOCKER_IMAGE_TAG=homelab` except when you actually intend to ship.

**Containers are separated by compose project.** `luna-shopper-backend` is slot 0,
your own development stack. `luna-slot<N>` are the parallel worktree stacks. The
DNS updater is `nx-portfolio-ddns`. The public deploy is not a compose project at
all: it is Kubernetes objects in the `nx-portfolio` namespace. A
`docker compose down` in any worktree cannot reach any of the others.

**Ports do not overlap.** The public deploy takes host 80 and 443 through the
Envoy LoadBalancer that Docker Desktop publishes. Slot 0 uses 3000 to 3003, 5432,
5433, 4222 and 1025/8025. `nx serve` uses 4200 and up. Nothing collides.

One real hazard remains, and nothing in the setup prevents it:

> **`docker system prune -a` will delete the `homelab` images and take the public
> site down** at the next pod restart, because `imagePullPolicy: IfNotPresent`
> has no registry to fall back on. The pods stay up on already running
> containers, so it looks fine until something restarts and then everything is
> ImagePullBackOff at once. Use `docker image prune` with a filter, or rebuild
> after pruning.

## 7. If the home line will not work, or you would rather not

Two alternatives, both better than fighting a residential connection.

**A cheap VPS for four days.** Providers with hourly billing (netcup's own G12
line, Scaleway, Vultr, DigitalOcean) will rent something adequate for roughly one
or two euros over a long weekend. It has a static address, open ports, and it is
the same shape as every deploy you have done before: point DNS at it, run
`install.sh --k3s`, `provision-release.sh`, `helm upgrade` with
`values.production.yaml`. No dynamic DNS, no port forwarding, no CGNAT question,
and your PC stays yours. This is the cheapest way out of the problem and it is
what to do if section 1 came back no.

**Cloudflare Tunnel.** `cloudflared` runs on this machine and dials out to
Cloudflare, so there is no inbound connection to block and CGNAT stops mattering.
It also removes the need for ddclient entirely, since the tunnel is addressed by
name rather than by IP. The cost is that TLS terminates at Cloudflare rather than
at your Gateway, which means the chart's own certificate and WebSocket timeout
handling stop being exercised, and it is a different shape from what netcup will
run. Worth it if section 1 fails and you would rather not rent a box.

## 8. Tearing this down

When netcup is ready:

1. Take a database dump first. `values.homelab.yaml` has backups off, so this
   window produced none.
   ```sh
   kubectl -n nx-portfolio exec luna-shopper-backend-core-db-0 -- \
     pg_dump -U luna_core luna_core > core.sql
   ```
   Repeat for `auth` and `catalog`, then restore with `k8s/helm/restore-database.sh`.
2. Stand up netcup with `install.sh --k3s`, `provision-release.sh --env production`
   and `values.production.yaml`, and set `ipAddress` in that file to the new
   address.
3. `docker compose -f docker/ddns/compose.yml down`, then set the five records to
   the netcup address by hand. Do this last: while ddclient runs it will happily
   put your home address back.
4. Delete `values.homelab.yaml`, `cluster-issuer-dns01.sh`, `docker/ddns/` and
   this file. They describe a situation that no longer exists, and a stale runbook
   for serving production from a laptop is worse than none.
