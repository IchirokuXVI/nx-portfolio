> **PR:** [#272](https://github.com/IchirokuXVI/nx-portfolio/pull/272)

# 0018 White text on a pale box

Three complaints about the harvester screens turn out to be three symptoms of the same habit: a piece
of presentation that every screen needs, that no screen owns, and that each one therefore copies or
forgets. A colour pair, a set of control styles, and a namespace of translation keys. Two of the
three are copied into some components and missing from others. The third was never written at all.

None of this is a new feature. It is the part of `0004`, `0006` and `0011` that landed on the
resource screens and did not land beside them, and the fix in each case is to put the shared thing
somewhere shared and delete the copies.

Depends on `0001` for the tokens, on `0006` and `0011` for the screens, and on `0015` for the
contrast reasoning the token block already carries.

## 1. Seventeen places draw text that cannot be read

The report was "a light blue container with white text, not readable at all", on the import screen.
That box is real: `.hints` in
`libs/luna-shopper-admin/feature-harvest/src/lib/import-upload-page.ts` sets
`background: var(--admin-accent-wash)` and `color: var(--admin-accent-ink)`. In development the wash
is `#e8f1f8` and the ink is `#ffffff`. **That pair has a contrast ratio of 1.14 to 1.** The text is
not hard to read. It is not visible.

It is not one box. The same pair appears seventeen times.

**A wash under white ink, thirteen times.** `--admin-accent-wash` under `--admin-accent-ink` in
`entries-queue-page.ts` twice (the leaflet kind badge, the prices written notice),
`import-upload-page.ts` once, `run-page.ts` once (a pending run's status), `sources-page.ts` once (an
enabled chain), `run-row.ts` once and `switch-panel.ts` once. `--admin-danger-wash` under
`--admin-danger-ink` in `dashboard-page.ts` once, `run-page.ts` twice, `run-row.ts` twice and
`switch-panel.ts` once. Ratios run from 1.14 to 1.16 against every deployment's wash.

**White ink on no background at all, four times.** These are worse, because the surface underneath is
`--admin-surface-raised`, which is `#ffffff`. White on white:

- `queue-frame.ts`, `.actions .danger`. **The reject button on every decision queue has an invisible
  label.** It sets a red border and white text and no background, so an operator sees an empty
  outlined box where "Reject" is written.
- `import-upload-page.ts`, `.messages`. The per product reasons a refused import gives. The heading
  and the product id are readable and the reason under each is not, which is the one line the
  operator needs.
- `run-page.ts`, `.danger`, the abort button.
- `dashboard-page.ts`, `.missing`.

One pairing in the app is correct: `confirm-dialog.ts` puts `--admin-danger-ink` on a solid
`--admin-danger` background, which is exactly what that token is for.

### 1.1 The token that was missing

`--admin-accent-ink` and `--admin-danger-ink` are the ink for the **solid** colour. There has never
been an ink for the wash, so every author who wanted a tinted badge reached for the only ink the
token block offered.

Three tokens are added in `libs/luna-shopper-admin/ui/src/lib/styles/_tokens.scss`:

```scss
--admin-accent-on-wash: #5c5f6b;
--admin-danger-on-wash: var(--admin-danger);
--admin-status-attention-on-wash: var(--admin-status-attention);
```

and one line inside each of the three blocks of `admin-deployments`:

```scss
--admin-accent-on-wash: var(--admin-accent);
```

The accent reads on its own wash in every named deployment: 5.62 in production, 5.38 in staging, 5.99
in development. The resting grey does not, at 4.20, which is why the base value is
`--admin-ink-muted`'s `#5c5f6b` rather than `var(--admin-accent)`: on the resting wash it measures
5.52. Danger on its own wash is 5.62 and attention on its own is 7.40. Every value clears 4.5 to 1,
and the numbers go in the file as a comment beside them, the way `0015` recorded the chart palette's.

Then the rule, written where the tokens are:

> **`-ink` goes on the matching solid colour and nowhere else. `-on-wash` goes on the matching wash
> and nowhere else.** A tinted box takes the wash and the wash's ink. A filled control takes the
> solid and the solid's ink. Neither ink is a general purpose foreground.

Seventeen rules change to follow it. The four with no background take
`--admin-danger-on-wash` and keep their transparent background, since each is text or an outlined
button on the raised surface, and `--admin-danger-on-wash` is the danger colour itself, which reads
at 5.98 there.

### 1.2 A spec, because the next one is one paste away

`libs/luna-shopper-admin/ui/src/lib/styles/ink-on-wash.spec.ts` reads every `.ts` file under the
admin libraries and the app, finds each `color: var(--admin-*-ink)` declaration, and fails when the
same rule block does not also set `background` to the matching solid token. It names the file, the
selector and the pair, the way `no-unguarded-history-back.spec.ts` names a file in velista.

A source scan rather than a rendered check, because the defect is a pair of token names sitting next
to each other and that is a thing a reader can see in the file. Rendering it would need a browser and
would still only catch the components a test happened to mount.

## 2. Three harvester screens draw browser default controls

The runs screen was reported as having "default select styles" and buttons that "aren't styled
properly". Both are true, and the reason is the same as section 1.

Every component that draws a control writes its own copy of the same eight declarations:

```scss
button,
input,
select {
  min-block-size: 2.75rem;
  padding: var(--admin-space-2) var(--admin-space-3);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-surface-raised);
  font: inherit;
  font-size: 1rem;
  color: var(--admin-ink);
}
```

`import-upload-page.ts`, `entries-queue-page.ts`, `shops-queue-page.ts` and `resource-filters.ts`
each carry a copy. **`runs-page.ts`, `sources-page.ts`, `run-page.ts` and `places-queue-page.ts`
carry none.** On those four, a `<select>` is whatever the browser draws, an `<input>` is 21 pixels
tall next to a 44 pixel picker, and a `<button>` is grey system chrome.

`runs-page.ts` shows the second half of the same problem. Its `.primary` sets a background, a colour
and a minimum height and nothing else, because it was written expecting a base rule that is not
there, so the one button that starts a harvest run has an accent background with no padding and
square corners.

**The base moves to `apps/luna-shopper-admin/src/styles.scss`**, as a global rule. A global element
selector still matches an element inside a component with emulated encapsulation, which is what makes
this the right home: one rule, every screen, including the ones nobody has written yet. The four
copies are deleted. Modifiers stay where they are, because `.primary`, `.danger` and
`.toggle.on` are each about one screen's meaning rather than about what a control looks like.

`font-size: 1rem` keeps its comment when it moves. It is there because iOS Safari zooms the viewport
on focus for anything smaller, and an operator on a phone ends up scrolled sideways.

## 3. The chain sources screen renders its own key names

`harvest/sources` shows `harvest.sources.heading` where a heading belongs, and eleven more like it.
**Every key that screen uses is missing from
`libs/luna-shopper-admin/ui/assets/i18n/en.json`.** The whole `harvest.sources.*` namespace was never
written:

`heading`, `lead`, `empty`, `edit`, `enabled`, `disabled`, `field.adapter`, `field.workers`,
`field.rate`, `field.lastRunAt`, `field.lastSuccessAt`, `field.failures`.

Twelve strings, and they are the only twelve missing in the app: a scan of every literal key in every
admin component against the catalogue finds these and nothing else.

The strings are written. They say what a chain source is and what the two numbers on it mean, because
`workers` and `maxRequestsPerSecond` are the two settings that decide whether a crawl gets a chain's
storefront banned, and an operator editing them from a screen with no lead text is guessing.

### 3.1 A spec, for the same reason as 1.2

`libs/luna-shopper-admin/ui/src/lib/translations.spec.ts` gains a case that walks every `.ts` file
under the admin libraries, collects every string literal passed to the `rokuT` pipe, and fails on one
the catalogue does not hold. It reports the key and the file.

It can only see literal keys. `'harvest.mode.' + option` and `'harvest.entries.field.' + line.key`
are built from a value, so the scan skips them and says how many it skipped. That is honest and still
worth having: a missing literal key is what happened here, twelve times, on one screen, unnoticed
until somebody opened it.

## 4. Testing

- `ink-on-wash.spec.ts`, as section 1.2 describes: it fails on the seventeen rules before they are
  fixed and passes after, and a deliberately wrong pair added to a fixture is named.
- A token case asserts the six contrast ratios of section 1.1 by computing them, so a later change to
  an accent that breaks one fails here rather than in front of an operator.
- `runs-page.spec.ts` and a new `sources-page.spec.ts`: the select and the start button carry the
  base declarations, read through `getComputedStyle` after the global stylesheet is applied.
- `translations.spec.ts`: every literal key resolves, and the twelve new ones are present.
- `sources-page.spec.ts`: the heading renders as text rather than as a key, which is the assertion
  that would have caught this.

## 5. Exit criteria

- The import screen's hints box, and the other sixteen, are legible.
- The reject button on every queue shows its label.
- The runs screen's two selects, its inputs and its start button match the controls on the resource
  screens.
- `harvest/sources` shows English.
- Adding a `-ink` colour to a wash, or a new key with no translation, fails a spec.
