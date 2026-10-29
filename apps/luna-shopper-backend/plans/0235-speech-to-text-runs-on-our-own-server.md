> **PR:** [#858](https://github.com/IchirokuXVI/nx-portfolio/pull/858)

# 0235: speech to text runs on our own server

> Every recording a person makes in the app goes to Google today. A spoken assistant turn
> is transcribed by Gemini before the turn runs (`0041`), and a voice comment is
> transcribed by Gemini after it is stored (`0045`), both through
> `GeminiProvider.transcribe`, which sends the audio as `inlineData`
> (`provider/gemini.provider.ts:81`, `:220` to `:240`). Even a deployment that answers with
> Claude hears with Gemini, because Claude takes no audio (`0224` section 3). The owner
> decided on 2026-10-27 to drop Gemini, whose terms rule out services likely to be used by
> people under 18 (`0236`), and to transcribe on the deployment's own machine.
>
> This plan adds a **transcriber**: a small Python service around faster-whisper, with
> the `small` model for assistant turns, where latency matters, and `large-v3-turbo` for
> voice comments, where nobody is waiting and accuracy matters. It runs one clip at a time
> from a queue, on a fixed CPU share, inside the cluster with no route of its own. The
> assistant reaches it over HTTP and stays the one service that hears; the gateway keeps
> calling the assistant over NATS as it does today. It is enabled in production only.
> Staging has no room for it, so staging has no voice, and that must look like "voice is
> off" and never like "voice is broken". A self hoster gets the same switch.
>
> The reference implementation is the owner's test bench at `D:\Projects\whisper-test`
> (`app.py`, `Dockerfile`, `compose.yml`, not in the repository), with faster-whisper
> 1.2.1. Measured there on a 2 CPU container on a Ryzen 9900X: a 19.5 s clip took 1.6 s on
> `small` and 3.9 s on `large-v3-turbo`, int8, both models resident in 1.6 GB of RAM. The
> production VPS is expected to be about twice as slow (the owner's estimate, not
> measured).
>
> Prerequisite reading: `0041` sections 3, 5, 6 and 7 (the spoken turn, the caps, no audio
> in logs, one turn), `0045` sections 4 and 6 (store first, transcribe after, the four
> outcomes), `0224` section 3 (the split provider), `0026` (an absent capability is a
> supported deployment), and in the code `provider/model-provider.ts`,
> `provider/split.provider.ts`, `provider/gemini.provider.ts`,
> `assistant/assistant.module.ts`, `assistant/assistant.service.ts`,
> `gateway/src/app/lists/comment-transcription.service.ts`,
> `k8s/helm/velista/values.yaml`, `k8s/helm/velista/templates/luna-shopper-backend/`,
> `k8s/e2e/luna-shopper-backend/compose.apps.yml` and `luna-slot.sh`.
>
> **Build order.** Buildable on `dev` as it is today. It does not need `0234` or `0236`;
> section 13 says what each changes if it lands first. Every line number below was read on
> `dev` on 2026-10-27.

## Brief for the agent

### Objective

Add the Nx project `luna-shopper-backend-transcriber` (a FastAPI service around
faster-whisper, with its Dockerfile), a `WhisperProvider` in the assistant that hears
through it, the chart entry that runs it when `lunaShopperBackend.transcriber.enabled` is
true (true in `values.production.yaml` only), and the configuration that makes voice read
as off wherever no transcriber exists. Remove every Gemini audio path. Sections 1 to 12
describe the whole job.

### Context

- `ModelProvider` has `transcriptionSupported` as a field, so a deployment that cannot
  hear loses the microphone and keeps the assistant (`provider/model-provider.ts:180` to
  `:197`). `TranscriptionRequest` is `{ audio, mimeType, locale }` (`:165` to `:171`).
- `SplitModelProvider(turns, hearing)` already answers with one provider and hears with
  another; `transcriptionSupported` is `hearing.configured && hearing.transcriptionSupported`
  (`provider/split.provider.ts:22` to `:43`). `assistant.module.ts:35` to `:45` binds it
  when `ASSISTANT_PROVIDER` is `claude`, with Gemini as the hearing, and binds Gemini
  alone otherwise.
- `AssistantService.transcribe` (the voice comment path) and `voice` (the spoken turn)
  both check `transcriptionSupported` before anything else and answer 501
  `not_configured` when it is false (`assistant.service.ts:134` to `:142`, `:212` to
  `:216`). Both run the transcription inside the shared provider `ConcurrencyGate`
  (`:146`, `:225` through `viaProvider` at `:698` to `:724`).
- The gateway sends a voice comment to `ASSISTANT_PATTERNS.transcribe` over NATS, tries
  twice with a 1.5 s pause, and settles `UNAVAILABLE` at once on `not_configured`
  (`comment-transcription.service.ts:27`, `:36`, `:127` to `:175`). Its deadline is
  `VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS`, default 45,000 (`gateway/src/app/config/app-config.ts:261`
  to `:264`, `:413`).
- Velista caps a voice comment at 60 s (`libs/velista/models/src/lib/limits.ts:260`) and
  a spoken turn at 300 s (`libs/velista/platform/src/lib/audio-recorder.ts:38`). The
  assistant caps a recording at 2 MB (`app-config.ts:97`, `:193` to `:196`).
- The chart's backend services share one Deployment template that injects the Node
  environment and probes `/health/ready` and `/health/live`
  (`templates/luna-shopper-backend/deployment.yaml.tpl:8`, `:98`, `:112` to `:125`). An
  entry with `optional: <feature>` is skipped unless that feature is enabled (`:8`,
  `values.yaml:584` to `:607` for the harvester).
- The production node has eight cores with 2,560m requested
  (`values.production.yaml:183`). Its memory size was not found in the repository.
- `@portfolio/docker:build` defaults the build context to the Dockerfile's directory
  (`tools/docker/src/executors/build/schema.json:22` to `:27`). The staging pipeline
  builds every project with a `build:docker` target and the tag `deploy:velista`
  (`.github/workflows/stage-unit.yml:105`).
- The staging gates: `velista-luna-e2e` has no voice spec (its specs are `aisles`,
  `catalog`, `guest`, `member`, `shop`, `sync`). `luna-shopper-backend-e2e` has
  `assistant-voice.spec.ts`, which asserts the 501 a deployment with no Gemini key answers
  (`:1` to `:21`), and runs in `pr.yml:233`.

### Target state

- `npx nx run luna-shopper-backend-transcriber:test` passes (section 2.4).
- `npx nx run luna-shopper-backend-transcriber:build:docker` builds the image.
- `npx nx run-many -t lint test build --projects luna-shopper-backend-assistant,luna-shopper-backend-gateway`
  passes, with the specs of section 11.
- With `TRANSCRIBER_URL` set and the transcriber up, a spoken turn and a voice comment
  are transcribed by it, and nothing reaches Gemini with audio.
- With `TRANSCRIBER_URL` empty, the voice route answers 501 `not_configured` and a voice
  comment settles `UNAVAILABLE` at once, whatever key is set.
- `helm template` with `values.staging.yaml` renders no transcriber object; with
  `values.production.yaml` it renders the Deployment, the Service and the PVC.
- `luna-shopper-backend-e2e` passes, with the voice spec's comments updated.

### Scope

- Work only in: `apps/luna-shopper-backend/transcriber/**` (new),
  `apps/luna-shopper-backend/assistant/src/**`,
  `apps/luna-shopper-backend/gateway/src/app/lists/comment-transcription.service*.ts`,
  `apps/luna-shopper-backend/gateway/src/app/config/app-config.ts`,
  `apps/luna-shopper-backend/gateway/src/app/assistant/assistant.controller.ts` (a comment),
  `apps/luna-shopper-backend/gateway/docs/openapi.json` (only if a doc string changes),
  `libs/luna-shopper/contracts/src/lib/messages/assistant.messages.ts`,
  `apps/luna-shopper-backend-e2e/src/assistant-voice.spec.ts` (comments),
  `k8s/helm/velista/**`, `k8s/e2e/luna-shopper-backend/**`,
  `tools/release/rules.mjs` (only if a new scope is needed), and this plan file.
- Do NOT touch: velista (velista `0174` hides voice), the turn loop, the prompt, the
  tools, core, `package.json`, any `.env`.

### Constraints

- No audio and no transcript in any log, at any level, in either service (`0041`
  section 6). The transcriber logs durations and outcomes only.
- No test reaches a model: the transcriber's tests use a fake model, the assistant's
  specs a stubbed `fetch` (rule A4).
- The transcriber has no route outside the cluster.
- Pin every Python dependency and the model revisions.
- Prettier on each changed TypeScript file, never on a directory.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] `apps/luna-shopper-backend/transcriber` holds `project.json`, `src/app.py`,
      `src/clip_queue.py`, `src/requirements.txt`, `src/requirements-test.txt`,
      `src/Dockerfile`, `src/test_app.py`, and a README of what to set to run it. The
      queue is not `queue.py`: a module of that name beside `app.py` shadows the
      standard library `queue` that `concurrent.futures` imports (section 16).
- [ ] The HTTP contract of section 3 and the queue of section 4, with tests.
- [ ] `WhisperProvider` exists, with a spec; Gemini's `transcriptionSupported` is false and
      its `transcribe` is gone; the module always binds a split whose hearing is
      `WhisperProvider` or `NoHearing` (section 7).
- [ ] `TranscriptionRequest` and the NATS payload carry `purpose`; the comment path sends
      `comment` (section 8).
- [ ] The chart renders the transcriber only when enabled, and the assistant's
      `TRANSCRIBER_URL` follows the same value, so `hears` (plan `0231` section 3) does too
      (section 9).
- [ ] Compose has the transcriber under a `voice` profile and the slot script gives it
      offset 7 (section 10).

### Action boundaries

- Proceed with in-scope edits, tests, lint, build, `build:docker`, `helm template`, and a
  local run of the transcriber container.
- Stop and ask before adding an npm dependency, changing a resource number of section 6,
  or touching a file outside the scope.

### Progress evidence

Report when the transcriber's tests pass, when the image builds (with its size), when a
real clip is transcribed through a slot, and at the PR. Ground each claim in a command's
output.

## 1. What is being built

1. **The transcriber**, a new service: HTTP in, words out, one clip at a time.
2. **`WhisperProvider`** in the assistant: a `ModelProvider` that only hears, over HTTP to
   the transcriber.
3. **No Gemini audio.** Gemini stops hearing in every configuration. A deployment with no
   transcriber cannot hear, and says so the way it already can (501, `UNAVAILABLE`).
4. **A switch**: one chart value decides whether the transcriber exists, and the same
   value tells the assistant where it is and tells the gateway that voice is on.

## 2. The project

### 2.1 Where it lives

`apps/luna-shopper-backend/transcriber`, project name `luna-shopper-backend-transcriber`,
tags `["deploy:velista"]`. Beside the other six backend services and not under
`apps/docker`, because it is part of Luna Shopper's backend: a self hoster who deploys
the backend deploys it with the rest, and the staging and release pipelines pick it up
by the `deploy:velista` tag like every backend image (`stage-unit.yml:105`).

It carries no `type:dynamic-docker` tag, which this section first asked for. In
`tools/deploy/units.mjs` that tag marks a workspace artifact outside every unit (the
builder and the nginx base image, k8s plan 0014 D2): the project would leave
`units.mjs images`, so the weekly image scan would never scan it and `redeploy.yml`
would never check that its image exists at the version it deploys. No workflow reads
the tag for anything else (section 16).

### 2.2 The image

`src/Dockerfile`, from the test bench: `python:3.12-slim`, `ffmpeg` from apt,
`pip install -r requirements.txt` with every version pinned (faster-whisper 1.2.1,
fastapi, uvicorn, python-multipart, as the bench pins them; `psutil` stays for the memory
figure on `/status`). A non root user. `HF_HOME=/models`. No model in the image (section
5). The `build:docker` target mirrors the other backend services' (`imageName`,
`forwardEnv: ["BUILDER_TAG"]`, development and production configurations) with
`"context": "dockerfile"`, the executor's default, because there is no `dist` to copy.

### 2.3 Why Python and not a Node binding

faster-whisper (CTranslate2) is the implementation the owner measured, and its Python
package is the maintained interface. A Node binding of whisper.cpp would keep one
language in the backend, but it is a different engine with different speed and accuracy,
and none of the numbers above would hold. The service is small enough that a second
language costs one Dockerfile and one test file.

### 2.4 Tests

`src/test_app.py` with pytest and FastAPI's test client, against a fake model injected
through the same `get_model` seam the bench has. The `test` target runs them **inside the
image's build**, as a `test` stage of the Dockerfile (`docker build --target test`), so CI
needs Docker and no Python on the runner. Section 11 lists the cases.

## 3. The HTTP contract

`POST /v1/transcribe`, `multipart/form-data`:

| Field | Meaning |
| --- | --- |
| `audio` | The recording, any container ffmpeg reads. |
| `purpose` | `turn` or `comment`. Chooses the model and the lane (section 4). |
| `language` | `es`, `en` or `auto`. The assistant sends the first two letters of the locale. |

Headers: `X-Deadline-Ms`, the caller's remaining patience. A clip still waiting when it
passes is dropped before it runs.

`200`:

```json
{ "text": "...", "language": "es", "audioSeconds": 19.5, "model": "small",
  "waitMs": 0, "transcribeMs": 1600 }
```

Errors, each a JSON `{ "code": ... }`:

- `400 unreadable`: ffmpeg could not decode it, or it is under 0.2 s.
- `413 too_long`: longer than `TRANSCRIBER_MAX_SECONDS_TURN` (default 300) or
  `TRANSCRIBER_MAX_SECONDS_COMMENT` (default 90, the client's 60 plus slack). Checked
  after decoding and before the queue, so a long clip costs ffmpeg and nothing more.
- `503 busy` with `retryAfterSeconds`: the queue is full.
- `504 expired`: the deadline passed while it waited.

`GET /health/live` answers while the process runs. `GET /health/ready` answers 200 only
when both models are loaded, so no request reaches a pod that would download a model on
the caller's time. `GET /status` is the bench's figure (threads, loaded models, memory),
inside the cluster only.

An empty `text` is a real answer: nothing recognisable was said (`model-provider.ts:201`
to `:208`).

## 4. The queue

One worker thread runs one clip at a time, as the bench's `_run_lock` does. In front of it,
two lanes: `turn` and `comment`. The worker always takes the oldest `turn` clip first,
because a person is holding a phone and waiting, and a comment's author already has their
message. A running clip is never interrupted.

- Total depth `TRANSCRIBER_QUEUE_DEPTH`, default 8. A ninth clip is `503 busy`.
- A clip whose `X-Deadline-Ms` passes while it waits is dropped, answered `504`, and
  never transcribed. A caller that gave up does not cost the next caller a slot.
- The worst wait for a turn is one comment already running: 60 s of audio on
  `large-v3-turbo` at the bench's rate is about 12 s, so about 24 s on the VPS. That is
  inside a turn's budget (section 6.2) and is the cost of using one CPU share for both.

The assistant's own `ConcurrencyGate` stays in front of the **model** provider only. A
transcription no longer passes through it (`assistant.service.ts:146`, `:225`): the
transcriber is the queue, and holding a provider slot while waiting on a different
machine would make a voice comment delay a typed turn.

## 5. The models

| Purpose | Model | Settings |
| --- | --- | --- |
| `turn` | `small` | int8, `cpu_threads` 2, `beam_size` 1, `vad_filter` on |
| `comment` | `large-v3-turbo` | int8, `cpu_threads` 2, `beam_size` 1, `vad_filter` on |

Both are configurable (`TRANSCRIBER_TURN_MODEL`, `TRANSCRIBER_COMMENT_MODEL`), so a
self hoster on a small machine can run `small` for both and load one model.
`TRANSCRIBER_PRELOAD` loads the configured models at start, as the bench does, and readiness
waits for them.

`vad_filter` on, where the bench defaults it off: whisper writes plausible sentences over
silence, the same fault `0224` section 11 found in Gemini on two seconds of nothing, and
the voice activity filter removes the silence before the model sees it. The builder
measures both settings on the bench with a silent clip and a real one and records the
times in the PR. Beam 1 is the bench's default and the setting the timings above were
taken with.

### 5.1 The model cache

The models (about 2 GB for both, the bench's `models/` folder) live on a **volume**,
downloaded on the first start and kept.

- **Baked into the image** was rejected: a 2 GB layer pushed on every build of a 200 line
  service, pulled on every node, and a self hoster who wants only `small` still pulls
  both.
- **Downloaded at every start** was rejected: a pod that cannot reach Hugging Face cannot
  start, and every restart is two minutes of no voice.
- **A volume** costs one download per cluster. The chart creates a `ReadWriteOnce` PVC on
  `local-path`, 5 Gi, beside the Postgres volumes. The revisions are pinned
  (`TRANSCRIBER_MODEL_REVISIONS`, a Hugging Face commit per model, filled in by the
  builder), so a new upload of a model on Hugging Face cannot change the transcripts of a
  running deployment. The build pinned the revisions already on the owner's bench:
  `small` is `Systran/faster-whisper-small` at
  `536b0662742c02347bc0e980a01041f333bce120`, and `large-v3-turbo` is
  `mobiuslabsgmbh/faster-whisper-large-v3-turbo` at
  `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`. They are the service's defaults, and
  `TRANSCRIBER_MODEL_REVISIONS` (`name=commit,...`) adds to or replaces them.

For a host with no internet access, the README says how to copy a `models` folder into
the volume. That is documentation, not code.

## 6. Resources and timeouts

### 6.1 Resources

`requests` equal to `limits`, which makes the pod Guaranteed like the stateful tier
(`values.yaml:647` onward for the reasoning):

```yaml
transcriber:
  resources:
    requests: { cpu: '2', memory: 2560Mi }
    limits:   { cpu: '2', memory: 2560Mi }
```

Two CPUs because that is what the bench measured and `cpu_threads` 2 is tuned for it.
2,560 Mi because both models resident took 1.6 GB, decoding a five minute clip to float32
is another 20 MB, and the rest is headroom against the OOM killer. The production node
goes from 2,560m to 4,560m requested of eight cores. Whether its memory holds another
2.5 Gi was **not verified**, and the build did not verify it either: the builder had
no access to any cluster. The owner reads `kubectl describe node` on production before
the first deploy (section 16).

`replicas: 1`, `strategy: Recreate`: two pods would each need the models in memory and
the volume is `ReadWriteOnce`. A deploy is a minute without voice, which the assistant
already says as a failed transcription.

### 6.2 Timeouts

| Caller | Timeout | Why |
| --- | --- | --- |
| Assistant, `turn` | `TRANSCRIBER_TURN_TIMEOUT_MS`, 45,000 | One running comment (about 24 s) plus a 60 s spoken clip on `small` (about 10 s on the VPS). Inside `ASSISTANT_TURN_TIMEOUT_MS` of 60 s and the gateway route's 120 s (`values.yaml:553` to `:554`). |
| Assistant, `comment` | `TRANSCRIBER_COMMENT_TIMEOUT_MS`, 110,000 | A full queue of turns ahead of it, then 90 s of audio on turbo. |
| Gateway, voice comment | `VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS`, raised from 45,000 to 120,000 | It must outlast the assistant's own deadline, or the gateway gives up on an answer that is still coming. |

The assistant sends its remaining time as `X-Deadline-Ms`. A transcriber `503` (the
queue is full) is a `ProviderRateLimitedError` with its `retryAfterSeconds`, as
section 7 says, and a `504` is a `ProviderUnavailableError`. The gateway's existing
second attempt (`comment-transcription.service.ts:27`) covers both for a comment, and
after a rate limit it waits the seconds the limit named (section 16). A spoken turn
answers a rate limit with its `rate_limited` problem and an unavailable transcriber
with the sentence it already has for an unavailable provider.

The NATS request from the gateway carries no timeout of its own: `NatsClient.send`
adds an rxjs `timeout` only when a caller passes `timeoutMs`, the comment path passes
none, and Nest's `ClientProxy.send` waits forever. The gateway's own race against
`VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS` is the only deadline on that leg, and the spec of
section 11 asserts that its default stays above the assistant's 110,000.

## 7. The assistant

- `provider/whisper.provider.ts`: `WhisperProvider implements ModelProvider`.
  `configured` and `transcriptionSupported` are true when `TRANSCRIBER_URL` is set.
  `generate` throws; `transcribe` posts the multipart body with `purpose` and the
  language, maps 400 and 413 to `ValidationException` with a sentence, 503 to
  `ProviderRateLimitedError` with its `retryAfterSeconds`, everything else and a socket
  error to `ProviderUnavailableError`. The body of an error is never logged, because it
  could echo nothing useful and the rule is no audio near a log.
- `TranscriptionRequest` gains `purpose: 'turn' | 'comment'`. `transcribe` returns
  `{ text, audioSeconds }` instead of a string, so that `0234` can count measured seconds;
  `voice` and `transcribe` in the service read `.text`.
- `provider/no-hearing.provider.ts`: `NoHearing`, `configured` false,
  `transcriptionSupported` false. It is what the split holds when there is no transcriber.
- `assistant.module.ts` always binds `SplitModelProvider(turns, hearing)`: `turns` is the
  configured text provider as today, `hearing` is `WhisperProvider` or `NoHearing`.
  `GeminiProvider.transcriptionSupported` becomes `false`, and the Gemini audio code
  is deleted with its specs: `toTranscriptionRequest` (the code's name for what this
  plan called `toGeminiTranscriptionRequest`), `TRANSCRIPTION_INSTRUCTION` and
  `readTranscription`. `ModelProvider` still requires a `transcribe`, so Gemini keeps
  the one line `ClaudeProvider` has: it throws `ProviderUnavailableError` and is never
  reached, because both callers read the flag first. `ASSISTANT_TRANSCRIPTION_MODEL`
  is removed from `app-config.ts`, `resolveAssistantModels`, the chart, compose and the
  slot script (`:191`, `:299` to `:315`).
- `main.ts:79` to `:85` warns "the assistant answers and cannot hear" when
  `TRANSCRIBER_URL` is empty, instead of when `GEMINI_API_KEY` is.

**Audio is still refused before anything is sent.** `readRecording` keeps its MIME
whitelist and byte cap (`assistant.service.ts:630` to `:666`); the transcriber's duration
caps are a second check, after decoding, that the assistant cannot do.

## 8. The gateway

- `comment-transcription.service.ts:139` sends `purpose: 'comment'`.
  `AssistantTranscribeRequest` in `assistant.messages.ts` gains the field, optional, with
  `turn` as the default so a gateway one release behind still works.
- `VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS` default 120,000 (section 6.2), in
  `app-config.ts:264` and `:413` and the chart.
- No new gateway key. Plan `0231` (section 3) asks the assistant over
  `assistant.capabilities` and reports `features.transcription` from its `hears`. This plan
  makes `hears` true exactly when `TRANSCRIBER_URL` is set, so the chart value that decides
  whether the transcriber runs also decides the flag.
- The comment at `assistant.controller.ts:72` that names `GEMINI_API_KEY` as the reason for
  a 501 names the transcriber.
- An upload of a voice comment is still accepted when transcription is off. Its recording
  is the message and stays playable, and it settles `UNAVAILABLE` at once
  (`comment-transcription.service.ts:156` to `:163`). Velista `0174` hides the recorder when
  the flag is off; an older client that still records gets a playable comment, not an
  error.

## 9. The chart

- `values.yaml`, under `lunaShopperBackend`:

  ```yaml
  transcriber:
    enabled: false
    image: ghcr.io/ichirokuxvi/nx-portfolio/luna-shopper-backend-transcriber
    port: 3007
    turnModel: small
    commentModel: large-v3-turbo
    storageSize: 5Gi
    resources: { requests: { cpu: '2', memory: 2560Mi }, limits: { cpu: '2', memory: 2560Mi } }
  ```

  with a comment that says what turning it on costs (two cores, 2.5 Gi, a 2 GB download)
  and what turning it off means (no voice, nothing broken).
- `values.production.yaml`: `transcriber: { enabled: true }`. `values.staging.yaml` and
  `values.homelab.yaml`: nothing, so the default `false` holds.
- `templates/luna-shopper-backend/transcriber.yaml.tpl`, new, wrapped in
  `if .Values.lunaShopperBackend.transcriber.enabled`: a Deployment, a ClusterIP Service
  named `luna-shopper-backend-transcriber` on port 3007 (the other services listen on
  80, and `TRANSCRIBER_URL` names 3007), and the PVC. Its own template and not an entry
  in the services list, because the shared Deployment template injects the Node
  environment and Node's probe paths (`deployment.yaml.tpl:98` to `:125`), none of which
  applies. It takes the shared `imagePullSecrets` and image tag helpers. The PVC carries
  `helm.sh/resource-policy: keep`, so turning the feature off does not delete a 2 GB
  download.
- `configmap.yaml.tpl`: `TRANSCRIBER_URL` is `http://luna-shopper-backend-transcriber:3007`
  when enabled and empty otherwise; the two timeouts of section 6.2. `_env.tpl`:
  `TRANSCRIBER_URL` and the timeouts in the assistant's list (`:267`).
- No Secret, so `provision-release.sh` does not change and `--check` has nothing new to
  find.

**For a self hoster**, voice is one value: `transcriber.enabled: true` in their values
file, and a node with two spare cores and 2.5 Gi. Nothing else.

## 10. Local development and the gates

- `compose.apps.yml`: a `transcriber` service under `profiles: ['voice']`, built from
  `apps/luna-shopper-backend/transcriber/src`, with an **external** named volume
  `luna-transcriber-models`, so every slot shares one 2 GB download. The assistant's
  `TRANSCRIBER_URL` stays empty in compose, so the gate stack and the e2e suite keep the
  501 behaviour they assert.
- `luna-slot.sh`: `[transcriber]=3007` in `DEFAULT_PORT` and `[transcriber]=7` in
  `SLOT_OFFSET` (`luna-slot.sh:864` to `:885`, services sit at `+0` to `+6`). A new flag
  `--voice` starts the profile and writes `TRANSCRIBER_URL` with the slot's port into the
  assistant's `.env`. `TRANSCRIBER_URL` joins `DERIVED_KEYS`, because its port depends on
  the slot. Without `--voice` it is written empty. `parallel-worktree-testing.md` gains a
  paragraph: the transcriber takes two CPUs and 2.5 GB, so start it only to work on voice.
- **The staging gates do not touch voice.** `velista-luna-e2e` has no voice spec, and
  staging runs no transcriber, so nothing there changes. `luna-shopper-backend-e2e`'s
  `assistant-voice.spec.ts` asserts a 501 that, after this plan, comes from the empty
  `TRANSCRIBER_URL` instead of the empty `GEMINI_API_KEY`; its assertions hold and its
  comments (`:8` to `:15`) are rewritten to say so.
- No e2e suite runs the transcriber. A real clip through a slot with `--voice` is the
  builder's manual check (section 12).

## 11. Testing

The transcriber (`test_app.py`, fake model):

- a clip transcribes and the response carries every field of section 3;
- `purpose` picks the model; an unknown purpose is 400;
- a too long clip is 413 before it is queued; an empty one is 400;
- with a slow fake model, a `comment` clip queued before a `turn` clip runs after it;
- a ninth clip is 503 with `retryAfterSeconds`;
- a clip whose deadline passed while it waited is 504 and the fake model was never
  called for it;
- `/health/ready` is 503 until preload ends;
- nothing written to the log contains the fake transcript.

The assistant:

- `whisper.provider.spec.ts` with a stubbed `fetch`: the multipart body, the deadline
  header, each error mapping, `configured` by `TRANSCRIBER_URL`.
- `assistant.service.spec.ts`: with `NoHearing`, the voice route is 501 and `transcribe`
  is 501 while a typed turn still answers; a transcription does not wait on the provider
  gate (a held gate and a transcription that completes).
- `gemini.provider.spec.ts`: `transcriptionSupported` is false.

The gateway: `comment-transcription.service.spec.ts` sends `purpose: 'comment'` and waits
the new timeout.

## 12. Exit criteria

- The acceptance criteria of the brief.
- On a slot with `--voice`, a Spanish spoken turn and a 60 s Spanish voice comment are
  transcribed, and the PR records `waitMs` and `transcribeMs` for each.
- `helm template` with each environment file, and the rendered objects named in the PR.
- The image size, and the free memory of the production node (section 6.1), in the PR.
- The PR body tells the owner that the first production deploy downloads about 2 GB and
  that voice is off until `/health/ready` answers.

## 13. How this fits the plans around it

- **`0234` (allowance).** `transcribe` now returns `audioSeconds`; `0234`'s settle uses it
  instead of its byte estimate, and a transcription costs zero money. Whichever is built
  second makes that change.
- **`0236` (Gemini removed).** After this plan Gemini no longer hears, so `0236` removes
  only the text half of Gemini. If `0236` is built first, it deletes Gemini's transcription
  too and voice is off until this plan lands, which is the safe order as well.
- **`0226` and `0227` (unbuilt).** In `0226`'s vocabulary the transcriber is a provider
  named `whisper` with two model rows (`small`, `large-v3-turbo`) that have the
  `audio-in` capability and zero prices, and the `transcription` job's chain is
  `whisper:small`. `purpose: comment` becomes a third job, `comment-transcription`, with
  chain `whisper:large-v3-turbo`. A fallback from the transcriber to a paid hearing
  provider in `0227` is **not** wanted: audio leaving the server is what this plan ends.
  Neither plan is required.
- **`0231` (legal settings).** Reports its `transcription` flag from the assistant's `hears`
  capability over `assistant.capabilities` (its section 3), which this plan computes from
  `TRANSCRIBER_URL` (section 8).
- **Velista `0174` (another writer).** Hides voice when that flag is false.
- **k8s `0018` (log retention).** The transcriber logs no content, so the assistant's
  seven day rule has nothing to add here.

## 14. What this plan does not do

- **No GPU.** The node has none.
- **No streaming transcription.** A spoken turn is a finished recording (`0041`).
- **No speaker or language detection beyond what whisper does.** The locale is sent.
- **No second replica and no autoscaling.** One clip at a time is the design.
- **No change to what velista records.** Containers and caps stay.

## 15. Decisions

### The owner's to check

1. Production only, staging without voice, and the `voice` profile off by default on a
   slot.
2. Two cores and 2.5 Gi for the transcriber on the production node.
3. Turn clips always run before comment clips.
4. A voice comment uploaded while transcription is off is accepted and stays playable.

### Mine, which the owner can change

1. The project under `apps/luna-shopper-backend`, not `apps/docker`.
2. Python with faster-whisper, not a Node binding (section 2.3).
3. HTTP from the assistant only; the gateway keeps going through the assistant over NATS.
4. The model cache on a kept PVC, downloaded once, with pinned revisions.
5. `vad_filter` on, beam 1, measured before merging.
6. The duration caps of 300 s and 90 s, and the queue depth of 8.
7. Transcriptions no longer pass through the provider concurrency gate.
8. `transcribe` returns `{ text, audioSeconds }`.
9. Tests in a Docker build stage, so CI needs no Python.
10. No gateway key for the flag: it comes from `hears` over `0231`'s `assistant.capabilities`.

## 16. What the build decided

The builder's choices where the plan left room, and the measurements it asked for. Each
choice is the owner's to change.

1. **The project has the tag `deploy:velista` and no `type:dynamic-docker`** (section 2.1).
   `tools/deploy/units.mjs` reads the `type:*-docker` tags as "workspace artifact, in no
   unit" (`WORKSPACE_ARTIFACT_TAGS` at `:88`, skipped at `:120`), so the transcriber
   would have left `units.mjs images`: the image scan would not scan it and
   `redeploy.yml` would not check that its image exists. No workflow reads the tag for
   anything else. `units.mjs check` passes with the velista unit at ten projects. The
   review kept this, and `CLAUDE.md` now says the tag is for the `apps/docker` wrappers
   only.
2. **The queue is `src/clip_queue.py`, not `src/queue.py`.** `app.py` runs with its own
   directory first on the import path, and a local `queue.py` replaces the standard
   library module that `concurrent.futures` imports.
3. **Every Python package is pinned, the transitive ones too.** `requirements.txt` is
   the bench's five pins plus the 27 packages they pull in, installed with `--no-deps`
   and checked with `pip check`, so a package missing from the list fails the build. The
   test stage has its own pinned `requirements-test.txt` (pytest and httpx). The base is
   `python:3.12-slim` pinned by digest, like the Node images. `ffmpeg` comes from apt at
   build time and is the one unpinned part.
4. **Two error codes beyond section 3.** `400 invalid_request` answers an unknown
   purpose, an unknown language and a missing field: FastAPI's own 422 echoes the input,
   and the input is a recording. `500 failed` answers a model error, logged by its
   exception type only. The assistant maps every 400 to a `ValidationException`, so a
   comment the transcriber cannot read is tried once more and then settles `FAILED`.
5. **`503 busy` says `retryAfterSeconds: 10`**, a fixed number
   (`TRANSCRIBER_BUSY_RETRY_SECONDS`), not an estimate from the queue.
6. **The deadline is the assistant's own timeout for the purpose**: `X-Deadline-Ms` is
   45,000 for a turn and 110,000 for a comment. A clip that started before its deadline
   runs to the end and is answered, even late, because a running clip is never
   interrupted.
7. **The language is the first two letters of the locale**, and `auto` when the locale
   has none. The transcriber accepts every code whisper knows, so a third locale needs no
   change here.
8. **`TRANSCRIBER_PRELOAD=false` means readiness does not wait**, and a model loads on its
   first clip. With preload on (the default), a model that fails to load is logged by
   error type and tried again every 30 seconds.
9. **The pinned revisions load with no network.** A container with `--network none` and
   the bench's models on its volume was ready in about 2 seconds. That is the path the
   README describes for a host with no internet access.
10. **Gemini keeps a one line `transcribe` that throws**, like `ClaudeProvider`, because
    `ModelProvider` still requires it (section 7).
11. **A transcription still needs the text provider configured.** `transcribe` checks
    `configured` before `transcriptionSupported`, as before, so `hears` stays
    `answers && transcriptionSupported` (plan `0231`, section 10.2). A deployment with a
    transcriber and no text key transcribes nothing, and its policy says so.
12. **The module exports `buildModelProvider` and `hearingFrom`.** The capability spec
    builds its providers through the module's own factory, and `0236` names
    `hearingFrom` for the same choice.
13. **The chart's Service listens on 3007**, the port `TRANSCRIBER_URL` names, where the
    other backend Services listen on 80. `TRANSCRIBER_THREADS` is the pod's CPU limit.
    The pod has `fsGroup: 1000`, so the first download can write the volume. There is no
    PodDisruptionBudget: with one replica, `minAvailable: 1` would block every node drain.
14. **Compose builds the transcriber from the checkout** (tag
    `luna-shopper-backend-transcriber:local`) with 2 CPUs and 2,560m, a healthcheck on
    `/health/ready` and a `start_period` of 600 seconds for the first download. Without
    the `voice` profile, compose neither builds it nor asks for its external volume: the
    gate stack's `up` and `pull` were checked with the volume absent.
15. **`--voice` in `luna-slot.sh`.** An `--up` with it writes `TRANSCRIBER_URL`, records
    `LUNA_VOICE=1` in `.env.slot`, creates `luna-transcriber-models` when it is absent and
    waits for the container's health. An `--up` without it writes the URL empty and stops
    the container. A `--restart` keeps what the slot had, and `--restart --voice` turns it
    on and restarts the assistant too. `--down` removes the container and keeps the
    volume. The transcriber's port is reserved in `slot_ports`, so a slot running only the
    transcriber is not free, and `--list` has no column for it. `--ephemeral` works with
    all of it, because the compose call reads the slot's own descriptor.
16. **The gateway spec of section 11 is in `lists/voice-comments.spec.ts`**, which is the
    spec of `comment-transcription.service.ts`. It asserts `purpose: 'comment'` and that
    the default `VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS` is 120,000, above the assistant's
    110,000. `luna-slot.sh` writes 120,000 into a new gateway `.env`; an existing one
    keeps its 45,000 until `--reset-env`.
17. **The image is 1.47 GB unpacked and 366 MB compressed**: ffmpeg and its libraries are
    457 MB, the Python packages 504 MB.
18. **`vad_filter` stays on.** Measured with the transcriber image on this machine, at
    the bench's settings (2 CPUs, int8, beam 1), and not in the bench's own container,
    whose folder the build did not touch. Three runs each:

    | Clip | Model | VAD on | VAD off |
    | --- | --- | --- | --- |
    | 10 s of silence | `small` | 10 to 38 ms, empty | 1,027 to 1,140 ms, "y y y y y y y y y y y y y y" |
    | 10 s of silence | `large-v3-turbo` | 11 ms, empty | 2,930 to 3,146 ms, "Gracias por ver el video." |
    | 6.4 s spoken turn | `small` | 1,018 to 1,149 ms | 1,011 to 1,124 ms |
    | 59.5 s spoken comment | `large-v3-turbo` | 9,990 to 10,189 ms | 9,943 to 10,204 ms |

    On speech the filter costs nothing measurable and the words are the same. On silence
    it is the difference between an empty transcript and a sentence nobody said.
19. **Through an ephemeral slot 7 with `--voice`** (gateway, auth, core and assistant):
    - the spoken turn (6.4 s, `small`): `waitMs` 0, `transcribeMs` 1,210, the voice route
      answered 201 in 1,416 ms;
    - the voice comment (59.5 s, `large-v3-turbo`): `waitMs` 0, `transcribeMs` 10,094; the
      upload answered 201 in 147 ms and the comment settled `READY` 12.3 s later;
    - a spoken turn sent one second after a comment started: `waitMs` 9,212,
      `transcribeMs` 1,060, the voice route answered in 10,433 ms, and the comment
      settled `READY` as well;
    - the transcriber held 1.27 GB with both models loaded and idle, and 1.51 GiB of its
      2.5 GiB after the clips. Its log has no word of either transcript.

    The slot had no text key, and a spoken turn answers 501 before it hears without one,
    so the assistant there ran with a local stand in for Gemini's endpoint that answered
    every turn with one fixed sentence. The transcription half was the real one.
20. **The clips were synthesized**, with `espeak-ng`'s Spanish voice in a throwaway
    container, encoded as Opus in WebM at 32 kbit/s; the silent clip is ffmpeg's
    `anullsrc`. Nobody recorded them. `large-v3-turbo` wrote the 60 second comment almost
    word for word; `small` got the robotic 6 second sentence badly wrong ("Ya no nos
    litros, no leche..."), where `large-v3-turbo` got it right. Whether `small` is good
    enough for real speech is a question for a human recording, before the first deploy.
21. **The models on the slot came from the bench**, copied into `luna-transcriber-models`,
    so the time of a first download was not measured.
22. **Not verified, for the owner before the first production deploy:**
    - the free memory of the production node (section 6.1): the build had no cluster;
    - the first production deploy waits for `/health/ready` inside
      `deploy-release.sh`'s `--wait --timeout 10m`, so a 2 GB download slower than about
      nine minutes fails that deploy while the pod goes on downloading. Seeding the claim
      first (README) or running the deploy again avoids it.

The review added the rest. Items 23 and 24 change `.github/workflows`, which is
**outside this plan's scope** (section "Scope" of the brief). They are in this build
because without them the plan cannot deploy: every velista staging deploy and every
velista release that names the transcriber would fail. The owner can reject the
widening, and then the plan waits for a separate change to both files.

23. **The pipelines check the Node bundles by target, not by name.** `stage-unit.yml` and
    `release-unit.yml` built the list for `assert-runtime-manifest.mjs` with
    `grep -E '^luna-shopper-backend-'` over the images, and the transcriber has no
    `dist`, so the step failed with `ENOENT`. Both now ask Nx for the unit's projects
    with a `manifest-check` target (`list --with-target manifest-check --projects
    "tag:deploy:$UNIT"`, the affected scope included on staging), which names the seven
    Node services and nothing else.
24. **The transcriber's tests run on the runner in both pipelines.** The lint and test
    job runs `nx run-many -t lint test` inside `BUILD_IMAGE`, which has no `docker`, and
    the transcriber's `test` is a `docker build`. The in container run now passes
    `--exclude luna-shopper-backend-transcriber`, and a step on the runner runs
    `nx run luna-shopper-backend-transcriber:test` when the testable list names it, as
    `pr.yml` already does. A failure of either half fails the job, so the deploy waits
    on both as before.
25. **A comment's second attempt waits as long as a rate limit says.** A full
    transcriber queue answers `503` with `retryAfterSeconds: 10`, the assistant turns it
    into `rate_limited` with that number, and the gateway waited a fixed 1.5 s, so the
    second attempt found the queue full too and the comment settled `FAILED`. The
    gateway now waits the larger of 1.5 s and the named seconds, at most 30 s
    (`MAX_RETRY_DELAY_MS`). Each attempt keeps its own
    `VOICE_COMMENT_TRANSCRIBE_TIMEOUT_MS`. Section 6.2 said a `503` was a
    `ProviderUnavailableError`; it is a `ProviderRateLimitedError`, as section 7 and the
    code have it, and 6.2 now says so.
26. **The transcriber's deadline covers the body.** The abort timer was cleared when the
    headers arrived, so a body that never ended had no deadline. It is now cleared after
    the body is read, and a body cut by the deadline is a `ProviderUnavailableError`
    that names the timeout.
27. **`--voice` on a running slot leaves the slot consistent.** The transcriber starts or
    stops only after the services started. A slot that already runs refuses them, so
    `--up` then changes no container and prints the one command that applies the new
    `TRANSCRIBER_URL`: `--restart --services assistant`, with `--voice` to turn voice
    on. A `--restart` that restarts the assistant without voice also stops a transcriber
    left from before.
28. **`TRANSCRIBER_THREADS` reads a Kubernetes CPU quantity.** The chart passes the CPU
    limit as written, and `int()` refused `1500m`. `cpu_threads` rounds up (`1500m` and
    `1.5` are 2, `2` is 2) and refuses anything else with a message that names the
    value, so a self hoster's `cpu: '1500m'` boots.
