> **PR:** [#865](https://github.com/IchirokuXVI/nx-portfolio/pull/865)

# 0174: voice and the assistant's limits are shown honestly

> Asked for by the owner on 2026-10-27, and widened the same day by the orchestrator to the
> assistant's limits. Three backend plans of this batch change what the assistant can do,
> and velista has to say each change plainly instead of offering a control that fails:
>
> - Backend `0235`: speech to text runs on the operator's own server, production only.
>   With no transcriber the voice route answers 501 `not_configured` and a voice comment
>   settles `UNAVAILABLE`. Backend `0231` reports it as `features.transcription` on
>   `GET /v1/legal/settings`. Staging has no transcriber, and a self hoster may run none, so
>   voice must be **off, not broken**, where the flag is false. Text keeps working.
> - Backend `0234`: each person has an allowance. Over it the assistant answers
>   `429 assistant_allowance_reached` with `details.scope` (`user` or `deployment`),
>   `period` (`day` or `month`), `limit` (`turns`, `assistantAudio`, `commentAudio`, `cost`)
>   and `resetsAt`, and **no** `retryAfterSeconds`. A voice comment over its author's audio
>   allowance stays playable with no transcript.
> - Backend `0236`: Anthropic requires that a person is told they are talking to an AI. The
>   prompt answers when asked; the **standing** line is velista's (its section 3.3).
>
> Every fact below was read on `docs/velista-privacy-terms-plans` (from `origin/dev` at
> `c6241a693`) on 2026-10-27, and backend `0231`, `0234`, `0235`, `0236` as written in the
> same batch.
>
> Prerequisite reading: velista `0172` target 1 (`OperatorSettingsStore`); backend `0231`
> sections 2 and 3, `0234` section 8, `0235` sections on velista and the gates, `0236`
> section 3.3; velista `0038` and `0053` (voice on the list), `0039` and `0041` (voice
> comments), `0042` (the assistant panel), `0099` (the tour); rule A5 (a countdown only
> from the server's number); and in the code the three composers and their pages named in
> Context.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code, `design-taste-frontend`
before you draw the disclosure line and the allowance messages, and `antislop` with
`antislop-copywriting` before you write copy.

### Objective

Every microphone in velista is drawn only when the deployment can transcribe
(`features.transcription`) and, for the two that speak to the assistant, when the assistant
is on (`features.assistant`). Where it is not drawn, the composer is a plain text composer,
the tour does not show its voice card, and no copy mentions a microphone. A turn refused by
the allowance says, in the place it was sent from, whether it is the person's allowance or
the assistant resting, and when it comes back, never "try again" and never money. The
assistant panel carries a standing line that says it is an automated assistant.

### Context

- **Three microphones, three composers.**
  - The list's one field, `LineComposer` (`libs/velista/ui/src/lib/list/line-composer.ts`),
    already has `voice = input(true)` (L199 to L230); with it false the button is always the
    plus and the recorder is never reached. Only the basket passes `[voice]="false"`
    (`basket-page.html` L739). The list page draws it at `list-page.html` L490 to L500 with
    no `voice` binding, and `addAloud` posts the recording to the list scoped assistant
    (`list-page.ts` L1833 to L1922).
  - Voice comments, `CommentComposer` (`ui/src/lib/list/comment-composer.ts`): one button is
    send on a typed field and the microphone on an empty one (L146 to L150), always, even
    where recording cannot work (L261 to L267). It injects `AudioRecorder` without
    `optional` (L207). `CommentsSheet` draws it (`comments-sheet.html` L67 to L71) and
    provides the recorder (`comments-sheet.ts` L136 to L150).
  - The assistant panel, `AssistantComposer` (`ui/src/lib/assistant/assistant-composer.ts`):
    the button is `'send'` with text and `'record'` without (L118 to L120), injects
    `AudioRecorder` (L86). `AssistantPage` draws it (`assistant-page.html` L32 to L36) and
    provides the recorder (`assistant-page.ts` L107).
- `AudioRecorder`, `AudioCapture` and `SilenceDetector` live in `libs/velista/platform`
  (`audio-recorder.ts`, `audio-capture.ts`, `silence-detector.ts`). Nothing outside the
  three composers and their pages uses them (a search for the three names under
  `libs/velista` finds only those files and `models/src/lib/domain.ts`).
- **The tour has a voice card.** `TOUR_STOPS` (`platform/src/lib/tour/tour-stops.ts` L107 to
  L118), `tour.voice.*` in `en.json` ("Tap the microphone, say what is missing..."). Holdings
  are set from `app-providers.ts` L443 through `TourStore.setHoldings`.
- **Copy that names the microphone**: `list.add.micRefused`, `micMissing`, `voiceFailed`,
  `voiceBusy`, `voiceUnavailable`, `voiceUnsure`, the composer's `startRecording`
  label, `assistant.recorder.*`, `tour.voice.*` (`en.json` L758 to L765, L873, L877, L1347,
  L2218 to L2221). Each is drawn only with its control, except the tour card.
- **Failures today.** `voiceFailureCopy` (`feature-lists/src/lib/voice-error-copy.ts`)
  maps `rate_limited`, `not_configured` (L52, "the assistant is switched off here") and the
  rest. `AssistantStore._appendFailure` (`feature-assistant/src/lib/assistant-store.ts` L277
  to L313) maps `rate_limited` to a `throttled` message with a countdown and
  `not_configured` to `unconfigured`; everything else is `failed`, "try again". A new
  `assistant_allowance_reached` would fall to `failed` today, which is the wrong advice.
  `GatewayError` carries `details` (`data-access/src/lib/errors.ts` L40).
- **A voice comment with no transcript is already drawn right.** `COMMENT_TRANSCRIPTIONS`
  (`models/src/lib/enums.ts` L143 to L148) has `FAILED` and `UNAVAILABLE`, and the row draws
  the player and `list.comments.noTranscript` ("A recording. It could not be written down",
  `en.json` L880) for both. `0234` settles an over allowance comment as `FAILED` and `0235`
  an unheard one as `UNAVAILABLE`. Nothing to build there; a spec proves it.
- **The panel has no disclosure.** `assistant-page.html` L5 to L9 draws `PageHeader` with
  the title "Assistant", then the column with `lib-assistant-intro` or the messages.
- **The gates do not touch voice.** `velista-luna-e2e` has no voice spec (its files are
  `aisles`, `catalog`, `guest`, `member`, `shop`, `sync`), and `velista-e2e` has none
  either. `0235` notes the backend e2e asserts a 501 it keeps.

### Target state

1. **One computed, in the pages.** Each page that draws a microphone reads
   `OperatorSettingsStore` (plan `0172` target 1) and derives:
   - list page: `voiceOffered = features.transcription && features.assistant`;
   - comments sheet: `voiceOffered = features.transcription`;
   - assistant page: `voiceOffered = features.transcription` (the panel exists only with the
     assistant).
   While `settings()` is null (loading or failed), `voiceOffered` is false: a microphone that
   appears a moment late costs nothing; one that fails costs a recording. `0231` section 3
   serves `transcription: false` until the transcriber has answered once, the same direction.
2. **The composers take it.**
   - `LineComposer`: the list page binds `[voice]="voiceOffered()"`. No change in the
     component.
   - `CommentComposer` gains `voice = input(true)`, with `LineComposer`'s doc pattern: with it
     false, `button()` is always `'send'`, the button is disabled while the field is empty,
     `press()` never reaches `_record`, and the recorder is injected `{ optional: true }` and
     never started. The sheet binds `[voice]="voiceOffered()"` and stops providing
     `AudioRecorder` when it is false only if that is a one line change; otherwise it keeps
     providing it, unused.
   - `AssistantComposer` gains the same `voice` input, the same rules, and the page binds it.
   - Each composer spec: with `voice` false, an empty field draws no microphone and no
     recorder method is called on a press; with text, send works as before.
3. **The tour.** `TourHoldings` gains `voice: boolean`; the `voice` stop's `route` answers
   null when it is false, so the card is left out and the count is right ("A stop whose route
   answers null for this account is left out", `tour-stops.ts` L60 to L62).
   `app-providers.ts` feeds it from the store with the holdings. `tour-stops.spec.ts` covers
   both values.
4. **No other copy promises voice.** Search `en.json` and `es.json` for the microphone, say,
   speak, voice and their Spanish forms; every key found is drawn only with a microphone or
   is the tour card. Report the list. If a key outside those is found (an intro that says
   "say it"), word it so it is true both ways.
5. **The allowance, in the panel.** `AssistantStore._appendFailure` maps
   `assistant_allowance_reached` to a new message kind `allowance` with
   `{ scope, period, limit, resetsAt: Date | null }` read from `details` through a pure
   function `allowanceRefusal(error)` in `data-access` (rule D4, with a spec; an unknown
   `scope` reads as `user`, an unparseable `resetsAt` as null). `AssistantMessage` draws it:
   - `scope: user`, `period: day`: "You have used the assistant as much as it allows today.
     It is back at {time}."; `period: month`: "...this month. It is back on {date}.";
   - `limit: assistantAudio`: the same, about speaking: "You have used today's time for
     speaking to the assistant. You can still type." The composer stays usable for text, and
     `voiceOffered` is not changed (the next recording is refused the same way);
   - `scope: deployment`: "The assistant is resting for now. It is back at {time}." Never a
     word about money, a budget or a limit of the operator's (`0234` section 8.1);
   - `resetsAt` null: the sentence without "It is back...".
   The time and date through `Intl.DateTimeFormat` in a `try`, in the reader's time zone.
   No countdown (rule A5 reserves one for `retryAfterSeconds`, which this code never
   carries). Unlike `throttled`, the composer is not disabled: the person can still read,
   and a typed turn after an audio limit works.
6. **The allowance, on the list.** `voiceFailureCopy` gains a case for
   `assistant_allowance_reached` with the same three sentences under `list.add.*` keys,
   built by the same `allowanceRefusal`, and its spec. The list's typed add does not call the
   assistant (it writes lines; verify in `list-page.ts` `add`), so only the voice strip needs
   it.
7. **The voice comment over the author's allowance.** Nothing new is drawn. A spec in
   `comment-row` asserts that a voice comment with `transcription: 'FAILED'` and one with
   `'UNAVAILABLE'` both draw the player and `noTranscript`. The upload itself is not
   refused by `0234`, so `sendVoice`'s failure copy needs no new case; confirm in the comments
   sheet that a 429 `assistant_allowance_reached` on the upload, if a later backend change
   ever sends one, falls to the existing generic line rather than a crash.
8. **The disclosure.** A standing line in the assistant panel, directly under `PageHeader`
   and above the column, outside the scrolling messages, drawn whatever the conversation
   holds: "An automated assistant. It can get things wrong." / Spanish written on its own
   (for example "Un asistente automático. Puede equivocarse."; improve with the copy skill).
   Quiet text, `--app-text-muted` or the existing caption token, no icon, no box (velista mock
   taste: no tinted containers). Key `assistant.disclosure`. Its spec asserts it is present
   with no messages and with messages. The list page's voice strip names the assistant only
   while it works; I add no line there (section 4, O2).
9. **Specs and gates.** Every spec above, `npx nx test` for `velista-ui`, `velista-platform`,
   `velista-data-access`, `velista-feature-lists`, `velista-feature-assistant`, lint for each,
   `npx nx build velista`, and `velista-e2e` plus `velista-luna-e2e` against a slot to show
   both still pass (section 3).

### Scope

- Work only in: `libs/velista/ui/src/lib/list/comment-composer.*`,
  `ui/src/lib/assistant/assistant-composer.*`, `ui/src/lib/assistant/assistant-message.*`,
  `ui/src/lib/list/comment-row.spec.ts`, `libs/velista/feature-lists/src/lib/list-page/list-page.ts`
  and `.html` (the binding and the computed), `feature-lists/src/lib/comments-sheet/*`,
  `feature-lists/src/lib/voice-error-copy.*`, `libs/velista/feature-assistant/src/lib/**`,
  `libs/velista/data-access/src/lib/assistant/` (the refusal reader) and the barrel,
  `libs/velista/platform/src/lib/tour/tour-stops.*` and `tour-store.ts` (the holdings type),
  `libs/velista/models/src/lib/` (the message kind if it lives there),
  `libs/velista/ui/assets/i18n/en.json` and `es.json`, `apps/velista/src/app/app-providers.ts`
  (the holdings line).
- Do not touch: `audio-recorder.ts`, `audio-capture.ts`, `silence-detector.ts`, the basket
  page, anything under `apps/luna-shopper-backend`, `libs/luna-shopper/**`, the values files,
  the Android project.

### Constraints

- Angular 21, zoneless, standalone, signals, `inject()`; no `@angular/core/rxjs-interop` in
  `data-access` or `platform`.
- Rule D4 for the `details` of the new code. Rule N1 for every key.
- Rule A5: a countdown only from the server's `retryAfterSeconds`.
- The deployment sentence never names money, a budget or the operator.
- Copy for people not at home with apps. Prose in files has no dashes as punctuation.
- Only make the changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs, lint, builds, slot runs.
- Stop and ask before changing `AudioRecorder`, adding a proactive read of
  `GET /v1/assistant/allowance`, touching the backend, or editing outside the scope.

### Progress evidence

Report each numbered target when done, grounded in tool results. Walk it in a browser on a
velista slot pointed at a Luna slot: with the transcriber off (the default on a slot), no
microphone on the list, the comments sheet or the panel, and a six card tour shows five; with
a slot where `ASSISTANT_TURNS_PER_DAY` is 1, the second turn shows the person's sentence; a
screenshot of the disclosure line at 360 px in both languages. Record decisions in "What the
build decided".

## 1. Decisions

- **D1. Hidden, not disabled.** A disabled microphone asks a question ("why can I not
  press it?") that the screen cannot answer in a word, and the field already does the job.
  Hiding is what the basket does for the same reason (`line-composer.ts` L207 to L216).
- **D2. Unknown is off.** See target 1.
- **D3. The list's microphone needs the assistant too**, because the recording goes to it.
  The comment's does not.
- **D4. The allowance is a message in the conversation, not a banner**, like `throttled`
  and `unconfigured`, so it sits where the refused turn would have been.
- **D5. No read of the remaining allowance.** `0234` section 8.2 offers it, and the owner
  called it optional. A counter on the panel invites watching it; a sentence at the moment
  it matters is enough.

## 2. Not in this plan

- The assistant page and its entry points when `features.assistant` is false. Today the
  panel answers `unconfigured`; hiding the assistant from home and the bar is a plan of its
  own.
- A proactive allowance read or counter (D5).
- Anything in the transcriber, the allowance or the prompt (backend `0234` to `0236`).
- The privacy policy's voice and assistant sections (plan `0172`, behind the same flags).

## 3. e2e

No staging gate touches voice: `velista-luna-e2e` has no voice spec and the stubbed
`velista-e2e` has none. Staging runs with no transcriber, so after this plan staging shows
no microphone at all, which is the intended state. The allowance limits of `0234` are far
above what one gate run uses (60 turns a day per person; the gate makes no assistant turn).
Nothing in either suite changes.

## 4. Decisions that are the owner's

- **O1.** The disclosure's place and words: a standing line under the panel's header
  (target 8). The alternative is inside the intro, which disappears once a conversation
  starts; Anthropic asks for a disclosure, and a standing line is the safe reading.
- **O2.** No disclosure on the list's voice strip. The strip appears only after somebody
  speaks into the list's field, and it says the assistant is working; if the owner reads
  Anthropic's rule as covering every surface where the model answers, add the same line to
  the strip.
- **O3.** The tour's assistant card says "the way you would tell a person"
  (`tour.assistant.body`). It does not claim to be a person, but the owner may want
  "automated" in it.
- **O4.** No counter of the remaining allowance (D5).

## 5. Choices that are mine

- `voiceOffered`, `allowanceRefusal`, the message kind `allowance`, the key names.
- Hidden rather than disabled (D1); unknown as off (D2); the list mic needing both flags
  (D3).
- The sentences of target 5, and keeping the composer usable after an audio limit.

## 7. What the build decided

The builder's choices where the plan left room, written on 2026-10-29. Each is the owner's
to change. No target's text was amended.

### 7.1 The flags and the composers

1. **`voiceOffered` is a `computed` on each page**, read from `OperatorSettingsStore`:
   the list page asks `transcription && assistant` (D3), the comments sheet and the
   assistant page ask `transcription`. Each is false while `settings()` is null, whether
   the read is out or failed (D2). A spec for each page covers on, off, unanswered then
   landing, and failed. For the list page that meant editing `list-page.spec.ts`, which
   the scope list does not name (it names `list-page.ts` and `.html` only): the spec gained
   the fake settings store and the microphone specs.
2. **Both new `voice` inputs follow `LineComposer`.** With `voice` false the button is
   always send, disabled while the field is empty, `press()` never reaches the recorder,
   and the recorder is injected `{ optional: true }`. The templates read the recorder
   through `?.` with `idle` as the fallback state, so a composer with no recorder at all
   renders, which a spec in each composer proves.
3. **The sheet and the panel keep providing `AudioRecorder`.** Component providers are
   fixed when the component is declared and cannot follow a signal, so stopping them would
   not be a one line change (target 2 allows keeping it). The recorder is constructed and
   never started; it asks for no permission until `start()`.
4. **The comments sheet's doc says why it does not ask the assistant flag**: a voice comment
   is a recording for the people on the list, not a turn the assistant answers (D3).

### 7.2 The tour

5. **`tourHoldingsOf(zones, voice)`** takes the flag from its caller, since `platform` may
   not read `data-access`. `HOLDS_NOTHING` holds `voice: false`.
6. **`app-providers.ts` waits for the settings as it waits for the zones.** While the read
   is `idle` or `loading` the holdings are null, so the tour waits (up to the existing
   `TOUR_HOLDINGS_WAIT_MS`) rather than planning five cards for a deployment that offers a
   microphone; a failed read plans without the card (D2). The voice card needs the same two
   flags as the list page, because it lights the list's microphone. The review round added
   `apps/velista/src/app/tour-holdings-wiring.spec.ts`, which drives this effect: loading
   keeps the holdings null, a failed read lands `voice: false`, and both flags on land
   `voice: true`.
7. **`tour-store.spec.ts` gained `voice: true` on its two fixtures.** The type change makes
   the field required, and that spec is outside the scope list; the edit is the two
   literals and nothing else, so its expectations (six cards) still hold.

### 7.3 The allowance

8. **`assistant_allowance_reached` joined velista's `ERROR_CODES`** (`models/problem.ts`).
   Without it the code read as `internal` and no reader could see it. The file is under
   `libs/velista/models/src/lib/`, which the scope names.
9. **The types are velista's own**, in `models/src/lib/assistant-allowance.ts`:
   `AllowanceScope`, `AllowancePeriod`, `AllowanceLimit`, `AssistantAllowance`, and the pure
   `allowanceReturn(allowance, locale)`, which formats the time (a `day`) or the date (a
   `month`) through `Intl.DateTimeFormat` in a `try`, in the reader's time zone, and answers
   null for a moment it cannot format. `AssistantEntry` gained `allowance?` beside the new
   kind.
10. **`allowanceRefusal(error)`** is in `data-access/src/lib/assistant/allowance-refusal.ts`,
    exported from the barrel. Unknown `scope` reads `user`, unknown `period` reads `day`,
    unknown `limit` reads `turns` (the sentence that says the assistant is done for the
    period, not one that invites typing), and an unparseable `resetsAt` reads null. So does
    one that is not an ISO date-time, because `Date` alone accepts `'12'` (2001) and
    `'2026'` (New Year) and would show a confident wrong time.
11. **The panel's sentence is two keys joined**: the reason, then the way back, left out
    when the time is null. The reason is `assistant.allowance.resting` for any deployment
    refusal, `assistant.allowance.speaking.{day,month}` for the person's `assistantAudio`,
    and `assistant.allowance.used.{day,month}` for every other person's counter, `cost`
    included. Money is never named.
12. **The hour goes in as the plural count.** Spanish says "a la 1:00" and "a las 2:00", so
    `backAt`, `speakAgainAt` and the list's `at` keys have `_one` and `_other` forms; the
    English forms are the same sentence twice. The time is formatted with
    `hour: 'numeric'`, so it carries no leading zero: Spanish reads "a la 1:00" and English
    "9:05 PM".
13. **The sentences differ from target 5's examples**, as section 5 allows: "You have used
    the assistant as much as you can for today." reads more plainly than "as much as it
    allows". The speaking sentence keeps "You can still type." and adds "You can speak to
    it again at {time}." English times follow the reader's convention, so midnight reads
    "12:00 AM" for `en`.
14. **The allowance message is drawn with the `unconfigured` treatment** (`bubble waiting`,
    polite), no clock, and the composer is not disabled. It is never the countdown of
    `throttled`, which stays bound to `retryAfterSeconds`.
15. **The list's strip says nothing was added and that typing still works, after every
    limit**, not only the one on speaking: the typed add writes lines and never calls the
    assistant (verified in `list-page.ts` `add`, which calls `LineStore.addLine`; only
    `addAloud` calls `askAboutList`). The strip draws one key, so each case is one sentence
    under `list.add.allowance.{usedDay,usedMonth,speakingDay,speakingMonth,resting}` with
    `plain`, `at` or `on`. `voiceFailureCopy(error, locale)` takes the reader's locale for
    the time; the strip keeps the time it was given if the language changes afterwards.
    The English speaking forms put the way back in a sentence of its own ("You can still
    type it. You can speak to the assistant again at {{time}}"), so "it" never changes
    referent inside one sentence.
16. **Target 7 needed no copy.** A spec in the comments sheet sends an upload that answers
    429 `assistant_allowance_reached` through the composer (record, stop, the upload
    refused): it falls to `list.error.failed` in the sheet and in the composer, which keeps
    the recording and draws its retry, both asserted. A spec in `comment-row` asserts the
    player and `noTranscript` for `FAILED` and for `UNAVAILABLE`.

### 7.4 The disclosure

17. **`assistant.disclosure`** is a `<p class="disclosure">` between `PageHeader` and the
    column, in `--app-text-muted` at `--app-text-xs`, with the column's side padding, a
    small bottom padding (`--app-space-2`) so a scrolled bubble is cut clear of the text,
    and no icon or box. English is the plan's line. Spanish is "Te responde un asistente
    automático que puede equivocarse.", written as a sentence rather than the two fragments
    of the English. At 360 px both fit on one line.
18. **The header spec now looks two siblings back** for `PageHeader` from the column,
    because the disclosure sits between them; both stay outside the scroller.

### 7.5 Target 4: every key that names the microphone, voice or speaking

Searched in both files for microphone, mic, voice, say, said, speak, spoken, record,
listen and hear, and for micrófono, voz, di, dicho, habla, grab, escucha and oír.

- **Drawn only with the list's microphone or its strip:** `list.add.startListening`,
  `stopListening`, `listening`, `discard`, `heard`, `working`, `notHeard`, `micRefused`,
  `micMissing`, `voiceFailed`, `voiceBusy`, `voiceBusyNoNumber`, `voiceUnavailable`,
  `voiceUnsure`, and the new `list.add.allowance.*`.
- **Drawn only with the comment composer's microphone or a recording:**
  `list.comments.startRecording`, `stopRecording`, `discardRecording`, `micRefused`,
  `recordingEmpty`, `recordingTooBig`, `limit.*`, `sending`; on a voice comment's row
  `noTranscript`, `play`, `playFailed`, `autoTranscript`. These describe a recording that
  exists, which an older client or another deployment may have left, so they stay true.
- **Drawn only with the panel's microphone or a spoken turn:** `assistant.composer.record`,
  `composer.stop`, `assistant.recorder.*`, `assistant.spoken`, `tooLong`, `badFormat`, and
  `assistant.allowance.speaking.*`, `speakAgain*`, which only an audio refusal draws.
- **The tour card:** `tour.voice.title`, `tour.voice.body`, left out with the microphone.
- **Outside those, and true both ways, so unchanged:** `list.comments.placeholder` ("Say
  something about this", "Di algo sobre esto") and `list.comments.empty` use "say" for
  writing a comment; `assistant.intro.lead` ("Tell me what you need") and the
  `assistant.intro.*.said` examples are things one types as well; `tour.assistant.body`
  ("the way you would tell a person") is O3; `list.confirm.deleteLine.body` ("anything said
  about it") means the comments. `list.detail.record` ("Record it", "Guárdalo") is about
  writing a detail down, not audio.

### 7.6 What the build left out, and the evidence

19. **No walk of the allowance against a real assistant.** On an ephemeral slot the rendered
    `.env` sets `ANTHROPIC_API_KEY=` blank and the script exports it over the process
    environment, so the key could reach the assistant only by being written into a file,
    which the build was told never to do. The walk stubbed `POST /v1/assistant` in the
    browser instead: the first turn a 201 reply, the second a 429 with the backend's
    `details`. The four other readings were stubbed one turn each.
20. **The list strip's allowance sentence was not walked**, since it needs a recording; its
    spec covers every key.
21. **Walk, 2026-10-29, front end slot 1 on ephemeral Luna slot 7, 360 px, Night, English
    and Spanish.** The slot answers `transcription: false` and `assistant: false`. No
    microphone on the list, the comments sheet (send disabled while empty) or the panel;
    the tour played five cards ending on the assistant card; the disclosure stood with no
    messages and with four; each allowance reading drew its sentence with the composer
    still enabled. With `features` stubbed on, all three microphones came back.
22. **Gates on the slot:** `velista-e2e` 100 passed; `velista-luna-e2e` 8 passed and 2
    skipped by `terms.spec.ts`'s own condition (the slot publishes no terms).
