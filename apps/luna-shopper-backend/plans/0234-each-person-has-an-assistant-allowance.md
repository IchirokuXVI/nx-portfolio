# 0234: each person has an assistant allowance

> The assistant pays a model provider for every turn, and the only limits in front of
> that bill are a per minute window and a concurrency gate, both held in the memory of
> each pod (`provider/turn-limiter.ts:1` to `:9`). A person who keeps under eight turns a
> minute can spend all day, every day, and a restart or a second replica resets or doubles
> what they may spend. Nothing caps the deployment as a whole. The owner decided on
> 2026-10-27 that strict limits come **before** any paid usage, so that nobody with harmful
> intent can run up charges.
>
> This plan gives each person an **allowance**: a number of turns, of seconds of audio and
> of money per day and per month, and a ceiling on the money the whole deployment may spend
> per day and per month. The counters live in core's Postgres, because they have to
> survive a restart and a second replica, and Redis in this chart is built to forget
> (section 3). A turn reserves its worst case before it calls a provider and settles what it
> really cost afterwards, so concurrent turns cannot spend past a limit together.
>
> Prerequisite reading: `0039` sections 9 to 11 (the limiter, the record, the
> configuration), `0041` section 7 (a spoken turn is one turn), `0045` section 4 (a voice
> comment is transcribed through the assistant), `0224` sections 7, 8 and 10 (the usage
> fields, the cache, the cost per turn), `0226` section 2.3 (the price table this plan
> borrows), and in the code `provider/turn-limiter.ts`, `assistant/assistant.service.ts`,
> `provider/model-provider.ts`, `config/app-config.ts`,
> `gateway/src/app/assistant/assistant.controller.ts`,
> `gateway/src/app/lists/comment-transcription.service.ts`,
> `libs/luna-shopper/platform/src/lib/throttling/throttler-config.ts` and
> `core/src/app/account/account-deletion.service.ts`.
>
> **Build order.** Buildable on `dev` as it is today, with no other plan first. Plans
> `0235` (self hosted transcription) and `0236` (Gemini removed) each change one input of
> this plan, and section 12 says which and how. Every line number below was read on `dev`
> on 2026-10-27.

## Brief for the agent

### Objective

Add a per person and per deployment allowance to the assistant: core stores daily usage
rows and answers two new NATS patterns, `assistantAllowance.reserve` and
`assistantAllowance.settle`; the assistant reserves before each provider call sequence
and settles after it; a refused reservation answers the new error code
`assistant_allowance_reached` with the period and the time it resets; the gateway exposes
the person's remaining allowance at `GET /v1/assistant/allowance`. Sections 1 to 11
describe the whole job.

### Context

- `TurnLimiter` is a fixed window per caller per minute, in memory, per instance
  (`provider/turn-limiter.ts:1` to `:9`, `:21` onward). `ConcurrencyGate` caps provider
  calls in flight per instance (`:96` onward). `AssistantService` builds both from
  `ASSISTANT_TURNS_PER_MINUTE` (default 8) and `ASSISTANT_CONCURRENCY` (default 2)
  (`assistant.service.ts:114` to `:115`, `app-config.ts:220` to `:222`).
- The chart runs two replicas of every service (`k8s/helm/velista/values.yaml:161`), so
  today's per minute limit is in practice up to twice its number.
- A turn checks `requireConfigured` first and then takes the local limiter
  (`assistant.service.ts:170` to `:182`, `:603` to `:615`). A spoken turn takes the
  limiter once, before the transcription (`:208` to `:224`). `transcribe`, the path a
  voice comment takes, takes no turn at all (`:118` to `:169`).
- The provider reports usage as `ModelUsage` with prompt, response, total and cached
  prompt tokens, each possibly `null` (`provider/model-provider.ts:100` to `:113`). The
  turn record logs it as `tokens` (`assistant.service.ts:786` to `:810`).
- A 429 travels as `RateLimitedException` with `retryAfterSeconds` in the problem body
  (`assistant.service.ts:735` to `:752`, `libs/luna-shopper/platform/src/lib/errors/domain-exception.ts:180`).
  The code table is `libs/luna-shopper/platform/src/lib/errors/error-codes.ts:12`, with the
  status map at `:513` onward.
- The gateway forwards only `userId` to the assistant (`gateway/src/app/assistant/assistant.controller.ts:84`
  to `:95`). The JWT carries `kind` (`gateway/src/app/auth/jwt.strategy.ts:22`), a
  `UserKind` of `TEMPORARY` or `REGISTERED` (`libs/luna-shopper/contracts/src/lib/enums/auth.enums.ts:11`
  to `:14`). A guest is `TEMPORARY`.
- The voice comment path sends `audio`, `mimeType` and `locale` to
  `ASSISTANT_PATTERNS.transcribe` and no user id (`comment-transcription.service.ts:136`
  to `:149`). The upload is throttled to ten a minute
  (`throttler-config.ts:186`).
- Redis has no volume and evicts with `volatile-lru` at 96 MB (`k8s/helm/velista/values.yaml:811`
  to `:818`). Only two roles receive `REDIS_URL`, and the assistant is not one
  (`k8s/helm/velista/templates/luna-shopper-backend/_env.tpl:58` to `:66`).
- The assistant has no database (`assistant/assistant.module.ts:27`). Core has one, its
  migrations under `core/src/app/db/migrations/`, and it is the only consumer of
  `user.deleted` (`core/src/app/account/account-deletion.service.ts:42` to `:44`).
- Prices: `0226` section 2.3 lists `claude-haiku-5-5` at $0.10 per million input tokens,
  $0.50 output and $0.01 cache read, read on 2026-10-22. `0224` section 10 measured
  $0.35 per 1,000 turns on that model. Not verified again for this plan.

### Target state

- `npx nx run-many -t lint test build --projects luna-shopper-backend-core,luna-shopper-backend-assistant,luna-shopper-backend-gateway`
  passes, with the specs of section 10.
- The core migration applies and reverts on a real Postgres (an ephemeral slot, per
  `luna-backend-spec-traps`), and the integration spec of section 10.2 passes there.
- A person over any limit gets `429 assistant_allowance_reached` with `details.scope`,
  `details.period` and `details.resetsAt`, and no provider call is made.
- `GET /v1/assistant/allowance` answers the person's usage and limits.
- `openapi.json` and `wire-types.ts` are regenerated and committed.
- The `luna-shopper-backend-e2e` suite passes unchanged: with no key the assistant still
  answers 501 before any reservation.

### Scope

- Work only in: `apps/luna-shopper-backend/core/src/**`,
  `apps/luna-shopper-backend/assistant/src/**`,
  `apps/luna-shopper-backend/gateway/src/app/assistant/**`,
  `apps/luna-shopper-backend/gateway/src/app/lists/comment-transcription.service*.ts`,
  `apps/luna-shopper-backend/gateway/docs/openapi.json`,
  `libs/luna-shopper/contracts/src/**`, `libs/luna-shopper/platform/src/lib/errors/**`,
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`,
  `k8s/helm/velista/values.yaml`, `k8s/helm/velista/values.production.yaml`,
  `k8s/helm/velista/templates/luna-shopper-backend/_env.tpl`,
  `k8s/helm/velista/templates/luna-shopper-backend/configmap.yaml.tpl`,
  `k8s/e2e/luna-shopper-backend/compose.apps.yml`,
  `k8s/e2e/luna-shopper-backend/luna-slot.sh`, and this plan file.
- Do NOT touch: velista (a velista plan shows the code, section 8.3), the provider
  classes, the prompt, the tools, `package.json`, any `.env`.

### Constraints

- A limit is enforced on the server and nowhere else. The client is told, never trusted.
- Counting too much is the safe error. Where a number is unknown (a provider that
  reported no usage, an audio length nobody measured), the plan counts the worst case.
- Never log an amount of money as a float. Money is integer micro dollars end to end.
- No new datastore and no new service. The counters go in core's existing database.
- Prettier on each changed file, never on a directory. Regenerate `openapi.json` and
  `wire-types.ts` with their targets and never by hand.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] Core has the two tables of section 4 and the migration, with a down.
- [ ] Core answers `assistantAllowance.reserve`, `assistantAllowance.settle` and
      `assistantAllowance.read` (section 5), and the reservation is atomic under
      concurrency (the integration spec of section 10.2 proves it).
- [ ] The assistant reserves before the first provider call of a turn, a spoken turn and a
      transcription, and settles in a `finally` (section 5.3).
- [ ] `ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED` exists, maps to 429, and carries the
      details of section 8.1.
- [ ] The gateway forwards `kind` on a turn and `userId` on a comment transcription.
- [ ] `GET /v1/assistant/allowance` exists and answers the shape of section 8.2.
- [ ] Core's `user.deleted` handler deletes the person's usage rows (section 9).
- [ ] The new keys reach the chart, compose and the slot script (section 11).
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

### Action boundaries

- Proceed with in-scope edits, migrations, specs, lint, build, `helm template` and an
  ephemeral slot for the integration spec.
- Stop and ask before adding a dependency, touching velista, or changing a default in
  section 7 (the owner sets those).

### Progress evidence

Report when the integration spec passes on a real Postgres, when the assistant specs pass,
and at the PR. Ground each claim in a command's output.

## 1. What is being built

1. **Usage rows in core.** One row per person per day, and one row per deployment per day.
2. **Reserve and settle.** Before a provider is called, the assistant asks core to reserve
   the worst case of what is about to happen. Core says yes or names the limit that
   refuses it. After the call sequence, the assistant settles the real numbers, and the
   reservation is released.
3. **A code the person can read.** `assistant_allowance_reached`, with when it resets.
4. **A read.** The person's usage against their limits, so velista can show it before
   they hit the wall.

The per minute limiter and the concurrency gate stay as they are. They protect the
provider's rate limit and the pod; the allowance protects the bill.

## 2. What is counted

| Counter | Unit | Counted when |
| --- | --- | --- |
| `turns` | one per turn | a typed turn or a spoken turn. A spoken turn is one turn, as `0041` section 7 already counts it. |
| `assistant_audio_seconds` | whole seconds, rounded up | a spoken turn's recording. |
| `comment_audio_seconds` | whole seconds, rounded up | a voice comment's recording, on its author. |
| `cost_micro_usd` | integer micro dollars | every provider call the assistant makes, turn and transcription. |
| `prompt_tokens`, `response_tokens`, `cached_prompt_tokens` | tokens | recorded for the read and the dashboard; no limit reads them. |

**Why money and not tokens.** Tokens of different kinds cost different amounts (a cached
read is a tenth of a fresh one, `0224` section 7), and a token limit would either punish
the cache or let output tokens through cheaply. Cost is the one number that is the bill.
The brief offered "tokens or cost"; this plan limits cost and records tokens.

**Why audio is its own counter.** After `0235` a recording costs no money: it costs the
transcriber's CPU, which every person shares, one clip at a time. A seconds limit is what
stops one person filling that queue. Comment audio is counted apart from assistant audio
because the two have different reasonable sizes: a voice comment is up to 60 seconds
(`libs/velista/models/src/lib/limits.ts:260`), a spoken turn up to 300
(`libs/velista/platform/src/lib/audio-recorder.ts:38`).

### 2.1 How the audio length is known

The assistant does not decode audio. After `0235` the transcriber returns `audioSeconds`,
measured after decoding, and the settle uses that number. Until `0235` is built, the
settle **estimates** the length from the bytes as `ceil(bytes / 2000)`, which is the length
at 16 kbit/s. A browser records Opus at a higher rate than that (unverified per browser),
so the estimate counts more seconds than were spoken, which is the safe direction.

The reservation always uses the estimate, because it runs before anything is decoded.

### 2.2 How the cost is known

`cost = prompt_uncached * in + cached * cacheRead + response * out`, per million tokens, in
micro dollars, rounded up. The prices come from a table in `provider/prices.ts`, one row
per model id, with the date each row was read. The table starts with the rows of `0226`
section 2.3. A model that has no row is priced at the most expensive row in the table and
the boot log names it. A reply whose `usage` is `null` is charged its reservation in
full.

A transcription by the self hosted transcriber (`0235`) costs zero. Gemini is gone
(`0236`), so no transcription is priced by tokens (section 15, item 3).

## 3. Where the counters live

**Core's Postgres.** Three places were weighed.

- **Redis** is what the gateway's throttler uses, and it is the wrong home for a bill.
  The chart gives it no volume, on purpose ("nothing held here needs to survive a
  restart", `values.yaml:811` to `:813`), and it evicts keys that carry a TTL first
  (`maxmemoryPolicy: volatile-lru`, `:818`). A daily counter carries a TTL. Under memory
  pressure, or after any Redis restart, a person's spend would read zero. The assistant
  also receives no `REDIS_URL` today (`_env.tpl:58` to `:66`).
- **A database of the assistant's own** would be a fifth Postgres, with its Secret, its
  migration job and its backup, for two small tables. That is a real cost for every
  self hoster and for both clusters.
- **Core** already has a database, migrations, backups, and the `user.deleted` handler
  that must clean these rows anyway. It is "the database and the rules", and an
  allowance is a rule about a person. The assistant already talks NATS
  (`app-config.ts:121`). One more request per turn costs 2 to 12 ms in a cluster (measured
  for the backend's NATS hops, memory note `luna-slot-hop-stall-and-tracing`), against a
  turn of 2.4 s.

Core does not learn what a turn said. It sees a user id, numbers and a day.

## 4. The tables

```sql
CREATE TABLE assistant_usage_days (
  user_id uuid NOT NULL,
  day date NOT NULL,              -- the day in ASSISTANT_ALLOWANCE_TIMEZONE
  turns integer NOT NULL DEFAULT 0,
  assistant_audio_seconds integer NOT NULL DEFAULT 0,
  comment_audio_seconds integer NOT NULL DEFAULT 0,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  response_tokens bigint NOT NULL DEFAULT 0,
  cached_prompt_tokens bigint NOT NULL DEFAULT 0,
  -- what open reservations hold, released by settle or by expiry
  reserved_turns integer NOT NULL DEFAULT 0,
  reserved_audio_seconds integer NOT NULL DEFAULT 0,
  reserved_micro_usd bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE assistant_usage_deployment_days (
  day date PRIMARY KEY,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  reserved_micro_usd bigint NOT NULL DEFAULT 0
);

CREATE TABLE assistant_reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  day date NOT NULL,
  kind text NOT NULL,             -- TURN | VOICE_TURN | TRANSCRIPTION
  turns integer NOT NULL,
  audio_seconds integer NOT NULL,
  micro_usd bigint NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON assistant_reservations (expires_at);
```

The month is the sum of the person's rows whose `day` falls in the current month, read
through the primary key. At most 31 rows per person; no monthly table to keep in step.

**No foreign key to a user.** Core holds no user table of its own; the rows are removed by
the deletion handler (section 9).

**Retention.** A sweep in core deletes rows of a person older than the start of the
previous month, once a day. Deployment rows are kept for 13 months, because they hold no
person and are the operator's record of the bill. Neither is in a backup longer than the
14 days every backup is kept.

## 5. Reserve and settle

### 5.1 Reserve

`assistantAllowance.reserve` takes `{ userId, purpose: 'TURN' | 'VOICE_TURN' |
'TRANSCRIPTION', audioSeconds, microUsd, limits, timezone, holdSeconds }`: the assistant
picks the limits by the person's kind and sends them, so core never sees the kind
(section 15, item 6). In one transaction:

1. Upsert today's person row and today's deployment row, then lock both with
   `SELECT ... FOR UPDATE`, person first, always in that order.
2. Release any of this person's reservations past `expires_at` (section 5.4).
3. Read the month's sums for the person and the deployment.
4. Check, in this order, and stop at the first that does not fit: person turns per day,
   per month; person audio seconds per day, per month (assistant or comment audio by
   purpose); person cost per day, per month; deployment cost per day, per month. A
   counter fits when `used + reserved + this <= limit`.
5. If all fit, add `this` to the reserved columns, insert the reservation row, and answer
   `{ reservationId }`. If one does not, answer `{ refused: { scope, period, limit,
   resetsAt } }` and change nothing.

**One turn in flight per person.** A reservation of purpose `TURN` or `VOICE_TURN` is
refused while the person already holds an open one of either. A person has one
conversation; two parallel turns are a script. This is what makes the worst case bound
real: without it, a person could open many turns at once, each fitting the remaining
allowance alone. The refusal is the ordinary `rate_limited` 429 with
`retryAfterSeconds` of 5, not the allowance code, because waiting does fix it.

The deployment row lock serializes reservations across all people. At this volume a lock
held for one short transaction is nothing; section 13 names the number at which it would
not be.

### 5.2 What a reservation holds

| Purpose | Turns | Audio seconds | Micro dollars |
| --- | --- | --- | --- |
| `TURN` | 1 | 0 | `ASSISTANT_TURN_RESERVE_MICRO_USD` |
| `VOICE_TURN` | 1 | the estimate of section 2.1 | the same: the transcriber is ours and costs no money (`0235`) |
| `TRANSCRIPTION` (a voice comment) | 0 | the estimate of section 2.1 | zero (`0235`) |

`ASSISTANT_TURN_RESERVE_MICRO_USD` defaults to 20,000 ($0.02). The worst turn is seven
model calls (one plus `ASSISTANT_MAX_TOOL_CALLS` of 6, `app-config.ts:212`), each at most
4,096 output tokens and about 6,400 input tokens (`0224` section 10). At the Haiku row that
is about $0.019. The builder recomputes this from the price table and the caps in a spec,
so a cap or a price that moves fails a test instead of drifting. With the moderation call
of `0236` the worst turn is 19,637 micro dollars (section 15, item 2).

### 5.3 Settle

`assistantAllowance.settle` takes `{ reservationId, turns, audioSeconds, microUsd, tokens }`
and, in one transaction, moves the reservation's amounts out of `reserved_*`, adds the real
amounts to the used columns of the person row **of the reservation's day** and the
deployment row, and deletes the reservation. A settle for an unknown or expired
reservation still adds the used amounts (the money was spent) and logs a warning.

The assistant settles in a `finally` around the whole call sequence, so a failed turn
settles what it spent before failing. A turn that failed before any provider call settles
zero. A turn that ran over its reservation (a price that moved, a provider that billed
more) is charged in full: the settle never caps the real cost at the reservation.

### 5.4 Expiry

A reservation expires `ASSISTANT_TURN_TIMEOUT_MS` plus 60 seconds after it was made
(`app-config.ts:245`, default 60 s). A pod killed during a turn therefore holds a person's
reservation for two minutes at most. Expiry releases the reserved amounts and charges
nothing: a pod that died mid turn may have spent money nobody recorded, and that is a gap
of at most one reservation per killed turn, logged by the sweep.

### 5.5 Where the assistant calls it

- `turn` (`assistant.service.ts:170`): after `requireConfigured` and `takeTurn`, before
  `answer`. A deployment with no key still answers 501 and reserves nothing, which is why
  the e2e suite needs no change.
- `voice` (`:208`): after `readRecording` and `takeTurn`, before the transcription, with
  the byte length.
- `transcribe` (`:134`): after the `configured` check, with purpose `TRANSCRIPTION` and the
  `userId` the gateway now sends (section 6).
- The usage of each provider reply is added up across the loop; the record already sees
  each reply (`:449`).

If core does not answer within 2 seconds, the turn is refused and no provider call is
made. No `unavailable` code exists, so the refusal is the ordinary `internal` 500
(section 15, item 9). The allowance fails closed: an assistant that answers while its
counter is down is exactly the hole this plan closes.

## 6. The gateway

- The turn and voice payloads gain `kind` from `CurrentUser`
  (`assistant.controller.ts:84` to `:95`). The assistant passes it to core, which picks
  the guest limits for `TEMPORARY`.
- `comment-transcription.service.ts:136` sends `userId: comment.authorUserId` and the
  author's `kind`. A voice comment over its author's comment audio allowance settles as
  `FAILED` on the first attempt, with no retry, and the comment stays playable. The log
  line names the reason. The upload itself is not refused: the recording is the message,
  and the allowance limits the transcription, not speech.
- `GET /v1/assistant/allowance` (section 8.2) asks the assistant (`assistant.allowance`),
  which sends `assistantAllowance.read` to core with the limits that apply. It needs no
  provider key. The plan said it needs no assistant at all, but core holds no limits, and
  the assistant is their one owner (section 15, item 7).

## 7. Limits and defaults

Every limit is a positive integer in the assistant's ConfigMap; core receives none of
them. The assistant sends the applicable limits inside each reserve request, so the
limits have one owner and core holds only counts. There is no "off": a self hoster who
wants no practical limit sets a large number.

| Key | Registered | Guest (`TEMPORARY`) | Why this number |
| --- | --- | --- | --- |
| `ASSISTANT_TURNS_PER_DAY` | 60 | 20 | A long shopping day is a few dozen sentences. |
| `ASSISTANT_TURNS_PER_MONTH` | 600 | 100 | |
| `ASSISTANT_AUDIO_SECONDS_PER_DAY` | 900 | 300 | Fifteen minutes of talking to the app. |
| `ASSISTANT_AUDIO_SECONDS_PER_MONTH` | 9,000 | 1,500 | |
| `COMMENT_AUDIO_SECONDS_PER_DAY` | 1,800 | 600 | Thirty one minute comments. |
| `COMMENT_AUDIO_SECONDS_PER_MONTH` | 18,000 | 3,000 | |
| `ASSISTANT_COST_PER_DAY_MICRO_USD` | 100,000 ($0.10) | 40,000 | About 280 typical turns: the turn count binds first, money is the backstop for turns that are long. |
| `ASSISTANT_COST_PER_MONTH_MICRO_USD` | 1,000,000 ($1) | 200,000 | |
| `ASSISTANT_DEPLOYMENT_COST_PER_DAY_MICRO_USD` | 3,000,000 ($3) | | One bad day costs the owner at most this. |
| `ASSISTANT_DEPLOYMENT_COST_PER_MONTH_MICRO_USD` | 30,000,000 ($30) | | |
| `ASSISTANT_TURN_RESERVE_MICRO_USD` | 20,000 | | Section 5.2. |
| `ASSISTANT_ALLOWANCE_TIMEZONE` | `UTC` | | An IANA name. The day and the month turn over at midnight there. |

The guest keys are the same names with `_GUEST` appended. At $0.35 per 1,000 turns, a
registered person at the turn limit every day costs about $0.21 a month; the deployment
ceiling covers about 140 such people.

`values.production.yaml` sets `allowanceTimezone: Europe/Madrid`. Staging keeps the
defaults. Nothing else differs by environment.

## 8. What the person sees

### 8.1 The error

`ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED = 'assistant_allowance_reached'`, status 429, a
new `AllowanceReachedException` beside `RateLimitedException`. Its own code and not
`rate_limited`, because the client's answer is different: `rate_limited` is a countdown
in seconds (rule A5), and this one is "come back tomorrow" or "the assistant is resting".
The problem body's `details`:

```json
{
  "scope": "user",          // user | deployment
  "period": "day",          // day | month
  "limit": "turns",         // turns | assistantAudio | commentAudio | cost
  "resetsAt": "2026-10-28T00:00:00+01:00"
}
```

No `retryAfterSeconds`, so a client that reads only rule A5's field shows nothing wrong
rather than a twelve hour countdown. The English and Spanish messages, through
`messageArgs` like every other code:

- user: "You have used today's assistant allowance. It is back at {time}." / "Has usado el
  asistente todo lo que permite hoy. Vuelve a estar disponible a las {time}." (and the
  month variants with a date).
- deployment: "The assistant is resting for now. It is back at {time}." / "El asistente
  está descansando. Vuelve a estar disponible a las {time}."

The deployment message does not say that a budget ran out; it is the operator's fact, not
the person's.

### 8.2 The read

`GET /v1/assistant/allowance`, 200, the contract `AssistantAllowanceView`:

```json
{
  "day": { "turns": { "used": 12, "limit": 60 }, "assistantAudioSeconds": {...},
           "commentAudioSeconds": {...}, "resetsAt": "..." },
  "month": { "turns": {...}, "assistantAudioSeconds": {...},
             "commentAudioSeconds": {...}, "resetsAt": "..." },
  "deploymentAvailable": true
}
```

Money is not in the read. A person has no use for micro dollars, and the operator's
prices are not theirs to see. When the person's cost limit binds before their turn limit,
the turn limit in the read is lowered to the turns already used, so the number shown is
the number that stops them. Money binds when the next turn's reserve no longer fits; the
build does not count turns forward at the reserve amount, because a turn reserves about
fifty times what it costs (section 15, item 8).

### 8.3 Velista

Velista needs to show the message of 8.1 in the assistant panel and, optionally, the
remaining turns from 8.2. That is a velista plan, not this one, and none of the plans in
flight (velista `0172` to `0174`) covers it. Until it lands, velista's generic problem
message shows, which is a sentence and not a crash. Named as an owner decision in
section 14.

## 9. Deletion

Core's `user.deleted` handler (`account-deletion.service.ts:42` onward) deletes the
person's rows in `assistant_usage_days` and `assistant_reservations`. The deployment rows
hold no person and stay. Plan `0232` (account deletion) lists every table deletion must
reach, and its deletion runs in one core transaction from a durable JetStream consumer;
these two tables join that transaction. This plan builds the deletion of its own two tables
itself, and the builder names them in the PR so that plan's builder sees them.

## 10. Testing

### 10.1 Unit

- `prices.spec.ts`: the cost formula on the Haiku row, rounding up, `null` usage charged
  the reservation, an unknown model priced at the dearest row.
- `reserve-amount.spec.ts`: the worst turn of section 5.2, recomputed from the caps and
  the price table, is at most `ASSISTANT_TURN_RESERVE_MICRO_USD`.
- `assistant.service.spec.ts`: a turn reserves after `takeTurn` and before the provider; a
  refusal makes no provider call and throws `AllowanceReachedException`; the settle runs
  on success, on a provider error and on a timeout; a 501 deployment reserves nothing;
  core not answering refuses the turn. Core is a fake NATS client, as the suite already
  fakes the gateway.
- Core: the limit order of section 5.1 step 4, the one turn in flight rule, the guest
  limits, expiry releasing without charging, settle on an expired reservation.

### 10.2 Integration, on a real Postgres

Twenty concurrent reserves for one person whose allowance fits five: exactly five
succeed. Twenty concurrent reserves for twenty people against a deployment ceiling that
fits ten: exactly ten succeed. The month sum across a month boundary in
`Europe/Madrid`. This is the spec that proves the locking; a unit test cannot.

## 11. Configuration, chart, compose and slot

- `app-config.ts`: the keys of section 7, Joi `integer().min(1)` each, and
  `ASSISTANT_ALLOWANCE_TIMEZONE` validated with `Intl.DateTimeFormat`.
- `configmap.yaml.tpl` and `_env.tpl`: the keys from `lunaShopperBackend.assistant.allowance.*`
  with the defaults of section 7 written once, in `values.yaml`, under the assistant
  block (`values.yaml:458` onward).
- `compose.apps.yml` and `luna-slot.sh`: the defaults, stated by hand as both files do for
  every assistant key (`compose.apps.yml:350` to `:369`, `luna-slot.sh:1530` to `:1547`).
  None is derived from the slot.
- Core needs no new key: the timezone and the limits arrive in each request.

## 12. How this fits the plans around it

- **`0235` (self hosted transcription).** The transcriber returns `audioSeconds`; the
  settle uses it instead of the estimate of section 2.1, and a transcription's cost
  becomes zero. Whichever of the two is built second makes that one line change.
- **`0236` (Gemini removed).** The Gemini rows leave the price table and the Gemini
  transcription worst case of section 5.2 goes. The moderation call that `0236` adds is a
  provider call and is counted inside the turn's cost.
- **`0226` and `0227` (registry and fallback, unbuilt).** `0226` puts prices on each model
  row and a `costUsd` on the record. When it is built, `provider/prices.ts` becomes a read
  of those rows and the formula stays. A fallback in `0227` is another call inside the same
  turn and is counted by the same settle, so a fallback cannot escape the allowance.
  Neither plan is required.
- **`0231` (the legal settings route).** Its `assistant` flag says whether the assistant
  exists on the deployment. A deployment that has hit its ceiling still has an assistant;
  the flag does not change with the allowance.

## 13. What this plan does not do

- **No per minute change.** The window and the gate stay in memory per pod. They guard
  the provider's rate limit, which a minute of slack does not hurt.
- **No paid tiers and no per person override.** An admin cannot raise one person's
  allowance. A row in core could hold that later; nobody has asked.
- **No alert.** The owner learns of a deployment ceiling from the log line
  `assistant.allowance.deploymentReached`. Plan `0218` built alerts for harvest runs; an
  alert here is a follow up.
- **No sharding of the deployment lock.** At about 50 reservations a second the single
  deployment row would become the queue. That is three orders of magnitude above today.

## 14. Decisions

### The owner's to check

1. Every default in section 7, and that guests get less.
2. That a refused deployment ceiling reads "resting" and never names money.
3. That a voice comment over its author's audio allowance stays playable with no
   transcript, rather than the upload being refused.
4. Which velista plan shows the message and the remaining turns (section 8.3).
5. `Europe/Madrid` as the production day boundary.

### Mine, which the owner can change

1. Core's Postgres for the counters, over Redis and over a fifth database (section 3).
2. Limiting money and recording tokens, rather than limiting tokens (section 2).
3. Reserve then settle, with one turn in flight per person, rather than checking after
   the fact.
4. Failing closed when core does not answer.
5. Limits sent by the assistant in each request, so core holds counts and no settings.
6. The read hides money and lowers the turn number to what money allows.
7. The audio estimate of 16 kbit/s before `0235`.

## 15. What the build decided

The builder's choices where the plan left room, and the computations it asked for. Each
choice is the owner's to change. The branch already had `0232`, `0235` and `0236`, so the
build took section 12's second half of each: the transcriber's measured seconds, no Gemini,
and the moderation call counted inside the turn.

1. **House column names.** Core quotes camelCase columns (`"userId"`, `"costMicroUsd"`), so
   the three tables do too, with snake case table names as section 4 wrote them. Three
   departures from the sketch: the reserved audio is two columns,
   `reservedAssistantAudioSeconds` and `reservedCommentAudioSeconds`, because a check of
   comment audio must not count a spoken turn in flight; the reservation's purpose is
   `purpose` (with a check constraint), because `kind` already means `UserKind`; and a
   reservation has `createdAt`. Indexes: the day of the usage rows (retention), and the
   reservations' `expiresAt` and `userId`. Migration `1756004000000-AssistantAllowance`.
2. **The worst turn, on today's caps and prices.** Seven calls at the Haiku row, each 6,400
   input tokens priced as fresh and 4,096 output tokens: 640 + 2,048 = 2,688 micro dollars,
   18,816 for seven. The moderation call reads its prompt (2,030 characters), the longest
   typed message (2,000 characters, the gateway's cap) and the reply at its ceiling (4,096
   tokens), each character counted as a token: 8,126 input tokens and 16 output, 821 micro
   dollars. Total **19,637**, under the 20,000 reserve by 363. `reserve-amount.spec.ts`
   recomputes it. The 6,400 is `0224`'s measured average and not a cap: a turn with a full
   transcript and large tool results reads more, and the settle then charges what it cost.
   The boot log warns when the configured model makes the worst turn exceed the reserve.
3. **The price table** (`provider/prices.ts`), in integer micro dollars per million tokens,
   checked on 2026-10-29 against the `claude-api` reference (cached 2026-10-06): Haiku 5.5
   0.10 in, 0.50 out, 0.01 cache read; Sonnet 5.5 2.00, 10.00 and **0.20** (plan `0226`
   section 2.3 says 0.10; the price list says 0.20); Opus 5.5 4.00, 20.00, 0.20; Fable 5.1
   10.00, 50.00, 0.25. Opus and Fable are there so that a model set in `ASSISTANT_MODEL` is
   priced at its own row, and so the dearest row an unknown model gets is Fable's. Claude's
   `input_tokens` already excludes cache reads, so the formula's fresh prompt is
   `promptTokens` itself. Haiku's rate above 100,000 prompt tokens is not modelled: no turn
   comes near it. **Cache writes are not counted**: `ModelUsage` has no field for
   `cache_creation_input_tokens`, and the plan keeps the provider classes out of scope. A
   cold turn's write is about $0.0005; a follow up adds the field to `readUsage`.
4. **What an unknown spend costs.** A reply with `usage: null` makes the turn cost at least
   its reservation (section 2.2). A call that failed with a cause (a deadline, a dropped
   connection) may have run, so it costs one call's worst case, 2,688; a moderation call
   that threw costs its worst case, 821. A status the provider answered, a 429 included,
   costs nothing. This keeps a provider outage from spending a whole reservation of every
   person it touches. A turn counts one turn only when some model call was or may have been
   billed, so a turn refused by the provider's 429 counts none.
5. **Audio.** A settle uses the transcriber's `audioSeconds`, rounded up. A clip the
   transcriber refused with a full queue counts zero seconds; any other failure keeps the
   estimate. A spoken turn that heard nothing counts its seconds and no turn.
6. **The limits are chosen in the assistant.** Core receives `limits`, `timezone` and
   `holdSeconds` with each reserve and never sees the kind; the guest limits are therefore
   tested in the assistant and in core's rules spec. A request with no `kind`, which only a
   gateway one release behind sends, gets the guest limits: counting a registered person as
   a guest is the strict error. A transcription with no `userId` is refused with
   `validation_failed`, so during a deploy window an older gateway's voice comments settle
   `FAILED` and stay playable.
7. **The read goes through the assistant.** `GET /v1/assistant/allowance` asks
   `assistant.allowance`, and the assistant asks core with the limits. Core holds no limits
   by design (section 7), so the plan's "needs no assistant at all" could not hold. It needs
   no provider key. The gateway waits 5 seconds.
8. **The turn limit in the read** is the configured limit, or the turns already used once the
   next turn's 20,000 reserve no longer fits the person's cost limit. Counting forward at
   the reserve amount would show five turns a day to a registered person with sixty.
9. **Core not answering** is an `AllowanceUnavailableError`, which the filter answers as
   `internal` 500, logged as `assistant.allowance.unavailable`. There is no `unavailable`
   code, and adding one is a client contract change this plan did not ask for.
10. **One code, four sentences.** `assistant_allowance_reached` carries `messageArgs.variant`
    (`user.day`, `user.month`, `deployment.day`, `deployment.month`) and `messageArgs.time`;
    `ERROR_CATALOG_VARIANTS` in the platform picks the sentence, and an unknown variant falls
    back to the code's own sentence, which names no time. The time is formatted in the
    person's language and the allowance timezone: "00:00" for a day, "November 1" or "1 de
    noviembre" for a month. The deployment sentences say "resting" and never name money.
11. **A counter a reservation adds nothing to is not checked**, so a person over their cost
    limit (a settle never caps a real cost) is not refused a voice comment's transcription,
    which costs no money.
12. **Locks and chores.** Every write takes reservation rows first, then the person's day
    rows in ascending day, then the deployment's. A reserve releases this person's expired
    reservations of any day (`SKIP LOCKED`). A sweep in core releases anybody's every minute,
    logged as `assistant.allowance.reservationExpired`, so a killed pod does not leave the
    deployment's day looking fuller. Once a day per pod it deletes a person's rows from
    before the first day of the previous month and deployment rows older than thirteen
    months; core has no timezone, so both cutoffs are a day earlier than the UTC date says.
    No core key, no switch.
13. **How long a reservation holds**: a turn and a spoken turn, the turn deadline plus 60 s
    (120 s); a voice comment's transcription, the transcriber's comment deadline plus 60 s
    (170 s), because the comment lane may wait 110 s.
14. **Deletion.** Inside `0232`'s transaction, `deleteAllowanceRowsOf` deletes the person's
    reservations, takes what they held out of the deployment's days, and deletes the usage
    rows. Both tables also joined `CORE_USER_IDS_SQL`, so `0232`'s reconcile command and its
    spec see them. `0232` section 2 names them in its core table.
15. **The comment's author kind** is the uploader's token kind: the uploader is the author.
    `list.controller.ts` passes `user.kind` to `schedule`, one line outside the plan's scope
    list. A refusal on the author's allowance settles `FAILED` on the first attempt with the
    log line "transcription refused: the author has used their comment audio allowance".
16. **The chart** holds the defaults once, under `lunaShopperBackend.assistant.allowance`
    (`registered`, `guest`, the two deployment ceilings, `turnReserveMicroUsd`, `timezone`),
    and the template uses `required`, so a values file that lost one fails at render.
    Production sets `assistant.allowance.timezone: Europe/Madrid`, which is section 7's
    `allowanceTimezone`.
17. **Core's rules are tested where they are true.** The check order and the guest limits
    are a pure unit spec (`allowance-rules.spec.ts`); one turn in flight, expiry releasing
    without charging and a settle on an expired reservation are in the integration spec,
    because a fake of the SQL would only agree with itself.
18. **Left out**: the velista message and the remaining turns (section 8.3; velista's
    `problem.ts` does not know the code yet and shows its generic sentence); an alert on the
    deployment ceiling (section 13); cache writes (item 3). No default of section 7 was
    changed.
