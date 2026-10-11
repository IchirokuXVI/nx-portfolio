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
