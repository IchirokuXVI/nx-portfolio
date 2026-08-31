# 0041: one recorder, and a trash beside it

> **Recording a comment and recording a message to the assistant become the same control.**
> One button on the right, which is a microphone on an empty field and a send on a typed
> one; while it records, the field is replaced by a trash on the left, the length in the
> middle and a stop on the right. Stop sends. The trash is new, in both places, and it
> takes the position pause held.
>
> This plan **reverses three decisions on purpose**, and says so where each one was made:
> `0039` section 2 put the microphone beside the field rather than in the button, `0039`
> section 2 held a finished recording for a second press, and `0032` section 4.3 put pause
> at the far left. All three were argued for; the argument this replaces them with is that
> there is one way to record in this product and it should be one control.
>
> Prerequisite reading: `0032` section 4 (the assistant composer, which is the shape being
> adopted), `0039` (the comment recorder being replaced), and `0038` section 7, whose
> extraction this plan performs a plan early because it now has its second caller.

## 1. What is being built

- **A recording control in `ui`**, the row of trash, dot, length and stop, taking its state
  as inputs and emitting two things: a stop and a discard.
- **The comment composer switches to `AudioRecorder`** and to the one button, three jobs
  rule, and loses its own clock, its own capture handle and its held state.
- **The trash replaces pause and resume** in both composers, with the colours redrawn so
  the destructive control is the red one and the committing control is the amber one.
- **Two different caps**, injected, because a comment is a minute and a message to the
  assistant is five.
- **The voice comment player made visible**, which is a two line stylesheet fix to a bar
  that has never been drawn, and **a line saying the transcript was written by a machine**.
  Section 9. Both belong here rather than in a plan of their own: they are the playback half
  of the same feature, and the second one is what `0039` section 3 owed the reader.

## 2. Why the comment composer changes at all

`0039` section 2 argued that both controls should be present at once: the choice between
typing a comment and speaking one is a choice about the message rather than about whether
the field is empty, and somebody who starts typing and changes their mind should not have to
clear the box to find the microphone.

That is still true as far as it goes, and it is outweighed by what the product actually
looks like now. There are two places in this app where you can speak, they sit two taps
apart, and they behave differently: one has three controls and one has two, one holds the
recording and one sends it, one dims the field and one replaces it. Somebody who learns the
assistant's microphone has learned nothing about the comment one. The cost `0039` was
avoiding is one keystroke on a rare path; the cost it accepted is a second control scheme
for the same act, on every path.

So the comment composer takes the assistant's rule exactly:

| The field          | The button   | Pressing it                      |
| ------------------ | ------------ | -------------------------------- |
| empty              | a microphone | starts recording                 |
| has anything typed | a send       | sends what is typed              |
| recording          | a stop       | ends the recording, and sends it |

Nothing moves under the thumb across those three, which is the property `0032` section 4.1
named and the reason it is worth copying rather than reinventing: the finger that started a
recording ends it without travelling.

**The textarea stays a textarea.** The comment composer's field is two rows and wraps
because a comment is a sentence about a line rather than a line; the assistant's is a single
line input. That difference is about what is being written and it survives. What is adopted
is the button, not the box.

## 3. Stop sends

`0039` section 2 held the recording: stop produced a held blob, a line saying "a 12s
recording, ready to send", and a second press on send actually sent it. The reasoning was
`0032` section 4.4's, that a message which leaves on its own is a message nobody agreed to
send.

**That rule is about the cap, not about the button.** A recording that ends because a timer
ran out was never agreed to; a recording that ends because somebody pressed stop was. The
assistant has sent on stop since it was built (`0032` section 12: for this audience an
accidental stop is a sent message with no way back, and a confirm step would tax every
message to protect the rare one), and the check it offers instead costs no press, which is
seeing what the service heard appear as your own bubble. A voice comment already has that
check: the pending bubble `0039` section 5 built is replaced by the real comment with its
transcript in it.

So stop sends, the held state goes, and with it `heldSeconds`, the `recordingHeld` string
and the branch in `submit()` that chose between a held blob and typed text.

**The cap still does not send.** At the cap the recorder enters `stopped`, which is a hold:
recording has ended, the length stays on screen, a line says so, and the two controls left
are the trash and the stop. That is the assistant's behaviour today and it is what "at some
point the audio must be stopped" means here. The distinction is worth stating in one line
in the code, because the two readings of "stop" are a step apart: **the cap stops the
recording, the person stops the message.**

## 4. The trash

Pause and resume leave both composers. Nothing replaces them, and the trash is not their
replacement in function: it is what the recording row was missing.

Without a trash, every recording that was started has exactly one exit, which is to be sent.
Somebody who pressed the microphone by accident, or started talking and thought better of
it, or was interrupted, has to send it and then delete it, and on a comment that means
sending a message to the people they shop with before they can withdraw it. Pause, in the
same position, only ever deferred that.

- **It sits at the far left**, where pause was, with stop at the far right and the length
  between them. That distance is the safeguard, and it is exactly the argument `0032`
  section 4.3 made for keeping those two controls apart: they are the only two controls on
  screen and confusing them costs the whole message.
- **It is enabled in every recording state**, including `stopped`. Pause was disabled at the
  cap so that stop was the only way out; a trash disabled at the cap would mean the one
  recording somebody most wants to throw away, the five minute one, is the one they cannot.
- **No confirmation.** This product confirms deletions that other people can see (`0010`,
  the confirm sheet), and a recording that has not been sent is not one of those. A dialog
  over a recording in progress is also a dialog over an open microphone, which is a state
  nothing else in the app produces.
- It cancels the recorder, which releases the microphone and clears the clock, and returns
  the composer to its field with whatever was typed in it still there.

`AudioRecorder.pause()` and `.resume()` **stay on the class**. They are how the cap holds a
recording without discarding it, `_tick` calls `pause` on the session directly, and removing
them would mean writing that hold a second way. What goes is any control that calls them.

## 5. The colours, which have to move together

Today the recording row is: an outlined neutral pause on the left, a red dot, the length,
and a red filled stop on the right. Red on stop was right when stop was the only thing that
ended the recording, under the rule that stop is the one control in the app that ends
something in progress.

With a trash on screen that reading breaks, because there are now two controls that end the
recording and only one of them destroys anything. So:

|       | today                                   | after                                                                | why                                                             |
| ----- | --------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| trash | (pause) outline, `--app-text-secondary` | outline `--app-status-danger-border`, glyph `--app-status-danger-fg` | the destructive one is the red one, everywhere else in this app |
| stop  | filled `--app-status-danger-fg`         | filled `--app-action-bg`, glyph `--app-text-on-action`               | it is the send now, and the send is amber                       |
| dot   | `--app-status-danger-fg` when live      | unchanged                                                            | it means recording, which is what a red dot means everywhere    |

**Never colour alone**, which is `0002`'s rule and the reason this is safe: the trash is the
only bin glyph, the stop is the only square, and the dot is not a control. Somebody who
cannot tell the red from the amber still has three distinct shapes.

The comment composer's `.mic.recording` block, which turned the microphone into a red
outlined stop, is deleted along with the microphone that sat beside the field.

**There is no trash glyph in `libs/velista/ui/src/lib/icons`.** It is added there, as the
forty third, following the same pattern the other forty two do. Not from `@portfolio/shared/ui`: velista
draws its own icon set and imports none of the shared ones, and adding the first cross
library icon dependency for one glyph would be a new coupling for no gain.

## 6. One control, two callers

`0038` section 7 said the recording control leaves the assistant panel when it has its
second caller, and that a shared component with one caller is a guess about the second one.
It has its second caller now, so the extraction happens here rather than in `0038`.

**`RecordingRow` in `ui`**: inputs for the state, the elapsed string and whether the cap has
been reached; outputs `stop` and `discard`. It injects nothing and knows nothing about
`AudioRecorder`, per rule D1, so the assistant panel and the comments sheet each own their
own recorder and hand it down. What stays behind in each composer is its own field, its own
placeholder and its own submit.

### 6.1 It is a default, not a cage

The two callers are alike enough today to share a component and they are **not** guaranteed
to stay that way: one lives in a panel that is the whole screen and one in a sheet under a
conversation, and a difference that shows up later must not force a fork or a boolean named
after a caller. So the component is drawn to be adapted from outside, along three axes and
no more:

- **Labels are inputs, not literals.** Every string it renders is a translation key handed
  in, including the two on the buttons. The component holds no copy of its own, which is
  also what lets the assistant say "press stop to send it" where a comment sheet says
  something shorter.
- **The middle is a slot.** Trash, then `<ng-content />`, then stop. What sits between the
  two controls is the caller's: today both pass the dot and the length, which the component
  offers as a small `RecordingElapsed` piece so neither has to redraw it, and a caller that
  later wants a level meter there (`0038` section 4.1 asks for one) adds it without touching
  this file.
- **The notice above it is the caller's too.** The warning and the cap message grow the
  container and sit at the top of it (`0032` section 4.4), and they are already written
  per composer because the sentences differ. They stay outside `RecordingRow`, which starts
  at the row.

What is deliberately **not** configurable is the geometry: trash on the far left, stop on
the far right, as far apart as the container allows. That is the safeguard section 4 rests
on, and a caller that wants them closer together wants a different component.

The rule this follows is the one `0038` section 7 stated for the move: the control takes its
state as inputs and emits, and the pages own the posting. A caller needing something this
shape cannot express should extend the inputs rather than reach inside it, and if two
callers ever need genuinely different rows, the honest answer is two components rather than
one with a mode.

**The comment composer starts injecting `AudioRecorder`** instead of `AUDIO_CAPTURE`
directly, which deletes the `setInterval` clock, the `_session` handle, the `_held` signal
and the destroy hook that closed the session. All four exist on `AudioRecorder` already, and
its clock is better than the one being deleted: it accumulates across open segments, so a
tick that fires late or a tab that was backgrounded corrects itself instead of drifting.

`AudioRecorder` is `@Injectable()` and not root provided, which is what makes this work: the
comments sheet provides its own, so leaving the sheet releases the microphone, and a recorder
open in a comment cannot collide with one open in the assistant.

### 6.2 Two caps, one token

`RECORDING_LIMITS` is already injected and already defaults to `{ warnAtSeconds: 180,
maxSeconds: 300 }`, which is the assistant's. The comments sheet provides its own beside its
recorder:

```ts
providers: [
  AudioRecorder,
  { provide: RECORDING_LIMITS, useValue: { warnAtSeconds: 45, maxSeconds: 60 } },
],
```

Sixty seconds is `VOICE_COMMENT_MAX_SECONDS`, which already exists in
`@portfolio/velista/models` and is what the composer counted to; the value moves from a
constant the composer read to a value the token carries, and the constant stays as the
single source of the number. Forty five is fifteen seconds of warning, which is the same
proportion the assistant gives at five minutes rounded to something a person can act on.

The warning copy is the assistant's, reused: it grows the container and says how long is
left, and at the cap it says the recording has stopped and to press stop to send it. Both
strings are per composer, because "you have 15 seconds left" and "you have 2 minutes left"
are the same sentence but the sheet they appear in is not.

## 7. What a failed send does, which is the one thing that is not identical

The assistant throws a failed turn away: the recording is gone, a `failed` bubble says so,
and the person speaks again. That is right for a turn, which is ephemeral by design.

It is wrong for a comment, and `0039` section 6 was emphatic about why: somebody just spoke
for forty seconds, and losing that to a dropped connection is entirely avoidable. **That rule
survives this plan unchanged**, and it is the reason the held state can go without the blob
going with it:

- stop sends immediately, and the pending bubble appears;
- if the send fails, the pending bubble is removed, the composer **keeps the blob**, and the
  error line gains a "Send again" button that sends the same recording;
- starting a new recording replaces the kept one, because two recordings in one composer is
  a state with no control to resolve it;
- the trash, pressed while a failed recording is being held, throws it away.

So the recording is still never discarded by a failure. What changed is that holding it is
now the exception rather than the normal path, and it is visible as a retry on an error
rather than as a "ready to send" line on the happy path.

The byte cap check goes the same way. At 24 kbps a sixty second recording is about 180 KB
against a 2 MB ceiling, so an over sized comment now means the browser ignored the bitrate
entirely; it stays a check because a failure that says "too big" is better than one that says
nothing, and it lands as a failed send with the recording kept, which is where every other
failure lands.

## 8. What is tested

- **The switch**, in the comment composer: an empty field draws a microphone, one typed
  character draws the send, clearing it draws the microphone again, and recording draws the
  stop over both.
- **Stop sends**: one press emits the recording, and there is no state in which a second
  press is needed.
- **The cap does not send**: at `maxSeconds` the recorder is in `stopped`, nothing has been
  emitted, and both the trash and the stop are enabled.
- **The trash discards**: it emits no recording, it releases the capture session, and the
  typed text is still in the field afterwards.
- **The two caps are the injected ones**, asserted by providing a two second limit in the
  spec rather than by waiting, which is the reason `RECORDING_LIMITS` is a token at all.
- **A failed send keeps the recording** and the retry sends the same blob. This is the
  assertion `0039` section 8 called the one that matters most in that plan, and it has to
  keep passing across the change that removed the state it used to be held in.
- **The assistant panel's existing recorder specs pass after the extraction**, which is
  `0038` section 9's exit criterion arriving with the extraction it belongs to. The ones
  asserting pause and resume are deleted rather than adapted: the control is gone, and a
  spec for a control that does not exist is a spec that will be read as a requirement.
- **The auto transcript note** is drawn when `transcription` is set, is absent on a typed
  comment, and is absent on both neutral phrases.
- **`RecordingRow` takes its labels from inputs**, asserted by rendering it with two
  different sets and finding both, which is the cheapest guard against a literal creeping
  back into a shared component.
- No spec touches a real microphone, a real `MediaRecorder` or the network.

The invisible track is the one thing here a spec cannot hold: jsdom computes no layout, so
`getBoundingClientRect` answers zero for a bar that works and zero for one that does not.
The guard is the comment in the stylesheet saying why `box-sizing` is overridden locally,
and a look at the running app. Writing an assertion that passes either way would be worse
than writing none, because it would be read as cover.

## 9. The player, which is built and cannot be seen

`AudioPlayer` is `0039` section 4 in full: play and pause on one button, the length before it
plays and the position while it does, a scrubbable track, one player at a time, nothing
fetched until play is pressed, and no media element created per row. The transcript as the
body is done as well, with both neutral phrases, and so is the pending bubble that makes
section 3 safe.

**The track is nonetheless invisible, and it has been since it was written.** In
`audio-player.scss`:

```scss
.track {
  block-size: var(--app-audio-track-size); // 6px
  padding-block: var(--app-space-2); // 4px, twice
  background-clip: content-box;
}
```

`apps/velista/src/styles.scss` sets `box-sizing: border-box` on everything, so `block-size`
is the **outer** height. Six pixels of box minus eight pixels of padding leaves a content
box of zero, and `background-clip: content-box` paints the track's background only inside
that content box. So the bar is drawn nowhere, and `.fill`, whose `block-size: 100%`
resolves against the same zero, is drawn nowhere either. What is left on screen is a round
play button and an 11px clock with a gap between them, which reads as a control that has no
progress bar rather than as one whose progress bar failed, and that is why the feature was
missed rather than reported.

The intent in that file is unambiguous and the two comments beside the rule say it: six
pixels of visible track, with padding making a hit area "generous without a generous
appearance". The fix is to make `block-size` mean what it was written to mean:

```scss
.track {
  box-sizing: content-box;
  block-size: var(--app-audio-track-size);
  padding-block: var(--app-space-2);
}
```

Six pixels of bar inside a fourteen pixel target, which is what was designed. `content-box`
rather than a larger `block-size`, because the number in the token is the bar and the
padding is the reach, and collapsing them into one figure loses which is which.

This is worth one line of comment in the file. A local `box-sizing` override against a
global reset is exactly the kind of thing a later reader deletes as redundant, and deleting
it puts the bar back to zero.

### 9.1 The clock

`--app-text-2xs` is 11px, and the file's own comment on the token says "dense metadata
only, never body copy". The timestamp in a comment's header is dense metadata; the length
of a recording sitting beside the control that plays it is a number somebody is trying to
read before deciding whether to press play, and it is the only text in the row.

It goes to `--app-text-xs`, 12px, which is the token described as "timestamps, helper text"
and is what the comment header's author line already uses. It stays `tabular-nums` and it
stays muted. This is a small change and it is made because the row has been sized as though
the bar were carrying most of the width, and once the bar is visible the clock is a
label beside it rather than the only thing to look at.

### 9.2 The transcript says it was written by a machine

A voice comment's body is a transcript, and nothing on screen says so. That matters more
here than in the assistant panel, because of what `0039` section 3 decided: the transcript
**is** the comment, in the same bubble as everything somebody typed, in the same order and
the same type. Read cold, a transcription error is indistinguishable from somebody in your
group having written something odd, and it is attributed to them by name.

`0039` section 3 acknowledged the cost and answered it with the recording: the audio is the
record and the transcript is the reading of it. That answer only works if the reader knows
which one they are looking at.

So a voice comment carries a short line between its body and its player, in the quiet
`.waiting` treatment the two neutral phrases already use: **"Written automatically from the
recording"**, and "Escrito automáticamente a partir de la grabación". A new key,
`list.comments.autoTranscript`.

- **It is drawn from `transcription !== null`**, which `CommentRowVm` already carries and
  which is documented as null exactly when the comment was typed. No new field, and no
  inferring it from the presence of a recording.
- **It is not drawn for the two neutral phrases**, which already say the transcript is
  missing or still coming; saying a machine wrote the sentence that says no machine could
  write it would be nonsense.
- **It is not a warning.** No icon, no colour, no `role="alert"`. It is a fact about where
  the words came from and it reads as one.
- **It stays out of the author line**, which is short, ellipsised and shared with the
  timestamp.

The player still sits below it, which keeps the reading order right: this is what was said,
this is where the words came from, here is the recording itself.

### 9.3 The consequence of section 3

With no held state, `list.comments.recordingHeld` and `list.comments.recordingPlaceholder`
have nothing left to describe and are removed from both locale files.

## 10. Exit criteria

- Recording a comment and recording a message to the assistant look the same, control for
  control, in the same positions.
- With nothing typed, the comment composer's button records; with something typed, it sends;
  while recording, it stops.
- Pressing stop sends the recording, with no second press anywhere.
- A recording can be thrown away from either composer, at any point including the cap, in one
  press.
- The red control is the one that destroys and the amber one is the one that sends, in both
  composers.
- A comment recording stops at a minute and an assistant recording at five, and both say so
  before they get there.
- A send that fails still leaves the recording where the person can send it again.
- A voice comment's progress bar is visible before it is played, fills as it plays, and can
  be dragged.
- A voice comment says its words were written automatically, and a typed one says nothing of
  the kind.
- `RecordingRow` is used by two composers with different strings and different caps, and
  neither of them needed to change it to get what it wanted.
