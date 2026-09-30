> **PR:** [#543](https://github.com/IchirokuXVI/nx-portfolio/pull/543)

# 0004: the Android walk app is deleted

> Decided by the user on 2026-09-29. `apps/shop-walk-android` (PR #522) was built for the
> shop map field test under this library's plan `0002`. The field test is over, velista
> records walks with the camera through WebXR (velista `0126`), and the native app is no
> longer needed. This plan lives here rather than in the app's folder, because it deletes
> that folder.
>
> Prerequisite reading: `apps/shop-walk-android/README.md`, this library's `README.md`
> (its fixtures section and "Rules the plan left open", both of which name the Kotlin port),
> `src/lib/walk-file.ts` and `src/lib/walk-import.ts` (the `platform` field), and
> `tools/release/rules.mjs` (the `android` scope).

The app is not an Nx project, no CI job builds it, and nothing imports it. What it shares
with the rest of the repository is a promise: the Kotlin engine replays the recorder's
golden walks to the same numbers, and the README and three source comments say so. Its
golden walks are copies of the recorder's own fixtures. The walks it recorded in real shops
(the El Jamón walks of 2026-09-28 and 2026-09-29) are files marked `platform: 'android'`,
and they must stay readable, because they are the only camera walks there are.

## Brief for the agent

### Objective

Delete `apps/shop-walk-android`, remove every statement that a Kotlin port exists or must
agree, and keep walk files recorded by the app readable.

### Context

- **The app**: 48 tracked files under `apps/shop-walk-android`, with its own `.gitignore`.
  The debug APK lives on the owner's machine, not in the repository.
- **Golden walks**: `app/src/test/resources/walks/{l-shape,serpentine,straight-aisle}` copy
  `libs/luna-shopper/shop-map/recorder/src/__fixtures__/walks/`. The recorder keeps its
  own.
- **Mentions of the port**: the recorder README (line 5, the fixtures section, and the
  opening of "Rules the plan left open"), `walk-file.ts` (the header comment and the `app`
  comment), `estimators.ts` (the header comment and the note on `Math.round`), and plan
  `0002` of this library, which is built and stays as it is.
- **The release scope** `android` names the app. Titles of merged PRs use it, and the
  release notes generator reads them.

### Target state

- `apps/shop-walk-android` does not exist.
- The recorder README and the three source comments no longer promise a Kotlin port. The
  rules they list stay, as this implementation's rules.
- `WalkFile.source.platform` stays `'web' | 'android'`, and `readWalkFile` still reads a
  file from the app. A spec reads the committed `l-shape` walk with its platform set to
  `android`.
- `tools/release/rules.mjs` keeps the `android` scope, with its comment saying that the app
  was deleted by this plan and that the scope stays so older titles still parse.
- Plan `0002` of this library gets one line under its PR header: "The Android app was
  deleted by `0004`."

### Scope

Work only in `apps/shop-walk-android` (deleting it), `libs/luna-shopper/shop-map/recorder`
(the README, the comments, one spec, the line in plan `0002`), and the comment in
`tools/release/rules.mjs`.

Do not touch: the walk file format, the recorder's behaviour, the velista walk lab.

### Constraints

- **Nothing that reads a walk file changes behaviour.** An `android` walk reads exactly as
  before.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: removing `android` from the walk file's `platform`, removing the
release scope, or deleting any walk file that the app recorded.

### Progress evidence

The deleted tree, `git grep -n -i "kotlin\|shop-walk-android"` answering only plan files
and the release rule, `npx nx test luna-shopper/shop-map/recorder` and its lint
target, and `node tools/release/release-notes.mjs --check "feat(android): x"` still
passing.
