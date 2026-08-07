# Plan 0012 — Contact page: make the two form instances consistent

**Point:** R8 (was C5).

## Problem
The Contact page shows the same `contact-form` twice with different field arrangements:
- **Publishing form** (top, narrow right column): every field full‑width, single column.
- **General "Contact Us" form** (bottom, full width): Email full‑width, then **Name / Nickname + Affair side‑by‑side**, then Message/Links.

On one page the two instances read as two different forms.

## Root cause (exact)
The layout is width‑driven, which is fine in principle, but the two instances live in very different container widths:
- `contact-form.html` groups Name + Affair in a `.field-row`.
- `contact-form.scss`:
  ```scss
  .field-row { display: flex; gap: 1.5em; }
  @container (max-width: 640px) { .field-row { flex-direction: column; } }
  ```
- `:host { container-type: inline-size; }` — so the row collapses based on the **form's own width**.
- The publishing form sits in a ~half‑width column (`section-publishing.html` → `.publishing-form` inside `.publishing-content`), so its container is < 640px → single column. The general form (`section-general-contact.scss`, `max-width: 720px`, centered) is wide → two columns.

So it is technically "responsive", but the two forms on the same page never match at desktop.

## Options (pick one — this is a design call)
1. **Make both two‑column when space allows (consistent rule, recommended if the publishing column can widen):** widen the publishing column, or lower the `.field-row` breakpoint, so the top form also shows Name+Affair side‑by‑side at 1920. Best if you want the two forms to match.
2. **Make both single‑column (simplest, guaranteed match):** remove the `.field-row` grouping (or force `flex-direction: column` always) so every field stacks in every instance. Most predictable; loses the compact two‑column row on wide screens.
3. **Keep as‑is but make it intentional:** if the different widths are desired, accept the difference — but then it should not be filed as an inconsistency. (You chose to fix it, so option 1 or 2.)

**Recommendation:** Option 1 if the publishing layout can give the form more width; otherwise Option 2 for a guaranteed, simple match.

## Files to change
- `libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss` (`.field-row` breakpoint / behaviour)
- and/or `libs/damoclesSword/ui/src/lib/section-publishing/section-publishing.{html,scss}` (column width) for Option 1.

## Verification
- Screenshot Contact at 1920/1280/360: both forms use the **same** field arrangement at each width.
- Confirm the Services page form (`section-services-contact`, also a wide container) still matches whatever rule you pick.
- `npx nx test damoclesSword-ui`, `npx nx lint damoclesSword-ui`.

## Risk
Low. Layout‑only. If Option 1, re‑check the publishing form doesn't crowd the game card beside it at 1280.
