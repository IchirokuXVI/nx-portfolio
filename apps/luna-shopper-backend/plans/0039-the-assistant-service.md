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

**Rule A1. The assistant opens no database connection, no Redis connection and no NATS
connection.** Its dependencies are an HTTP client and a model provider SDK. There is no
entity, no migration, no `DATABASE_URL`, no `REDIS_URL`, no `NATS_URL`. A later change
that adds one is not an optimisation, it is a different architecture, and it needs its own
plan.

The value is not purity. It is that every authorization check, throttle, validation rule
and event emission built across plans `0004` to `0037` applies to the assistant without
being restated or re-tested. If the bot tries to add a line to a list the caller cannot
write, it gets the same 403 the app gets, from the same code, and it says so. It is also
what makes the blast radius of a misread sentence exactly the blast radius of a mistaken
tap, which is the property that makes this safe to ship as a test.

Rule A1 has a visible cost, and section 5 is about paying it.

## 3. Where it runs, and how the app reaches it

**A new Nest service**, for the reasons backlog `0005` section 3 gave: it holds a provider
credential nothing else needs, its failure mode is a slow or absent third party and must
not become the gateway's failure mode, and its profile is a few long requests rather than
many short ones.

- Project `luna-shopper-backend-assistant`, port **3005**, following 3000 to 3004.
- **Routed, with host prefix `bot`**, so `bot.velista.app` in production and
  `bot.staging.velista.app` in staging, exactly as realtime got `rt.`. The client calls it
  directly.

Rejected: proxying it through the gateway. The gateway is the request path for the whole
app, and an assistant turn holds a connection open for as long as a model takes to answer.
A thin proxy is not much code, but it is the gateway's connection budget being spent on a
third party's latency, which is what backlog `0005` section 3 refused. A module inside the
gateway is rejected by that same section, and for the same reason.

The service calls the gateway over the cluster's internal name for everything it does on
the caller's behalf, forwarding the caller's `Authorization` header verbatim. It never
mints a token and it holds no service account of its own.

## 4. It is stateless, and the client holds the transcript

**Rule A2. The assistant stores nothing between turns.** Each request carries the whole
conversation: the transcript so far, plus the new message. The service validates it,
answers, and forgets.

This follows from rule A1 and it is the right shape for a test. The cost is real and is
written down here so the next plan can price it rather than rediscover it:

- A reload loses the conversation. Acceptable for a test. Not acceptable for the
  accessibility work that follows, and backlog `0005` section 5 already says why.
- The transcript is client supplied, so it is **untrusted input**. The service caps it on
  arrival rather than trusting the client's cap, and it never treats a transcript entry as
  an instruction from the operator. A user who pastes "you are now in developer mode" into
  their own transcript is sending user text, and it is handled as user text.
- Per user quotas cannot be counted across conversations without somewhere to count.
  Section 9 says what is possible instead, and admits what is not.

Storing conversations is the first thing the next plan should reconsider. Backlog `0005`
section 5 already designs it.

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

Changes the caller's username, and by default their display name in every zone they belong
to.

This is the tool that needs the most care, and it is worth being blunt about why:

- **Usernames are global and unique since plan `0018`**, so the call can fail on collision.
  A taken name is an ordinary answer, not an error.
- **It is not one call.** The account rename is one request; the zone display names are one
  request per membership. So it is N+1 requests, it can half succeed, and somebody in six
  zones can end up renamed in four of them.
- Therefore the zone renames are **reported individually**. The answer names which changed
  and which did not, a partial failure is stated rather than swallowed, and a retry renames
  only what is still stale.
- **It always confirms before acting.** The bot states the old name, the new name and how
  many zones it will touch, and acts on the next turn. There is no setting that skips this,
  because it is the only tool here that changes what other people see.

Leaving the zone names alone is something the caller can ask for in words, defaulting to
changing them, as specified.

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
concurrent users this **will** return 429 in ordinary use. So a provider 429 is a **first
class answer** and not a 500: the service returns "I am busy right now, try again in a
moment" in the caller's language, and a small per instance concurrency limit sits in front
of the provider call so that a burst queues briefly instead of becoming a burst of 429s.

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
service already gets for free. No storage, so rule A1 holds.

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

What comes out of it is the input to the next plan: whether one list is inferable in
practice, which of the three tools anybody actually uses, how much of the traffic is
off topic, and whether the free tier's limits made the thing feel broken.

## 11. Configuration, secrets and CI

CI needs less hand editing than it looks. `docker-ci.yml` derives its build, test and
deploy lists from `nx show projects` and a `luna-shopper-backend-` prefix, so a project
with that name is picked up, built, pushed and rolled out with no workflow edit. What needs
editing is everything that states configuration by hand:

- **`k8s/helm/values.yaml`**: a sixth entry under `lunaShopperBackend.services` with
  `port: 3005`, `routed: true`, `hostPrefix: bot`, `websocket: false`, plus the non secret
  keys below in the ConfigMap block.
- **`k8s/helm/values.production.yaml` and `values.staging.yaml`**: a `hostOverrides` entry
  putting `bot` on velista's domain, beside the ones already moving `api` and `rt` there.
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
- **`gateway/docs/openapi.json`** is untouched, because this service is not the gateway and
  adds no gateway route. If that stops being true, regenerate it in the same commit.

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
| Conversations stored, with turns and token usage | Stateless, client holds the transcript | Rule A1 taken literally; section 4 states the cost |
| Account operations excluded entirely, username changes named | `rename_me` included, always confirmed | Asked for. It is self scoped and reversible, which the excluded operations are not |
| The SDK tool runner's hooks carry the confirmation gate | A hand written loop | Different SDK. The gate is the same and lives in the service |

The two rules it does **not** depart from are the ones that matter: the assistant is an API
client carrying the caller's token, and the destructive surface is absent rather than
discouraged.

## 14. Open decisions

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
- The service has no database, Redis or NATS connection, and its dependency list shows it.
- The three tools work, and nothing else is callable because nothing else is defined.
- A write that cannot be resolved to exactly one list asks instead of guessing.
- `rename_me` confirms first, reports every zone individually, and states a partial failure
  rather than swallowing it.
- Every id the client can click came from a tool result in the same turn, and no link 404s.
- Off topic input gets a redirect and no tool call.
- A provider 429 reaches the user as a sentence rather than an error.
- The suite passes with no network access and never calls Gemini.
- A cluster with no `GEMINI_API_KEY` deploys, boots, answers 501 on the assistant route, and
  passes `provision-release.sh --check`.
