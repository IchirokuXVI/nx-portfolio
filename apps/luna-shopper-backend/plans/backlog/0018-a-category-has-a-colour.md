# 0018 (backlog) A category has a colour

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-09-29 while the shop map series was rewritten (`0168`, velista `0121` and
> `0123`). The user decided that an area of a shop map is drawn in one default colour,
> that the mapper can pick another, and that a checkbox "Use the category colour" is on by
> default and disabled until categories have colours.

## Brief for the agent

### Objective

Give each root category of the app's tree a colour with a Day and a Night value, editable
in the back office, and serve it with the category, so that a shop map area whose section
covers that category draws in it.

### Context

- **The chain from an area to a colour**: a map area names a section, `0168` resolves it to
  a chain section, a chain section covers categories (`0167`, `section_categories`), and a
  category has a root in the tree (`0173`, DIA's tree).
- **The document** stores the colour mode on the area (`shop-map/plans/0002`), so maps
  saved before this plan pick the colour up with no change.
- Two sections that map to the same category share a colour. The user accepted that.

### Target state

- `categories.colour jsonb NULL` holding `{ day: '#rrggbb', night: '#rrggbb' }`, set on
  roots only.
- The back office category screen edits it, with a contrast check against the walkway
  colours of both themes.
- The shop map read resolves each area's colour when its mode is `category` and its
  section's first covered category has a coloured root.
- Velista `0123` enables the checkbox.

### Scope, constraints and boundaries

Decided when the plan is picked up. Stop and ask before colouring leaf categories.
