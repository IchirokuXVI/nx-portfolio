> **PR:** [#545](https://github.com/IchirokuXVI/nx-portfolio/pull/545)

# 0003: camera tracking, and its guards

> Third plan of the recorder library. Needs `0002` (the walk file, the `vio` mode and the
> pose stream). Consumed by velista `0126` (recording a walk), which owns the WebXR session
> and feeds this plan's functions, and by `shop-map/plans/0003`, which paints only while the
> state here is `good`.
>
> Prerequisite reading: `0002` sections on `pose` and `events`, the README's field test
> results for 2026-09-29, and `libs/velista/feature-walk-lab/src/lib/capture/walk-capture.ts`
> (how the lab opens `immersive-ar` today).

The second El Jamón walk (2026-09-29, 18 minutes, 57 marks) is the reason for this plan.
The camera repeated a place to between 0.1 and 1.4 m, which is good enough to draw a shop.
Then, at 920.5 s, tracking was lost for 1.5 s after a mark by the freezers, and it came back
in a frame rotated by 158.5 degrees. Four later visits landed 16 to 28 m from where they
were. At 1013.4 s one frame jumped 28.8 m back onto the old map. The recorder logged no
event for that jump.

Two numbers catch both failures live. The compass minus the camera heading was −85.5
degrees (standard deviation 19) before the loss, +76.9 during the flip and −84.5 after it.
And a person walking does not move 28.8 m between two frames. So the camera is trusted
while the compass agrees with it and the position moves like a person, and not otherwise.

## Brief for the agent

### Objective

Add a framework free tracking guard that takes camera poses and compass headings and
answers a tracking state (`good`, `lost`, `suspect`), the stops and automatic resumes it
decided, the path points worth keeping for the walk log, and the rigid alignment that puts
a new camera session into the frame of an earlier one.

### Context

- **The pose stream** of `0002`: `t, x, y, z, qx, qy, qz, qw` at about 30 Hz, with
  `poseSource` `arcore` or `webxr`. WebXR reports a lost pose as
  `XRViewerPose.emulatedPosition === true`, and ARCore as a tracking state. Both reach this
  library as a boolean per sample.
- **The source walk** is `tmp/walk-20260929-1242-el-jamon-2.geojson` in the owner's main
  checkout, 18 MB and not committed. The analysis scripts beside it are in
  `tmp/walk-analysis/` (`drift2.ts`, `rigid.ts`, `compass-vs-vio.ts`). Ask the owner for the
  file if the checkout has none, and commit only the cut fixture.
- **The compass** is the `absolute` stream of `0002` (`deviceorientationabsolute` or the
  Android rotation vector).
- **The frame**: the map's `x` is the camera's `x` and its `y` is the camera's `z`
  (`shop-map/plans/0002` section "The frame").
- **What the user decided**: a stop caused by the hardware plays a sound and stops the walk.
  An automatic resume plays another sound, and its path is drawn in another colour and not
  saved until the person confirms it. Discarding it keeps the walk up to the problem. A
  manual resume asks "Where are you?" and the person picks a mark they stand next to.

### Target state

- `createTrackingGuard(options)` with `pushPose(sample)`, `pushCompass(sample)` and
  `state()`, answering the state machine of section 1.
- `keepPathPoint(previous, next)`: at most one point per 0.25 m or per second (section 2).
- `alignSession({ mark, standingAt, compassOffset })`: the rotation and translation that put
  a new session's frame onto the walk's frame (section 3).
- A fixture cut from the second El Jamón walk: the pose and compass streams from 860 s to
  1040 s, down sampled to 10 Hz, plus the first two minutes for the baseline. The guard
  answers `lost` at 920.5 s, `suspect` within 5 s of 922.0 s, and a jump at 1013.4 s, as
  its spec asserts.

### Scope

Work only in `libs/luna-shopper/shop-map/recorder/**`.

Do not touch: `0001`'s step and turn engine, `0002`'s file format beyond reading it, the
model library, velista, the Android app.

### Constraints

- **The library touches no sensor.** It gets samples and answers states. WebXR, the sounds
  and the screen are velista's (`0126`).
- **Thresholds are named constants** with the field test number each one comes from in a
  comment, so a second walk can move them in one place.
- Zero runtime dependencies. Only make changes directly requested.

### Action boundaries

Stop and ask before: trusting the camera while the compass disagrees, resuming without
the person's confirmation, or adding a threshold the fixture does not exercise.

### Progress evidence

Per section: the files changed and the spec run. At the end: the test and lint targets, and
the guard's states over the fixture as a table of times, attached to the PR.

## 1. The states

| State | Entered when | Left when |
| ----- | ------------ | --------- |
| `good` | the session starts, or the person confirms a resume | a rule below fires |
| `lost` | a pose is emulated, or no pose arrives for 0.5 s | poses return: the state becomes `suspect` with `automaticResume: true` |
| `suspect` | the median of compass minus camera heading over the last 5 s moves more than 45 degrees from the baseline, or one frame moves more than 2 m, or poses return after `lost` | the person confirms (`good`) or discards (the walk stops) |

The baseline is the circular median of compass minus camera heading over the first 60 s of
`good` tracking in a session, and it is stored with the walk so that a resume can reuse it.
A stop fires when `lost` lasts 3 s or when `suspect` is entered by the heading or the jump
rule. The guard answers each stop with its reason (`tracking-lost`, `frame-moved`), which
is the `reason` of the log's `stopped` entry.

## 2. Keeping path points

The walk log keeps a point when it is 0.25 m or more from the last kept one, or one second
after it, whichever comes first, and only while the state is `good` or `suspect` with an
automatic resume. Points kept during `suspect` are the unconfirmed segment that velista draws
in purple.

## 3. Aligning a new session

A resumed session starts a new camera frame. The person picks a mark and stands at it,
facing what it marks. The rotation is the difference between the new session's compass
offset and the walk's baseline, and the translation puts the person's position on the
mark's position moved 0.5 m back along its heading. The answer is a 2D rigid transform that
the recording screen applies to every later pose.

## 4. Not in this plan

- The WebXR session, the sounds, the purple path and the dialogs: velista `0126`.
- Relocalizing against a saved camera map (ARCore cloud anchors or similar).
- The Android app, which `0004` deletes.
