# Shop walk (Android)

A native Android app for the shop map field test of 2026-09-28. It records every
sensor stream the phone offers while you walk a shop. Then it draws the walk once per
positioning method, so you can compare the methods. It is test tooling. You install it
by hand from a debug APK, and it never goes to a store.

The contract is `libs/luna-shopper/shop-map/recorder/plans/0002-the-walk-file-and-the-positioning-modes.md`.
The Kotlin package `app/src/main/java/com/ichirokuxvi/shopwalk/engine` implements its
sections 1 to 6: the file, the modes, the parameters, the export and the metrics. That
package has no Android imports. The velista walk lab is the web twin. A file that one
app exports imports and replays in the other.

This directory is not an Nx project. It has no `project.json` and no `package.json`.
No CI job builds it.

## Build

You need the Android SDK (platform 35, build tools 35) and JDK 17 or newer. The Gradle
wrapper downloads Gradle 8.9.

```sh
cd apps/shop-walk-android
echo "sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk" > local.properties   # once, git ignored
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew testDebugUnitTest assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`.

## Install

Copy the APK to the phone and open it. When Android asks, allow installs from that
source. Or, with USB debugging on:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Using it

1. **Walks** lists the walks saved on the phone. Record starts a walk. Import reads a
   file: a `.geojson` from either app, or a bare walk file. Each walk has Open, Export,
   Share and Delete. Export saves to a folder through the file picker. Share sends the
   file through any app.
2. **Record** asks for a shop name, how you hold the phone (flat or upright), your
   step length and whether to use camera tracking. Start asks for location, physical
   activity (the step counter) and, with tracking on, the camera. If you refuse one,
   the walk records that as an event and the rest still records.
3. While you record, the screen stays on. It shows the elapsed time, the step count
   and the live track of one mode. Tap a chip to change the mode. The big buttons are
   **Entrance**, **Checkout**, **Checkpoint**, **Note** and **Finish**. Checkpoint
   offers the labels you used before, first.
4. The app saves the walk every 10 seconds. A crash loses at most that much.
5. If the app goes to the background, the sensors stay registered. The walk keeps
   whatever Android still delivers, and a `hidden` event records the moment. Camera
   tracking pauses.
6. **View** draws every mode the walk allows over a grid of half metre cells, one
   colour each. Tick a mode to show or hide it. Pick one with the radio button to put
   the marks on it.
7. In View, the map layer shades the cells that a snap mode walked. The step model is
   a fixed length or Weinberg, and you can edit both numbers. Every track then
   recomputes. Pinch to zoom, drag to pan, double tap to fit.
8. The metrics table lists steps, turns, distance, end to start distance and the
   checkpoint errors.

## The modes

A mode id says three things: where steps come from, where the heading comes from, and
whether turns snap to right angles.

| Part    | Values |
| ------- | ------ |
| steps   | `own`: the app counts steps from the accelerometer. `hw`: the phone's step detector counts them. |
| heading | `gyro`: the gyroscope's turn rate around gravity. `game`: Android's game rotation vector (gyroscope and accelerometer, no compass). `absolute`: the rotation vector, with the compass, so the track also knows north. |
| snap    | `:snap`: a turn rounds to 90 degrees when the heading settles. This removes drift. No suffix: the raw heading. |

So `pdr:own:gyro:snap` means: the app counts the steps, the gyroscope gives the turns,
and turns snap to right angles. There are twelve such combinations, plus two more:

- `vio`: ARCore camera tracking (x and minus z of the camera position). This is the
  closest thing the test has to ground truth. With camera tracking off, there is no
  `vio`.
- `gps`: the location fixes, projected to metres. Expect it to be poor indoors.

Every track is turned so that it first walks up the screen (+y). The checkpoint error
answers "how accurate is it". Mark the same label (for example "door") at the same spot
at the start and at the end. The table then shows how far apart each track puts the two
marks.

## What records each stream

| Stream     | Source |
| ---------- | ------ |
| `motion`   | `TYPE_ACCELEROMETER` at 10 ms. One row per event, with the latest `TYPE_GYROSCOPE` reading. |
| `game`     | `TYPE_GAME_ROTATION_VECTOR` at 20 ms, as `[qx, qy, qz, qw]`. |
| `absolute` | `TYPE_ROTATION_VECTOR` at 20 ms, as `[qx, qy, qz, qw]`. |
| `magnetic` | `TYPE_MAGNETIC_FIELD` at 20 ms. Recorded, read by no mode. |
| `steps`    | `TYPE_STEP_DETECTOR`. |
| `pressure` | `TYPE_PRESSURE`. Recorded, read by no mode. |
| `location` | The fused location provider, every second. Without Play Services, `LocationManager` GPS and network. The first fix is `origin`. |
| `pose`     | ARCore `Camera.getPose()` on each tracked frame, with `poseSource: arcore`. |

Every `t` is milliseconds since the start, on the elapsed realtime clock. Sensor events
and location fixes already use that clock. A few sources use the monotonic clock
instead: some sensors on some phones do, and ARCore frames possibly do. The app checks this on
the first sample of each source and shifts that source onto the elapsed realtime clock.

## Tests

`./gradlew testDebugUnitTest` runs plain JVM tests. They cover the step detector, both
heading paths, the snap, alignment, metrics, the JSON round trip and the GeoJSON
projection.

They also replay the golden walks of the TypeScript recorder, in
`app/src/test/resources/walks`. These are unchanged copies of
`libs/luna-shopper/shop-map/recorder/src/__fixtures__/walks`. Each mode's steps and
turns must match exactly, and each end position within 0.05 m. When the TypeScript side
regenerates those fixtures, copy them here again.
