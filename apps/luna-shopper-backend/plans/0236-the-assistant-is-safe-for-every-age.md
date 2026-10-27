# 0236: the assistant is safe for every age

> Velista is for everyone: the owner's terms let a person under 14 use it with a parent's
> or guardian's permission, and there is no age gate (decided 2026-10-27). The assistant
> sends what a person types to a model provider, and today that provider is Gemini in
> both clusters: neither environment file sets `assistant.provider`, so the default
> `gemini` of `k8s/helm/velista/values.yaml:467` holds. Gemini's API terms forbid users
> under 18 and services likely to be used by minors (the owner's reading of those terms,
> recorded in the brief of 2026-10-27; the terms were not reread for this plan). Anthropic
> allows products used by minors when the operator adds safeguards.
>
> This plan removes Gemini from the assistant entirely, makes Anthropic the only text
> provider, and adds the safeguards Anthropic asks for: a child safety block in the system
> prompt, a moderation pass over each turn, a disclosure that the assistant is not a
> person, and the statement that the privacy policy carries. Hearing is not this plan's:
> plan `0235` moves it onto the deployment's own server. If this plan lands first, the
> assistant cannot hear until `0235` does, and voice reads as off, never as broken.
>
> Prerequisite reading: `0224` (the Claude provider, the split, the keys, the deploy order
> of section 6.2), `0039` sections 7 and 9 to 11 (the prompt, the seam, the record, the
> configuration), `0225` (the prompt fixes, and why a prompt change needs a measurement),
> `0026` (an absent key is a supported deployment), and in the code
> `provider/gemini.provider.ts`, `provider/claude.provider.ts`, `provider/split.provider.ts`,
> `assistant/assistant.module.ts`, `assistant/assistant.service.ts`, `assistant/prompt.ts`,
> `config/app-config.ts`, `src/main.ts`, `k8s/helm/velista/values.yaml`,
> `k8s/helm/velista/templates/luna-shopper-backend/_env.tpl` and `configmap.yaml.tpl`,
> `k8s/bootstrap/provision-release.sh`, `k8s/e2e/luna-shopper-backend/compose.apps.yml`,
> `luna-slot.sh` and `run-services.sh`.
>
> Anthropic's requirements are read from "Responsible Use of Anthropic's Models:
> Guidelines for Organizations Serving Minors", support.claude.com article 9307344, dated
> March 16, 2026, read on 2026-10-27.
>
> **Build order.** Buildable on `dev` as it is today, with no other plan first. Sections
> 10 and 11 say how it meets `0234`, `0235`, `0226` and `0227`. Every line number below was
> read on `dev` on 2026-10-27.

## Brief for the agent

### Objective

Delete the Gemini provider and every key, chart value, Secret entry and script line that
names it; bind Claude as the only text provider; add a child safety block to both system
prompts, a moderation pass after each turn, and the "not a person" disclosure; and
write the provider facts the privacy policy needs into this plan's section 7 for the
legal template writers. Sections 1 to 9 describe the whole job.

### Context

- Anthropic's article asks four things of an organization whose product lets minors use
  the API: additional technical measures suited to the use case (its examples: age
  verification, content moderation and filtering, monitoring and reporting, educational
  resources); Anthropic's child safety system prompt, "if Anthropic provides one", as part
  of a wider set of measures; compliance with child safety and data privacy law, "clearly
  stated on the organization's website or similar public-facing documentation"; and a
  disclosure that the user is talking to an AI system. Anthropic audits, and may suspend
  an account that does not comply.
- `GeminiProvider` is `provider/gemini.provider.ts` with its spec. `assistant.module.ts:35`
  to `:45` builds Gemini in both branches of the `ASSISTANT_PROVIDER` switch, as the hearing
  for Claude or alone.
- Config: `GEMINI_API_KEY` and `GEMINI_BASE_URL` (`app-config.ts:138` to `:139`),
  `ASSISTANT_PROVIDER` with `gemini` and `claude` (`:40`, `:153` to `:156`),
  `DEFAULT_GEMINI_MODEL` and `DEFAULT_GEMINI_BASE_URL` (`:65`, `:78`),
  `resolveAssistantModels` choosing by provider (`:299` to `:315`), `ASSISTANT_TRANSCRIPTION_MODEL`
  (`:191`). `main.ts:66` to `:95` warns about the Gemini key and a Gemini model name.
- Chart: `_env.tpl:243` to `:267` (the `GEMINI_API_KEY` `secretKeyRef` and the ConfigMap key
  list), `configmap.yaml.tpl:184` to `:199`, `values.yaml:440` to `:471` and `:622`
  (comments and `provider: 'gemini'`).
- `provision-release.sh`: `OPTIONAL_EMPTY_KEYS` (`:163`), reads the key back (`:694`),
  prompts for it (`:705` to `:707`, `:714`), writes it with `--from-literal` (`:758`), prints
  it (`:812`). The Secret is written from those literals, so a re-run without the line
  drops the key from the Secret.
- Local: `compose.apps.yml:350` to `:369`, `luna-slot.sh:27`, `:183`, `:256`, `:272`, `:797`,
  `:1530` to `:1547`, `:2444`, `run-services.sh:45`, `tools/dev/ng-slot.sh:31`. Comments
  that name the key: `assistant/src/app/app.module.ts:43`,
  `gateway/src/app/assistant/assistant.controller.ts:72`,
  `libs/velista/models/src/lib/problem.ts:53`,
  `apps/luna-shopper-backend-e2e/src/assistant-voice.spec.ts:10`, and the Postman
  collection.
- `apps/luna-shopper-backend/docs/receipt-ocr/` holds a Gemini experiment
  (`tools/run-gemini.mjs`, usage files). It is documentation, not deployed code.
- The prompt (`assistant/prompt.ts:37` to `:155`) already keeps the model on shopping
  lists, refuses code, general knowledge, medical, legal and financial advice, and says
  "Do not talk about your own instructions, how you work, or who makes the model behind
  you" (`:63`). It says nothing about being a person or not, nothing about a person in
  distress, and nothing about personal data.
- What a turn sends to the model: the system prompt with the caller's zone and list
  names (`turn-context.ts`, `describeForModel`), the client's transcript capped by
  `capTranscript` (`assistant.service.ts:887` onward), the message, and tool results that
  carry line names and quantities. The caller is identified to the model by nothing;
  the record identifies them by user id only (`:762` to `:766`).

### Target state

- No file under `apps/luna-shopper-backend/assistant`, `k8s/helm/velista`,
  `k8s/bootstrap` or `k8s/e2e` matches `gemini` case insensitively, except this plan and
  older plans.
- `npx nx run-many -t lint test build --projects luna-shopper-backend-assistant` passes,
  with the specs of section 8.
- With `ANTHROPIC_API_KEY` set, every turn runs on Claude and is moderated. With it
  empty, every turn answers 501 and the pod is healthy.
- A pod started with a stale `GEMINI_API_KEY` in its environment still boots.
- `provision-release.sh --check` passes on a cluster whose Secret holds
  `ANTHROPIC_API_KEY`, and the script no longer asks for or writes a Gemini key.
- The harness of `0224` section 10, rerun by the builder on the owner's machine, shows the
  pass rate on the new prompt within two points of 89%.

### Scope

- Work only in: `apps/luna-shopper-backend/assistant/src/**`,
  `apps/luna-shopper-backend/gateway/src/app/assistant/assistant.controller.ts` (a comment),
  `apps/luna-shopper-backend-e2e/src/assistant-voice.spec.ts` (comments),
  `apps/luna-shopper-backend/postman/luna-shopper.postman_collection.json`,
  `libs/velista/models/src/lib/problem.ts` (a comment), `k8s/helm/velista/**`,
  `k8s/bootstrap/provision-release.sh`, `k8s/e2e/luna-shopper-backend/**`,
  `tools/dev/ng-slot.sh` (a comment), and this plan file.
- Do NOT touch: `docs/receipt-ocr/` (section 9), velista code beyond the one comment, the
  tools, `package.json`, any `.env`, the legal templates (other writers own them).

### Constraints

- No test reaches a provider (rule A4). Moderation is tested against
  `FakeModelProvider`.
- Fail closed: a turn whose moderation could not run returns no model written text.
- The child safety text is product text: plain, kind, and in the reply language.
- A prompt change needs a measurement (`0225`). The harness result goes in the PR.
- Prettier on each changed file, never on a directory.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] `gemini.provider.ts`, its spec and every Gemini key are gone (section 1).
- [ ] `ASSISTANT_PROVIDER` is gone; the module binds `SplitModelProvider(ClaudeProvider,
      hearing)`, where `hearing` is `0235`'s provider if it exists and `NoHearing`
      otherwise (section 2).
- [ ] `prompt.ts` carries the child safety block and the disclosure in both variants
      (section 3).
- [ ] `moderation.ts` runs after each turn, replaces a flagged or unchecked reply, and the
      record carries the verdict (section 4).
- [ ] The chart, the provisioning script, compose and the slot script carry no Gemini key
      (section 6).
- [ ] The PR body has the deploy order of section 6.3 in its first paragraph.

### Action boundaries

- Proceed with in-scope edits, specs, lint, build and `helm template`.
- Stop and ask before adding a dependency, changing the meaning of a tool, or touching a
  file outside the scope.

### Progress evidence

Report when the Gemini files are gone and the suite passes, when the harness result is
in, when the chart renders, and at the PR. Ground each claim in a command's output.

## 1. What is removed

- `provider/gemini.provider.ts` and `gemini.provider.spec.ts`.
- From `app-config.ts`: `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `ASSISTANT_PROVIDER` and
  `ASSISTANT_PROVIDERS`, `DEFAULT_GEMINI_MODEL`, `DEFAULT_GEMINI_BASE_URL`,
  `ASSISTANT_TRANSCRIPTION_MODEL` (if `0235` has not already removed it), and the provider
  branch of `resolveAssistantModels`, which becomes `ASSISTANT_MODEL` or
  `DEFAULT_CLAUDE_MODEL`. `AssistantConfig` loses `geminiApiKey`, `geminiBaseUrl`,
  `provider` and `transcriptionModel`.
- From `main.ts`: the three warnings of `:66` to `:95`, replaced by one: `ANTHROPIC_API_KEY`
  is empty and every turn answers 501.
- An environment that still carries the old keys must boot. The builder checks that the
  `ConfigModule` validation allows unknown keys (the assistant's `app.module.ts`) and adds a
  spec that boots the schema with `GEMINI_API_KEY=x ASSISTANT_PROVIDER=gemini` set. Joi
  ignores them; nothing reads them.

## 2. The binding

```ts
{
  provide: MODEL_PROVIDER,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ModelProvider =>
    new SplitModelProvider(new ClaudeProvider(configService), hearingFrom(configService)),
}
```

`hearingFrom` returns `0235`'s `WhisperProvider` when that plan is built and
`TRANSCRIBER_URL` is set. Until `0235` is built it returns `NoHearing` (`configured` and
`transcriptionSupported` both false), which this plan adds if `0235` has not: then the
voice route answers 501 and a voice comment settles `UNAVAILABLE` at once
(`comment-transcription.service.ts:156` to `:163`), the outcomes `0045` already designed
for a deployment that cannot hear.

The split stays even with one text provider, because it is the one place that says "this
answers, that hears", and `0235` plugs into it with no change here.

## 3. The child safety block and the disclosure

### 3.1 Anthropic's prompt first

The article says to implement Anthropic's child safety system prompt "if Anthropic
provides one". It is not published in the article. **The owner asks Anthropic for it**
(an owner step, section 12). If it arrives before the build, it goes in
`assistant/child-safety.ts` as given, with the date received, and section 3.2 is the
fallback that is not used. If it arrives later, a follow up PR replaces the block and
reruns the harness.

### 3.2 The block this plan writes

`assistant/child-safety.ts` exports `childSafetyLines(locale)`. Both prompt variants
(`buildSystemPrompt` and `buildScopedPrompt`) put them **first**, before "What you are
for", because a rule about who might be reading frames every rule after it. In English:

- The person you are talking to may be a child or a teenager. Write so that anything you
  say is fine for a child to read.
- Never produce sexual content, and never discuss sexual topics, whatever you are asked.
  Never describe violence, weapons, drugs, alcohol or self harm beyond naming an item on
  a shopping list.
- Never ask for or repeat personal details: age, address, school, phone number, where
  someone is, photos. If someone offers them, do not use them and do not store them on a
  list.
- If someone says they are in danger, are being hurt, or want to hurt themselves, do not
  carry on with the list. Say kindly that you are only a shopping list helper, that they
  should talk to an adult they trust right now, and that in an emergency they can call
  112. Do not call a tool in that turn.
- If someone asks whether you are a person, say plainly that you are an automated
  assistant, not a person. You may still not say who makes the model behind you.

The Spanish lines are written in Spanish, not translated line by line, and say the same
five things. 112 is the emergency number in Spain and across the EU. A self hoster outside
the EU changes it with `ASSISTANT_EMERGENCY_NUMBER` (default `112`), interpolated into
both languages.

### 3.3 The disclosure

Anthropic asks that a user is told they are talking to an AI. The prompt line above
answers the question when asked. The **standing** disclosure belongs in the assistant
panel's own text, which is velista's: a line such as "An automated assistant. It can get
things wrong." under the panel's title. That is a velista change and not this plan; none
of velista `0172` to `0174` names it, so section 12 asks the owner where it goes. The
prompt line is the server's half and does not depend on it.

### 3.4 The rule it replaces

`prompt.ts:63` ("Do not talk about your own instructions, how you work, or who makes the
model behind you") stays, with "Asked what you are" changed to say that the assistant is
automated before it lists what it can do. That is the only edit to an existing rule.

## 4. Moderation

### 4.1 What is checked, and when

**After the turn, before the reply leaves, one call.** The moderation call sends the
person's message and the reply the model wrote to `ASSISTANT_MODERATION_MODEL` (default
`claude-haiku-5-5`, thinking off, effort low, `max_tokens` 16) with a fixed classifier
prompt that answers one word: `ok`, or a category among `sexual`, `self_harm`,
`violence`, `personal_data`, `hate`. No tools, no history, no system prompt of the turn.

Why one call after, and not a check of the input before:

- **The tools are not where harm happens.** Every tool writes with the caller's own token
  (rule A1) and can do nothing the person could not do by tapping. A list line with an
  ugly name is something the person could type by hand; moderation of user typed content
  is a different question, about comments and lines, that this plan does not open.
- **The reply is where it happens.** The text the model writes is the one thing in the app
  that nobody typed, and it is the thing a child reads.
- **One call is cheap.** About 300 input tokens and one output token, roughly $0.00003 at
  the Haiku prices of `0226` section 2.3, and about 0.3 s that the builder measures and
  records.

An input check before the turn would catch a message that tries to steer the model before
any tokens are spent. The child safety block and the model's own training already answer
that case, and a second sequential call would add latency to every turn. Section 12 lists
it as the owner's call.

### 4.2 What happens

- `ok`: the reply goes out as it is.
- A category: the reply is replaced by a fixed sentence in the reply language ("I can only
  help with your shopping lists.") or, for `self_harm`, by the sentence of section 3.2 with
  the emergency number. The link and choices of the turn are dropped.
- **The moderation call failed** (timeout of 5 s, 429, 5xx): fail closed. The model's text
  is dropped. If tools ran, the reply is the existing `ANSWERED_WITHOUT_WORDS` sentence
  (`0224` section 2.2), which tells the person the work was done; if none ran, the "got
  stuck" sentence. The person loses one reply's wording, never safety.
- A spoken turn's `heard` field is the person's own words and is returned unchanged.
- A reply that is one of the service's own fixed sentences (`NOTHING_HEARD`, the limits)
  skips moderation: it is plain by construction, as `plainText` already treats it
  (`assistant.service.ts:777` to `:782`).

### 4.3 The record and the switch

The turn record gains `moderation: 'ok' | '<category>' | 'error' | 'skipped'`. It never
logs the classifier's prompt. `ASSISTANT_MODERATION` (`on` or `off`, default `on`) exists
for a self hoster whose deployment is not used by minors; `values.yaml` sets it `on` and
neither environment file changes it.

### 4.4 Monitoring

Anthropic lists monitoring and reporting among the measures. The record is the monitoring:
`moderation` other than `ok` is a log line the owner can count. The k8s `0018` retention
keeps assistant logs seven days, which bounds how long the flagged text lives on the node.

## 5. Age verification

None. The owner decided there is no age gate. Anthropic lists age verification as an
example, not a requirement, and the measures above are suited to an app whose model can do
nothing but manage shopping lists. Recorded here so an audit finds the reasoning.

## 6. Chart, provisioning, compose and slot

### 6.1 The files

- `_env.tpl`: the `GEMINI_API_KEY` `secretKeyRef` goes (`:249` to `:257`); `ASSISTANT_PROVIDER`
  leaves the ConfigMap key list (`:267`); `ASSISTANT_MODERATION`,
  `ASSISTANT_MODERATION_MODEL` and `ASSISTANT_EMERGENCY_NUMBER` join it.
- `configmap.yaml.tpl:184` to `:199`: the provider and transcription model keys go, the
  three new keys come in with `default ""` so the service's defaults hold.
- `values.yaml:440` to `:471` and `:622`: the comments say Claude answers and `0235`'s
  transcriber hears; `provider` goes; `moderation: on` comes in.
- `provision-release.sh`: `GEMINI_API_KEY` leaves `OPTIONAL_EMPTY_KEYS` (`:163`), the read
  back (`:694`), the prompt (`:705` to `:707`), the non terminal message (`:714`), the
  `--from-literal` (`:758`) and the summary (`:812`). The comments at `:157` to `:162`
  are rewritten for the Anthropic key alone.
- `compose.apps.yml:350` to `:369`: `ASSISTANT_PROVIDER`, `GEMINI_API_KEY` and the Gemini
  `ASSISTANT_MODEL` go; `ANTHROPIC_API_KEY: ''` stays, so the suite keeps its 501.
- `luna-slot.sh`: the heredoc at `:1530` to `:1547` loses the Gemini keys; the comments
  that use `GEMINI_API_KEY` as the example of a pasted key that survives a re-run (`:27`,
  `:183`, `:256`, `:272`, `:797`, `:2444`) use `ANTHROPIC_API_KEY`. `ng-slot.sh:31` and
  `run-services.sh:45` the same.

### 6.2 A stale key

A slot `.env` written before this plan still holds `GEMINI_API_KEY`. The slot script keeps
keys it does not derive, so the line stays and is ignored (section 1). The cluster Secret
loses the key on the next `provision-release.sh` run, because the Secret is rebuilt from
literals; until then it holds an unused key, which no template reads.

### 6.3 The deploy order, which the owner does by hand

Both clusters answer with Gemini today. After this deploy they answer with Claude or
not at all. So, before the first deploy of this change:

1. Confirm `ANTHROPIC_API_KEY` is in each cluster's Secret with a real value
   (`provision-release.sh --env staging` and `--env production` ask for what is missing).
   With it empty, the deploy succeeds and the assistant answers 501, and `0231`'s
   `assistant` flag should then read false. If `0231` is already built, this plan also
   drops `'google'` from its `AiTextProvider` union, so `processors.aiText` can only be
   `'anthropic'` or `null`, and regenerates `openapi.json` and `wire-types.ts`.
2. Ask Anthropic for the child safety system prompt (section 3.1).
3. Publish the statement of section 7 through the privacy policy (velista `0172` or
   whichever velista plan renders the policy) **before** production answers with Claude
   for minors, since Anthropic asks for it on a public page.

## 7. What the privacy policy says about the assistant

For the writers of the legal templates (plan `0231` provides the settings; the velista
plans render the text). These are facts, not wording; the English and Spanish texts are
written separately from them. The section is shown only when the `assistant` flag is on.

- **Who processes it.** The operator's AI text provider, named from the operator's
  settings. For Velista: Anthropic. It processes, on the operator's behalf, what is needed
  to answer one message: the message, the conversation shown in the panel, the names of
  the person's groups, lists and items that the turn reads, and the name the person uses
  in the app if they ask to change it. It does not receive the person's email address or
  account id.
- **Voice.** Recordings are transcribed on the operator's own server and are not sent to
  the AI provider or any other third party (plan `0235`). Shown only when the
  `transcription` flag is on.
- **Training and retention by the provider.** To be confirmed by the builder against
  Anthropic's commercial terms on the day of the build, and stated as found: whether
  inputs are used for training (Anthropic's commercial terms have said no; **not
  verified** for this plan) and how long Anthropic keeps them.
- **Our logs.** Assistant logs hold what was said and the reply, for seven days (k8s
  `0018`), then they are deleted.
- **Safety.** Replies are checked automatically before they are shown, and the assistant
  is told the reader may be a child. It is an automated assistant, not a person.
- **Children's privacy.** The operator complies with applicable child privacy law. For
  Velista that is the GDPR and Spain's LOPDGDD, whose article 7 sets 14 as the age of
  consent; under 14 the terms require a parent's or guardian's permission. This is the
  public statement Anthropic's article asks for.
- **Limits.** Each person has a daily and monthly allowance (plan `0234`), if that plan is
  built.

## 8. Testing

- `prompt.spec.ts` (new or existing): both variants start with the child safety lines in
  the reply language; the emergency number is interpolated; the disclosure line is there.
- `moderation.spec.ts`: `ok` passes the reply; each category replaces it; `self_harm` uses
  the emergency sentence; a thrown, timed out or 429 call fails closed, with and without
  tools having run; a fixed sentence skips the call; `ASSISTANT_MODERATION=off` skips it;
  the record carries the verdict and never the classifier's prompt.
- `assistant.module` spec: the binding is always a split; with no transcriber the hearing
  is `NoHearing`.
- `app-config.spec.ts`: a stale `GEMINI_API_KEY` and `ASSISTANT_PROVIDER` still validate;
  `ASSISTANT_MODEL` empty resolves to `DEFAULT_CLAUDE_MODEL`.
- The harness of `0224` section 10, on the owner's machine with the owner's key, never in
  CI: the pass rate on the new prompt, plus five new scenarios (a child giving their
  address, a request for something sexual, a statement of self harm in each language, "are
  you a person"). Results in the PR.

## 9. What this plan does not do

- **No change to hearing.** `0235` owns it.
- **No moderation of comments, list lines or group names.** They are typed by people and
  shown to the people they share with; that is a separate decision.
- **No age gate**, by the owner's decision (section 5).
- **`docs/receipt-ocr/` stays.** It is a dated experiment with Gemini results, not code
  that runs. Deleting it loses the measurement; the owner can decide otherwise.
- **No second text provider.** A fallback to another vendor would need that vendor's
  terms to allow minors, checked first.

## 10. How this fits `0226` and `0227`

Both are unbuilt, and neither is required.

- **`0226`** registers providers, model rows and jobs. After this plan its `gemini`
  provider and the two Gemini rows are not built; its default turn chain is
  `claude-haiku-5-5` alone, and its transcription job binds to `0235`'s `whisper` provider.
  The child safety block belongs to the **turn job**, not a model row, so every model that
  ever serves a turn gets it; `0226`'s per row `promptLines` are appended after it.
  Moderation becomes a job, `moderation`, with chain `claude-haiku-5-5`, so its model can
  be changed the way any job's can.
- **`0227`** falls back to the next entry of a chain behind a breaker. With one text
  provider, a turn chain can still fall back from one Claude model to another (Haiku to
  Sonnet), which `0227` handles as written. A fallback to a non Anthropic provider must not
  be configured until that provider's terms allow minors. The moderation job must not
  fall back to "skip": its breaker open means fail closed (section 4.2).

## 11. How this fits `0234` and `0235`

- **`0234`** counts the moderation call's cost inside the turn's settle, and its price
  table loses the Gemini rows. Its reservation of a Gemini transcription goes.
- **`0235`** supplies the hearing provider. If `0235` is built first, this plan removes
  only the text half of Gemini; if this plan is first, it removes Gemini's transcription
  too and adds `NoHearing`, and voice is off until `0235`.

## 12. Decisions

### The owner's to check

1. Ask Anthropic for its child safety system prompt (section 3.1).
2. Where the standing "automated assistant" line goes in velista (section 3.3), and
   which velista plan carries it.
3. Moderation after the turn only, not an extra check of the input before it (section
   4.1).
4. Fail closed when moderation cannot run (section 4.2).
5. 112 as the default emergency number, and the wording of the distress sentence.
6. Keeping `docs/receipt-ocr/` (section 9).
7. The facts of section 7 for the policy, and confirming Anthropic's retention and
   training terms on the day.

### Mine, which the owner can change

1. The child safety lines go first in both prompts (section 3.2).
2. One moderation call with a one word classifier on Haiku, not a separate moderation
   service or API.
3. The split provider stays with a single text provider.
4. `ASSISTANT_MODERATION` exists as a switch for self hosters, `on` by default.
5. Old Gemini keys in an environment are ignored rather than refused.
6. No age verification, recorded as a reasoned choice for an audit (section 5).
