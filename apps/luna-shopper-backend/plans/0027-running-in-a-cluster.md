# 0027 What the backend needs before it runs in a cluster

Plan 0002 built the chart for these five services and plan 0025 squashed their migrations,
but nothing in this stack has ever started inside Kubernetes. Three things in that gap will
each stop a deploy dead, and none of them is visible from a passing test suite, because the
suites run the services from the repo rather than from the image.

This plan covers the probe path, a migration entrypoint that exists inside the image, and the
replica count. Google and SMTP configuration are `plans/0026`; the cluster split is
`k8s/plans/0002`.

## 1. The probes point at a route that does not exist

`k8s/helm/templates/luna-shopper-backend/deployment.yaml.tpl:58` and `:65` set both probes to
`path: /health`. The controller in
`libs/luna-shopper/platform/src/lib/health/health.module.ts:49` is `@Controller('health')`
with exactly two handlers, `@Get('live')` and `@Get('ready')`. There is no handler at the
bare path, so both probes receive a 404.

The failure mode is worse than it sounds. Readiness never passes, and
`rollout.maxUnavailable` is `0`, which tells Kubernetes it may not retire an old pod until a
new one is ready. On a first install there are no old pods, so ten Deployments sit at zero
available replicas; on an upgrade the rollout blocks indefinitely rather than failing. `helm
upgrade` without `--wait` reports success either way, so CI goes green while nothing is
serving.

Fix:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
livenessProbe:
  httpGet:
    path: /health/live
```

Splitting them is the point, not a detail. `live` runs `this.health.check([])`, which
answers as long as the event loop turns, and that is what liveness should mean: restarting a
pod because its database is briefly unreachable makes an outage longer. `ready` adds the
heap check and every dependency indicator the service registered, and flips to not ready on
`SIGTERM` so the proxy stops sending new work during a graceful shutdown. That is what
readiness should mean.

Add a template spec asserting the two paths against the two route strings. This is a
one-line bug that cost the entire first deploy, and it is the kind that comes back.

## 2. There is no way to run migrations inside the image

Every stateful service is `synchronize: false` by design, stated in `data-source.ts` and in
`app.module.ts` for all three. `k8s/helm/values.yaml:368` has `migrations.enabled: false`.
So on a fresh cluster nothing creates the schema and the first query fails.

Turning the flag on does not help, because of what the Job runs. `values.yaml:370` is
`command: ['node', 'migrate.js']`, and no such file is ever produced. Each service's
`webpack.config.js` declares a single entry, `main: './src/main.ts'`, so
`dist/apps/luna-shopper-backend-auth/` contains `main.js` and the pruned manifest. The image
copies that directory and nothing else.

The reason this was never caught is that both other paths run migrations from the repository.
`k8s/e2e/luna-shopper-backend/stack.sh:283` calls
`npx nx run "luna-shopper-backend-$svc:migration:run"`, which resolves to
`node .../db/cli.js migration:run -d .../db/data-source.ts`. That needs ts-node, the
workspace `tsconfig`, the `@portfolio/*` path aliases and the git ignored `.env` files. A
runtime image has none of them, and should not.

### 2.1 A second entry point per stateful service

Add `src/migrate.ts` to auth, core and catalog, and a second webpack entry so it is emitted
beside `main.js`:

```ts
// apps/luna-shopper-backend/auth/src/migrate.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AUTH_ENTITIES } from './app/entities';
import { AUTH_MIGRATIONS } from './app/db/migrations';

async function run() {
  const url = process.env['AUTH_DB_URL'];
  if (!url) throw new Error('AUTH_DB_URL is not set.');

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: AUTH_ENTITIES,
    migrations: AUTH_MIGRATIONS,
    synchronize: false,
  });

  await ds.initialize();
  const applied = await ds.runMigrations({ transaction: 'all' });
  console.log(`applied ${applied.length} migration(s)`);
  await ds.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Two details decide whether this works.

**The migrations must be imported, not globbed.** `data-source.ts` lists them as
`['apps/.../migrations/*.ts']`, a filesystem glob resolved at runtime by the CLI. Webpack
cannot follow a glob, so a bundled build would find zero migrations, run cleanly, apply
nothing, and report success. Export an explicit ordered array from
`src/app/db/migrations/index.ts` and have both `migrate.ts` and `data-source.ts` use it, so
the CLI and the image can never disagree about which migrations exist. Add a spec asserting
the array is sorted by timestamp and matches the files in the directory.

**`transaction: 'all'`** so a failure part way leaves nothing behind. Migrations are
expand and contract, so a half applied set is the one state the rollout contract does not
cover.

Then in each `webpack.config.js`, alongside the existing plugin:

```js
new NxAppWebpackPlugin({
  target: 'node',
  compiler: 'tsc',
  main: './src/migrate.ts',
  outputFileName: 'migrate.js',
  tsConfig: './tsconfig.app.json',
  optimization: false,
  outputHashing: 'none',
  generatePackageJson: false,
}),
```

`generatePackageJson: false` on the second entry: the first one already writes the manifest
that `npm ci --omit=dev` installs from, and two writers would race.

### 2.2 Then enable it

`migrations.enabled: true` in `values.yaml`. The Job is already a `pre-install,pre-upgrade`
hook with `hook-weight: '0'` and `backoffLimit: 3`, and it already receives the right
environment through `_env.tpl`, so nothing else in the chart changes. Verify the rendered Job
mounts `AUTH_DB_URL` for auth and not for core, which is the property `_env.tpl` exists to
guarantee.

### 2.3 The seed scripts have the same shape

`src/app/db/seed/cli.js` exists for all three services and is invoked the same way, from the
repo. This plan does not move seeding into the image, because seeding a cluster is not part
of a deploy. Worth stating so the omission is deliberate: if staging ever needs seed data, it
is a `kubectl run` against the image with a third entry point, not a hook.

## 3. One replica

`lunaShopperBackend.replicaCount` drops from 2 to 1.

`apps/luna-shopper-backend/realtime/src/app/socket/realtime.gateway.ts` is a
`@WebSocketGateway` on socket.io with the default in memory adapter. Two replicas means a
broadcast emitted on one pod never reaches clients connected to the other, and a long polling
handshake that lands on a different pod per request fails outright. There is no Redis in this
stack and no socket.io adapter configured, so the current `replicaCount: 2` does not provide
redundancy; it provides a realtime service that is wrong about half the time.

The other four would scale correctly, but a single value is easier to reason about, and none
of them is under load.

**The PodDisruptionBudget must change with it.** `pdb.minAvailable: 1` against one replica
means no voluntary eviction can ever be allowed, so `kubectl drain` blocks forever and the
node cannot be maintained. Stop rendering the PDB when `replicaCount` is 1 rather than
switching it to `maxUnavailable: 1`: a disruption budget over a single replica encodes
nothing true, and an absent object is clearer than a permissive one.

The rolling update settings stay as they are. With one replica, `maxUnavailable: 0` and
`maxSurge: 1` still start the replacement and wait for its readiness probe before retiring
the old pod, so an ordinary deploy is still nearly seamless. What one replica costs is
resilience to a crash or a node failure, which is the accepted tradeoff until a Redis adapter
lands and this value goes back up.

## 4. Order

1. Probe paths. One line each, and until it is done nothing else can be observed working.
2. The migrations index, then `migrate.ts`, then the webpack entry, then
   `migrations.enabled`.
3. `replicaCount` and the PDB condition.

Steps 1 and 3 are chart only and verifiable with `helm template`. Step 2 is the only one with
real code in it, and its own risk is the glob: prove the built `migrate.js` applies the
expected migrations against a throwaway Postgres before trusting it in a hook that runs
before every upgrade.
