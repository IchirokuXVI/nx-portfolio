# 0003: suggested shelves and sections while you walk

> Third plan of the model library. Needs `0002` (the document in metres and the walk log).
> Consumed by velista `0126` (recording a walk), which draws what this plan computes, and
> by `editor/plans/0001`, which draws suggestions and section runs in the mapper look.
>
> Mock: `apps/velista/plans/mocks/shop-map/`, boards "Walking", "Adding a mark", "Shelf
> suggestion" and "How the map is drawn". Prerequisite reading: `0002` in full and the
> tracking states of `recorder/plans/0003`.

While somebody walks, the map grows in two ways that need no tap: the floor they walked,
and the section they are in. Shelves need one tap, because the user decided that a shelf is
a suggestion and never painted by itself. This plan is the pure state machine behind those
three things, fed one tracked point or one mark at a time.

## Brief for the agent

### Objective

Add `createLiveMap`, a framework free state machine that takes tracked points, marks and
the tracking state, and answers the walked cells, the shelf suggestions, the section run in
progress and the events to append to the walk log.

### Context

- **The document and the log** of `0002`: areas with an `origin`, marks with a heading, and
  `WalkEvent`s appended by the recording screen.
- **The tracking state** comes from `recorder/plans/0003`: `good`, `lost` or `suspect`.
  Nothing is painted unless it is `good`. The user decided this after the frame flip of the
  second El Jamón walk. There, errors of 16 to 28 m put four visits across the aisles.
- **The rules the user fixed**:
  - A shelf suggestion is a strip nobody walked, at most 2 m wide, between two walked aisles.
  - Tapping a suggestion fills it as a shelf. Otherwise nothing becomes a shelf by itself.
  - A section mark fills the shelf on the side the phone pointed. The section extends as the
    person walks along it, until they turn, mark another section or tap "Section left".
  - Walking back along a section run removes the part walked back over.
  - Walking across a suggested shelf turns it back into path. One setting for every walk
    switches this, and it is on by default. Shelves drawn by hand never change.
  - A counter mark places a 2 by 1 m counter on the side the phone pointed, which the person
    resizes by hand.

### Target state

- `createLiveMap({ document, settings })` returns a handle with `push(point)`,
  `setTracking(state)`, `mark(mark)`, `sectionLeft()`, `acceptSuggestion(id)`,
  `dismissSuggestion(id)` and `snapshot()`.
- `snapshot()` answers `{ walkedCells, suggestions, sectionRun, events }` (section 2).
  `events` are the `WalkEvent`s produced since the last snapshot, ready for the log.
- Replaying the El Jamón fixture of `0002` produces the suggestions and section runs stated
  in its `expected-live.json`, which the building session writes after checking each one on
  the plot and states in "decisions taken".

### Scope

Work only in `libs/luna-shopper/shop-map/model/**`.

Do not touch: the recorder, the editor, the backend, velista, or `0002`'s types beyond
adding what section 2 names.

### Constraints

- **The grid is 0.5 m and internal.** Cells are how the rules decide, and every area the
  rules emit is a rectangle in metres, snapped to the cells it covers.
- **Suggestions are computed, never stored.** Only an accepted suggestion becomes an
  `area-put` event with `origin: 'suggested'`.
- **Deterministic**, ids from a counter seeded by the caller.
- Zero runtime dependencies. Only make changes directly requested.

### Action boundaries

Stop and ask before: painting a shelf without a tap, painting while tracking is not `good`,
changing the 2 m limit, or letting a rule change an area whose origin is `drawn`.

### Progress evidence

Per section: the files changed and the spec run. At the end: the test and lint targets, and
a plot of the El Jamón replay with the walked cells, the suggestions and the section runs,
attached to the PR.

## 1. The rules, precisely

| Rule | Precisely |
| ---- | --------- |
| Walked | every cell within 0.5 m of a point pushed while tracking is `good` |
| Suggestion | a maximal run of never walked cells 1 to 4 cells across (0.5 to 2 m) and at least 4 cells long (2 m), with walked cells on both long sides, not covered by any area |
| Walking across | a `good` point inside a suggested shelf area (origin `suggested`) turns the covered part into a `path` area when the setting is on |
| Section start | a section mark with a heading picks the side (left or right of the walking direction) whose shelf cells are within 1.5 m in the direction the phone faced |
| Section extends | each point moves the run's end to the shelf cells beside the person, on that side |
| Section ends | a turn of more than 45 degrees held for 2 m, another section mark, or `sectionLeft()` |
| Walking back | a point that moves the person back along the run shortens it to their position |
| Counter mark | a 2 by 1 m `counter` area, its long side facing the person, 0.5 m away in the heading's direction |

A section run over cells that are not yet a shelf fills them as a shelf with the section's
name, because a section mark is also the statement that a shelf is there.

## 2. What a snapshot answers

```ts
interface LiveSnapshot {
  walkedCells: { x: number; y: number }[];         // cell indices at 0.5 m
  suggestions: { id: string; x: number; y: number; w: number; h: number }[]; // metres
  sectionRun: { section: string; areaId: string } | null; // "In section X"
  events: WalkEvent[];
}
```

## 3. Not in this plan

- Drawing any of it: `editor/plans/0001`.
- Deciding whether tracking is good: `recorder/plans/0003`.
- A shelf suggestion from anything but the walked cells, such as the camera's plane
  detection.
