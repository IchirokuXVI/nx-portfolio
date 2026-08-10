# Plan 0009 — Form/sub‑section titles: fix casing and size

**Points:** R5 (your finding #5) + R7 (was C4). Related to Plan 0006 (these headings are genuine titles, so they *keep* Audiowide — the issue here is casing and size, not the font choice).

## Problem
Two related inconsistencies on the same titles:
1. **Casing.** Real section titles are UPPERCASE; the contact form titles stay **Title Case** — "Contact Us", "Starlit: Ascension", "Are You Interested In Our Work?".
2. **Size.** Those titles are tiny — "Contact Us" = `Audiowide 16px`, "Starlit: Ascension" = `Audiowide 24px` — because they render at the inherited ~1em instead of the real title size.

## Root cause (exact)
- `libs/damoclesSword/ui/src/lib/section-layout/section-layout.scss` gives real titles their treatment:
  ```scss
  .section-title { font-size: var(--section-title-font-size, 2em); text-transform: uppercase; }
  @container (max-width: 800px) { .section-title { --section-title-font-size: 1.5em; } }
  ```
- But form titles put `double-bordered-title` **directly inside the contact form**, so they never pass through `.section-title`:
  - `contact-form.html` → default title `contact-form.default-title` ("Contact Us")
  - `section-publishing.html` → `contact-form-title` = "Starlit: Ascension"
  - `section-services-contact.html` → `contact-form-title` = "Are You Interested In Our Work?" + a `.contact-subtitle` ("TELL US YOUR NEEDS")
- `double-bordered-title.scss` sets **no font-size and no text-transform** of its own — it inherits both. Inside the form that means ~1em and the raw (Title‑Case) source string.

## Proposed fix
Give the form‑title slot the same "title" treatment as `.section-title`. Preferred: a shared class so it stays consistent.

1. In `contact-form.scss`, style the heading wrapper that hosts the projected/default title:
   ```scss
   .contact-form-heading {
     font-size: 1.75em;          // match the real section-title size
     text-transform: uppercase;  // match section titles
     margin-bottom: 0.5em;
   }
   @container (max-width: 640px) {
     .contact-form-heading { font-size: 1.5em; }
   }
   ```
   Because `double-bordered-title` inherits size + transform, this lifts "Contact Us", "Starlit: Ascension" and "Are You Interested In Our Work?" to a proper, uppercase title in one place.

2. **Proper‑noun exception:** "Starlit: Ascension" is a game name. If uppercasing it is undesirable, opt that one instance out (e.g. a `data-keep-case` / modifier class on the publishing `double-bordered-title` that sets `text-transform: none`) while still getting the larger size. Decide with design; default is to uppercase everything for consistency.

3. `section-services-contact.scss` `.contact-subtitle` ("TELL US YOUR NEEDS") uses `Audiowide` — but it is a sub‑title/caption, not a title, so per Plan 0006 switch it to the body font. Co‑located here since it sits directly under the same title.

## Files to change
- `libs/damoclesSword/ui/src/lib/contact-form/contact-form.scss` (`.contact-form-heading`)
- `libs/damoclesSword/ui/src/lib/section-services-contact/section-services-contact.scss` (`.contact-subtitle`)
- optional: `section-publishing.html` (proper‑noun opt‑out for "Starlit: Ascension")

## Alternative approach
Route the form titles through the real `.section-title` styling by extracting its title rules into a shared `%section-title` placeholder/mixin and `@extend`/`@include` it in `.contact-form-heading`. More DRY; slightly more refactoring. Recommended if you want a single source of truth for title styling.

## Verification
- Probe at 1920/1280/360: "Contact Us", "Starlit: Ascension", "Are You Interested In Our Work?" render uppercase (except any agreed proper‑noun exception) at ≥24px.
- Check the three consumers (general contact, publishing, services contact) all pick up the change.
- `npx nx test damoclesSword-ui`, `npx nx lint damoclesSword-ui`.

## Risk
Low–medium. Enlarging the heading changes form vertical spacing; re‑check the narrow publishing column (form sits in a ~half‑width column at 1920) doesn't overflow or wrap awkwardly. This also resolves the 1920‑F size‑hierarchy note.
