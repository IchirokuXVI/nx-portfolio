# 0040 The sections panel says when a map writes the list

> The part of `0037` that PR #527 left out because backend `0168` was on hold: target 2's
> notice on a shop's section list. `0037`'s target 3 (per shop pins from a map) is dropped,
> because the rewritten `0168` stores no product anchors and derives no pins.
>
> Needs backend `0168` (`hasMap` on the admin location read, and the shown walk rewriting
> `location_sections`). Prerequisite reading: `0037` target 2 and its sections panel, and
> backend `0168` section 4.

When a shop has a walk shown to shoppers, every save of that walk rewrites the shop's
ordered section list. An operator who reorders the list by hand in the back office loses
that change at the next save, and nothing on the screen says so today.

## Brief for the agent

### Objective

On a location's sections panel, show a notice when the shop has a map, and ask for
confirmation before a hand edit of its section list. Use the `nx-portfolio-angular-developer`
skill.

### Context

- **The panel** is `0037`'s: the shop's sections in order, with add, remove and reorder.
- **`hasMap`** comes on the admin location read (backend `0168`).

### Target state

1. With `hasMap`, the panel shows "This list follows the shop's map. The next save of the
   map's walk replaces any change made here."
2. With `hasMap`, the first edit of the list in a visit asks for confirmation with the same
   sentence.
3. The in memory gateway holds one location with a map. Screen specs cover both.

### Scope

Work only in the back office library that holds `0037`'s sections panel, its data access
twin, `ui/assets/i18n/en.json`, and the specs.

Do not touch: the backend, velista, the panel's behaviour without a map.

### Constraints

- Only make changes directly requested.

### Action boundaries

Stop and ask before: blocking edits of a mapped shop's list outright, or showing the map in
the back office.

### Progress evidence

Per target: the files changed and the spec run. At the end: `npx nx test` and `npx nx lint`
for the touched library, and `npx nx build luna-shopper-admin`.
