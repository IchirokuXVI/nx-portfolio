# @portfolio/luna-shopper/shop-map/recorder

Turns a walk through a shop into positions, and positions into a draft shop map.
Framework free and with no runtime dependency: no DOM, no Node API and no framework
inside `src/`, because velista compiles it under Angular.

- Recorder plan 0001 (`plans/0001-steps-turns-and-scans.md`): `createWalkRecorder`,
  `Walk` and `walkToDocument`.
- Recorder plan 0002 (`plans/0002-the-walk-file-and-the-positioning-modes.md`): the
  walk file, every positioning mode as a pure function over it, the metrics and the
  GeoJSON file on disk.
- Recorder plan 0003 (`plans/0003-camera-tracking-and-its-guards.md`): the tracking
  guard, `keepPathPoint` and `alignSession`. See the last section.

```sh
npx nx test luna-shopper/shop-map/recorder
npx nx lint luna-shopper/shop-map/recorder
npx nx run luna-shopper/shop-map/recorder:generate-fixtures   # rewrites src/__fixtures__
npx tsx libs/luna-shopper/shop-map/recorder/tools/summarize-fixtures.ts
```

## The fixtures are synthetic

No phone recording existed when this library was built, so every file under
`src/__fixtures__/` is written by `tools/generate-fixtures.ts` from the seeded walker
of `tools/synthesize.ts`. It holds a phone flat, bounces once per step at 1.8 steps a
second, pivots in place at each turn and pauses half a second after it, which is
kinder to dead reckoning than a real person. Real recordings join them after the field
test of 2026-09-28. Never edit a fixture by hand. Rerun the generator.

- `walks/<name>/<walk file name>.geojson`: the exported file of plan 0002 section 3.
- `walks/<name>/expected.json`: per mode, and for PDR modes per step model (`fixed`,
  `weinberg`), the numbers this implementation computes, and the true path's numbers.
- `traces/<name>.trace.json` and `.expected.json`: plan 0001's motion samples
  (`[t, ax, ay, az, yawRate]` plus the host's marks and scans) and the `Walk` its
  recorder answers.

## Rules the plan left open

Plan 0002 fixes the numbers. These are the choices this implementation makes where the
plan says nothing.

1. **Merging streams.** `computeTrack` feeds every row of every stream in `t` order.
   At an equal `t` the order is the key order of section 2: `motion`, `game`,
   `absolute`, `magnetic`, `steps`, `location`, `pose`, `pressure`. Within a stream,
   file order. The reader stably sorts a stream whose rows are out of order. The merge
   never sorts.
2. **Filter start.** Every low pass starts at its first input (`s` and `b` at the first
   `m`, gravity at the first acceleration vector) and the first sample integrates
   nothing (`dt = 0`). `dt` is in seconds.
3. **Own steps.** "Rises above" is `s - b > 0.8`, "falls below" is `s - b < 0.2`. The
   sample that rises is the first candidate for the largest `s`. `smin` is the smallest
   `s` since the previous emitted step. It starts at the first `s` and restarts at the
   current `s` on the sample that emits a step. A dropped step restarts nothing. The
   first second is `peak t < first motion t + 1000`. The refractory time compares
   against the previous emitted step only.
4. **Gyro heading.** Per motion row: update gravity, then take this row's rotation rate
   dotted with the new unit gravity (0 when `|g| = 0`), then `psi -= rate * dt`.
5. **Rotation heading.** Quaternions are normalized before use. The first sample sets
   the start heading and a rate of 0. After that, the rate is `|yaw(Δq)| / dt`, or 0
   when `dt <= 0`. The absolute start bearing uses device `-z` when
   `|(R · +y).z| > sin 45°`.
6. **Settling.** The rate compared with 20 degrees per second is `|yaw rate|` of the
   current sample. Settled means the current unbroken run of samples under that rate
   began at least 400 ms before this sample. The snapper runs after every heading
   sample (every motion row for gyro, every quaternion row for game and absolute) and
   is created with the heading of the first one. A turn is `Math.round`, which takes
   an exact half towards +∞.
7. **Order inside a motion row.** Gyro heading and snapper first, then the own step
   detector, so a step detected at a row uses the heading after that row. A step's
   point carries the step's `t` (the time of its largest `s` for an own step).
8. **Before a needed stream starts.** A step (own or `hw`) that arrives before the
   heading source's first sample is ignored and not counted. A track always starts
   with `{ t: 0, x: 0, y: 0 }`. A mode whose streams the file lacks answers that point
   alone. `vio` and `gps` start at their first row's `t`.
9. **`hw` steps under weinberg.** The own detector's `s` runs over `motion` in every
   PDR mode. An `hw` step's length is weinberg over the largest and smallest `s` of
   the motion rows since the previous `hw` step (the span restarts at every `hw`
   event, including an ignored one). No motion row in the span: the fixed length.
10. **Segments.** A snap turn closes the current segment only when it holds at least
    one step. The final segment is closed when it holds a step or when there is no
    segment at all. Confidence is `exp(-(t_to - t_from) / 60 s)` over the segment's
    first and last point. A non snap PDR mode has one segment with that formula over
    the whole track. `vio` and `gps` have one segment of confidence 1.
11. **Alignment and bearing.** `rotation = atan2(p.x, p.y)` of the first point at least
    3 m from the start, applied counterclockwise. Absolute modes and `gps` have a
    pre alignment +y of north, so their `bearing` is `rotation` in degrees in
    [0, 360). Other modes have no bearing.
12. **`vio` and `gps`.** `vio` is every pose row as `(x - x0, z0 - z)`. `gps` is every
    location row, equirectangular around the first row with `111320` metres per degree.
13. **Metrics.** Checkpoints group by label (no label groups under `""`), in order of
    first appearance, only labels marked at least twice.
14. **The file.** `bearing` is rounded to two decimals and then used to project.
    Coordinates are rounded to seven decimals, `distanceMetres` to two. Without an
    origin the projection is centred on `[0, 0]`. The file name takes the date and
    time digits as written in `startedAt`, with no time zone conversion.

## Plan 0001 against plan 0002

Plan 0001's `MotionSample` carries a yaw rate the host already projected on gravity,
so `createWalkRecorder` is `pdr:own:gyro:snap` with section 5.2's first two steps done
by the host: for a phone held flat, that is the rotation rate's z. Its position is kept
in metres and rounded to a cell as a whole, so the grid error stays under half a cell
instead of growing by one per segment. `WalkMarkKind` adds `checkpoint` to plan 0001's
four kinds, so `trackToWalk` can carry a walk file's checkpoints over. They draw
nothing. `walkToDocument` flips the walk's `y` (north up) into the document's rows (top
down), and makes the draft valid by construction: entrances are carried to the border
through a corridor, and any free cell no entrance reaches becomes shelf.

## Plan 0003: the tracking guard

`createTrackingGuard` takes camera poses and compass samples and answers `good`, `lost`
or `suspect`, plus the events it decided (`lost`, `suspect`, `stopped`, `baseline`,
`confirmed`, `discarded`). It touches no sensor. Every threshold is a named constant in
`src/lib/tracking-guard.ts`, with the field test number it comes from.

The fixture is real: `src/__fixtures__/tracking/el-jamon-2.tracking.json` is cut from the
second El Jamón walk by `tools/cut-tracking-fixture.ts` (the `cut-tracking-fixture`
target, with the walk file passed in `--args`). The walk itself is 18 MB and is not
committed. Never edit the fixture by hand. Recut it.

Over the fixture, left alone, the guard answers:

| Time | Event |
| ---- | ----- |
| 62.0 s | baseline 316.6 degrees (compass minus camera heading) |
| 920.5 s | `lost`, the pose is not tracked |
| 922.0 s | `suspect`, poses returned, automatic resume |
| 923.8 s | `suspect` by the heading rule (drift 162 degrees), and a `frame-moved` stop that drops the unconfirmed segment |
| 1013.4 s | `suspect` by the jump rule, 28.8 m in one frame |

These are the choices the guard makes where the plan says nothing.

1. **Headings.** A heading is degrees, 0 along map `+y`, clockwise as seen from above,
   so heading `h` points along `(-sin h, cos h)`. That is the compass's sense, so
   compass minus camera heading stays put while the person turns. `cameraHeading` reads
   the camera's `-z`, or its `+y` when the phone lies flat, by the same 45 degree rule
   as plan 0002's `forwardBearing`, which `compassHeading` uses.
2. **Pairing.** Each tracked pose pairs with the latest compass sample. With no compass
   yet, the heading rule and the baseline wait.
3. **The clock.** Both streams advance it. No tracked pose for 0.5 s is `lost` from the
   last pose plus 0.5 s, and a stop for a loss is stamped at the loss plus 3 s.
4. **After a stop.** Poses that return after a loss short of 3 s are an automatic
   resume. Poses that return after a `tracking-lost` stop are `suspect` without one,
   because the walk stopped and only the person resumes it.
5. **A rule firing while `suspect`.** The heading or the jump rule fires again while
   `suspect`, including during an automatic resume, and it stops the walk with
   `frame-moved` unless a stop is already waiting for an answer. A stop ends the
   automatic resume, so no path point is kept after it.
6. **A stop drops the unconfirmed segment.** The points kept since an automatic resume
   are saved only when the person confirms them. When a stop ends that resume first,
   they are never saved: a `frame-moved` stop during an automatic resume means those
   points are in the moved frame. The `stopped` event says so with
   `unconfirmedDropped: true`, and the host then drops every point kept since the
   automatic resume began and keeps the walk up to the loss. The field is absent when
   nothing was unconfirmed.
7. **The heading rule** fires when the 5 s median crosses 45 degrees from the baseline,
   not on every sample past it. `confirm` rearms it, so confirming while the compass
   still disagrees suspects again at the next pose.
8. **The jump rule** compares consecutive tracked poses only, never the two sides of a
   loss.
9. **`discard`** ends the guard: it reads nothing more, and the host stops the walk.
10. **Resuming.** `alignSession` takes the walk's `baseline` beside the plan's three
    inputs. The host reads the new session's `compassOffset` from `state().offset` of a
    guard fed the new session's raw poses, then feeds a guard created with the walk's
    baseline the poses passed through `alignPose`.
11. **The baseline** is learned over 60 s of unbroken `good` tracking. When the guard
    leaves `good` before the baseline is known, the samples learned so far are thrown
    away and the next `good` stretch starts again from zero, because tracking that comes
    back after a loss can be in another frame. Lost and suspect time never counts.
