# 0241: The environment has one source

> Each Nest service validates its environment at boot with a Joi schema
> (`<service>/src/app/config/app-config.ts`, plus `gateway/src/app/config/legal-config.ts`,
> the `retentionValidationSchema` of auth, core and catalog, and the shared
> `telemetryValidationSchema` and `redisValidationSchema` of the platform library). That
> schema already decides which values a service refuses. Four other places describe the same
> keys by hand and drift from it: the chart's `_env.tpl` and `configmap.yaml.tpl`, the
> Compose overlay `compose.apps.yml`, the eight `.env.example` files, and the `DERIVED_KEYS`
> table of `luna-slot.sh`. A self hoster who reads any of them reads a copy.
>
> The owner decided on 2026-11-02 that the schema is the one source. This plan adds metadata
> to every key, generates a committed `env-manifest.json` from the schemas (as
> `gateway/docs/openapi.json` is generated from the controllers), generates the `.env.example`
> files, the Compose environment of k8s `0020` and a configuration reference page from the
> manifest, and adds tests that fail when the chart or `server-slot.sh` (today `luna-slot.sh`, renamed by docs `0003`) disagrees with it.
>
> Paths below are today's. Docs `0003` moves `apps/luna-shopper-backend/<service>` to
> `apps/velista-server/<service>` and this plans directory to `apps/velista-server/plans`.
>
> Prerequisite reading: backend `0002` section 1 (config validated at boot), backend `0026`
> (an unconfigured feature answers 501 and never breaks boot), backend `0231` section 5 (how
> the operator's values reach the pods), backend `0019` section 5 and
> `gateway/src/app/docs/openapi-document.spec.ts` (the generated artifact and its stale
> check), k8s `0015` (one chart per unit), `k8s/helm/velista/templates/luna-shopper-backend/_env.tpl`,
> `configmap.yaml.tpl`, `k8s/e2e/luna-shopper-backend/compose.apps.yml`, and
> `k8s/e2e/luna-shopper-backend/luna-slot.sh` (the comment above `DERIVED_KEYS`).
>
> **Build order.** Step 2 of the series: after docs `0003`, in parallel with backend `0240`,
> `0242`, `0243`, docs `0004`, velista `0178`, k8s `0020` and `0021`. The Compose half
> (target state 5) needs the file layout k8s `0020` fixes. If k8s `0020` has not merged when
> this plan is built, the builder leaves that item out and says so, and k8s `0020` wires the
> generator when it lands. The series order puts k8s `0020` after this plan, so the usual
> case is that this plan leaves target state 5 out and k8s `0020` wires it. Backend `0242`
> adds and changes keys (the harvester user agent); whichever of the two merges second
> regenerates the manifest. The series order, as every plan of the series states it: docs
> `0003` first, alone, after the pull request gate; then in parallel docs `0004`, backend
> `0240` to `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242` after velista
> `0178` for the admin mechanism, k8s `0020` after backend `0241` for the generated files);
> k8s `0019` after docs `0003` and backend `0240`, in the same rollup to `main` as `0240`;
> docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Make the Joi schema of each of the seven Nest services the single description of its
environment: every key carries a description and metadata, one Nx target writes
`apps/velista-server/docs/env-manifest.json` from the schemas, a spec fails when it is
stale, the `.env.example` files and the configuration reference are generated from it, and
node tests fail when `_env.tpl` or `server-slot.sh` names a key the manifest does not, or
misses one it should.

### Context

- The schemas: `gatewayValidationSchema`, `realtimeValidationSchema`, `authValidationSchema`,
  `coreValidationSchema`, `catalogValidationSchema`, `harvesterValidationSchema`,
  `assistantValidationSchema`. Each is passed to `ConfigModule.forRoot({ validationSchema })`
  in its `app.module.ts`. Shared pieces are spread in: `telemetryValidationSchema` and
  `redisValidationSchema` (`libs/luna-shopper/platform`), `legalValidationSchema`
  (gateway), `retentionValidationSchema` (auth, core, catalog), `allowanceValidationSchema()`
  (assistant).
- The transcriber is Python (`apps/luna-shopper-backend/transcriber/src/app.py`) and has no
  Joi schema. `Settings.from_env` reads its `TRANSCRIBER_*` keys and the bottom of the file
  reads `PORT` and `LOG_LEVEL`,
  and the chart gives it its environment in `transcriber.yaml.tpl`, not through `_env.tpl`.
- Joi is `^17.13.6` in `package.json` (17.13.8 installed). `schema.describe()` returns, per
  key, `flags.default`, `flags.presence` (`required`), `flags.description` (from
  `.description()`), `metas` (from `.meta({...})`), `allow` and `whens`, and on the object
  `dependencies` with `{ rel: 'or', peers: [...] }` for the `.or('AUTH_JWT_PUBLIC_KEY',
  'AUTH_JWT_PUBLIC_KEY_FILE')` pairs. Verified with the installed version.
- A few keys are read outside `ConfigService`, but each is still declared in a schema:
  `THROTTLE_MULTIPLIER` (read at import by `throttler-config.ts`), the `OTEL_*` keys (read by
  `tracing.ts` before Nest exists), and the `<ROLE>_DB_URL` that `migrate.ts`,
  `admin-cli.ts` and `reconcile-deletions.ts` read. `NODE_ENV` is set by every Dockerfile
  (`ENV NODE_ENV=production`) and read by `logger.options.ts`; no schema declares it.
- `_env.tpl` gives each role its keys from five sources: the app Secret
  (`luna-shopper-backend-secrets`, `secretKeyRef`), the ConfigMap
  (`luna-shopper-backend-config`, `configMapKeyRef`), the operator Secret
  (`luna-shopper-backend-operator`, through `lunaShopperBackend.operatorEnv`), literals the
  chart computes (`PORT`, `OTEL_SERVICE_NAME`, `SERVICE_VERSION`, `DEPLOYMENT_ENVIRONMENT`),
  and the database URLs, which live in the app Secret but are derived by
  `provision-release.sh` from the generated passwords. Several keys are deliberately left
  out of the chart so their default is the deployment's answer (the comments on
  `RETENTION_AUDIT`: "The sweep's own interval, batch and switch are not in the chart").
- The chart renders the key under another name in one place: catalog receives
  `SERVICE_ACTOR_IDS` from the Secret key `HARVESTER_ACTOR_ID`.
- `luna-slot.sh` declares `DERIVED_KEYS` per env file (`shared`, `gateway`, `realtime`,
  `auth`, `core`, `catalog`, `harvester`, `assistant`, and four `*-test` files) and
  `TELEMETRY_DERIVED='OTEL_EXPORTER_OTLP_ENDPOINT'`. The list is inclusive on purpose (the
  comment above it says why).
- `openapi-document.spec.ts` builds the document, writes it when `LUNA_WRITE_OPENAPI=1` (set by
  the `openapi` target in the gateway's `project.json`), and otherwise compares the committed
  file with the serialised document and throws a message naming the regenerate command. It
  compares raw strings. On a Windows checkout with `core.autocrlf=true` the committed file is
  CRLF and the spec reports a stale file that git considers current.
- `pr.yml`'s `verify` job runs plain node tests (`node --test tools/deploy/units.test.mjs
  tools/release/release-notes.test.mjs` and others). It does not run `helm` today. The
  composite action `.github/actions/deploy-unit` runs `provision-release.sh --check
  --render-only` on a GitHub hosted runner with no setup step, which renders the chart with
  the runner image's own `helm`.

### Target state

1. **Every key is described.** Every key of the seven schemas (and of the spread pieces)
   carries `.description('...')` and `.meta({ secret, group, example, slotDerived })`:
   - `secret`: `true` for keys a log or a document must never print (keys, passwords, the
     Anthropic and Google secrets, the SMTP password, the database URLs).
   - `group`: where a deployment sets it. `secret` (the app Secret), `db` (a database URL in
     the app Secret, derived by `provision-release.sh`), `operator` (the operator Secret),
     `configmap`, `chart` (a literal the chart computes), or `default` (no deployment sets it;
     the default is the answer). The value matches what `_env.tpl` does today.
   - `example`: a value that passes validation and names no real deployment (no owner domain,
     no real address).
   - `slotDerived`: `true` exactly for the keys `server-slot.sh` derives per slot.
   `required` is not metadata: the manifest derives it from `flags.presence`, from the `or`
   peers, and from `whens` (written out as a sentence, for `APP_BASE_URL` when
   `GOOGLE_CLIENT_ID` is set and the legal keys when `TERMS_ACCEPTANCE_REQUIRED` is true).
2. **One manifest.** A target on the server umbrella project (`velista-server`, today
   `luna-shopper-backend`), `env-manifest`, writes `apps/velista-server/docs/env-manifest.json`:
   one object keyed by service (`gateway`, `realtime`, `auth`, `core`, `catalog`,
   `harvester`, `assistant`, `transcriber`), each a sorted list of keys with `description`,
   `type`, `default`, `required`, `requiredWhen`, `alternatives` (the `or` peers), `allowed`
   (from `valid`), `secret`, `group`, `example`, `slotDerived`. The transcriber's entry is
   written by hand in a small module beside the generator, because Python has no Joi; a node
   test asserts its key set equals the keys `app.py` reads (the quoted names in
   `Settings.from_env`, and `PORT` and `LOG_LEVEL` at the bottom of the file).
3. **Stale check.** A spec (`env-manifest.spec.ts` in the umbrella's tools, run by a
   `test` target that `nx affected` reaches) builds the manifest and compares it with the
   committed file after replacing `\r\n` with `\n` on both sides. A difference throws a
   message naming `npx nx run velista-server:env-manifest`. The generator writes LF.
4. **Generated `.env.example` files.** `tools/env/generate-env-examples.mjs` writes the
   seven `.env.example` files of the Nest services and the shared
   `.env.luna-shopper-backend.example` (renamed by docs `0003`) from the manifest: every key,
   its description as a comment, its `example` or its default, secrets left empty. A
   `--check` mode fails on a stale file, and runs in `pr.yml`'s `verify` job.
5. **Generated Compose environment** (only when k8s `0020` has merged). The same tool
   writes the environment files or blocks of the Compose path in the layout k8s `0020`
   defines, and its `.env.example`, with the same `--check`.
6. **The chart test.** `tools/env/chart-env.test.mjs` (plain `node --test`, run in `verify`
   beside `units.test.mjs`) renders the velista chart with `helm template` and the values the
   test supplies (the chart's `values.yaml`, with every switch of a service turned on and
   the operator values set), collects the `env` names of every backend container, and
   asserts per service:
   - every name the chart gives is a manifest key of that service, or one of its
     `alternatives`, or on an allow list in the test (each entry with a reason);
   - every manifest key whose `group` is not `default` is given, one of each `or` group;
   - every key whose `group` is `default` is absent.
   The rename `HARVESTER_ACTOR_ID` to `SERVICE_ACTOR_IDS` is the one expected mapping and is
   stated in the test. The transcriber's template is checked the same way.
7. **The slot test.** `tools/env/slot-derived-keys.test.mjs` reads the `DERIVED_KEYS` and
   `TELEMETRY_DERIVED` declarations out of `server-slot.sh` and asserts that, per service, the
   set equals the manifest keys with `slotDerived: true`. The script stays Bash and stays the
   writer.
8. **The reference page.** `tools/env/generate-configuration-doc.mjs` writes
   `docs/deploy/configuration.md`: one section per service, one table row per key with the
   description, the default, whether it is required (and when), whether it is secret, and the
   group. Secrets show no example. `--check` fails on a stale page. The deploy pages of k8s
   `0020` and `0021` link to it.

### Scope

In: the seven schema files and the spread pieces (descriptions and metadata only), a
generator module and its target, `apps/velista-server/docs/env-manifest.json` (new),
`tools/env/` (new), the eight `.env.example` files (seven services and the shared one, now generated), `docs/deploy/configuration.md`
(new), `.github/workflows/pr.yml` (new steps in `verify`).

Out: any change to which keys a service accepts or to a default (a change found necessary is
reported, not made), `_env.tpl` and `configmap.yaml.tpl` (stay hand written, only tested),
`server-slot.sh` (only tested), the Python transcriber's code, the admin and client apps'
build time variables (velista `0178`).

### Constraints

- The schema stays the authority. The generator reads `schema.describe()` and nothing
  else from a service; it never imports `app.module.ts`, so building the manifest needs no
  environment and starts no Nest.
- `.description()` holds prose a self hoster reads. Comments that explain the code stay
  comments.
- The manifest and every generated file are written with LF and sorted keys, so a diff
  means a real change.
- No new npm dependency. `helm` comes from the runner image (see D5).
- A metadata value that disagrees with the chart today is a finding: report it in the pull
  request description, and set the metadata to what the chart does.

### Action boundaries

Stop and ask before changing a default, making a key required or optional, renaming a key,
adding a key to `_env.tpl` or removing one from it, editing `server-slot.sh`, or adding a
GitHub Action or a package. Each of those changes a deployment, and this plan only
describes them.

### Progress evidence

- `npx nx run velista-server:env-manifest` writes the file; a second run leaves `git status`
  clean.
- The stale spec fails after a one word change to any `.description()` and passes after
  regeneration, on Windows and on Linux.
- `node tools/env/generate-env-examples.mjs --check` and
  `node tools/env/generate-configuration-doc.mjs --check` pass in `verify`.
- `node --test tools/env/chart-env.test.mjs tools/env/slot-derived-keys.test.mjs` passes in
  `verify`; removing one key from `_env.tpl` makes it fail with the service and the key
  named; adding an unknown key fails the same way.
- `npx nx run-many -t test -p <the seven services>` passes (the schemas still validate the
  same environments).
- The pull request description lists every finding of the constraints above.

## Decisions taken in this plan

- **D1. The Joi schemas, not a YAML manifest, are the source.** A hand written manifest is a
  sixth copy, and it drifts from the code that refuses the values, which is the drift this
  plan removes. The schemas already exist, already run at every boot and already decide.
  Rejected: a YAML file from which the schemas are generated, which inverts the authority
  and puts a code generation step in front of every service.
- **D2. One file for all services**, keyed by service, as `openapi.json` is one document. A
  reader who deploys the server wants the whole surface at once, and the chart test reads
  it whole.
- **D3. Generate the examples and the page; test the chart and the slot script.** The
  examples and the page are prose about the keys, and generating them costs nothing. The
  chart is templated logic per role and per Secret, and `server-slot.sh` computes values; a
  generator for either would be a second templating language. A test catches the drift and
  leaves both readable.
- **D4. `group: default` is a stated choice.** Without it the chart test could not tell a key
  the chart forgot from a key the chart leaves to its default on purpose, and the second kind
  exists today.
- **D5. `helm` from the runner image.** The staging pipeline already renders the chart on a
  GitHub hosted runner with no setup step (`deploy-unit`, `provision-release.sh --check
  --render-only`), so `ubuntu-latest` carries `helm`. The test fails with a clear message in
  CI when `helm` is missing and skips with a printed reason on a developer machine without
  it. Rejected: `azure/setup-helm`, which is one more action to pin and to keep current.
- **D6. The transcriber is in the manifest, by hand, under a test.** A self hoster deploys
  it too. A Python schema library for one service of eight is not worth a second toolchain.

## Owner decisions

- **Where the page lives.** Recommendation: `docs/deploy/configuration.md`, beside the deploy
  pages of k8s `0020` and `0021`. Alternative: `apps/velista-server/docs/configuration.md`
  beside the manifest.
- **`NODE_ENV`.** No schema declares it and every image sets it. Recommendation: declare it
  in the platform library with `group: default` (the image's `ENV` line is its value and no
  deployment sets it), so the manifest is complete. Alternative: leave it out of the
  manifest and allow list it in the chart test.
- **Findings.** Each mismatch between the metadata and the chart found during the build is
  reported for the owner to settle in a later change.

## Owner steps outside the code

None.
