# damoclesSword — Visual QA: Cross‑resolution issues

**Method:** Playwright screenshots of every damoclesSword page compared against the **Home** page (the reference), at 1920×1080, 1280×720 and 360×800. Full‑page captures plus DOM/computed‑style probes. No code was changed.

**Pages compared** (routes from `libs/damoclesSword/feature-shell/src/lib/routes.ts`):

| Page | URL |
| --- | --- |
| Home (reference) | `/en/damoclesSword` |
| Services | `/en/damoclesSword/services` |
| About | `/en/damoclesSword/about` |
| Contact | `/en/damoclesSword/contact` |

This file lists issues that reproduce at **every** resolution, so they are described once here instead of being repeated in each resolution file. The per‑resolution files (`1920x1080.md`, `1280x720.md`, `360x800.md`) cover what is specific to that width and reference these by number (C1…C7).

---

## C1 — Wrong font on About body copy (most jarring) 🔴

The two dark sections of the **About** page render their **body paragraphs in `Audiowide`** — the geometric display font that is meant only for headings/titles — at 18.4px:

- "WHO WE ARE" paragraphs ("We are a studio born from the passion…")
- "DAMOCLE'SWORD IN THE FUTURE" paragraphs ("We are a team with high expectations…")

Every other body paragraph on the whole site uses the system sans‑serif stack (`-apple-system, …, sans-serif`), including:

- The **"OUR VALUES"** intro and value cards **on the same About page** (`.values-intro`, `.info-card-description`).
- All body copy on Home (`.subsection-description`, `.card-main-content`), Services and Contact.

So the About page mixes two body fonts, and the black‑section copy uses a decorative title font for multi‑line paragraphs — hard to read and clearly out of place next to the rest of the site. Reproduces at all three widths (worst on 360, where it becomes a narrow column of display‑font text).

*Evidence:* computed `font-family` first token = `Audiowide` for the About black‑section `<span>` text vs `-apple-system` everywhere else.

## C2 — Empty media placeholders (pages look unfinished) 🔴

Many image/video slots have **no source** and render as blank rectangles. These are not broken `<img>` (no 404s) — they are placeholder containers with nothing assigned:

- **Home:** "Realistic Interactor" project image and the "Starlit: Ascension" video are empty `<video>` elements (blank black boxes). Only "VR Sickness Reducer" has a real image, and the hero has a real video.
- **About:** the "WHO WE ARE" image, all **4** "OUR VALUES" card images, and the "IN THE FUTURE" image are all empty.
- **Services:** all **3** "OUR APPROACH" images, all **4** "WHERE WE FIT IN" images, and both "OUR PROJECTS" card images are empty.
- **Contact:** the "Starlit: Ascension" game‑card image is empty.

Because Home at least shows real media in most slots, the other three pages look conspicuously unfinished by comparison.

## C3 — Two different empty‑placeholder colors 🟠

The empty boxes from C2 come in **two inconsistent treatments**:

- **Pure black** on dark sections (WHO WE ARE, IN THE FUTURE, OUR APPROACH, WHERE WE FIT IN) — the box is effectively transparent over the black section.
- **Light grey** on the card components (OUR VALUES cards, OUR PROJECTS cards).

There is no single empty‑state style; the same "missing image" reads differently depending on where it sits.

## C4 — Inconsistent title capitalization 🟠

Main section titles are forced **UPPERCASE** via `text-transform: uppercase` (e.g. "WHO WE ARE", "OUR VALUES", "WHAT DO WE DO?", "LOOKING FOR PUBLISHING", "WE ARE LOOKING FOR PEOPLE").

But several secondary / form sub‑titles are rendered in **Title Case** with `text-transform: none`, so they clash with the all‑caps headers around them:

- "Are You Interested In Our Work?" (Services, contact block)
- "Contact Us" (Contact, bottom form)
- "Starlit: Ascension" (Contact + Home form label — defensible as a proper noun, but still visually a different casing rule)

Pick one convention. "Contact Us" and "Are You Interested In Our Work?" in Title Case look out of place next to the uppercase section titles.

## C5 — Two different contact‑form layouts on the Contact page 🟠

The Contact page shows the same contact form twice, laid out differently:

- **Top** ("Starlit: Ascension" publishing form, narrow right column): every field is full‑width, single column.
- **Bottom** ("Contact Us" general form, full width): Email full‑width, then **Name / Nickname and Affair side‑by‑side** in two columns, then Message/Links.

It is driven by container width, but on the same page the two instances look inconsistent. The Services page's "Are You Interested In Our Work?" form uses the two‑column arrangement, so the top Contact form is the odd one out.

## C6 — Header changes style **and** collapses to a hamburger between 1920 and 1280 🟠

- At **1920** the header is a **light/white bar** with the **full inline nav** (HOME · OUR SERVICES · ABOUT US · CONTACT) and a black angled logo block on the left.
- At **1280 and 360** the header is a **solid dark bar** with a **hamburger** icon — even at 1280, where there is plenty of room for the inline nav.

So the desktop→mobile switch happens very early (the inline nav is already gone at 1280, a common laptop width) and the header also flips colour. Consistent across all four pages, so it is a global breakpoint choice rather than a per‑page bug — but flagged because 1280 is one of the requested resolutions and the collapse looks premature there. Detailed per‑width in `1280x720.md`.

## C7 — Home hero quick‑links disappear ≤1280 🟡 (minor / likely intentional)

The Home hero's PATREON / META / STEAM button stack (`.socials-container`, `position:absolute`) is set to **`display:none` at ≤1280**. It only appears at 1920. This looks deliberate (not a broken layout), but it means those hero CTAs are unavailable on laptops/phones — reachable only via the footer. Noted for awareness.

---

### Severity legend
🔴 high · 🟠 medium · 🟡 low
