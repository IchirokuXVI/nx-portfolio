# Bringing up a new cluster

Everything that has to happen between "the provider emailed me a root password"
and "the site is being deployed to by CI". It is written to be followed twice,
because staging and production are the same machine setup with different
arguments, and it assumes nothing is installed on the box.

Three scripts do the work, and each one starts where the last one stopped:

| Script                               | Takes it from   | To                                                   |
| ------------------------------------ | --------------- | ---------------------------------------------------- |
| `k8s/bootstrap/provision-host.sh`    | a root only VPS | accounts, keys, a hardened sshd                      |
| `k8s/bootstrap/install.sh`           | a machine       | a cluster: k3s, MetalLB, Envoy Gateway, cert-manager |
| `k8s/bootstrap/provision-release.sh` | a cluster       | one a unit can deploy to: its namespace and Secrets  |

`provision-host.sh --k3s` runs the second for you, and section 4 runs it again
with the machine's address for the MetalLB pool. The third runs one time per
deploy unit (k8s plan 0014): `portfolio` and `velista`, each into its own
namespace.

Two things in here are ordering constraints rather than preferences, and both
have a section explaining why: **DNS moves before the first deploy** (section 4)
and **root stays reachable until the replacement accounts are proven** (section
3).

## 0. What you need before you start

- The VPS address and its root password or key.
- Control of the domain's DNS records.
- Admin on the GitHub repository and `gh auth login`, to create its environments (section 7).
- Optionally, a Google OAuth client secret, an SMTP password and a Gemini API
  key. All three are supported as blank: the Google routes and registration
  answer 501, and so does `/v1/assistant`, rather than a service failing to
  start. A cluster with none of them is a working cluster with three features off.
- Production only: an S3 compatible bucket and a key for backups.

Decide which environment this machine is before you begin. It selects the values
file, the `--env` flag and the six DNS names, and nothing else differs.

## 1. The two keypairs

Generate two, not one. The CI key cannot have a passphrase, because no one is at
the keyboard when GitHub Actions uses it, and an unencrypted key is exactly why
it should belong to an account that owns nothing. Keeping them separate means
revoking CI's access never touches your own.

On your workstation, in PowerShell:

```powershell
New-Item -ItemType Directory -Force $env:USERPROFILE\.ssh | Out-Null

# Your admin key. Give this one a passphrase.
ssh-keygen -t ed25519 -C "ichiroku@laptop" -f $env:USERPROFILE\.ssh\nx_<env>_admin

# The CI key. Press Enter twice: no passphrase.
ssh-keygen -t ed25519 -C "github-actions-nx-portfolio" -f $env:USERPROFILE\.ssh\nx_<env>_deploy
```

Store both private keys in your password manager. GitHub cannot show a secret
back to you once saved, so the copy you paste in section 7 is the only one you
will ever see.

## 2. Accounts, keys and the cluster

Copy the script up and run it as root. It creates the accounts, installs the
keys, then hands off to `install.sh` for the cluster. `host-patch.sh` goes up
beside it: provision-host.sh installs it as `nx-host-patch`, the one program the
weekly maintenance workflow may run as root (section 10b).

```powershell
scp k8s/bootstrap/provision-host.sh k8s/bootstrap/host-patch.sh root@<IP>:/tmp/

$admin  = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_admin.pub  -Raw).Trim()
$deploy = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_deploy.pub -Raw).Trim()

ssh root@<IP> "bash /tmp/provision-host.sh --admin-key '$admin' --deploy-key '$deploy' --k3s"
```

Pass the keys as quoted arguments rather than piping the `.pub` files. A file
piped from PowerShell arrives with CRLF line endings, and sshd rejects the
resulting `authorized_keys` without explaining why.

What it creates, and what it deliberately does not:

- **`ichiroku`**, in the `sudo` group, for humans. Override with `--admin-user`.
- **`deploy`**, unprivileged, for CI. It needs no sudo to deploy, because k3s
  writes its kubeconfig world readable and helm and kubectl are the whole
  deploy. Its one sudo rule names `/usr/local/sbin/nx-host-patch` and nothing
  else, for the weekly OS and k3s patching (section 10b).
- **No per app accounts.** Every app runs in a container inside k3s, so the host
  needs no service users of its own.

Since `adduser --disabled-password` leaves an account that cannot answer a sudo
prompt, the admin account gets passwordless sudo. Pass `ADMIN_PASSWORD` in the
environment instead if you would rather sudo asked for something.

Useful flags: `--firewall` configures ufw for 22, 80, 443 **and the k3s pod and
service CIDRs**, which are not optional (without them ufw drops traffic between
pods and the failures look like application bugs). `--ref <branch>` clones
something other than `main`.

The script is idempotent. Re-running it keeps existing accounts and does not add
a key twice, so it is also the way to reconcile a host someone set up by hand.
The keys are only required by an account that has none yet, so a later run that
just wants `--firewall`, a missing package or a fresh `--k3s` needs neither
`--admin-key` nor `--deploy-key`. That matters because the run people skip is
the one whose arguments they cannot produce from memory.

At the end it prints the account summary, the node, and specifically whether the
`deploy` user can reach the cluster, which is the thing that decides whether CI
will work.

## 3. Verify, then lock root

**From a second terminal, with your current root session still open.** Locking
root out of a machine whose replacement accounts cannot log in is the one
mistake here that needs the provider's rescue console to undo.

```powershell
ssh -i $env:USERPROFILE\.ssh\nx_<env>_admin  ichiroku@<IP> id
ssh -i $env:USERPROFILE\.ssh\nx_<env>_deploy deploy@<IP> id
```

Both must print a user id. Then:

```powershell
ssh -t root@<IP> "bash /tmp/provision-host.sh --lock-root"
```

No keys this time: both accounts already have one, which is the condition the
script checks anyway. `-t` gives the remote script a terminal to ask its
question on, because it asks one **every time** and there is no flag to skip it.
Type `lock root` at the prompt to go ahead; anything else, or no terminal at
all, leaves sshd untouched. An unattended `--lock-root` left over from a copied
command line is the way this step goes wrong, so it cannot run unattended.

Beyond the prompt it sets `PermitRootLogin no` and `PasswordAuthentication no`,
validates the result with `sshd -t` before reloading anything, and refuses
outright if either account is missing a usable key. A placeholder line does not
count as one.

## 4. The address and the DNS records

Give the machine's address to MetalLB. On the box, as the admin user:

```sh
bash ~/nx-portfolio/k8s/bootstrap/install.sh --ip <IP>
```

It applies `IPAddressPool main-pool` with that one address and
`L2Advertisement main-advertisement`, and lets only `envoy-gateway-system` take
the address (k8s plan 0015 D5). The pool belongs to the machine, not to a unit:
every unit's Gateway is served by the one merged Envoy Service, which is the only
LoadBalancer here. Without the pool that Service stays `<pending>` forever while
everything else looks healthy, and `install.sh` warns when it finds no pool. The
rest of the run reapplies what section 2 installed and changes nothing.

Then point the six records at it. `mfe` carries three remotes, velista has its
own origin because it is installable there as a PWA, and `admin` serves the
`luna-shopper-admin` back office.

**The six live in two zones.** The portfolio is on `ichirokuxvi.com`. velista is
a product with a domain of its own, and its back office (`admin.`) and its backend
(`api.`, `rt.`) exist only to serve it, so all four sit under `velista.app`. Both
zones point at the same cluster address, so this is a naming split rather than a
second deploy.

| Production            | Staging                       |
| --------------------- | ----------------------------- |
| `ichirokuxvi.com`     | `staging.ichirokuxvi.com`     |
| `mfe.ichirokuxvi.com` | `mfe.staging.ichirokuxvi.com` |
| `velista.app`         | `staging.velista.app`         |
| `admin.velista.app`   | `admin.staging.velista.app`   |
| `api.velista.app`     | `api.staging.velista.app`     |
| `rt.velista.app`      | `rt.staging.velista.app`      |

Each row is its own A record. On the staging side in particular, a record on
`staging.velista.app` does **not** cover `api.staging.velista.app`, and a wildcard
`*.velista.app` matches one label, so it does not either.

**Move them before the first deploy, and confirm with `dig` rather than a
browser.** cert-manager requests a certificate per Gateway listener the moment
the chart applies, and Let's Encrypt rate limits failed validations far more
tightly than successful ones. Six listeners retrying against records that still
point somewhere else is how you lose the rest of the day. If you are cutting over
live records, lower their TTL a day ahead.

Two things `.app` adds that `ichirokuxvi.com` did not:

- It is on the **HSTS preload list**, so a browser upgrades every request to
  https on its own and offers no way past a certificate warning. There is no
  plain HTTP window while a certificate is pending: the name is simply
  unreachable until it issues. This does not affect the ACME HTTP-01 challenge
  itself, which Let's Encrypt fetches with a client that is not a browser.
- If the zone carries a **CAA** record it has to permit Let's Encrypt
  (`0 issue "letsencrypt.org"`), or every issuance fails with an unhelpful
  message. No CAA record at all is also fine.

## 5. Secrets

**In an interactive shell on the box, as the admin user.** The script prompts for
the Google client secret, the SMTP password and the Gemini API key (each only when
the Secret holds no value for it yet). A piped or `ssh host "..."` invocation
takes its "not a terminal" branch and leaves all three as they are, which on a new
cluster means unset.

One run per deploy unit:

```sh
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --unit portfolio --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --unit velista --env <env>
```

Each run reads `k8s/units/<unit>/unit.env` and creates the unit's namespace
(`portfolio`, `luna-shopper`). The portfolio lists no Secret, so its run stops
there. The velista run creates the Secrets its chart reads through
`secretKeyRef`: four database passwords (auth, core, catalog and harvester), two
JWT keypairs (one for user tokens, one for admin tokens), the
`HARVESTER_ACTOR_ID` uuid, the three optional values above, and the connection
strings, which are derived from the same shell variables as the passwords so the
two cannot disagree. It writes your plaintext copy to
`~/velista-<env>-secrets.txt`.

Move that file into your password manager and delete it. It holds the JWT
keypairs, and losing the user keypair invalidates every issued token at once,
logging out every user simultaneously.

Re-running is safe: existing values are kept, because Postgres reads
`POSTGRES_PASSWORD` only when it initialises an empty data directory, so a
regenerated password on an existing volume would leave the Secret and the
database disagreeing and every service unable to connect. `--rotate` is the
explicit opt in, and it tells you what else has to happen.

The script refuses to write secrets inside the repository it lives in. With the
clone at `~/nx-portfolio` the default path is your home directory, which is
outside it, so the default is fine. Pass `--out` if you are running from a copy
that sits directly in `$HOME`.

Then verify what the chart will actually ask for:

```sh
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --unit portfolio --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --unit velista --env <env>
```

`--check` renders the unit's chart and asserts that its Gateway hostnames equal
the `HOSTS_<ENV>` of `unit.env`, that a namespace it names for the other unit is
that unit's, and that every `secretKeyRef` and `configMapKeyRef` it references can
be satisfied. What this script provisions has
to exist in the cluster. What the chart creates itself, today only
`luna-shopper-backend-config`, is checked against the render instead and marked
`(chart)`, because helm creates it during the very deploy this check gates. This
is the same command CI runs before each deploy, so a pass here means the
preflight will pass there.

## 6. Backups, production only

Production renders the backup CronJobs, and they need credentials the script
cannot generate. It prints the exact command; the shape is:

```sh
kubectl -n luna-shopper create secret generic luna-shopper-backend-backup-secret \
  --from-literal=S3_ENDPOINT=... --from-literal=S3_BUCKET=... \
  --from-literal=AWS_ACCESS_KEY_ID=... --from-literal=AWS_SECRET_ACCESS_KEY=...
```

Use a bucket scoped, ideally write only key. A backup credential that can delete
its own bucket turns a compromised cluster into a compromised backup.

Staging gets no such Secret on purpose. An empty placeholder would make `--check`
pass against credentials that cannot write anywhere.

## 7. Point CI at the machine

Each deploy unit deploys with the values of a GitHub **environment** of its own
(k8s plan 0016 D2): `portfolio-staging`, `velista-staging`,
`portfolio-production` and `velista-production`. A rollback from `redeploy.yml`
uses `portfolio-production-redeploy` and `velista-production-redeploy` (k8s plan
0017 D7). Host maintenance uses `host-staging` and `host-production`. Every one
of them holds the same four names:

| Name              | Kind     | Value                                          |
| ----------------- | -------- | ---------------------------------------------- |
| `SSH_DEPLOY_HOST` | secret   | the machine's address                          |
| `SSH_DEPLOY_USER` | secret   | `deploy`                                       |
| `SSH_DEPLOY_KEY`  | secret   | the **private** key from section 1, whole file |
| `SSH_KNOWN_HOSTS` | variable | `ssh-keyscan -t ed25519 <the machine>`         |

`host-production` also holds `SSH_SOAK_CHECK_HOST`, the staging address, because
it checks staging before it patches production, and a wait timer of 2880
minutes.

The production environments also carry rules (k8s plan 0017). `<unit>-production`
runs on the unit's release tags only (`portfolio-v*`, `velista-v*`) and on no
branch. `<unit>-production-redeploy` runs on the branch `main` only, and waits
for the reviewer that `--reviewer` names.

One command per environment writes all of them, from your workstation with
`gh auth login` as a repository admin. It creates an environment that does not
exist and keeps the rules of one that does:

```sh
bash k8s/bootstrap/github-environments.sh --env staging \
  --host staging.ichirokuxvi.com --key-file ~/.ssh/nx_staging_deploy
bash k8s/bootstrap/github-environments.sh --env production \
  --host ichirokuxvi.com --key-file ~/.ssh/nx_production_deploy \
  --soak-host staging.ichirokuxvi.com --reviewer <your GitHub login>
```

A pipeline whose environment lacks one of the four stops before any SSH and
names the missing value in its summary. A new machine has a new host key, so a
rebuilt host needs `SSH_KNOWN_HOSTS` refreshed, which is the same command again.
Until it is, every deploy and host patch refuses to connect, which is the point
of pinning the key.

The pipelines read nothing from repository secrets. The old repository secrets
`SSH_DEPLOY_HOST`, `SSH_DEPLOY_HOST_STAGING`, `SSH_DEPLOY_USER` and
`SSH_DEPLOY_KEY` stay only until host maintenance reads the `host-*`
environments, and are then deleted (section "Existing clusters: the cutover").
A new repository never needs them.

Optionally give the two `<unit>-production` environments a required reviewer
too. The script leaves a reviewer that is already there in place.

## 8. Deploy

**Staging** deploys each unit on every push to `main` (`staging-<unit>.yml`):
the unit's affected images, tagged `staging`, its gates, then an upgrade and a
rollout that is waited on rather than assumed. A first run of a pipeline has no
earlier green run to compare with, so it builds and deploys every image of its
unit. To deploy everything by hand from GitHub, dispatch `staging-portfolio.yml`
and `staging-velista.yml` with `build_all`.

**Production** deploys one unit when a GitHub Release with that unit's prefix is
published (`release-<unit>.yml`, k8s plan 0017): `portfolio-vX.Y.Z` or
`velista-vX.Y.Z`, at that commit, pinned to the version. A bare `vX.Y.Z` deploys
nothing. `CONTRIBUTING.md` ("Release notes") has the commands. A new machine
changes nothing about the tags: the next release of each unit is the next
number above its newest tag. By hand, on the box:

```sh
bash ~/nx-portfolio/k8s/helm/deploy-release.sh portfolio <version>
bash ~/nx-portfolio/k8s/helm/deploy-release.sh velista <version>
```

Rollback is `redeploy.yml`, dispatched on `main`, which waits for the reviewer
of `<unit>-production-redeploy`:

```sh
gh workflow run redeploy.yml --ref main -f unit=velista -f environment=production -f version=<older version>
```

It deploys that version's images with the chart of the unit's newest release.
It refuses a version from before the unit's first release under k8s plan 0016.
Below that line, `helm rollback <unit> 1 -n <namespace>` restores the cutover
install. On the box, `deploy-release.sh <unit> <older version>` from the current
checkout does the same as the workflow.

A deploy and the weekly host patch never overlap: both hold
`/run/lock/nx-deploy.lock`, which section 2 created and which the host writes
again at every boot.

## 9. Verify

```sh
kubectl get pods -n portfolio
kubectl get pods -n luna-shopper
kubectl get certificate -A                      # six, all READY=True
kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gatewayclass=eg
```

That last one is the piece people hunt for. Envoy Gateway serves the Gateways of
both units from one merged data plane, and its Service is **not** declared by any
chart, so it lives in `envoy-gateway-system` rather than a unit's namespace. Its
`EXTERNAL-IP` is your address. Stuck at `<pending>` means MetalLB has no address
to hand out, which means `install.sh --ip` in section 4.

When something is wrong, events are the part that matters and the part people
forget. `ImagePullBackOff`, a PVC that cannot bind, and a failing readiness probe
all announce themselves there and nowhere else:

```sh
kubectl -n luna-shopper get events --sort-by=.lastTimestamp | tail -40
```

## 10. Production only: the data

A new cluster is an empty database. The four Postgres instances start with
nothing in them, so rebuilding production on a new machine means taking a dump
from the old one and restoring it with `k8s/helm/restore-database.sh` **before**
DNS points at the new box. Staging holds nothing worth keeping and is disposable
by design, which is also where a restore is rehearsed.

## 10b. Keeping it patched (k8s plan 0013)

Nobody logs in to update a host. `.github/workflows/host-maintenance.yml` runs
every Monday at 03:30 UTC:

1. Staging: a health check, then `nx-host-patch apply <snapshot>` (every Debian
   package to one dated state of snapshot.debian.org), k3s and the cluster
   add-ons to the versions pinned in `install.sh`, a reboot when a new kernel
   or an old library needs one, and the health check again from the inside and
   the outside.
2. The `host-production` environment waits two days.
3. Staging must still be healthy. Then production gets the same snapshot and
   the same steps.

A failure stops the run, so production is never patched after a staging that
broke, and GitHub mails the failure. Versions move only through git: Renovate
proposes a new k3s or cert-manager, and the next Monday carries the merged
version to staging and then to production.

A patch never overlaps a deploy: `nx-host-patch` holds the deploy lock
`/run/lock/nx-deploy.lock` from its first package operation until the reboot,
and the add-on upgrade holds it too (k8s plan 0016 D2).

What this needs, once per repository: the environments `host-staging` and
`host-production` with their values (section 7), and the Renovate app. Once per
host, which a new host gets from section 2 already: `nx-host-patch` and its
sudo rule, `/etc/rancher/k3s/config.yaml`, and the tmpfiles rule that creates
the deploy lock at every boot. A host provisioned before plan 0016 gets all of
them from one run, as the admin account (the workflow refuses an
`nx-host-patch` older than the repository's until then):

```sh
git -C ~/nx-portfolio pull
sudo bash ~/nx-portfolio/k8s/bootstrap/provision-host.sh --k3s
```

To see what a host has, as the deploy account: `sudo nx-host-patch status`.

## 11. When it goes wrong

Every entry here is something that actually happened on a real bring up.

**`error: no matching resources found` at "waiting for the node to become
Ready".** `kubectl wait --all` does not wait when zero objects match; it returns
immediately and non-zero. The k3s API server answers a few seconds before the
kubelet registers its Node, and the wait landed in that gap. `install.sh` now
polls for the Node to appear first. Re-running it is safe.

**`fatal: detected dubious ownership in repository`.** git refuses to operate on
a repository owned by another user, and the script runs as root while the clone
belongs to the admin account. The git work now runs as the owner. If you meet
this on an older copy, re-copy the script rather than adding a `safe.directory`
exception, which only moves root owned objects into a user's tree.

**`helm: command not found`.** helm is not in Debian's repositories, so
`apt-get install helm` will never find it. `install.sh` installs it from
upstream, inside the `--k3s` branch, after the node wait. If an earlier step
failed, helm was never installed and neither was anything after it: MetalLB, the
Gateway CRDs, Envoy Gateway and cert-manager are all missing too. `kubectl get
pods -A` showing only `kube-system` confirms it. Re-run `install.sh --k3s`.

**`provision-release.sh` prints "Resolving credentials..." and exits with no
message.** Fixed, but worth recognising: a `kubectl get` for a Secret that does
not exist exits non-zero, `pipefail` carried it, and `set -e` ended the script
where the error text was already going to `/dev/null`. If you see a script here
stop silently, suspect a suppressed non-zero status in an assignment before
suspecting the cluster.

**One service in three crashloops, and its migration Job exits with
`TypeError: Invalid URL` / `ERR_INVALID_URL` from inside `pg`.** Fixed. The
database passwords were generated with `openssl rand -base64`, whose alphabet
includes `/`, and they are interpolated into
`postgres://user:PASSWORD@host:5432/db`. A `/` in the password ends the authority
early, so the parser reads the port as everything up to that slash and rejects it
as non numeric. Whether a 32 character base64 string contains a `/` is roughly a
coin flip, which is why it hit one database and not the other two, and why the
failure read as a bug in that one service's migration. Generation now uses
base64url, and `--check` asserts each `*_DB_URL` actually parses, since a cluster
provisioned before the fix still holds the bad string. To repair an existing one,
rotate that database's password rather than editing the URL: `ALTER ROLE` inside
the instance, write the new value to its `*-db-secret`, then re-run
`provision-release.sh --unit velista --env <env>`, which rebuilds the URL from it.

**`--check` reports every `configmap/luna-shopper-backend-config` key missing on
a cluster nothing has been deployed to yet.** Fixed. That ConfigMap belongs to
the chart rather than to provisioning, so it could not exist before the first
`helm upgrade`, and the check was gating the deploy that would have created it.
CI deadlocked the same way, since both workflows run `--check` before their
deploy step. Chart owned objects are now checked against the render, so the
preflight passes on a freshly provisioned cluster and the first deploy creates
the ConfigMap. Fixed in the same change: `GOOGLE_CLIENT_SECRET` and `SMTP_PASS`
left blank at the prompts were counted as failures, though plan 0026 makes both
a supported configuration. `GEMINI_API_KEY` later joined them under the same rule
(plan 0039). Only those three may be empty. Every other key must still carry a
value, and one that does not now reads `EMPTY` rather than `MISSING`.

**A step works by hand and fails from CI.** CI arrives through
`ssh host "bash ..."`, which is non interactive and reads no shell profile, so
nothing exports `KUBECONFIG` for it. Both scripts default it themselves now. Any
new script in this directory needs the same, or it will have exactly this shape
of bug.

## 12. The whole thing, in order

```powershell
# 1. keys
ssh-keygen -t ed25519 -C "ichiroku@laptop" -f $env:USERPROFILE\.ssh\nx_<env>_admin
ssh-keygen -t ed25519 -C "github-actions-nx-portfolio" -f $env:USERPROFILE\.ssh\nx_<env>_deploy
$admin  = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_admin.pub  -Raw).Trim()
$deploy = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_deploy.pub -Raw).Trim()

# 2. accounts, keys, cluster, and nx-host-patch for the weekly maintenance
scp k8s/bootstrap/provision-host.sh k8s/bootstrap/host-patch.sh root@<IP>:/tmp/
ssh root@<IP> "bash /tmp/provision-host.sh --admin-key '$admin' --deploy-key '$deploy' --k3s"

# 3. prove both logins, THEN close the door (it asks you to type 'lock root')
ssh -i $env:USERPROFILE\.ssh\nx_<env>_admin ichiroku@<IP> id
ssh -i $env:USERPROFILE\.ssh\nx_<env>_deploy deploy@<IP> id
ssh -t root@<IP> "bash /tmp/provision-host.sh --lock-root"
```

```sh
# 4. on the box, as the admin user: the MetalLB pool. Then move the six DNS
#    records and dig to confirm
bash ~/nx-portfolio/k8s/bootstrap/install.sh --ip <IP>

# 5. on the box, as the admin user, interactively, one time per unit
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --unit portfolio --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --unit velista --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --unit portfolio --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --unit velista --env <env>

# 6. production only: the backup Secret, in the namespace luna-shopper
```

```sh
# 7. on your workstation: the GitHub environments of this machine, for both
#    units and host maintenance (add --soak-host <staging> --reviewer <login>
#    for production)
bash k8s/bootstrap/github-environments.sh --env <env> --host <IP or name> \
  --key-file ~/.ssh/nx_<env>_deploy

# 8. one release per unit: dispatch staging-portfolio.yml and staging-velista.yml
#    (staging), or publish a Release portfolio-vX.Y.Z and velista-vX.Y.Z (production)
```

## Existing clusters: the cutover

A cluster built before k8s plan 0016 runs one release, `nx-portfolio`, in the
namespace `nx-portfolio`. `k8s/bootstrap/split-release.sh` turns it into the
releases `portfolio` (namespace `portfolio`) and `velista` (namespace
`luna-shopper`), at the image tags that run now, and moves nothing else.

**Who runs it.** The preflight of every deploy runs `split-release.sh --status`.
`none` (no namespace `nx-portfolio`) is the normal answer and the deploy goes on.

- **Staging**: the first `staging-*` run after the merge runs the cutover by
  itself. The other unit's pipeline waits on the host lock and then finds it
  done.
- **Production**: a deploy runs it only when the variable `ALLOW_CUTOVER` of
  `<unit>-production` is `true`. Otherwise it stops before any change, with one
  line that says the cluster is not cut over. Choose a quiet hour, then either
  `gh variable set ALLOW_CUTOVER --env velista-production --body true` and re-run
  the deploy job, or on the box as the deploy account:

  ```sh
  bash ~/deploy/velista/k8s/bootstrap/split-release.sh --env production --plan   # read first
  bash ~/deploy/velista/k8s/bootstrap/host-lock.sh \
    bash ~/deploy/velista/k8s/bootstrap/split-release.sh --env production
  ```

  Delete the variable afterwards: `gh variable delete ALLOW_CUTOVER --env velista-production`.

**What it does**, each step safe to run again, the step reached recorded in
ConfigMap `deploy-cutover`:

1. `install.sh --merge-only`: EnvoyProxy `merged` and the GatewayClass
   `parametersRef`. Envoy Gateway replaces the Gateway's data plane with the
   merged one. The edge is down until the merged Service holds the address: 12
   seconds in the rehearsal.
2. Deletes the Helm storage Secrets of `nx-portfolio`. Every object stays.
3. Takes the MetalLB pool over: strips its Helm annotations and runs
   `install.sh --pool-only --ip <the address it has>`.
4. Creates `portfolio` and `luna-shopper`, copies the TLS Secrets of each unit's
   hosts, the six Luna Secrets and the `release-tasks` ledger into them
   (verbatim, never regenerated: it stops if a copy exists with other values),
   and installs `portfolio` with no Gateway.
5. Dumps the four databases through their backup CronJobs (staging and
   production), sets the five volumes to `Retain`, stops the Luna workloads of
   `nx-portfolio`, moves each volume to a claim of the same name in
   `luna-shopper`, and installs `velista` with no Gateway. The backend is down
   from the stop until velista is Ready: 78 seconds in the rehearsal, more on a
   cluster that pulls every image.
6. Enables both new Gateways, then deletes the old Gateway and its routes. In
   the rehearsal nothing stopped answering.
7. An hour later, when every Certificate is Ready under its unit's issuer, a
   later deploy deletes the namespace `nx-portfolio` and the ClusterIssuer
   `letsencrypt-prod` with its account Secret. The volumes stay, bound in
   `luna-shopper`, with reclaim policy `Retain`.

A failure in steps 1 to 4 leaves the old release serving. A failure in step 5
prints each volume and the command that binds it. A failure in step 6 needs a
person; the deploy's diagnosis prints both Gateways, both releases and the
Envoy Service.

**Check after it**, on the box:

```sh
helm list -A                          # portfolio in portfolio, velista in luna-shopper
kubectl get gateway -A                # portfolio and velista, both PROGRAMMED True
kubectl get certificate -A            # six, all READY True
kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gatewayclass=eg
kubectl get cm release-tasks -n luna-shopper -o yaml   # the ledger, copied
kubectl get pv                        # five volumes, Retain, bound in luna-shopper
```

and from anywhere, each public URL over TLS, `/velista/en` on the portfolio host,
and `/.well-known/assetlinks.json` on velista's host.

**After both clusters are cut over**, with host maintenance reading the `host-*`
environments (section 7): `bash k8s/bootstrap/github-environments.sh` for both
environments if not done yet, then delete the four repository secrets
`SSH_DEPLOY_HOST`, `SSH_DEPLOY_HOST_STAGING`, `SSH_DEPLOY_USER` and
`SSH_DEPLOY_KEY`.
