# @portfolio/luna-shopper/shop-map/recorder

Turns a walk through a shop into positions, and positions into a draft shop map.
Framework free and with no runtime dependency: no DOM, no Node API and no framework
inside `src/`, because velista compiles it under Angular and the Android app ports it.

- Recorder plan 0001 (`plans/0001-steps-turns-and-scans.md`): `createWalkRecorder`,
  `Walk` and `walkToDocument`.
- Recorder plan 0002 (`plans/0002-the-walk-file-and-the-positioning-modes.md`): the
  walk file, every positioning mode as a pure function over it, the metrics and the
  GeoJSON file on disk.

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
  The Android app replays the same files and asserts the same numbers within 1e-3.
- `traces/<name>.trace.json` and `.expected.json`: plan 0001's motion samples
  (`[t, ax, ay, az, yawRate]` plus the host's marks and scans) and the `Walk` its
  recorder answers.

## Rules the plan left open

Plan 0002 fixes the numbers. These are the choices this implementation makes where the
plan says nothing, and the Kotlin port makes the same ones.

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
15. **A deleted mark.** An event `{ kind: 'mark-deleted', detail: <the mark's t> }`
    takes back a mark that was already saved (velista plan 0127). The reader applies
    these events in file order, and each one drops the last mark still standing whose
    `t` equals the detail read as a number. An event that matches no mark drops nothing,
    and the events themselves are kept.

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
