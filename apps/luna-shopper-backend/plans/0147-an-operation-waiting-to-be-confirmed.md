# 0147: an operation waiting to be confirmed

> **Status: on hold since 2026-09-23. Do not build this plan until the product owner resumes
> the assistant.** All development on the assistant is paused, and that covers this plan, `0148`
> and the velista plan for the confirm button that neither of them has yet. The product
> suggestion card (velista `0101`) is not paused. It continues without the parts that belong to
> the assistant, and that plan names them. Nothing in this plan is needed by the card: the card
> reads `GET /v1/catalog/suggest` and never an assistant route.

> Frontend half: a velista plan, not written yet, and blocked on this one. Nothing here is
> reachable from the app until it lands, because the button this plan describes is a velista
> control. What this plan delivers is the store, the two routes, the two tools and the
> contract they answer with.
>
> Prerequisite reading: `0039` sections 2, 4, 5, 7 and 10 (rules A1, A2, A3 and A5, the
> storage decision this plan reopens, and the turn record), `0043` sections 3.1 and 3.3 (the
> confirmation that exists today and why it is a round trip), `0044` (a turn that may only
> touch one list), `0046` (the one link and the choices), and `0028` sections 3, 4 and 5
> (Redis in the platform, and what every caller of it does when it is down). In the code:
> `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts`, `assistant.service.ts`
> and `turn-context.ts`.

Confirming something the assistant offered costs a whole turn and confirms an operation
nobody stored. This plan stores it, gives it an id, and lets a tap on a button finish it
without the model being called at all.

## Brief for the agent

### Objective

Give the assistant a short lived store of operations somebody has been asked to confirm, so
that a confirmation is a twelve character tool argument or a button press rather than a
reconstructed write, and so that what gets written is exactly what was agreed to.

### Context

- The assistant service holds no database and no cache. Rule A2 says it stores nothing
  between turns, and `0039` section 4 names adding a store as "the first thing the next
  plan should reconsider". This is that plan, and it reconsiders exactly one thing.
- Confirmation exists today in two tools. `remove_lines` and `rename_me` return
  `needsConfirmation`, the model asks in words, and the **next turn calls the same tool
  again with `confirmed: true`**. The transcript is the only state, and the model rebuilds
  the arguments from it.
- Line ids are valid for one turn. `TurnContext.knownLine` refuses an id this turn did not
  read from the gateway, which is rule A3, so a second turn that confirms a deletion has to
  call `query_lists` again before it can name the same lines.
- `RedisService` already exists in `@portfolio/luna-shopper/platform` (`0028`). The gateway
  and realtime require `REDIS_URL`, and the assistant is not given it today. The image is
  `redis:7-alpine` in both the compose stack and the chart, so `GETDEL` is available.
- The assistant reaches application data only through the gateway, carrying the caller's own
  `Authorization` header (rule A1). It mints no token and holds no service account.
- The service has no translator. `NOTHING_HEARD` and `RAN_OUT_OF_TIME` are English because
  of it, and every localized sentence a caller sees comes either from the model or from the
  gateway's own error catalog.

### Target state

- A tool that needs a yes writes an operation to Redis, keyed to the caller, dead in five
  minutes, and returns its id.
- `POST /v1/assistant/operations/{operationId}/confirm` executes that operation with no
  model call of any kind, and `DELETE /v1/assistant/operations/{operationId}` throws it away.
- Inside a turn, `confirm_operation` and `discard_operation` do the same two things, so a
  person who types "yes" is served as well as a person who taps.
- An operation can be confirmed once. A second attempt says what happened to it the first
  time, and one past five minutes says it expired.
- With Redis unreachable, every tool behaves exactly as it does today and no existing spec
  changes its expectations.

### Scope

Work only in:

- `libs/luna-shopper/contracts/src/lib/enums/assistant.enums.ts`,
  `lib/messages/assistant.messages.ts` and `schemas/messages/assistant.schemas.ts`
- `libs/luna-shopper/platform/src/lib/errors/error-codes.ts`, `error-catalog.ts` and
  `domain-exception.ts`
- `apps/luna-shopper-backend/assistant/src/app/` (a new `operations/` folder, `tools.ts`,
  `assistant.service.ts`, `assistant.controller.ts`, `assistant.module.ts`, `app.module.ts`,
  `config/app-config.ts`, `prompt.ts`)
- `apps/luna-shopper-backend/gateway/src/app/assistant/` (controller, DTO, module)
- `apps/luna-shopper-backend/gateway/docs/openapi.json` (regenerated, never edited)
- `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts` (regenerated, never edited)
- `k8s/helm/templates/luna-shopper-backend/_env.tpl`,
  `k8s/e2e/luna-shopper-backend/compose.apps.yml`,
  `apps/luna-shopper-backend/assistant/.env.example`

Do not touch: anything under `libs/velista/` or `apps/velista/`, anything under
`libs/luna-shopper-admin/` except the regenerated wire types, core, auth, catalog,
harvester, `settle_lines`, `query_lists`, `rename_me`, the voice path, or the model provider.

### Constraints

- **The stored operation never holds a credential.** No `Authorization` header, no token,
  nothing that would let anybody act as the caller. A confirmation carries its own header and
  the write goes through the gateway with it, so rule A1 is untouched.
- The assistant gains **no database connection**. Redis is a cache with a clock, not a
  database, and the "No TypeOrmModule" comment in `app.module.ts` stays true and stays there.
- Redis being down must never stop the service booting and must never lose a feature.
  Section 10 is the whole degraded mode and it has to be implemented, not described.
- Only make changes directly requested. The similarity matching, the "there is already one of
  those on the list" question, and any change to `upsert_lines` belong to `0148` and are not
  in this branch.
- Plain Redis commands. No Lua script, no new npm dependency, no second Redis client.

### Action boundaries

Stop and ask before: storing anything derived from the caller's token, adding a per operation
environment variable, changing what rule A1 or rule A3 mean, giving the assistant a database,
or changing `settle_lines` to confirm anything.

### Progress evidence

After each section output: the files changed, the spec command you ran and its result, and
for section 5 the exact Redis commands the store issues, in order, for a create and for a
confirm.

### Session strategy

New session, and build `0147` alone. `0148` depends on the store existing and is a separate
session against a separate branch.

## 1. What confirming costs today, and what it gets wrong

Two problems, and the second one is the reason to do this.

**It costs a whole turn.** A "yes" arrives as text, so it runs the full loop: the system
prompt, the capped transcript, five tool declarations, a first model call, a `query_lists`
because the line ids from the previous turn are no longer valid, a second model call, and
then the write. The write itself is the cheapest part of it.

**It confirms an operation nobody wrote down.** The model reconstructs the arguments from the
transcript. Nothing checks that the second call is the same call the person agreed to. A
different quantity, a sixth item, the other list and a line that has since been read under a
different id all pass, because there is nothing to compare against. The person said yes to a
sentence, and what runs is whatever the model builds next.

A stored operation fixes the second one outright and the first one whenever the person taps
rather than types. That ordering matters: this is a **correctness** change that happens to be
cheaper, and a plan that sold it on tokens alone would be talked out of it by the first person
who priced a Redis round trip.

## 2. Rule A6, and what it does to rule A2

**Rule A6. The assistant stores one thing between turns: an operation somebody has been asked
to confirm.** It holds the intent of a write, it belongs to one user, it dies in five minutes,
it can be used once, and it carries no credential and no conversation.

Rule A2 is otherwise unchanged and stays worth stating: the transcript is still client
supplied and still untrusted, no conversation is stored, no context is cached across callers
and nothing about a turn outlives it. What A6 adds is deliberately not a conversation store.
Backlog `0005` section 5 still owns that, and nothing here brings it closer.

Rule A3 is narrowed rather than broken, and the narrowing has to be written down or the next
reader finds a contradiction. Today: an id in a write came from a gateway read **in this
turn**. With an operation: the ids inside it came from a gateway read **in the turn that
created it**, made by this same caller, within the last five minutes. Both guarantee the thing
rule A3 exists to guarantee, which is that the id came from the gateway and not from a
sentence the model wrote. What the second one gives up is freshness, and section 7 is where
that is paid for.

One consequence to decide once rather than per tool: an operation that adds two of something
stores **a delta**, and one that sets a quantity to three stores **an absolute**. A delta
survives somebody else editing the line in between and an absolute overwrites it. That is the
right answer for both, because "two more" means two more than whatever is there now and "make
it three" means three.

## 3. Where it lives, and the two designs that lose

| Design                             | Single use                                       | Survives a restart          | New infrastructure                                | Verdict           |
| ---------------------------------- | ------------------------------------------------ | --------------------------- | ------------------------------------------------- | ----------------- |
| Redis key with a TTL               | `GETDEL`, one command                            | Yes, Redis outlives a pod   | None, `0028` already ships it                     | **This one**      |
| A signed token carrying the intent | No, it is a bearer capability and replays        | Yes                         | None                                              | Loses             |
| A `pending_operations` table in core | Yes, a row and a status                        | Yes                         | Migration, sweep, a concept core does not need    | Loses, for now    |

The signed token is the tempting one and it fails on the requirement that matters. A token
holding its own intent needs no store, which means nothing can mark it spent, which means a
double tap writes twice. Adding a spent set to fix it puts the state back in Redis and leaves
the intent on the wire, where it costs tokens in the model's context for no benefit.

The core table wins on one axis and it is worth naming, because it is the door out of this
design if the button becomes a product wide mechanism: with the operation in core, the confirm
path never touches the assistant, so it keeps working on a deployment that has no
`GEMINI_API_KEY` and answers 501 on every assistant route. Today the button exists only
because the assistant offered it, so that is a cost with no buyer. If a second feature ever
wants to offer a confirmable operation, move it to core and delete this section.

**In process memory is not on the list.** The assistant runs at two replicas and a confirm
lands on whichever pod the gateway's NATS request reaches, which is not the pod that created
the operation. Somebody will propose a `Map` because it is simpler. It is simpler and it is
wrong about half the time.

## 4. The operation

Two kinds in this plan. `0148` adds a third.

```ts
export enum AssistantOperationKind {
  /** Put things on a list that were not there. */
  ADD_LINES = 'ADD_LINES',
  /** Take named lines off a list. */
  REMOVE_LINES = 'REMOVE_LINES',
}
```

What is stored, which is server side only and never crosses the wire whole:

```ts
interface StoredOperation {
  id: string;
  /** Who it belongs to. Also part of the key, so a lookup by anybody else misses. */
  userId: string;
  kind: AssistantOperationKind;
  createdAtMs: number;
  expiresAtMs: number;
  /** Where it acts. Resolved when it was created, so confirming resolves nothing. */
  zoneId: string;
  listId: string;
  listName: string;
  zoneName: string;
  /** ADD_LINES. The delta or the absolute, exactly as section 2 decides. */
  items?: { product: string; mode: 'set' | 'add'; quantity?: number }[];
  /** REMOVE_LINES. The ids, and the text they had when they were read. */
  lines?: { id: string; content: string }[];
}
```

**There is no `authorization` field and there must never be one.** A token at rest for five
minutes is a credential this service has no reason to hold, and it would be the only copy of a
caller's header anywhere outside a request. The confirm request brings its own.

What the client is told, which does cross the wire:

```ts
export interface AssistantOperationOffer {
  readonly id: string;
  readonly kind: AssistantOperationKind;
  /** ISO 8601. The client counts it down and stops offering the button at zero. */
  readonly expiresAt: string;
  /** The list it would act on, so the client can show where. */
  readonly listId: string;
  /**
   * Values the client puts into its own localized label, never a sentence.
   *
   * The service has no translator, so a label written here would be English on a
   * Spanish phone. `{ product: 'leche', count: 2, list: 'la casa' }` and a key per
   * kind in velista is the only split that puts each half where it can be done.
   */
  readonly labelArgs: Record<string, string | number>;
}
```

`AssistantTurnResponse` gains `operations: AssistantOperationOffer[]`, required and empty on
nearly every turn, for the reason `choices` is required and empty: absent and empty meaning
the same thing is a question every reader asks once.

**It is not folded into `choices`.** A choice today carries a `label` that is a list name,
which is a proper noun and needs no translation, and a `message` the client sends as the next
turn, which costs a model call. An operation chip needs a translated label and must not cost a
model call. Two fields that would diverge on the first edit are two fields.

## 5. The keys

Three keys per operation, each with its own reason, all with a TTL so nothing is ever swept.

```
assistant:op:<userId>:<opId>      the operation, JSON            SET ... EX 300
assistant:ops:<userId>            a list of ids, newest first    EXPIRE 300 on every write
assistant:gone:<userId>:<opId>    what became of it, JSON        SET ... EX 900
```

**Create** is four commands, in this order:

1. `SET assistant:gone:<u>:<id> {"reason":"EXPIRED",kind,labelArgs} EX 900`
2. `SET assistant:op:<u>:<id> <json> EX 300`
3. `LPUSH assistant:ops:<u> <id>` then `LTRIM assistant:ops:<u> 0 2`
4. `EXPIRE assistant:ops:<u> 300`

**Confirm** is `GETDEL assistant:op:<u>:<id>`. One command, and it is the whole of single use:
the caller that gets the JSON back owns the operation and every other caller gets nothing. A
button pressed twice, a button and the model together, and two tabs all resolve to one write.
After a hit, `SET assistant:gone:<u>:<id> {"reason":"CONFIRMED",...} EX 900` and
`LREM assistant:ops:<u> 0 <id>`.

**Discard** is the same, with `"reason":"DISCARDED"`.

**Read for the prompt** is `LRANGE assistant:ops:<u> 0 -1`, then one `MGET` of those keys, and
ids whose key came back null are dropped and forgotten. When the index key is absent it is one
round trip and nothing else happens, which is the ordinary turn.

Three properties to keep while editing this:

- **The op key is the truth and the index is a hint.** An index entry with no key is skipped.
  A key not in the index is still confirmable, because the client holds the id. Nothing
  reconciles them and nothing needs to.
- **No interleaving of a torn create can produce a write nobody asked for.** Losing step 2
  leaves a tombstone that answers "expired" and writes nothing. Losing step 3 leaves an
  operation the prompt does not mention and the button still finds.
- **The tombstone is written first, on purpose.** It is what lets a miss say which of the three
  things happened rather than guessing, and writing it before the operation means an operation
  can never exist without one.

The id is **twelve characters of Crockford base32**, sixty bits from `crypto.randomBytes`. Not
a uuid, and the reason is that this id goes into the system prompt on every following turn: a
uuid is four times the tokens for a secret that lives five minutes inside a key that already
names its owner. Sixty bits is far past guessable at eight turns a minute.

**There is no owner check anywhere in the lookup**, because the `userId` is in the key. Another
caller's id does not resolve at all, and the answer they get is identical to the answer for an
id that never existed, so nothing here is an oracle for whether an operation exists.

## 6. Creating one

`remove_lines` is the tool this plan converts, and it is the only one. It already resolves the
lines, already refuses ids this turn did not read, and already returns a `needsConfirmation`
result naming what would go. All of that stays. What changes is that when the store accepts it,
the result carries an `operationId` as well:

```ts
return {
  ok: false,
  needsConfirmation: true,
  operationId, // absent when the store could not hold it (section 10)
  list: list.listName,
  count: resolved.length,
  wouldRemove: resolved.map((known) => known.line.content),
  message:
    'Nothing has been removed yet. Name these to them exactly and ask them to confirm. ' +
    'When they agree, call confirm_operation with the operation id above.',
};
```

**`rename_me` is deliberately left alone.** Plan `0039` section 6.3 calls its confirmation "the
one line ceremony", and it is right: one reversible call, no ids, nothing to reconstruct wrong,
and a change of name is not a thing anybody taps a button for while holding shopping. Storing
it would add a Redis round trip, a key and a button for a sentence. Do not tidy this into
consistency.

`settle_lines` still confirms nothing, for the reason its own comment gives.

`ADD_LINES` gets no creator in this plan. `upsert_lines` writes immediately today and goes on
writing immediately, because adding milk is the thing this assistant is for. `0148` is what
gives that kind its one caller, which is the case where the list already holds something like
it.

## 7. Confirming one: two doors, one execution

```
POST   /v1/assistant/operations/{operationId}/confirm   ->  201 AssistantOperationResult
DELETE /v1/assistant/operations/{operationId}           ->  204
```

Both are gateway routes behind `JwtAuthGuard`, both forward the caller's raw `Authorization`
header exactly as `POST /v1/assistant` does today, and both go over the broker to the assistant
on new subjects, `assistant.confirmOperation` and `assistant.discardOperation`. The assistant
then executes through `GatewayApiClient` with that header, so the nested pair `0039` section 3
describes is unchanged and so is rule A1.

Inside a turn, `confirm_operation` and `discard_operation` are two new tools taking one
`operationId` each, and **they call the same function the route calls**. One execution path,
two doors. A person who types "yes, go ahead" and a person who taps get identical writes, and
there is one place where a bug in either can live.

The result is **facts, not a sentence**:

```ts
export interface AssistantOperationResult {
  readonly id: string;
  readonly kind: AssistantOperationKind;
  readonly outcome: AssistantOperationOutcome; // DONE | PARTIAL | REFUSED
  readonly items: AssistantOperationItem[];
  readonly link: AssistantListLink | null;
}

export interface AssistantOperationItem {
  readonly product: string;
  readonly quantity: number | null;
  readonly effect: AssistantOperationEffect;
  // ADDED | INCREASED | UPDATED | UNCHANGED | REMOVED | ALREADY_GONE | REFUSED
}
```

No `reply` field, and that is the design rather than an omission. The service has no
translator, so any sentence it wrote would be English on a Spanish phone. The button path has
no model to write one either. velista owns the words and this owns the facts. When the model
confirms inside a turn it receives the same structure as a tool result and writes the sentence
itself, which is what it is for.

**Execution re-reads and never claims what it did not do**, which is `0043` section 3.5 applied
to a write that is minutes old:

- `REMOVE_LINES`: delete each id. A `404` from the gateway is `ALREADY_GONE` for that item and
  not a failure of the operation, because somebody removing it by hand is the person getting
  what they wanted. Anything else refused stops the loop, and the result states exactly which
  lines went and which are still there.
- `ADD_LINES` (`0148`): add through the same `addLines` call `upsert_lines` uses, so core's own
  exact match merge still applies and the result reports `INCREASED` where it merged.
- Any outcome with at least one refusal and at least one success is `PARTIAL`. A rollback is
  never attempted and never claimed.

The operation is consumed **before** the writes run. A crash between the two loses the
operation and writes nothing, which is the safe direction to fail in.

## 8. What the model is told

At the start of every turn, after the context fetch and before the system prompt is built, the
service reads the caller's pending operations and names them. At most three lines:

```
Waiting for a yes or a no. Nothing has been written for any of them:
- 7GKD2Q4MHZ0A: take "aceite de oliva" and "arroz" off "la casa".
Confirm one with confirm_operation and throw one away with discard_operation, using
the id exactly as written above. Never write an id yourself.
```

Three rules on top of it, in the prompt with the others:

- An operation id comes only from this list or from a tool result in this same turn.
- Confirm only what the person has just agreed to, in words, in this conversation. A person
  who changes the subject has not confirmed anything.
- When they say no, discard it and say it is gone rather than leaving it to expire.

`confirm_operation` and `discard_operation` refuse an id that is not in this turn's pending
list, the same way `remove_lines` refuses a line this turn has not read, and the refusal says
to look at the list of waiting operations rather than apologizing.

The scoped catalog (`0044`, `0046` section 5.2) gets both tools too. A scoped turn can already
remove a line, so it can already have something waiting, and a scoped declaration differs only
in wording, not in whether the tool exists.

## 9. When it is gone

Three answers, and the tombstone is what tells them apart.

| Tombstone                          | HTTP | Code                          | What the person is told              |
| ---------------------------------- | ---- | ----------------------------- | ------------------------------------ |
| `EXPIRED`, or no tombstone at all  | 410  | `assistant_operation_expired` | It expired, and here is what it was  |
| `CONFIRMED`                        | 409  | `assistant_operation_done`    | It already happened                  |
| `DISCARDED`                        | 409  | `assistant_operation_done`    | It was thrown away                   |

Both are new `DomainException` subclasses with `exposesDetails = true`, carrying
`{ kind, labelArgs }`, so velista can offer "ask for that again" with the product in it rather
than a dead end. That needs the code in `error-codes.ts`, the status in the map beside it and
the message in `error-catalog.ts`, in both languages.

Fifteen minutes of tombstone against five of operation is deliberate: the ten minute tail is
what turns "that expired" from an error into an offer. Past fifteen, an unknown id answers
`assistant_operation_expired` with no details, which is also the answer for an id that was
never issued.

## 10. When Redis is not there

**The store is an optimization over a mechanism that already works, so its absence costs money
and precision and never the feature.** That sentence is the whole of this section and it is
what keeps `0028` section 5's promise that no caller refuses to boot.

`REDIS_URL` is required in the assistant's schema, like every other service that uses Redis,
because every deployment already runs one. What is not required is that it answers. Every
store call goes through `RedisService.tryCommand`, which logs and returns `undefined`:

- **A create that fails** returns today's `needsConfirmation` result with **no** `operationId`.
  The message then says to call the tool again with `confirmed: true`, which is the sentence
  that is there now, and the model does exactly what it does today. `confirmed` stays on the
  `remove_lines` declaration for this reason, and deleting it would delete the fallback.
- **A read that fails** at the start of a turn yields no pending operations, so the prompt says
  nothing about any and the model does not offer to confirm one. The button in the client still
  works if Redis comes back within the five minutes.
- **A confirm that fails** answers 503 through the ordinary filter. It has written nothing,
  because the `GETDEL` is what gates the writes.

The tool result is what teaches the model which path it is on, which is already how this
codebase steers it. There is one catalog and one set of declarations. Do not branch the catalog
on Redis.

## 11. Caps

- **Three pending operations per user**, enforced by `LTRIM` and therefore by dropping the
  oldest. A fourth question makes the first one unanswerable, which is correct: somebody who
  has been asked three things and answered none is not going to answer the first.
- **`LINE_BATCH_MAX_ITEMS` on the items** and `REMOVE_LINES_MAX` on the lines, the same numbers
  the tools already enforce before they store anything.
- **Refuse to store an operation over 8 KB** of JSON. Nothing legitimate approaches it and the
  check is one line.
- No new rate limit. A confirm takes **no** turn from `TurnLimiter` and **no** slot from
  `ConcurrencyGate`, for the reason `transcribe` takes no turn: neither spends a provider
  request, and the budget those two protect is the provider quota. The gateway's global
  throttler (`0004` section 8) covers the routes, as it covers every route.

## 12. The record

`0039` section 10's structured turn record gains one outcome, `confirmed`, for a turn that ran
`confirm_operation`. The confirm route emits a record of its own, because it is not a turn and
counting it as one would make the turn numbers lie:

```
event: assistant.operation
userId, kind, door: 'route' | 'tool', outcome, itemCount,
ageSeconds: how long the operation had been waiting, gatewayMs
```

`ageSeconds` is the number worth watching and the reason it is in the record. Five minutes is a
guess, and the distribution of this field is what turns it into a decision. If nothing is ever
confirmed after ninety seconds, five minutes is generous and harmless. If a quarter of them
arrive at four and a half, it is too short.

## 13. Configuration and deployment

`REDIS_URL` becomes a variable the assistant needs, and it is required wherever
`redisValidationSchema` appears, so every place that starts an assistant has to provide it or
the pod does not boot. Locally it already resolves: the assistant's `ConfigModule` loads
`apps/luna-shopper-backend/.env.luna-shopper-backend`, which sets it, and `luna-slot.sh`
already derives it in the `[shared]` key group. What has to change:

- `apps/luna-shopper-backend/assistant/src/app/config/app-config.ts`: spread
  `redisValidationSchema`, add `redisUrl` to `AssistantConfig`.
- `apps/luna-shopper-backend/assistant/src/app/app.module.ts`: `RedisModule.forRoot()`. The
  "No TypeOrmModule" comment stays and gains a sentence saying Redis is not a database and rule
  A6 is what it is for.
- `k8s/helm/templates/luna-shopper-backend/_env.tpl`: add `assistant` to the roles that receive
  `REDIS_URL`, and extend the comment above it to say why a third role now does.
- `k8s/e2e/luna-shopper-backend/compose.apps.yml`: `REDIS_URL: redis://redis:6379` on the
  assistant service, and `redis` in its `depends_on`.
- `apps/luna-shopper-backend/assistant/.env.example`: name it in the shared block.

There is no new environment variable for the TTL, the cap or the id length. They are product
rules and they live as named constants beside the store, for the reason
`suggestions.constants.ts` gives: a cluster answering a different rule from the one the specs
prove is a bug nobody can reproduce.

## 14. Not in this plan

- **The button.** velista draws it, from `operations` on the turn response, and that is its own
  plan. Until it lands the only confirmation door that gets used is the tool.
- **Similarity, and asking before adding.** `0148`.
- **`rename_me` and `settle_lines`.** Section 6 says why for each.
- **A conversation store.** Rule A2 stands for everything except A6, and backlog `0005` section
  5 still owns the rest.
- **Anything cross device.** It happens to work, because the key is per user and not per
  session, so a question asked on a phone can be answered on a laptop. Nothing was built for it
  and nothing tests it.

## 15. Tests

- `operation-store.spec.ts`: against a fake Redis client, the four create commands in order,
  `GETDEL` returning the operation once and nothing the second time, a torn create in both
  directions, an index entry whose key is missing, and the `LTRIM` cap at three.
- `operation-store.integration.spec.ts`: against a real Redis, in its own target, following
  `libs/luna-shopper/platform/src/lib/redis/redis.integration.spec.ts`. Two concurrent `GETDEL`
  calls and exactly one winner is the test this whole design exists for.
- **The clock is injected.** No spec asserts a TTL against `Date.now()`, and no spec sleeps.
- `tools.spec.ts`: `remove_lines` returns an `operationId` when the store accepts, returns the
  old result with `confirmed` when it does not, and every existing expectation in that file
  still passes unchanged.
- `assistant.service.spec.ts`: the pending operations reach the system prompt, a turn with none
  makes one Redis call and adds nothing to the prompt, and `confirm_operation` with an id that
  is not pending is refused without a gateway call.
- `operations.controller.spec.ts` in the gateway: the header is forwarded verbatim, and the
  three gone cases answer 410, 409 and 409 with the right codes.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass, which means both generated files are
  regenerated and committed.
- Rule A4 stands. No test here reaches a model provider.

## 16. Acceptance criteria

- [ ] An operation is created, confirmed once, and the second confirmation answers 409.
- [ ] An operation past five minutes answers 410 with `kind` and `labelArgs` in the details.
- [ ] No stored operation, in any code path, contains an `Authorization` header or a token.
- [ ] Two concurrent confirmations of one operation produce exactly one write, proved by the
      integration spec.
- [ ] With Redis stopped, every existing assistant spec passes and `remove_lines` still confirms
      through `confirmed: true`.
- [ ] A turn with no pending operations adds nothing to the system prompt.
- [ ] The confirm route makes no model provider call, proved by a spec with a provider fake that
      throws if it is called.
- [ ] The OpenAPI document and the admin wire types are regenerated and committed.
- [ ] `_env.tpl`, `compose.apps.yml` and `.env.example` all carry `REDIS_URL` for the assistant.

## 17. Verification

```sh
npx nx test luna-shopper-backend-assistant
npx nx test luna-shopper-backend-gateway
npx nx test luna-shopper-platform
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx lint luna-shopper-backend-assistant
npx nx build luna-shopper-backend-assistant
```

Then, against an ephemeral luna slot, by hand: ask the assistant to take two things off a list,
read the `operations` array out of the response, `POST` the confirm route with the id, read the
result, and `POST` it a second time and confirm the 409. Then wait five minutes and confirm a
fresh one answers 410 with the products in its details. Put the three response bodies in the PR.
