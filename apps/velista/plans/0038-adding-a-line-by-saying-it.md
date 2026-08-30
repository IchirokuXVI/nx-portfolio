# 0038: adding a line by saying it

> **Somebody standing at an open fridge has one hand free and is not going to type.** The
> add button on a list becomes a microphone, they say what is missing, it stops listening
> when they stop talking, and the lines appear. The recording goes to the assistant with
> the zone and the list attached, so it does not have to work out which list anybody meant,
> and on this route it may do nothing to anything else.
>
> Prerequisite reading: `0032` section 4, backend `0041` (the voice endpoint and the format
> question), backend `0044` (the scoped turn this route uses), and backend `0043` (the two
> tools that make "take the bread off" work as well as "add bread").
>
> This plan **depends on backend `0041` and `0044` being built**. It is written now because
> the client half is a shape decision, and because plan `0039` reuses the recorder this one
> extracts.

## 1. What is being built

- **The line composer's button records** when there is nothing typed, and adds when there
  is.
- **A recording ends itself when the talking stops**, which is the part with no precedent in
  this app and the part most likely to be got wrong. Section 4.
- **The audio is posted to the list scoped assistant route** with the zone and list ids, and
  the lines it adds arrive through the ordinary realtime events the page already listens to.
- **The recorder becomes a shared control**, out of the assistant panel, because this is its
  second caller and plan `0039` is its third.

## 2. One slot, two jobs, and the empty field decides

The composer keeps its field, its quantity stepper and its keyboard behaviour. What changes
is the button at the end of the row:

| The field | The button | Pressing it |
| --- | --- | --- |
| empty | a microphone | starts recording |
| has anything typed in it | the plus it is today | adds the line, as today |
| recording | a stop square | ends the recording early |

**The field's emptiness is the switch**, not a mode the person selects. That is the same
rule `0032` section 4.1 settled for the assistant composer, arrived at there for the same
reason: two buttons side by side, one of which is always inert, is a row of controls that
have to be read before either can be used, and this row already carries a stepper.

It also keeps the property `0012` says the composer exists for. **Adding happens in runs**:
six things in a row, the field keeps focus, the keyboard never comes down. Somebody typing
never sees the microphone, and somebody speaking never has the keyboard open. Neither mode
interrupts the other.

**A press, not a hold**, as in `0032` section 4.2. Hold to talk needs a steady hand on a
phone that is being held one handed in a kitchen, and it has no accessible equivalent.

### 2.1 It is absent without `WRITE`, exactly as the composer is

The composer is not rendered at all for somebody who may not write (`0030`), and the
microphone inherits that by being inside it. There is no separate check and there must not
be: a second condition for the same fact is a second place for it to disagree.

## 3. The context goes with the audio

The request carries `zoneId` and `listId` from the route, and the server scopes the turn to
that list (backend `0044`). Two things follow, and both are the point of doing it this way:

- **The turn never has to resolve a list.** Plan `0039` section 6.1 resolves in four steps
  and ends by asking a question when it cannot. On this route the answer is in the request,
  so the ambiguous case does not exist and the reply is never a question about which list.
- **The turn cannot touch anything else.** Not another list, not the account, not the
  username. That is enforced by the tool catalog the server assembles for a scoped turn, not
  by anything the client sends, which is the only place it can be enforced. The client's job
  is to state the scope truthfully.

## 4. Knowing when somebody stopped talking

This is the piece with no precedent here. The assistant panel's recorder starts and stops on
presses. This one has to end itself, because the person's hands are busy and that is the
whole reason they are speaking.

**Silence detection over the live stream, not over the recorded file.** An `AnalyserNode` on
the same `MediaStream` the recorder is using, sampled on an animation frame, reading a short
running average of the signal level. The file is never inspected: by the time there is a file
the moment to stop has passed.

Four numbers, and every one of them exists because leaving it out produces a specific
failure:

| | | Without it |
| --- | --- | --- |
| **lead in** | a grace period before silence can end anything | people press and then draw breath, and the recording ends before the first word |
| **silence to stop** | how long quiet has to last | too short and it cuts between "half a dozen" and "eggs"; too long and the person is standing there wondering |
| **minimum length** | a floor under the whole recording | a press that catches a quiet moment sends an empty file to a paid provider |
| **hard cap** | an end regardless | a microphone left open in a kitchen is a bill and a privacy problem |

The values are **injected**, as `0032` did with `DICTATION_LIMITS`, and for the same stated
reason: both interesting states have to be reachable in a test without waiting in real time.
Sensible starting points are a lead in of about a second, silence of about a second and a
half, a minimum of about a second, and a cap of thirty seconds. The cap is much shorter than
the assistant panel's five minutes because this is one sentence about a shopping list, and a
shorter cap keeps every recording comfortably inside backend `0041`'s byte limit without the
client having to think about bytes at all.

**The threshold is relative, not absolute.** A kitchen with a extractor fan running has a
noise floor nothing absolute can be tuned for. The first part of the lead in measures the
room, and silence means quiet relative to that. Getting this wrong in the safe direction
means the recording runs to its cap and the person presses stop, which is a mild annoyance;
getting it wrong in the other direction means the app cuts people off mid sentence, which is
the failure that makes a feature unusable.

**Stop is always available.** The button becomes a stop square while recording, so the
detector is a convenience over a control and never the only way out.

### 4.1 What is on screen while it listens

The row it replaced, plus the least that is honest:

- the button, now a stop square, in the accent it uses for a live state;
- a level indicator that moves with the voice, because the single most common failure of a
  voice control is that the microphone was not actually picking anything up, and a still
  meter says that before the transcript does;
- nothing else. No waveform, no timer counting to a cap nobody should reach. The assistant
  panel's clock earns its place at five minutes; a thirty second cap does not.

## 5. What comes back, and where it goes

The response is the same `AssistantTurnResponse` a typed turn produces, with `heard` (backend
`0041` section 3.1). The page shows both, in a strip above the composer:

- **what was heard**, because mishearing is the characteristic failure of a voice interface
  and an action you cannot see is an action you cannot check;
- **the assistant's sentence**, which is the answer when nothing was written, the
  confirmation when something was, and the question when the request was not one this route
  can act on.

The strip is `aria-live="polite"`, it is dismissible, and it is replaced by the next
recording rather than accumulating. This is not a chat. Somebody who wants a conversation
has the assistant panel, and this page has a list.

**The lines themselves arrive on their own.** The assistant writes through the gateway with
the caller's token, core emits the ordinary line events, and this page is in the room, so the
new rows appear through exactly the path a line added from another phone already takes. The
client does not merge the response into the list, and it must not: two paths writing the same
row is how a duplicate appears and then disappears.

**There is no undo, and none is needed.** A line the assistant misheard is an ordinary line,
and the row menu deletes it in two taps. Building an undo for one write path when every other
path has none would be the odd thing.

## 6. What can go wrong, and what each one says

Everything is said in the strip, in words. Nothing here is a banner or a dialog.

| What happened | What the person gets |
| --- | --- |
| microphone permission refused | a sentence saying the app cannot hear, and how to give permission back |
| no microphone on the device | a different sentence, because it reads differently and there is nothing to fix |
| the browser cannot record at all | the microphone is not drawn; the plus is the only button |
| nothing was heard | "I did not catch that", and no turn is run against an empty message |
| the provider is rate limited | `0032` section 3.1's countdown, in the strip, in seconds |
| the request was not about this list | the assistant's own refusal, relayed as written |
| the connection is down | the ordinary failure; the recording is not queued, and the strip says it did not send |

**A recording is never queued for later.** There is no offline queue in this app (`0001` D6),
and a shopping list line that arrives twenty minutes later, after the person has already
added it by hand, is worse than one that never arrived.

## 7. The recorder moves out of the assistant

Three callers by the end of the next plan, so it stops living in the assistant panel:

| Piece | Where it goes |
| --- | --- |
| the capture, `MediaRecorder` behind a token | `platform`, where `SPEECH_CAPTURE` already is |
| the silence detector | `platform`, beside it, because it is a fact about a stream |
| the recording control, button plus level plus states | `ui`, as a component with inputs and outputs and no service |

Rule D1 holds through the move: the control takes its state as inputs and emits a recording,
and the pages own the posting. What the assistant panel keeps is its own composer, its clock
and its pause button, which are the things `0032` argued for specifically and which this page
does not have.

**The move happens when this plan is built, not before and not in a separate refactor.** A
shared component with one caller is a guess about the second one.

## 8. What is tested

- **The switch**: an empty field draws a microphone, typing one character draws the plus,
  clearing it draws the microphone again.
- **The detector**, against a fake stream driven by hand: it does not stop during the lead
  in; it stops after the configured silence; it never sends a recording under the minimum; it
  stops at the cap. These are the four numbers, and each one is a test.
- **The request**: the zone and list from the route are on it, and the recording is sent as
  the negotiated content type rather than a hard coded one.
- **The strip**: `heard` is shown, the reply is shown, a rate limit shows a countdown, and a
  second recording replaces the first rather than appending.
- **No merge**: a successful response does not add a row to the list on its own.
- No spec reaches a real microphone, a real `MediaRecorder` or the network, which is the same
  rule `0032` section 11 set for the panel.

## 9. Exit criteria

- With nothing typed, the list composer's button records; with something typed, it adds.
- A recording ends within about a second and a half of somebody finishing a sentence, and
  never during one.
- The zone and the list on the request are the ones the page is showing.
- Lines added by voice arrive through the realtime path, exactly as lines added elsewhere do.
- What was heard is on screen beside what was done.
- A refused microphone, a silent recording and a rate limited provider each produce a
  different sentence, and none of them produces a dialog.
- The assistant panel's own recorder still passes its existing tests after the move.
