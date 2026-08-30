# 0041 The recording goes back to the server

> **Voice input for the assistant, and a reversal.** The panel already records, and
> since commit `ef47f1a` it records with the browser's own `SpeechRecognition` and sends
> text. This plan puts the audio back on the wire: the client uploads a recording, the
> assistant transcribes it, and the turn continues exactly as a typed one does. That was
> the shape velista `0032` section 4 drew and commit `c1afe6f` built, before it was
> undone for a service that had no audio endpoint. This plan builds the endpoint.
>
> Prerequisite reading: plan `0039` sections 2, 9, 10 and 14, velista `0032` sections 4
> and 10, and backlog `0005` section 6. Two of those say this question is settled in the
> other direction. Section 11 says what has to be rewritten.

## 1. What is being built

- **`POST /v1/assistant/voice`** on the gateway: a recording, plus the transcript so far,
  answered with the same `AssistantTurnResponse` a typed turn produces, plus what was
  heard.
- **Transcription in the assistant service**, through the provider it already holds a
  credential for, as a separate call in front of the existing turn loop.
- **The client reverted to `MediaRecorder`**, recovering what `c1afe6f` built and adapting
  it to the contract that has shipped since.

Everything about a turn other than where the words come from is unchanged. The tools, the
loop, the references, the rate limit answer, the context fetch and rule A1 are all
untouched, and that is the design: **a spoken turn becomes a typed turn as early as
possible and is indistinguishable after that.**

## 2. Why the browser stopped being the right place

Commit `ef47f1a` had a reason and it was a good one: the service that shipped had no audio
endpoint, so the browser was the only place left. That is not a judgement about which is
better, it is what was available. Now that the endpoint is on the table, the comparison is
worth making properly, because reverting a working feature needs more than a preference.

**Firefox has no `SpeechRecognition` and therefore has no microphone button.** That is
recorded in `speech-capture.ts` as an honest consequence, and for a feature whose stated
audience is people who cannot comfortably type, "your browser does not get the accessible
input" is the worst possible shape for a limitation to take. `MediaRecorder` and
`getUserMedia` are everywhere `SpeechRecognition` is and in Firefox besides.

**The privacy gain was smaller than it looked.** Chrome and Safari implement
`SpeechRecognition` by sending audio to the browser vendor, which `ef47f1a`'s own message
says out loud. So the choice was never between sending a recording and not sending one; it
was between sending it to Google as this app's request, under the terms plan `0039`
section 9 examined, and sending it to Google or Apple as the browser's request, under
terms this project never read and cannot see. The second is not obviously the safer one,
and it is certainly the one nobody here can account for.

**The engine ends itself on silence, and the app has to fight it.** `WebSpeechCapture`
restarts recognition on every `end` event because the browser stops between phrases, and
tracks whether the engine is actually running because `stop()` on a stopped engine fires
nothing at all. Commit `30ccc9c` fixed a bug in exactly that machinery: a paused dictation
could not be stopped, the promise never settled, and the message was lost with nothing on
screen saying so. That is not a criticism of the fix. It is evidence about the interface:
a five minute recording with a pause button is a `MediaRecorder` feature being
approximated on top of an engine designed for short utterances, and the seams are where
the words go missing. A file has no seams.

**A multimodal model hears a shopping list better than a dictation engine.** Brand names,
Spanish and English in one sentence, and a quantity said as a word are the ordinary
content here, and they are what a general dictation engine is worst at. The model that is
already reading the sentence is a better transcriber of it than a separate engine that
knows nothing about the context, and it is a strictly better one when the two are the same
call away.

**The locale is ours rather than the browser's.** The gateway already resolves
`Accept-Language` and plan `0039` section 7 makes the reply follow it. Server side
transcription makes the recognition follow the same value, from the same place.

What is genuinely lost: a recording now leaves the device as this app's payload, so
section 6 rewrites the privacy note rather than keeping it; a spoken turn costs more than a
typed one, which section 7 quantifies; and the caller's own bubble can no longer show the
words instantly, which section 8.4 addresses.

## 3. Where a recording becomes text

**Gemini's own audio input, in a transcription only call, in front of the existing loop.**

The service already holds a Gemini credential, already speaks that API over `fetch` with
no SDK, and already has the seam to put this behind. Adding a second speech provider would
mean a second credential, a second secret in `provision-release.sh`, a second entry in
every values file and slot script, and a second third party whose outage is a new failure
mode, all to do a job the provider in hand does natively.

### 3.1 Two calls, not one

The audio could be dropped straight into the turn as the user's content, and the tool
loop could run on it directly. That is one call instead of two and it is the wrong shape.

The client needs to know **what was heard**. A person who cannot easily type and has just
spoken a sentence needs to see the sentence the machine believed, because mishearing is
the characteristic failure of a voice interface and an answer to a question you cannot see
is an answer you cannot check. If the audio goes into the tool loop directly, nothing ever
emits a transcript: asking the model to also write out what it heard, in prose, beside its
answer, means parsing prose for a fact, which is precisely what rule A3 refuses to do for
references and should refuse to do here.

So a spoken turn is:

1. **Transcribe.** One `generateContent` with the audio inline, no tools, no history, and
   a system instruction that says to return the words and nothing else.
2. **Answer.** The existing `AssistantService.turn`, with the transcription as `message`,
   byte for byte the path a typed turn takes.

The transcription is returned to the client as `heard`, and the client puts it in the
caller's own bubble and into the transcript it holds. **From step 2 onward there is no
such thing as a spoken turn**, which is why nothing in plan `0039` has to be re-reasoned
and why every existing test on that path keeps testing the thing it tested.

The cost is one extra provider request per spoken turn, and section 7 prices it.

### 3.2 The seam

`ModelProvider` gains one method:

```ts
interface ModelProvider {
  readonly configured: boolean;
  /** False when this provider cannot take audio at all. */
  readonly transcriptionSupported: boolean;
  generate(request: ModelRequest): Promise<ModelReply>;
  transcribe(request: TranscriptionRequest): Promise<string>;
}

interface TranscriptionRequest {
  audio: Uint8Array;
  mimeType: string;
  /** BCP 47, the same locale the reply will be written in. */
  locale: string;
}
```

Separate from `generate` rather than an audio part on `ModelTurn`, because it is a
different job with no tools, no history and no reply to parse, and because a provider that
cannot do it says so in a field rather than by throwing. `ProviderRateLimitedError` and
`ProviderUnavailableError` are thrown from it exactly as from `generate`, so rule A5's
answer needs no second implementation.

**Rule A4 is unchanged and non negotiable.** `FakeModelProvider` implements `transcribe`,
every test runs against it, and no test in this repository reaches a model provider or
sends a byte of audio anywhere.

### 3.3 The format question, which has to be settled before anything is built

> **Settled, and in the good direction: `audio/webm` is accepted.** The provider's current
> documentation lists wav, mp3, aiff, aac, ogg, flac, mpeg, m4a, l16, opus, alaw, mulaw
> **and webm**; the Firebase/Vertex list adds mp4. So the commonest browser's container is
> fine, Safari's is fine, and **the container rewrite this section names as a fallback was
> not built and is not needed.** The fear below was justified when it was written and the
> fact had gone stale, which is exactly what it predicted about itself.
>
> `ASSISTANT_AUDIO_MIME_TYPES` defaults to
> `audio/webm,audio/ogg,audio/mp4,audio/wav,audio/mpeg,audio/aac,audio/flac`, and the
> client negotiates `audio/webm;codecs=opus` first through `MediaRecorder.isTypeSupported`,
> falling through to ogg and then to whatever the browser picks for itself.
>
> The one thing the spike could not do is the "one real request" this section also asks
> for: rule A4 forbids any test here from reaching the provider, and there is no key in
> this environment. Two independent published sources agree, and the service refuses an
> unknown container with a sentence rather than a stack trace, so the cost of the
> documentation being wrong is a legible refusal rather than a broken feature.
>
> **Also confirmed, for section 7:** audio is billed at **32 tokens per second**, so a
> minute is 1,920 tokens and the five minute ceiling is about 9,600. That is a different
> order of thing from a typed message, and it is one more reason the client's five minute
> limit pauses rather than sends.

This is the one thing in this plan that can invalidate a week of work, so it goes first in
the build order rather than being discovered.

**Gemini's documented list of accepted audio mime types does not include
`audio/webm`.** It names wav, mp3, aiff, aac, ogg and flac. What the browsers produce
through `MediaRecorder` is:

| Browser | What `MediaRecorder` gives you |
| --- | --- |
| Chrome and Chromium | `audio/webm;codecs=opus`, and it will not negotiate ogg |
| Firefox | `audio/ogg;codecs=opus` |
| Safari | `audio/mp4`, AAC inside |

So the commonest browser produces the one container the provider does not document, and
Safari produces AAC inside a container rather than the bare codec. **Verify this against
the provider's current documentation and against one real request before writing anything
else**, because it is exactly the sort of fact that is stale by the time it is quoted, and
because the answer decides the shape of what follows.

If webm is refused, the fallback is cheap and should be named now rather than panicked
over later: **WebM and Ogg are both containers around the same Opus stream**, so this is a
container rewrite with no re-encoding, not a transcode. It is a bounded piece of work that
runs in the service, needs no ffmpeg and no native dependency, and it is the thing to build
if and only if the spike says so.

The client negotiates the best it can regardless, asking `MediaRecorder.isTypeSupported`
for an ordered preference and sending whatever it got as the part's own content type. The
service whitelists what it accepts and refuses anything else with a sentence rather than a
stack trace, because "your browser recorded in a format we cannot read" is a real thing
that will happen on some device nobody tested.

## 4. The transport, and the one megabyte wall

The audio has to travel twice: browser to gateway, and gateway to the assistant service.
The two legs get different answers.

### 4.1 Browser to gateway: multipart

`multipart/form-data`, with the transcript as a JSON string in a form field and the
recording as a file part. That is what `c1afe6f` built and it is still right: base64 in a
JSON body would inflate the upload by a third on the one leg that actually costs the user
something, which is a phone on mobile data.

Two things this needs that the gateway does not have today. There is no file handling
anywhere in this backend, so `@nestjs/platform-express`'s `FileInterceptor` and its
`multer` dependency arrive with this plan. And the interceptor takes its own `limits`,
because the global `ValidationPipe` does not see a file and Express's own body limits do
not apply to a multipart stream. A byte cap that is not set on the interceptor is a byte
cap that is not enforced.

The transcript field is validated by the same DTO the typed route uses, so the two routes
cannot drift on what a transcript is.

### 4.2 Gateway to assistant: base64, and NATS has to be told

The assistant is reached over NATS, and **NATS refuses a message over `max_payload`,
which defaults to one megabyte.** Both deployments run the broker with no configuration
that changes it: compose runs `nats:2.10-alpine` with `-js -sd /data -m 8222`, and the
Helm template passes the same arguments. So today a recording of any real length cannot
reach the service at all, and the failure is a broker level rejection rather than anything
the service could report nicely.

Base64 over the broker rather than a second transport, because the alternative is the
assistant growing an HTTP surface of its own or the gateway calling it over HTTP while
everything else goes over NATS, and one transport per service pair is worth more than a
third of a megabyte inside the cluster.

So `max_payload` is raised, deliberately and in both places at once:

- `k8s/e2e/luna-shopper-backend/compose.yml`, on the broker's `command`.
- `k8s/helm/templates/luna-shopper-backend/nats.yaml.tpl`, on its `args`, from a value in
  `values.yaml` beside the image and the storage size, so the number is stated once.

**Both, in the same commit.** A raise applied in one and not the other is a feature that
works on the development machine and fails in the cluster with a broker error, which is
the slowest possible way to find out.

The arithmetic, so the numbers are one decision rather than three guesses:

| | |
| --- | --- |
| Upload cap | 2 MB |
| After base64 | ~2.7 MB |
| Plus the transcript and the envelope | under 3 MB |
| `max_payload` | 8 MB |

The headroom is deliberate. `max_payload` is a broker wide ceiling that nothing else comes
close to, and setting it just above the cap would mean the next change to either number
has to move both.

**The alternative considered and rejected:** the gateway writes the audio to Redis with a
short TTL and passes a key, which keeps NATS untouched. Redis is already a dependency
(plan `0028`), so it would work, but it runs with `maxmemory: 96mb` and a `volatile-lru`
policy, so a keyed blob is a thing that can be evicted between the write and the read
under memory pressure, and it puts a two step handoff and a cleanup path in place of one
line of broker configuration.

## 5. The caps, and where each one is stated

Four limits, and each one belongs to exactly one layer:

| Limit | Where | Why there |
| --- | --- | --- |
| **five minutes** | the client's clock | velista `0032` section 4.4. It pauses rather than sends, and it is about the person, not the file |
| **a bitrate low enough that five minutes fits** | the client's recorder | see below |
| **2 MB** | the multipart interceptor, and again in the service | the server cannot trust a duration, only a byte count |
| **8 MB** | the broker | section 4.2 |

The bitrate is the one that would otherwise be missed. `MediaRecorderCapture` as `c1afe6f`
built it passes no `mimeType` and no bitrate, on the sound reasoning that the browser's own
choice is one it can certainly produce. Its own choice is also, in Chrome, generous enough
that five minutes lands several megabytes past the cap. Speech is intelligible at a small
fraction of that, and Opus is very good at exactly this job, so the recorder asks for a
low speech grade bitrate explicitly and the five minute ceiling then fits inside the byte
cap with room to spare. **This is a change to what is being recovered, not a recovery**,
and it is the single most likely thing to be dropped on the way.

When the cap is hit anyway, the service says so in words with the number in it, the way
rule A5 makes it say how long to wait. "That recording was too long to send" is an answer;
a 413 with an empty body is not.

## 6. Privacy, and what plan 0039 section 10 now has to say

Plan `0039` section 10's privacy line was written for a service that received a sentence,
and `ef47f1a` kept it accurate by keeping audio out. It is not accurate after this plan
and rewriting it is part of the work rather than a follow up.

What is true afterwards:

- **A recording of somebody's voice reaches this service and reaches Google.** It is
  personal data of a different character from a typed sentence, because a voice identifies
  a person and a sentence does not.
- **It is held in memory for the length of the turn and never written down.** No disk, no
  database, no object store, no cache. Rule A2 already says the service stores nothing
  between turns, and the recording is the strongest case for that rule rather than an
  exception to it.
- **It is never logged.** Plan `0039` section 10's structured turn record carries the **transcription**
  and never the audio, not even a hash of it, and not at any log level. The provider's
  error bodies are already logged rather than surfaced because they can echo the prompt;
  the same care applies here and matters more.
- **The free tier's data terms cover it.** Plan `0039` section 9 records that Google's
  terms carve out EEA, Switzerland and UK users, for whom the paid data terms apply to
  unpaid quota, and that this carve out is what makes real shopping data defensible on a
  free tier. Audio raises the stakes of that reading, so re-read it as part of this plan
  rather than inheriting the conclusion.
- **The retention statement in plan `0039` section 10 has to name the transcription.** The words a
  person spoke, written down, live in the logs on exactly the terms the words they typed
  already do, and no longer.

## 7. What a spoken turn costs

Two things change against a typed turn, and both land on the free tier that plan `0039`
section 9 says will return 429 in ordinary use.

**Two requests instead of one**, so a spoken turn spends twice as much of a per minute
request budget that is shared across every user of the deployment. That is the price of
section 3.1's decision and it buys a transcription the caller can check.

**Audio is billed by duration.** Gemini counts audio in tokens per second rather than by
size, so a long recording is a large prompt by this service's standards even though the
transcription that comes out of it is a sentence. Confirm the current rate when the format
spike in section 3.3 is run; the shape of the answer is that a five minute recording is a
different order of thing from a typed message, and it is one more reason the client's five
minute ceiling pauses rather than sends.

Nothing new is needed to handle the consequence. `ProviderRateLimitedError` from
`transcribe` produces exactly the answer rule A5 already specifies, the panel counts the
number down, and the local limiter counts a spoken turn as one turn because a turn is a
turn from the caller's point of view.

## 8. The client

The revert is a recovery, not a rewrite. `c1afe6f` is the commit to read, and `ef47f1a` is
the diff to reverse, but neither can be applied as it stands: the wire changed underneath
both. The **shape** comes back from `c1afe6f`; the **contract** is today's.

### 8.1 What comes back, adapted

| File | Was, at `c1afe6f` | Now | Adaptation needed |
| --- | --- | --- | --- |
| `platform/speech-capture.ts` | `audio-capture.ts`, `AUDIO_CAPTURE`, `MediaRecorderCapture` | back to that | ask for a negotiated mime type and a speech grade bitrate (section 5) |
| `platform/dictation.ts` | `audio-recorder.ts`, resolving a `Blob` | back to that | keep the clock and both thresholds exactly where `Dictation` has them |
| `data-access/assistant/assistant-api.ts` | `askAloud(transcript, recording)` | back to that | the new message is its own field now, and a spoken turn has no typed message |
| `models/assistant.ts` | `AssistantReply.heard` | back to that | beside `reply`, `references` and `listResolution`, not the old `text` |
| `feature-assistant/assistant-store.ts` | pending bubble replaced by `heard` | back to that | see 8.4 |
| `ui/assistant/assistant-composer.*` | the recorder controls | unchanged | nothing: see 8.2 |
| `platform/speech-capture.spec.ts` | did not exist | replaced by a `MediaRecorder` fake | the three cases `30ccc9c` added have no analogue and go |

### 8.2 Every control in velista 0032 section 4 stays exactly as it is

One slot with three jobs, press rather than hold, pause and stop at opposite ends, the
warning at 3:00 that grows the container, the pause at 5:00 that holds the message rather
than sending it. `ef47f1a` observed that the clock and both thresholds were always this
app's rather than the capture's, and that remains true in this direction too. **The
composer's fourteen tests should pass unchanged**, and if one of them does not, that is
the signal that something drifted that was not supposed to.

The one control that gets easier: pause and resume are `MediaRecorder.pause()` and
`.resume()` on one continuous recording, rather than stopping an engine and restarting it
with the words so far kept. The seam that `30ccc9c` had to defend disappears because there
is no seam.

### 8.3 Firefox gets its microphone back

Which is the point of section 2's first argument. `supported()` becomes a check for
`MediaRecorder` and `getUserMedia`, and there is no browser in the support matrix that has
the panel and not the microphone.

### 8.4 The caller's own bubble, and the round trip that is now in the way

Under `SpeechRecognition` the client knew the words as they were spoken, so the caller's
bubble filled in live. That is a real gain and this plan gives it up: the words now come
back with the reply.

So the pending bubble says that something was said and is being listened to, and is
replaced by `heard` when the response lands. It is one state that already exists in the
store for a pending turn, given a different label for a spoken one. What it must not do is
**invent** the words: the client has nothing to invent them from, and a bubble showing a
guess at what somebody said is worse than a bubble showing that it is waiting.

`heard` is optional on the reply, as it was, so a service that does not send one is not
broken and the panel falls back to a neutral placeholder.

### 8.5 What does not change, and is worth checking twice

The field stays an ordinary text input with an ordinary submit and no custom key handling,
so the platform keyboard's own dictation button keeps working into it beside the app's
microphone. That is a velista `0032` exit criterion and it survives both reversals.

## 9. Failure modes, and what each one says

Everything here is a message in the transcript, never a banner, per velista `0032`
section 3.

| What happened | What the caller gets |
| --- | --- |
| microphone permission refused | a state in the composer, and never an unhandled rejection |
| no microphone on the device | a different sentence from a refusal, because they read differently |
| the recording is over the byte cap | said in words, with the limit in it |
| the browser recorded a format the service cannot read | said in words, and logged with the mime type so it can be fixed |
| the provider is rate limited during transcription | rule A5's answer: a number of seconds in the problem body, counted down |
| the provider transcribed nothing | "I did not catch that", and no turn is run against an empty message |
| no `GEMINI_API_KEY` in this deployment | 501, exactly as the typed route already answers (plan `0026`) |
| the provider cannot take audio at all | 501 on the voice route only, with the typed route still working |

The last row is why `transcriptionSupported` is a field rather than an exception. A
deployment pointed at a provider that does not do audio should lose the microphone and
keep the assistant.

## 10. Configuration, secrets and CI

**No new secret**, which is the whole reason section 3 chose the provider already in hand.
`GEMINI_API_KEY` is the only credential and it is already prompted for, already in
`OPTIONAL_EMPTY_KEYS`, and already permitted to be empty.

What does change, and every one of these is a file that states configuration by hand and
therefore drifts if it is missed:

- **`k8s/e2e/luna-shopper-backend/compose.yml`** and
  **`k8s/helm/templates/luna-shopper-backend/nats.yaml.tpl`** plus a value in
  `values.yaml`: `max_payload`, section 4.2, together.
- **`k8s/helm/templates/luna-shopper-backend/_env.tpl`** and the ConfigMap keys:
  `ASSISTANT_AUDIO_MAX_BYTES`, `ASSISTANT_AUDIO_MIME_TYPES` and
  `ASSISTANT_TRANSCRIPTION_MODEL`, the last so a different model can be used for
  transcription than for the turn without a code change.
- **`k8s/e2e/luna-shopper-backend/compose.apps.yml`**: the tier 2 stack states its
  environment separately and inherits none of the above. A variable added to the chart and
  not here produces one dead service while the gateway stays up and returns 500s.
- **`k8s/e2e/luna-shopper-backend/luna-slot.sh` and `.ps1`**: the generated per slot `.env`
  needs the same keys. A generated `.env` missing a newly required variable is the same
  failure as the line above and is the one this repository has already been bitten by.
- **`apps/luna-shopper-backend/gateway/docs/openapi.json` regenerated in the same commit**
  as the route. A multipart route with a binary part is a shape this document has never
  carried, so read the generated diff rather than trusting it.
- **`package.json`**: `multer` and its types, for the gateway only.
- **No new host, no certificate, no CORS origin, no environment values file change.** The
  voice route is a second path on `/v1/assistant`, which is what plan `0039` section 3's
  decision to proxy through the gateway keeps buying.

## 11. What this reopens

Three places currently say this question is settled in the other direction. Leaving them
saying that is worse than the change itself, because the next person to read them will
believe the code and the plans disagree by accident.

- **`0039` section 14**, whose first open decision is struck through and marked settled by
  what shipped. It becomes settled by this plan instead, in the other direction, with the
  reasoning in section 2 rather than "the service has no endpoint".
- **`0039` section 10's privacy line**, which section 6 rewrites.
- **velista `0032` section 10's blockquote and section 4.5's "As built" note**, both of
  which describe `SpeechRecognition` as the answer. The blockquote's account of what the
  browser cost and gained stays as a record of that period; what changes is the verdict at
  the top of it.

Neither plan is rewritten wholesale. `0032` section 4's controls are exactly what gets
built, which is the point worth noticing: the interface survived both reversals unchanged,
because it was drawn about the person rather than about the capture.

## 12. Testing

Rule A4 first, because it is the constraint that shapes the rest: **no test in this
repository may reach a model provider**, and no test sends audio anywhere. Every case
below runs against `FakeModelProvider` and a `MediaRecorder` fake, with no network.

**Assistant service:**

- A spoken turn transcribes, then runs the ordinary turn with the transcription as the
  message, and the second call is byte for byte what a typed turn sends.
- The response carries `heard`, and it is the transcription rather than anything the model
  wrote in its reply.
- An empty transcription answers without running a turn, and calls no tool.
- A rate limit during transcription produces the same problem body, with a number, that a
  rate limit during the turn produces.
- A provider whose `transcriptionSupported` is false answers 501 on voice and answers
  normally on text.
- Audio over the byte cap is refused before the provider is called.
- A mime type outside the whitelist is refused with the type named in the log and not in
  the reply.
- No log record at any level contains the audio.

**Gateway:**

- The multipart route accepts a file and a transcript field, and rejects a request with
  either missing.
- A file over the interceptor's limit is refused by the interceptor rather than reaching
  the service.
- The transcript field is validated by the same rules the typed route applies.
- `openapi.json` matches, and the binary part is described.

**Velista:**

- The composer's existing fourteen tests pass unchanged.
- A recording starts and stops on single presses, pauses and resumes, and survives the
  pointer leaving the button.
- At 3:00 the container grows and names the limit; at 5:00 the recording pauses, is not
  sent, pause is disabled, and the message says so.
- A refused microphone permission and an absent device render different states and neither
  is an unhandled rejection.
- `askAloud` sends `multipart/form-data` with no hand written `Content-Type`, so the
  browser writes its own boundary.
- The caller's bubble shows the pending state, then `heard`, and never a guess.
- A reply with no `heard` renders the placeholder rather than an empty bubble.

**End to end**, in `apps/luna-shopper-backend-e2e` and the Postman collection: a real
multipart request with a small fixture recording reaches the service and is refused for
the right reason with no key configured, which is as far as a suite can go without
breaking rule A4.

## 13. Open decisions

- ~~**The format question in section 3.3.**~~ **Run, and settled:** `audio/webm` is on the
  provider's accepted list, so no container rewrite was built. Section 3.3 carries the
  answer and what it could not check.
- **Whether the transcription model is the turn model.** The config key exists so they can
  differ; whether they should is a quality question that has no answer before there is
  usage.
- **Whether a spoken turn should be allowed to skip the confirmation in `rename_me`.** It
  should not, and this is written here only so that nobody decides otherwise on the
  grounds that speaking is inconvenient. A change that alters what other people see gets
  its sentence, whatever the input method.
- **Whether the five minute ceiling is still the right one** now that the cost is measured
  in provider tokens rather than in a codec. It was chosen for the person, so it stays
  until somebody who needs it says otherwise; but it is now a cost as well as a courtesy.
- **Whether a recording survives leaving the panel mid capture.** Drawn as though it does
  not, unchanged from `0032`.
- Whether the transcription should be shown before the answer arrives, as a two stage
  response or a stream. Nicer, and it needs streaming, which `0039` section 14 is already
  leaning against for the test.

## 14. Exit criteria

- A message can be spoken start to finish without holding anything down, paused and
  resumed, and the words reach the assistant.
- Every control velista `0032` section 4 draws behaves exactly as it does today, and the
  composer's tests did not have to change to make that true.
- Firefox has a microphone button.
- The caller's own bubble shows what the service heard, and never a guess at it.
- A spoken turn and a typed turn run the same code from the message onward, and every tool,
  reference and error behaves identically.
- A recording never reaches a disk, a database, a cache or a log line, in any environment,
  at any log level.
- A recording over the cap, a format the service cannot read, and a refused microphone each
  produce a sentence in the transcript rather than a stack trace or a banner.
- A rate limited spoken turn answers with a number of seconds in the problem body, and the
  panel counts it down.
- `max_payload` is raised in the compose stack and in the chart, from one stated value, in
  one commit.
- The suite passes with no network access, sends no audio anywhere, and never calls Gemini.
- A cluster with no `GEMINI_API_KEY` deploys, boots, answers 501 on both assistant routes,
  and passes `provision-release.sh --check`.
- `0039` sections 10 and 14 and velista `0032` sections 4.5 and 10 say what is now true.
