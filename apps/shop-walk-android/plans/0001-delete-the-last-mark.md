# 0001: delete the last mark

> First plan of the Android walk app (PR #522 built the app without a plan file). Asked for
> on 2026-09-29 after the second El Jamón walk, with the same request for the velista walk
> lab, which is velista `0127`.
>
> Prerequisite reading: `app/src/main/java/com/ichirokuxvi/shopwalk/recording/Recorder.kt`
> (`mark`, the in memory `marks` list, `snapshot`), `ui/RecordScreen.kt` (the mark buttons
> and `LabelDialog`), and the app's `README.md` for how to build it (`JAVA_HOME` set to
> Android Studio's `jbr`).

The user marked a wrong checkpoint during a walk and had no way to take it back. They asked
for a button that deletes the last mark, and only that.

## Brief for the agent

### Objective

Add a "Delete last mark" button to the recording screen that removes the most recent mark
from the walk being recorded.

### Context

- `Recorder.mark(kind, label)` appends to an in memory `ArrayList<WalkMark>`, which is copied
  into the walk only when it is finished or snapshotted, so removing the last element is
  enough while recording.
- The recording screen shows the mark buttons and the last mark.

### Target state

- `Recorder.deleteLastMark(): WalkMark?` removes and answers the last mark, or null when
  there is none, under the same lock `mark` uses.
- The recording screen shows "Delete last mark" when the walk has a mark, next to where the
  last mark is shown. It asks nothing. The screen then shows the mark before it.
- A unit test for `deleteLastMark`.

### Scope

Work only in `apps/shop-walk-android/app/src/main/java/com/ichirokuxvi/shopwalk/recording/Recorder.kt`,
`ui/RecordScreen.kt` and the app's tests.

Do not touch: the walk file format, the engine, velista.

### Constraints

- Only make changes directly requested.

### Action boundaries

Stop and ask before: deleting more than the last mark, or adding an undo.

### Progress evidence

The files changed, the unit test run with Gradle, and a debug APK copied to
`~/Downloads/shop-walk-debug.apk` with one mark deleted during a test walk.
