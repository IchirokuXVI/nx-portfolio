# 0021 (backlog) Every question over NATS shares one inbox

> **Status: discarded on 2026-10-13. Kept as information. Do not build it.**
> The owner read this plan and decided against it the same day. It was written as plan
> `0209` and never built. It stays here because its analysis of the wait is correct and
> useful: sections 1 and 2 say what the wait is and what sends over NATS. Nothing below is
> part of the build order. The "Brief for the agent" and sections 4 to 7 describe a change
> that nobody will make as written.

## Why this plan was discarded

The owner's words on 2026-10-13: "Seems like it is changing the very base of nats
communication in nest, which isn't a standard change." And: "Discard the plan, move it to a
backlog, purely as information and stating why it was discarded."

### 1. It only improves development

The wait of about 45 ms exists in one arrangement only: a process on the host that talks to
a NATS inside Docker Desktop, through the port proxy of Docker Desktop. That is how
`luna-slot.sh` runs a slot on a development machine. Section 1 has the measurement.

- **A cluster does not have that arrangement.** There every service and NATS are containers
  on one network, with no port proxy between them. Plan `0205` measured one hop at about
  2 ms on production and about 12 ms on staging, with the work inside it.
- **The e2e gates do not have it either.** `compose.apps.yml` runs the services as
  containers beside NATS.
- So no person who uses the app gets a faster answer, and no gate runs faster. The only
  gain is a slot that answers sooner: a basket read of about 450 ms becomes about 200 ms.

### 2. It changes critical internal code of a library

The design of section 4 extends `ClientNats` of `@nestjs/microservices` and overrides its
`publish` method.

- `publish` is not a documented point of extension. It is the inside of the client, and
  Nest can rename it, change its arguments or change what calls it in any release.
- The override also leans on `createSubscriptionHandler` and on `EmptyResponseException`,
  which the package does not export from its index.
- **Every question of every service passes through that method**, in production too. The
  gateway asks every backend service through it. A mistake there is not a slow page. It is
  an API that does not answer.
- A Nest upgrade that moves this code does not fail at compile time. It fails when a
  request is made.

### 3. It writes again what Nest already does well, and stops following Nest

With its own `publish` the project owns work that Nest does today:

- the life of the subscription that waits for an answer,
- the answer when no service listens (the status 503 that Nest turns into
  `EmptyResponseException`, which section 5 has to map back by hand),
- the packet id that matches an answer to its question,
- the end of the observable after the answer.

Each of these works today with no code of ours. After this plan each one is ours to keep
right. **A later release of Nest that improves or repairs that path does not reach us**,
because our override replaces it. We do not get the fix, and we do not learn that there
was one.

### 4. It does not remove the wait

Section 1.4 says so itself. The wait stays in these cases, and the client that asks can
remove none of them:

- two questions that leave in two writes,
- a service that writes two answers in a row,
- an event flushed just before a question,
- some message sizes (32 kB and 220 kB wait).

So a time measured on a slot is still not the time of a cluster. Whoever measures a route
on a slot still has to count the hops and correct for the wait, as plan `0205` describes.
The plan buys a faster slot. It does not buy a slot that can be trusted for timing.

### 5. Nothing tests that path before `main`

No spec in the repository asks a question through the NATS client of Nest on a real
broker. The gateway specs replace `NatsClient` with a fake, and the integration specs of
the services replace `ClientProxy`. Only the e2e suites cross the real client, and the
`e2e-luna` gate runs after a merge to `main`. A defect in the new class would thus show for
the first time on the way to staging. Section 6 adds specs, but they would be new and
unproven on the most used path of the backend.

### 6. It forces a decision that the code does not have today

`request()` of the `nats` library needs a timeout, and its default is one second. No
question over NATS has a deadline today. The plan passes the largest timer value, about 24
days, to keep that behaviour. That is a workaround for a library that expects a deadline.
A real deadline is a product decision (what a person sees when a service is slow), and it
does not belong in a change made for the speed of a slot.

### What already covers the need

- Plan `0205`, section "What the build decided", point 3, records the wait and how to
  correct a slot measurement for it.
- A read that asks fewer questions pays the wait fewer times. The rows read of plan `0205`
  is one example.

### If the question comes back

Two forms are worth a new plan, and this one is not:

- **The same class behind a switch that only a slot turns on.** A cluster and the e2e
  gates keep the client of Nest untouched, so reasons 2, 3 and 5 no longer apply to
  production. Reasons 1 and 4 remain.
- **The services of a slot inside the compose network.** Section 3 calls this the only
  option known to remove the whole wait. It costs watch mode in containers, the slot
  scripts and memory.

---

**The plan as it was written follows, unchanged.** It names itself plan `0209`, the number
it had in `plans/`. That number is free again.

**0209: every question over NATS shares one inbox**

> Asked for by the owner on 2026-10-13, after the measurement of plan `0205`: "The 45 ms
> wait. Create its own plan for this."
>
> Plan `0205` found that a read of a basket takes 430 to 490 ms on a development slot, and
> that about 80% of that time is one wait of about 45 ms on every round trip over NATS. A
> cluster does not pay it. **The owner has not chosen a fix.** This plan names the cause,
> compares the ways to remove it, and recommends one. Section 3 is the decision that waits
> for him.
>
> **Every choice in this plan that the owner did not make is marked "My choice".** He can
> overturn each one.
>
> Prerequisite reading: plan `0205`, section "What the build decided", points 1 to 5.
> Plan `0004`, sections 1 to 3 (the error envelope, correlation over the broker). Plan
> `0016`, section 4.3 (trace context over NATS).
> `gateway/src/app/messaging/nats-client.ts` and `messaging.module.ts`.
> `libs/luna-shopper/platform/src/lib/nats/correlation-headers.ts`,
> `telemetry/nats-propagation.ts`, `context/rpc-correlation.interceptor.ts` and
> `errors/global-exception.filter.ts`. In `node_modules/@nestjs/microservices`:
> `client/client-nats.js` (`publish`, `createSubscriptionHandler`), `client/client-proxy.js`
> (`send`, `createObserver`) and `server/server-nats.js` (`getPublisher`). In
> `node_modules/nats/lib/nats-base-client`: `nats.js` (`request`) and `protocol.js`
> (`sendCommand`, `processMsg`, `unsubscribe`). `CLAUDE.md`, section "Serving from a
> worktree: dev slots".

## Brief for the agent

### Objective

Make every client of the Luna backend that asks a question over NATS ask it through one
shared inbox for each connection. On a development slot a round trip that follows
another one then takes about 5 ms and not about 50 ms. Nothing that a caller, a service
or a client of the gateway can observe changes: not an answer, not an error, not a
header, not a trace.

### Context

Every statement below was read or measured on `origin/feat/luna-0205-basket-read-does-less-work`
at `@nestjs/microservices` 11.2.1 and `nats` 2.29.3. Check each one before you rely on it.

1. `ClientNats.publish` of Nest subscribes to a new inbox for each request, publishes,
   and unsubscribes after the answer. The subscribe and the publish leave in **one**
   write. The unsubscribe leaves **alone**, in a write of its own, after the answer.
2. On a slot the services run on the host and NATS runs in Docker Desktop. On that path
   the second of two writes in a row waits about 50 ms when nothing was read between
   them (section 1). The lone unsubscribe is the first write. The next question is the
   second.
3. `request()` of the `nats` library keeps one subscription for the life of the
   connection and writes only the publish. It never writes an unsubscribe.
4. Seven `ClientsModule.registerAsync` registrations build a `ClientNats`. Four of them
   ask questions (section 2 lists them). No request has a deadline today.
5. A throwaway patch of the gateway that asked through `request()` took the basket read
   from 430 to 490 ms down to 160 to 260 ms. It skipped the error mapping and it was not
   committed.

### Target state

1. `libs/luna-shopper/platform` exports one client class and one helper that builds the
   options of a `ClientsModule` registration (section 4).
2. All seven registrations use the helper. A spec refuses a registration that does not.
3. An integration spec of the client passes on a real NATS (section 6).
4. The pull request holds the tables of section 7, before and after.
5. The existing specs pass unchanged. No spec was edited to make it pass.

### Scope

- `libs/luna-shopper/platform/src/lib/nats/`: the client, the helper, their specs, and
  the export in `src/index.ts`.
- The seven registrations: `gateway/src/app/messaging/messaging.module.ts`,
  `core/src/app/profiles/profiles.module.ts`, `core/src/app/events/core-events.module.ts`,
  `catalog/src/app/catalog/catalog.module.ts`, `harvester/src/app/harvest/harvest.module.ts`,
  `realtime/src/app/realtime/realtime.module.ts`, `auth/src/app/app.module.ts`.
- This plan file, for the section that records what the build decided.

### Constraints

- **The wire format does not change.** A request is still `{pattern, data, id}` with the
  headers of today. An answer is still `{err, response, isDisposed, id}`. A service of
  the old build and a client of the new build talk to each other, because staging deploys
  only the affected services.
- **Error handling does not change.** A problem envelope that a service answers still
  reaches `GlobalExceptionFilter` in the same shape. A question that nobody listens to
  still fails with the same message and still becomes a 500.
- **No deadline is added.** A request waits as long as it waits today (section 5).
- **Headers and traces are built above the client.** `NatsClient.send`,
  `buildNatsHeaders` and `traceNatsSend` do not change.
- **Only `publish` is overridden.** `emit`, the connection, the status handling, the
  serializer and the deserializer stay those of Nest.
- No new environment variable and no switch (section 4, point 7).
- No change to `openapi.json`. This plan touches no route and no contract.

### Action boundaries

- Do not change `luna-slot.sh`, `run-services.sh`, a compose file, the chart or
  `nats.conf`.
- Do not change any `main.ts`, the readiness check, the JetStream consumer of realtime or
  the raw connection of `impersonation-sessions.service.ts`.
- Do not parallelize, merge or cache any read. That was plan `0205`.
- Stop and ask before you add a deadline to any request, of any length.
- Stop and ask if a handler of a `@MessagePattern` answers more than one time.
- Stop and ask if a spec that exists today fails and the fix is a change to that spec.
- Stop and ask if the probe of section 7 does not fall under 10 ms after the change.
- Stop and ask before you patch a file under `node_modules` or override a second method
  of `ClientNats`.
- Stop and ask if the owner chose another option of section 3. Then this brief does not
  hold.

### Progress evidence

- The tables of section 7 measured on the base branch, posted first.
- The integration spec of section 6, red against `ClientNats` where section 6 says so
  and green against the new client.
- The same tables after the change.
- `npx nx run-many -t lint test -p luna-shopper/platform luna-shopper-backend-gateway luna-shopper-backend-core luna-shopper-backend-catalog luna-shopper-backend-harvester luna-shopper-backend-realtime luna-shopper-backend-auth`
  passes.
- `npx nx run luna-shopper/platform:test-integration` passes on a slot.
- `npx nx run-many -t build -p` with the same seven backend projects passes. Only a
  build checks the types.
- The `velista-luna-e2e` suite passes against a slot that runs this branch.

## 1. What the wait is

All figures of this section were measured on 2026-10-13 with two bare connections of
the `nats` library on the host: one that asks and one that answers at once. NATS was the
container of slot 0, reached through the published port of Docker Desktop on Windows.
Each figure is the median of 30 round trips after 5 that were thrown away. The subjects
were private to the probe. Nothing of a slot was started or stopped.

### 1.1 The rule

**Two writes in a row on one connection, with nothing read between them. The second one
waits about 50 ms.** Every row below follows from that rule.

| What the asking side does | Round trip |
| --- | --- |
| The way of Nest: subscribe and publish, unsubscribe after the answer | 50.0 ms |
| The same, and the subscription is never removed | 0.9 ms |
| The same, and the unsubscribe is written together with the next request | 0.9 ms |
| `request()` of the library, one inbox | 1.0 ms |
| An event published in a write of its own, then a question | 50.0 ms |
| An event and a question written together | 1.0 ms |
| Two questions in one write, answered in one write | 1.0 ms |
| Two questions in one write, answered in two writes | 50.0 ms |
| Two questions in two writes, answered in one write | 50.1 ms |
| An answer of 1 to 16 kB | 1.0 ms |
| An answer of 32 kB | 50.0 ms |
| An answer of 64 kB | 50 ms in one run, 1.3 ms in another |
| An answer of 128 kB | 1.3 ms |
| An answer of 220 kB | 50.0 ms |
| A request of 8 kB | 1.1 ms |
| A request of 32 kB | 50.0 ms |

- The slow figures are 50 ms at the median and 60 ms at the 95th percentile, in every
  row. That looks like a timer somewhere on the path.
- A message that is large enough leaves in several pieces. Whether its last piece waits
  depends on how the pieces fall. That is why 32 kB waits and 128 kB does not.

### 1.2 Why every hop in a row pays it

`ClientNats.publish` calls `subscribe` and `publish` one after the other. The library
collects both and writes them together at the end of the turn. So a question is one
write.

The answer arrives. The observable of Nest completes, and its teardown calls
`unsubscribe`. The library writes that `UNSUB` at the end of the same turn, alone. The
code that waited for the answer continues a few turns later and asks the next question.
That is the second write, and it waits.

So the wait belongs to the question that **follows** an answer on the same connection.
A new inbox for each request is not the cost by itself: with the subscription left in
place the round trip is 0.9 ms. The cost is the unsubscribe that leaves alone.

### 1.3 Where the 50 ms pass

Not proven. What is known:

- The `nats` library sets `TCP_NODELAY` on its socket.
- From a container inside the compose network of the slot the way of Nest takes 5 ms
  (plan `0205`, point 3). So the path from the host into Docker Desktop is part of it.
- It is not a delayed acknowledgement inside the NATS container. A NATS container with
  `quickack 1` on both of its routes gave the same figures, row for row.
- A cluster does not pay it. A hop costs about 2 ms on production and about 12 ms on
  staging (plan `0205`, point 3).

Whether the port proxy of Docker Desktop holds the second write, or the loopback of
Windows does, was not separated. Section 3 says which option needs that answer.

### 1.4 What one inbox removes, and what it leaves

It removes the lone `UNSUB`. A hop that follows another hop then takes the time of the
work and about 1 ms.

It leaves every other row of the table, because those are not writes of the asking
client alone:

- **Two answers from one service, written one after the other.** A service answers each
  request in a write of its own. The gateway asks core two questions together, core
  answers both within a few milliseconds, and the second answer waits. This is the
  `basket.priceChoices` row and the "seven together" row of plan `0205`, point 4, which
  stayed at 50 ms with one inbox. This reading is from the probe and from the code. It
  was not observed inside a running core.
- **A large message.** The answer of `item.getMany` for a basket of 100 lines is such a
  message.
- **Two events in a row** on the connection of an event publisher. The second reaches
  realtime 50 ms later. No request waits for it.

Plan `0205` measured the result: 160 to 260 ms for a read that is about 65 ms of work.

## 2. Everything that sends over NATS

| Sender | Registration | Sends | Affected |
| --- | --- | --- | --- |
| Gateway, `NatsClient` | `messaging.module.ts` | questions to every service, for every route | yes, the most |
| Harvester, `CatalogClient` | `harvest.module.ts` | questions to catalog, thousands in a row in one run | yes |
| Core, `PostalCodeClient` | `profiles.module.ts` | questions to catalog | yes |
| Realtime, `CoreAccessClient` and the support session check | `realtime.module.ts` | questions to core and to auth | yes |
| Core, `CoreEventsPublisher` | `core-events.module.ts` | events only | no |
| Catalog, `CatalogEventsPublisher` | `catalog.module.ts` | events only | no |
| Auth, `IdentityEventsPublisher` and the orphan reaper | `app.module.ts` | events. Check what the reaper sends | check |
| Every service, `connectMicroservice` in `main.ts` | none | answers | no, it only answers |
| Every service, the readiness check | none | a connect and a close | no |
| Realtime, `JetstreamConsumer` | none, a raw connection | a JetStream consumer | no |
| Realtime, `ImpersonationSessionsService` | none, a raw connection | a subscription to events | no |
| Assistant | none | nothing of its own | no |

Three facts hold for every row that asks:

- Each caller builds a `NatsRecord` with `buildNatsHeaders` inside `traceNatsSend`, then
  calls `ClientProxy.send` and takes the first value. The correlation id, the locale and
  the `traceparent` are headers of that record. The client under them only carries the
  headers. So a change inside `publish` cannot lose them.
- A service reads the headers from the message it received. It answers to the reply
  subject of that message, whatever its form (`getPublisher`). A shared inbox changes
  the form of that subject and nothing else on the service side.
- An event does not pass through `publish`. `emit` calls `dispatchEvent`.

## 3. The options, and the one this plan recommends

**This is the decision of the owner.** The recommendation is **My choice**.

| | Option | Sequential hop on a slot | What still waits | Cost | Risk |
| --- | --- | --- | --- | --- | --- |
| A | Leave it | 50 ms | everything | none | Every measurement on a slot must be corrected by hand, as plan `0205` did. A harvest run on this machine spends most of its time in the wait. |
| B | **One inbox at every asking client** | about 5 ms | answers written in a row, large messages | One class of about 40 lines, seven registrations, two specs | It is on the path of every request in production. Section 5 lists what could differ. |
| C | The subscription ends itself (`max: 1`, or `request` with `noMux`) | 50 ms in the real flow | everything | small | It does not work. See below. |
| D | The services of a slot run inside the compose network | 5 ms (plan `0205`) | nothing | High: the slot scripts, the ephemeral mode, watch mode in a container, memory | A slot that is slower to start and to rebuild, on the machine that already runs short of memory. |
| E | NATS of a slot runs on the host, outside Docker | not measured | not known | Medium: a pinned binary for each developer, the slot scripts, the JetStream directory | It may change nothing. Section 1.3 did not separate the proxy from the loopback. |
| F | Turn on quick acknowledgement in the NATS container | 50 ms | everything | small | Measured. It changes nothing. |

**Why C does not work.** A subscription with `max: 1` writes its `UNSUB` together with
the `SUB`, and in a bare loop it takes 0.9 ms. But the library writes a second `UNSUB`
after the answer (`processMsg`, then `unsubscribe`). In the bare loop that second one
happens to leave with the next request. Behind the promise chain of `ClientProxy.send`
it leaves alone, as today. The fast figure of the probe would not survive the real
caller.

**Why B, and not D or E.**

- B removes the cause that every hop in a row pays. That is every hop in a row of a
  basket read and every hop of a harvest run.
- B asks nothing of the slot scripts, which every worktree and the curation tool depend
  on.
- B also does less on a cluster: one protocol message for each request where there are
  three, and no subscription that the broker adds and removes for each request. No
  figure of a cluster is promised for that. It is not the reason.
- D is the only option that is known to remove the rest. Its price is the watch mode of
  seven services inside containers on Windows. The rest that it removes is paid on a
  development machine alone.
- E is cheap to test and nobody tested it. It is worth one measurement before anybody
  plans it: a `nats-server` on the host and the probe of section 1.

**What B costs in plain words.** Every request of every route in production goes through
about 40 lines that replace 20 lines of Nest. The gain is paid out on development
machines only. The owner can reasonably choose A for that reason. **My choice** is B,
because a slot is where every change is checked and measured, and because the harvest
runs on this machine.

**The rest is left** (**My choice**). After B a slot is still slower than a cluster where
a service answers two questions together and where an answer is large. That does not
matter enough to pay for D. What matters is that nobody reads it as work. Section 8 says
how a trace shows it.

## 4. The design

1. **One class in the platform library**, in `libs/luna-shopper/platform/src/lib/nats/`.
   It extends `ClientNats` and overrides `publish` alone.
2. **`publish` does what the method of Nest does up to the subscribe**: it assigns the
   packet id, normalizes the pattern, serializes the packet and merges the headers. Then
   it calls `request()` of the connection with the serialized data, the headers and the
   deadline of section 5. It does not subscribe and it does not create an inbox.
3. **The answer goes through `createSubscriptionHandler` of Nest**, the method that
   handles an answer today. So the check of the packet id, the deserializer and the
   passing of `err` are the code of Nest and not a copy.
4. **A question has one answer** (**My choice**). The class marks the first answer as the
   last, so the observable completes. `request()` delivers one message and drops a later
   one. No handler of today answers more than one time: check each `@MessagePattern` for
   a handler that returns an observable with several values, and stop if one exists.
5. **A question that nobody listens to fails as it fails today.** Today the broker sends
   an empty message with status 503 to the inbox, and Nest turns it into an
   `EmptyResponseException`. `request()` rejects with a `NatsError` of code `503`. The
   class maps that code to the same exception with the same message. The package does
   not export that class from its index. Import it from its own file, or throw an error
   of the same message if that import is refused by lint. Nothing in the repository
   reads its class.
6. **The teardown that `publish` returns drops a late answer.** It cannot remove a
   subscription, because there is none. An answer that arrives after the caller left is
   ignored.
7. **No switch** (**My choice**). A flag to fall back to the client of Nest would be an
   environment variable in seven services, the ConfigMap, the template and both slot
   scripts. A revert of the pull request is the way back.
8. **One helper builds a registration.** It takes the URL and answers
   `{ customClass, options: { servers: [url] } }`, which `ClientProxyFactory` accepts.
   Each of the seven `useFactory` functions calls it.
9. **All seven registrations use it, also the three that only publish events**
   (**My choice**). An event never reaches `publish`, so nothing changes for them. The
   rule is then one sentence, and a client that gains a question later is already right.
10. **A spec keeps the rule.** It reads the sources of `apps/luna-shopper-backend` and
    fails on a `ClientsModule` registration that names `Transport.NATS`. It names the
    file. `no-unguarded-history-back.spec.ts` of velista is the model.

## 5. What could differ, and what the builder does about each

| Point | Today | With one inbox | Decision |
| --- | --- | --- | --- |
| A service answers a problem envelope | `{err}` reaches the filter, which passes it on | the same code path | nothing to do, the spec asserts it |
| Nobody listens | `EmptyResponseException`, a 500 | the same, by point 5 of section 4 | mapped |
| A service listens and never answers | the request waits for ever | the same | see below |
| The caller leaves before the answer | the subscription is removed | the answer is dropped on arrival | accepted |
| The connection drops with a request in flight | the request waits for ever | the same while the library reconnects. A rejection after it gives up | accepted, it is the better of the two |
| A handler answers two times | both values arrive | the first arrives | point 4 of section 4 |
| The reply subject | `_INBOX.<random>` | `_INBOX.<connection>.<token>` | `nats.conf` has no permissions, so nothing reads it |
| An upgrade of Nest renames a protected method | not applicable | the build fails, or the spec of section 6 does | accepted |

**The deadline** (**My choice**, and the first thing to overturn). `request()` requires
one, and its default is one second. No request of the backend has a deadline today, and
some are long: a batch write of a harvest, an answer of the assistant, a bulk route of
the back office. A short deadline is a new way to fail in production. So the class
passes the longest delay a timer of Node accepts, about 24 days, which is no deadline in
practice. A request that is never answered then holds one timer and one entry of a map
until the process ends. Today it holds a subscription for as long.

A real deadline is a decision about what a person sees when a service hangs. It needs
the longest honest duration of each kind of request first. It is not in this plan.

## 6. The specs

**The client, on a real NATS.** One integration spec in the platform library, with
`describeIntegration`, beside `nats-propagation.integration.spec.ts`. It starts a Nest
microservice with two or three handlers on private subjects and asks it through the new
client. It asserts:

1. A question gets its answer.
2. Twenty questions asked together each get their own answer, and none gets the answer
   of another.
3. A handler that throws a `DomainException` reaches the caller as the problem envelope,
   with its `status`, `code`, `message` and `correlationId`.
4. The handler received the correlation id, the locale and the `traceparent` that the
   caller set.
5. A question on a subject with no listener rejects with the message that `ClientNats`
   gives for it. Run this case against `ClientNats` too, so that the two are compared and
   not assumed.
6. **The connection holds one subscription after 100 questions, and it held one after
   the first.** Read it from the monitor port of the broker, `/connz?subs=1`, by the name
   of the connection. This is the assertion that fails if somebody puts the inbox for
   each request back. It does not depend on a clock. Against `ClientNats` the count moves,
   and that is the red run that the progress evidence asks for.
7. An event sent with `emit` arrives, with its headers.

No spec asserts a duration. A duration on this path is a fact of one machine.

**The rule of point 10** of section 4, as a unit spec.

**The specs that would catch a regression today:**

- `global-exception.filter.spec.ts`: the envelope and what the filter passes on.
- `nats-propagation.spec.ts` and `nats-propagation.integration.spec.ts`: the headers and
  the trace. The integration spec uses bare connections, so it does not exercise the
  client of Nest.
- The 36 specs of the gateway that play `NatsClient`. They prove the callers, not the
  client.
- The integration specs of the harvester hand a played `ClientProxy` to `CatalogClient`.
  They do not cross NATS.
- **No spec of today asks a question through the client of Nest on a real broker.** The
  only runs that do are the e2e suites over the compose stack: `velista-luna-e2e`, and
  the `e2e-luna` gate of the staging workflow. That gate runs on a push to `main`, after
  the pull request merged. So run `velista-luna-e2e` against a slot before you open the
  pull request. The memory note on that suite has the recipe.

## 7. The measurement

On a Luna slot of your own. Run `luna-slot.sh --list` first, and give the slot back with
`--down` at the end. The `observability` profile gives the traces.

Measure on the base branch first, then on this branch, with development builds, on the
same slot and the same data. Each figure is the median of 20 after 5 that are thrown
away.

1. **One hop against no hop**, over one kept connection: a public route of the gateway
   that crosses NATS one time, and one that crosses it no time. Plan `0205` measured
   50.2 ms against 1.6 ms and did not name its two routes. Name yours in the table.
   **After the change the difference is under 10 ms.** If it is not, stop.
2. **The six reads of plan `0205`, point 2**, and the four rows reads of point 8, in the
   world of point 1 of that plan. Before: 430 to 490 ms and 220 to 230 ms. Expected
   after: 160 to 260 ms for the full reads.
3. **The stage table of `GET /v1/baskets/:id`**, read by the owner at a shop, from one
   trace. It should match the "One inbox" column of plan `0205`, point 4. Mark each
   stage that still takes about 50 ms, and say which case of section 1.4 it is.
4. **The count of subscriptions** of the gateway connection on the monitor port, before
   and after 100 requests.
5. **The cluster**, after the change reaches staging: the probe of point 1 there. Plan
   `0205` measured 74.4 ms against 62.7 ms. It must not be worse. This is a line added to
   the plan after the deploy, not a condition of the pull request.

A harvest run was not measured for this plan. If a store discovery run of one postal
code is cheap to repeat on your slot, add its duration before and after. Do not start a
price crawl for it.

## 8. What a slot still does after this plan

Write this into the doc comment of the class, so that the next person who reads a trace
finds it:

- A hop that follows another hop takes its work and about 1 ms.
- A hop of about 50 ms on a slot is the wait and not work, when it ran beside another
  hop to the same service or when its answer is larger than about 30 kB.
- A cluster shows neither.

## 9. Not in this plan

- **A deadline for a request over NATS**, and what a person sees when a service does not
  answer. It is a real gap: a request to a service that hangs waits until something
  outside the backend gives up. It needs its own decision.
- **The rest of the wait on a slot**: the services inside the compose network, or NATS on
  the host. Measure option E before anybody plans either.
- **The cause below the rule of section 1.1.** This plan removes the write that triggers
  the wait. It does not explain the 50 ms.
- Any change to what the basket read asks. Plan `0205` settled that.
