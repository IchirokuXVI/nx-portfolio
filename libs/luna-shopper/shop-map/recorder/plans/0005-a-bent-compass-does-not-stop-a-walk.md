> **PR:** [#726](https://github.com/IchirokuXVI/nx-portfolio/pull/726)

# 0005: a bent compass does not stop a walk

> Fifth plan of the recorder library. It changes the tracking guard of `0003`.
> Consumed by velista `0136`, which feeds the new stream and writes what the guard saw
> into the walk log, and by backend `0197`, which lets the log hold it.
>
> Prerequisite reading: `0003` in full, `src/lib/tracking-guard.ts` and its spec, the
> `game` stream of `0002`, and
> `libs/velista/platform/src/lib/sensors/orientation-stream.ts` (where that stream
> comes from in a browser).

The first walk recorded in production is the reason for this plan. On 2026-10-08 a
Mercadona in Córdoba was walked for eight minutes, and the guard stopped the walk eight
times. Each stop had the reason `frame-moved`. None had `tracking-lost`.

The stops repeat by place. Six are inside one spot about 6 m wide, to the left of the
Horno mark, and two are 6 to 8 m past the Arroz mark. Each one came while the person
walked the same way into that spot, and four came 10 to 16 s after a resume. The person
says those places are the freezers. The kept path is smooth up to each stop: no kept step
is longer than 0.75 m, and the jump rule needs 2 m.

A camera fault does not repeat by place. A magnetic field bent by steel cabinets and
their motors does. The guard of `0003` compares the compass with the camera and, when
they disagree, decides that the camera frame moved. Next to a freezer the compass is the
one that moved.

The log cannot prove that reading, because a `stopped` entry keeps only its reason. This
plan makes the guard say what it saw, so velista `0136` can write it down.

## Brief for the agent

### Objective

Give the tracking guard a third heading, the gyroscope's, so that it can tell a camera
frame that turned from a compass that turned. A compass that disagrees alone no longer
stops a walk. Make each decision of the guard carry its cause and its numbers.

### Context

- **The three headings.** The camera heading (`cameraHeading`) is exact but its frame can
  turn after a loss. The compass heading (`compassHeading`, the `absolute` stream) has a
  fixed frame but magnets bend it. The gyro heading (the `game` stream: gyroscope and
  accelerometer, no magnetometer) is not bent by magnets, and it drifts slowly.
- **How much the gyro drifts.** On 2026-09-28 the `game` yaw drifted about 100 degrees in
  5 minutes against `absolute`, which is 0.33 degrees per second. Over a window of a few
  seconds that is 1 to 3 degrees. So the gyro is a good witness over seconds and a bad
  one over minutes.
- **What a real frame turn looks like.** On 2026-09-29 tracking was lost for 1.5 s and the
  camera came back in a frame rotated by 158.5 degrees. Camera minus gyro heading steps
  by that much between the last pose before the loss and the first poses after it.
- **What a bent compass looks like.** Compass minus camera heading leaves the baseline
  while camera minus gyro heading stays where it was.
- **The source walk** for the first case is `tmp/walk-20260929-1242-el-jamon-2.geojson`
  in the owner's main checkout (`D:/Projects/nx-portfolio/tmp/`), 18 MB and not
  committed. It holds the `game` stream. The committed fixture
  `src/__fixtures__/tracking/el-jamon-2.tracking.json` was cut without it.
- **No raw trace exists for the second case.** Raw sensor streams are never sent from a
  walk (velista `0126`). The walk lab at `/{locale}/lab/walk` records every stream, so
  the owner can record the freezer aisle with it.

### Target state

1. `pushGyro(sample)` on the guard, with the same sample shape as `pushCompass`. The gyro
   heading is `forwardBearing` of the sample, the function the compass heading uses.
2. **The turn rule** (section 1): the camera frame turned against the gyro. It answers
   `suspect` with the cause `turned` and stops the walk with `frame-moved`.
3. **The compass rule becomes a notice** (section 2) while the gyro is heard: the guard
   emits `compass-disturbed` and `compass-settled`, and the state stays `good`.
4. **Without a gyro the guard behaves as `0003`** (section 3).
5. **The state says whether the compass can be trusted now**: `compassDisturbed` on
   `TrackingState`. The baseline is not learned from samples taken while the gyro shows
   the compass turning by itself (section 2).
6. **A session's turn against an earlier one** (section 4): `gyroOffset` on the state, and
   `alignSession` accepts a rotation in place of the compass pair.
7. **Each `stopped` event names its cause** (`lost`, `jump`, `turned`, `heading`) and the
   number that crossed the limit (degrees or metres).
8. The El Jamón fixture is cut again with the `game` stream over the same spans. The spec
   asserts: `lost` at 920.5 s, `suspect` with the cause `turned` within 2 s of 922.0 s,
   the jump at 1013.4 s, and no `compass-disturbed` anywhere in the fixture.
9. A second fixture for the bent compass (section 5).

### Scope

Work only in `libs/luna-shopper/shop-map/recorder/**`.

Do not touch: the step and turn engine of `0001`, the file format of `0002` beyond
reading it, the model library, velista, the backend.

### Constraints

- **The library touches no sensor.** It gets samples and answers states.
- **Thresholds are named constants** with the field number each one comes from in a
  comment, as in `0003`.
- **The jump rule and the two clock rules of `0003` do not change.**
- Zero runtime dependencies. Only make changes directly requested.

### Action boundaries

Stop and ask before: letting a walk continue while the camera and the gyro disagree,
removing the compass rule for a device with no gyro, or choosing a threshold that no
fixture exercises.

### Progress evidence

Per section: the files changed and the spec run. At the end: the test and lint targets,
and the guard's events over both fixtures as two tables of times, attached to the PR.

## 1. The turn rule

Keep two medians of camera minus gyro heading: one over the last 2 s (`now`), and one
over the 10 s that end 2 s ago (`before`). Only tracked poses count, so a loss leaves a
gap and `before` is still the frame from before the loss.

The frame turned when `now` is more than 30 degrees from `before`. The gyro's drift
moves both medians together and stays far below that limit. The flip of 2026-09-29 is
158.5 degrees.

The rule needs 2 s of poses after a loss before it can answer. Until then the state is
`suspect` with the cause `returned`, as today. A frame that passes the rule after a loss
is still an automatic resume that the person confirms: the rule finds a turn, and it
cannot find a frame that moved without turning.

## 2. The compass, when the gyro is heard

Compass minus camera heading more than 45 degrees from the baseline, with the turn rule
quiet, is a compass that is bent. The guard emits `compass-disturbed` with the drift,
sets `compassDisturbed`, and stays `good`. It emits `compass-settled` when the 5 s median
is back inside the limit.

The baseline is the median of the first 60 s, which already ignores a short disturbance.
One more guard: a sample is left out of the baseline while the median of compass minus
gyro heading over the last 2 s is more than 30 degrees from the same median over the
10 s before it. That is the compass turning while the phone does not.

## 3. Without a gyro

A browser can have no `game` stream, or the stream can fall silent. The gyro is heard
while its last sample is less than 1 s old. While it is not heard, the compass rule of
`0003` stops the walk as it does today, with the cause `heading`. A stop is worse than a
notice, but a flipped frame that nobody catches draws a wrong map.

## 4. A session's turn against an earlier one

`state().gyroOffset` is the median of camera minus gyro heading over the last 2 s.
Velista keeps the value of the session that stopped. For a new camera session in the
same page visit, the rotation that puts the new frame onto the walk's frame is the old
value minus the new one, added to the rotation the old session already had.

`alignSession` takes either `{ compassOffset, baseline }` as today or `{ rotation }`.
The translation rule (0.5 m behind the mark) does not change. Velista `0136` decides
which one to pass.

## 5. The fixture for a bent compass

The real one is a walk lab recording of the freezer aisles of the Mercadona at Calle
Libertador Andrés de Santa Cruz, Córdoba, with the camera on. Ask the owner for it. Cut
it as the El Jamón fixture was cut (10 Hz, the three streams) around each place where
compass minus camera heading leaves the baseline.

Until the owner supplies it, build a synthetic trace and name it as synthetic in the
file and in the spec: a straight walk of 30 s at 1 m per second, camera and gyro in
agreement, and a compass that swings 90 degrees away over 3 s, holds for 8 s and comes
back. The spec asserts one `compass-disturbed`, one `compass-settled`, and no stop. The
same trace without the gyro stream asserts one stop with the cause `heading`.

When the real recording arrives it replaces the synthetic trace, and its numbers replace
the 30 and 45 degree limits if it disagrees with them.

## 6. Not in this plan

- Feeding the gyro, the resume and the walk log: velista `0136`.
- The log's new event: backend `0197`.
- Positioning by Wi-Fi access points. A browser has no API for it.
- Relocalizing against a saved camera map.

## What the build decided

### The owner's decisions (2026-10-15)

The build stopped at an action boundary and asked. The owner answered three questions.

1. **The turn limit is 60 degrees, not 30** (`TURN_LIMIT_DEGREES`). The premise of
   section 1 does not hold on the walk of 2026-09-29: the `game` stream misses part of
   every turn, it does not only drift slowly. At 909 to 916 s the phone turns about 185
   degrees, and camera minus gyro heading steps by about 38 degrees and stays there,
   while compass minus camera moves by about 5. Over the whole 18 minute walk at full
   rate, leaving out 918 to 936 s and 1011 to 1027 s (the flip and the jump), the rule's
   number (`now` minus `before`) was:

   | p50 | p95  | p99  | max  |
   | --- | ---- | ---- | ---- |
   | 4.7 | 24.3 | 35.4 | 45.6 |

   | Limit | Times crossed while walking                                                |
   | ----- | -------------------------------------------------------------------------- |
   | 30    | 9 (183.6, 287.8, 323.7, 709.1, 747.4, 916.3, 998.3, 1080.7 s and one more) |
   | 45    | 1                                                                          |
   | 60    | 0                                                                          |
   | 90    | 0                                                                          |

   The flip measured 148.2 degrees at 924.1 s and the frame jumping back 75.1 degrees
   at 1014.4 s. With 30, the cut fixture already stops at 915.6 s, before the loss.
   So a walk goes on while the camera and the gyro disagree by less than 60 degrees.
   With the gyro heard, a frame that comes back from a loss turned by 45 to 60 degrees
   thus passes with only a `compass-disturbed` notice, because the compass rule no
   longer stops a walk then.

2. **The baseline exclusion of section 2 keeps 30 degrees, as its own constant**
   (`COMPASS_TURN_LIMIT_DEGREES`). Compass minus gyro heading crossed 30 degrees 18
   times while walking (51.0 at most), which only leaves those samples out of the
   baseline.
3. **Target 8 keeps its 2 s.** A 2 s wait after a loss answers at 924.04 s at full rate
   and 924.10 s in the 10 Hz fixture, after poses came back at 922.0023 s. The wait is
   therefore `TURN_WAIT_AFTER_LOSS_MS` = 1.8 s, and the rest of section 1 stays: the
   `now` window is still 2 s and holds only poses from after the return. The rule
   answers at 923.84 s at full rate (measured, the walk is not committed) and at
   923.90 s in the fixture (asserted at 2.0 s or less).

### Choices of the build

4. **The compass is judged only while tracking is `good`.** During `lost` and
   `suspect` the camera frame is itself in doubt, so no `compass-disturbed` or
   `compass-settled` is emitted then, and `compassDisturbed` keeps its last value. This
   is what keeps the fixture free of notices while the walk waits after the turn stop.
5. **A confirm clears the turn rule's samples only once the rule has judged the
   frame.** After a loss the rule answers 1.8 s after poses return. A confirm after that
   answer (or with no loss since the guard started) clears the samples from before it:
   the person vouched for the frame they stand in, so the rule measures from it and does
   not report the same turn again. A confirmed flipped frame therefore makes the compass
   read as bent (`compass-disturbed`) while the gyro is heard. A confirm before that
   answer, which is what velista sends during an automatic resume, keeps the samples
   from before the loss, so the rule still compares the returned frame with them. Such a
   confirm does not vouch for the frame either, because nobody could know yet that it
   turned. Until the rule answers, `state().awaitingTurnJudgement` is true, any stop
   carries `unconfirmedDropped` (decision 15), and the host drops the points kept since
   the return. A confirm sets it while the gyro was heard within the last 3 s
   (`GYRO_NEW_ZERO_MS`), not only within 1 s: a gyro back from a shorter silence keeps
   its readings and the rule still answers, so a confirm in a 1 to 3 s gap does not
   vouch for the frame either. The compass notice waits for the answer too, because the frame it would be
   judged against is still in doubt. On the El Jamón fixture a confirm at 922.37, 923.00
   or 923.71 s still ends in a `turned` stop of 148.4 degrees at 923.90 s, with
   `unconfirmedDropped`, and no `compass-disturbed` comes before it. A new loss judges
   the frame afresh, so a turn already reported before it can stop the walk again.
   Without a gyro, plan 0003 holds: the heading rule fires again at the next pose.

   **Hand-off to velista `0136`.** The host keeps its loss point and the points kept
   since the return until the guard has judged the frame (`awaitingTurnJudgement` false),
   not only until the confirm. A stop with `unconfirmedDropped` saves the walk up to
   the loss before the first return that the rule has not judged, not up to the latest
   loss: a second loss while `awaitingTurnJudgement` is true does not move that point.
   Today velista flushes the unconfirmed points at the
   confirm, so a `turned` stop after an early confirm would leave them in the walk.
   Velista `0136` changes that; this plan does not touch velista.

6. **The turn rule fires again while `suspect`**, as the other rules do (plan 0003
   README item 5). In the fixture it does so at 1014.3 s, when the jump turns the frame
   back. The stop already waits, so there is one stop.
7. **The rule also waits 1.8 s of poses at the start** of a guard, and it answers
   nothing while `before` is empty.
8. **The gyro silent rule.** While the gyro is not heard, a compass that already
   disagrees stops the walk at the first pose, also when a notice was emitted for it
   while the gyro was heard. A stream that falls silent in a bent spot thus stops.
   When the gyro is heard again after a silence of 3 s or more (`GYRO_NEW_ZERO_MS`), its
   samples are thrown away and the turn rule waits 1.8 s again, as after a loss: the
   browser can fall back from one orientation stream to another with another zero, and
   camera minus gyro heading would step by that difference and read as a turn. That
   fallback comes only after 3 s of silence (`SILENCE_MS` in `orientation-stream.ts`).
   A shorter silence keeps the zero and the samples, so a frame that turns during a
   1 to 3 s gap that coincides with a loss is still stopped as `turned`.
9. **`stopped` carries `cause` and one number.** `degrees` for `turned` and `heading`
   (the `turn` or `drift` of the suspect), `metres` for `jump`, and no number for
   `lost`: its limit is the fixed 3 s, and backend `0197` stores only degrees and metres.
   The suspect for `turned` carries the angle as `turn`, beside `drift` and `metres`.
10. **The events' numbers** are named `drift` on `compass-disturbed` and
    `compass-settled`, as on the heading suspect. Velista `0136` maps them to the log's
    `degrees`.
11. **`GyroSample` is the compass sample's type**, and the gyro heading is
    `compassHeading`, which is `forwardBearing` in degrees.
12. **`gyroOffset`** is absent while no tracked pose came with the gyro heard in the
    last 2 s. A `gyroOffset` read from a guard fed aligned poses already holds that
    session's rotation, which the doc comment of `AlignSessionByRotation` says.
13. **The synthetic fixture** is `bent-compass.synthetic.tracking.json`, written by the
    new `synthesize-bent-compass` target (`tools/synthesize-bent-compass.ts`), with
    `synthetic: true` in the file. The camera faces map +y upright; the compass and the
    gyro read a phone held flat, as the guard's specs do, because the guard only
    compares headings. The gyro drifts 0.33 degrees per second. The baseline (300) is
    in the file, because 30 s cannot learn one.
14. **`cut-tracking-fixture`** now keeps the `game` stream. The recut added only the
    `game` rows: every pose, compass and event row is unchanged.

### The owner's decision in review (2026-10-15)

15. **Any stop while `awaitingTurnJudgement` is true drops the points since the
    return**, not only a `turned` stop. A `jump` stop, or a `lost` stop after a second
    loss, also carries `unconfirmedDropped`, because the early confirm vouched for no
    frame. The specs cover a 3 m jump at 17.0 s and a second loss at 17.0 s, each after
    a confirm at 16.6 s that followed a loss from 15.0 to 16.0 s.

### Where the facts moved since the plan

Nothing moved. `src/lib/tracking-guard.ts`, its spec and
`libs/velista/platform/src/lib/sensors/orientation-stream.ts` are where the plan names
them. Backend `0197` is built (PR #698) and its `guard` event fits the causes here;
velista `0136` is not built.

### Not done

The real freezer aisle recording of section 5: the owner has not supplied it. When it
arrives it replaces the synthetic fixture, and its numbers may move the 45, 60 and 30
degree limits.
