> **PR:** [#523](https://github.com/IchirokuXVI/nx-portfolio/pull/523) (the library and the velista walk lab), [#522](https://github.com/IchirokuXVI/nx-portfolio/pull/522) (the Android walk app)

# 0002: the walk file, and the positioning modes

> A field test, not a feature. Built so the user can walk real shops with a phone on
> 2026-09-28 and decide whether shop mapping continues. Nothing here is linked from a
> page a shopper reaches, and nothing here is sent to a server. Needs
> `shop-map/plans/0001` (the document) and `recorder/plans/0001` (steps, turns and scans),
> which it extends. Consumed by the velista walk lab and the Android walk app, both
> described in sections 7 and 8.

Recorder plan 0001 decided one way to position a phone: count steps, integrate the
gyroscope and snap turns to a square grid. Whether that is good enough is the question
the field test answers, and it cannot be answered by one method alone. So a walk records
**every raw stream the phone offers**, stores them in one file, and every positioning
method is a pure function over that file. One walk then answers for every method at once,
a file recorded on Android can be replayed by the web code and the other way round, and a
method invented next week can be tried on walks recorded this week.

## Brief for the agent

### Objective

Implement the walk file of section 2, the modes of section 4 with the parameters of
section 5, the GeoJSON export of section 3 and the metrics of section 6, identically in
TypeScript (`@portfolio/luna-shopper/shop-map/recorder`) and in Kotlin (the Android app).
Then build the two hosts of sections 7 and 8, which record, show and exchange walks.

### Context

- The document, `validateShopMap` and the other model functions come from
  `@portfolio/luna-shopper/shop-map/model` (`shop-map/plans/0001`).
- `createWalkRecorder`, `Walk` and `walkToDocument` come from recorder plan 0001, which
  this plan extends and does not replace. `pdr:own:gyro:snap` of section 4 is exactly the
  recorder of plan 0001.
- The test phone runs Android with Chrome. iOS is not a target of this plan.
- The web host is used from the staging deployment in a Chrome tab, not installed.

### Constraints

- The file of section 2 is the contract between the two implementations. A field is
  added only by editing this plan first.
- Every mode is computed from the file alone, never from state the recording screen held.
- Both implementations use the parameters of section 5 as written, so that the same file
  gives the same answer on both within a tolerance.
- No server call, no account, no category work, no review queue.

## 1. Frames and units

- **Device frame**: the Android and W3C one. x to the right of the screen, y to the top of
  the screen, z out of the screen. Accelerations in m/s², **including gravity**, so a phone
  lying face up at rest reads z ≈ +9.81. Angular rates in **rad/s**, right handed around
  the device axes. The W3C `rotationRate` is in deg/s with `alpha` around z, `beta` around
  x and `gamma` around y, so the web host writes `[beta, gamma, alpha]` converted to rad/s.
- **Orientation**: a unit quaternion `[qx, qy, qz, qw]` that rotates device frame vectors
  into the world frame. For `absolute` the world is east, north, up. For `game` the world
  is up with an arbitrary yaw.
- **AR pose**: the device's position in metres and its orientation, in the AR session's
  world frame, which is y up with an arbitrary yaw (ARCore and WebXR `local` space alike).
- **Time**: `t` is milliseconds since `startedAt`, a float with at most one decimal.
- **Local plane**: every track of section 4 is points `{ t, x, y }` in metres on the floor,
  with the start at the origin. Before alignment its axes are the mode's own. After
  alignment (section 5.6) `+y` is the direction the person first walked.

## 2. The walk file

```ts
export interface WalkFile {
  format: 'shop-walk';
  version: 1;
  id: string; // a uuid made by the host at the start
  name?: string; // what the person typed, for example "Mercadona Plaza Mayor"
  startedAt: string; // ISO 8601 with offset
  durationMs: number;
  source: {
    platform: 'web' | 'android';
    app: string; // 'velista-walk-lab' | 'shop-walk-android'
    appVersion: string;
    device?: string; // Build.MODEL on Android
    userAgent?: string; // the web host
  };
  /** How the person says they held the phone. Informative. */
  holding?: 'flat' | 'upright';
  settings: { stepMetres: number; cellMetres: number }; // 0.7 and 0.5 by default
  /** The first location fix, when one arrived. */
  origin?: { lat: number; lon: number; accuracyMetres: number };
  streams: {
    motion?: number[][]; // [t, ax, ay, az, gx, gy, gz]
    game?: number[][]; // [t, qx, qy, qz, qw]
    absolute?: number[][]; // [t, qx, qy, qz, qw]
    magnetic?: number[][]; // [t, mx, my, mz] in µT, recorded for later, read by no mode
    steps?: number[]; // [t] of each hardware step detector event
    location?: number[][]; // [t, lat, lon, accuracyMetres]
    pose?: number[][]; // [t, x, y, z, qx, qy, qz, qw]
    pressure?: number[][]; // [t, hPa], recorded for later, read by no mode
  };
  poseSource?: 'arcore' | 'webxr';
  marks: WalkMark[];
  /** What happened to the recording: 'hidden', 'visible', 'tracking-lost',
   * 'tracking-resumed', 'permission-denied', 'sensor-missing', with a detail. */
  events: { t: number; kind: string; detail?: string }[];
}

export interface WalkMark {
  t: number;
  kind: 'entrance' | 'checkout' | 'checkpoint' | 'note';
  /** A checkpoint's name ("door", "fish counter"), or a note's text. */
  label?: string;
}
```

Every stream is optional because every phone and browser offers a different set. A row is
an array rather than an object because a twenty minute walk is over a hundred thousand
motion rows, and the file must stay a few megabytes. Rows of a stream are in `t` order.
Motion is recorded at 100 Hz where the platform allows it, orientation at 50 Hz, pose at
the AR frame rate, location as it arrives.

A reader refuses a file whose `format` is not `shop-walk` or whose `version` is not 1, and
ignores fields it does not know.

## 3. The file on disk is GeoJSON

The exported file is a GeoJSON `FeatureCollection`, named
`walk-<YYYYMMDD>-<HHmm>-<name in kebab case>.geojson`, so it opens in geojson.io or QGIS as
it is. The `WalkFile` travels inside it as the foreign member `walk`, which GeoJSON allows
and every GeoJSON reader ignores.

```jsonc
{
  "type": "FeatureCollection",
  "localFrame": false, // true when there was no origin and the coordinates start at 0,0
  "bearing": 212.5, // degrees clockwise from north of the local +y axis, 0 when unknown
  "features": [
    { "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[lon, lat], ...] },
      "properties": { "mode": "pdr:own:gyro:snap", "steps": 812, "turns": 23, "distanceMetres": 568.4 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [lon, lat] },
      "properties": { "mark": "checkpoint", "label": "door", "t": 0, "mode": "pdr:own:gyro:snap" } }
  ],
  "walk": { "format": "shop-walk", "version": 1, "...": "section 2" }
}
```

- One `LineString` per mode that was computed, aligned (section 5.6), rotated by
  `bearing` into east and north, and placed at `origin` with an equirectangular projection
  (`dLat = y / 111320`, `dLon = x / (111320 cos lat0)`). Without an origin it starts at
  `[0, 0]` and `localFrame` is true.
- `bearing` is the aligned `+y` direction in the world, taken from the first of
  `pdr:own:absolute`, `gps` that the file can compute, else 0.
- One `Point` per mark, placed on the track of the mode the exporter had selected.
- **Import** accepts three things: this file (replay from `walk`), a bare `WalkFile` JSON,
  and a plain GeoJSON with no `walk`, whose `LineString`s are drawn as they are with no
  replay. The last is what makes a file edited in another tool still viewable.

## 4. The modes

A mode id names where steps come from, where heading comes from, and whether turns are
snapped. Every combination the file's streams allow is available.

| Part | Values | Needs |
| ---- | ------ | ----- |
| steps | `own` (section 5.1 over `motion`) or `hw` (the `steps` stream) | `motion`, or `steps` |
| heading | `gyro` (5.2), `game` (5.3 over `game`), `absolute` (5.3 over `absolute`) | `motion` for gyro and for the gravity it projects on, else the named stream |
| snap | `snap` (5.4) or nothing | |

So `pdr:own:gyro:snap`, `pdr:own:gyro`, `pdr:hw:game:snap` and so on, twelve in all, plus:

- `vio`: the `pose` stream drawn as it is, x and minus z of the position as the floor plane.
  This is ARCore or WebXR tracking with the camera, and it is the closest thing the test
  has to a ground truth.
- `gps`: the `location` stream, projected to metres around its first fix. Expected to be
  poor indoors, and included to show how poor.

A PDR track (pedestrian dead reckoning: counting steps and turning them into a path)
advances one step length along the current heading at each step. Its points are the
positions after each step, with the start as the first point.

## 5. The parameters

Both implementations use these exact numbers. Each is an option with this default.

### 5.1 Own step detector

1. `m = |a|` over the three accelerations of `motion`.
2. `s` is an exponential low pass of `m` with time constant 0.06 s:
   `s += (1 - exp(-dt / 0.06)) * (m - s)`. `b` is the same with 1.5 s, the baseline. Both
   start at the first `m`.
3. A step begins when `s - b` rises above **0.8 m/s²**. While above, keep the time and
   value of the largest `s`, and the smallest `s` since the previous step. The step ends
   when `s - b` falls below **0.2 m/s²**, and is emitted at the time of the largest `s`,
   unless it is less than **280 ms** after the previous emitted step, in which case it is
   dropped.
4. The first 1.0 s of the walk emits no steps, while the baseline settles.

### 5.2 Gyro heading

1. Gravity `g` in the device frame is an exponential low pass of the accelerations with
   time constant 0.5 s.
2. The yaw rate is `ω · g / |g|`, the component of the rotation around the vertical.
3. Heading `ψ` is in radians clockwise from the local `+y`, starting at 0, and a positive
   yaw rate (a left turn seen from above) decreases it: `ψ -= yawRate * dt`.

### 5.3 Rotation vector heading (`game`, `absolute`)

The heading changes by the yaw of each increment `Δq = q_t ⊗ conj(q_(t-1))`, which is the
world frame rotation between two samples. Its yaw is
`atan2(2(w z + x y), 1 - 2(y² + z²))` of `Δq`, and `ψ -= yaw` as in 5.2. This follows the
phone however it is held, and only differs from the gyro in what the platform's fusion
corrected. The start heading is 0 for `game`. For `absolute` it is the compass bearing of
the device's forward axis at the first sample: device `+y` projected on the floor, or
device `-z` when `+y` points more than 45 degrees up or down, measured clockwise from
north. This is what gives an absolute track its `bearing`.

### 5.4 Square turns (`snap`)

The recorder plan's rule, applied to whichever heading the mode uses:

1. Keep `ψref`, the raw heading when the walk last settled, and `H`, the snapped heading,
   both starting at the start heading.
2. The heading is **settled** when its rate has stayed under 20 degrees per second for
   0.4 s.
3. When settled and `|ψ - ψref|` exceeds **60 degrees**, the turn is
   `round((ψ - ψref) / 90°) × 90°`. `H` moves by it, the turn count grows by one when it is
   not 0, and `ψref = ψ`. Resetting to the raw heading discards the residue, and that is
   what kills drift.
4. Steps use `H`. A mode without `snap` uses `ψ`.
5. The confidence of a segment between two turns is `exp(-seconds / 60)`.

### 5.5 Step length

`fixed`: `settings.stepMetres`. `weinberg`: `K × (smax - smin)^(1/4)` over the step's
largest and smallest `s` of 5.1, with `K = 0.48`. The viewer switches between them and
changes both numbers, and the tracks recompute from the file.

### 5.6 Alignment

Rotate a track around the start so that its first point at least **3 m** from the start
lies on `+y`. A track that never goes 3 m is left as it is. Every track is aligned before
it is drawn, compared or exported, because each mode's frame has its own arbitrary yaw and
only an aligned pair can be compared by eye. The rotation applied is kept on the track, so
an absolute track's `bearing` survives alignment.

## 6. The metrics

For each computed track the viewer shows:

| Metric | Means |
| ------ | ----- |
| steps | steps counted, 0 for `vio` and `gps` |
| turns | turns counted, snap modes only |
| distance | the length of the track in metres |
| end to start | the distance from the last point to the first, the loop error when the person ended where they began |
| checkpoint error | for each checkpoint label marked more than once, the largest distance between the track's positions at those marks. This is the accuracy measure: the person marks "door" at the door, walks the shop, and marks "door" again |

A position at a time `t` is the track point at or before `t`.

## 7. The velista walk lab

A page at `/{locale}/lab/walk` in velista, **linked from nowhere**, needing no account,
drawn with no bottom navigation. It is the web half of the test.

1. **Walks**: a list of walks saved on this device (IndexedDB, because a walk is
   megabytes), with Record, Import a file, and per walk Open, Export and Delete.
2. **Record**: a name, how the phone is held, the step length, and a toggle for camera
   tracking (WebXR `immersive-ar` with `dom-overlay`, shown only where
   `isSessionSupported('immersive-ar')` answers yes). Start asks for what it needs on the
   tap: motion permission where the API asks, location, and the wake lock. Recording reads
   `devicemotion` for `motion`, `RelativeOrientationSensor` and `AbsoluteOrientationSensor`
   for `game` and `absolute` where they exist (else `deviceorientation` and
   `deviceorientationabsolute` converted to quaternions), `watchPosition` for `location`,
   and the XR viewer pose for `pose`. The screen shows the elapsed time, the step count, a
   live drawing of one chosen mode, and big buttons for Entrance, Checkout, Checkpoint
   (with the labels already used offered first) and Note, then Finish. A hidden page ends
   the recording, keeps what was recorded, and adds an event saying so.
3. **View**: every available mode drawn over a grid of `cellMetres`, one colour each, a
   legend that turns each on and off, the marks, the metrics of section 6 as a table, the
   step length controls of 5.5, and the draft map of recorder plan 0001 (`walkToDocument`
   over the selected snap mode) as a layer that can be turned off. Pinch and drag zoom and
   pan it. Export writes section 3.

## 8. The Android walk app

`apps/shop-walk-android`, a Kotlin app built with Gradle, installed by hand from a debug
APK. It is not an Nx project and no CI job builds it.

1. The same three screens as section 7, native (Jetpack Compose), with walks saved in the
   app's own storage, import through the system file picker, and export through the file
   picker and the share sheet.
2. Recording reads `TYPE_ACCELEROMETER` and `TYPE_GYROSCOPE` for `motion` (resampled into
   one row at each accelerometer event with the latest gyroscope reading), `TYPE_GAME_ROTATION_VECTOR`,
   `TYPE_ROTATION_VECTOR`, `TYPE_MAGNETIC_FIELD`, `TYPE_STEP_DETECTOR`, `TYPE_PRESSURE`,
   the fused location provider, and ARCore when the person turns camera tracking on and the
   phone supports it. The screen stays on.
3. The modes, parameters and metrics of sections 4 to 6 are implemented in Kotlin with
   unit tests, and a walk file written by the velista lab replays in the app, and the other
   way round.

## 9. Not in this plan

- Barcode scans and their lookup, and anything that names a section or a category.
- The editor, and saving a map to the backend.
- A mode that fuses several sources, or corrects PDR with the camera track. Both are for
  after the field test, over the walks it recorded.
