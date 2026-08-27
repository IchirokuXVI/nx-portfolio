# 0002 Give staging its own cluster

Staging and production currently share one k3s node, one Helm release, one namespace, one
NATS server and two Postgres instances. They are told apart by a `staging.enabled` flag, an
`env` field on every entry in `values.yaml`, and the string `-staging` appended to ten
resource names.

This plan removes that dimension entirely. After it, the chart describes **one
environment**, and which environment is decided by which cluster you point it at and which
values file you pass. Staging moves to its own VPS.

## 1. Why

The shared topology has three failures that are not fixable in place, and all three
disappear the moment the two environments stop sharing a machine.

**The broker cannot tell the environments apart.** Both environments' services connect to
`nats://luna-shopper-backend-nats:4222` and subscribe to identical subjects. No queue group
is set on any microservice, and no subject or stream prefix is threaded through the
environment. `values.yaml` claims staging should get "its own JetStream stream/subject
prefix", but no such variable exists in `_env.tpl` or anywhere else. So a request from the
staging gateway can be answered by the **production** auth, core or catalog pod, reading and
writing the production database, and which pod answers is a race between two subscribers.
This is the serious one: it is silent, it is nondeterministic, and it corrupts production
data rather than merely failing.

**Staging's databases have to be hand created.** Each Postgres StatefulSet creates exactly
one database from `POSTGRES_DB`. Sharing the instances means staging's database names have
to differ, which means someone has to `CREATE DATABASE luna_auth_staging` by hand on every
new cluster, in a step recorded only in prose in `luna-shopper-backend-secrets.md`. A step
that is documented but not executable is a step that gets skipped.

**There is one switch for two environments.** `lunaShopperBackend.enabled` is a single
boolean. Inside the templates only staging entries are gated on `staging.enabled`; the
production services render unconditionally. So enabling the backend for a staging smoke test
also stands up five production pods, which crashloop for want of the production Secret,
while the Gateway starts requesting real Let's Encrypt certificates for
`api.ichirokuxvi.com` and `rt.ichirokuxvi.com`.

There is a fourth reason that is about cost rather than correctness. The guard
`if or (ne .env "staging") $.Values.staging.enabled` appears in ten template files. Plan
0001 already called it out as worth extracting. Deleting the concept is better than
extracting it.

And a fifth, which is the actual point of a staging environment: a staging deploy currently
restarts pods on the machine serving production traffic, and a bad chart change takes both
down together. Blast radius is the thing staging exists to contain.

## 2. Target shape

One chart. No `env` field anywhere. No `-staging` names. Two values files that differ only
in the things that genuinely differ.

```
k8s/helm/values.yaml              # shared defaults, no environment in it
k8s/helm/values.production.yaml   # hosts, image tag policy, ipAddress
k8s/helm/values.staging.yaml      # the same keys, staging's answers
```

Resource names become the same in both clusters: `shell`, `luna-shopper-backend-auth`,
`luna-shopper-backend-gateway`. That is the point. Two clusters running the same names is
what makes them comparable, and it removes the string surgery in CI that derives
`luna-shopper-backend-auth-staging` by lowercasing a project name and appending a suffix.

### 2.1 What `values.yaml` loses

| Key | Fate |
| --- | --- |
| `staging.enabled` | Deleted. |
| `stagingImageTag` | Deleted. `productionImageTag` becomes `imageTag`. |
| `apps[].env` | Deleted, along with the five `*-staging` entries. |
| `lunaShopperBackend.services[].env` | Deleted, along with the five `*-staging` entries. |
| `lunaShopperBackend.config.{production,staging}` | Flattened to `lunaShopperBackend.config`. |
| Postgres per instance `database` / `user` | Kept, but now one set, because the instances are no longer shared. |

`apps` drops from ten entries to five and `lunaShopperBackend.services` from ten to five.

### 2.2 What the templates lose

Every occurrence of `if or (ne .env "staging") $root.Values.staging.enabled` in:

- `templates/apps/deployment.yaml.tpl`, `service.yaml.tpl`
- `templates/gateway/gateway.yaml.tpl`, `httproute.yaml.tpl`
- `templates/luna-shopper-backend/deployment.yaml.tpl`, `service.yaml.tpl`, `pdb.yaml.tpl`,
  `migration-job.yaml.tpl`, `configmap.yaml.tpl`

The ConfigMap template also loses its `range $env, $cfg :=` loop and becomes a single
ConfigMap. `_env.tpl` loses the `env` key from its dict and the `$env` variable, keeping
`DEPLOYMENT_ENVIRONMENT` sourced from a values key instead.

The Secret names lose their suffix: `luna-shopper-backend-secrets-production` becomes
`luna-shopper-backend-secrets`. Each cluster holds one.

### 2.3 What CI loses

`.github/workflows/docker-ci.yml`:

- The `prod-tag.yaml` preservation block. It exists only because a staging deploy and a
  production deploy shared a release, so the staging upgrade had to avoid clobbering the
  pinned production version. Two releases on two clusters cannot collide, so the file, the
  `EXTRA_VALUES` plumbing and `/root/helm-live/` all go away.
- The `affected_staging` derivation that lowercases project names and appends `-staging`.
  The deployment name is now just the lowercased project name.

`k8s/helm/deploy-release.sh` loses the part that writes and reads `prod-tag.yaml`, keeping
the part that pins an immutable version tag.

## 3. Two hosts, two sets of secrets

Both workflows deploy over SSH to a host named by a repository secret. They now need
different hosts.

| Secret | Used by | Value |
| --- | --- | --- |
| `SSH_DEPLOY_KEY` | both | Unchanged if the same key is authorised on both hosts, which is the simpler option. |
| `SSH_DEPLOY_USER` | both | `root`, unchanged. |
| `SSH_DEPLOY_HOST` | `release.yml` | Production VPS, `46.62.204.230`. |
| `SSH_DEPLOY_HOST_STAGING` | `docker-ci.yml` | **New.** The staging VPS. |

Adding one secret rather than renaming both keeps the production workflow untouched, which
matters because production is the one that is currently working.

The staging deploy passes `--values values.yaml --values values.staging.yaml`; the release
deploy passes `--values values.yaml --values values.production.yaml`.

## 4. DNS

All ten records currently resolve to `46.62.204.230`, verified at time of writing. Five of
them have to move to the new staging address once it exists:

| Record | Now | After |
| --- | --- | --- |
| `ichirokuxvi.com` | 46.62.204.230 | unchanged |
| `mfe.ichirokuxvi.com` | 46.62.204.230 | unchanged |
| `velista.ichirokuxvi.com` | 46.62.204.230 | unchanged |
| `api.ichirokuxvi.com` | 46.62.204.230 | unchanged |
| `rt.ichirokuxvi.com` | 46.62.204.230 | unchanged |
| `staging.ichirokuxvi.com` | 46.62.204.230 | **staging VPS** |
| `mfe.staging.ichirokuxvi.com` | 46.62.204.230 | **staging VPS** |
| `velista.staging.ichirokuxvi.com` | 46.62.204.230 | **staging VPS** |
| `api.staging.ichirokuxvi.com` | 46.62.204.230 | **staging VPS** |
| `rt.staging.ichirokuxvi.com` | 46.62.204.230 | **staging VPS** |

`velista.*` is there because velista moved to its own origin
(`apps/velista/plans/0013`) rather than sitting under `mfe.*/velista`. That makes ten
Gateway listeners and ten certificates on the two clusters combined, which is the number the
rate limit note below is about.

Move them **before** the first staging deploy. cert-manager requests a certificate per
listener as soon as the chart applies, and Let's Encrypt rate limits failed validations far
more tightly than successful issuances. Lower the TTL on the five staging records a day
ahead so the cutover is quick.

`values.staging.yaml` sets `ipAddress` to the staging VPS address, which is what the chart's
`IPAddressPool` binds.

## 5. One replica

`replicaCount` drops from 2 to 1, in both environments, for a reason that is not about cost.

`apps/luna-shopper-backend/realtime` is a socket.io gateway
(`src/app/socket/realtime.gateway.ts`) using the default in memory adapter. With two
replicas, a client connected to pod A never receives a broadcast emitted on pod B, and a
polling transport handshake that lands on a different pod each request fails outright.
Horizontal scaling needs a shared adapter, which means Redis, which does not exist in this
stack yet. Two replicas today is not redundancy; it is a broken realtime service half the
time.

The other four services would scale fine, but a uniform `replicaCount` is easier to reason
about than a per service one, and none of them is under load.

**The PodDisruptionBudget has to change with it.** `pdb.minAvailable: 1` against a single
replica means no voluntary eviction can ever succeed, so `kubectl drain` hangs forever and
node maintenance is impossible. Either set `maxUnavailable: 1` instead, or skip rendering
the PDB when `replicaCount` is 1. Prefer the second: a PDB over a single replica expresses
nothing true.

Accept the consequence, which the rolling update settings now cannot hide: with one replica,
`maxUnavailable: 0` and `maxSurge: 1` still bring the new pod up before retiring the old one,
so a clean rollout is still brief. A crash or a node failure is a full outage. That is the
agreed tradeoff until Redis lands.

## 6. Order of work

The sequence matters, because step 3 is the one that breaks production if the earlier steps
are wrong.

1. **Flatten the chart.** Delete the `env` dimension, add the two values files, render both
   with `helm template` and diff the production render against the current one. The
   production render should differ only in resource names losing nothing and in the absence
   of the staging objects. This is the whole risk of the plan, and it is fully checkable
   offline.
2. **Bootstrap the staging VPS.** `./k8s/bootstrap/install.sh --k3s --issuer letsencrypt
   --email ...`, which now installs k3s and MetalLB too. Create the namespace and the
   Secrets.
3. **Move the four staging DNS records.**
4. **Split the workflows.** Add `SSH_DEPLOY_HOST_STAGING`, point `docker-ci.yml` at it, and
   pass the per environment values file in both workflows.
5. **Deploy staging.** It is a fresh cluster with no data, so a failure costs nothing.
6. **Re-deploy production from the flattened chart**, once staging has proved the chart
   renders and runs.

Step 6 is a `helm upgrade` that renames every staging resource out of existence in the
production cluster. Helm removes objects absent from the new release, so the ten
`*-staging` Deployments, their Services, HTTPRoutes and PDBs are cleaned up in that upgrade.
The production apps keep their names and are untouched.

## 7. What this plan does not do

- **It does not add Redis.** One replica is the workaround. Redis and a socket.io adapter
  are a separate plan, and only then does `replicaCount` go back up.
- **It does not separate the two clusters' container images.** Both pull the same
  environment agnostic images from the same GHCR packages. Only the shell and velista bake
  environment specific URLs, and both are handled by build arguments
  (see `apps/velista/plans/0014`).
- **It does not give staging its own OAuth client or SMTP sender.** Those are configuration
  values in `values.staging.yaml`, and with Google sign in becoming optional
  (`apps/luna-shopper-backend/plans/0026`) staging can run with them unset.
