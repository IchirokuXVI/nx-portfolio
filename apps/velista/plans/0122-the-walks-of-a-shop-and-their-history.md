> **PR:** [#570](https://github.com/IchirokuXVI/nx-portfolio/pull/570)

# 0122: the walks of a shop, and their history

> Rewritten on 2026-09-29. The first version was an editor page with a tool strip for any
> shopper, and nothing of it was built. Editing by hand is now `0123` and recording is
> `0126`.
>
> Mock: `mocks/shop-map/`, published at https://claude.ai/artifact/Q3iEPafsH5G9Aqgvkgqi1f.
> The boards "The shop map, for somebody who maps", and the group "Walks and their history":
> "Walks of a shop", "Settings for every walk", "History of a walk", "Rewind" and "Walk
> settings", plus "Resuming the walk shoppers see" from the group of stops and resumes. Day
> and Night.
>
> Needs `0121` (the map page), backend `0175` (permissions on `me`) and `0168` (walks and
> their log), and `libs/luna-shopper/shop-map/plans/0002` (`foldWalk`, `stateAt`,
> `walkTimeline`) with the editor's mapper look for the rewind preview. Prerequisite
> reading: backend `0168` sections 2 and 3, and `CLAUDE.md` on sheets and going back.

Only an account with the `shopMap.record` permission sees any of this, and today that is
an admin. The map page shows it a Walks button. Behind it is the list of the shop's walks,
one marked "Shown to shoppers". A walk opens on its history, newest first: every save, stop,
edit and rewind is an entry, and nothing is ever deleted. Rewind is a slider over the whole
history, and continuing from a point adds a "Rewound to" entry, so going back to a point
before a rewind is one more rewind.

## Brief for the agent

### Objective

Read the account's permissions, show the Walks button on the map page with
`shopMap.record`, and add the walks list, a walk's history, the rewind screen, a walk's
settings, the settings for every walk and the warning before resuming the shown walk. Use
the `nx-portfolio-angular-developer` skill and `design-taste-frontend`.

### Context

- **Permissions**: `GET /v1/account/me` answers `permissions` (backend `0175`). They change
  at most one access token lifetime after an operator grants a role.
- **The routes** of backend `0168` section 3: list, create, rename, show, delete, one walk
  with its timeline, and the log for a preview.
- **The library**: `walkTimeline(entries)` gives the slider's markers, and
  `stateAt(entries, logMs)` gives the map at a point, which the editor draws with
  `setFadedAfter(logMs)`.
- **Decisions of the mock** (all fixed):
  - Walks: "El Jamón · <address>" under the title, one row per walk with its name, "Shown to
    shoppers", its last change, its entry count and its mark count, a menu per walk, a
    button for the settings of every walk, and "Start a new walk" at the bottom.
  - History: the walk's name with "History" under it, buttons Rewind, Edit map and Resume
    walking, entries grouped by day with their time, a title ("Resumed at Lácteos",
    "Stopped by a tracking problem", "Edited without walking", "Rewound to 12:52") and a
    detail line, the newest marked "Latest".
  - Rewind: the title "Rewind · <walk>" with "<chain> · <address>" under it, the map with
    what comes after the chosen moment faded, the moment in large text, a slider in 15 s
    steps across the whole history with a marker for each entry, buttons that jump to an
    entry, and "Continue from here". No 15 s buttons.
  - Walk settings: the name, "Show this walk to shoppers" with its sentence ("A shop shows
    the map of one walk. Turning this on hides the others. Shoppers see changes after each
    save."), and "Delete this walk".
  - Settings for every walk: "Walking across a shelf makes it a path", on by default.
  - Resuming the shown walk first asks, with "Resume anyway", "Start a new walk" and
    "Cancel".

### Target state

1. **Permissions** in velista's account model (rule D4), and the map page's Walks button
   when the account has `shopMap.record`.
2. **Walks**, `shops/:locationId/walks`, as the mock draws it. "Start a new walk" asks for
   a name in a sheet and creates the walk.
3. **History**, `shops/:locationId/walks/:walkId`. Edit map and Resume walking lead to the
   routes of `0123` and `0126`, and are absent until those plans add them.
4. **Rewind**, `shops/:locationId/walks/:walkId/rewind`: reads the log, folds on the phone,
   and appends a `rewound` entry on "Continue from here".
5. **Walk settings**, `shops/:locationId/walks/:walkId/settings`, with rename, show and
   delete. Delete asks for confirmation in a sheet.
6. **Settings for every walk**, `shops/:locationId/walks/settings`, stored in the account's
   device storage (`libs/velista/platform`, `storage-keys.ts`) under one key.
7. **The warning** before resuming the shown walk, a sheet under the history page.

### Scope

Work in `libs/velista/feature-shop-map`, `libs/velista/data-access` (a `ShopWalksStore`
with an in memory twin, permissions on the account), `libs/velista/models`,
`libs/velista/platform` (the storage key), `libs/velista/feature-shell/src/lib/routes.ts`
and its spec, the locale files, and the specs of each.

Do not touch: the backend, the libraries beyond consuming them, recording and editing.

### Constraints

- Nothing here is reachable without `shopMap.record`: the routes carry a guard that sends
  anybody else to the map page, and the Walks button is absent for them.
- A rewind is always an appended entry. The phone never edits the history.
- The sheet and back rules of `CLAUDE.md`. No `@angular/core/rxjs-interop`. `svh` only.
  Every string is a key.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: letting an account without the permission read a walk, deleting
entries, storing the settings for every walk on the server, or adding 15 s buttons back.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched libraries, `npx nx build velista`, and a walk on a phone against a slot
serving backend `0168` with the El Jamón fixture log: list, rename, show, rewind twice
including past the first rewind, and the resume warning, in Day and Night.

## 1. Not in this plan

- Editing by hand: `0123`. Recording: `0126`.
- Granting the permission: admin `0038`.
