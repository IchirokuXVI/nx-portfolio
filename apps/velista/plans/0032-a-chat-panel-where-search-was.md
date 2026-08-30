# 0032: a chat panel where search was

> The app bar's search button has never done anything. `HomePage.search()` calls
> `_notYetRouted('search')` and always has, and there is no search page, no search service
> and no search route behind it. So this plan does not remove a feature. It spends a
> placeholder: the button becomes the way into the assistant, and search comes back later
> with a plan of its own, when there is something to search.
>
> Prerequisite reading: backend plan `0039`, which is the service this talks to and whose
> rules A2, A3 and A5 decide who holds the transcript, where links come from, and what a
> rate limited turn says.
>
> The design is in `mocks/assistant/`, published at
> https://claude.ai/code/artifact/0fedd982-86de-47c5-99e1-2458dd04cf2f

## 1. The button

`AppBar` keeps its shape and its two slots. The search icon becomes a chat icon, and the
`openSearch` output becomes `openAssistant`.

Two things follow from house rules rather than from taste:

- **The icon is a component in `libs/shared/ui`**, beside `home-icon`, `save-icon` and the
  rest, built the same way: an `*-icon.svg` inlined through `import('./*.svg?raw')` and
  `DomSanitizer`, exported from that lib's `index.ts`. Not raw `<svg>` in a velista
  component. Check whether one there already fits before adding another.
- `SearchIcon` stays where it is and stays exported. Nothing else imports it today, and
  deleting it saves nothing while search is coming back.

`HomePage.search()` goes with its `_notYetRouted('search')` line, and the doc comment above
it that lists what the dashboard cannot yet do loses search and keeps starting a list.

## 2. A destination, not a sheet

The panel is a **route at `{mount}/{locale}/assistant`**, reached from the app bar wherever
the caller happens to be.

The app bar lives in `AppLayout`, so its button is on every page, and that is what decides
this. Rule E1 (plan `0008`) makes a sheet a child route of the page it covers, so a sheet
reachable from everywhere would be a child of everywhere: eight identical entries that must
not drift, for a panel that covers a page it has nothing to do with.

So it follows `account` (plan `0015`) instead, for the reasons that plan gave: it is deep
linkable, it has its own scroll, and it is somewhere somebody goes deliberately rather than
something drawn over what they were reading. `authenticatedGuard` and nothing more.

Declared before the `''` front door like every other non empty path, which `routes.spec.ts`
already asserts for the table as a whole.

Rejected: a floating panel toggled by a signal. Nothing would be pushed onto the history
stack, so Android's back button would close the app rather than the panel. That is the
defect rule E1 exists to prevent, and plan `0031` spent a whole plan repairing the last
version of it.

## 3. What is on the screen

A transcript, a composer, and one button that changes with the state (section 4). Nothing else
in this plan.

- The caller's messages and the bot's, in order, visually distinct, and selectable.
- A pending state while a turn is in flight, with the composer disabled for its duration.
- **Errors are messages in the transcript, not banners.** A transport failure gets a local
  string that reads like everything else in the column. One kind of thing, in one place,
  whatever went wrong.
- An empty state that says what the bot can do, in three lines, because a text box with a
  cursor in it tells nobody what to type. The three lines are the three tools.

### 3.1 The rate limit is a countdown, not an apology

The free tier's limits are shared across every user of the app (backend `0039` section 9),
so being told to wait is an ordinary event here rather than an edge case, and it has to
read like one.

The service answers a rate limited turn with `retryAfterSeconds` (backend `0039` rule A5).
The panel **counts it down**: a message in the transcript saying how many seconds are left,
ticking, with the composer disabled until it reaches zero and then re-enabled by itself.

"Try again later" is the wrong string and is specifically wrong for the people this feature
is for. Somebody who cannot easily type is left guessing, and guessing means pressing send
again, which spends the next slot and makes the wait longer. A number that visibly shrinks
asks nothing of them and is honest about the cause.

The countdown is a display of a value the server sent. The panel never invents one, and if
the field is somehow absent it says the bot is busy without a number rather than guessing.

## 4. Speaking to it

The microphone is not deferred to a later plan. Speaking is the reason this panel exists, so
it ships with it.

### 4.1 One slot, three jobs

The right hand button is 52px in the same corner throughout, and what it is depends only on
the state:

| State              | Button                |
| ------------------ | --------------------- |
| the field is empty | **microphone**, amber |
| anything is typed  | **send**, amber       |
| recording          | **stop**, coral       |

Never two buttons competing for one intention, and nothing moves under the thumb. Stop
inherits the microphone's exact position, so the finger that started a recording ends it
without travelling.

### 4.2 A press, not a hold

**Press to start, press to stop.** Press and hold is the conventional voice gesture and it is
the one this audience cannot perform: it asks for sustained, steady pressure for the length of
the message, which is precisely what a tremor removes. A recording here survives a hand that
shakes, drifts, or lets go.

### 4.3 The control row, in one order, for one reason

While recording, the composer's field is replaced by the controls, in this order left to
right:

**pause — elapsed length — stop**

Pause sits at the far left and stop at the far right, as far apart as the container allows.
They are the only two controls on screen and confusing them costs the whole message, so the
distance is the safeguard. The length sits between them and doubles as the separator.

Colour is never the only signal: stop is a square, pause is two bars, carry on is a triangle,
and the dot beside the length is filled while listening and hollow while paused.

### 4.4 Three minutes warns, five minutes stops

Both warnings **grow the container and put the message at the top of it**. Growing rather
than overlaying means nothing is covered and both buttons stay where the hand left them.

- **At 3:00**, the message says five minutes is the maximum and how long is left. Recording
  continues.
- **At 5:00**, recording **pauses. It is not sent.** The pause button is disabled and stop
  becomes the only way out, and the message says so.

Pausing rather than sending is the decision worth defending. Sending on a timer takes the
choice away from somebody who was mid sentence, and a message that leaves on its own is a
message nobody agreed to send. Holding it costs one press and returns the decision to the
person. The message at 5:00 is required rather than decorative: silence at the limit reads as
the app having broken, and whoever is recording for five minutes is the person least able to
work out what happened.

### 4.5 What the recording is

> **As built:** `MediaRecorder`, as this section originally drew. The recording is uploaded
> and the service transcribes it (backend `0041`). Section 10 is the account, including the
> period in between when it was the browser's own `SpeechRecognition` instead.
>
> **Nothing in 4.1 to 4.4 changed in either direction**, which is the useful thing this
> note records: the clock, both thresholds and the pause are this app's rather than the
> capture's, so the controls survived a reversal and its undoing without an edit. The
> composer's fourteen tests passed both times without their assertions being touched.
>
> One thing here **did** change, and it is easy to miss because it looks like a recovery:
> the recorder now asks for a low, speech grade bitrate explicitly. Left to its own choice
> Chrome records generously enough that five minutes lands several megabytes past the
> service's cap. Section 5 of `0041` has the arithmetic.

The speech is captured client side, in the browser, as a file. Where it is turned into text
was left open here and section 10 records how it was answered, twice.

## 5. The client holds the transcript

Backend `0039` rule A2 makes the service stateless, so the conversation lives here and is
sent whole on every turn.

- It lives in a signal in a store provided by the route, so leaving the panel and coming
  back within a session keeps the conversation, and a reload does not. That is the
  backend's choice and this plan does not work around it.
- It is capped here as well as on the server, at the same numbers, read from one place. The
  server caps because the client is untrusted; the client caps so that a person sees the cap
  happen instead of having a turn silently truncated somewhere they cannot see.
- When the cap bites, the oldest turns drop and the panel says so on a line of its own.

## 6. It is an ordinary gateway call

The panel talks to `/v1/assistant` on the **gateway base URL the app already has** (backend
`0039` section 3). There is no second origin and no new environment value.

That is worth a sentence because of what it means in practice: `gatewayInterceptor` already
attaches the token and the `Accept-Language` header, the existing data-access helpers
already resolve the base URL per environment, and a signed out caller is already handled.
The data-access piece for this feature is one method, not a client.

## 7. The links, and where they come from

Every reply carries a `references` array (backend `0039` section 8): the zones, lists and
lines the turn genuinely read or wrote. The panel renders those as links under the message.

**The reply text is never parsed for ids, and never rendered as markdown.** An id in a
`references` entry came back from the gateway during that turn, so the target exists and
the caller can see it. An id inside a sentence has neither property, and a link to a list
that was never there is worse than no link at all.

Each reference becomes a `routerLink` built with `appPath(locale, basePath, ...)` from
`@portfolio/velista/platform`, never an assembled string. That helper is what makes one
link correct at `/velista/en/...` when mounted in the portfolio shell and at `/en/...` on
velista's own origin. A hardcoded path is wrong in exactly one of the two run modes, and it
is the mode nobody looks at.

| kind   | goes to                                             |
| ------ | --------------------------------------------------- |
| `zone` | `zones/:zoneId`                                     |
| `list` | `zones/:zoneId/lists/:listId`                       |
| `line` | `zones/:zoneId/lists/:listId`, with `?line=:lineId` |

## 8. A line has no route, so it gets a query parameter

The list page has four sheets over it and three of them address a line: `lines/:lineId/edit`,
`lines/:lineId/comments`, `lines/:lineId/confirm/delete`. All three **do something** to the
line. None of them simply shows it.

So a line link cannot reuse them. A link in a chat message that opens an edit form is a link
that changed what the app is doing because somebody wanted to look at something, and for the
users this feature exists for, an unasked-for form over the screen is the failure mode, not
a convenience.

`ListPage` therefore takes an optional `?line=<uuid>`: on arrival it scrolls that line into
view and marks it briefly, and opens nothing. An id that is unknown, or on a line the caller
cannot see, is ignored and the page renders normally, because a stale link should be inert
rather than an error.

This is the only change this plan makes outside the panel.

## 9. Language

The panel is localized like everything else here, with its own namespace of keys.

The bot's replies are not. They arrive in whatever language the service answered in, which
is the caller's, because the request carries `Accept-Language` like every other gateway call
in this app and the existing `gatewayInterceptor` already sets it. Nothing here translates a
reply and nothing should try.

## 10. Audio is not text, and 0039 has to say where it becomes text

> **Settled by backend plan `0041`: the first option.** `POST /v1/assistant/voice` takes
> the recording as multipart, the assistant transcribes it with the provider it already
> holds a credential for, and the existing turn loop answers the sentence that comes out.
> The client is `MediaRecorder`, exactly as section 4.5 drew.
>
> **It was settled the other way in between, and that period is worth keeping straight**,
> because the second answer was not a mistake: `0039` shipped with a text only
> `POST /v1/assistant`, no multipart route, no size cap and no speech provider, so the
> browser's own `SpeechRecognition` was the only place left. It was settled by what
> existed rather than on the merits. `0041` section 2 is the argument, made once the
> endpoint was on the table.
>
> What that period actually cost, now that there is a record of it rather than a
> prediction:
>
> - **Firefox lost its microphone**, because it has no `SpeechRecognition` at all.
>   `getUserMedia` and `MediaRecorder` are everywhere, so it has one again.
> - **The engine ends itself on silence**, so the code above it restarted recognition on
>   every `end` and tracked whether it was really running, because `stop()` on a stopped
>   engine fires nothing. A whole shipped bug lived in that machinery: a paused dictation
>   could not be stopped, the promise never settled, and the message was lost with nothing
>   on screen saying so. A file has no seams; pause and resume are one recording now.
> - **The privacy gain was smaller than it looked.** Chrome and Safari implement
>   `SpeechRecognition` by sending audio to the browser vendor. The choice was never
>   between sending a recording and not sending one; it was between sending it as this
>   app's request, under terms this project has read, and as the browser's, under terms
>   nobody here can see.
>
> What it genuinely bought, and what giving it back costs: the client knew the words as
> they were spoken, so the caller's own bubble filled in with no round trip. It no longer
> does. The bubble now says that something was said and is being listened to, and is
> replaced by what the service reports hearing. It must never **invent** the words — there
> is nothing on this side to invent them from, and a guess at what somebody said is worse
> than showing that it is waiting.
>
> **What did not change, either time: every control in section 4.** That is the thing this
> whole entry is really a record of.

**This was the one open dependency in this plan, and it was a real one.** Section 4 produces an
audio file. Backend `0039` describes a service that takes text and returns text. Something
between the two has to transcribe, and nothing currently says what.

Backlog `0005` section 6 assumed the browser's own speech recognition, and that assumption
does not survive this design. `SpeechRecognition` hands back **text and no file**: there is
nothing to pause, nothing to hold at five minutes, and no recording to send. A five minute
capture with a pause button is a `MediaRecorder` feature, and a `MediaRecorder` feature means
a file leaves the device.

So `0039` has to choose one, before this is built:

- **Upload the audio to the assistant service**, which transcribes it and continues exactly as
  it does for a typed turn. Needs a multipart endpoint, a size cap that agrees with five
  minutes of the chosen codec, and either a speech to text provider or Gemini's own audio
  input, which accepts audio natively where a text only API would not.
- **Transcribe in the browser and send only text**, which keeps the service unchanged and
  makes the recorder a local convenience. Then the five minute cap is about the transcript,
  not an upload, and the pause button is harder to justify.

The first is what section 4 draws. It is also the one that changes `0039`: a turn stops being
cheap, the free tier's per minute limits start counting audio, and the privacy note in that
plan's section 10 has to cover a voice recording rather than a sentence.

What does **not** change either way: the field stays an ordinary text input with an ordinary
submit and no custom key handling, so the platform keyboard's own dictation button keeps
working into it beside the app's microphone. Somebody who already knows that gesture should
not have to learn this one.

## 11. Testing

- The route exists, carries `authenticatedGuard`, and sits before the front door.
  `routes.spec.ts` is where that ordering assertion already lives.
- `AppBar` emits `openAssistant`, and no longer emits `openSearch`.
- A reply with references renders one link per reference, with the right href in **both**
  run modes, which means the spec supplies both base paths rather than one.
- A reply whose text happens to contain something link shaped renders it as text.
- The cap drops the oldest turns and says so.
- A failed turn appears in the transcript and re-enables the composer.
- A rate limited turn renders a countdown from the server's `retryAfterSeconds`, keeps the
  composer disabled while it runs, and re-enables it at zero without a reload.
- A rate limited turn with no `retryAfterSeconds` says the bot is busy and invents no number.
- The composer's button is a microphone on an empty field, send on a non empty one, and stop
  while recording, and it never moves.
- A recording starts and stops on single presses, and survives the pointer leaving the button.
- The controls render pause, length, stop, in that order, and pause and stop are at opposite
  ends of the container.
- At 3:00 the container grows and the message names the limit and the time left; recording
  continues.
- At 5:00 recording pauses, is not sent, pause is disabled, and the message says so.
- A refused microphone permission renders a state and never an unhandled rejection.
- `ListPage` scrolls to and marks `?line=`, ignores an unknown one, and opens no sheet.

## 12. Open decisions

- Whether the panel survives a full reload. It cannot without either client storage or the
  backend's, and both are the next plan's call.
- Whether the entry point should also sit on the list page, which is where somebody actually
  stands when they want to add something. Leaning yes, later, once the transcripts say what
  people use it for.
- Whether a line the bot created is marked as such. Depends on the open decision of the same
  name in backend `0039` section 14.
- **Whether stop sends immediately, or offers a review first.** It sends immediately as drawn.
  For this audience an accidental stop is a sent message with no way back, and a confirm step
  would tax every recording to protect the rare one. Worth settling before build; a middle
  option is a brief undo on the sent message rather than a confirm before it.
- ~~**Where a recording is transcribed**, which section 10 states in full.~~ **Settled.**
  `0039` shipped a text only endpoint, so the browser transcribes and only text leaves the
  device. Section 10's blockquote says what that changed and, more to the point, what it
  did not.
- Whether a recording survives leaving the panel mid capture. Drawn as though it does not.

## 13. Exit criteria

- The app bar's second button opens the assistant, and search is gone from the bar and from
  `HomePage`.
- The panel is a route, is deep linkable, and the back button leaves it without closing the
  app.
- A conversation can add a line, edit one, answer a question about a list, and change the
  caller's name, each end to end against the real service.
- Every link under a reply comes from `references`, resolves in both run modes, and none of
  them 404s.
- A line link scrolls to the line and opens nothing.
- A busy provider and a dead network both read as a message in the transcript, and the busy
  one carries a countdown that re-enables the composer by itself.
- The panel added no new origin and no new environment value.
- The composer accepts platform keyboard dictation with no special handling, beside its own
  microphone rather than instead of it.
- A message can be spoken start to finish without holding anything down, paused and resumed,
  and stopped, on a phone held in one unsteady hand.
- The 3:00 and 5:00 states are reachable in a test without waiting five minutes, because the
  two thresholds are injected rather than hardcoded.
