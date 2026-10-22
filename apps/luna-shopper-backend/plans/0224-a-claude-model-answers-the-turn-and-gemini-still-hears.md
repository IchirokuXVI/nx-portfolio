> **PR:** [#803](https://github.com/IchirokuXVI/nx-portfolio/pull/803)

# 0224: a Claude model answers the turn, and Gemini still hears

> The assistant has one model provider, Gemini, reached over `fetch` behind the
> `ModelProvider` seam that plan `0039` section 9 built for exactly one purpose: so that
> swapping the model is a new implementation of one interface and nothing else. This plan
> adds that second implementation, Claude through the Messages API, and a switch that
> names which provider answers a turn. Claude takes no audio, so a spoken turn and a voice
> comment keep being transcribed by Gemini: a split provider answers with one model and
> hears with the other. Nothing changes for a deployment that does not set the switch.
>
> The model and the effort level in section 10 come from the evaluation of 2026-10-22
> (the harness in the job directory, not in the repository, by rule A4): every tool of the
> catalog, both catalogs, Spanish and English, the edge cases of plans `0040`, `0043`,
> `0044`, `0046` and `0047`, run on Claude Haiku 5.5, Claude Sonnet 5.5 and the two
> Gemini Flash-Lite models.
>
> Prerequisite reading: `0039` sections 7, 9, 10 and 11 (the prompt, the seam, the record,
> the configuration), `0041` sections 3 and 7 (why a spoken turn is two calls, and what
> it costs), `0026` (an absent key is a supported deployment), `0045` section 4.1 (the
> gateway transcribes a voice comment through the same seam), and in the code
> `provider/model-provider.ts`, `provider/gemini.provider.ts`, `assistant/assistant.module.ts`,
> `config/app-config.ts`, `src/main.ts`, `k8s/helm/templates/luna-shopper-backend/_env.tpl`,
> `k8s/helm/templates/luna-shopper-backend/configmap.yaml.tpl`,
> `k8s/bootstrap/provision-release.sh`, `k8s/e2e/luna-shopper-backend/compose.apps.yml` and
> `k8s/e2e/luna-shopper-backend/luna-slot.sh`.

## Brief for the agent

### Objective

Add `ClaudeProvider`, a second `ModelProvider` over the Claude Messages API with `fetch`
and no SDK, a `SplitModelProvider` that answers with one provider and transcribes with
another, and the configuration that selects them: `ASSISTANT_PROVIDER`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_BASE_URL`, `ASSISTANT_CLAUDE_EFFORT` and `ASSISTANT_CLAUDE_THINKING`. Wire the
new keys through the chart, the provisioning script, the compose stack and the slot script.
Sections 1 to 11 describe the whole job.

### Context

Every statement below was read on `dev` on 2026-10-22.

- `ModelProvider` (`provider/model-provider.ts:164` to `:208`) has four members:
  `configured`, `transcriptionSupported`, `generate` and `transcribe`. `ModelToolCall`
  (`:32` to `:61`) carries an optional `signature`, an opaque string the provider attaches
  to a call and receives back unchanged when the call is replayed. Gemini uses it for its
  thought signature; this plan uses it for the raw content of a Claude reply (section 2.3).
- `GeminiProvider` (`provider/gemini.provider.ts`) is the model for the new class: one
  private `post` with a deadline from `providerTimeoutMs` (`:99` to `:140`), `readError`
  that maps 429 to `ProviderRateLimitedError` with the provider's own retry hint and
  everything else to `ProviderUnavailableError` (`:146` to `:164`), and exported pure
  mapping functions (`toGeminiRequest`, `readReply`, `readUsage`) that its spec exercises
  with fixtures and no network.
- `AssistantModule` (`assistant/assistant.module.ts:24`) binds `MODEL_PROVIDER` with
  `useClass: GeminiProvider`. Nothing above that line names Gemini.
- `AssistantService` reads `provider.configured` (`assistant.service.ts:560`) to answer
  501, and `provider.transcriptionSupported` (`:122`, `:197`) to lose the microphone and
  keep the assistant. `record` (`:734`) logs `tokens: entry.usage`, a `ModelUsage`.
- `app-config.ts` declares `GEMINI_API_KEY` and `GEMINI_BASE_URL` with `allow('')`
  (`:98` to `:99`), `ASSISTANT_MODEL` with the default `gemini-3.5-flash-lite` (`:38`,
  `:100`), and `ASSISTANT_TRANSCRIPTION_MODEL` with `allow('').default('')` (`:117`), which
  falls back to `ASSISTANT_MODEL` (`:252` to `:255`).
- `main.ts:67` warns at boot when `GEMINI_API_KEY` is empty.
- The chart reads `GEMINI_API_KEY` from the Secret (`_env.tpl:253` to `:257`) and the
  assistant's non secret keys from the ConfigMap (`_env.tpl:258`,
  `configmap.yaml.tpl:185` to `:190`). `provision-release.sh` prompts for the key
  (`:597`), writes it into the Secret (`:646`) and lists it in `OPTIONAL_EMPTY_KEYS`
  (`:141`). `--check` (`:262` onward) renders the chart, reads every `secretKeyRef` and
  fails on a key the Secret does not hold (`:355` to `:370`), and accepts an empty value
  only for a key in that list.
- `compose.apps.yml:363` and `luna-slot.sh:1540` state the assistant's environment by hand
  and inherit nothing from the chart (plan `0039` section 11).
- The Claude Messages API has no audio content block. A user message takes `text`,
  `image`, `document` and tool blocks, and nothing else (the API reference, read on
  2026-10-22). `transcriptionSupported` is therefore `false` on `ClaudeProvider`, which is
  the case plan `0041` section 3.2 wrote the field for.
- The evaluation harness of 2026-10-22 holds a working `ClaudeProvider` written against
  this seam (`C:\Users\Ichi\.claude\jobs\4999a9e2\tmp\assistant-eval\claude.provider.ts`
  on the owner's machine). It is the reference for the wire shape in section 2. Copy the
  shape, not the file: the repository version has the config, the logger and the spec that
  the harness did not need.

### Target state

- `npx nx test luna-shopper-backend-assistant` passes, with new specs for the request
  mapping, the reply reading, the signature round trip, the error mapping and the split.
- `npx nx lint luna-shopper-backend-assistant` and `npx nx build luna-shopper-backend-assistant`
  pass.
- `ASSISTANT_PROVIDER=claude` with `ANTHROPIC_API_KEY` set and `GEMINI_API_KEY` set:
  a typed turn runs on Claude, a spoken turn is transcribed by Gemini and answered by
  Claude, a voice comment is transcribed by Gemini.
- `ASSISTANT_PROVIDER=claude` with `GEMINI_API_KEY` empty: the typed turn works, the
  voice route answers 501 and a voice comment settles `UNAVAILABLE`.
- `ASSISTANT_PROVIDER` unset or `gemini`: byte for byte the behaviour of today.
- `provision-release.sh --check` passes on a cluster whose Secret carries
  `ANTHROPIC_API_KEY`, empty or not, and names the key when it is absent.
- `luna-slot.sh --up` writes the new keys into the assistant `.env`, and a pasted
  `ANTHROPIC_API_KEY` survives a second run (`DERIVED_KEYS` does not name it).

### Scope

- Work only in: `apps/luna-shopper-backend/assistant/src/**`,
  `k8s/helm/templates/luna-shopper-backend/_env.tpl`,
  `k8s/helm/templates/luna-shopper-backend/configmap.yaml.tpl`, `k8s/helm/values.yaml`,
  `k8s/bootstrap/provision-release.sh`, `k8s/e2e/luna-shopper-backend/compose.apps.yml`,
  `k8s/e2e/luna-shopper-backend/luna-slot.sh`,
  `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`, and this plan file.
- Do NOT touch: `prompt.ts`, `tools.ts`, `list-resolution.ts`, `turn-context.ts`,
  `link-and-choices.ts` (the evaluation ran against them as they are, and the result in
  section 10 holds for that prompt), the gateway, core, the contracts, velista,
  `package.json`, `package-lock.json`, any `.env`.

### Constraints

- No SDK. `@anthropic-ai/sdk` is not a dependency and does not become one, for the reason
  `gemini.provider.ts:20` to `:27` gives: the repository's third party clients are `fetch`
  and fixtures, and the seam is where a swap happens.
- Rule A4 holds: no test reaches a provider. Every spec runs against fixtures and
  `FakeModelProvider`.
- The key never enters the repository. Specs use a literal such as `test-key`.
- Prettier is the source of truth; run it on each changed file, never on a directory.
- Only make the changes this plan asks for. Do not add streaming, server side fallbacks,
  structured outputs, `strict` tool schemas, a second cache breakpoint on the system
  prompt, or a Claude transcription path. Section 11 records why each is out.

### Acceptance criteria

- [ ] `claude.provider.ts` exports `ClaudeProvider`, `toClaudeRequest`, `readClaudeReply`
      and `readRetryAfterSeconds`, with a spec covering each case in section 9.
- [ ] `split.provider.ts` exports `SplitModelProvider`, with a spec covering section 3.
- [ ] `assistant.module.ts` binds `MODEL_PROVIDER` through a factory that reads
      `ASSISTANT_PROVIDER` (section 4).
- [ ] `app-config.ts` validates the five new keys as section 5 states, and the default of
      `ASSISTANT_MODEL` follows the provider.
- [ ] `ModelUsage` carries `cachedPromptTokens`, both providers fill it, the turn record
      logs it (section 8).
- [ ] The chart, the provisioning script, the compose stack and the slot script carry the
      new keys (section 6), and `helm template` renders.
- [ ] The PR body tells the owner to re-run `provision-release.sh --env staging` and
      `--env production` before the deploy, and why (section 6.2).

### Action boundaries

- Proceed with in-scope edits, specs, lint, build and `helm template`.
- Stop and ask before adding a dependency, touching a file outside the scope, or changing
  the prompt or a tool declaration.

### Progress evidence

Report when the provider spec passes, when the chart renders, and at the PR. Ground each
claim in a command's output.

## 1. What is being built

Three things, and the third is the reason the first two are small.

1. **`ClaudeProvider`**: `generate` over `POST /v1/messages`, `transcribe` that throws,
   `transcriptionSupported` that is `false`.
2. **`SplitModelProvider`**: a `ModelProvider` built from two others. `generate` goes to
   the first, `transcribe` to the second, and the two flags come from the provider that
   does each job.
3. **The switch.** `ASSISTANT_PROVIDER` names which provider answers. `gemini` is the
   default and the behaviour of today. `claude` binds a split of `ClaudeProvider` for the
   turn and `GeminiProvider` for the hearing.

Nothing above the seam changes. The turn loop, the tools, the prompt, the record, the
limiter, the gateway and the client are untouched, which is what plan `0039` section 9
promised a swap would cost.

## 2. The Claude provider

### 2.1 The request

One `POST` to `${ANTHROPIC_BASE_URL}/messages` with the headers `x-api-key`,
`anthropic-version: 2023-06-01` and `content-type: application/json`. The body, mapped
from `ModelRequest`:

- `model`: the configured model.
- `max_tokens`: 4096. A reply is one or two sentences, and the number has to cover the
  thinking that precedes a tool call as well as the text.
- `system`: an array with one text block holding `request.system`.
- `tools`: one entry per `ModelToolDeclaration`, as `{ name, description, input_schema }`.
  The schema is the declaration's `parameters`, unchanged. The last entry carries
  `cache_control: { type: 'ephemeral' }` (section 7).
- `messages`: one entry per `ModelTurn`, in order (section 2.3).
- `thinking` and `output_config.effort`: section 10.

No `temperature`, no `top_p`, no `top_k`, no `tool_choice`, no prefill. The current
models reject every one of them.

### 2.2 The reply

`readClaudeReply` reads the response's `content` array: the joined `text` blocks become
`text`, each `tool_use` block becomes a `ModelToolCall` with `id`, `name` and `args`
(`input`), and `usage` becomes `ModelUsage` (`input_tokens`, `output_tokens`, their sum,
and `cache_read_input_tokens` as `cachedPromptTokens`).

A `stop_reason` of `refusal` is read as a reply with no text and no calls. The service
already answers an empty reply that asked for nothing with an empty string; this plan
makes that case say the same sentence as "got stuck" (`assistant.service.ts:447` to
`:451`), because an empty bubble is worse than an apology. Haiku has no server side
fallback and the request carries none (section 11).

### 2.3 The turns, and the signature

`messages` is built from `ModelTurn[]`:

- `USER`: `{ role: 'user', content: [{ type: 'text', text }] }`.
- `TOOL`: `{ role: 'user', content: [ { type: 'tool_result', tool_use_id: result.id,
  content: JSON.stringify(result.result) }, ... ] }`, one block per result, all in one
  message. The API treats results split across messages as a reason to stop calling tools
  in parallel.
- `MODEL`: the raw content the model produced, when the provider has it; otherwise a text
  block, if there is text, followed by one `tool_use` block per call.

The raw content is the point. Claude's current models return `thinking` blocks before a
tool call and require them back, unchanged, when the loop continues on the same model. A
replayed assistant turn that lost its thinking block breaks the turn, exactly as a Gemini
turn that lost its thought signature does (`model-provider.ts:46` to `:55`). The seam
already has the hook for this: `ModelToolCall.signature` is opaque, round trips per call,
and the loop never reads it. `readClaudeReply` therefore puts the JSON of the whole
`content` array into the `signature` of the **first** tool call of a reply, and
`toClaudeRequest` emits that array, parsed, as the assistant message whenever a `MODEL`
turn's first call carries one. A `MODEL` turn from the client's transcript carries no calls
and no signature, and is sent as text; the API accepts an assistant text turn with no
thinking block, because the history editing check applies to the turns that carried
thinking, not to prose.

The thinking text itself is empty under the default display setting, so the signature is
small, and it is not logged: the record keeps the call's name and arguments
(`assistant.service.ts:822`), never the signature.

### 2.4 Errors and deadlines

`post` mirrors the Gemini one: the `providerTimeoutMs` deadline through an
`AbortController`, a `ProviderUnavailableError` for a socket failure or a timeout. For a
non 2xx:

- 429: `ProviderRateLimitedError` with the `retry-after` header, when it is a number of
  seconds, else nothing, and the service supplies the number (rule A5).
- 529 (overloaded) and every other status: `ProviderUnavailableError`, with the status
  and the API's `error.type` in the log line and never in the message a caller sees, for
  the reason `gemini.provider.ts:157` gives: the body echoes the prompt.

### 2.5 `transcribe`

Throws `ProviderUnavailableError('this provider cannot transcribe')`. It is never reached:
`transcriptionSupported` is `false`, and both callers read the flag first
(`assistant.service.ts:122`, `:197`).

## 3. The split provider

`SplitModelProvider(turns: ModelProvider, hearing: ModelProvider)`:

- `configured`: `turns.configured`. A deployment with a Claude key and no Gemini key has
  an assistant.
- `transcriptionSupported`: `hearing.configured && hearing.transcriptionSupported`. A
  deployment with a Claude key and no Gemini key has no microphone, and the voice route
  answers 501 while the typed route works, which is the case plan `0041` section 3.2 made
  the field for. A voice comment settles `UNAVAILABLE` at once (plan `0045` section 4.2).
- `generate(request)`: `turns.generate(request)`.
- `transcribe(request)`: `hearing.transcribe(request)`.

No logic beyond delegation. The thing it buys is that `AssistantService` needs no change
to know that two providers exist: it keeps reading one object.

## 4. The binding

`assistant.module.ts` replaces `useClass: GeminiProvider` with a factory:

```ts
{
  provide: MODEL_PROVIDER,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ModelProvider => {
    const config = configService.getOrThrow<AssistantConfig>('assistant');
    const gemini = new GeminiProvider(configService);
    return config.provider === 'claude'
      ? new SplitModelProvider(new ClaudeProvider(configService), gemini)
      : gemini;
  },
}
```

`GeminiProvider` is constructed in both branches, because Gemini is the hearing in both.

## 5. Configuration

New keys in `app-config.ts`, every one of them optional, and the shipped defaults keep
today's behaviour:

| Key | Joi | Meaning |
| --- | --- | --- |
| `ASSISTANT_PROVIDER` | `valid('gemini', 'claude').default('gemini')` | Which provider answers a turn. |
| `ANTHROPIC_API_KEY` | `allow('').default('')` | Empty is a supported deployment, by the rule `GEMINI_API_KEY` follows. |
| `ANTHROPIC_BASE_URL` | `allow('').default('')` | Empty means `https://api.anthropic.com/v1`. A stand in for development, like `GEMINI_BASE_URL`. |
| `ASSISTANT_CLAUDE_EFFORT` | `valid('low', 'medium', 'high').default(<section 10>)` | `output_config.effort`. |
| `ASSISTANT_CLAUDE_THINKING` | `valid('adaptive', 'off').default(<section 10>)` | `adaptive` sends `{ type: 'adaptive' }`; `off` sends `{ type: 'disabled' }`, which Haiku accepts at effort `high` or below and Sonnet rejects. An operator who pairs `off` with a Sonnet model gets a 400 on the first turn and a log line that names the pairing. |

Two existing keys change meaning slightly:

- `ASSISTANT_MODEL` becomes `allow('').default('')`, and empty means the provider's own
  default: `gemini-3.5-flash-lite` for `gemini`, the model of section 10 for `claude`.
  `DEFAULT_ASSISTANT_MODEL` is renamed `DEFAULT_GEMINI_MODEL` and `DEFAULT_CLAUDE_MODEL`
  joins it. The configmap and the slot script write the key empty (section 6).
- `ASSISTANT_TRANSCRIPTION_MODEL` is always a Gemini model, whatever the provider. Empty
  falls back to `ASSISTANT_MODEL` when the provider is `gemini`, and to
  `DEFAULT_GEMINI_MODEL` when it is `claude`, because a Claude model name sent to the
  Gemini endpoint is a 404 on every spoken turn.

`AssistantConfig` gains `provider`, `anthropicApiKey`, `anthropicBaseUrl`, `claudeEffort`
and `claudeThinking`. `main.ts:67` warns at boot when the key of the configured provider
is empty, naming that key, and warns separately when the provider is `claude` and
`GEMINI_API_KEY` is empty ("the assistant answers and cannot hear").

## 6. The chart, the provisioning, the compose stack and the slot

### 6.1 The files

- `_env.tpl`: a second `secretKeyRef`, `ANTHROPIC_API_KEY`, under the assistant block, and
  `ASSISTANT_PROVIDER`, `ASSISTANT_CLAUDE_EFFORT` and `ASSISTANT_CLAUDE_THINKING` in the
  list of ConfigMap keys at `:258`. `ANTHROPIC_BASE_URL` is not in the chart, like
  `GEMINI_BASE_URL`: a stand in is a development thing.
- `configmap.yaml.tpl`: `ASSISTANT_PROVIDER: {{ $assistant.provider | default "gemini" }}`,
  `ASSISTANT_MODEL: {{ $assistant.model | default "" }}` (the comment at `:181` says why
  the default moved into the service), `ASSISTANT_CLAUDE_EFFORT` and
  `ASSISTANT_CLAUDE_THINKING` with `default ""`, which the service reads as its own
  default.
- `values.yaml`: the assistant comment at `:528` names both keys and the switch. No
  environment values file changes, as before: the service is not routed.
- `provision-release.sh`: `ANTHROPIC_API_KEY` in `OPTIONAL_EMPTY_KEYS` (`:141`), read
  from the existing Secret (`:587`), prompted after the Gemini key (`:597`), written into
  the Secret (`:646`) and printed in the summary (`:699`).
- `compose.apps.yml:363`: `ASSISTANT_PROVIDER: gemini` and `ANTHROPIC_API_KEY: ''` beside
  `GEMINI_API_KEY: ''`, with the same sentence: the suite needs both empty (rule A4).
- `luna-slot.sh:1540`: `ASSISTANT_PROVIDER=gemini`, `ANTHROPIC_API_KEY=`,
  `ANTHROPIC_BASE_URL=`, `ASSISTANT_CLAUDE_EFFORT=`, `ASSISTANT_CLAUDE_THINKING=` in the
  assistant heredoc, with a comment that a pasted key survives a re-run. None of them is
  derived from the slot, so `DERIVED_KEYS` does not change.
- `parallel-worktree-testing.md:317`: name `ANTHROPIC_API_KEY` beside `GEMINI_API_KEY` as
  a value the merge protects.

### 6.2 The deploy order, which the owner has to do by hand

`--check` fails on a cluster whose Secret lacks a key the render refers to, and that is the
right answer: a `secretKeyRef` to a missing key is a pod stuck in
`CreateContainerConfigError`. So the first deploy of this chart needs the Secret to hold
`ANTHROPIC_API_KEY`, empty or not, in both clusters. `provision-release.sh --env staging`
and `--env production` add it: the script reads every existing value back and asks only
for what it does not have (`:587` to `:599`), so re-running it changes nothing else. The
PR body says this in its first paragraph. Until it is done, the staging deploy stops at
the preflight in seconds, which is what the preflight is for (plan `0003`).

Turning Claude on in a cluster is then two values in the environment file,
`assistant.provider: claude` and the key in the Secret, and a rollout. Turning it off is
the same two in reverse. Neither needs a code change.

## 7. Prompt caching

One breakpoint, on the last tool declaration. The API caches the prefix up to it: the
tools, which are identical for every turn of a catalog, and nothing after. The system
prompt is not cached, because its last line is the caller's own index of zones and lists
(`turn-context.ts:259`), which changes per person and per turn, and a breakpoint on it
would write a cache entry that is read by nobody.

The tool catalog is about 2,200 tokens on the current tokenizer, above the 512 token
minimum both models cache. The evaluation measured the saving (section 10): the cached
read is a tenth of the price, and it is why a Haiku turn costs a quarter of a Gemini turn
at the paid rate. A second
breakpoint on the stable head of the system prompt would need the seam to carry the
prompt in two parts, and is out (section 11).

## 8. The record

`ModelUsage` gains `cachedPromptTokens: number | null`. `ClaudeProvider` fills it from
`cache_read_input_tokens`; `GeminiProvider` fills it from `cachedContentTokenCount`, which
is `null` today because nothing on that side caches. The turn record logs it inside
`tokens`, so the dashboard that reads `assistant.turn` can tell a cached prefix from a
paid one, which is the number that decides whether section 7 was worth a line. Nothing
else in the record changes.

## 9. Testing

Rule A4: nothing here reaches a provider. The specs mirror `gemini.provider.spec.ts`:

`claude.provider.spec.ts`:

- `toClaudeRequest` sends the prompt as `system`, the tools as `input_schema` with the
  breakpoint on the last one, a `USER` turn as a text block, a `TOOL` turn as one message
  of `tool_result` blocks keyed by the call ids, and a `MODEL` turn with a signature as the
  parsed raw content.
- A `MODEL` turn without a signature (from the client's transcript) is a text block.
- `readClaudeReply` reads text, the calls with their ids, the usage with the cache read
  count, and attaches the raw content to the first call's signature only.
- A refusal reads as an empty reply.
- `readRetryAfterSeconds` reads a numeric header and ignores a date.
- `post` (through a stubbed `fetch`): 429 becomes `ProviderRateLimitedError` with the
  header's number, 529 becomes `ProviderUnavailableError`, a timeout becomes
  `ProviderUnavailableError` naming the deadline. The stub asserts the key went in
  `x-api-key` and nowhere else.
- `transcriptionSupported` is `false` and `transcribe` throws.

`split.provider.spec.ts`: each of the four members delegates to the right side, with two
`FakeModelProvider`s, and the two flag cases of section 3.

`assistant.service.spec.ts`: one new case, an empty reply with no calls answers the "got
stuck" sentence (section 2.2). `app-config` cases for the two fallbacks of section 5, where
that file has a spec; if it has none, the cases go in a new `app-config.spec.ts`.

## 10. The model, the effort and the thinking

**`claude-haiku-5-5`, `thinking: { type: 'adaptive' }`, `output_config: { effort: 'low' }`.**
These are the three defaults of section 5 and the value of `DEFAULT_CLAUDE_MODEL`.

The evaluation of 2026-10-22 ran 48 scenarios, three runs each, through the real
`AssistantService`, the real prompt and tools, and an in memory gateway, on seven
variants. The numbers that decided this section:

| Variant | Pass | Mean turn | p95 turn | Cost per 1,000 turns |
| --- | --- | --- | --- | --- |
| Haiku 5.5, adaptive, effort low | 89% | 2.4 s | 4.1 s | $0.35 |
| Haiku 5.5, adaptive, effort medium | 88% | 2.6 s | 4.2 s | $0.37 |
| Haiku 5.5, thinking off | 77% | 2.0 s | 3.4 s | $0.29 |
| Sonnet 5.5, adaptive, effort low | 90% | 2.7 s | 4.7 s | $6.14 |
| Sonnet 5.5, `between_tools` | 85% | 3.5 s | 5.4 s | $6.02 |
| Gemini 3.5 Flash-Lite (today's model) | 89% | 14.1 s | 37.9 s | $1.38 at the paid rate |
| Gemini 3.1 Flash-Lite | 79% (93% without timeouts) | 13.9 s | 32.8 s | $1.16 at the paid rate |

- **Thinking stays on.** With it off, Haiku asked which list when there was one list,
  asked before a settle, which the tool description forbids, skipped a `rename_me` call,
  and answered five Spanish turns in English. Adaptive thinking at effort `low` removed
  nearly all of it for about 20% more cost.
- **Effort `low`, not `medium`.** The two score the same and `medium` is slower and dearer.
- **Not Sonnet.** One point of pass rate for seventeen times the cost. The one case where
  Sonnet is genuinely better, an invented count read off the `total` field of a
  `query_lists` result, is a defect of the tool result that plan `0225` fixes for every
  model.
- **The cost is below Gemini's paid rate** because the tool catalog is read from the
  cache: about 4,300 cached tokens per turn against 2,100 uncached. A cold turn (no turn
  in the last five minutes) pays the cache write instead, about $0.00085, still under the
  Gemini paid rate of $0.00138.
- **Latency.** The Gemini figures were measured on a rate limited key during an hour of
  "high demand" answers, so they are an upper bound. The Claude figures are ordinary.

The Gemini provider is unchanged, and `ASSISTANT_PROVIDER=gemini` keeps today's model.

## 11. What this plan does not do, and why

- **No Claude transcription.** The API has no audio input. The split provider is the
  answer, and it is also why `ASSISTANT_TRANSCRIPTION_MODEL` stays a Gemini name.
- **No one call spoken turn.** Plan `0041` section 3.1 chose two calls so that the client
  gets a transcript it can check, and Claude cannot take the audio anyway. The probe of
  2026-10-22 showed that Gemini can now return a `HEARD:` line, or a `report_transcript`
  call, beside the action call in one response, but the words in it are whatever the model
  chose to write, so the transcript is still not a field the client can trust. The same
  probe found both Flash-Lite models inventing a sentence for two seconds of silence, in
  the separate transcription call too. Neither finding belongs to this plan.
- **No streaming.** Plan `0039` section 14 leaned no, and a reply of two sentences has
  nothing to stream.
- **No server side fallback on refusal.** Haiku has none; on Sonnet it would re-run a
  grocery sentence on a dearer model for a case that does not occur. A refusal reads as an
  apology (section 2.2).
- **No `strict` schemas and no structured outputs.** The tool schemas use `minItems`,
  `maxItems`, `minimum` and `maximum`, which strict mode does not take, and the loop reads
  `tool_use` blocks, not JSON prose.
- **No second cache breakpoint.** Section 7.
- **No prompt change.** The evaluation ran the prompt as it is; a prompt tuned for one
  model is a separate plan with its own measurement.
- **No change to the limiter.** `ASSISTANT_TURNS_PER_MINUTE` and `ASSISTANT_CONCURRENCY`
  were sized for a shared free tier. They stay, and a later plan can raise them once the
  record shows Claude's 429s are rare.

## 12. Exit criteria

- The acceptance criteria of the brief.
- A slot with `ASSISTANT_PROVIDER=claude`, a pasted `ANTHROPIC_API_KEY` and a pasted
  `GEMINI_API_KEY` answers a typed turn, a spoken turn and transcribes a voice comment
  (checked by hand by the builder with the owner's keys, never by a spec).
- The same slot with `GEMINI_API_KEY` blank answers the typed turn and 501 on the voice
  route.
