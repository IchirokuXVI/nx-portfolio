# Plan 06 — Contact form: unify placeholder font & fix placeholder length

**Point:** R4 (your finding #4). Two bugs, one plan.

## Problem A — Message field uses a different placeholder font
Inputs render their placeholder in **Arial 16px**; the **Message `<textarea>` renders in monospace ~13px**. On both Contact form instances the Message placeholder visibly differs from every other field.

### Root cause (exact)
`libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss` lines ~33–44 set sizing but **no `font-family`** on the controls:
```scss
input, textarea {
  /* ... */
  font-size: 1em;   /* no font-family here */
}
```
Form controls do **not** inherit font by default: browsers give `<input>` a UA font (Arial) and `<textarea>` the UA `monospace` family. With no author `font-family`, the textarea stays monospace and its default metrics also drop the effective size (~13px). Placeholders inherit from the control, so the mismatch shows there too.

### Fix
```scss
input, textarea {
  font-family: inherit;   // both now use the system sans stack
  font-size: 1em;         // now consistent since family matches
  line-height: 1.4;
  /* ...existing border/color/padding... */
}
```
`font-family: inherit` (or an explicit `Arial, sans-serif` to match the current input look) fixes both the family and the apparent size in one line. Placeholder colour rule (`&::placeholder { color:#8a8a8a }`) already applies to both.

## Problem B — placeholders overflow below 1920
Long placeholder strings get clipped in the narrower fields at 1280 (two‑column Name/Affair row) and 360. Worst: the Affair placeholder *"Tell me what the subject of the message is"* → clipped to "…the messi" at 360.

### Root cause
Single‑line inputs clip overflow; the copy is simply too long for the field width. Strings live in `libs/damoclesSword/ui/assets/i18n/{en,es,fr}.json`, keys:
```
contact-form.email-placeholder   "We will reply to this email address"
contact-form.name-placeholder    "We will address you by this name"
contact-form.affair-placeholder  "Tell me what the subject of the message is"   <- longest
contact-form.links-placeholder   "Any links to additional information?"
```

### Fix (choose; recommend 1)
1. **Shorten the copy** in all three locales, e.g.
   - affair → "Subject of your message"
   - email → "Your email address"
   - name → "How should we call you?"
   - links → "Any relevant links?"
   Keeps it readable at every width. Must be updated in `en/es/fr` together.
2. **Responsive placeholder size:** reduce input `font-size` under the form's container query (`@container (max-width: 640px)`) so more text fits — helps but doesn't fully solve very narrow (360).
3. Rely on the label (already present) and accept a terse placeholder — combine with (1).

## Files to change
- `libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss` (Problem A)
- `libs/damoclesSword/ui/assets/i18n/en.json`, `es.json`, `fr.json` (Problem B, option 1)

## Verification
- Probe placeholders at 1920/1280/360: `input` and `textarea` report the **same** `font-family` and size.
- Visually confirm no placeholder is clipped at 1280 (Name/Affair row) or 360 for en/es/fr.
- `npx nx test damoclesSword-ui`, `npx nx lint damoclesSword-ui`.

## Risk
Very low for Problem A. For Problem B keep the three locale files in sync and re‑measure the longest translated string (es/fr are often longer than en).
