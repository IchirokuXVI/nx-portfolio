# 0218: the owner hears when a run fails

> Today a failed run, a refused schedule slot and a chain whose schedules stopped are visible only
> to a person who opens the back office. Plan `0206` section 13 said so: "No notice to anybody."
> This plan sends the owner one email for each of those events. The harvester decides an alert in
> the same transaction that writes the outcome, keeps it in an outbox table with a unique key, and
> a worker sends it through the SMTP relay that auth already uses (Mailjet on port 2525). A restart
> thus neither loses an alert nor sends it two times. A deploy stop, a person's abort and a busy
> chain send nothing. Staging and every luna slot send nothing unless somebody sets an address.
>
> Prerequisite reading: `0206` (schedules, the slot outcomes, the three failure rule, the deploy
> stop), `0215` (a run stops when a chain keeps refusing it, written beside this plan),
> `0038` sections 6.6 and 8.1 (the finalizer and the switches), `run-executor.service.ts`,
> `harvest-schedule.worker.ts`, `harvest-schedule.store.ts`, `harvest-run.store.ts`,
> `auth/src/app/mail/mail.module.ts` and `k8s/bootstrap/provision-release.sh`.

## Brief for the agent

### Objective

Add a `harvest_alerts` outbox to the harvester. Write one row when a run ends `FAILED`, when a
schedule slot ends `REFUSED`, and when a failed run makes a chain's schedules stop. Send each row
as an email to the address in `HARVEST_ALERT_EMAIL`, through the SMTP settings the cluster already
holds. Add one admin route that queues a test alert. Sections 1 to 9 state the rules.

### Context

- `RunExecutor.execute` (`harvester/src/app/harvest/run-executor.service.ts:327`) finalizes a run in
  two branches. The `try` branch (:545 to :559) reads the verdict from the failure ratio and calls
  `store.finish`. The `catch` branch (:560 to :576) writes `FAILED`, or `ABORTED` when the signal
  was aborted, with the message of the error. Both then call `recordVerdict` (:591), which skips an
  `ABORTED` run and otherwise calls `SupermarketSourceService.recordRunFinished`.
- `recordRunFinished` (`supermarket-source.service.ts:229`) sets `consecutiveFailures` to 0 on a
  success and adds 1 on a failure. Only a `FAILED` run reaches the failure half.
- `SOURCE_FAILING_AFTER = 3` (`harvest-run.service.ts:88`). `startScheduled` (:326) answers
  `SKIPPED_FAILING` while the counter is 3 or more (:349).
- A deploy stop: `onApplicationShutdown` (`run-executor.service.ts:638`) aborts each run in flight
  and remembers it in `stoppedByShutdown`, and the run ends `ABORTED` with
  `SHUTDOWN_STOPPED_RUN` (:42) as its error. A person's abort sets `abortRequestedAt`
  (`harvest-run.store.ts:501`) and also ends `ABORTED`.
- `HarvestRunStore.finish` (`harvest-run.store.ts:513`) is one `UPDATE` with no transaction. The
  stale reaper (:537) calls it with `STALE` and does not call `recordRunFinished`.
- The schedule worker decides a slot in `decide` (`harvest-schedule.worker.ts:139`) and a retry in
  `retryInterrupted` (:171). Both write through `HarvestScheduleStore.recordOutcome`
  (`harvest-schedule.store.ts:136`), one `UPDATE`. An error inside `start` becomes `REFUSED` (:202 to :208).
- `claimDue` (`harvest-schedule.store.ts:97`) selects the row with `SELECT *` and returns it with
  the slot. The returned `schedule` thus still carries the previous `lastOutcome` and
  `lastOutcomeNote`.
- The outcomes are `STARTED`, `SKIPPED_LATE`, `SKIPPED_FAILING`, `REFUSED` and `SKIPPED_BUSY`
  (`libs/luna-shopper/contracts/src/lib/enums/harvest.enums.ts:127`). The triggers are `MANUAL`,
  `SCHEDULED` and `SYSTEM` (:100). `SYSTEM` is the postal code queue, which keeps its own attempts
  and its own `FAILED` row (`postal-code-discovery.worker.ts:295`).
- A chain refusal before plan `0215`: `DiaStoppedError` (`libs/luna-shopper/dia/src/lib/dia.client.ts:83`)
  and `CarrefourBlockedError` (`libs/luna-shopper/carrefour/src/lib/errors.ts:36`), thrown by the
  runners after they flush (`dia-catalog.runner.ts:96`, `carrefour-catalog.runner.ts:135`).
  **This plan lands after plan `0215`.** That plan deletes both classes, moves all six clients
  onto one `SourceBlockedError`, makes the runners return after a stop instead of throwing, and
  ends a stopped run `FAILED` with `stopReason: SOURCE_BLOCKED` on `harvest_runs`. A stop thus
  does not always reach the `catch` branch, and the caught error is not the signal. The run's
  `stopReason` is.
- **The only mailer is in auth.** `MailModule` (`auth/src/app/mail/mail.module.ts:17`) builds a
  nodemailer transport from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`, with
  `secure` only on port 465. `nodemailer` is a root dependency (`package.json:57`).
- **No operator has an email address.** `admin_users` has none, by design
  (`auth/src/app/entities/admin-user.entity.ts:16`).
- No other channel exists. The harvester emits no NATS event (its only client is
  `CATALOG_NATS_CLIENT`, `harvest.module.ts:66`). The realtime service fans out to zone rooms of
  shoppers (`realtime/src/app/socket/realtime.gateway.ts:268`), not to operators. No webhook is
  configured anywhere in the backend or the chart.
- Both clusters relay through Mailjet: `smtpHost: in-v3.mailjet.com`, `smtpPort: 2525`
  (`k8s/helm/values.production.yaml:122` to :127, `values.staging.yaml:82` to :91). The VPS blocks
  25, 465 and 587, and a blocked port hangs rather than fails (`values.yaml:320`).
- The ConfigMap holds `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM`
  (`configmap.yaml.tpl:62` to :65) and `ENVIRONMENT_NAME` (:40). The Secret holds `SMTP_PASS`.
  The harvester block of `_env.tpl` (:208 to :241) receives none of them today.
- `provision-release.sh` lists the keys that may be empty in `OPTIONAL_EMPTY_KEYS` (:141), prompts
  for them on a terminal (:584 to :603) and writes them into the app Secret (:636 to :648).
  `--check` fails on a `secretKeyRef` whose key is absent from the cluster.
- Luna slots: `luna-slot.sh` writes the harvester `.env` at :1465 to :1523. `DERIVED_KEYS[harvester]`
  is `PORT HARVESTER_DB_URL` (:214). Each slot runs Mailpit (`compose.yml:288`) on a slot port that
  auth already reads (`luna-slot.sh:1351`).
- The back office shows a run at `/harvest/runs/:id`
  (`libs/luna-shopper-admin/feature-harvest/src/lib/routes.spec.ts:105`). Its host is
  `admin.velista.app` in production and `admin.staging.velista.app` in staging.
- The newest harvester migration on `dev` today is `1759400000000-HarvestSchedules.ts`.

### Target state

Every acceptance criterion holds, the specs of the Tests section pass, and `openapi.json` and the
admin wire types are regenerated for the one new route.

### Scope

- Work only in:
  - `apps/luna-shopper-backend/harvester/src/app/`: a new `harvest/alerts/` folder (rules, message,
    store, mailer, worker), a new entity and migration, `harvest-run.store.ts`,
    `run-executor.service.ts`, `harvest-schedule.store.ts`, `harvest-schedule.worker.ts`,
    `harvest.controller.ts`, `harvest.module.ts`, `config/app-config.ts`, `.env.example`.
  - `apps/luna-shopper-backend/gateway/src/app/harvest/` (one route and its DTO).
  - `libs/luna-shopper/contracts` (one pattern, one request, one view, their schemas).
  - `k8s/helm/templates/luna-shopper-backend/_env.tpl`, `configmap.yaml.tpl`, `k8s/helm/values.yaml`,
    `values.production.yaml`, `values.staging.yaml`, `k8s/helm/luna-shopper-backend-secrets.md`.
  - `k8s/bootstrap/provision-release.sh` (one optional key).
  - `k8s/e2e/luna-shopper-backend/luna-slot.sh` (the harvester `.env` block and its derived keys).
  - The harvester section of `CLAUDE.md`, one paragraph.
  - Their specs, and the generated files.
- Do NOT touch: auth and its `MailModule`, the runners, the adapter libraries, the sink, catalog,
  the postal code worker, the stale reaper's rule, the slot rules of plan `0206`, the counter rule
  of `recordRunFinished`, `apps/luna-shopper-admin`, the deploy workflows and deploy scripts.

### Constraints

- An alert row is written in the **same transaction** as the outcome it reports: the run's
  `finish`, or the schedule's `recordOutcome`. No alert exists for an outcome that did not commit.
- Each row has a unique `dedupeKey`, and the insert is `ON CONFLICT DO NOTHING`.
- The worker claims rows with `FOR UPDATE SKIP LOCKED`, as `claimDue` does. Two harvester
  processes never send one row two times in the normal path.
- Use `nodemailer` directly. Add no dependency, and do not import `@nestjs-modules/mailer` into the
  harvester. Copy the transport options of `auth/src/app/mail/mail.module.ts:22` to :27, and add a
  connection, greeting and socket timeout of 15 seconds each.
- The rules (sections 2 and 3) and the message (section 6) are pure functions with no Nest and no
  database, tested without a clock or a network.
- The worker is a `setInterval` with `unref`, like the schedule worker
  (`harvest-schedule.worker.ts:74`).
- No setting per chain. The recipient is one setting for the whole deployment.
- No run status, no slot outcome and no counter changes its meaning.
- Take a migration timestamp later than the newest one on `dev` at build time. Plans `0215`,
  `0216`, `0217`, `0219`, `0220` and `0221` each add a harvester migration too.
- No dash as punctuation in a comment, a log line or a mail. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the migration file and the generators.
- Stop and ask before you run `provision-release.sh` against any cluster, or put an address in a
  Secret.
- Stop and ask before you send a mail through Mailjet. Send to Mailpit on a slot only.
- Stop and ask if plan `0215` is not on `dev` when you start. This plan builds on its
  `stopReason`.
- Stop and ask if plan `0215`'s stop does not end the run `FAILED` with `stopReason: SOURCE_BLOCKED`.
- Stop and ask if an alert cannot be written in the transaction of its outcome without changing a
  public method of a store beyond an added optional argument.

### Progress evidence

Report after each of these, with the spec output:

1. The rules and the message, with their specs.
2. The entity, the migration, the store, and the two transactional writes, with an integration
   spec on real Postgres.
3. The mailer and the worker, with a spec that sends to a fake transport and one slot run that
   lands a mail in Mailpit.
4. The test route, the regenerated `openapi.json` and wire types, and the chart and slot changes
   (`helm template` output for the harvester container env).

## 1. What is being built

| Piece                                              | Where                                       |
| -------------------------------------------------- | ------------------------------------------- |
| `harvest_alerts`, the outbox                       | a harvester entity and migration            |
| Which outcome makes an alert                       | `alerts/harvest-alert.rules.ts`, pure       |
| The subject and the body, one alert or a digest    | `alerts/harvest-alert.message.ts`, pure     |
| Insert, claim, mark                                | `alerts/harvest-alert.store.ts`             |
| The SMTP transport                                 | `alerts/alert-mailer.ts`                    |
| The worker that sends                              | `alerts/harvest-alert.worker.ts`            |
| The alert in the run's final write                 | `run-executor.service.ts`, `harvest-run.store.ts` |
| The alert in the slot's outcome write              | `harvest-schedule.worker.ts`, `harvest-schedule.store.ts` |
| A test alert                                       | `harvestAlert.sendTest`, one gateway route  |
| `HARVEST_ALERT_EMAIL` and the SMTP keys            | the chart, provisioning, the slot script    |

## 2. Which outcomes send an alert

| Outcome                                                      | Alert            |
| ------------------------------------------------------------ | ---------------- |
| A run of trigger `MANUAL` or `SCHEDULED` ends `FAILED`       | `RUN_FAILED`     |
| The same, and the run ended on a chain refusal (section 2.1) | `RUN_BLOCKED`    |
| A failed run makes the chain's schedules stop (section 2.2)  | on the run alert |
| A schedule slot or a retry ends `REFUSED` (section 2.3)      | `SLOT_REFUSED`   |
| A person asks for a test (section 7)                         | `TEST`           |

**Nothing else sends an alert.** In particular:

- **`ABORTED`, by a person or by a deploy.** A person who stops a run knows. A deploy stop is not
  a failure (plan `0206`, section 7), and the scheduler starts the run again.
- **`SKIPPED_BUSY`.** A run of the chain is in the way, which is ordinary. The postal code queue
  makes this case common for a scheduled store discovery (plan `0206`, review point 6).
- **`SKIPPED_FAILING`.** The stop itself was the alert (section 2.2). One mail for each skipped
  slot after it repeats what the owner already knows.
- **`SKIPPED_LATE`.** The pod was down past half the gap. The next slot runs.
- **`STALE`.** The reaper cannot tell a killed pod from a deploy that ran past 30 seconds, and
  the scheduler retries a stale scheduled run. Owner question 5.
- **A `SYSTEM` run that fails.** The postal code queue retries a code and leaves it `FAILED` for a
  person after its attempts. Owner question 4.
- **`COMPLETED` with failed items under the ratio.** The run did its job.

### 2.1 A run that a chain refused

`RUN_BLOCKED` is a `RUN_FAILED` whose cause was a chain that kept refusing requests. The mail
says so in its subject, because the action differs: wait and look at the chain, do not start the
run again at once.

A run is a chain refusal when the executor finishes it with `stopReason:
HarvestRunStopReason.SOURCE_BLOCKED` (plan `0215`, section 6.2). That covers all six storefront
clients, DIA and Carrefour included, because plan `0215` moved them onto one guard. The rule reads
the reason that `finish` writes, never the class of a caught error: after plan `0215` a stopped
runner returns instead of throwing.

A run that fails on the ratio alone, with no stop, is `RUN_FAILED`. Its body carries the failed
and planned counts, which tell the story.

### 2.2 The chain's schedules stop

A `FAILED` run raises `consecutiveFailures` by one. When that raise takes the counter **to exactly**
`SOURCE_FAILING_AFTER`, and the chain has at least one schedule that is on, the run's alert
carries `schedulesStopped` with the number of schedules. Its subject says that the schedules
stopped, and its body says the way out: start the preset by hand, and the first run that completes
lets the schedules fire again (plan `0206`, section 6).

It is part of the run's alert and not a second mail. One run, one message.

It applies to a run of any trigger, also `SYSTEM`, because the stop is about the chain and not
about who started the run. A fourth and later failure does not repeat it.

The executor computes it before `recordVerdict`, from the counter of the source it loaded at the
start of the run. One run of a chain is active at a time (`uq_harvest_run_active`), so no other
run moves that counter meanwhile.

### 2.3 A refused slot, one time until it changes

A `REFUSED` slot alerts **unless the previous outcome of the same schedule was `REFUSED` with the
same note**. `claimDue` returns the row as it was before the claim, so the worker compares without
a second read.

A schedule for each day whose chain row is off thus sends one mail, not one a day. The mail says
that it will not repeat until the schedule starts a run or the reason changes. A retry that is
refused always alerts, because the previous outcome of its schedule is `STARTED`.

## 3. The rules, as code

`harvest-alert.rules.ts` exports two pure functions.

```ts
function runAlertFor(input: {
  run: Pick<HarvestRun, 'id' | 'mode' | 'trigger' | 'supermarketId' | 'presetId' | 'scheduleId'
    | 'startedAt' | 'failed' | 'totalPlanned'>;
  status: HarvestRunStatus;
  error: string | null;
  refusal: boolean;            // stopReason === HarvestRunStopReason.SOURCE_BLOCKED (plan 0215)
  adapterKey: string | null;
  failuresBefore: number | null; // the source's counter before this run's verdict
  enabledSchedules: number;
  finishedAt: Date;
}): HarvestAlertDraft | null;

function slotAlertFor(input: {
  schedule: Pick<HarvestSchedule, 'id' | 'presetId' | 'supermarketId' | 'lastOutcome' | 'lastOutcomeNote'>;
  slot: Date;
  retry: boolean;
  result: ScheduledStart;
  adapterKey: string | null;
  at: Date;
}): HarvestAlertDraft | null;
```

`HarvestAlertDraft` is `{ kind, dedupeKey, supermarketId, runId, scheduleId, payload }`. The payload
holds every fact the message needs, so the worker reads no other table except for the chain name.

The executor reads `enabledSchedules` with one count on `harvest_schedules` by `supermarketId`,
and only when the counter is about to reach 3. The read costs nothing on any other run.

## 4. The table

`harvest_alerts`, extending the harvester's `BaseEntity`:

| Column          | Type          | Notes                                                       |
| --------------- | ------------- | ----------------------------------------------------------- |
| `kind`          | enum          | `RUN_FAILED`, `RUN_BLOCKED`, `SLOT_REFUSED`, `TEST`         |
| `dedupeKey`     | `varchar(200)`| unique                                                      |
| `status`        | enum          | `PENDING`, `SENDING`, `SENT`, `SUPPRESSED`, `GAVE_UP`       |
| `supermarketId` | `uuid`        | nullable, no foreign key                                    |
| `runId`         | `uuid`        | nullable, no foreign key                                    |
| `scheduleId`    | `uuid`        | nullable, no foreign key                                    |
| `payload`       | `jsonb`       | the facts of section 3                                      |
| `attempts`      | `smallint`    | not null, default 0                                         |
| `nextAttemptAt` | `timestamptz` | not null, default `now()`, indexed with `status`            |
| `claimedAt`     | `timestamptz` | set when a worker takes the row                             |
| `sentAt`        | `timestamptz` |                                                             |
| `lastError`     | `text`        | the transport's last answer                                 |

The dedupe keys:

| Kind           | Key                                          |
| -------------- | -------------------------------------------- |
| `RUN_FAILED`, `RUN_BLOCKED` | `run:<runId>`                   |
| `SLOT_REFUSED` | `slot:<scheduleId>:<slot ISO>` and `:retry` for a retry |
| `TEST`         | `test:<uuid>`                                |

The tables of the harvester do not cascade, so the ids carry no foreign key, as
`harvest_runs.presetId` carries none.

### 4.1 The writes in a transaction

- `HarvestRunStore.finish(runId, status, error?, stopReason?, alert?)` gains the optional draft as
  its fifth argument, after the `stopReason` that plan `0215` adds as the fourth. With a draft,
  it runs the `UPDATE` and the insert in one transaction. Without one, it stays as it is, so the
  reaper is untouched.
- `HarvestScheduleStore.recordOutcome(scheduleId, write, alert?)` does the same.
- The insert is `INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING`.

## 5. The worker

`HarvestAlertWorker`, with the lifecycle of the schedule worker: a timer of 30 seconds in
`onModuleInit` with `unref`, cleared in `onModuleDestroy`, a `stopping` flag in
`onApplicationShutdown`, one tick at a time.

A tick:

1. Returns rows in `SENDING` whose `claimedAt` is older than 10 minutes to `PENDING`. A process
   that died while it sent leaves such a row.
2. Claims every `PENDING` row whose `nextAttemptAt` is past, up to 50, with
   `FOR UPDATE SKIP LOCKED`, and sets `SENDING` and `claimedAt`.
3. When no recipient or no SMTP host is configured, marks the claimed rows `SUPPRESSED` and stops.
   An address set later does not send the old rows.
4. Sends: each row alone when the tick claimed 3 or fewer, else **one digest** that lists all of
   them. Five chains that fail at 03:00 because the network is down are one mail.
5. On success, marks the rows `SENT` with `sentAt`. On failure, adds one to `attempts`, writes
   `lastError`, and sets `nextAttemptAt` 1, 5, 15, 60 and 240 minutes later. After the sixth
   failed attempt the row is `GAVE_UP` and the worker logs an error.
6. Once a day, deletes rows in a final state that are older than 90 days.

**Delivery is at least once.** A process that dies after Mailjet accepted the mail and before
`SENT` is written sends that alert again 10 minutes later. That costs one duplicate mail in a rare
case, and the other order costs a lost alert.

The worker runs whatever `HARVEST_ENABLED` says. Without runs there are no rows.

## 6. The message

Plain text, in English. No HTML template: the mail is read on a phone, and auth's Handlebars
template is copy for shoppers.

Subject, one alert: `[<ENVIRONMENT_NAME>] <chain>: <what happened>`, for example
`[production] Mercadona: catalog discovery failed`,
`[production] DIA: the chain refused the run`,
`[production] Mercadona: catalog discovery failed, and its 2 schedules stopped`,
`[production] DEZA: a scheduled run was refused`.

Body, one alert:

- One sentence that says what happened and what to do next.
- The chain, the mode, the trigger, the preset and the schedule when there is one.
- For a run: requested, started and finished times in `Europe/Madrid`, the duration, failed of
  planned, and the run's `error`.
- For a slot: the slot time and the note.
- For `schedulesStopped`: the sentence of section 2.2.
- A link `<ADMIN_APP_BASE_URL>/harvest/runs/<runId>` when the base URL is set and the alert has a
  run. With no base URL the body names the run id only.

The digest's subject is `[<env>] <n> harvest alerts`, and its body is each alert's body in turn,
oldest first.

The chain name comes from `CatalogClient.getSupermarket` at send time, as the executor reads it
(`run-executor.service.ts:95`). On any error the message uses the `adapterKey` from the payload.
A name is never a reason not to send.

## 7. The test alert

One NATS pattern in a new `HARVEST_ALERT_PATTERNS`:

| Pattern                 | Request           | Answer                                                     |
| ----------------------- | ----------------- | ---------------------------------------------------------- |
| `harvestAlert.sendTest` | `AdminCredential` | `{ id: string; queuedAt: string; recipientConfigured: boolean; smtpConfigured: boolean }` |

Gateway: `POST /v1/admin/harvest/alerts/test`, `201` with that body, in the existing harvest
controller. It inserts one `TEST` row and returns. The worker sends it within 30 seconds.

It exists because an alert path that nobody has seen deliver is a trap. A mail from
`no-reply@velista.app` can land in spam (`values.production.yaml:117` to :120), and the first real
failure is the wrong moment to learn it. The owner calls the route one time after the deploy and
checks the inbox. A back office button is the follow up of section 10.

## 8. The configuration

| Key                    | From                                   | Default | Production          | Staging | Slot   |
| ---------------------- | -------------------------------------- | ------- | ------------------- | ------- | ------ |
| `HARVEST_ALERT_EMAIL`  | the app Secret, optional and empty     | empty   | the owner's address | empty   | empty  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM` | the ConfigMap, existing keys | as auth | as auth | as auth | Mailpit |
| `SMTP_PASS`            | the app Secret, existing key           |         |                     |         | empty  |
| `ENVIRONMENT_NAME`     | the ConfigMap, existing key            |         | `production`        | `staging` | `slot<n>` |
| `ADMIN_APP_BASE_URL`   | the ConfigMap, new `config.adminAppBaseUrl` | `''` | `https://admin.velista.app` | `https://admin.staging.velista.app` | empty |

**`HARVEST_ALERT_EMAIL` is one setting for the deployment, not a setting per chain.** The rule of
plan `0083` forbids a variable per chain. A list of addresses separated by commas is accepted.

**Why the Secret and not a values file.** The values files are in the repository, and an address
committed there is an address published. The Secret is written once per cluster by
`provision-release.sh`.

- Add the key to `OPTIONAL_EMPTY_KEYS` (`provision-release.sh:141`), so an empty value is a valid
  cluster.
- Prompt for it **only with `--env production`**. For any other environment, keep the value in the
  cluster or write it empty. Staging is thus quiet by default, and an operator who wants staging
  mail edits the Secret on purpose.
- Add it to the `apply_secret "$APP_SECRET"` call and to the printed summary.
- Add a row to `k8s/helm/luna-shopper-backend-secrets.md`.

**Release order.** `--check` fails on a `secretKeyRef` whose key is absent. Run
`provision-release.sh --env production` and `--env staging` before the deploy that carries this
plan, as `HARVESTER_ACTOR_ID` was. The owner does that. The builder states it in the PR body.

**Luna slots.** `luna-slot.sh` writes, in the harvester `.env`: `SMTP_HOST=localhost`, the slot's
Mailpit `SMTP_PORT`, empty `SMTP_USER` and `SMTP_PASS`, the same `MAIL_FROM` as auth,
`ENVIRONMENT_NAME=slot<n>` and an empty `HARVEST_ALERT_EMAIL`. `SMTP_PORT` and `ENVIRONMENT_NAME`
join `DERIVED_KEYS[harvester]`. `HARVEST_ALERT_EMAIL` does not, so an address a developer sets to
test survives a second run and lands in Mailpit.

The harvester does not need `compose.apps.yml` or `run-services.sh`, which do not start it.

## 9. Why email, and the alternative

**Email to one configured address is the first channel.** The reasons:

- It exists in both clusters today. Mailjet relays on 2525 for auth's confirmation and reset
  mails, so the transport, the port and the password are proven and provisioned.
- Each slot already runs Mailpit, so a builder and a reviewer see the mail without a third party.
- It needs no new account, no token and no outbound host beyond Mailjet.
- On the owner's phone, a mail to his own inbox is a push notification already.

The weak points: a mail can land in spam, Mailjet's free plan caps a day at about 200 mails, and
delivery can take a minute. The test route of section 7 covers the first. The digest of section 5
keeps the volume far under the cap.

**The alternative is a chat webhook** (a Telegram bot or a Discord channel webhook). It is one
HTTPS `POST` with one secret URL or token, it pushes at once, and it has no spam folder. It needs
a new account and a new Secret key, and a slot cannot test it without a real chat. The worker
sends through one `AlertChannel` interface with one method, `send(subject, body)`, so a webhook is
a second class and a configuration key, not a redesign. **Owner question 1** decides which one
ships first.

**Not auth as the sender.** A NATS event that auth turns into mail keeps `SMTP_PASS` in one pod.
It also puts an operations concern into the identity service, makes every alert depend on auth
being up, and still needs an address that auth does not have. The harvester holds one more copy
of a password that the cluster already distributes from one Secret key.

## 10. What this plan does not do

- **No back office screen.** A settings screen for the recipient, a list of recent alerts and a
  "send a test" button belong to an admin plan, after a mock. The table of section 4 is the data
  that list would read. The address stays in the Secret until that plan decides otherwise.
- **No alert on a completed run that wrote nothing,** and no report of price changes. The owner
  does not want the second now. A run that reads the shape wrongly is plan `0219`'s probe.
- **No alert for a chain that stops listing products.** That is plan `0220`.
- **No quiet hours, no severity levels, no per alert opt out.** One owner, few mails.
- **No alert from another service.** Catalog, core and auth failures are not runs.
- **No change to when a run fails.** The ratio, the counter and the slot rules stay as they are.

## Tests

- **`harvest-alert.rules.spec.ts`**:
  - `FAILED` of `MANUAL` and of `SCHEDULED` gives `RUN_FAILED` with key `run:<id>`.
  - `FAILED` with a refusal gives `RUN_BLOCKED`.
  - `COMPLETED`, `ABORTED` by a person, `ABORTED` by a shutdown and `STALE` give nothing.
  - `FAILED` of `SYSTEM` gives nothing, unless it takes the counter to 3 with a schedule on.
  - The counter going from 2 to 3 with two schedules on sets `schedulesStopped: 2`. From 2 to 3
    with none on, and from 3 to 4, set nothing.
  - `REFUSED` after `STARTED` alerts. `REFUSED` after `REFUSED` with the same note does not.
    `REFUSED` after `REFUSED` with another note does. A refused retry alerts with the `:retry` key.
  - `SKIPPED_BUSY`, `SKIPPED_LATE`, `SKIPPED_FAILING` and `STARTED` give nothing.
  - `refusal` true gives `RUN_BLOCKED`, and `refusal` false with the same `FAILED` run gives
    `RUN_FAILED`.
- **`harvest-alert.message.spec.ts`**: each subject of section 6, the link with and without a base
  URL, the `schedulesStopped` sentence, a digest of four, the fallback to the adapter key, and no
  dash as punctuation in any fixed sentence.
- **Executor**: a run that fails passes a draft to `finish`. A run aborted by the shutdown hook
  passes none. A run that plan `0215`'s guard stopped, whether its runner returned or threw,
  gives `RUN_BLOCKED`.
- **Schedule worker**: a refused slot passes a draft to `recordOutcome`, and a busy slot passes
  none.
- **Alert worker**, with a fake transport and a clock passed in: one row is one mail, four rows
  are one digest, no address marks `SUPPRESSED`, a transport error moves `nextAttemptAt` by the
  table and gives up after six, a `SENDING` row older than 10 minutes is sent again, the daily
  sweep deletes a final row of 91 days and keeps one of 89.
- **Integration, on real Postgres**:
  - The migration creates the table, the enums, the unique key and the index.
  - `finish` with a draft writes both rows, and a failing insert rolls back the status.
  - Two inserts with one key leave one row.
  - Two workers on one database claim disjoint rows.
- **Gateway**: `POST /v1/admin/harvest/alerts/test` reaches `harvestAlert.sendTest` and answers
  `201`. `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.
- **Chart**: `helm template` with `values.production.yaml` renders the six keys of section 8 on the
  harvester container, and `provision-release.sh --check` passes against a render where the key is
  present and empty.

## Acceptance criteria

- [ ] A `MANUAL` or `SCHEDULED` run that ends `FAILED` writes one alert row in the transaction of
      its final status.
- [ ] A run that ends `FAILED` with `stopReason: SOURCE_BLOCKED` is a `RUN_BLOCKED` alert.
- [ ] The failure that takes a chain's counter to 3 while a schedule is on says that the schedules
      stopped, in the same mail as the run.
- [ ] A refused slot alerts one time until the outcome or the note changes.
- [ ] `ABORTED`, `STALE`, `SKIPPED_BUSY`, `SKIPPED_LATE` and `SKIPPED_FAILING` write no alert.
- [ ] A restart of the harvester sends no alert two times in the normal path and loses none.
- [ ] More than three alerts due in one tick are one digest mail.
- [ ] With `HARVEST_ALERT_EMAIL` empty, rows end `SUPPRESSED` and no mail is sent.
- [ ] `provision-release.sh` prompts for the address with `--env production` only, and an empty
      key passes `--check`.
- [ ] A luna slot sends nothing by default, and a slot with an address set delivers to Mailpit.
- [ ] `POST /v1/admin/harvest/alerts/test` queues a `TEST` alert that the worker sends.
- [ ] No run status, slot outcome or counter rule changed.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
helm template k8s/helm -f k8s/helm/values.yaml -f k8s/helm/values.production.yaml | grep -A2 HARVEST_ALERT_EMAIL
```

`nx test` does not type check. The build line does.

The slot check, on an ephemeral slot:

1. `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>` with
   `HARVEST_ALERT_EMAIL=owner@example.test` in the environment of the harvester.
2. Call the test route with an operator token. The mail is in the slot's Mailpit within a minute.
3. Turn a source row on, set `HARVEST_ENABLED=true`, point its adapter at an unreachable base URL,
   start a run, and see the `RUN_FAILED` mail with the run link.
4. Restart the harvester and confirm that Mailpit holds one copy of each mail.
5. `--ephemeral --down <n>`.

## Decisions

Chosen in this plan, and open to the owner's correction:

- An alert is written in the transaction of its outcome, kept in an outbox with a unique key, and
  sent at least once (sections 4 and 5).
- One mail per run. The schedule stop is a line in the run's mail, not a second mail (section 2.2).
- More than three alerts in one tick become one digest (section 5).
- A refused slot alerts one time until its outcome or note changes (section 2.3).
- No alert for an abort of any kind, a busy chain, a late slot or a failing skip (section 2).
- The harvester sends its own mail with nodemailer and the cluster's SMTP keys, not through auth
  (section 9).
- The recipient is in the Secret, prompted on production only (section 8).
- Plain text in English, times in `Europe/Madrid` (section 6).
- A test route, so the path is proven before a real failure (section 7).
- Rows are kept 90 days. Six send attempts, then `GAVE_UP` (section 5).

**Owner**: ask, do not choose.

1. **The channel.** Email to a configured address (recommended, section 9), or a Telegram or
   Discord webhook first.
2. **The recipient.** Which address, and whether more than one person receives the alerts.
3. **A person's own failed run.** This plan alerts on a `MANUAL` run that fails, because a walk
   runs for minutes or hours and the person may have left. Keep that, or alert on `SCHEDULED`
   runs only.
4. **The postal code queue.** A `SYSTEM` run that fails sends nothing here. Should a code that
   ends `FAILED` after its attempts send one?
5. **`STALE`.** A run the reaper marks sends nothing here. Should it, when it is not a scheduled
   run that the retry will start again?
6. **Staging.** Quiet by default. Should staging alert too, to a second address?
7. **Mailjet delivery.** Whether `no-reply@velista.app` passes SPF and DKIM at Mailjet today. The
   test route answers it in one minute after the deploy.

## Facts that contradict an earlier statement

- The brief and the task say "email to platform admins". **Platform admins have no email
  address** (`auth/src/app/entities/admin-user.entity.ts:16`), so the recipient must be a
  configured address.
- `values.production.yaml:117` to :120 says SMTP is off in production because `smtpHost` is empty,
  and :122 sets `smtpHost: in-v3.mailjet.com`. The comment is out of date. This plan does not
  touch it.
