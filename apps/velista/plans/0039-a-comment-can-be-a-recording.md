# 0039: a comment can be a recording

> **Say it instead of typing it, and it stays said.** A comment on a line can be a voice
> message: it is recorded, uploaded, kept, and playable by anybody who can read the line, and
> it is transcribed so it can be read without being played.
>
> This is the one voice feature in the product where the audio is **kept**. The assistant's
> recordings are held for the length of a turn and never written down (backend `0041` section
> 6); a voice comment is a message somebody left for the people they shop with, and a message
> that is deleted the moment it is understood is not a message.
>
> Prerequisite reading: `0027` (the comments panel as it stands), plan `0038` (the recorder
> this reuses and the silence detection it does not), and backend plan `0045`, which owns
> storage, the upload and the transcription.

## 1. What is being built

- **A microphone in the comment composer**, beside the field rather than instead of it.
- **A player in the comment row**, for a comment that has a recording.
- **The transcript as the comment's body**, so a voice comment reads in the thread like every
  other comment and can be understood in a quiet room without headphones.

## 2. The composer keeps its field and gains a button

Not the empty field switch that plan `0038` gives the line composer. **Both controls are
present at once.**

The line composer's button has one job at a time because the row is already crowded with a
stepper and because adding a line is a single act with one output. A comment is a message,
and the choice between typing one and speaking one is a choice about the message rather than
about the field being empty. Somebody who starts typing, stops, and decides to say it instead
should not have to clear the box to find the microphone.

So the composer is: the textarea, the microphone, the send button. Three controls, and the
gap between them is the one plan `0037` widened.

While recording, the microphone becomes a stop, and the field is dimmed rather than removed,
because removing it would move the send button under the thumb that is about to press stop.

### 2.1 No silence detection here

Plan `0038` ends a recording when the talking stops, because the person has their hands full
in front of a fridge. Here the person is holding the phone and looking at the screen, and a
message is not one sentence: somebody leaving a comment pauses to think, and a detector that
ends the recording during that pause has cut them off mid message with no way to continue.

**Press to start, press to stop**, and a hard cap. The cap is the one thing shared with
`0038`, and it is longer here, because a message is longer than a line. Sixty seconds is the
starting value: it is well inside backend `0041`'s two megabyte ceiling at a speech grade
bitrate, and a voice message longer than a minute on a shopping list is a phone call.

The cap **stops** rather than sends, which is `0032` section 4.4's rule and the reason for it
is the same: a message that leaves on its own is a message nobody agreed to send.

## 3. A voice comment is a comment

The most important decision in this plan, and it is a decision to add as little as possible.

**The transcript is the comment's body.** Not a caption beside it, not a second field, not
something revealed by pressing a button. A voice comment lands in the thread as text, in the
same bubble, in the same order, read by the same row component, and it carries a recording
that can be played.

What that buys:

- The thread is readable in a shop, on a bus, in a meeting, without headphones and without
  playing anything.
- Everything already built keeps working. `0027`'s chat shape, the newest first order, the
  timestamp, the author fallback for somebody who left the group.
- There is one body field on the wire and one place a comment's text comes from.

What it costs: a transcription can be wrong, and the wrong words are then the comment. That is
why the recording is kept and the player is on the row. **The audio is the record and the
transcript is the reading of it**, which is the honest arrangement and the reason a voice
message that is only transcribed would not be acceptable.

When transcription produced nothing, the row shows a neutral phrase in place of a body rather
than an empty bubble, and the player is still there. A recording nobody could transcribe is
still a message somebody left.

## 4. The player

Inside the existing bubble, under the body:

- one press to play, one to pause;
- the length, in seconds, before it is played and while it plays;
- a progress bar that can be scrubbed;
- **one at a time**: starting one stops any other, because two comments talking over each
  other in a thread is never what anybody meant.

Three rules that are easy to get wrong:

- **Nothing preloads.** A thread with fifteen voice comments must not fetch fifteen files
  because somebody opened it. The audio is fetched when it is played, and the length comes
  from the comment rather than from the file, so the row can be drawn correctly before
  anything is downloaded.
- **The element is created when it is first played**, not per row on render. Fifteen `audio`
  elements in a scrolling list is fifteen media resources the browser is managing for no
  reason.
- **It is reachable by keyboard and named for a screen reader.** Play, pause and the position
  are the three things it has to say, and the position has to be announced politely rather
  than on every tick.

The player is a `ui` component with a source and a duration as inputs and nothing else. Rule
D1: it does not know what a comment is, and it certainly does not know about the API.

## 5. Sending one, and the wait that is now real

A typed comment is one fast request and `0027` deliberately does not make it optimistic: the
response is upserted, the socket delivers the same comment again, and the two converge with
nothing racing.

A voice comment is different in one way that matters. **It takes seconds**: an upload over
mobile data, then a transcription at the provider. The composer sitting there disabled for
four seconds with no bubble on screen reads as a failure, and people press again.

So, for a voice comment only, **a pending bubble**. It appears the moment sending starts, in
the caller's own position, saying that a recording is being sent, and it is replaced by the
real comment when the response lands or removed when it fails. It never shows a guess at the
words: the client has nothing to guess from, and a bubble showing invented text is worse than
one showing that it is waiting. That is backend `0041` section 8.4's rule, arrived at there
for the assistant panel and true here for the same reason.

The typed path is untouched. One request with nothing racing it does not need a bubble that
can be wrong.

## 6. What can go wrong

| What happened | What the person gets |
| --- | --- |
| microphone refused, or absent | the same two sentences as plan `0038`, and the field still works |
| the browser cannot record | no microphone is drawn; the composer is exactly what it is today |
| the recording is over the byte cap | said in words with the limit in it, and the recording is kept in the composer so it can be sent after trimming rather than lost |
| the upload failed | the pending bubble goes, the recording is kept, and the send button can be pressed again |
| transcription failed but the audio was stored | the comment exists, plays, and shows the neutral phrase |
| the whole thing failed | no comment, one error line, and the recording is still there |

**A failed send never discards the recording.** Somebody just spoke for forty seconds. Losing
that to a dropped connection is the worst outcome in this plan and it is entirely avoidable:
the blob is held in the composer until a send succeeds.

**A recording is not queued for later**, for `0038` section 6's reason. Held and retryable by
hand is not the same as sent automatically twenty minutes later.

## 7. Who can leave one, and who can play one

Unchanged from `0030`. Commenting needs `WRITE` or `DECIDE`, and the composer is not drawn
without it; reading a line's comments needs `READ`, and playback is reading. There is no
separate permission for voice, and adding one would be inventing a distinction the product
does not make.

## 8. What is tested

- **The composer** draws all three controls, records on press, stops on press, and stops at
  the cap without sending.
- **A failed send keeps the recording**, which is the assertion that matters most in this
  plan.
- **The pending bubble** appears for a voice send, is replaced on success, is removed on
  failure, and never contains invented text.
- **The row** draws a player only when there is a recording, shows the neutral phrase when the
  body is empty, and does not create a media element until play is pressed.
- **One at a time**: playing a second comment stops the first.
- **The transcript is the body**, so the existing comment row specs cover a voice comment
  unchanged, which is the cheapest evidence that section 3's decision was the right one.
- No spec touches a real microphone, a real media element's network, or the wire.

## 9. Exit criteria

- A voice comment can be left, is played back by somebody else, and reads as text without
  being played.
- A thread of voice comments downloads nothing until something is played.
- A dropped connection during a send loses no recording.
- A comment whose transcription failed still plays and still reads as a message rather than as
  an empty bubble.
- Nothing about the typed comment path changed.
