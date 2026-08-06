# damoclesSword — Visual QA Round 2: confirmed issues to fix

Follow‑up to the first pass (`00-common-issues.md`, `1920x1080.md`, `1280x720.md`, `360x800.md`). This file records the problems that **will be fixed**: your five new findings plus the earlier findings you did **not** dismiss. Each was re‑checked live with Playwright + computed styles; the offending source file is named so the plans can be actioned. The dismissed points and their reasons are in `round-2-dismissed-points.md`. A planning file for every point below lives in `apps/damoclesSword/plans/`.

*Note:* the previous reports are left unchanged, as requested.

---

## Verification of your five new findings — all confirmed ✅

### R1 · Audiowide at weight 400 + small size looks bad (usage rule) — **your finding #1**
`Audiowide` (`libs/damoclesSword/ui/src/lib/styles/fonts.scss`) is a single‑weight (400) display face. It is applied at sub‑heading sizes in several places, which is where it looks bad:

| Usage | File | Size |
| --- | --- | --- |
| About "WHO WE ARE" / "IN THE FUTURE" body | `section-who-we-are.scss`, `section-future.scss` → `.content-text span` | `1.15em` ≈ 18.4px |
| Contact form input **labels** | `contact-form.scss` → `.field label` | `0.9em` ≈ 14.4px |
| Contact form‑title subtitles ("Contact Us", "Starlit: Ascension") | `double-bordered-title` used inside the form (no `.section-title` wrapper) | ~16–24px |
| Services "TELL US YOUR NEEDS" sub‑label | `section-services-contact.scss` → `.contact-subtitle` | `1em` ≈ 16px |
| Info‑card titles (OUR APPROACH / VALUES / FIT) | `info-card.scss` → `.info-card-title` | `1.15em` ≈ 18.4px |

**Rule to adopt:** Audiowide (400) is only legible from ~**1.5em (≈24px) upward**; below that use the sans‑serif body font. Plan: `plans/01-audiowide-usage-rule.md`.

### R2 · Card images not aligned when titles differ in height — **your finding #2**
Confirmed by measurement at 1920. Under Services **"WHAT DO WE DO?" → OUR APPROACH** (the three `info-card`s):

| Card | Title lines | Title height | Image top |
| --- | --- | --- | --- |
| Direct Contact With The Client | 1 | 23px | **582px** |
| Professional And Innovative Development | 2 | 46px | **605px** |
| Investigation Of New Technologies | 2 | 46px | **605px** |

→ the first card's placeholder image sits **23px higher** than the other two. Same fragile structure in **About → OUR VALUES**: at 1920/1280 all four titles are one line so images happen to align (top 1032 / 1000), but any wrapped title — a longer string or another locale (es/fr) — will break it. Root cause: `info-card` is a per‑card flex column, so a taller title pushes its own image down. Plan: `plans/05-card-image-alignment.md`.

### R3 · Audiowide used as an input label — **your finding #3**
`contact-form.scss` line ~27: `.field label { font-family: 'Audiowide', sans-serif; font-size: 0.9em; }`. Confirmed 14.4px Audiowide on every label (Email, Name / Nickname, Affair, Message, Links). Plan: `plans/03-input-label-font.md`.

### R4 · Contact form placeholder fonts differ + placeholders too long < 1920 — **your finding #4**
Two bugs in one:
1. **Different font on the Message field.** `contact-form.scss` sets `font-size` on `input, textarea` but **not `font-family`**, so the controls keep their user‑agent fonts: `<input>` → **Arial 16px**, `<textarea>` → **monospace 13px**. Confirmed on both form instances. The Message placeholder therefore renders in a monospace typeface at a smaller size than every other field.
2. **Placeholders overflow below 1920.** Long strings — worst is the Affair placeholder *"Tell me what the subject of the message is"* (`contact-form.affair-placeholder`) — get clipped in the narrower fields at 1280 (two‑column row) and 360 (visibly cut to "…the messi"). Strings live in `libs/damoclesSword/ui/assets/i18n/{en,es,fr}.json`.

Plan: `plans/06-contact-placeholder-font-and-length.md`.

### R5 · "Starlit: Ascension" & "Contact Us" subtitles too small at 1920 (you tied this to C4) — **your finding #5**
Confirmed: "Starlit: Ascension" = `Audiowide 24px`, "Contact Us" = `Audiowide 16px`, both `text-transform: none` (Title Case). Root cause: `section-layout.scss` gives real section titles `.section-title { font-size: 2em; text-transform: uppercase; }`, but form titles render `double-bordered-title` **directly inside the contact form** (`contact-form.html`, `section-publishing.html`, `section-services-contact.html`), bypassing `.section-title` — so they inherit ~1em and keep their Title‑Case source text. This is the same root as C4, so they are handled together. Plan: `plans/04-section-subtitle-casing-size.md`.

---

## Earlier findings you did NOT dismiss (carried forward)

### R6 · About body copy uses the display font (was **C1**) 🔴
`section-who-we-are.scss` & `section-future.scss` → `.content-text span { font-family:'Audiowide'; font-size:1.15em }`. Long paragraphs in a 400‑weight display font at 18.4px; every other body paragraph on the site is the `-apple-system` sans stack. Overlaps R1. Plan: `plans/02-about-body-font.md`.

### R7 · Inconsistent title capitalization (was **C4**, now merged with R5) 🟠
Section titles are forced UPPERCASE by `section-layout`; form/sub‑section titles ("Contact Us", "Are You Interested In Our Work?") stay Title Case. Same plan as R5: `plans/04-section-subtitle-casing-size.md`.

### R8 · Contact page shows two differently‑laid‑out forms (was **C5**) 🟠
Same `contact-form` component renders single‑column in the narrow publishing column and two‑column (Name+Affair row) in the full‑width general form, via the `@container (max-width: 640px)` rule in `contact-form.scss`. On one page the two instances look inconsistent. Plan: `plans/07-contact-form-layout-consistency.md`.

---

## Low‑priority leftover (no separate plan)

### R9 · Uneven heading‑size hierarchy across sections (was 1920‑F) 🟡
Peer‑level titles compute to different sizes (e.g. 24px section sub‑headers vs 18.4px card titles). This is largely a symptom of the same Audiowide‑sizing gap and will be tightened by R1 + R5; no dedicated plan is proposed. Raise it explicitly if you want its own task.

---

## Point → plan map

| Point | Related earlier ID | Plan file |
| --- | --- | --- |
| R1 Audiowide usage rule | — (your #1) | `plans/01-audiowide-usage-rule.md` |
| R6 About body font | C1 | `plans/02-about-body-font.md` |
| R3 Input‑label font | your #3 | `plans/03-input-label-font.md` |
| R5 + R7 Subtitle casing & size | C4 + your #5 | `plans/04-section-subtitle-casing-size.md` |
| R2 Card image alignment | your #2 | `plans/05-card-image-alignment.md` |
| R4 Placeholder font & length | your #4 | `plans/06-contact-placeholder-font-and-length.md` |
| R8 Two contact‑form layouts | C5 | `plans/07-contact-form-layout-consistency.md` |
