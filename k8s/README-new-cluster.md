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
| `k8s/bootstrap/provision-release.sh` | a cluster       | one the chart can deploy to: namespace and Secrets   |

`provision-host.sh --k3s` runs the second for you, so in practice there are two
commands and one interactive session.

Two things in here are ordering constraints rather than preferences, and both
have a section explaining why: **DNS moves before the first deploy** (section 4)
and **root stays reachable until the replacement accounts are proven** (section
3).

## 0. What you need before you start

- The VPS address and its root password or key.
- Control of the domain's DNS records.
- Admin on the GitHub repository, to set secrets.
- Optionally, a Google OAuth client secret and an SMTP password. Both are
  supported as blank: the Google routes and registration answer 501 rather than
  the service failing to start, so a cluster with neither is a working cluster
  with two features off.
- Production only: an S3 compatible bucket and a key for backups.

Decide which environment this machine is before you begin. It selects the values
file, the `--env` flag and the five DNS names, and nothing else differs.

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
keys, then hands off to `install.sh` for the cluster.

```powershell
scp k8s/bootstrap/provision-host.sh root@<IP>:/tmp/

$admin  = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_admin.pub  -Raw).Trim()
$deploy = (Get-Content $env:USERPROFILE\.ssh\nx_<env>_deploy.pub -Raw).Trim()

ssh root@<IP> "bash /tmp/provision-host.sh --admin-key '$admin' --deploy-key '$deploy' --k3s"
```

Pass the keys as quoted arguments rather than piping the `.pub` files. A file
piped from PowerShell arrives with CRLF line endings, and sshd rejects the
resulting `authorized_keys` without explaining why.

What it creates, and what it deliberately does not:

- **`ichiroku`**, in the `sudo` group, for humans. Override with `--admin-user`.
- **`deploy`**, unprivileged, for CI. It needs no sudo, because k3s writes its
  kubeconfig world readable and helm and kubectl are the whole deploy.
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

Put the machine's address in its values file and commit it:

```yaml
# k8s/helm/values.<env>.yaml
ipAddress: <IP>
```

MetalLB binds it as the `IPAddressPool`, and the chart refuses to render while it
is empty rather than leaving a LoadBalancer `<pending>` forever with everything
else looking healthy.

Then point the five records at it. `mfe` carries three remotes, and velista has
its own origin because it is installable there as a PWA.

**The five live in two zones.** The portfolio is on `ichirokuxvi.com`; velista is
a product with a domain of its own, and its backend (`api.`, `rt.`) exists only to
serve it, so all three sit under `velista.app`. Both zones point at the same
cluster address, so this is a naming split rather than a second deploy.

| Production            | Staging                       |
| --------------------- | ----------------------------- |
| `ichirokuxvi.com`     | `staging.ichirokuxvi.com`     |
| `mfe.ichirokuxvi.com` | `mfe.staging.ichirokuxvi.com` |
| `velista.app`         | `staging.velista.app`         |
| `api.velista.app`     | `api.staging.velista.app`     |
| `rt.velista.app`      | `rt.staging.velista.app`      |

Each row is its own A record. On the staging side in particular, a record on
`staging.velista.app` does **not** cover `api.staging.velista.app`, and a wildcard
`*.velista.app` matches one label, so it does not either.

**Move them before the first deploy, and confirm with `dig` rather than a
browser.** cert-manager requests a certificate per Gateway listener the moment
the chart applies, and Let's Encrypt rate limits failed validations far more
tightly than successful ones. Five listeners retrying against records that still
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
the Google client secret and the SMTP password, and a piped or `ssh host "..."`
invocation takes its "not a terminal" branch and silently leaves both unset.

```sh
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --env <env>
```

It creates the namespace and the Secrets the chart reads through `secretKeyRef`:
three database passwords, a JWT keypair, and the connection strings, which are
derived from the same shell variables as the passwords so the two cannot
disagree. It writes your plaintext copy to
`~/luna-shopper-<env>-secrets.txt`.

Move that file into your password manager and delete it. It holds the JWT
keypair, and losing that invalidates every issued token at once, logging out
every user simultaneously.

Re-running is safe: existing values are kept, because Postgres reads
`POSTGRES_PASSWORD` only when it initialises an empty data directory, so a
regenerated password on an existing volume would leave the Secret and the
database disagreeing and every service unable to connect. `--rotate` is the
explicit opt in, and it tells you what else has to happen.

The script refuses to write secrets inside the repository it lives in. With the
clone at `~/nx-portfolio` the default path is your home directory, which is
outside it, so the default is fine. Pass `--out` if you are running from a copy
that sits directly in `$HOME`, such as the CI copy at `~deploy/k8s`.

Then verify what the chart will actually ask for:

```sh
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --env <env>
```

`--check` renders the chart and asserts every `secretKeyRef` and
`configMapKeyRef` it references can be satisfied. What this script provisions has
to exist in the cluster. What the chart creates itself, today only
`luna-shopper-backend-config`, is checked against the render instead and marked
`(chart)`, because helm creates it during the very deploy this check gates. This
is the same command CI runs before each deploy, so a pass here means the
preflight will pass there.

## 6. Backups, production only

Production renders the backup CronJobs, and they need credentials the script
cannot generate. It prints the exact command; the shape is:

```sh
kubectl -n nx-portfolio create secret generic luna-shopper-backend-backup-secret \
  --from-literal=S3_ENDPOINT=... --from-literal=S3_BUCKET=... \
  --from-literal=AWS_ACCESS_KEY_ID=... --from-literal=AWS_SECRET_ACCESS_KEY=...
```

Use a bucket scoped, ideally write only key. A backup credential that can delete
its own bucket turns a compromised cluster into a compromised backup.

Staging gets no such Secret on purpose. An empty placeholder would make `--check`
pass against credentials that cannot write anywhere.

## 7. Point CI at the machine

Repository secrets:

| Secret                    | Value                                          |
| ------------------------- | ---------------------------------------------- |
| `SSH_DEPLOY_USER`         | `deploy`                                       |
| `SSH_DEPLOY_KEY`          | the **private** key from section 1, whole file |
| `SSH_DEPLOY_HOST`         | production's address                           |
| `SSH_DEPLOY_HOST_STAGING` | staging's address                              |

Paste the private key including the `-----BEGIN OPENSSH PRIVATE KEY-----` and
`-----END-----` lines and the trailing newline. A truncated paste is the usual
cause of `Load key: error in libcrypto` in the deploy job.

`SSH_DEPLOY_USER` is shared by both workflows, so both machines must trust the
same CI key, or that secret needs splitting first.

## 8. Deploy

**Staging** deploys on every push to `main`: affected projects only, tagged
`staging`, followed by a rollout that is waited on rather than assumed.

**Production** deploys when a GitHub Release is published, at that commit, pinned
to the version tag. By hand, on the box:

```sh
bash ~/nx-portfolio/k8s/helm/deploy-release.sh <version>
```

Rollback is the same command with an older version, or `helm rollback`.

## 9. Verify

```sh
kubectl get pods -n nx-portfolio
kubectl get certificate -n nx-portfolio          # five, all READY=True
kubectl get svc -n envoy-gateway-system          # EXTERNAL-IP is your address
```

That last one is the piece people hunt for. The data plane Service is provisioned
by Envoy Gateway and is **not** declared by the chart, so it lives in
`envoy-gateway-system` rather than the application namespace. An `EXTERNAL-IP`
stuck at `<pending>` means MetalLB has no address to hand out, which means
`ipAddress` in section 4.

When something is wrong, events are the part that matters and the part people
forget. `ImagePullBackOff`, a PVC that cannot bind, and a failing readiness probe
all announce themselves there and nowhere else:

```sh
kubectl -n nx-portfolio get events --sort-by=.lastTimestamp | tail -40
```

## 10. Production only: the data

A new cluster is an empty database. The three Postgres instances start with
nothing in them, so rebuilding production on a new machine means taking a dump
from the old one and restoring it with `k8s/helm/restore-database.sh` **before**
DNS points at the new box. Staging holds nothing worth keeping and is disposable
by design, which is also where a restore is rehearsed.

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
`provision-release.sh --env <env>`, which rebuilds the URL from it.

**`--check` reports every `configmap/luna-shopper-backend-config` key missing on
a cluster nothing has been deployed to yet.** Fixed. That ConfigMap belongs to
the chart rather than to provisioning, so it could not exist before the first
`helm upgrade`, and the check was gating the deploy that would have created it.
CI deadlocked the same way, since both workflows run `--check` before their
deploy step. Chart owned objects are now checked against the render, so the
preflight passes on a freshly provisioned cluster and the first deploy creates
the ConfigMap. Fixed in the same change: `GOOGLE_CLIENT_SECRET` and `SMTP_PASS`
left blank at the prompts were counted as failures, though plan 0026 makes both
a supported configuration. Only those two may be empty; every other key must
still carry a value, and one that does not now reads `EMPTY` rather than
`MISSING`.

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

# 2. accounts, keys, cluster
scp k8s/bootstrap/provision-host.sh root@<IP>:/tmp/
ssh root@<IP> "bash /tmp/provision-host.sh --admin-key '$admin' --deploy-key '$deploy' --k3s"

# 3. prove both logins, THEN close the door (it asks you to type 'lock root')
ssh -i $env:USERPROFILE\.ssh\nx_<env>_admin ichiroku@<IP> id
ssh -i $env:USERPROFILE\.ssh\nx_<env>_deploy deploy@<IP> id
ssh -t root@<IP> "bash /tmp/provision-host.sh --lock-root"
```

```sh
# 4. ipAddress in values.<env>.yaml, commit, move the five DNS records, dig to confirm

# 5. on the box, as the admin user, interactively
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --env <env>
bash ~/nx-portfolio/k8s/bootstrap/provision-release.sh --check --env <env>

# 6. production only: the backup Secret
# 7. GitHub secrets: SSH_DEPLOY_USER, SSH_DEPLOY_KEY, the host
# 8. push to main (staging) or publish a Release (production)
```
