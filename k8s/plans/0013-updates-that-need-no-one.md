> **PR:** [#763](https://github.com/IchirokuXVI/nx-portfolio/pull/763)

# 0013 Updates that need no one

## Brief for the agent

- **Objective.** Keep the dependencies, the images, the two hosts and k3s current with as
  little human work as possible. Never let a change that broke staging reach production.
- **Context.** Before this plan nothing updated by itself. The repository had no Renovate or
  Dependabot configuration, and Postgres, NATS and Redis ran on floating tags. k3s was not
  pinned. Neither host had fetched a package list since it was provisioned (2026-08-27 and
  2026-08-28), and `unattended-upgrades` was not installed.
- **Target state.** Renovate opens dependency updates into `dev` and merges the safe ones. A
  weekly workflow patches staging, waits two days, and then gives production the same
  package set. A person publishes releases and reviews majors, and does nothing else on a
  normal week.
- **Scope.** `renovate.json`, four workflows, `nx-host-patch` and the health scripts,
  `install.sh` and `provision-host.sh`, and the runbook.
- **Constraints.** The deploy account stays without general sudo. Production changes only
  after staging was healthy with the same change. Majors never merge by themselves.
- **Action boundaries.** The repository settings (environments, the variable and the token)
  and the first `provision-host.sh` run on each host belong to the owner.
- **Progress evidence.** A green `host-maintenance` run with both jobs. A Renovate PR that
  merged itself after green checks.

## 1. The facts this rests on (2026-10-22)

| | Staging | Production |
| --- | --- | --- |
| OS | Debian 13 (trixie), kernel 6.12.105 | the same |
| Size | 4 CPU, 8 GB, 157 GB | 8 CPU, 16 GB, 503 GB |
| k3s | v1.36.3+k3s1 | the same |
| Package lists | 2026-08-28 | 2026-08-28 |
| Firewall | none, 6443, 10250 and 7946 reachable from the internet | the same |

Debian's current kernel was 6.12.113 on that day, so both hosts were eight kernel releases
behind. The provider mirror (`debian.anexia.at`) publishes no `Snapshots:` field, so apt's
own `--snapshot` option cannot be used. snapshot.debian.org answers in well under a second.

## 2. Decisions

**D1. Renovate, not Dependabot.** One configuration covers npm, Dockerfiles, compose files,
GitHub Actions, the image lines in the Helm values, the build image in the workflows, and the
versions in `install.sh`. Dependabot cannot read the last three.

**D2. What merges by itself.** Patch, minor, pin and digest updates, after a three day wait
and only when every check on the commit is green. Renovate merges by itself
(`platformAutomerge: false`), because `dev` has no required checks. GitHub's own auto merge
would merge such a PR at once. Not automatic:

- every major, which opens only after a tick on the Dependency Dashboard and a seven day wait
- a minor of a `0.x` package
- a minor of Postgres, Redis or NATS
- a minor of k3s or cert-manager, and the Gateway API and Envoy Gateway pair

A security fix skips the wait.

**D3. Nx, Angular and TypeScript move through `nx migrate`.** Their update also rewrites code
and configuration, which Renovate cannot do. `nx-migrate.yml` runs on the first Monday of each
month, moves one major at a time, and opens a PR with one commit per migration. It pushes with
`AUTOMATION_TOKEN`, because GitHub starts no checks for a push made with `GITHUB_TOKEN`.

**D4. The OS is patched from CI, not by `unattended-upgrades`.** A host that patches itself
cannot be held back by the other host. Staggered times only delay production. They are not a
gate, and two days later the mirror holds different packages from the ones staging proved.

**D5. Both hosts install one snapshot.** `nx-host-patch apply <timestamp>` reads only
snapshot.debian.org at that timestamp (`debian`, `-updates` and `-security`). Production gets
the timestamp staging used, so production installs exactly what staging ran for two days. If
snapshot.debian.org is down, the run fails and both hosts stay as they were. A late security
update is the cost, and the next week's run collects it.

**D6. The gate.** `host-maintenance.yml`, every Monday at 03:30 UTC:

1. staging: healthy before, patch, k3s, add-ons, reboot when due, healthy after, the six
   public URLs answer
2. the `host-production` environment waits 2880 minutes
3. staging is still healthy and its URLs still answer
4. production: the same steps as staging, with the same snapshot

Each job shares the concurrency group of its environment's deploy workflow (`staging-deploy`,
`production-release`), so a reboot never lands inside a `helm upgrade`.

**D7. One root program for CI.** The deploy account gets a sudo rule for
`/usr/local/sbin/nx-host-patch` and for nothing else. The program is a root owned copy and
checks each argument against a fixed pattern. The deploy account already reads the k3s admin
kubeconfig, so the rule does not widen what a stolen CI key can do. It keeps the routine path
free of tricks with privileged pods.

**D8. Reboot only when due.** The trigger is a newer installed kernel than the running one,
or a service that needrestart says still runs an old library. A reboot on one node costs
about two minutes. The time window and the health checks make that safe. Debian has no free
live patching, so a kernel fix needs the reboot.

**D9. k3s is pinned, and its flags live in `/etc/rancher/k3s/config.yaml`.** The k3s installer
rewrites the systemd unit from its own arguments. An upgrade without `--disable traefik` would
put traefik back on ports 80 and 443. With the flags in the file, an upgrade needs no
arguments. `install.sh --k3s` writes the file on every run, so one run of
`provision-host.sh --k3s` moves an existing host onto it. The installer is fetched from the
same tag as the binary. `nx-host-patch k3s` refuses a downgrade, a skipped minor and a host
without the file.

**D10. Host keys are checked.** The new workflow uses `StrictHostKeyChecking=yes` with the keys
from the `SSH_KNOWN_HOSTS` variable. The deploy workflows still accept any key. Changing them is
outside this plan.

**D11. Image scanning reports and never blocks.** `image-scan.yml` scans the thirteen staging
images weekly and files fixable HIGH and CRITICAL findings under code scanning.

## 3. What the owner does once

1. Install the Renovate GitHub App on the repository.
2. Create the environments `host-staging` (no rules) and `host-production` (wait timer 2880
   minutes).
3. Set the repository variable `SSH_KNOWN_HOSTS` to the output of
   `ssh-keyscan -t ed25519 ichirokuxvi.com staging.ichirokuxvi.com`.
4. Create a fine grained token with contents and pull requests write on this repository, and
   save it as the secret `AUTOMATION_TOKEN`.
5. On each host, staging first: `git pull` in `~/nx-portfolio`, then
   `sudo bash ~/nx-portfolio/k8s/bootstrap/provision-host.sh --k3s`.
6. Run `host-maintenance` by hand once, and watch both jobs.

A ruleset on `dev` that requires `verify` and `verify-infra` is recommended but not needed.
`pr.yml` already asks for it.

## 4. Left out

- **A host firewall.** `--firewall` exists in `provision-host.sh`, but no host has run it and ufw
  is not installed. The k3s API (6443), the kubelet (10250) and MetalLB's memberlist (7946) answer
  from the internet. All three require authentication, but a port that does not need to be open
  should be closed. Try it on staging first, then production.
- **A tested restore.** The backups are dumped nightly, and `restore-database.sh` has never had its
  recovery time measured. A scheduled restore needs a read key that the current design keeps
  away from the cluster. That decision belongs to the owner.
- **Data service majors.** Postgres 16 to 17 or 18, Redis 7 to 8 (a licence change, or Valkey), and
  NATS 2.10 to 2.11 or 2.12. Each one is a release task of its own.
