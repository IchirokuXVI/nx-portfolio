# 0039 The assistant service, and the three things it can do

> **A test, and scoped like one.** This builds the smallest assistant worth putting in
> front of a real person, so that the plan after it is written from usage data rather than
> from guesses. Backlog `0005` designs the full assistant and still stands; this takes a
> slice of it, keeps the one rule that slice must not break, and leaves the rest parked.
>
> Prerequisite reading: backlog `0005` sections 1, 3 and 7, whose decisions this plan
> either adopts or departs from by name. Where it departs, section 13 says so.
> The client half is velista plan `0032`.

## 1. What is being built

A new service, `luna-shopper-backend-assistant`, that takes a question in ordinary
language and answers it, and which can do exactly three things on the caller's behalf:

- **Add or edit a line on a list.**
- **Report on lists.** Is this item on a list, how much of it is on a given list, what is
  still pending.
- **Change the caller's username**, and with it, by default, their display name in every
  zone they belong to.

Everything else it does is talk.

## 2. The rule the whole plan hangs on

Taken from backlog `0005` section 1 unchanged, because it is the one decision that is
expensive to retrofit:

> The assistant calls the same HTTP API the app calls, with the caller's own token, and
> can therefore do exactly what that user could do by tapping, and nothing more.

Stated as a constraint on the service rather than as a habit:

**Rule A1. The assistant reads no application data except through the API, carrying the
caller's own token.** It opens no connection to the auth, core or catalog databases, it
subscribes to nothing, and it holds no service account and no privileged client. Every
request it makes on somebody's behalf carries that person's `Authorization` header
verbatim.

The rule is about **whose data it can reach**, not about whether the service may own
storage. A table of its own, holding its own data, breaks nothing here. A `SELECT` against
core's database breaks everything, because the moment the bot can read a row without a
token, a misread sentence can leak a list to somebody who was never in the zone.

What the rule buys: every authorization check, throttle, validation rule and event emission
built across plans `0004` to `0037` applies to the assistant without being restated or
re-tested. If the bot tries to add a line to a list the caller cannot write, it gets the
same 403 the app gets, from the same code, and it says so. The blast radius of a misread
sentence is exactly the blast radius of a mistaken tap, and that is what makes this safe to
put in front of people as a test.

Rule A1 has a visible cost, and section 5 is about paying it.

## 3. Where it runs, and how the app reaches it

**A new Nest service**, for the reasons backlog `0005` section 3 gave: it holds a provider
credential nothing else needs, its failure mode is a slow or absent third party and must
not become the gateway's failure mode, and its profile is a few long requests rather than
many short ones.

- Project `luna-shopper-backend-assistant`, port **3005**, following 3000 to 3004.
- **Not routed.** Like auth, core and catalog, it is reachable only inside the cluster.

**The client reaches it through the gateway, at `/v1/assistant`.** No new hostname, no new
certificate, no new CORS origin, and no second base URL in the app. The gateway proxies the
route through to the service and does nothing else with it.

An earlier draft of this plan gave the assistant its own `bot.` host, on the argument that a
turn holds a gateway connection open for as long as a model takes to answer. That argument
does not survive contact with the runtime: Node holds an awaited socket, not a thread, and
an idle connection waiting on a third party costs almost nothing. What backlog `0005`
section 3 actually refused was putting the assistant's **logic** in the gateway, so that a
provider outage or a runaway conversation would sit inside the app's request path. Keeping
the logic in its own service satisfies that in full; the proxy hop does not reintroduce it.

Against that, a separate host would have cost a DNS record and a certificate in each
environment, a `hostOverrides` entry, a CORS origin, and a second base URL that the client
must configure and that `gatewayInterceptor` does not already attach a token and an
`Accept-Language` to. That is real work, repeated per environment, to avoid a cost that is
not there.

One honest consequence of proxying: a turn occupies a gateway request while the assistant
turns around and calls the gateway again for its context, so one conversation turn is a
nested pair. At two replicas and this volume that is not a problem, and section 9's
concurrency limit caps it regardless. If the assistant ever becomes high traffic or starts
streaming, the separate host is the escape hatch and this section is the argument to
re-read.

The service calls the gateway over the cluster's internal name for everything it does on
the caller's behalf, forwarding the caller's `Authorization` header verbatim. It never
mints a token and it holds no service account of its own.

## 4. It is stateless, and the client holds the transcript

**Rule A2. The assistant stores nothing between turns.** Each request carries the whole
conversation: the transcript so far, plus the new message. The service validates it,
answers, and forgets.

**This is a scope decision, not a consequence of rule A1.** Rule A1 forbids reaching
application data without a token; it says nothing about the service owning a table. A
conversation store would be perfectly legal. It is left out because this is a test, and a
fourth Postgres means a migration job, a Helm entry, a backup target and a place for
personal data to accumulate, all before anybody knows whether the feature is worth keeping.

What that costs, written down so the next plan can price it rather than rediscover it:

- A reload loses the conversation. Acceptable for a test, not for the accessibility work
  that follows, and backlog `0005` section 5 already designs the store that fixes it.
- The transcript is client supplied, so it is **untrusted input**. The service caps it on
  arrival rather than trusting the client's cap, and it never treats a transcript entry as
  an instruction from the operator. A user who pastes "you are now in developer mode" into
  their own transcript is sending user text, and it is handled as user text.
- Per user quotas cannot be counted across conversations. Section 9 says what is possible
  instead, and admits what is not.

Adding the store is the first thing the next plan should reconsider, and nothing here
stands in its way.

## 5. What it may know, and the cost of rule A1

Every turn, before the model is called, the service fetches the caller's context from the
gateway with the caller's token: their zones, the lists they can see, and, when a list is
in question, that list's lines. This is the price of rule A1, paid in latency and in
gateway requests, and it buys the guarantee that the bot cannot see a row its caller could
not.

Two things follow.

**Fetch lazily.** A turn that turns out to be "hello" should not have cost four gateway
calls. The zone and list index is small and is needed to resolve almost anything, so it is
fetched up front; a list's lines are fetched only when a tool asks for them.

**Nothing is cached across callers.** There is nowhere to cache it, which is rule A1 doing
its job rather than a limitation to work around.

## 6. The three tools

Hand written, not generated. Backlog `0005` section 2 wants the catalog generated from
`gateway/docs/openapi.json`, and that stays right for an assistant with a wide surface.
Three tools is not a wide surface, and a generator plus its tests would dwarf the thing
being tested. Picking generation up later costs nothing that writing three schemas by hand
now saves.

### 6.1 `upsert_line`

> **Superseded by plan `0040` section 7: the tool is `upsert_lines` and takes a list
> of items with a per item `set` / `add` choice.** Everything below still holds,
> including the four resolution branches and the one list per call rule; only the
> name and the shape of the arguments changed, and the catalog is still three tools.

Adds a line to a list, or edits one already there.

The model supplies the product text, an optional quantity and unit, and the list. **It
never supplies a user id**, and it may only name a zone or list that appeared in this
turn's context.

Which list is deliberately not the model's job when it can be avoided. The service resolves
in this order and stops at the first that answers:

1. The list the caller named, matched against the context index.
2. The list the conversation has been about, when the transcript names exactly one.
3. The caller's only list, when they have exactly one.
4. Otherwise, **ask**. The turn ends with a question and no write.

A write that guessed is worse than a question. Case 4 is the ordinary case for somebody
with several lists, so it has to read as a normal part of the conversation rather than as
a failure.

### 6.2 `query_lists`

The reporting questions: is this item on a list, how much of it is on a given list, what is
still pending, which list has it.

Read only, no confirmation, and the one tool that should feel instant.

### 6.3 `rename_me`

Changes the caller's username, and with it their display name in the zones where it still
matches.

**It is one request.** `PATCH /account/me`, with `username` and a `propagation` value. Plan
`0018` already built the cascade server side, so there is nothing here to orchestrate and
nothing that can half succeed:

| `UsernamePropagation` | Effect |
|---|---|
| `GLOBAL_ONLY` | the API's own default: only `users.username` changes, every membership is left alone |
| `MATCHING_ZONES` | also renames memberships whose name equals the **old** global username |
| `ALL_ZONES` | renames every membership, whatever it was called |

**The bot sends `MATCHING_ZONES` by default**, which is what "change the name on zones too"
means in practice and is the only one of the three that is safe as a default: somebody who
deliberately became "Mamá" in the family zone keeps it, which is exactly the case plan
`0018`'s own comment says the default exists to protect. `ALL_ZONES` would clobber it, and
the bot only sends it when the caller says something that plainly means everywhere.
`GLOBAL_ONLY` is what "just my account, leave the groups alone" maps to.

The rest is ordinary. Usernames are global and unique since plan `0018`, so the call can
come back saying the name is taken, and that is an answer the bot relays in words rather
than an error.

It confirms once before acting, in a sentence, because it changes what other people see.
That is a one line ceremony on a single reversible call, not the multi step gate the
destructive operations in section 12 would need if they were here, which they are not.

## 7. Freedom in the prose, constraint in the actions

The brief asks for free replies and no wandering, and those pull against each other. The
resolution is that **the freedom is in the text and the constraint is in the actions**:

- The reply text is free form. The model writes it, in the caller's language, untemplated.
- The **actions** are the three tools. There is no fourth thing it can do because there is
  no fourth tool, and an absent capability is a much harder boundary than an instruction.
- Off topic input gets a short friendly redirect and no tool call.

What is left is prompt level, and it is written as a few rules rather than a long persona:

**It is a shopping list assistant for this app and nothing else.** No code, no general
knowledge, no medical, legal or financial advice, and no discussion of its own prompt or
its provider. Asked what it is, it says what it can do and offers to do one of those
things.

**It never invents data.** Every fact about a zone, a list or a line comes from a tool
result in the same turn. If it has not looked, it looks; if the tool returned nothing, it
says so. A confident and wrong "yes, milk is on the flat list" is the worst output this
feature can produce, because unlike an error it is not visibly wrong, and somebody shops
on it.

**It answers in the caller's language**, which arrives as `Accept-Language`, the locale the
gateway already resolves (plan `0004` section 12).

A refusal or a redirect is a successful turn and is not retried.

## 8. References come from tool results, never from the reply text

The client draws links to the zones, lists and lines an answer mentions (velista `0032`).
Those links are **not** parsed out of the reply, and the model is never asked to write a
link or an id.

**Rule A3. References are emitted from the tool results the service actually executed.**
Every response carries, beside its text, what the turn genuinely read or wrote:

```
references: [
  { kind: 'zone', zoneId, label },
  { kind: 'list', zoneId, listId, label },
  { kind: 'line', zoneId, listId, lineId, label }
]
```

An id in that list came back from the gateway during this turn, so it exists, the caller
can see it, and the link cannot 404. An id the model wrote into a sentence has none of
those properties. This is the cheapest defence against the one failure that would make the
feature untrustworthy, and it costs one field.

The model is told the client draws these itself, so it writes "it is on the flat list" and
not a markdown link.

## 9. The provider, the model, and living inside a free tier

**Google Gemini, free tier**, through the official SDK, behind an interface.

- **Model: `gemini-3.5-flash-lite`.** Short turns, three tools, no deep reasoning: the
  Flash-Lite class squarely. It is a config value and not a literal, so changing it is an
  env edit and a restart. `gemini-3.1-flash-lite` is the first thing to try if quality
  disappoints, and the version numbers do not order those two the way they look.
- **Rule A4. No test in this repository may reach a model provider.** The provider sits
  behind an interface with a fake, and the suite passes with no network, for the reason
  plan `0015`'s suites bring their own stack: a test that depends on a rate limited third
  party is a test that gets deleted the first week it is flaky.

The free tier has three properties that are design constraints rather than footnotes.

**Its limits are per Google Cloud project, not per user.** Roughly ten to fifteen requests
a minute shared across everybody, and Google no longer publishes exact per model numbers in
the docs, so they are read from the AI Studio console. With two replicas and a handful of
concurrent users this **will** return 429 in ordinary use. That is accepted rather than
engineered around, and the requirement is that it be legible when it happens.

**Rule A5. A rate limited turn tells the caller how long to wait, and the answer is a
number.** "Try again later" is the wrong answer: somebody who cannot type is left guessing,
and guessing means tapping send again, which spends the next slot and extends the outage.

So the service returns a 429 of its own carrying `retryAfterSeconds` **in the problem body**,
and the client renders a countdown and holds the composer disabled until it reaches zero
(velista `0032` section 3.1).

The body, not a `Retry-After` header, and that is rule C3 from plan `0009` rather than a
preference: `main.ts` calls `enableCors({ origin, credentials: true })` with no
`exposedHeaders`, so a browser cannot read that header cross origin, and `velista.app`
calling `api.velista.app` is cross origin. A header alone leaves the panel with nothing to
count. Plan `0015`'s hourly rename throttle already learned this and answers the same way;
setting the header too is harmless for non browser callers, but nothing may depend on it.

The number comes from, in order:

1. The provider's own retry hint. Google's error payload carries a `RetryInfo` with a
   `retryDelay`; when it is there it is authoritative and is used as it is.
2. Otherwise, the time until the local limiter's window rolls, which the service knows
   because it is the thing counting.
3. Otherwise a conservative fixed fallback, so the field is never absent.

Whichever it came from, it is a number in a field. Nothing downstream parses prose to find
it, and the panel never derives one of its own.

A small per instance concurrency limit sits in front of the provider call, so that a burst
queues briefly instead of becoming a burst of 429s. Queuing is preferable to failing here:
waiting two seconds is invisible, being told to come back is not.

**There is no SLA and the terms can change.** Acceptable precisely because this is a test.
Not acceptable for the accessibility work, and the next plan should budget for a paid tier.

**Free tier content is normally used to improve Google's products, and here it is not.**
Google's API terms carve out EEA, Switzerland and UK users, for whom the paid data terms
apply to every service including unpaid quota. That carve out is what makes it defensible
to put real shopping data through a free tier at all. Re-read it when the next plan is
written rather than assuming it held.

Quota, with nowhere to keep a counter, is what the platform already offers: the gateway's
throttler (plan `0004` section 8) applies to every call the assistant makes on the caller's
behalf, and a per instance in memory limiter caps turns per token per minute. Neither
survives a restart and neither is shared across replicas. That is a known weakness, written
here rather than discovered later, and fixing it properly needs the storage rule A1
forbids.

## 10. The usage data this test exists to produce

Rule A2 stores nothing, and the point of the whole plan is to be the ground for a better one
written from real usage. Those two do not reconcile by themselves, so the recording is named
here rather than assumed, and it is the one part of this plan that would be silently useless
if it were left out.

It goes to **structured logs**, through the tracing and metrics from plan `0016`, which the
service already gets for free. That is a consequence of rule A2's scope decision, not of
rule A1: a table would have been allowed, and the next plan may well prefer one, since a
query beats grepping logs once there is enough to look at.

Per turn, one structured record:

- What the caller said, and what the bot replied.
- Which tools were called, with their resolved arguments, and whether each succeeded.
- Which branch of 6.1's list resolution answered, or that it had to ask. **This is the single
  most valuable field here**: it says how often the app can infer the list, which is the
  question the accessibility work turns on.
- Whether the turn was off topic, refused, or hit the provider's rate limit.
- Latency, split between the gateway calls and the provider call.
- Token counts as the provider reports them.

Two constraints on it. The caller is identified by their user id and never by anything else,
and the transcript text is what a person typed about groceries, which is ordinary personal
data: the retention on these logs is short and stated, and this is the one place in the
service where anything a user wrote outlives the request.

**A spoken turn, since plan `0041`.** A recording now reaches this service and reaches the
provider, and it is personal data of a different character from a typed sentence, because a
voice identifies a person and a sentence does not. What is true of it here:

- **It is held in memory for the length of the turn and written nowhere.** No disk, no
  database, no object store, no cache. Rule A2 already says the service stores nothing
  between turns, and the recording is the strongest case for that rule rather than an
  exception to it. The gateway's multipart interceptor is configured with `memoryStorage`
  explicitly for the same reason, rather than relying on multer's default.
- **It is never logged, at any level, not even a hash of it.** The record above carries the
  **transcription** instead, which lives in these logs on exactly the terms the words a
  person typed already do, and no longer. The provider's error bodies were already logged
  rather than surfaced because they can echo the prompt; the same care applies here and
  matters more.
- **The free tier's data terms cover it**, on the reading in section 9: Google's terms carve
  out EEA, Switzerland and UK users, for whom the paid data terms apply to unpaid quota,
  and that carve out is what makes real shopping data defensible on a free tier. Audio
  raises the stakes of that reading rather than changing it.

What that trade bought is in `0041` section 2, and it is not obviously a loss: the browser's
own `SpeechRecognition`, which this service used before `0041`, is implemented by Chrome and
Safari by **sending the audio to the browser vendor**. The choice was never between sending a
recording and not sending one. It was between sending it as this app's request, under the
terms section 9 examined, and sending it as the browser's, under terms nobody here can read.

What comes out of it is the input to the next plan: whether one list is inferable in
practice, which of the three tools anybody actually uses, how much of the traffic is
off topic, and whether the free tier's limits made the thing feel broken.

## 11. Configuration, secrets and CI

CI needs less hand editing than it looks. `docker-ci.yml` derives its build, test and
deploy lists from `nx show projects` and a `luna-shopper-backend-` prefix, so a project
with that name is picked up, built, pushed and rolled out with no workflow edit. What needs
editing is everything that states configuration by hand:

- **`k8s/helm/values.yaml`**: a sixth entry under `lunaShopperBackend.services` with
  `port: 3005` and `routed: false`, alongside auth, core and catalog, plus the non secret
  keys below in the ConfigMap block. **No `hostPrefix`, and no environment values file
  changes at all**, which is the whole saving from section 3's decision to go through the
  gateway: no new host means no `hostOverrides`, no DNS record, no certificate and no CORS
  origin, in either environment.
- **The gateway** gains the `/v1/assistant` proxy route and the config naming the service.
  It is the only gateway change, and it holds no assistant logic.
- **`apps/luna-shopper-backend/gateway/docs/openapi.json` must be regenerated**
  (`npx nx run luna-shopper-backend-gateway:openapi`) **in the same commit as that route**,
  because the gateway now has one more endpoint than the committed document says. The
  gateway's own suite fails on a stale file and PR checks run it, so forgetting this is a
  red PR rather than silent drift. An earlier draft of this plan routed the assistant on its
  own host and said this file was untouched; going through the gateway is what changed it.
- **`k8s/bootstrap/provision-release.sh`**: `GEMINI_API_KEY` added to the app Secret
  (`luna-shopper-backend-secrets`), prompted for the way the Google client secret is, and
  **added to `OPTIONAL_EMPTY_KEYS`**. That last part is deliberate and follows plan `0026`:
  an operator with no key gets a service that boots and answers 501 on its one route,
  rather than a pod stuck in `CreateContainerConfigError` and a cluster that never comes
  up. `--check` then keeps passing on a cluster where the assistant is unconfigured.
- **`k8s/helm/templates/luna-shopper-backend/_env.tpl`**: the `GEMINI_API_KEY`
  `secretKeyRef`, for this service only, and the non secret keys, which are
  `ASSISTANT_MODEL`, `ASSISTANT_MAX_TURNS`, `ASSISTANT_MAX_CHARS`,
  `ASSISTANT_MAX_TOOL_CALLS` and `GATEWAY_INTERNAL_URL`.
- **`k8s/e2e/luna-shopper-backend/compose.apps.yml`**: the tier 2 stack states its
  environment separately and inherits none of the above. A variable added in the chart and
  not here, or the reverse, produces one dead service while the gateway stays up and
  returns 500s, which is a slow thing to diagnose from the outside.
- **`k8s/e2e/luna-shopper-backend/luna-slot.sh` and `luna-slot.ps1`**: the generated per
  slot `.env` needs the same keys and the slot's port block needs an entry for 3005. A
  generated `.env` missing a newly required variable is the same failure as the line above.
- **`apps/luna-shopper-backend/assistant/`**: `project.json` with a `build:docker` target
  mirroring the other five, `src/Dockerfile`, and the hand written runtime `package.json`,
  whose missing entries kill the container at boot rather than at build.
- **`apps/velista/...`**: the panel calls the gateway base URL the app already has, so there
  is no new frontend environment value either. Velista `0032` section 5 covers it.

The key never enters the repository, and the suite does not need one, because of rule A4.

## 12. What it may not do

Absent from the tool catalog, not discouraged in the prompt:

- Deleting anything at all: no lines, no lists, no zones, no accounts.
- Zone governance: approve, kick, ban, roles, ownership transfer.
- Account operations other than the rename in 6.3: no deletion, no merge, no email or
  password change.
- Creating or joining zones, and creating lists.
- Everything in the catalog service, and every platform admin route from plan `0012`.

The bot may explain how to do any of these and name the screen that does it.

## 13. Where this departs from backlog 0005, on purpose

Recorded so the next plan puts them back deliberately rather than rediscovering them.

| Backlog `0005` says | This plan does | Why |
|---|---|---|
| `claude-opus-5` through the Anthropic SDK | Gemini Flash-Lite, free tier | It is a test, and the bill should be zero while it produces the usage data |
| Tools generated from the OpenAPI document | Three hand written tools | Three schemas are cheaper than a generator and its tests |
| Conversations stored, with turns and token usage | Stateless, client holds the transcript | Scope, not principle. Section 4 says what it costs and section 10 says where the usage data goes instead |
| Account operations excluded entirely, username changes named among them | `rename_me` included | Asked for, and it is one reversible self scoped `PATCH` that plan `0018` already made atomic. The excluded operations are none of those things |
| A separate service reached on its own surface | A separate service behind a gateway path | Same isolation, section 3, without a hostname and certificate per environment |
| The SDK tool runner's hooks carry the confirmation gate | A hand written loop | Different SDK. The gate is the same and lives in the service |

The two rules it does **not** depart from are the ones that matter: the assistant is an API
client carrying the caller's token, and the destructive surface is absent rather than
discouraged.

## 14. Open decisions

- ~~**Where a spoken turn is transcribed.**~~ **Settled by plan `0041`: this service
  transcribes.** `POST /v1/assistant/voice` takes a recording, Gemini's own audio input
  turns it into a sentence, and the existing turn loop answers that sentence — so a
  spoken turn becomes a typed turn as early as possible and is indistinguishable after
  that.

  It was settled the other way for a while, and the difference between the two answers is
  worth keeping straight, because neither was wrong when it was made. The first answer was
  settled **by the absence of an endpoint** rather than by an argument: this service
  shipped with no multipart route, no size cap and no speech provider, so the browser's
  `SpeechRecognition` was the only place left. `0041` section 2 is the argument, made once
  the endpoint was on the table, and it comes down to four things — Firefox has no
  `SpeechRecognition` at all and lost its microphone for that period; a dictation engine
  that ends itself on silence has seams a file does not; a multimodal model reads a
  bilingual shopping list better than a general dictation engine; and the privacy gain was
  smaller than it looked, because Chrome and Safari implement that API by sending audio to
  the browser vendor anyway.

  **Section 10's privacy line did not stay as written**, contrary to what this entry used
  to promise, and `0041` section 6 is why. It now says what a recording crosses.

  One prediction from the original text is worth recording as wrong in both directions: it
  expected `SpeechRecognition` to cost the pause button, and it did not — a session can be
  paused even though a stream has no file. Every control velista `0032` section 4 draws
  survived both reversals unchanged, because they were drawn about the person rather than
  about the capture.
- **The original text, for the reasoning:** That plan's section 4 records up to five minutes of audio with a pause button,
  which is a `MediaRecorder` feature: the browser's own `SpeechRecognition` returns text and
  no file, so there would be nothing to pause and nothing to hold at the limit. Backlog `0005`
  section 6 assumed the browser, and that assumption does not survive the design. Either this
  service grows a multipart endpoint and transcribes (a provider, or Gemini's own audio input,
  which takes audio where a text only API would not), or the client transcribes and sends
  text and the recorder becomes a local convenience. The first is what `0032` draws, and it is
  the one that changes this plan: a turn stops being cheap, the free tier's limits start
  counting minutes of audio rather than requests of text, and section 10's privacy line has to
  cover a voice recording rather than a sentence.
- Whether guests (the temporary users of plan `0005`) get the assistant at all. The cheapest
  abuse control available is to say no, and no is reversible.
- Whether an assistant made change is marked as such in the data. Leaning yes, because "why
  is there milk on the list" is a question somebody will ask, but it is a core change and
  this plan touches core not at all.
- Whether replies stream. Nicer, and a materially more complicated client. Leaning no for
  the test.
- Whether one conversation may act across zones. Leaning yes here: with three tools and no
  persistence there is little to confuse, and scoping is something the next plan can add
  once the transcripts say whether it was needed.

## 15. Exit criteria

- Every action goes through the gateway with the caller's token, and an action the caller
  could not perform by hand fails with the ordinary error, surfaced in words.
- The service reaches no application data except through the API with the caller's token,
  and it connects to no other service's database.
- It is reachable only through the gateway at `/v1/assistant`, and no new hostname,
  certificate or CORS origin was added in either environment.
- The three tools work, and nothing else is callable because nothing else is defined.
- A write that cannot be resolved to exactly one list asks instead of guessing.
- `rename_me` is a single `PATCH /account/me`, defaults to `MATCHING_ZONES`, and leaves a
  deliberately different per zone name alone.
- Every id the client can click came from a tool result in the same turn, and no link 404s.
- Off topic input gets a redirect and no tool call.
- A rate limited turn answers with a number of seconds **in the problem body**, and the panel
  counts it down rather than saying "later".
- The suite passes with no network access and never calls Gemini.
- A cluster with no `GEMINI_API_KEY` deploys, boots, answers 501 on the assistant route, and
  passes `provision-release.sh --check`.
