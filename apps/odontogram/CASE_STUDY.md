# Odontogram — Case Study

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed.

## The project

**Q: What is the odontogram and why did you build it (real dental use case / who's it for)?**
A: I built this odontogram for Clinica Dental Gallardo, a dental clinic that works in
Cordoba and Malaga. I created it around 2024 while I was working at Umitel Soluciones
Informaticas, and the original is still in use today.

It was, I would say, my first real frontend challenge. I had to find a lot of
workarounds to fill the tooth images with color in the specific positions that make
sense for each tooth, and I ended up learning quite a bit of geometry because of how
the zones are positioned.

## Domain model

**Q: How is the dental domain modeled (teeth numbering, tooth zones, treatment types, tooth-treatment status)? What was tricky to get right?**
A: The important thing about the data model is that teeth are not stored anywhere.
What gets saved are the treatments, together with the teeth they are applied to, and a
single treatment can affect more than one tooth. Treatments are also linked to an
odontogram, so a patient builds up a history of the treatments they have gone through.
When you create a new odontogram for a patient, you can see the history of each tooth
from the previous ones.

Each tooth is divided into zones. The crown view has five zones (top, right, bottom,
left and middle) and the front view has two (the crown seen from the front, and the
root). The only treatments possible on a root are an implant or an extraction. Every
treatment also carries a status, either pending or completed, and that status is what
drives the two colors shown on the chart.

> Note (Claude): Verified against the models, with a few things to confirm or add.
> (1) Teeth numbering uses FDI two-digit notation and the list includes primary
> (deciduous) teeth (51 to 85) as well as permanent teeth (11 to 48), so the model
> already supports children. Worth saying explicitly.
> (2) The treatment model is actually three layers: `Treatment` looks like a reusable
> catalog entry (name, description, `treatmentType`, default `zones`);
> `OdontogramTreatment` is an applied instance tied to an odontogram with a status;
> `ToothTreatment` extends it with the specific `teeth`, `zones`, `type` and a
> `groupTeeth` flag. Confirm whether `Treatment` is a shared catalog.
> (3) `Odontogram` has a `generalTreatments` field (not tied to any tooth) that your
> answer did not mention.
> (4) `groupTeeth` (boolean) on a tooth treatment is unexplained; likely for a single
> treatment that spans a group of teeth (for example a bridge). Confirm.
> (5) The front-crown zone is named `LATERAL` in the `ToothZones` enum.

## The interactive chart

**Q: How is the tooth chart rendered and made interactive (SVG? per-zone hit areas? how a click maps to a tooth zone)?**
A: The chart is not SVG. Each tooth is built from image assets plus some CSS geometry.

Every tooth uses two visible images, one for the crown (top) view and one for the
front view. Each image is a PNG that comes with a matching mask image, so a background
color only fills the part of the tooth that should be colored.

The front view is the easy one. Only the front crown is colored, and since it is a
single zone I just fill the image with a background color. The root is not transparent,
so the background only shows through the correct part. The root itself can only ever
have an implant or an extraction, which I mark with bars drawn over it, so it needs no
background trick.

The crown is the complex one, with five zones that all have to be clearly
distinguishable. I create a square that is much bigger than the tooth, center it, and
rotate it with some maths so that each of the four outer zones becomes a triangle
pointing in the right direction, with a circle in the middle for the fifth zone. When a
zone has a treatment, a CSS class adds the background color to that specific zone. To
make the boundaries between zones clear I add borders, and because a border is only
wanted where two colored zones meet, I wrote SCSS mixins that work out whether a zone
is next to another colored zone and which borders it needs. It is a bit complex, but it
works wonders. Each tooth is fully independent.

> Note (Claude): Verified in `single-tooth-image.ts` / `.scss` and enriched.
> (1) There are actually four image files per tooth: `_crown.png`, `_root.png`,
> `_crown_mask.png`, `_root_mask.png`, loaded via dynamic `import()` in
> `ToothImageLoader`.
> (2) The geometry: the square is sized `sqrt(2) * 50%`, rotated 45deg plus 90deg per
> position; with `overflow: hidden` only half the diamond (a triangle) shows; the 5th
> zone is a centered circle. This is the geometry you mentioned learning.
> (3) The adjacency borders use CSS `:has()` selectors with modulo sibling math, so a
> dashed border only appears between two treated neighboring zones.
> (4) Upper vs lower teeth (quadrants 1 to 2 vs 3 to 4) are mirrored via
> `flex-direction: column-reverse` and a flipped cross/implant offset.
> (5) Minor bug to note: `ToothImageLoader` keeps a `loadedImages` Map for caching but
> never writes to it, so that in-service cache is dead code (the bundler still dedupes
> the dynamic `import()`, so it works anyway). Easy fix if you want the cache real.

**Q: How do treatments get visualized on a tooth (colors/states per zone)?**
A: Treatments are shown in two colors, one for completed treatments and one for
pending ones, so you can tell at a glance what has already been done and what is still
outstanding. On the crown, the relevant zone is filled with the color. On the root, an
implant or an extraction is drawn with bars over the root rather than as a fill.

> Note (Claude): Small refinements from the code. An extraction is drawn as an X (a
> cross of two rotated bars) and an implant as two parallel bars, so the two are
> visually distinct, not the same mark. Also, a zone's color follows a precedence
> rule (`getToothZoneStatus`): if any treatment in that zone is pending the whole zone
> shows pending, and it only shows completed when every treatment there is completed.
> Untreated zones are white.

## Data access

**Q: There's both an in-memory service and an API service (`odontogram-memory.ts` vs `odontogram-api.ts`) behind a shared interface, tested with `*.shared-spec.ts`. Why build both, and how do you switch?**
A:

**Q: Does the deployed app talk to a real backend (`BACK_API_*` env) or run fully in-memory as a demo? Why?**
A:

## CRUD feature

**Q: The full CRUD feature: how is edit state managed and persisted, and what was the hardest part of the UX?**
A: _(Partially answered, more to cover on edit-state and persistence.)_ When you click
a tooth you get a form that does not reuse the tooth image. It is easier to work with
plain squares because they are easier to click, so the form shows five squares arranged
in a circle for the five crown zones, plus a few more squares below them for the front
view. The form also includes a history, so you can check the status of that tooth at
any earlier point for which an odontogram exists.

> Note (Claude): Still open for this question: how edit state is held while the user is
> making changes, how and when it is persisted (save flow), and what the hardest part
> of the UX actually was. Revisit once the data-access questions are answered.
