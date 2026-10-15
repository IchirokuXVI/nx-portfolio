> **PR:** [#731](https://github.com/IchirokuXVI/nx-portfolio/pull/731)

# 0136: a walk that goes on past the freezers

> A fix to the recording screen of `0126`, after the first walk recorded in production.
>
> Needs `libs/luna-shopper/shop-map/recorder/plans/0005` (the guard that hears the
> gyroscope) and backend `0197` (the log's `guard` event). Prerequisite reading: those two
> plans, `0126` in full,
> `libs/velista/feature-shop-map/src/lib/record/walk-recording.ts`, and
> `libs/velista/platform/src/lib/sensors/walk-sensors.ts` and `orientation-stream.ts`.

On 2026-10-08 a Mercadona in Córdoba was walked for eight minutes and the walk stopped
eight times, each time next to the freezers. Recorder `0005` tells that story and
changes the guard: a compass that disagrees alone is a bent compass, and the walk goes
on. This plan gives the recording screen the stream that the guard needs, stops turning
a resumed session by a compass that can be bent, and writes what the guard saw into the
walk log.

## Brief for the agent

### Objective

Feed the gyroscope's heading to the tracking guard while a walk is recorded, turn a
resumed session by the gyroscope when that is possible, and write each decision of the
guard into the walk log as a `guard` event. Use the `nx-portfolio-angular-developer`
skill.

### Context

- **The stream exists.** `listenToOrientation(win, 'game', ...)` in
  `platform/src/lib/sensors/orientation-stream.ts` reads the gyroscope's orientation
  (no magnetometer). The walk lab listens to it. The recording screen listens only to
  `'absolute'` (`walk-sensors.ts`).
- **One clock.** PR #683 stamps poses and the compass on the `performance.now()` clock
  with `onPerformanceClock`. The gyro stream uses the same stamp.
- **A resume today** (`WalkRecording.resumeAt`) turns the new session by the compass:
  the probe's compass offset minus the walk's baseline. With no baseline or no compass it
  lines up by pointing, which means the phone faces the way the mark's arrow shows. The
  three runs out of the Horno mark on 2026-10-08 fan out by about 30 degrees, which is
  what a compass read at a bent spot does to a resume.
- **The camera keeps running through a stop.** The probe reads poses while "Where are
  you?" is open. The gyro stream is not interrupted either, as long as the page is not
  reloaded.
- **What recorder `0005` adds**: `pushGyro`, `state().gyroOffset`,
  `state().compassDisturbed`, the events `compass-disturbed` and `compass-settled`, a
  cause and a number on each `stopped` event, and `alignSession({ rotation })`.

### Target state

1. **The gyro is fed.** `WalkSensorListener` gains `gyro(sample)`, `WebXrWalkSensors`
   listens to the `'game'` stream, and `WalkRecording` passes each sample to the guard
   and to the probe. The scripted walk sensors (`?fakeWalk`) feed it too.
2. **A walk does not stop for the compass** while the gyro is heard. That is the guard's
   work, and this target is its proof on the screen: the scripted walk gains a bent
   compass stretch, and the walk goes through it with no stop and no sound.
3. **A resume is turned in this order** (section 1): by the gyro, then by the compass
   when the pointing agrees with it, then by the pointing.
4. **The log keeps what the guard saw.** A `guard` event is written for each of: a loss,
   a stop with its cause and number, `compass-disturbed` and `compass-settled`. It goes
   in the entry that is open at that moment, and a stop's event goes in its `stopped`
   entry.
5. **Nothing new on the screen.** The pill, the stop panel and the sounds do not change.

### Scope

Work in `libs/velista/feature-shop-map/src/lib/record`, `libs/velista/platform/src/lib/sensors`,
`libs/velista/data-access` (the walk event model and its mapper to the wire), and the
specs of each.

Do not touch: the recorder library, the backend, the walk lab's behaviour, the locale
files, the history and rewind pages.

### Constraints

- **Raw sensor streams are never sent.** A `guard` event carries one kind, one time and
  one number.
- Rule D4: the event has its own model in `data-access` and is mapped to the wire shape.
- At most 50 `guard` events in an entry (backend `0197`). Past that, drop the
  `compass-disturbed` and `compass-settled` pairs first and keep every stop.
- No `@angular/core/rxjs-interop`. Only make changes directly requested.

### Action boundaries

Stop and ask before: adding text, a pill state or a sound to the screen, keeping the
gyro offset across a page reload, or sending this plan to a cluster before backend
`0197`.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and
`npx nx lint` for the touched libraries, `npx nx build velista`, a browser run of the
scripted walk on a slot with the log read back (`GET /v1/catalog/walks/:id/log`)
showing its `guard` events, and the real walk the owner makes (section 2).

## 1. How a resume is turned

1. **By the gyro**, when the stop was in this page visit, the gyro stream was heard from
   the stop until now without a gap of more than 1 s, and the stop was less than 120 s
   ago. The rotation is the stopped session's rotation plus its `gyroOffset` at the stop
   minus the probe's `gyroOffset` now, passed as `alignSession({ rotation })`. At 0.33
   degrees per second of drift, 120 s is 40 degrees at the worst, and the usual stop of
   2026-10-08 lasted 35 to 45 s.
2. **By the compass**, as today, when rule 1 does not apply, the baseline is known, and
   the rotation it gives is within 45 degrees of the rotation that pointing gives.
3. **By pointing**, in every other case. The person was asked to face the way the mark's
   arrow shows, and a person is seldom 45 degrees wrong about that. A bent compass is.

`WalkRecording` records which rule turned the session (a field for the spec to read, not
for the screen).

## 2. The walk the owner makes

The same Mercadona, the same route past the freezers, with this plan on a cluster. What
the log is expected to show: `compass-disturbed` and `compass-settled` events near the
places of the eight stops of 2026-10-08, and no `frame-moved` stop there. A stop that
still happens now names its cause and its number, which is what decides the next change.

Before or during that visit, one walk lab recording of the freezer aisles, for the
fixture that recorder `0005` section 5 asks for.

## 3. Not in this plan

- A notice on the screen that the compass is disturbed. The walk goes on, so the person
  has nothing to do about it.
- Positioning by Wi-Fi access points.
- Mapping without the camera.

## What the build decided

### Where the facts moved since the plan

- **Recorder `0005` changed what it hands over** (PR #726, its section "What the build
  decided"). The turn limit is 60 degrees, and the guard has
  `state().awaitingTurnJudgement`. A yes that comes before the turn rule has answered does
  not vouch for the frame, and any stop while that flag is true carries
  `unconfirmedDropped`. The README's host contract then asks velista to hold the purple
  points past the yes. The plan does not say this, and item 3 below builds it.
- **The walk event model is the shared one.** `WalkEvent` of
  `@portfolio/luna-shopper/shop-map/model` already had `guard` from backend `0197`, and
  `libs/velista/models/src/lib/shop-walks.ts` says that velista uses the shared
  `WalkEntry` because the phone folds it. So `data-access` has no new type of its own.
  It has the alias `WalkGuardEvent`, the kinds `WALK_GUARD_KINDS`, and the read mapper's
  `guard` case. That case is needed: the log is all or nothing, so before it a walk with
  one `guard` event failed to load on the rewind page. A `guard` event that this build
  cannot read (a kind it does not know, or no log time) is skipped, because the fold
  draws nothing from it. Every other event stays all or nothing. Events go to the wire as
  they are, as every other event does. No outward mapper exists, and none was added.
- Backend `0197` has no "What the build decided" section. Its code holds what this plan
  uses: `SHOP_WALK_GUARD_KINDS`, `SHOP_WALK_LIMITS.guardEventsMax` (50), and a gateway
  that forwards the event as it is.
- Every file the plan names is where it says.

### Choices of the build

1. **The gyro offset of a stop is the last trusted one at least 2 s before the stop**,
   not the offset at the moment of the stop. At a `lost` stop the guard has no
   `gyroOffset` (no tracked pose for 3 s). At a `turned` stop the last 2 s are in the
   turned frame. Trusted means `good`, with neither the guard nor velista waiting for a
   judgement. The 120 s limit and the gap rule count from that reading, not from the
   stop, which is stricter by at most 5 s.
2. **The rotation by the gyro is the stopped offset minus the probe's offset.** The
   session guard is fed aligned poses, so its offset already holds the session's
   rotation (recorder `AlignSessionByRotation`). This is the plan's "rotation plus
   gyroOffset at the stop minus the probe's".
3. **A yes before the guard's judgement is held** (`WalkRecording._judging`). The screen
   goes back to walking. The purple points and the points kept after them stay purple and
   unsaved, and the live map does not get them. The log stays at the loss. When the guard
   has judged, the `confirmed` entry and the `resumed` entry are written as before. A stop
   in that window drops them all and ends the walk at the first loss. A second loss does
   not move that point. Stop and leaving the page do the same.
4. **`readyToResume` does not wait for the compass when the gyro can turn the resume.**
5. **The compass rule agrees within `COMPASS_RESUME_AGREES_DEGREES` (45).** The baseline
   a resume derives when the walk has none is unchanged (the probe's offset minus the
   rotation), whichever rule turned it.
6. **Where a `guard` event sits in the log.** A loss and a compass notice carry their own
   log time in the open entry. A stop's event carries the `logTo` of its `stopped`
   entry, which is where the walk now ends (the loss for `lost` and for a dropped
   segment). The stop's own moment is already in the loss event or the entry's time. A
   loss after the first one in a resume keeps its real log time, even when that is later
   than the entry's end.
7. **Numbers.** Degrees are rounded to a tenth and keep their sign, in (-180, 180]. They
   are wrapped after the rounding, so -179.96 is written as 180 and not as -180.
   Metres are rounded to a centimetre. `lost` carries no number. Recorder `0005` item 9
   decided this.
8. **`guard` events wait with the session's points.** A session that adds nothing sends
   none (plan `0129`, target 9). A held event makes the next flush due.
9. **The cap of 50 is applied in `WalkEntrySaver`** (`capGuardEvents`) when an entry is
   sealed or pushed. The compass pairs go first, oldest first, and a `compass-disturbed`
   goes together with the `compass-settled` after it. Then the oldest losses go. `jump`,
   `turned` and `heading` are never dropped, and a stop's event is alone in its entry.
10. **The scripted walk** gives the gyro the walk's true heading plus a zero of 40
    degrees, with no drift. Its bent stretch starts at 72 s, beside the "Horno de pan"
    mark. Over 3 s the compass swings 90 degrees. It holds there for 8 s, then swings
    back over 3 s.
11. **Marks and "Section left" wait with a held yes.** A mark saved while the guard has
    not judged the frame is not drawn or sent yet. The sheet closes as it does for any
    mark, and says nothing about saving. The mark and each "Section left" are held with
    the purple points, in the order they came. When the guard judges the frame good, they
    go to the live map between the points they came between, and they are saved in the
    entry the purple points belong to, before `confirmed`. A stop in that window (turned,
    jump, lost, Stop, leaving the page) drops them with the points. The stop panel then
    says that the walk stopped, and the history shows it kept up to the first loss, as it
    does for the purple path. No copy changed.
12. **A resume by the gyro gets the walk's baseline whenever the walk has one**, also
    when the probe has heard no compass yet (item 4 lets such a resume go). Before the
    fix that guard learned a baseline of its own over 60 s, and a bent compass in that
    minute was not seen.

### Progress evidence

- **Target 1** (`walk-sensors.ts`, `scripted-walk-sensors.ts`, `walk-recording.ts`,
  `record-walk-page.ts`, `shop-map.testing.ts`): `walk-sensors.spec.ts` hears the `game`
  stream next to the compass, on the camera clock.
- **Target 2**: `scripted-walk-sensors.spec.ts` runs the guard over the scripted walk. With
  the gyro, the bent stretch gives one `compass-disturbed`, then one `compass-settled`, and
  no stop. Without it, one `heading` stop. `walk-recording.spec.ts` shows the same at the
  recording, with no tone.
- **Target 3**: `walk-recording.spec.ts`, "how a resume is turned". The gyro is used
  whatever the phone points at. It is not used 120 s after the stop or after a gap of 2 s.
  Pointing is used when a bent compass at the mark disagrees by more than 45 degrees. The
  existing compass resumes report `compass`.
- **Target 4** (`shop-walk-mappers.ts`, `walk-entry-saver.ts`): the specs cover the loss,
  `heading`, `jump` and `turned` events, the cap of 50, the read mapper (an unreadable
  `guard` event is skipped, any other unreadable event is no log), the degrees wrapped
  after rounding, and a session that sends nothing. Under the host contract they cover a
  yes before the judgement in a turned frame, in a good frame, with a second loss, with a
  jump, and with Stop, and a mark and a "Section left" made meanwhile, kept in a good
  frame and dropped in a turned one or on Stop.
- `walk-recording.spec.ts` also covers the 120 s gyro limit at 119 s and 121 s, a gyro
  rotation across 180 and -180, and a gyro resume before the probe heard the compass that
  still weighs the compass against the walk's baseline. `walk-sensors.spec.ts` shows that
  `end()` of the session stops the gyro and the compass listeners.
- **Target 5**: no template, locale or sound file changed.
- `npx nx run-many -t test lint` for `velista/platform`, `velista/feature-shop-map`,
  `velista/data-access` and `velista/feature-walk-lab`: green (three warnings from before
  this plan). `npx nx build velista`: green.
- `velista-luna-e2e` on Luna slot 4 started with `LUNA_REFERENCE_SEED=0`: 8 of 8 pass.
- **Browser walk** of `?fakeWalk=4` at 390 px on that slot. The log read back holds
  `compass-disturbed` at 76.1 s (46.6 degrees) and `compass-settled` at 87.1 s, with no
  stop and no tone between them. It holds a `lost` event at each of the three losses, and
  the guard's stop at 330 s carries `lost` in its `stopped` entry. After the two gyro
  resumes, the kept path lies within 0.53 m and 0.66 m of the script's true path. The
  second resume was into a frame turned by 158.5 degrees. The screenshots and the log
  table: https://claude.ai/artifact/PUVLC5tG3gs15Y1Av6UpWU (private).
- **Not done: the owner's real walk (section 2).** It needs this plan in a cluster and the
  Mercadona of Córdoba. The walk lab recording of the freezer aisles is also the owner's
  to make.
