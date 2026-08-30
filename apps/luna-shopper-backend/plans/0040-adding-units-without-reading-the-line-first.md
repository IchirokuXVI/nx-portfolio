# 0040 Adding units without reading the line first, and a basket in one request

> **Two changes to the line API, and one of them is optional.** The first is
> required and is the reason this plan exists: there is no way to add units to a line
> without knowing how many were already there, so the assistant reads, computes and
> writes, which is a lost update and a wasted read. The second, adding several lines
> in one request, is worth building but is not load bearing, and section 5 says which
> parts of the plan survive if it is cut.
>
> Prerequisite reading: plan `0007` section 2 for the line surface as it stands,
> plan `0036` section 4.1 for who may edit what, plan `0037` section 4 for what a
> reduction does, and plan `0039` sections 6.1 and 9 for the caller this is for.

## 1. What is being built

- **`POST /v1/lines/:id/quantity`**, taking a signed `delta`, applying it atomically,
  and answering with the line as it now stands. Section 3.
- **`POST /v1/lists/:id/lines/batch`**, taking up to fifty lines and adding them in one
  transaction. Sections 4 and 5.
- **`upsert_line` becomes `upsert_lines`** in the assistant: a list of items rather than
  one, with a per item choice between setting a quantity and adding to it. Section 7.

Neither endpoint is restricted to the assistant and neither is called from velista. That
is stated up front because it is the one thing about this plan that is easy to read as an
oversight: these are ordinary API routes that happen to have one caller today.

## 2. The problem: the bot has to read a line before it can add to it

Somebody says "add two more bottles of milk". The bot cannot do that in one call. The
only quantity write in the API is `PATCH /v1/lines/:id` with an absolute `quantity`, so
`upsert_line` fetches the list's lines, finds the milk, reads that it says three, and
writes five.

Three things are wrong with that, in ascending order of how much they matter.

**It reads more than it needs.** `GatewayApiClient.listLines` follows the cursor up to
five pages at `MAX_PAGE_SIZE`, because the tools answer "is there milk on the list" from
it and a page boundary is not a reason to say no. Paying for that to learn one number is
the smallest of the three problems and it is still a real one, because section 5 shows it
is paid once per item.

**It cannot be told what happened.** The bot is meant to report the new count back, and
today the only number it can report is the one it computed itself. It says five because
it decided five, not because the server said five. Those agree right up until they do
not, and the case where they disagree is the next paragraph.

**It loses updates, silently.** Between the read and the write, anybody else may write.
`ListLine` carries a `version`, but `UpdateLineRequest` has no expected version and
nothing on the write path compares one, so there is no optimistic concurrency to fall
back on: the second writer wins outright. Two people talking to the bot in one household,
or one person tapping the stepper in the app while the other speaks, and one of the two
requests evaporates. Nothing errors, nothing logs, and the failure surfaces in the shop
as milk that is not on the list. A quantity is the one field on a line where the
interesting operation is relative, and a relative operation built out of a read and a
write is a race with no detector.

## 3. `POST /v1/lines/:id/quantity`

```
POST /v1/lines/{id}/quantity
{ "delta": 2 }
-> 201 LineView
```

### 3.1 Why a sub resource and not a field on the edit

`PATCH /v1/lines/:id` could take a `quantityDelta` beside its `quantity`. It should not,
for three reasons and a precedent.

`PATCH` means "here is the new value". A body where one field is absolute and another is
relative needs a mutual exclusion rule, which `class-validator` states awkwardly and which
every existing client then has to be told never to trip. `UpdateLineDto` is the DTO
velista already sends from three places, and giving it a field it must never populate is a
trap with no upside. And core's `update` branches on a **reduction** to decide whether to
split, which is arithmetic on a value it currently receives; making that value derived
inside the same method mixes two questions in the one place in this service where the
rules are already densest.

The precedent is that this gateway already answers single field state changes with a sub
resource `POST`: `:id/approval` and `:id/status` are both exactly this shape, and both
exist rather than being flags on the `PATCH` for the same reason.

### 3.2 It introduces no new permission, no new transition and no new event

**This is the claim the whole endpoint rests on.** The delta is arithmetic in front of
the edit that already exists. It reaches the same `authorizeEdit`, the same
rejected-to-pending reset, the same `splitRemainder`, and it emits the same events.

Four consequences follow, and every one of them is a rule somebody would otherwise try to
re-decide here:

- **An approved line's quantity may be changed only by a caller holding `DECIDE`**
  (plan `0036` section 4.1). So the bot asking to add two to an approved line gets the same
  403 the app gets, and relays it in words. Adding units is an edit, and the endpoint does
  not get to be a softer edit.
- **Adding units to a `REJECTED` line puts it back to `PENDING` and clears its approver**
  (plan `0036` section 4.2). An edit reopens a rejection into a conversation, and a delta
  is an edit.
- **A negative delta on an approved line splits the remainder** (plan `0037` section 4).
  A caller who wanted to take two off an approved line of three gets the line at one and a
  second line of two, `APPROVED` and `NOT_AVAILABLE`, exactly as an absolute lowering
  produces today. The invariant that a quantity a list asked for is not lost is not
  something this endpoint is allowed to opt out of.
- **The events are `LineUpdated`, and `LineAdded` when a split happened**, in that order,
  which is the order plan `0037` section 5 says is load bearing.

### 3.3 A negative delta is allowed

The obvious reading of the request is "add units", and it would be defensible to accept
only positive deltas. It is the wrong call: refusing negatives would leave "one less" as
the single thing the bot still has to do with a read and a write, which is precisely the
failure in section 2 that this endpoint exists to remove. Routing a negative through the
same code costs nothing, because that code already knows what a reduction means.

`delta` is a non zero integer, bounded so that neither direction can be used to write a
number nobody meant. The **resulting** quantity is what the existing floor and ceiling
apply to.

### 3.4 It is one transaction with the row locked

```
BEGIN
  SELECT ... FROM list_line WHERE id = :id FOR UPDATE
  compute, authorize, apply, split if required
COMMIT
emit
```

The neighbouring `update` is not transactional when it does not split, and that is
correct there: it writes an absolute value, so a concurrent write is a last-writer-wins
race over a value somebody deliberately chose. A delta is the one shape where the read
has to be inside the write, so this path takes the lock even in the case where `update`
would not. Events are emitted after the commit, as everywhere else in this service.

### 3.5 Core gains the ceiling it never had

`validateQuantity` enforces an integer floor of one and no ceiling. The gateway DTO says
`@Max(100000)`, so the ceiling exists at exactly one layer today. That was survivable
while every write carried an absolute value the gateway had already checked; a delta is
computed **inside** core, so core is now the only place that can check the result.

So `validateQuantity` gains the ceiling, for the reason its own comment already gives for
restating the floor: core's callers are NATS messages, the gateway is one of them rather
than a wall, and a bound that only one of two layers enforces is a bound that a second
client, a replayed message or a future service walks straight through. The constant is
stated once and shared with the DTOs rather than written in both places.

### 3.6 What it answers

`LineView`, like every other line route.

The temptation is `{ previous, delta, current }`, so the bot can say "two more, five now".
It is not needed: the caller knows the delta it sent, and `LineView.quantity` is the new
count, so the sentence is available from the response plus what the caller already had. A
bespoke envelope on one route out of nine is a cost paid by every reader of the API for a
subtraction.

One hole is worth naming rather than discovering. When a negative delta splits, the
response describes the line at its new lower quantity and says nothing about the remainder
row that was created beside it. That is already true of `PATCH` today, so this endpoint
inherits the gap rather than opening it, and the assistant's tool reports only what the
response actually says. Closing it is a change to both routes at once and belongs to
whichever plan next touches `0037`'s surface.

### 3.7 The contract

- `LINE_PATTERNS.addQuantity = 'line.addQuantity'`, pinned in `list.messages.spec.ts`
  beside the others.
- `AddLineQuantityRequest { userId, lineId, delta }`.
- `AddLineQuantityDto` in the gateway: `@IsInt()`, bounded, and refusing zero, because a
  delta of zero is a request that means nothing and is more likely a client bug than an
  intention.

## 4. The batch endpoint, and whether it is relevant at all

The brief asks for this to be evaluated rather than assumed, because the assistant runs
in the same cluster as the gateway and the requests are local. So, honestly:

**The latency argument is not the argument, and if it were the only one there would be no
endpoint.** The assistant reaches the gateway over the cluster's internal service name
with no TLS and no ingress. Ten sequential calls on that path cost single digit
milliseconds each, against a Gemini call measured in hundreds of milliseconds or seconds.
Nobody would ever perceive the difference. Anybody arguing for this endpoint on round trip
count is arguing from a habit formed on the public internet, and the habit does not apply
here.

Three arguments are real.

**The gateway's throttler is a shared budget, and the bot spends the caller's.** One
bucket, 120 requests a minute, counted in Redis and therefore shared across replicas
(plan `0004` section 8, plan `0028` section 2.4). Every call the assistant makes on
somebody's behalf spends from **that person's** bucket, because rule A1 means it is
indistinguishable from that person. Section 5 works out that a ten item request costs
around twenty of those, in one sentence. Two or three such sentences in a minute and the
app the person is holding starts answering 429 for reasons they cannot see and did not
cause. That is a user visible failure produced by the bot being chatty, and it is the
strongest reason for the endpoint.

**One access check instead of N.** `requireAccess` resolves the list, the caller's
membership and their permission set on every add. Fifty adds is fifty resolutions of one
unchanging answer.

**It is a genuine gap in the API rather than a bot convenience.** "Paste a shopping list",
"add the usual" and importing last week's list are all the same endpoint, and velista will
want at least one of them. Building this only for the assistant would be building it for
every future caller by accident, which is the good version of that accident.

Against all of that: it is a route with no user interface, so nothing exercises it except
the assistant and its tests, and every route is surface that has to be documented,
validated, throttled and kept true in `openapi.json`.

**Recommendation: build it.** But the tool change in section 7 is the part that is
*required*, and this endpoint is the part that is *worth it*. They are separable, and
section 5 says exactly what the assistant does if this endpoint does not exist, so cutting
it costs a paragraph rather than a redesign.

## 5. What a ten item request costs today, and why the assistant change is not optional

Somebody says "add milk, bread, eggs, rice, oil, coffee, sugar, salt, tea and flour".

Today `upsert_line` handles one product per call, and for each one it reads the list's
lines to decide between an edit and an add, then writes, then calls
`TurnContext.invalidate` so the next read is true. The cache is per list, so the
invalidation means **every item re-reads the whole list**. Ten items is ten full list
reads, each following the cursor up to five pages, plus ten writes. `runTools` awaits each
call in turn, so they are sequential.

There is a second failure, and it is worse because it is not a cost but a wall.
`ASSISTANT_MAX_TOOL_CALLS` defaults to six, and despite the name it bounds **rounds**, not
calls: the loop checks `round >= maxToolCalls` before running the round's calls. When the
model puts all ten calls in one reply this never bites. When it emits them a few at a
time, which is the ordinary shape for a model working through a list, the turn runs out of
rounds and answers "Sorry, I got stuck on that one" with some unknown number of the ten
items written and no way to say which. **Whether a ten item request works today is a
property of how the model chose to shape its reply**, which is not something anybody can
rely on or test.

So the assistant has to batch regardless of what the API offers, and there are two
versions of that:

| | Gateway calls for ten new items | Needs |
| --- | --- | --- |
| Today | 10 reads + 10 writes, sequential, over an unbounded number of rounds | |
| Tool batches, no new endpoint | 1 read + 10 writes, one round | section 7 only |
| Tool batches, with the endpoint | 1 read + 1 write, one round | sections 6 and 7 |

The middle row is the fallback. It removes the wall and most of the reads with no change
to the gateway or to core, which means **section 7 can land first and on its own**, and
the endpoint can follow or not.

## 6. `POST /v1/lists/:id/lines/batch`

```
POST /v1/lists/{id}/lines/batch
{ "items": [ { "content": "milk", "quantity": 2 }, { "content": "bread" } ] }
-> 201 LineView[]
```

### 6.1 All or nothing, not per item results

The instinct is a per item result array, so that nine good items are not refused because
of one bad one. Worked through, it turns out to be guarding against something that cannot
happen.

Ask what can fail for one item but not its neighbours. Access is a property of the list
and the caller, so it is the same answer for all of them. The approval rules are a
property of the caller's permissions and the list's `autoApproveLines`, likewise. The
quantity floor and ceiling and the `itemId` shape are per item, but the gateway DTO
validates every item at the edge, so by the time core sees the batch those have already
produced a 400 for the whole request. What is left is a database failure, which is not per
item either.

So: **one transaction, all or nothing, and the response is `LineView[]` in request
order.** That matches `reorder`, which is the existing batch write on this resource, and
it keeps the response a shape every client already knows how to read. A per item envelope
would be a new response idiom introduced to describe a partial failure the design cannot
produce.

`maxItems` is fifty. It is a bound rather than a budget: fifty is well past any spoken
sentence and past any plausible paste, and its job is to stop one request writing an
unbounded number of rows.

### 6.2 Positions, approval and events

**Positions** come from one `MAX(position)` query inside the transaction, then increment
per item, so the lines land in the order they were given.

**Approval runs the same three rules as `add`**, per line: the adder holds `DECIDE` so the
line is `APPROVED` and attributed to them, else the list auto approves so it is `APPROVED`
with a null approver, else `PENDING` (plan `0037` section 2). The permission set is
resolved once and applies to every item, which is right because it is one adder and one
list. `status` is `PENDING` throughout, as always.

**The events are N `LineAdded` events, in request order, after the commit.** Not one
batch event. A new event type is a type every client has to learn, and velista, the
realtime service and the list rooms all already handle `line.added` correctly; a client
that has never heard of this plan gets a correct list. The cost is a burst of N events for
one request, which is exactly the fan out the N separate requests would have produced
anyway, so nothing downstream sees more traffic than it sees today.

### 6.3 It adds, and it does not merge

Two items in one batch naming the same thing produce two lines. The endpoint is an add,
not an upsert: merging would put the "asking for milk twice should change a number"
rule into core, where it does not belong, and where it would then apply to a person
pasting a list who may well have meant two entries. The upsert rule is the assistant's,
it lives in the assistant, and section 7 says what it does about duplicates inside one
tool call.

### 6.4 Throttling

It stays on the default bucket. A named limit would be a number chosen with no evidence
behind it, and the write is cheap and already capped by `maxItems`. If the usage data
later says otherwise, `THROTTLE_LIMITS` is where that goes.

### 6.5 The contract

- `LINE_PATTERNS.addMany = 'line.addMany'`, pinned in `list.messages.spec.ts`.
- `AddLinesRequest { userId, listId, items: { content, quantity?, itemId? }[] }`.
- `AddLinesDto` with `@ArrayMaxSize(50)`, `@ArrayMinSize(1)` and `@ValidateNested({ each: true })`
  over the item DTO, which reuses the same field decorators `AddLineDto` already carries
  rather than restating the bounds.

## 7. What changes in the assistant

### 7.1 `upsert_line` becomes `upsert_lines`

One tool call, one list, a list of items:

```
upsert_lines({
  list?: string,
  zone?: string,
  items: [ { product: string, quantity?: integer, mode?: 'set' | 'add' } ]
})
```

**One list per call, still.** List resolution runs once for the call, so
`ListResolutionBranch` stays one branch per call and plan `0039` section 10's most
valuable field keeps meaning what it meant. "Milk on the flat list and bread on the office
list" is two calls, which is correct: they are two decisions about which list, and each
deserves its own record and its own chance to ask.

**The tool count stays at three.** That matters more than it looks. Plan `0039` section 7
argues that the constraint is in the actions and that an absent capability is a harder
boundary than an instruction, and section 12 lists what is absent. Adding units is not a
new capability, it is the write that already existed reached by different arithmetic, so
the catalog does not grow and that argument is untouched. The only edit to `0039`'s exit
criteria is the tool's name.

### 7.2 `mode`, and the trap it fixes

| `mode` | Existing line | No such line |
| --- | --- | --- |
| `set` (default) | quantity replaced with the one given | line added with the quantity given |
| `add` | the given quantity added to what is there, via section 3 | line added with the quantity given |

`set` is today's behaviour and stays the default, so nothing already tested changes
meaning. `add` is what the model sends when the person said "two more", "another" or
"a couple extra", and the tool description is where that is taught, because the
description is the only thing the model reads when deciding.

There is a related defect worth fixing in the same change. Today, a bare "put milk on the
list" when milk is already there sends an edit with only the content in it. The quantity
survives, so nothing is lost, but the write still happens: the version bumps, a
`LineUpdated` goes out, and a **rejected** line quietly returns to `PENDING` for a
sentence that asked for nothing. Worse, on an **approved** line a caller without `DECIDE`
gets a 403 for what was, in substance, a question. Somebody mentioning milk a second time
is told they are not allowed to do something they never meant to do.

So: **an item with no quantity that matches an existing line writes nothing at all** and
reports that it is already on the list with the count it has. That is the honest answer,
it cannot fail for a permission the caller did not need, and it is the kind of thing that
only shows up once a real person mentions the same item twice in one conversation.

### 7.3 Duplicates inside one call, and the calls it makes

Two items in one call naming the same product are folded before anything is written. The
lines are read once for the whole call, so a second write would otherwise be computed
against a cache that predates the first, which is section 2's bug reappearing inside a
single tool call.

For a call of N items against a list where M of them already exist:

1. one read of the list's lines;
2. one `POST /v1/lists/:id/lines/batch` for the N minus M new ones, when there are any;
3. one call per existing item, either `PATCH /v1/lines/:id` for `set` or
   `POST /v1/lines/:id/quantity` for `add`;
4. one `TurnContext.invalidate` at the end, not per write.

Ten new items is two gateway calls. Ten items that all already exist is eleven, which is
the honest floor until there is a batch edit, and there is no case for one yet.

### 7.4 The turn record

Plan `0039` section 10 records the tool calls with their resolved arguments. The arguments
are now an array, so the record carries the **item count** as a field of its own rather
than leaving it to be counted out of a serialized argument blob later. The question it
answers is whether people ask for one thing or for a basket, which is the question that
decides whether this plan was worth building.

## 8. Configuration, secrets and CI

Almost nothing, and that is the point of putting three routes on services that already
exist.

- **No new env var, no new secret, no Helm change, no new host, no CORS origin.** Nothing
  in `values.yaml`, `_env.tpl`, `provision-release.sh`, `compose.apps.yml` or the
  `luna-slot` scripts changes.
- **No migration.** No column, no index, no entity change. `position` is already
  `double precision` and `quantity` is already an integer column.
- **`apps/luna-shopper-backend/gateway/docs/openapi.json` must be regenerated in the same
  commit as the routes** (`npx nx run luna-shopper-backend-gateway:openapi`). Three new
  routes and their DTOs change that document, the gateway's own suite fails on a stale
  one, and PR checks run it, so forgetting is a red PR rather than silent drift.
- **The Postman collection is hand kept**, not generated. Folder 05 threads lines through
  a zone and a list it built earlier, and it is where a smoke test for both routes belongs.

## 9. Testing

Rule A4 is untouched: nothing here reaches a model provider, and the assistant's half is
exercised through `FakeModelProvider` as everything else in that service is.

**Core, in `line.service` specs:**

- A positive delta adds, and the returned line carries the new quantity.
- Two concurrent deltas against one line both land. This is the test the endpoint exists
  for, and it has to be written against a real database rather than a mocked repository,
  because what is being asserted is that the row was locked. `*.integration.spec.ts` is
  the existing shape for a test that needs Postgres.
- A delta that would take the quantity below one is refused, and a delta that would take
  it past the ceiling is refused **in core**, not only at the gateway.
- A delta on an approved line from a caller without `DECIDE` is refused with the same
  error an edit gets.
- A negative delta on an approved line splits, producing the same two rows and the same
  two events, in the same order, as the equivalent absolute edit.
- A delta on a rejected line returns it to `PENDING` and clears its approver.
- A batch of ten writes ten lines in request order with consecutive positions, and emits
  ten `LineAdded` events in that order.
- A batch on a list the caller cannot write is refused, and writes nothing.
- A batch that fails partway writes nothing at all.
- A batch from a caller holding `DECIDE` produces approved lines attributed to them; from
  one without, on a list that does not auto approve, pending ones.

**Gateway:** both routes reject a malformed body at the edge, and `openapi.json` matches.

**Assistant:**

- One call with ten new items makes one batch request, not ten.
- One call with `mode: 'add'` on an existing item calls the quantity route and never
  reads then writes.
- One call naming the same product twice writes once, with the quantities folded.
- An item with no quantity matching an existing line writes nothing and reports the count
  that is there.
- A ten item request completes inside the round cap, whether the model emitted the calls
  in one reply or across several.
- A reference is emitted for every line written, and every one of them came from a
  response in the same turn.

## 10. Open decisions

- **Whether the batch endpoint is built at all**, which section 4 recommends yes and
  section 5 makes cheap to answer no. Nothing else in the plan depends on it.
- **Whether `PATCH /v1/lines/:id` should take an expected `version`.** Section 2 says the
  absent optimistic concurrency is what makes the read and write race, and the delta
  endpoint routes around it rather than fixing it. Fixing it properly is a change to every
  write on the line and to every velista call site, and it is worth doing on the day
  something other than quantity turns out to race.
- **Whether a batch edit is worth having**, which section 7.3's floor of eleven calls
  suggests and no evidence yet supports.
- **Whether the split remainder should appear in the response** of either quantity write.
  Section 3.6 says the gap is inherited rather than opened.
- Whether the batch endpoint should later grow the upsert rule so a paste can merge with
  what is already there. Leaning no: that is a decision about a person's intention, and
  the two callers who would want it want opposite answers.

## 11. Exit criteria

- Adding units to a line is one request, and the response says how many there now are.
- Two concurrent additions to one line both land, proved against a real database.
- The quantity route reaches the same permission rules, the same approval transitions and
  the same events as an edit, and a caller who could not edit the line cannot add to it.
- A reduction through the quantity route splits the remainder exactly as an absolute
  lowering does.
- Core refuses a quantity outside its bounds without depending on the gateway to have
  checked.
- A ten item request is one tool call, at most two gateway writes, and it completes
  regardless of how the model shaped its reply.
- Naming something already on the list, with no quantity, writes nothing and reports the
  count that is there, rather than editing it or being refused for a permission the caller
  never needed.
- The assistant's tool catalog still has three entries, and section 12 of plan `0039`
  still describes everything absent from it.
- `openapi.json` is regenerated in the same commit as the routes and the gateway suite is
  green.
- No new environment variable, secret, migration or host in either cluster.
