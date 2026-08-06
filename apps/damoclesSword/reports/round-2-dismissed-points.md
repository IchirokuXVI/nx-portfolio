# damoclesSword — Visual QA Round 2: points that will NOT be changed

These items from the first‑pass reports were reviewed and **deliberately not actioned**. Reasons are the ones you gave; captured here so the decision is documented and nobody re‑opens them later. The issues that *will* be fixed are in `round-2-issues-to-fix.md`.

| ID | Original report | Issue (short) | Reason it stays as‑is |
| --- | --- | --- | --- |
| **C2** | `00-common-issues.md` | Empty media boxes across all pages (no image/video source) | **Intentional placeholders.** Real imagery/video will be added later; the blank boxes are expected for now. |
| **C3** | `00-common-issues.md` | Empty boxes render in two colours (black vs grey) | **Doesn't matter — they're placeholders.** Once real media replaces them the colour difference disappears, so not worth styling the empty state. |
| **C6** | `00-common-issues.md` / `1280x720.md` | Nav collapses to hamburger + header turns dark early (already mobile at 1280) | **Accepted for now.** The breakpoint may be revisited in the future; the early responsive switch is known and tolerated. |
| **C7** | `00-common-issues.md` | Home hero PATREON/META/STEAM quick‑links hidden ≤1280 | **Deliberate.** Those hero CTAs are intentionally desktop‑only; still reachable in the footer. |
| **360‑A** | `360x800.md` | Contact vacancies table clipped on mobile | **Fine for now — the table has its own scroll.** The content is reachable via the table's horizontal scroller, so no content is actually lost. |
| **1280‑C** | `1280x720.md` | Right‑aligned title underline offset | **By design.** The `double-bordered-title` border offset is an intended part of the design (see `double-bordered-title.scss` — the offset is baked into the component). |
| **1280‑D** | `1280x720.md` | 4‑up card grids get tight at 1280 | **Acceptable.** A bit cramped but not broken; no change wanted. |
| **1920‑E** | `1920x1080.md` | Right‑aligned title underline offset (same as 1280‑C) | **By design** — same as 1280‑C. |
| **1920‑G** | `1920x1080.md` | Services project cards vs Home project cards use different chrome | **Fine — different contexts.** The two card treatments are intentionally different for their respective pages. |

## Notes / corrections to the record

- **360‑A** was originally reported as *content loss* because the page‑level `overflow-x` is hidden. You have confirmed the **table itself scrolls**, so the description was too strong — the columns are reachable and it is acceptable as‑is. No change.
- **C3** stays closed as a consequence of **C2**: there is no point normalising an empty‑state colour that only exists until real media lands.
- Everything dismissed here is either *intentional design* (C6, C7, 1280‑C, 1920‑E, 1920‑G) or *placeholder‑dependent* (C2, C3) or *already handled* (360‑A). None block the Round‑2 fixes.
