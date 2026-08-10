# Plan 0008 — Contact form: input labels should not use Audiowide

**Point:** R3 (your finding #3). Depends on the rule in Plan 0006.

## Problem
Every contact‑form field label (Email, Name / Nickname, Affair, Message, Links) is rendered in `Audiowide`. Per Plan 0006, `Audiowide` is a display font reserved for titles; form labels are UI content, so they should be plain, legible body‑font text.

## Root cause (exact)
`libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss` lines ~26–31:
```scss
.field {
  label {
    font-family: 'Audiowide', sans-serif;
    font-size: 0.9em;
    letter-spacing: 0.03em;
    color: var(--contact-label-color, inherit);
  }
}
```
Applies to both form instances (publishing + general contact) since they share the component.

## Proposed fix
```scss
label {
  font-family: inherit;        // system sans stack
  font-size: 0.9em;            // keep or bump to 0.95em; labels are meant to be small
  font-weight: 600;            // give the sans label some emphasis in place of the display face
  letter-spacing: 0.02em;      // reduce — the wide tracking was tuned for Audiowide
  color: var(--contact-label-color, inherit);
}
```
- Keep labels small (they *should* be); the point is they must not be Audiowide — that font is for titles only.
- Optional: also drop Audiowide from `.contact-form-success` (line ~79, same file) — it is a status message, not a title, so switch it to the body font too. Decide while here.

## Files to change
- `libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss`

## Verification
- Probe labels at 1920: computed `font-family` should no longer be `Audiowide` for `.field label` on either Contact form and on the Services form.
- Visual check en/es/fr — labels legible, aligned with inputs.
- `npx nx test damoclesSword-ui` (`contact-form.spec`), `npx nx lint damoclesSword-ui`.

## Risk
Very low. Labels get slightly narrower; verify the two‑column `.field-row` (Name / Affair) still balances.
