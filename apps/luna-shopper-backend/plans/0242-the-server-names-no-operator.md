# 0242: The server names no operator

> Velista is software that anyone can deploy, and the owner's deployment is one of many
> (owner decision of 2026-11-02). The server and the back office still carry the owner's
> names in a handful of places: a harvester User-Agent that sends every crawl in the owner's
> name and with the owner's mailbox, two JSON Schema ids under the owner's portfolio domain,
> the owner's username in the back office's demo data, a back office build that defaults to
> the owner's API, and comments that explain the code in terms of the owner's hosts. A self
> hoster who deploys the server as it ships would crawl supermarkets with the owner's
> contact address in every request.
>
> This plan removes each of them, replaces it with a value the deployment supplies or a
> neutral one, and adds a test that fails when one comes back. The model is backend `0231`:
> facts about the operator come from the deployment, and the code ships with none.
>
> Paths below are today's. Docs `0003` moves `apps/luna-shopper-backend`,
> `apps/luna-shopper-admin`, `libs/luna-shopper` and `libs/luna-shopper-admin` to their
> `velista-server` and `velista-admin` homes and this plans directory to
> `apps/velista-server/plans`. Docs `0003` also renames the product strings (`Luna Shopper`
> to `Velista`, the OpenAPI title, `DEFAULT_LEGAL_APP_NAME`); this plan does not repeat that
> work and only deals with what names the **operator**.
>
> Prerequisite reading: backend `0038` section 6.3 (the honest User-Agent), backend `0083`
> (a row per chain), backend `0086` section 6.1 (the harvest document registry), backend
> `0231` sections 2 and 5 (the operator's values), admin `0001` section 7 (the gateway URL
> of the back office), velista `0178` (one client image for every deployment), and in the
> code `apps/luna-shopper-backend/harvester/src/app/config/app-config.ts`,
> `libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-registry.ts`,
> `libs/luna-shopper/contracts/src/schemas/validator.ts` and
> `apps/luna-shopper-admin/webpack.prod.config.ts`.
>
> **Build order.** Step 2 of the series: after docs `0003`, in parallel with backend `0240`,
> `0241`, `0243`, docs `0004`, k8s `0020` and `0021`. Target state 4 (the back office reads
> its gateway URL at runtime) uses the mechanism velista `0178` defines and is built after
> velista `0178` merges; if it has not, the builder leaves item 4 out and says so. Backend
> `0241` regenerates the environment manifest after this plan changes the harvester key, or
> this plan regenerates it if `0241` merged first. k8s `0021` owns the image lines and the
> structure of `k8s/helm/velista/values.yaml`; this plan changes three lines of that chart
> and nothing else in it. The series order, as every plan of the series states it: docs
> `0003` first, alone, after the pull request gate; then in parallel docs `0004`, backend
> `0240` to `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242` after velista
> `0178` for the admin mechanism, k8s `0020` after backend `0241` for the generated files);
> k8s `0019` after docs `0003` and backend `0240`, in the same rollup to `main` as `0240`;
> docs `0005` last, with docs `0006` read from the start.

## Brief for the agent

### Objective

Remove every string in the server, the back office and the velista chart's defaults that
names the owner or the owner's deployment: make the harvester User-Agent a value the
deployment must supply before it fetches, move the harvest document schema ids to a URN,
give the back office demo data neutral names, take the back office's gateway URL from the
deployment at runtime, rewrite the comments, and add a test that fails on any of the owner's
names in those sources.

### Context

Every statement below was read on 2026-11-03.

- **The User-Agent.** `harvester/src/app/config/app-config.ts:74` declares
  `HARVEST_USER_AGENT: Joi.string().default('LunaShopper/0.1 (+https://velista.app; personal
  price comparison; contact@velista.app)')`. `k8s/helm/velista/values.yaml:398` repeats it as
  `lunaShopperBackend.harvester.userAgent`, and `configmap.yaml.tpl` renders
  `HARVEST_USER_AGENT: {{ $harvest.userAgent | default "" | quote }}`. Every runner passes
  `settings.userAgent` to its client (`carrefour-catalog.runner.ts`, `deza-catalog.runner.ts`,
  `eljamon-catalog.runner.ts`, and the others), and `osm-places` sends it to Overpass and
  Nominatim. The same string is in `harvester/.env.example:51`, in the `capture-fixtures`
  tools of `mercadona`, `deza`, `eljamon` and `osm-places` (and a `LunaShopperBot/1.0`
  variant with `hola@velista.app` in `carrefour` and `lidl`), in the `live-source.spec.ts`
  and client specs of several adapters, and in three probes under
  `harvester/docs/research/eljamon/`.
- The harvester reads no `LEGAL_*` key. Only the gateway (`legal-config.ts`, all eight
  operator keys) and auth (`LEGAL_TERMS_REVISION` only) do, and `_env.tpl` mounts the
  operator Secret for those two roles alone.
- `HARVEST_ENABLED` is true in `values.staging.yaml` and `values.production.yaml`, and it
  gates every run mode, store discovery over OpenStreetMap included.
- **The schema ids.** `HARVEST_DOCUMENT_1_SCHEMA_ID = 'https://ichirokuxvi.com/schemas/harvest-document-1.json'`
  (`harvest-document-1.schema.ts:30`) and the version 2 peer (`harvest-document-2.schema.ts:36`).
  What reads them: `HARVEST_DOCUMENT_SCHEMA_IDS` in `harvest-document-registry.ts`, which
  maps a document's `schema_version` to the id, and the ajv instance of `validator.ts`, which
  registers every schema by `$id` (`ajv.addSchema(allSchemas)`) and looks it up
  (`ajv.getSchema(id)`). Nothing else: the ids are not in `gateway/docs/openapi.json`, no
  harvest document carries a `$schema` field, the leaflet CLI
  (`libs/luna-shopper/tools/leaflet/cli`) writes none, and the admin upload sends the
  document as it is. Every other schema in `contracts` uses `schemaId(path)`, which builds
  `luna://<path>` (`schemas/builders.ts:28`).
- **The demo data.** `libs/luna-shopper-admin/data-access/src/lib/dashboard/dashboard-seed.ts`
  names the operator `ichiroku` / `Ichiroku` (line 102 and eight audit entries), and
  `libs/luna-shopper-admin/feature-people/src/lib/people-seed.ts:454-456` holds
  `admin-ichiroku`. Specs that read them: `feature-people/src/lib/admins.spec.ts`,
  `data-access/src/lib/directory/directory-api.spec.ts`,
  `feature-dashboard/src/lib/dashboard-view.spec.ts`,
  `feature-harvest/src/lib/decisions-file.spec.ts`.
- **The back office's API.** `apps/luna-shopper-admin/src/environments/environment.ts` and
  `environment.prod.ts` read `process.env['LUNA_GATEWAY_URL']`, replaced at compile time. The
  owner's host is the default in `apps/luna-shopper-admin/webpack.prod.config.ts:15`
  (`DEFAULT_LUNA_GATEWAY_URL = 'https://api.velista.app'`), not in the environment files. The
  comment there calls this the second image in the workspace that is not environment
  agnostic. The back office polls and opens no socket.
- **Comments in the owner's terms.** `assistant/src/app/assistant/assistant.service.ts:1295`
  ("`velista.app` calling `api.velista.app` is cross origin"),
  `gateway/src/app/client-version/min-client-version.guard.ts:71` ("a browser on velista.app"),
  `gateway/src/app/config/app-config.ts:193` (`https://velista.app/{locale}`), the comments in
  `auth/.env.example:68` and `gateway/.env.example:46`, `values.yaml:14` ("velista.app in
  production, staging.velista.app in staging") and
  `templates/luna-shopper-backend/deployment.yaml.tpl:61-62` (the staging hosts of an old
  incident).
- **Specs with the owner's domains as sample values**: `auth/src/app/config/app-config.spec.ts`,
  `admin-config.spec.ts`, `retention/retention-config.spec.ts` and `mail/mail.service.spec.ts`
  (`no-reply@ichirokuxvi.com`, `https://ichirokuxvi.com/verify-email`), and a few gateway and
  assistant specs.
- **The product name in mail.** `auth/src/app/mail/mail.service.ts` writes the product name
  into every subject and two bodies (lines 22 to 143). Docs `0003` turns `Luna Shopper` into
  `Velista` there. A deployment that publishes under another name (`LEGAL_APP_NAME`, backend
  `0231`) still sends mail that says Velista.
- `values.yaml` has no `corsOrigins` default (the ConfigMap renders an empty string), so no
  CORS example names the owner there; the owner's origins are in the two environment values
  files.
- The Compose overlay defaults `LUNA_IMAGE_PREFIX` to `ghcr.io/ichirokuxvi/nx-portfolio`
  (`compose.apps.yml`, six services) and `gate.sh:17` does the same for `E2E_IMAGE_PREFIX`.
  Docs `0003` renames the key; the registry path is docs `0005`'s owner decision.

### Target state

1. **No default User-Agent.** `HARVEST_USER_AGENT` is `Joi.string().allow('').default('')`,
   and required non empty when `HARVEST_ENABLED` is true. A non empty value must contain a
   contact: an `http://` or `https://` URL or an email address. The refusal names the key and
   says what a value must hold. `values.yaml` sets `userAgent: ''` with a comment that names
   the rule and gives a neutral example (`ExampleShop/1.0 (+https://example.org;
   ops@example.org)`). `values.staging.yaml` and `values.production.yaml` set the owner's
   value (the string of today, renamed by docs `0003`), because both clusters fetch.
2. **The tools and specs carry no contact.** Each `capture-fixtures` tool reads
   `HARVEST_USER_AGENT` from its environment and refuses to run without it. Each spec that
   needs a User-Agent uses the neutral example. The three research probes read the variable
   or are deleted (owner decision).
3. **URN schema ids.** `HARVEST_DOCUMENT_1_SCHEMA_ID = 'urn:velista:schemas:harvest-document:1'`
   and `HARVEST_DOCUMENT_2_SCHEMA_ID = 'urn:velista:schemas:harvest-document:2'`. The registry,
   the validator and the harvest document specs pass unchanged.
4. **The back office takes its API at runtime** (after velista `0178`). The admin image
   reads its gateway URL from the deployment by the mechanism velista `0178` defines for the
   client, and `DEFAULT_VELISTA_GATEWAY_URL` (today `DEFAULT_LUNA_GATEWAY_URL`, renamed by
   docs `0003`) with the owner's host is gone. One admin image serves every deployment; the
   CI lines that build it per environment go as `0178` removes the client's: the gateway
   key `VELISTA_GATEWAY_URL` leaves both `BUILD_ENV_*` lines of `k8s/units/velista/unit.env`
   in this plan, and `tools/deploy/units.mjs` accepts the empty lines (velista `0178`
   target state 9).
5. **Neutral demo data.** The seeds name an operator `operator` / `Operator` (or another name
   that is nobody's), and the four specs follow.
6. **Comments name roles.** The listed comments say "the client's origin" and "the API
   origin" (or "the staging origin of an earlier deployment" for the incident note) and no
   host. Sample values in specs use `example.org` and `example.com` (RFC 2606).
7. **Mail names the deployment** (owner decision, recommended). Auth reads `LEGAL_APP_NAME`
   from the operator Secret, as the gateway does (`_env.tpl` adds the key to auth's
   `operatorEnv` list), falls back to `DEFAULT_LEGAL_APP_NAME`, and the mail subjects and
   bodies interpolate it.
8. **A test keeps it so.** `tools/repo/operator-strings.test.mjs` (plain `node --test`, run
   in `pr.yml`'s `verify` job) scans the server's apps and libraries, the back office's app
   and libraries, `k8s/helm/velista` and the Compose overlay directory for `ichiroku`,
   `ichirokuxvi`, `velista.app` and `danieliyo`, case insensitive, and fails with file and
   line on a hit. It skips `plans/` directories and captured fixture files. Its allow list
   is short and each entry carries its reason: `k8s/helm/velista/values.staging.yaml` and
   `values.production.yaml`.
9. **The Compose default registry** is the placeholder docs `0005` decides, written where docs
   `0003` renamed the key. Until docs `0005`'s decision exists, the overlay keeps today's
   default and the test allow lists that one line with a reason that names docs `0005`.

### Scope

In: `harvester/src/app/config/app-config.ts` and a new spec beside it, the adapters' `tools/capture-fixtures.ts`
and specs named above, `harvester/docs/research/eljamon/*.mjs`, the two harvest document
schema files, the admin seeds and their specs, `apps/luna-shopper-admin` (environment files,
webpack configs, the runtime read of `0178`), the listed comments, `auth` (the app name in
mail) and `_env.tpl` (one key in auth's operator list), `k8s/helm/velista/values.yaml` lines
14 and 398, the two environment values files (the `userAgent` line),
`templates/luna-shopper-backend/deployment.yaml.tpl` (the comment), `tools/repo/` (new),
`pr.yml`, and, with target state 4, the gateway key in `BUILD_ENV_*` of
`k8s/units/velista/unit.env` and the empty lines in `tools/deploy/units.mjs` (if velista
`0178` left them to this plan).

Out: the product rename (docs `0003`), the client's hosts, `assetlinks.json` and
`capacitor.config.ts` (velista `0178`), the image lines of the chart (k8s `0021`, docs
`0005`), the e2e gate's hosts in `k8s/e2e` (k8s `0020` and the gate's own configuration),
plans and committed research notes in Markdown, `luna://` schema ids (docs `0003` D13
renames that prefix to `velista://`).

### Constraints

- A harvester with `HARVEST_ENABLED=false` boots with no User-Agent, as today. Backend
  `0026` holds: only the switch that turns fetching on makes the key required.
- No change to the harvest document format, its `schema_version`, or its validation rules.
- The operator Secret is optional per key today; adding `LEGAL_APP_NAME` to auth must not
  make a deployment without it fail to start. `provision-release.sh` lists every operator
  key in `OPTIONAL_EMPTY_KEYS` (through `OPERATOR_KEYS`, lines 139 and 194); keep it so.
- The test reads files with plain `node:fs`; no new dependency.

### Action boundaries

Stop and ask before: changing a values file beyond the `userAgent` line, touching the
operator Secret or any cluster, deleting the research probes, choosing the registry
placeholder, or changing any mail text beyond the name.

### Progress evidence

- A new harvester `src/app/config/app-config.spec.ts` (none exists today): boots with `HARVEST_ENABLED=false` and no User-Agent;
  refuses `HARVEST_ENABLED=true` with an empty one and with one that holds no contact, naming
  `HARVEST_USER_AGENT`; accepts the neutral example.
- `npx nx test velista-server/contracts` (today `luna-shopper/contracts`) passes, including the harvest
  document specs, with the URN ids.
- `npx nx test` and `npx nx build` of the back office pass; the built bundle contains no
  `velista.app` (`grep -r velista.app dist/apps/<admin>` is empty).
- `npx nx test velista-server-auth` covers a mail subject with `LEGAL_APP_NAME` set and unset.
- `bash k8s/bootstrap/provision-release.sh --check --unit velista --env staging --render-only`
  and the same for production pass, and the rendered harvester ConfigMap holds the owner's
  User-Agent in both.
- `node --test tools/repo/operator-strings.test.mjs` passes, and fails when `velista.app` is
  added to any scanned file.

## Decisions taken in this plan

- **D1. The User-Agent is required to fetch, not built from the legal keys.** Building it
  from `LEGAL_APP_NAME` and `LEGAL_CONTACT_EMAIL` would mount the operator Secret into the
  harvester and still produce a User-Agent with no contact for an operator who set no email,
  which is exactly the crawl a chain's operators complain about. A required key with a
  contact check refuses that crawl at boot. Rejected: a built default, and a neutral default
  (a crawl in the name of `example.org` is worse than none).
- **D2. A URN for the schema ids.** The id is a key inside one ajv instance and a name a
  producer may quote. A URL under any domain names whoever owns it, and a page that answers
  at it would be one more thing a deployment must host. JSON Schema accepts any URI as an
  `$id`. `velista` is not a registered URN namespace (RFC 8141); the form is informal, and
  that is acceptable for an identifier nothing resolves. Rejected: a path under the future
  repository's pages, which ties the format to a hosting choice; `luna://` style, which docs
  `0003` may rename and which is the internal broker namespace, not a public file format.
- **D3. The back office uses the client's runtime mechanism.** Two mechanisms for two apps
  with the same need would be one too many. This plan follows velista `0178` and builds after
  it, so `0178` stays one client's change and this plan carries the admin's.
- **D4. Values files are the owner's deployment.** `values.staging.yaml` and
  `values.production.yaml` describe the owner's two clusters, and a deployment must name its
  own hosts. They are allowed until k8s backlog `0003` moves them out of the public
  repository, which stays the owner's call (docs `0005`).
- **D5. Product name versus operator name.** The product is Velista and may be named in code.
  What a deployment calls itself is the operator's (`LEGAL_APP_NAME`), so text a person
  receives (mail) uses the deployment's name.

## Owner decisions

- **The URN form.** Recommendation: `urn:velista:schemas:harvest-document:<version>`.
  Alternative: `urn:velista:harvest-document:<version>` (shorter, no `schemas` segment).
- **The User-Agent policy.** Recommendation: required with a contact when fetching (D1).
  Alternative: required, with no contact check.
- **Mail names the deployment** (target state 7). Recommendation: yes. Alternative: mail keeps
  the product name, and target state 7 is dropped.
- **The research probes** under `harvester/docs/research/eljamon/`. Recommendation: keep them,
  reading `HARVEST_USER_AGENT`. Alternative: delete them; their findings are in the plans.

## Owner steps outside the code

- Confirm the User-Agent value for the two clusters (the owner's contact, as today) before the
  first deploy of this plan; the harvester refuses to boot with `HARVEST_ENABLED` and no value.
