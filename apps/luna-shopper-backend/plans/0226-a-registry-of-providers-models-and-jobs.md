# 0226: a registry of providers, models and jobs

> Plan `0224` gave the assistant a second provider and a switch, `ASSISTANT_PROVIDER`, and
> the module factory chooses between the two with an `if`. The curation toolchain met the
> same fork two providers earlier and answered it in `libs/shared/model-engines` plan
> `0001`: one table in which an entry is the whole of what a provider is, and nothing above
> the table may ask `if (name === 'api')` again. This plan brings that answer to the
> assistant, in the shape the owner asked for on 2026-10-23: a **provider** adapter owns
> the wire, a **model** row owns the facts about one model and may override the provider's
> settings, and a **job** names what the service asks a model to do and which capabilities
> that needs. The two jobs that exist today, the turn and the transcription, are ported
> onto it. No new job is added here: a job is added by the plan that needs it.
>
> The design holds the jobs the owner listed for later (sections of a shop mapped to a list,
> similar products by embedding, a live conversation while shopping, prices captured in
> that conversation) by making a capability a fact on a model row and a need on a job. A
> model that cannot do a job is refused at boot, in a log line, and never by a person.
>
> The default turn model becomes Claude Haiku 5.5, the evaluation's choice, and the
> transcription stays on Gemini, because no Claude model hears. A deployment with no
> Anthropic key keeps answering with Gemini: the first model in the chain whose provider
> has a key is the one that serves.
>
> Prerequisite reading: `0224` sections 1 to 5 and 10 (the Claude provider, the split, the
> keys, the evaluation), `0225` (the shared prompt fixes, which is why a per model prompt
> is a small addendum here and not a fork), `0039` sections 9 to 11 (the seam, the record,
> the configuration), `0041` section 3 (why a spoken turn is two calls), `0026` (an absent
> key is a supported deployment), `libs/shared/model-engines/plans/0001` (the registry
> idea, read for its reasoning; its code is one shot `.mjs` with no tools and is not
> reused), and in the code `provider/model-provider.ts`, `provider/claude.provider.ts`,
> `provider/gemini.provider.ts`, `provider/split.provider.ts`,
> `provider/fake-model.provider.ts`, `assistant/assistant.module.ts`,
> `assistant/assistant.service.ts`, `assistant/prompt.ts`, `config/app-config.ts`,
> `src/main.ts`, and the six places the chart and the scripts name the keys (section 7).
>
> **Build order.** This plan is built after PR #803 (plan `0224`) and PR #804 (plan `0225`)
> are merged into `dev`. Every line number below was read on PR #803's branch on
> 2026-10-23; `assistant.service.ts` moves by a few lines once #804 is in.

## Brief for the agent

### Objective

Replace the provider switch of plan `0224` with a registry in
`apps/luna-shopper-backend/assistant/src/app/provider/`: a table of providers, a table of
models with capabilities, settings and prices, and a table of jobs with the capabilities
each needs. Resolve each job to a model and a provider instance at boot from a chain of
model names in its config key, port the turn and the transcription onto those bindings,
delete `SplitModelProvider` and `ASSISTANT_PROVIDER`, make Claude Haiku 5.5 the default
turn model with Gemini as the next in the chain, and carry the job, the model and a cost
in the turn record.

### Context

Every statement below was read on PR #803's branch on 2026-10-23.

- `ModelProvider` (`provider/model-provider.ts`) has `configured`, `transcriptionSupported`,
  `generate` and `transcribe`. `ClaudeProvider` and `GeminiProvider` take a `ConfigService`
  and read the model, the key, the base url and the timeout from `AssistantConfig`
  (`gemini.provider.ts:42` to `:63` and `:84`, `claude.provider.ts:53` to `:75`). One
  instance therefore answers for one model, and the transcription model is a second
  field read inside `GeminiProvider` (`:84`).
- `SplitModelProvider` (`provider/split.provider.ts`) delegates `generate` to one provider
  and `transcribe` to another. `assistant.module.ts:33` to `:44` builds it when
  `config.provider === 'claude'` and `GeminiProvider` alone otherwise.
- `AssistantService` reads one `ModelProvider` (`assistant.service.ts:108`), checks
  `configured` in `requireConfigured` (`:578` to `:584`) and `transcriptionSupported` in
  `transcribe` (`:136`) and `voice` (`:211`), calls `generate` through `ask` (`:668`) and
  `transcribe` through `viaProvider` (`:146`, `:225`), and writes one record per turn in
  `record` (`:753` to `:790`) with `tokens` and three latencies and no model name.
- `app-config.ts` declares `ASSISTANT_PROVIDERS`, `ASSISTANT_PROVIDER`, the Claude knobs
  `ASSISTANT_CLAUDE_EFFORT` and `ASSISTANT_CLAUDE_THINKING`, `ASSISTANT_MODEL` and
  `ASSISTANT_TRANSCRIPTION_MODEL`, and `resolveAssistantModels` picks the defaults by
  provider. `main.ts:66` to `:94` prints three warnings that read `config.provider`.
- `prompt.ts` builds two prompts, open and scoped, from one list of rule lines each, and
  neither has a line about any model.
- `FakeModelProvider` (`provider/fake-model.provider.ts:33` to `:34`) answers `configured`
  and `transcriptionSupported` as `true`, and `assistant.service.spec.ts:282` to `:292`
  builds the service from a fake config service, a fake provider, a context factory and a
  recording api.
- The keys reach the pod through `k8s/helm/templates/luna-shopper-backend/_env.tpl:267`
  (the configmap list) and `:262` (the Secret ref), `configmap.yaml.tpl:187` to `:199`,
  `values.yaml:553` to `:561`, `k8s/bootstrap/provision-release.sh:143` and `:604`,
  `k8s/e2e/luna-shopper-backend/compose.apps.yml:364` to `:370` and
  `k8s/e2e/luna-shopper-backend/luna-slot.sh:1547` to `:1558`.
- The evaluation harness is outside the repository, at
  `C:\Users\Ichi\.claude\jobs\4999a9e2\tmp\assistant-eval\` on the owner's machine. Its
  `run.ts` constructs `AssistantService` by hand with a provider; after this plan it
  constructs it with the jobs object of section 4. Rule A4 is about the repository's
  suite; the harness is a tool on the owner's machine and is never committed.

### Target state

- `npx nx test luna-shopper-backend-assistant`, `lint` and `build` pass, and
  `helm template` over `k8s/helm` with `values.staging.yaml` renders with no
  `ASSISTANT_PROVIDER`.
- With both keys set and every `ASSISTANT_*MODEL` key empty, boot logs
  `turn: claude-haiku-5-5 (claude)` and `transcription: gemini-3.5-flash-lite (gemini)`.
  With `ANTHROPIC_API_KEY` empty, both jobs resolve to `gemini-3.5-flash-lite` and a
  warning names the skipped entry and its reason.
- The turn record carries `job`, `provider`, `model` and `costUsd`.
- The harness, run against this branch for s01, s15 and s17 on `haiku-low` once each,
  passes all three (they passed on `0225`'s branch).

### Scope

- Work only in: `apps/luna-shopper-backend/assistant/src/**`, the six chart and script
  places of section 7, `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`, and
  this plan file.
- Do NOT touch: `libs/luna-shopper/contracts`, the gateway, `libs/shared/model-engines`,
  any `.env`, `package.json`, `package-lock.json`, the curation or leaflet tools.

### Constraints

- No new dependency. Node's global `fetch` stays the only client.
- The wire contract (`AssistantTurnResponse`, `AssistantTranscribeResponse`) does not
  change. The NATS patterns do not change.
- No test reaches a provider (rule A4). Every new spec runs against fakes.
- Prettier on each changed `.ts` file, never on a directory; the `.tpl` files are not
  formatted (the go-template parser is unavailable on the owner's machine).
- Only make the changes this plan asks for. The fallback at run time is plan `0227`.

### Acceptance criteria

- [ ] `provider/registry.ts` holds `PROVIDERS`, `MODELS` and `Capability`, with the four
      rows of section 2 and their prices dated, and `registry.spec.ts` asserts the
      invariants of section 2.4.
- [ ] `provider/jobs.ts` holds `JOBS`, the chain parser and `resolveJobs`, with the cases
      of section 3.4 in `jobs.spec.ts`.
- [ ] `ClaudeProvider` and `GeminiProvider` are built from a `ProviderInstanceOptions`
      object and no longer read `ConfigService`; their specs construct them so.
- [ ] `SplitModelProvider`, `ASSISTANT_PROVIDER`, `ASSISTANT_PROVIDERS`,
      `resolveAssistantModels` and the three provider warnings of `main.ts` are gone, and
      nothing in `src/` compares a provider name outside `registry.ts` and `jobs.ts`.
- [ ] `AssistantService` takes `ModelJobs` and reads `jobs.turn` and `jobs.transcription`
      (section 4); the service spec builds it through the `fakeJobs` helper.
- [ ] `buildSystemPrompt` appends the model row's `promptLines`, which are empty on every
      row, with one spec case that a line is appended after the rules.
- [ ] The record carries `job`, `provider`, `model` and `costUsd`, and the spoken turn's
      record names the transcription model too (section 5).
- [ ] The six chart and script places of section 7 no longer name `ASSISTANT_PROVIDER`,
      and `ASSISTANT_MODEL`'s comments in each describe the chain.
- [ ] The harness runs of the target state are in the PR body.

### Action boundaries

- Proceed with in-scope edits, specs, lint, build, `helm template`, and the three harness
  runs (a few cents of the owner's Claude credit, allowed for this work).
- Stop and ask before changing a contract, a NATS pattern, a tool description, or any
  file outside the scope.

### Progress evidence

Report when the suite passes, when `helm template` renders, and when the harness runs are
in. Ground each claim in a command's output.

## 1. Vocabulary

- A **provider** is a wire adapter: an endpoint, a header with a key, a request and reply
  mapping, the signature round trip, the error classification. `claude` and `gemini` are
  the two. The name is the API's, not the company's, because `gemini` is also the name
  the chart and the scripts already use.
- A **model** is one row: an id, its provider, its capabilities, the settings it needs
  on top of the provider's defaults, its prices, and the prompt lines it needs, if any.
- A **job** is one thing the service asks a model to do, with the capabilities that
  needs. `turn` needs `tools`. `transcription` needs `audio-in`.
- A **binding** is a job resolved at boot to one model row and one provider instance
  built for that model. The service holds one binding per job and nothing else about
  models.
- A **chain** is the models an operator names for a job, in order of preference. This
  plan uses the first usable entry and logs the rest; plan `0227` makes the rest serve
  when the first fails.

## 2. The registry, `provider/registry.ts`

### 2.1 Capabilities

```ts
export type Capability = 'tools' | 'audio-in';
```

A string union with exactly the two members a job reads today. The plan that adds a job
with a schema reply, an embedding or a live session adds its member there, because a
member nobody checks is a promise nobody tests.

### 2.2 Providers

```ts
export interface ProviderEntry {
  name: 'claude' | 'gemini';
  /** The key and the base url, read from the config, so the row never holds either. */
  key(config: AssistantConfig): string;
  baseUrl(config: AssistantConfig): string;
  /** What an id this table does not list is assumed to do, when named with a prefix. */
  assumedCapabilities: readonly Capability[];
  create(options: ProviderInstanceOptions): ModelProvider;
}
```

`assumedCapabilities` is `['tools']` for `claude` and `['tools', 'audio-in']` for
`gemini`. It exists for the model that ships tomorrow (section 3.2).

`ProviderInstanceOptions` is `{ apiKey, baseUrl, model, timeoutMs, settings }`, where
`settings` is the merged settings of section 2.3. Both providers lose their
`ConfigService` constructor and take this object. `GeminiProvider.transcribe` uses
`this.model`, because a binding for the transcription job is its own instance built for
the transcription model; the second field it reads today (`gemini.provider.ts:84`) goes.

### 2.3 Models

```ts
export type ModelEntry =
  | {
      id: string;
      provider: 'claude';
      capabilities: readonly Capability[];
      settings: ClaudeSettings;            // { effort, thinking, maxTokens }
      accepts: { thinking: readonly ClaudeThinking[] };
      prices: ModelPrices;
      promptLines: readonly string[];
    }
  | {
      id: string;
      provider: 'gemini';
      capabilities: readonly Capability[];
      settings: GeminiSettings;            // {} today
      prices: ModelPrices;
      promptLines: readonly string[];
    };

export interface ModelPrices {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  /** The day the numbers were read from the vendor's page. */
  asOf: string;
}
```

A discriminated union on `provider`, so a Gemini knob cannot be written on a Claude row
and the compiler says so. The settings a row carries are the model's own defaults on top
of the provider's; the operator's `ASSISTANT_CLAUDE_EFFORT` and
`ASSISTANT_CLAUDE_THINKING`, when not empty, override every Claude row. The order is
provider default, then row, then operator, and `mergeSettings` in this file is the one
place that order is written.

`accepts.thinking` is why a row has settings at all: Sonnet answers `{ type: 'disabled' }`
with a 400 and Haiku takes it (`0224` section 10). Today an operator learns that from the
400. With the row, `resolveJobs` refuses the pairing at boot with a sentence that names
the row.

The four rows, the only models the evaluation of 2026-10-22 measured, with prices read
that day:

| id | capabilities | settings | prices in $ per MTok, as of 2026-10-22 |
| --- | --- | --- | --- |
| `claude-haiku-5-5` | tools | effort low, thinking adaptive, maxTokens 4096; accepts adaptive and off | 0.10 in, 0.50 out, 0.01 cache read |
| `claude-sonnet-5-5` | tools | effort low, thinking adaptive, maxTokens 4096; accepts adaptive | 2.00 in, 10.00 out, 0.10 cache read |
| `gemini-3.5-flash-lite` | tools, audio-in | none | 0.30 in, 2.50 out, 0.03 cache read |
| `gemini-3.1-flash-lite` | tools, audio-in | none | 0.25 in, 1.50 out, null |

`promptLines` is empty on every row. The evaluation found every failure that looked model
specific was better fixed in the shared prompt (`0225`), so a row gains a line only with a
harness result in the PR that adds it, and the line is appended after the shared rules in
both prompt variants by `buildSystemPrompt({ context, locale, modelLines })`.

### 2.4 Invariants, in `registry.spec.ts`

Ids are unique; every row's provider is in `PROVIDERS`; every row has a non empty
`capabilities`; every `prices.asOf` is a date; the default turn chain of section 3.3
names rows that exist and whose first entry has `tools`; the default transcription chain
names a row with `audio-in`.

## 3. The jobs, `provider/jobs.ts`

### 3.1 The table

```ts
export const JOBS = [
  { name: 'turn', needs: ['tools'], env: 'ASSISTANT_MODEL' },
  { name: 'transcription', needs: ['audio-in'], env: 'ASSISTANT_TRANSCRIPTION_MODEL' },
] as const;
```

### 3.2 The chain syntax

A chain is a comma separated list, each entry `[provider:]model`. `claude-haiku-5-5` is a
row. `claude:claude-haiku-6` is not a row: it runs on the provider's defaults with the
provider's `assumedCapabilities`, so a model released tomorrow can be tried by an env edit
and a restart. An entry with no prefix that matches no row is skipped with a warning that
shows the prefix form. Whitespace around entries is trimmed; an empty value is the default
chain.

### 3.3 Resolution, at boot

`resolveJobs(config)` answers `ModelJobs`, one `JobBinding` per job:

```ts
export interface JobBinding {
  readonly job: JobName;
  /** False when no entry of the chain could serve: every call answers 501. */
  readonly available: boolean;
  readonly model: ModelEntry | null;
  /** The id as the chain named it, also for an id with no row. */
  readonly modelId: string | null;
  readonly provider: ProviderEntry['name'] | null;
  /** The usable entries after the first, for plan 0227. Logged here, not used. */
  readonly next: readonly ResolvedEntry[];
  generate(request: ModelRequest): Promise<ModelReply>;
  transcribe(request: TranscriptionRequest): Promise<string>;
}
```

For each job, in chain order, an entry is usable when its provider's key is not empty and
the entry's capabilities hold every one the job needs and, for a Claude row, the operator's
thinking override is in `accepts.thinking`. The first usable entry is the binding; the
others go in `next`. Each skipped entry is a warning with the reason: `no key`,
`lacks audio-in`, `unknown model, write claude:<id> to run it on provider defaults`, or
`thinking off is not accepted by claude-sonnet-5-5`. A job with no usable entry is
`available: false`, which is `0026`'s rule as today: the pod boots, the route answers
501, and the boot log says so.

The defaults:

- `ASSISTANT_MODEL` empty is `claude-haiku-5-5,gemini-3.5-flash-lite`. The owner chose
  Haiku on 2026-10-23 on the evaluation's numbers, and the second entry is what keeps a
  deployment with no Anthropic key, which is every cluster until the owner re-provisions,
  answering exactly as it does today.
- `ASSISTANT_TRANSCRIPTION_MODEL` empty is the turn's resolved model when that model has
  `audio-in`, and `gemini-3.5-flash-lite` otherwise. So a Gemini turn keeps hearing with
  its own model, as `0224` section 5 arranged, and a Claude turn hears with Gemini. An
  operator who writes a transcription model explicitly gets it, also when the turn model
  could hear by itself: a model does not need a transcriber to be given one, because the
  transcript is a checkable field the client shows and the two call shape of `0041` keeps
  it so.

The resolution is done once, in the module factory, and the binding holds its provider
instance. Nothing is re-read per call.

### 3.4 Cases for `jobs.spec.ts`

Each case states the config and asserts the two bindings and the warnings:

- both keys, both chains empty: `turn` Haiku on claude, `transcription` Gemini 3.5 on
  gemini, no warning;
- Anthropic key empty, chains empty: both Gemini 3.5, one warning `no key` for Haiku;
- `ASSISTANT_MODEL=gemini-3.5-flash-lite`, transcription empty: both Gemini 3.5;
- `ASSISTANT_MODEL=gemini-3.5-flash-lite`, `ASSISTANT_TRANSCRIPTION_MODEL=gemini-3.1-flash-lite`:
  the explicit transcriber wins;
- `ASSISTANT_TRANSCRIPTION_MODEL=claude-haiku-5-5`: skipped with `lacks audio-in`,
  `transcription` is `available: false`;
- `ASSISTANT_MODEL=claude:claude-haiku-6`: unknown id on provider defaults, `tools`
  assumed, `model: null` and `modelId` kept for the record;
- `ASSISTANT_MODEL=claude-haiku-6`: skipped with the prefix hint;
- `ASSISTANT_MODEL=claude-sonnet-5-5` with `ASSISTANT_CLAUDE_THINKING=off`: skipped
  with the pairing sentence, next entry serves;
- a chain of three with the first two unusable: the third serves and `next` is empty.

## 4. The service

`AssistantService` takes `@Inject(MODEL_JOBS) jobs: ModelJobs` in place of the provider.
`requireConfigured` reads `jobs.turn.available`; the two `transcriptionSupported` checks
read `jobs.transcription.available`; `ask` calls `jobs.turn.generate`; the two
transcriptions call `jobs.transcription.transcribe`. `viaProvider`, the limiter and the
gate are unchanged: a budget per job is a later plan, and this one states that.

`ModelProvider` loses `configured` and `transcriptionSupported`: the first is now the
provider entry's key, the second a row's capability. `FakeModelProvider` loses the two
fields. `provider/fake-jobs.ts` exports `fakeJobs({ turn, transcription })`, which builds
a `ModelJobs` from one or two fakes with `available` true and a fixed model id, and the
service spec's `build()` takes it. `SplitModelProvider` and its spec are deleted.

The module factory becomes `useFactory: (configService) => resolveJobs(config, logger)`
and the `if` on the provider name is gone. `main.ts` prints one line per job with the
resolved model and provider, and `resolveJobs`'s warnings reach the log through the Nest
logger the factory passes in. The three warnings of `main.ts:66` to `:94` go: the first
two are the job lines, the third cannot happen once a chain entry is checked against its
row.

## 5. The record

`record` gains `job: 'turn'`, `provider`, `model` and `costUsd`, and on a spoken turn a
`transcription: { provider, model }` block beside the existing `transcriptionMs`. The
voice comment path, which transcribes and runs no turn, writes its own
`assistant.transcription` record with the same four fields and the latency; today it
writes nothing, and it costs money.

`costUsd` is `inputPerMTok × (promptTokens − cachedPromptTokens) + cacheReadPerMTok ×
cachedPromptTokens + outputPerMTok × responseTokens`, over a million, rounded to six
places, from the row's prices; `null` when the binding has no row or the usage is null.
Cache writes are not in `ModelUsage` and are not counted, which the field's comment
says: the number is a floor, correct to within the cache write share, which on the
evaluation was under 20% of a cold turn and zero on a warm one.

## 6. The providers

Both constructors take `ProviderInstanceOptions`. `ClaudeProvider` reads `effort`,
`thinking` and `maxTokens` from `settings` where it reads the config today
(`claude.provider.ts:73` to `:75`, `:27`); its warning line names the same three.
`GeminiProvider` reads the model from `options.model` in both `generate` and
`transcribe`. The specs construct the providers from an options literal and lose the fake
config service. `TRANSCRIPTION_INSTRUCTION` stays where it is: provider owned prompt
text belongs to the provider.

## 7. The chart and the scripts

Six places, and what each changes:

- `_env.tpl:267`: drop `ASSISTANT_PROVIDER` from the list. The Secret ref for
  `ANTHROPIC_API_KEY` at `:262` stays; its comment says the key serves whenever a Claude
  model is in a chain.
- `configmap.yaml.tpl:192`: drop the line; `:187`'s comment explains the chain and the
  default.
- `values.yaml:553` to `:561`: drop `provider`; `model` is documented as the chain with
  the default written out; `claudeEffort` and `claudeThinking` stay as overrides.
- `provision-release.sh:604`: the prompt reads `Anthropic API key (blank keeps the
  assistant on Gemini)`. `OPTIONAL_EMPTY_KEYS` is unchanged.
- `compose.apps.yml:364`: drop `ASSISTANT_PROVIDER`. `ASSISTANT_MODEL` stays
  `gemini-3.5-flash-lite` there, because both keys are empty in the suite and the line
  documents what would serve.
- `luna-slot.sh:1547` to `:1555`: drop `ASSISTANT_PROVIDER=gemini` and its comment; the
  `ASSISTANT_MODEL` comment says a blank is the chain `claude-haiku-5-5,gemini-3.5-flash-lite`
  and that a pasted `ANTHROPIC_API_KEY` is enough to move a slot onto Haiku.
  `DERIVED_KEYS` does not change: none of these depends on the slot.

`parallel-worktree-testing.md` loses its sentence about the provider switch and gains one
about the chain.

## 8. What this plan does not do

- No fallback at run time. A key that dies after boot fails the turn as today. Plan
  `0227` adds the breaker over `next`.
- No new job and no new capability. `schema`, `embed` and `session` are added by the plans
  that need them, with their primitives on `ModelProvider`.
- No budget per job. The limiter and the gate stay as they are.
- No one call voice turn. A hearing turn model still transcribes first, because the
  transcript is a field the client shows (`0041` section 3) and the one call transcript
  Gemini returns is prose (`0224` section 10).
- No rename of the service. It is the one service that holds model keys and the
  registry, and future jobs reach it over NATS, but the chart, the queue group and the
  contracts carry its name and a rename is its own plan.
