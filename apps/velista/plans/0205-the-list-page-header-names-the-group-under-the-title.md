# 0205: the list page header names the group under the title

> Decided on 2026-11-22. The zone list page draws the group of the list ("in Casa") as the
> first line of its pinned head block, under the page header and above the search field. The
> owner moves it into the page header: the title stays the list's name ("Compra semanal"),
> and under it, smaller, the group ("in Casa"). The head block loses a line, and the list
> gets that room.
>
> Amended on 2026-11-23: when enlarged text leaves no room for both lines in the 64 px header,
> the group line is hidden and only read out.
>
> Amends velista `0130`, rule H2 and its consequence ("a header holds only a title; a
> subtitle ... is page content and goes below it"): a header may now hold one optional
> subtitle line under the title, inside the same block size (rule H1 holds: 64 px, no input
> makes it taller). Amends velista `0189` (the head block's first line).
>
> Independent of every other plan of this round. It touches
> `libs/velista/feature-lists/src/lib/list-page/list-page.html`, which velista `0199`, `0202`
> and `0203` also touch (other regions: the header's actions, the line lists); whichever
> merges second resolves the conflict. It needs no mock: it moves an existing line, in the
> existing type scale. The mock of velista `0202` (`apps/velista/plans/mocks/compact-reel/`)
> draws the zone list header this way, so the owner sees it there.
>
> Code anchors, on `dev` at `1c57f0c9c`: `libs/velista/ui/src/lib/layout/page-header.ts:12`
> to `:75` (rules H1 to H6, the inputs), `page-header.html:26` (`<h1 class="title">`),
> `page-header.scss:71` to `:80` (`.title`); `libs/velista/ui/src/lib/styles/_semantic.scss:211`
> (`--app-header-height: 64px`) and `:215` (`--app-header-title-size`);
> `libs/velista/ui/src/lib/list/list-header.html:1` to `:9` (the "in group" line) and
> `list-header.scss:8` to `:20` (`.in-group`, and `.viewers` placed under it);
> `libs/velista/feature-lists/src/lib/list-page/list-page.html:13` to `:18` (the page header)
> and `:64` to `:68` (`lib-list-header`); `libs/velista/feature-lists/src/lib/list-page/list-page.ts:626`
> (`zoneName`); the key `list.header.inGroup` ("in {{name}}").

## Brief for the agent

### Objective

Give the page header an optional subtitle line under its title, and use it on the zone list
page for the group ("in Casa"), removing that line from the head block.

### Context

- `PageHeader` draws one title in one line at `--app-header-title-size`, in a block of
  `--app-header-height` (64 px). Twenty nine templates draw it; none passes a subtitle.
- The head block (`lib-list-header`) draws the group line, then who else is here, then the
  stale band. With nobody else here, the group line is the whole block in the usual case.
- On a cold arrival the list's name is not known yet: the title is the word for the page
  (rule H6), and `zoneName` is null.

### Target state

1. **The header.** `PageHeader` gains `subtitle = input<string | null>(null)`. With one, the
   title and the subtitle are stacked in the title's place: the title as today, one line,
   cut with an ellipsis; the subtitle under it in `--app-text-xs` and `--app-text-muted`, one
   line, cut with an ellipsis. Both fit in the 64 px block; the block's size does not change.
   The subtitle is a `p` beside the `h1`, not inside it, so the page's heading stays the list
   name.
   When enlarged text leaves no room for both lines in the 64 px block, the subtitle is
   hidden and only read out: the title is shown alone, centred as on a page with no
   subtitle, the block stays 64 px, and no subtitle is ever shown clipped or in part. The
   decision follows the real space (the stylesheet wraps a line that does not fit out of
   view), not a guessed text size, and an empty reserved line is hidden by the same rule.
2. **No jump.** A page that will have a subtitle can reserve its line while it loads (an
   empty string draws an empty line of the same height), so the title does not move when the
   group arrives. The list page passes `''` until `zoneName` is known, and null when the list
   has no group.
3. **The list page** passes `'list.header.inGroup' | rokuT: { name: zoneName }` as the
   subtitle.
4. **The head block** draws no group line. The viewers row and the stale band keep their
   order; the viewers row loses the margin that separated it from the group line, and the
   head block's gap to the field is unchanged.
5. The doc comment of `PageHeader` states H2 as amended, with the date of the ruling. Every
   other page draws exactly as before.

### Scope

- Work in `libs/velista/ui/src/lib/layout/page-header.*`, `libs/velista/ui/src/lib/list/list-header.*`
  and `libs/velista/feature-lists/src/lib/list-page/list-page.html`.
- Do NOT add a subtitle to any other page, and do NOT change the line page's use of
  `list.header.inGroup`.

### Constraints

- Rule T1, the hygiene and contrast specs (the muted subtitle on the header surface, Day and
  Night).
- No dashes as punctuation in comments.

### Action boundaries

- At a text size where the title and the subtitle do not both fit the 64 px block, the
  subtitle is hidden and only read out (the owner's ruling of 2026-11-23); the block never
  grows.

### Progress evidence

The specs of section 1; `npx nx affected -t lint test`; `npx nx build velista`; screenshots
on a slot at 390 by 844 and 360 by 800, Day and Night, of a list with a long name and a long
group name, of a cold arrival, and of the home page header unchanged.

## 1. Specs

1. `PageHeader` with a subtitle draws it under the title, outside the `h1`; without one, its
   DOM is as before.
2. An empty subtitle draws an empty line of the subtitle's height.
3. The list page passes "in Casa" as the subtitle, and `lib-list-header` draws no group line.
4. The head block with nobody else here and a live list is empty above the field.
5. The subtitle shows when both lines fit the block; when they do not, it is hidden whole,
   the title is centred alone, and the subtitle is still in the accessibility tree.

## 2. Acceptance criteria

- The zone list page header reads "Compra semanal" with "in Casa" under it.
- The head block above the search field is one line shorter.
- No other page changes.

## Not in this plan

- A subtitle on any other page.
