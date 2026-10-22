# 0227: a job falls back to its next model behind a breaker

> Plan `0226` resolves each job to a chain of models and serves with the first entry
> whose provider has a key. A key can stop working after boot: it expires, the credit
> balance runs out, the account hits a spend limit, the provider is overloaded, or the
> host is unreachable for a minute. Today each of those fails the turn, and the person
> who asked for milk is told to try later while a second provider with a working key
> sits in the same pod.
>
> This plan makes the next entry serve. It does it without a check before each call,
> because the owner asked on 2026-10-23 that no latency be added to a healthy turn: the
> call itself is the check. A failure that is about the key, the account or the provider
> opens a **breaker** on that entry for a cooldown, the same turn is answered by the next
> entry, and while the breaker is open no call reaches the entry at all. A small probe in
> the background, not on anybody's turn, closes the breaker again when the provider
> answers. One probe per entry at boot means a key that is dead on arrival costs no turn
> either.
>
> Prerequisite reading: `0226` sections 3 and 4 (the chain, `JobBinding`, `next`), `0224`
> section 2.2 (what a Claude error looks like, and that thinking blocks ride in the
> signature), `0039` section 9 (rule A5: a 429 answers with `retryAfterSeconds`),
> `0041` section 7 (the two call voice turn), `libs/shared/model-engines/src/retry.mjs`
> (the fatal versus retriable split, read for the idea), and in the code
> `provider/jobs.ts`, `provider/model-provider.ts`, `provider/claude.provider.ts`,
> `provider/gemini.provider.ts`, `assistant/assistant.service.ts`.
>
> **Build order.** After plan `0226` is merged. The section numbers of `0226` cited here
> are its sections as written, and the file names are the ones it creates.

## Brief for the agent

### Objective

In `apps/luna-shopper-backend/assistant/src/app/provider/`, give every `ProviderUnavailableError`
a `kind`, add `fallback.ts` with a `Breaker` per chain entry and a `FallbackBinding` that
implements `JobBinding` over the whole chain, make `resolveJobs` return a
`FallbackBinding` whenever a job has more than one usable entry, probe each entry once at
boot and once per cooldown in the background, and record every fallback and every
breaker change.

### Context

Every statement below is about the code as plan `0226` leaves it.

- `JobBinding` holds the first usable entry and `next`, the usable entries after it,
  each with its model row (or bare id) and its provider instance. `generate` and
  `transcribe` call the first entry's instance and nothing else.
- `ProviderRateLimitedError` carries `retryAfterSeconds`. `ProviderUnavailableError`
  carries a message and a cause and nothing that says whether the key, the request or the
  network failed. `ClaudeProvider.readError` maps 429 to the first and every other status
  to the second; a thrown `fetch` and an abort become the second with two different
  messages. `GeminiProvider.readError` does the same.
- `AssistantService.viaProvider` maps `ProviderRateLimitedError` to rule A5's problem
  body and logs `ProviderUnavailableError`; `ask` is the one call site for `generate`,
  and the two transcriptions are the call sites for `transcribe`.
- The turn loop pushes a `MODEL` turn with the reply's tool calls and a `TOOL` turn with
  their results after each round. The tool calls carry `signature`, which for Claude is
  the raw content of the reply including its thinking blocks (`0224` section 2.2), and
  which Gemini rejects with a 400 when replayed without it. The transcript between turns
  is plain text with roles (`capTranscript`), so a conversation that began on one model
  continues on another without loss.
- `main.ts` logs one line per job with the resolved model. The record of `0226` section 5
  carries `job`, `provider`, `model` and `costUsd`.

### Target state

- `npx nx test luna-shopper-backend-assistant`, `lint` and `build` pass.
- With `ASSISTANT_MODEL` on its default chain and a wrong `ANTHROPIC_API_KEY` on a slot,
  the first turn after boot is answered by Gemini with no Claude call in it (the boot
  probe opened the breaker), the log holds one `assistant.breaker` event with
  `state: open`, `kind: auth`, and the turn record names `fellBackFrom`.
- A healthy chain makes exactly the calls it made before this plan: one `generate` per
  round, no probe on a turn.

### Scope

- Work only in: `apps/luna-shopper-backend/assistant/src/app/provider/**`,
  `assistant/assistant.service.ts`, `assistant/assistant.service.spec.ts`,
  `assistant/assistant.module.ts`, `src/main.ts`, and this plan file.
- Do NOT touch: the contracts, the gateway, the chart, the scripts, any `.env`,
  `package.json`, `package-lock.json`, `config/app-config.ts`.

### Constraints

- No new dependency and no new configuration key. The cooldowns are constants with a
  reason beside each (section 2.3). An operator has nothing to tune until a dashboard
  shows the events, and a key that nobody sets is a key nobody tests.
- No test reaches a provider (rule A4). The breaker is specified with fake providers that
  throw and with Jest fake timers.
- The wire contract does not change. Rule A5 holds: when every entry of a chain is rate
  limited, the problem body carries the first entry's `retryAfterSeconds`.
- Prettier on each changed file, never on a directory.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] `ProviderUnavailableError` has `kind: ProviderFaultKind`, both providers set it by
      the table of section 1, and their specs assert the mapping for 401, 403, a 400
      credit balance body, 404, 500, 503, 529, a thrown `fetch` and an abort.
- [ ] `fallback.ts` holds `Breaker` and `FallbackBinding` with the behaviour of section 2,
      and `fallback.spec.ts` holds the cases of section 2.5.
- [ ] `resolveJobs` returns a `FallbackBinding` for a job with two or more usable
      entries and a plain binding otherwise; a `jobs.spec.ts` case asserts each.
- [ ] Each entry is probed once in the background at boot and once per cooldown while
      open, through `generate` with the fixed probe request of section 2.4, never on a
      turn; the probe is injectable and the spec counts it.
- [ ] The turn record names `fellBackFrom` when a later entry served, and every breaker
      change is an `assistant.breaker` log event (section 3).
- [ ] The mid turn rule of section 2.2 is specified: a failure after a `TOOL` turn opens
      the breaker and rethrows, and no later entry sees the request.
- [ ] The manual slot check of the target state is in the PR body, or the reason it was
      not run (a slot needs the Gemini key, whose daily quota may be spent).

### Action boundaries

- Proceed with in-scope edits, specs, lint and build. The slot check spends one or two
  Gemini requests and is allowed.
- Stop and ask before adding a configuration key, changing a contract, or touching a file
  outside the scope.

### Progress evidence

Report when the suite passes and when the slot check is in or skipped with its reason.
Ground each claim in a command's output.

## 1. A failure says what failed

`ProviderUnavailableError` gains `readonly kind: ProviderFaultKind`:

```ts
export type ProviderFaultKind =
  | 'auth'       // 401, 403: the key is wrong, expired or lacks the permission
  | 'billing'    // 400 whose error message says the credit balance is too low
  | 'request'    // any other 4xx: our request is wrong, and no other entry fixes that
  | 'overloaded' // 529 on Claude, 503 with an overloaded message on Gemini
  | 'server'     // any other 5xx
  | 'network'    // fetch threw before a response
  | 'timeout';   // the abort fired
```

`ClaudeProvider.readError` and `GeminiProvider.readError` set it from the status and, for
the two text checks, from the API's `error.message` field read out of the JSON body, which
the warning line still never prints (`0224` section 2.2: the body can echo the prompt).
The `billing` check is `includes('credit balance')`, which is the sentence Anthropic's
API returns; Gemini has no equivalent and never answers `billing`. A 429 stays
`ProviderRateLimitedError` and is a fault of its own kind for the breaker.

`request` is the kind that does not trip anything. A 400 from a thinking mode a model
refuses, a 404 from a misspelled id, a 413 from a recording over the cap: the next entry
would get the same request and might answer it, but answering a malformed request with a
different model hides the bug that made it. The turn fails as today and the warning names
the status.

## 2. The breaker, `provider/fallback.ts`

### 2.1 State

One `Breaker` per chain entry, with `closed`, `open` with an `until` timestamp, and
`probing`. A closed breaker lets calls through. An open one lets none through. A probing
one lets none through either; it is the moment between the cooldown's end and the probe's
answer, and it exists so two cooldowns that end together do not send two probes.

### 2.2 The call

`FallbackBinding.generate(request)` walks the chain's entries whose breaker is closed, in
order:

- The entry answers: return it, and if it is not the first entry of the chain, mark the
  reply so the record can say `fellBackFrom` (the ids of the entries skipped or failed
  before it).
- The entry throws a tripping fault (`ProviderRateLimitedError`, or
  `ProviderUnavailableError` with any kind but `request`): open its breaker for the
  cooldown of section 2.3, log the event, and continue to the next entry **unless the
  request holds a `TOOL` turn**.
- The entry throws anything else: rethrow at once.

Every closed entry failed, or none was closed: throw the first error seen, or when none
was seen because every breaker was open, a `ProviderUnavailableError` of kind `server`
whose message names the job and the open entries. The first error is what makes rule A5
survive: a chain whose every entry is rate limited answers with the first entry's
`retryAfterSeconds` exactly as a single provider did.

**The mid turn rule.** A request with a `TOOL` turn in it is the second or a later call
of a turn. Its `MODEL` turns carry signatures the first entry minted, which the next entry
cannot read, and its tools already ran, so repeating the turn on another model would
write the lines twice. The failure opens the breaker and is rethrown, and the turn ends
as it does today. The next turn of the same conversation starts on the next entry with
a plain text transcript, which both providers read. The cost is one failed turn per
cooldown at most, and only when the fault arrives between rounds.

`transcribe` walks the same way with no mid turn rule, because a transcription is one
call.

### 2.3 Cooldowns

Constants in `fallback.ts`, each with its reason:

| fault | cooldown | why |
| --- | --- | --- |
| rate limited | the provider's `retryAfterSeconds`, floored at 30 s and capped at 10 min | the provider said; a Gemini daily quota answers 11 h and a cap keeps the probe asking |
| auth, billing | 15 min | nothing but a person fixes it, and a probe every quarter hour is cheap |
| overloaded, server, network, timeout | 60 s | these clear by themselves and the probe finds out |

### 2.4 The probe

When a cooldown ends, the breaker moves to `probing` and a background probe runs: one
`generate` with `system` `'Answer with the single word OK.'`, one `USER` turn `'ok'`, no
tools, the job's locale `'en'`. An answer of any text closes the breaker. A tripping fault
opens it again for the fault's cooldown. The probe is scheduled with a timer that is
`unref`'d so a stopping process does not wait for it, and it runs outside the service's
concurrency gate, because it is not a person's call and must not queue behind one.

At boot, `FallbackBinding` probes every entry once, in the background, so a dead key is
open before the first turn arrives. A plain binding (one usable entry) is not probed:
with nowhere to fall back to, the first turn is the probe, as today.

A probe on Haiku with adaptive thinking is about a hundred tokens, under a hundredth of a
cent; on Gemini it is one request of the day's quota. A transcription entry is probed
through `generate` too, because what the probe checks is the key, the account and the
host, and all three are the same for either primitive.

### 2.5 Cases for `fallback.spec.ts`

Fake providers that throw a given error on a given call, a fake probe counter, Jest fake
timers:

- first entry answers: second never called, no event, no `fellBackFrom`;
- first throws `auth` on a request with no `TOOL` turn: second answers the same request,
  one `open` event with `kind: auth` and `cooldownSeconds: 900`, `fellBackFrom` names the
  first;
- first throws `request`: rethrown, second never called, no event;
- first throws `auth` on a request with a `TOOL` turn: rethrown, second never called, the
  breaker is open, and the next request with no `TOOL` turn goes to the second;
- breaker open: the first is not called at all, the second serves;
- rate limited on both: the error thrown carries the first's `retryAfterSeconds`;
- every breaker open: a `server` fault naming the job;
- cooldown ends: exactly one probe runs, a text answer closes the breaker and the next
  request goes to the first again; a probe fault re-opens for its cooldown and one
  `open` event is logged;
- boot: one probe per entry, none on a plain binding;
- `transcribe` falls back on `auth` and has no mid turn rule.

## 3. The record and the log

The turn record of `0226` section 5 gains `fellBackFrom: string[] | null`, the ids that
did not serve, in chain order. Every breaker change is one log event:

```json
{ "event": "assistant.breaker", "job": "turn", "model": "claude-haiku-5-5",
  "provider": "claude", "state": "open", "kind": "auth", "cooldownSeconds": 900 }
```

with `state: closed` and no `kind` when a probe closes it. The number to watch on a
dashboard is `open` events per day per model: one a week is a provider's bad minute, one
an hour is a key that needs the owner.

## 4. Latency, stated

- A healthy chain pays nothing: the calls of a turn are the calls of a turn.
- The turn that discovers a fault pays that fault once: about 300 ms for a 401, up to
  `ASSISTANT_PROVIDER_TIMEOUT_MS` for a host that does not answer. The cooldown then
  keeps every later turn off that entry, and the probe, not a turn, finds out when it is
  back.
- A key that is dead at boot costs no turn at all.

## 5. What this plan does not do

- No retry on the same entry. A retry is what `withRetries` in `model-engines` does for
  a one shot tool, and it is the wrong answer for a person waiting on a turn: the next
  entry answers in two seconds, a backoff answers in thirty.
- No re-run of a turn on the next entry after tools ran (section 2.2).
- No budget per job, and no configuration key for the cooldowns.
- No health endpoint field. `/health/live` keeps saying the process is up; a breaker's
  state is a log event, and a readiness probe that fails because a vendor is slow would
  take the pod out for the vendor's fault.
