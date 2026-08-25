# 0002 Design system and theming

> Prerequisite reading: `0001`, in particular rule **N1** (the product name is provisional
> and must never be hardcoded) and the **extraction contract** in section 3.1.

## 1. Why this document exists before any page

Two constraints from the brief drive everything here:

1. **The product will be renamed.** "Luna Shopper" is a working title. A rename must be a
   data change, not a refactor.
2. **The theme must be genuinely swappable.** Not "we used variables", but "a new brand
   can be applied by replacing one file, without touching a single component".

Those are the same problem: components must never encode identity. They encode **roles**
("this is the primary action", "this surface is raised"), and a theme decides what a role
looks like. Everything below is the machinery for that.

A third constraint shapes the visual choices: **this app is used one handed, on a phone,
in a supermarket**, often with bad signal and bad lighting. Legibility and thumb reach beat
elegance every time there is a conflict.

## 2. Token architecture: three layers

The rule that makes re-theming safe:

> **Rule T1.** A component may only reference **semantic** or **component** tokens. A
> component that references a primitive (a raw palette value) is a bug, because it will not
> follow a theme change.

### Layer 1: primitives

Raw values. No meaning attached. These live in exactly one file and are the only place a
literal colour appears.

```scss
// libs/luna-shopper-frontend/ui/src/lib/styles/_primitives.scss
// Night: the brand ground. Cool indigo, never pure black.
--app-night-950: #0a0c14;
--app-night-900: #11141f;
--app-night-850: #161a28;
--app-night-800: #1a1e2e;
--app-night-700: #262b40;
--app-night-600: #343a54;

// Moon: the neutral ramp. Cool tinted greys, never pure white on dark.
--app-moon-50:  #f7f8fc;
--app-moon-100: #eef0f7;
--app-moon-200: #dde1ed;
--app-moon-300: #c2c8db;
--app-moon-400: #98a0bb;
--app-moon-500: #6f7899;
--app-moon-600: #525a78;

// Glow: the single warm accent. The "moonlight" in the identity.
--app-glow-300: #ffd39a;
--app-glow-400: #ffc271;
--app-glow-500: #ffb454;
--app-glow-600: #e89a35;
--app-glow-800: #8a5a12;   // text only, and only on Day. See the note below.

// Status ramps. The 400s are for Night, the 700s are for text on Day.
--app-mint-400:   #34d399;   --app-mint-600:   #059669;   --app-mint-700:   #047857;
--app-coral-400:  #fb7185;   --app-coral-600:  #e11d48;   --app-coral-700:  #be123c;
--app-violet-400: #a78bfa;   --app-violet-600: #7c3aed;   --app-violet-700: #6d28d9;
--app-sky-400:    #60a5fa;   --app-sky-600:    #2563eb;   --app-sky-700:    #1d4ed8;
```

> **Why the 700s exist.** Drawing the home page mock in both themes surfaced a real
> failure: the bright ramps that carry the Night theme are close to unreadable as **text**
> on white. `#34d399` on `#ffffff` is about 1.9:1, well under the 4.5:1 floor, and
> `--app-glow-500` as a text colour is about 1.9:1 too. So each status role resolves to a
> **different primitive per theme**: the 400 on Night, the 700 on Day. The bright value
> stays correct for a fill or a progress bar in either theme, where only 3:1 is required.
> A quiet, text only action on Day uses `--app-glow-800`, never `--app-glow-500`. This is
> exactly the kind of thing that only shows up when both themes are actually drawn, which
> is why every page mock has to include a Day artboard.

### Layer 2: semantic tokens

What components actually use. A **theme is nothing but a redefinition of this layer**.

```scss
// Surfaces, from furthest back to closest to the user
--app-surface-ground      // the page behind everything
--app-surface-raised      // cards, sheets, list rows
--app-surface-overlay     // dialogs, popovers, bottom sheets
--app-surface-sunken      // inputs, wells, empty slots

// Text
--app-text-primary        // body and headings
--app-text-secondary      // supporting copy
--app-text-muted          // metadata, timestamps, placeholders
--app-text-on-action      // text drawn on top of an action fill

// Lines
--app-border-subtle       // hairlines between rows
--app-border-strong       // input outlines, focused containers
--app-focus-ring          // keyboard focus, always visible, never removed

// Action
--app-action-bg           // primary button fill
--app-action-bg-hover
--app-action-bg-pressed
--app-action-fg           // label on a primary button
--app-action-quiet-fg     // text only and secondary buttons

// Status, meaning first and colour second
--app-status-success-*    // a line is READY
--app-status-danger-*     // a line is NOT_AVAILABLE, and destructive actions
--app-status-attention-*  // needs a human decision: PENDING approval, join request
--app-status-info-*       // neutral information, presence, connection notices
--app-status-neutral-*    // a line is PENDING, nothing has happened yet
```

Each status role has a `-fg`, `-bg`, and `-border` variant, because a status appears as
text, as a chip, and as a row tint, and those need different contrast.

### Layer 3: component tokens

Optional, and only when a component needs a knob a theme might want to turn independently.

```scss
--app-button-radius: var(--app-radius-md);
--app-line-row-height: 56px;
```

## 3. Scoping: tokens live on the app root, not on `:root`

Required by the extraction contract, item 4. While this app is a remote inside the
portfolio shell, defining tokens on `:root` would mean the shell's global styles and this
app's tokens can collide in both directions.

```scss
// The app's own layout component host, not :root
.app-root {
  @include app-primitives;
  @include app-theme-night;
}
```

When the app is extracted, this selector can move to `:root` with no other change.

## 4. Themes

A theme is a class on the app root that redefines layer 2. Nothing else.

| Theme | Class | Where it is used |
| --- | --- | --- |
| Night | `.theme-night` | Default. The brand look, and better in a dim kitchen or at night |
| Day | `.theme-day` | High contrast light theme, for a bright supermarket |

Both are first class. This is not "a light theme bolted on later": the app is used in both
conditions routinely, and the mock for every page must be checked in both.

### 4.1 Night

```scss
--app-surface-ground:  var(--app-night-950);
--app-surface-raised:  var(--app-night-850);
--app-surface-overlay: var(--app-night-800);
--app-surface-sunken:  var(--app-night-900);
--app-text-primary:    var(--app-moon-50);
--app-text-secondary:  var(--app-moon-300);
--app-text-muted:      var(--app-moon-500);
--app-border-subtle:   rgb(255 255 255 / 8%);
--app-border-strong:   rgb(255 255 255 / 18%);
--app-action-bg:       var(--app-glow-500);
--app-action-fg:       var(--app-night-950);
```

### 4.2 Day

```scss
--app-surface-ground:  var(--app-moon-50);
--app-surface-raised:  #ffffff;
--app-surface-overlay: #ffffff;
--app-surface-sunken:  var(--app-moon-100);
--app-text-primary:    var(--app-night-900);
--app-text-secondary:  var(--app-moon-600);
--app-text-muted:      var(--app-moon-500);
--app-border-subtle:   var(--app-moon-200);
--app-border-strong:   var(--app-moon-300);
--app-action-bg:       var(--app-glow-500);
--app-action-fg:       var(--app-night-950);
```

### 4.3 One deliberate decision worth flagging

**The primary action is the same amber in both themes, and its label is always dark ink.**
Amber on dark ink is roughly 10:1 contrast, which passes comfortably. Amber with **white**
text is about 1.9:1 and fails badly, so:

> **Rule T2.** Never place white or light text on `--app-action-bg`. The token
> `--app-action-fg` exists so this cannot be gotten wrong by accident.

Keeping the primary button identical across themes means the most important control in the
app looks the same wherever the user is, which is worth more than theme purity.

### 4.4 A collision that was designed out

An amber brand action and a conventional amber "warning" status are hard to tell apart, and
in this product that ambiguity would sit right on the shopping list rows where it does the
most damage.

**There is deliberately no `warning` status token.** The two things a warning would have
covered are split into roles that are genuinely different:

- `danger` (coral) for destructive actions and for `NOT_AVAILABLE`.
- `attention` (violet) for anything awaiting a human decision, which is the far more common
  case here: `LineApprovalStatus.PENDING`, a pending join request, a pending merge request.

Violet also reads as part of the moonlight family rather than as an alien alert colour.

### 4.5 Theme selection

Resolution order, first match wins: an explicit user choice from settings, then the
operating system via `prefers-color-scheme`, then Night as the default. The user choice
persists. Per `0001` section 4.2, storage is reached through an injectable facade rather
than touching `localStorage` directly, so the standalone SSR build keeps working.

`prefers-reduced-motion` and `prefers-contrast` are honoured. Reduced motion is not
optional politeness here, since motion on a list that is being edited by several people at
once is genuinely disorienting.

## 5. Brand configuration: surviving the rename

Everything that carries product identity lives in one object, provided through a DI token.

```ts
// libs/luna-shopper-frontend/models
export interface AppBrand {
  /** Full product name. Display only. Never used as an identifier. */
  readonly name: string;
  /** Short form for tight spaces such as the header and the tab title. */
  readonly shortName: string;
  /** Wordmark and icon assets, resolved at runtime, never inlined into a template. */
  readonly wordmarkSrc: string;
  readonly iconSrc: string;
  /** Optional theme override, so a rebrand can ship a palette with the name. */
  readonly themeClass?: string;
}

export const APP_BRAND = new InjectionToken<AppBrand>('APP_BRAND');
```

### 5.1 The rename procedure, written down now so it stays true

1. Change the values in the single `AppBrand` provider.
2. Replace the wordmark and icon asset files.
3. Update the product name **values** in `en.json` and `es.json`.
4. Optionally add a new theme class and point `themeClass` at it.

Nothing else. If a rename ever requires touching a component, a route, or a CSS token, that
is a defect against rule N1 and it gets fixed rather than worked around.

### 5.2 What this forbids

- No `.luna-*` CSS classes, no `LunaButton`, no `luna` in a token name or an asset filename.
- No product name in a translation **key**. `home.title` is correct,
  `home.welcome-to-luna` is not.
- No product name in a route path.
- The word "moon", "night", and "glow" in the palette describe **colours**, not the product,
  so they survive a rename. If the rebrand is not lunar, those primitive names become
  slightly odd but stay correct, and renaming them is a single file find and replace with no
  component impact.

## 6. Type

**System font stack, no webfont.** On a phone on supermarket signal, a webfont is a render
blocking download for a screen the user wants immediately. The system stack is already on
the device and looks native.

```scss
--app-font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
--app-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace;
```

A display face is permitted in exactly two places: **the wordmark**, and **the hero
headline on the public home page**. Both are on the unauthenticated surface, where the
first impression is the job, and both are absent from every authenticated screen, so the
app itself stays on the system stack. The mock uses Instrument Serif there. Load it as an
asset rather than as a render blocking web font. Note that Audiowide appears throughout
`libs/damoclesSword/ui`: that is that project's identity and must not be borrowed here.

Monospace is reserved for one job: **join codes and invite codes**, where character
ambiguity matters.

### 6.1 Scale

Mobile first, with `clamp()` so the same scale serves a phone and a desktop browser.

| Token | Size | Use |
| --- | --- | --- |
| `--app-text-2xs` | 11px | Dense metadata only, never body copy |
| `--app-text-xs` | 12px | Timestamps, helper text |
| `--app-text-sm` | 14px | Secondary copy, chips |
| `--app-text-base` | 16px | Body. **Never smaller for input fields** |
| `--app-text-lg` | 18px | List line labels, the thing being read while shopping |
| `--app-text-xl` | `clamp(20px, 5vw, 24px)` | Section headings |
| `--app-text-2xl` | `clamp(24px, 7vw, 32px)` | Page titles |
| `--app-text-3xl` | `clamp(30px, 9vw, 44px)` | Home hero only |

> **Rule T3.** Input fields are never below 16px. iOS Safari zooms the viewport when a
> focused input is smaller, which on a phone form is a jarring, hard to undo jump.

Line height: 1.5 for body, 1.2 for headings. Long product names wrap rather than truncate
wherever there is room, because a truncated grocery item can be the wrong item.

## 7. Space, radius, elevation, motion

**Space.** 4px base: `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Tokens `--app-space-1`
through `--app-space-11`. No arbitrary values in components.

**Radius.** `--app-radius-sm: 8px`, `md: 12px`, `lg: 16px`, `xl: 24px`, `full: 999px`. The
system is soft rather than sharp: this is a domestic, shared, everyday product, not a
technical dashboard.

**Elevation.** On Night, depth is expressed by a **lighter surface**, since shadows are
nearly invisible on a dark ground. On Day, depth is a soft shadow. Both are exposed through
the same `--app-elevation-1` and `--app-elevation-2` tokens so a component does not care
which theme it is in.

**Motion.** `--app-motion-fast: 120ms`, `--app-motion-base: 200ms`, `--app-motion-slow:
320ms`, all with an ease out curve. Anything arriving from another user (a realtime update)
uses a distinctly gentler entrance than something the user did themselves, so that "the
list changed under me" is legible rather than startling. All of it collapses to zero under
`prefers-reduced-motion`.

## 8. Touch and layout

This is the part that is easy to get wrong on a desktop and painful on a phone.

- **Minimum target 44 by 44 CSS pixels**, including the checkbox that marks a line as
  bought. That control is tapped dozens of times per shopping trip with one hand, often
  while holding something else.
- **Primary actions sit in the bottom third of the screen**, in thumb reach. Destructive
  actions do not sit next to frequently tapped ones.
- **Safe area insets** are respected via `env(safe-area-inset-*)`, so a bottom action bar is
  not hidden behind the home indicator.
- **Breakpoints**, mobile first: base is the phone, `sm: 480px`, `md: 768px`, `lg: 1024px`,
  `xl: 1280px`. Above `md` the app becomes a centred column of about 720px rather than
  stretching, because a shopping list at 1900px wide is unusable.
- **Scroll containers are page level.** Nested scroll areas on a touch device fight the
  user.

## 9. Icons

CLAUDE.md is explicit: icons are standalone components in `libs/shared/ui`, built from an
inlined SVG, and raw `<svg>` markup never appears in a feature or ui component. That rule
is followed here.

Already available and reusable: `arrow`, `calendar`, `close`, `download`, `edit`, `email`,
`github`, `home`, `linkedin`, `loading`, `save`, `trash`, `upload`.

This product needs roughly these additions: `check`, `plus`, `minus`, `basket`, `comment`,
`users`, `search`, `share`, `chevron`, `settings`, `filter`, `more`, `offline`, `lock`,
`bell`, and a `google` brand mark for the sign in button.

> **Open question for the user.** Those are one product's icons landing in a shared
> portfolio library, and some of them (`basket`, `offline`) are not plausibly shared. The
> options are to follow the rule literally and put all of them in `libs/shared/ui`, or to
> put the generic ones there and keep the product specific ones in
> `libs/luna-shopper-frontend/ui`. The second is better for the eventual extraction, but it
> is a deviation from CLAUDE.md, so it needs an explicit decision rather than a quiet one.
> Nothing is generated until this is answered.

## 10. Component inventory

Built in `libs/luna-shopper-frontend/ui` as each page plan calls for it. Listed here so the
same button is not invented three times.

**Foundations:** layout shell (header, content, bottom action bar), page header, sheet and
dialog, toast, empty state, skeleton loader, error state with a copyable correlation id,
connection banner.

**Controls:** button (primary, secondary, quiet, destructive), icon button, text field,
code input for join codes, quantity stepper, checkbox, select, search field, segmented
control, switch.

**Product:** list line row, line status chip, quantity and unit display, member avatar and
presence dot, role badge, zone card, list card, comment thread and composer, join code
display with share and copy.

## 11. Accessibility floor

Non negotiable, checked per page:

- Text contrast at least 4.5:1, large text and interactive borders at least 3:1. **Both
  themes.**
- Colour is never the only carrier of meaning. Every line status has an icon or a text
  label alongside its colour, which also covers colour blind users reading a red and green
  status list.
- Visible focus on every interactive element. The focus ring is a token so it cannot be
  quietly removed.
- Every icon only button has an accessible name.
- Realtime updates that matter are announced through a polite live region rather than
  appearing silently.
- The whole app works at 200% text zoom without horizontal scrolling, which is also what
  keeps it working on a small phone in landscape.

## 12. Acceptance criteria for this plan

- [ ] `_primitives.scss`, `_semantic.scss`, `_themes.scss` exist in
      `libs/luna-shopper-frontend/ui/src/lib/styles`, and are the only files containing
      literal colour values.
- [ ] Tokens are scoped to the app root element, not `:root`.
- [ ] Both Night and Day are implemented and switchable, with system preference detection
      and a persisted user override behind an injectable storage facade.
- [ ] `AppBrand` and `APP_BRAND` exist and are the only source of the product name.
- [ ] A lint rule or a documented review check catches literal colours and raw pixel values
      in component styles.
- [ ] A contrast check has been run over both themes for every token pair that is actually
      used together.
- [ ] Renaming the product has been rehearsed once by changing only the brand provider and
      the translation values, confirming no component needed a change.

## 13. Out of scope

Service worker and offline caching, install prompts, and app store packaging, all deferred
to the standalone phase per `0001` section 5. Animation beyond the token level transitions.
Any third locale beyond English and Spanish.
