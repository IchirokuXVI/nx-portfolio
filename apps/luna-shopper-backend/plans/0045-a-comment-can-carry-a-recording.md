# 0045 A comment can carry a recording

> **The first thing this backend keeps that is not text.** A comment on a line can be a voice
> message: uploaded, stored, played back by anybody who can read the line, and transcribed so
> it can be read without being played.
>
> Every other recording in this product is held for the length of a turn and never written
> down (plan `0041` section 6). This one is the message, so it is kept for as long as the
> comment is, and that difference is what this plan is mostly about: where the bytes live,
> who can fetch them, and what happens when the transcription fails but the message is still
> a message.
>
> Prerequisite reading: plan `0041` sections 3.2, 3.3 and 4 (the transcription seam, the
> format question and the broker's payload limit), plan `0036` section 4 (who may comment and
> who may read), and velista `0039`, which is the client.

## 1. What is being built

- **`POST /v1/lines/:id/comments/voice`**, multipart, taking one recording and answering with
  the comment it created.
- **`GET /v1/comments/:id/audio`**, answering the bytes, gated on `READ` of the line's list.
- **A `comment_audio` table** in core's database, holding the bytes.
- **Transcription after the fact**, filling the comment's body and announcing it, so that a
  provider that is down costs a transcript and never a message.

## 2. Where the bytes live

There is no object storage anywhere in this backend, no S3, no MinIO, and no PVC that
anything writes files to. So this decision is being made rather than inherited.

**A `bytea` column, in its own table, in core's database.**

| | |
| --- | --- |
| new infrastructure | none |
| new secret | none |
| new backup path | none: the existing database backup covers it |
| new failure mode | none: if the database is down, comments are down anyway |

The alternative is MinIO or an equivalent: a StatefulSet, a PVC, credentials in
`provision-release.sh`, entries in both values files, both compose files and both slot
scripts, a second backup story, and a second thing that can be up while the other is down.
That is a large amount of new surface for a feature whose entire corpus is measured in
megabytes.

**The arithmetic, so this is a decision rather than a hope.** Speech grade Opus is roughly two
kilobytes a second, so a sixty second message is about 120 KB, and the cap is two megabytes to
match plan `0041`. A household leaving two hundred voice comments a year costs about
twenty five megabytes a year. The number that would change this answer is three orders of
magnitude away.

Three rules that keep it honest:

- **Its own table, keyed one to one on the comment.** `line_comments` stays a narrow row that
  is selected in every comment listing, and the bytes are never in that query's way. A `bytea`
  column on the comment itself would put the audio into the `SELECT *` path of a paged
  endpoint, which is how this decision would turn bad quickly.
- **Nothing ever selects the bytes except the playback route.** Listing comments reads the
  metadata (length, content type, whether a recording exists), which lives on the comment, not
  on the audio row.
- **The cap is enforced twice**, at the multipart interceptor and again in core, for plan
  `0041` section 5's reason: the server cannot trust a duration, only a byte count, and a cap
  that is not on the interceptor is not a cap.

**When to move it.** If the table passes a few gigabytes, or if a second thing in this product
needs to store a file, the table is the seam: a row keyed on the comment becomes a key into
something else, and the playback route is the only thing that changes. That is a deliberate
exit, not a promise to refactor.

## 3. The upload is its own route

`POST /v1/lines/:id/comments` stays exactly as it is: a JSON body, one DTO, one validation
pipe. The voice upload is a sibling route taking `multipart/form-data`.

Not the same route with two shapes. A `FileInterceptor` on a route that also has to accept a
JSON body means the global `ValidationPipe` sees a different thing depending on the content
type, and the typed comment path is the busiest write in the product. Two routes, one of which
is untouched.

The interceptor and its `multer` dependency arrive with plan `0041`; if that plan lands first,
this one adds a route rather than a dependency.

**The broker's payload limit is plan `0041`'s section 4.2** and this route depends on it: the
recording travels gateway to core over NATS as base64, which is the same third of a megabyte
of inflation on the same eight megabyte ceiling. If this plan is built before `0041`, the
`max_payload` raise moves here, in **both** compose and the Helm template, in one commit. A
raise in one and not the other is a feature that works on the development machine and fails in
the cluster with a broker error.

## 4. Store first, transcribe after

The order matters more than anything else in this plan.

**The comment is created and the audio stored in one transaction, before anything is
transcribed.** The response comes back immediately, carrying a comment with a recording and no
body yet. Transcription runs after, and when it lands the body is filled in and a
`comment.updated` event goes to the line's room.

Three reasons, in order of how much they matter:

- **The audio is the message.** A transcription is a reading of it. If the provider is rate
  limited, or down, or the deployment has no `GEMINI_API_KEY` at all, the message must still
  exist and still play. Transcribing first and storing after would mean a provider outage
  silently swallows what somebody said.
- **Nobody should wait on a model to leave a comment.** The upload is already seconds of mobile
  data. Adding a provider round trip in front of the response doubles a wait somebody is
  watching.
- **It is the same shape the realtime path already has.** A comment arrives at the room when it
  is created and again when it changes, and the client upserts, which is what
  `CommentsSheet.send` already does for the typed path.

### 4.1 Which service transcribes, and who orchestrates

The `transcribe` seam belongs to the assistant service (plan `0041` section 3.2), which holds
the credential and speaks the provider's API. **Core does not gain a model provider**, and it
must not: core is the database and the rules, and a dependency from core on the assistant would
make the list service unbootable without a credential it has no other use for.

**The gateway orchestrates**, because it already talks to both over NATS and is the only place
that talks to both. It creates the comment through core, answers the caller, and then asks the
assistant for a transcription and hands the result back to core.

The transcription request carries the audio, its content type and the caller's locale, exactly
as plan `0041` section 3.2 defines. It does not carry the list, the line, or anything about who
said it: it is a transcription, not a turn, and rule A1 has nothing to enforce because nothing
is being read.

### 4.2 When transcription does not happen

| | |
| --- | --- |
| the provider is rate limited or briefly unavailable | a small bounded retry, then give up |
| the provider cannot take audio, or there is no key | no attempt, and the comment is untranscribed from the start |
| the provider returned nothing | the comment stays untranscribed |
| it succeeded | the body is filled in and `comment.updated` goes to the room |

**A comment with no body is a valid comment**, and every read path has to hold that. The client
draws a neutral phrase in its place (velista `0039` section 3) and the player is there
regardless. There is no retry queue and no background sweep: a transcription that failed twice
is not going to be worth the machinery, and the message is intact without it.

The comment carries which of these happened, so the client can tell "not transcribed" from
"still transcribing" without polling. Those two states look identical on screen for about three
seconds and completely different after a minute.

## 5. Playback

`GET /v1/comments/:id/audio`, gated on `READ` of the list the comment's line belongs to. That
is the same gate as reading the comment's text, and there is deliberately no separate
permission: plan `0036` section 4.3 says `READ` is genuinely everything else about a list's
content, and a recording somebody left on a line is that.

- **The whole body, no range requests.** A hundred kilobyte file does not need a 206, and
  scrubbing inside one that is already fetched is the browser's problem rather than the
  server's. If a longer format ever ships, ranges are added then, deliberately.
- **`Cache-Control: private, immutable`** with a long age. The bytes never change: the comment
  is not editable and neither is its recording. This is the one route in the product where an
  immutable cache is unambiguously correct, and it is what keeps a re-listened thread from
  re-downloading.
- **Never a redirect to storage.** The bytes come from this route today, and if section 2's
  exit is ever taken, they still come from this route, from somewhere else. Handing clients a
  storage URL would make the storage decision part of the API.

## 6. Limits and abuse

- **A byte cap**, from configuration, checked at the interceptor and again in core.
- **An accepted content type list**, from configuration, refusing anything else with a sentence
  rather than a stack trace. Plan `0041` section 3.3's format question applies here in exactly
  the same form and gets exactly the same answer, because it is the same browsers producing the
  same containers. **It is answered once, for both plans.**
- **Its own rate limit bucket**, stricter than the comment bucket. An upload is orders of
  magnitude more expensive than a sentence, and the existing global bucket was sized for
  sentences.
- **A duration is recorded from the client and never trusted.** It is metadata for drawing a
  row before the file is fetched. Nothing authorizes on it, and nothing rejects on it: the byte
  count is the enforcement.

## 7. Deletion and retention

The audio lives exactly as long as its comment. `line_comments` already cascades from the line,
which cascades from the list, which cascades from the zone, and the audio table cascades from
the comment. So deleting a line takes its comments and their recordings, and account deletion
(plan `0011`) reaches them by the same chain it already follows.

**There is no separate delete for a recording**, because there is no delete for a comment. If
comment deletion is ever built, this table needs nothing new.

## 8. Contracts, configuration and CI

- `CommentView` gains the recording's metadata and the transcription state. `body` becomes
  optional in the sense that it can be empty, which every client already tolerates but no
  client currently expects.
- A `comment.updated` realtime event, to the line's room, carrying the whole comment.
- One migration: the table, its foreign key, its cascade.
- **Configuration in five places, and missing any one of them is a known failure in this
  repository:**
  - `k8s/helm/templates/luna-shopper-backend/_env.tpl` and the ConfigMap keys;
  - `k8s/e2e/luna-shopper-backend/compose.yml`;
  - `k8s/e2e/luna-shopper-backend/compose.apps.yml`, which states its environment separately
    and inherits none of the above;
  - `luna-slot.sh` and `luna-slot.ps1`, whose generated per slot `.env` needs the same keys. A
    generated `.env` missing a newly required variable kills one service at boot while the
    gateway stays up and returns 500s, which this repository has been bitten by before.
- **`gateway/docs/openapi.json` regenerated in the same commit.** A multipart route with a
  binary part and a route answering `audio/*` are both shapes this document has not carried;
  read the generated diff rather than trusting it.

## 9. Testing

- A voice comment is created and playable with the provider stubbed to fail, which is the
  assertion section 4 exists for.
- A successful transcription fills the body and emits `comment.updated` exactly once.
- The byte cap is enforced at the route with a file over it, and the message names the limit.
- An unsupported content type is refused with a sentence.
- Playback is refused for somebody without `READ` and allowed for somebody with it and nothing
  else.
- Listing comments does not select the audio bytes, asserted on the generated SQL rather than
  on timing.
- Deleting the line removes the comment and the audio row.
- No test sends a byte of audio to a provider (rule A4).

## 10. Acceptance

- A voice comment survives a provider outage, plays, and shows as untranscribed.
- A transcript arrives at an open thread without a refresh.
- A reader can play a recording; somebody with no access to the list cannot fetch it.
- The comment listing query is no slower than it was.
- A recording is gone when its line is.
- Every configuration file that states environment by hand names the new variables.
