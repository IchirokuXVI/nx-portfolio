# 0011 UI defect fixes

Seven defects found by using the app after `0010` landed. They are unrelated to each
other in the code and related in what they say about the build: four of them are
**feedback** defects, where a write succeeded and the screen did not say so, and three
are **surface** defects, where a control or a background was built to work rather than
built to the mock.

They are collected in one plan because five of the seven touch the same three files
(`sheet-shell`, `_zone-page.scss`, the two zone pages), and splitting them would mean
three passes over the same templates.

## What is being fixed

| # | Defect | Kind |
| --- | --- | --- |
| 1 | A member renamed on the members screen keeps the old name | feedback |
| 2 | The row menu on the members screen does not close on an outside click | surface |
| 3 | Making a new join code lands back on the settings sheet, not on the group | feedback |
| 4 | Back is plain text on both zone pages, not a caret button | surface |
| 5 | A bottom sheet rises on open and vanishes on close | surface |
| 6 | The members screen has no app bar and no title until it has loaded | surface |
| 7 | The landing page is one flat colour, with none of the mock's depth | surface |

## Order of work

Section 4 (the back control) and section 5 (the sheet close) are groundwork: both are
shared code that the other sections' templates sit on top of. Do them first, then 1, 2,
3, 6, and 7 in any order.

---

## 1. A renamed member keeps the old name

### Symptom

Members screen, a row's menu, "Change name here", type a name, confirm. The sheet
closes and the row still reads the old name. Removing, blocking and handing the group
over have the same defect: the row stays exactly where it was.

### Cause

`MemberActionSheet._run` says it in a comment
(`libs/velista/feature-zones/src/lib/member-action-sheet/member-action-sheet.ts`):

> Back to the members screen, which re-reads on arrival

The members screen does not re-read on arrival, because it never left. Rule E1 makes
the four action sheets **children** of the members route
(`libs/velista/feature-shell/src/lib/routes.ts`, `zones/:zoneId/members`), so
`MembersPage` is alive the whole time the sheet is over it, and its one load effect is
keyed on the zone id and the requested statuses, neither of which changed. `_rows` is
page state that nothing else writes: there is no `MembershipStore`, and the realtime
events that would have caught this feed `ZoneStore`'s counts rather than this list.

`MembersPage.refresh()` exists for precisely this and has no caller.

### Fix

Give the sheet a way to say a write landed, and key the load effect on it.

A tiny notifier in `feature-zones`, holding a counter and nothing else:

```ts
// libs/velista/feature-zones/src/lib/member-list-refresh.ts
@Injectable({ providedIn: 'root' })
export class MemberListRefresh {
  private readonly _token = signal(0);

  /** Bumped by a sheet that changed a row. Read by the screen behind it. */
  readonly token = this._token.asReadonly();

  record(): void {
    this._token.update((n) => n + 1);
  }
}
```

Root scope is correct here and is not a breach of rule D5: it injects nothing, reaches
no app token, and holds one integer. What D5 forbids is a service resolving a token the
app binds from an injector that does not have it, which this has no way to do.

`MemberActionSheet._run` calls `record()` after `send()` succeeds and before
`dismiss()`. `MembersPage`'s load effect reads the token as a third key:

```ts
effect(() => {
  const id = this.zoneId();
  const statuses = this._statuses();
  this._refresh.token();

  untracked(() => { /* unchanged */ });
});
```

The read is deliberately bare, outside `untracked`, alongside the two keys that are
already there.

**Not `<router-outlet (deactivate)="refresh()" />`**, which is the one line version of
the same idea. It cannot tell a sheet that wrote something from a sheet that was
cancelled, so every dismissal costs a page of members, and the router deactivates a
child outlet on the way to destroying its parent, so leaving the screen entirely fires
one more request whose answer is thrown away.

### Files

- `libs/velista/feature-zones/src/lib/member-list-refresh.ts` (new)
- `libs/velista/feature-zones/src/index.ts` (export it)
- `libs/velista/feature-zones/src/lib/member-action-sheet/member-action-sheet.ts`
- `libs/velista/feature-zones/src/lib/members-page/members-page.ts`

### Acceptance

- Renaming a member updates the row without a reload, and without leaving the screen.
- Removing, blocking and handing the group over all remove or update their row.
- Cancelling a sheet fires no request.
- A spec: `MembersPage` re-lists when the token is bumped, and does not when it is not.

### One thing to check first

The **group** rename (settings sheet, "Group name", Save) was traced end to end and is
correct: `ZoneStore._write` patches the cache from the server's `ZoneView`, and both the
group header and the dashboard card read the zone through that cache, so both update on
the spot. If a group rename really is not showing, it is a different defect from this
one and needs a repro before it gets a fix.

---

## 2. The row menu does not close on an outside click

### Symptom

Members screen, the three dots on a row, then a tap anywhere else. The menu stays open.
Escape closes it; tapping outside does not.

### Cause

`libs/velista/ui/src/lib/zone/member-row.ts` binds `(keydown.escape)` on the host and
nothing else. There is no document listener.

### Fix

The pattern already exists twice in this workspace, in `AppBar`
(`libs/velista/ui/src/lib/home/app-bar.ts`) and in `LanguageSelector` in
`libs/damoclesSword/ui`. Copy it:

```ts
host: {
  '(keydown.escape)': 'close()',
  '(document:click)': 'closeOnOutsideClick($event.target)',
  '[class.menu-open]': 'menuOpen()',
}
```

```ts
protected closeOnOutsideClick(target: EventTarget | null): void {
  if (!this.menuOpen()) {
    return;
  }

  const host = this._host.nativeElement;
  if (target === null || !host.contains(target as Node)) {
    this.menuOpen.set(false);
  }
}
```

Separate from `close()` on purpose. `close()` hands focus back to the trigger, which is
right for Escape and for choosing an item, and wrong for a click somewhere else: the
person has just put focus where they wanted it, and pulling it back to a row they have
finished with is the kind of thing that makes a page feel like it is arguing.

The trigger sits inside the host, so its own click is an inside click and the existing
`toggleMenu()` still does the toggling.

### Files

- `libs/velista/ui/src/lib/zone/member-row.ts`
- `libs/velista/ui/src/lib/zone/member-row.spec.ts`

### Acceptance

- A click outside the row closes the menu and leaves focus where the click landed.
- Escape still closes it and still returns focus to the trigger.
- The trigger still toggles.

---

## 3. A new join code lands back on the settings sheet

### Symptom

Group page, "Group settings", "Make a new join code", confirm. The confirm closes and
the settings sheet is underneath it again, showing the name field. The new code is not
on screen, and the invite card that has it is behind two layers.

### Cause

`GroupSettingsSheet.regenerate()` sets `pending` back to `null` on success, which is the
same thing cancelling does. The write is the end of that task and the sheet treats it as
a step in one.

### Fix

Two halves, because "show the new code" and "go back to the group view" are two things.

**Go back.** On success, `regenerate()` calls `dismiss()` instead of `pending.set(null)`,
exactly as `save()` already does after a rename. Nothing else changes: `_write` has
already patched `joinCode` in `ZoneStore` from the server's answer, so the group page's
invite card is drawing the new code before the sheet has finished closing.

**Say so.** Landing on a card that quietly holds a different six characters is not the
same as being shown a new code. `ZoneStore` already has the shape for this in
`_lastEntry` and `clearLastEntry`, which exist so the dashboard can say what just
happened once and not twice. Add the same pair for the code:

```ts
private readonly _lastCodeChange = signal<string | null>(null);
readonly lastCodeChange = this._lastCodeChange.asReadonly();

clearLastCodeChange(): void {
  this._lastCodeChange.set(null);
}
```

`regenerateJoinCode` sets it to the zone id on a succeeded outcome. `GroupPage` reads
it, and when it names the zone on screen it clears the store's copy and sets its own
`codeIsNew` signal, which it passes to the invite card. `InviteCard` gains one input and
renders one line in the live region it already has:

```ts
readonly isNew = input(false);
```

```html
<p aria-live="polite" class="copied">
  @if (copied()) {
    {{ 'entry.invite.copied' | rokuT }}
  } @else if (isNew()) {
    {{ 'entry.invite.newCode' | rokuT }}
  }
</p>
```

One live region, not two: a second one added to the page at the moment it gains content
is often not announced at all, which is why the existing one is always in the DOM.

New keys, in both `libs/velista/ui/assets/i18n/en.json` and `es.json`:

```
entry.invite.newCode = This is your new code. The old one has stopped working
entry.invite.newCode (es) = Este es tu nuevo código. El anterior ya no funciona
```

The card also takes a `.is-new` class while the flag is set, which draws the same
attention in colour that the sentence draws in words. Never colour alone.

### Files

- `libs/velista/feature-zones/src/lib/group-settings-sheet/group-settings-sheet.ts`
- `libs/velista/data-access/src/lib/zones/zone-store.ts`
- `libs/velista/feature-zones/src/lib/group-page/group-page.ts`
- `libs/velista/feature-zones/src/lib/group-page/group-page.html`
- `libs/velista/ui/src/lib/entry/invite-card.ts`, `.html`, `.scss`
- `libs/velista/ui/assets/i18n/en.json`, `es.json`

### Acceptance

- Confirming a new code closes both sheets and leaves the group page on screen.
- The invite card shows the new code and says it is new.
- The notice is announced once. Navigating away and back does not repeat it.
- A failed regenerate still keeps the confirm open and still shows its error.

---

## 4. Back is plain text on the zone pages

### Symptom

The group page and the members page both open with the word "Back" as running text. The
auth screens, built later, have a proper 44 by 44 caret button.

### Cause

The `back` mixin in `libs/velista/feature-zones/src/lib/_zone-page.scss` styles a text
button: `font-size: var(--app-text-sm)`, transparent, no glyph. The templates render the
`zone.detail.back` string as the button's visible label.

### Fix

Make it the control the auth screens already have. `AuthScreen`
(`libs/velista/ui/src/lib/auth/auth-screen.html` and `.scss`) is the reference, and its
shape is copied rather than shared: Sass cannot cross a library boundary, which is the
same constraint `_zone-page.scss` already documents at the top of the file.

The mixin becomes a round icon button on the touch target:

```scss
@mixin back {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  inline-size: var(--app-touch-target);
  block-size: var(--app-touch-target);
  margin-inline-start: calc(var(--app-space-2) * -1);
  border: none;
  border-radius: var(--app-radius-full);
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;

  @include focus-ring;
}

@mixin back-glyph {
  font-size: var(--app-icon-md);
}
```

Both templates render the caret and move the string to the accessible name, so nothing
is lost for a screen reader:

```html
<button
  (click)="back()"
  [attr.aria-label]="'zone.detail.back' | rokuT"
  class="back"
  type="button"
>
  <lib-chevron-left-icon class="back-glyph" />
</button>
```

`ChevronLeftIcon` is already in `libs/velista/ui/src/lib/icons/icons.ts` and already
exported from `@portfolio/velista/ui`. Add it to each page component's `imports`.

The negative inline start margin keeps the glyph optically aligned with the content
below it: the button is wider than the caret, so without it the caret sits indented
from the column it heads.

### Files

- `libs/velista/feature-zones/src/lib/_zone-page.scss`
- `libs/velista/feature-zones/src/lib/group-page/group-page.html`, `.scss`, `.ts`
- `libs/velista/feature-zones/src/lib/members-page/members-page.html`, `.scss`, `.ts`

### Acceptance

- Both zone pages show a caret button, 44 by 44, with a visible focus ring.
- Its accessible name is still the translated "Back".
- No page shows the word "Back" as text any more.

---

## 5. A bottom sheet has no close animation

### Symptom

Every sheet in the app rises from the bottom on open and disappears instantly on close.

### Cause

`libs/velista/ui/src/lib/entry/sheet-shell.scss` has a `sheet-rise` keyframe on the
panel, and there is nowhere for an exit animation to live: rule E1 makes a sheet a route,
so `dismiss` is a navigation, and the router destroys the component before a frame of any
exit animation could be drawn.

### Fix

The shell delays the **navigation**, not the destruction. `requestDismiss()` marks the
sheet as closing, lets the panel fall, and emits `dismiss` when it has:

```ts
readonly closing = signal(false);

requestDismiss(): void {
  if (!this.dismissible() || this.closing()) {
    return;
  }

  const duration = this._motionDuration();
  this._returnFocusTo?.focus();

  if (duration === 0) {
    this.dismiss.emit();
    return;
  }

  this.closing.set(true);
  this._host.nativeElement.ownerDocument.defaultView?.setTimeout(
    () => this.dismiss.emit(),
    duration
  );
}

/** `--app-motion-base` in ms, or 0 when there is no stylesheet to read it from. */
private _motionDuration(): number {
  const view = this._host.nativeElement.ownerDocument.defaultView;
  if (view === null) {
    return 0;
  }

  const raw = view
    .getComputedStyle(this._host.nativeElement)
    .getPropertyValue('--app-motion-base');
  const ms = Number.parseFloat(raw);

  return Number.isFinite(ms) ? ms : 0;
}
```

Reading the token rather than hard coding a number buys two things for free. Under
`prefers-reduced-motion` the token is already `0ms`
(`app-motion-preferences` in `_semantic.scss`), so the sheet closes instantly with no
second code path to keep in step. And in jsdom, where no stylesheet is loaded, the
property resolves to an empty string, so the parse fails, the duration is zero and
`dismiss` is emitted synchronously: every existing spec keeps working without being
taught about timers.

The panel and the scrim take the closing state:

```html
<button ... [disabled]="!dismissible() || closing()" class="scrim"></button>
<div ... [class.closing]="closing()" class="panel"></div>
```

```scss
.panel {
  animation: sheet-rise var(--app-motion-base) var(--app-motion-ease);

  &.closing {
    animation: sheet-fall var(--app-motion-base) var(--app-motion-ease) forwards;
  }
}

@keyframes sheet-fall {
  to {
    transform: translateY(100%);
  }
}
```

`forwards`, so the panel stays down for the frames between the animation ending and the
route change landing. The scrim does not fade, for the reason it does not fade on the
way in: the page is already dimmed once and dimming it twice reads as a flicker.

### What this does not cover

A dismissal that does not come through `requestDismiss` still has no exit animation:
the Android back button, a browser back, and any navigation started elsewhere all
destroy the component directly. That is the trade rule E1 was chosen for, and it is the
right way round: the system back gesture must never wait on an animation to take effect.

### Files

- `libs/velista/ui/src/lib/entry/sheet-shell.ts`, `.html`, `.scss`
- `libs/velista/ui/src/lib/entry/sheet-shell.spec.ts`

### Acceptance

- Cancel, the scrim and Escape all play the fall before the route changes.
- Under `prefers-reduced-motion` the sheet closes with no animation and no delay.
- The scrim is not clickable while the sheet is closing, so the close cannot be
  started twice.
- All five sheets get it, from the shell alone: create group, join with a code, create a
  list, group settings, and the four member actions.

---

## 6. The members screen has no header

### Symptom

Every other authenticated screen opens with the app bar: wordmark on the left, search
and account on the right. The members screen starts at the back control. It also has no
title at all until it has finished loading, because the `h1` lives inside the loaded
branch of the state union.

### Cause

`libs/velista/feature-zones/src/lib/members-page/members-page.html` renders no
`<lib-app-bar>`, and its `<h1 class="title">` is inside the final `@else`.

### Fix

Match the group page, which is the screen this one is opened from:

```html
<lib-app-bar [accountInitial]="accountInitial()" [signedIn]="true" />
```

`MembersPage` already injects `SessionStore`, so `accountInitial` is the same four line
computed `GroupPage` has.

Move the title out of the state branches so the screen is named while it is loading and
while it is failing. On a cold deep link there is no cached group name to put in
"Members of {{name}}", so fall back to the plain `zone.detail.members` label rather than
rendering a sentence with a hole in it:

```ts
readonly title = computed(() => {
  const name = this._zones.zoneById(this.zoneId())?.name ?? '';
  return name === ''
    ? { key: 'zone.detail.members', name: '' }
    : { key: 'zone.members.title', name };
});
```

No new translation keys: both already exist.

### Files

- `libs/velista/feature-zones/src/lib/members-page/members-page.html`, `.ts`, `.scss`

### Acceptance

- The members screen opens with the app bar, like the group page.
- It is titled during the skeleton, during an error, and after it has loaded.
- Arriving cold on `/velista/en/zones/:id/members` shows "Members" rather than
  "Members of ".

---

## 7. The landing page is flat

### Symptom

The landing page is a single solid `--app-surface-ground`. The mock has depth: a soft
quarter circle bleeding off the top right corner, amber at the centre falling through
violet to nothing.

### Cause

It was never built. `apps/velista/plans/mocks/home/Main.dc.html` draws it as a 360 by
360 circle positioned at `top: -150px; right: -110px`, and
`libs/velista/feature-landing/src/lib/landing-page/landing-page.scss` has no equivalent.

### Fix

A **token**, not a background on one component. `token-hygiene.spec.ts` forbids a colour
function or a literal anywhere outside the three token files, and it is right to: a
gradient written into a component stylesheet cannot follow a theme.

In `libs/velista/ui/src/lib/styles/_themes.scss`, a new colour role in both themes. The
Night value is the mock's, channel for channel, through the primitives that already hold
those exact numbers (`amber-500` is `255 180 84`, `violet-400` is `167 139 250`,
`ink-950` is `10 12 20`):

```scss
// Night
--app-ambient-glow: radial-gradient(
  circle,
  rgb(var(--app-amber-500-rgb) / 15%) 0%,
  rgb(var(--app-violet-400-rgb) / 9%) 44%,
  rgb(var(--app-ink-950-rgb) / 0%) 72%
);

// Day
--app-ambient-glow: none;
```

Day is `none` on purpose and not by omission: `DayTheme.dc.html` draws no glow, because
the ramps that read as warmth on near black read as a stain on white. The role is
defined in both themes so the contract in `_semantic.scss`'s header stays complete, and
so a component can use it without asking which theme is on.

Add the role to that header comment, under a new `Ambient` line, and the geometry to
`_semantic.scss` beside the other layout constants:

```scss
--app-glow-size: 360px;
--app-glow-inset-block-start: -150px;
--app-glow-inset-inline-end: -110px;
```

Then the landing page draws it as a pseudo element, so it costs no element and can never
be tabbed to or clicked through:

```scss
.page {
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset-block-start: var(--app-glow-inset-block-start);
    inset-inline-end: var(--app-glow-inset-inline-end);
    inline-size: var(--app-glow-size);
    block-size: var(--app-glow-size);
    border-radius: var(--app-radius-full);
    background-image: var(--app-ambient-glow);
    pointer-events: none;
  }
}
```

`overflow: hidden` goes on `.page` and not on the host. The sheet outlet is a sibling of
`.page` for exactly this class of reason, and a clipped host would clip a fixed sheet's
scrim.

### Scope

The landing page only. `States.dc.html` draws a smaller glow on the empty dashboard and
`Authenticated.dc.html` draws none, so the authenticated surface is deliberately left
alone in this plan. The token is what makes adding it there later a one line change.

### Files

- `libs/velista/ui/src/lib/styles/_themes.scss`
- `libs/velista/ui/src/lib/styles/_semantic.scss`
- `libs/velista/feature-landing/src/lib/landing-page/landing-page.scss`

### Acceptance

- The landing page has the mock's warm corner on Night and stays flat on Day.
- `token-hygiene.spec.ts` passes: no literal and no raw pixel outside the token files.
- The glow is not interactive and does not add a scrollbar at any width.
- The entry sheets still cover the whole viewport.

---

## Testing

```sh
npx nx test velista-ui
npx nx test velista-feature-zones
npx nx test velista-data-access
npx nx test velista-feature-landing
npx nx lint velista --fix
npx nx build velista
```

Then through the shell, which is the only way a remote renders
(`npx nx serve velista`, then `/velista/en`):

1. Landing at `/velista/en`: the corner glow is there, and the entry sheets still open
   over it and close with a fall.
2. Group page: the back caret, group settings, rename, and the header updates.
3. Group settings, new code: both sheets close, the invite card holds the new code and
   says it is new.
4. Members: the app bar and the title are there before the rows are. Open a row menu,
   click elsewhere, it closes. Rename a member, the row changes. Remove one, the row
   goes.
5. Both themes, and once with `prefers-reduced-motion: reduce` set, where every sheet
   should open and close with no animation and no delay.

## Acceptance criteria

1. Every one of the seven defects above is closed, with its own section's acceptance
   met.
2. No new translation key ships in one language only.
3. `token-hygiene.spec.ts` and `layering.spec.ts` both still pass, so no colour, no
   pixel and no store injection has leaked into a `ui` component.
4. Nothing added here imports `@angular/core/rxjs-interop`, which module federation does
   not dedupe.
