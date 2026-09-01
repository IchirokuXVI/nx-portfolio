import { ChangeDetectionStrategy, Component } from '@angular/core';
import { inlineSvg } from './inline-svg';

/**
 * Every icon this app draws, one standalone component each.
 *
 * CLAUDE.md: an icon is a standalone component built from an inlined SVG, and raw
 * `<svg>` markup never appears in a feature or ui component. They are gathered in one
 * file rather than one directory each because each is three lines and the artwork,
 * which is the part worth reading, lives in the `.svg` beside it.
 *
 * **Every icon is `aria-hidden`.** None of them carries meaning on its own: each sits
 * beside a text label, or inside a button whose accessible name comes from
 * `aria-label`. An icon that announced itself as well would make a screen reader say
 * everything twice, and `0002` section 11 already requires the label to exist.
 *
 * Colour comes from `currentColor`, so an icon takes the colour of the text it sits
 * with and follows a theme change for free (plan 0002, rule T1). The two exceptions
 * are deliberate and marked below.
 *
 * `0002` section 9 places the product-neutral ones (chevron, plus, search, copy) in
 * `libs/shared/ui` instead, on the test "would another app plausibly use it?".
 * They are here for now because `shared/ui`'s icons follow an older four-file pattern
 * with `@Input` and a `templateUrl`, and adding eight components in a newer style
 * there would leave two conventions in one library. Moving them is mechanical and is
 * its own change.
 */

const TEMPLATE = `<span aria-hidden="true" [innerHTML]="svg()" class="icon"></span>`;

@Component({
  selector: 'lib-chevron-right-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChevronRightIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./chevron-right-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-chevron-down-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChevronDownIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./chevron-down-icon.svg?raw')
  );
}

/**
 * Back, on a page that is a destination rather than a sheet (plan 0009, section 4.1).
 *
 * A separate file from `chevron-right-icon` rather than the same artwork under a CSS
 * rotation: a rotated glyph flips again under `dir="rtl"`, where back is genuinely the
 * other way round, and the rotation would then be fighting the direction rather than
 * following it.
 */
@Component({
  selector: 'lib-chevron-left-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChevronLeftIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./chevron-left-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-plus-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlusIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./plus-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-search-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./search-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-copy-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./copy-icon.svg?raw')
  );
}

/**
 * A line that is ready. The tick is knocked out in `--app-surface-raised` rather than
 * in `currentColor`, because the circle is filled: a tick in the same colour would be
 * invisible. It is a token rather than a literal so it still follows the theme.
 */
@Component({
  selector: 'lib-check-circle-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckCircleIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./check-circle-icon.svg?raw')
  );
}

/** A line nobody has picked up yet. */
@Component({
  selector: 'lib-circle-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CircleIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./circle-icon.svg?raw')
  );
}

/** A line the shop did not have. */
@Component({
  selector: 'lib-x-circle-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XCircleIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./x-circle-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-list-lines-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListLinesIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./list-lines-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-member-add-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberAddIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./member-add-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-join-code-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinCodeIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./join-code-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-offline-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./offline-icon.svg?raw')
  );
}

/** Sharing an invite, on the card the creator lands on (plan 0008). */
@Component({
  selector: 'lib-share-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./share-icon.svg?raw')
  );
}

/** Waiting on somebody else, which is what a pending membership is. */
@Component({
  selector: 'lib-clock-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClockIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./clock-icon.svg?raw')
  );
}

/**
 * The two glyphs that sit beside a sentence about what just happened: a rejection,
 * and a quiet notice.
 *
 * Plan 0008 section 4.2 counts two missing icons, the share and the clock, because
 * those are the two its new components need. These two are missing as well and the
 * mock draws both, in the rejected state of `JoinCode.dc.html` and in the guest
 * notices on `CreateGroup.dc.html` and `JoinLink.dc.html`. Leaving them out would
 * build a screen the approved design does not show.
 */
@Component({
  selector: 'lib-alert-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./alert-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-info-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./info-icon.svg?raw')
  );
}

/**
 * A request in flight.
 *
 * An icon rather than a bordered circle in CSS, because the arc is artwork and this
 * library's rule is that artwork lives in an `.svg`. Its rotation is driven by the
 * host, so a caller decides whether it turns; under `prefers-reduced-motion` the
 * motion tokens are zero and it simply sits still while still marking the button as
 * busy (plan 0002, section 4.5).
 */
@Component({
  selector: 'lib-spinner-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'spinning' },
})
export class SpinnerIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./spinner-icon.svg?raw')
  );
}

/**
 * The password reveal toggle's two states (plan 0009, section 7).
 *
 * Two icons and not one that is styled differently, because the difference between
 * showing and hiding a password has to survive a monochrome display and a person who
 * cannot distinguish the amber from the grey. The button's `aria-label` carries the
 * same distinction for anybody who is not looking at it at all.
 */
@Component({
  selector: 'lib-eye-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EyeIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./eye-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-eye-off-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EyeOffIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./eye-off-icon.svg?raw')
  );
}

/** The confirm-your-email nudge, and nothing else: this app sends one kind of mail. */
@Component({
  selector: 'lib-mail-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./mail-icon.svg?raw')
  );
}

/** Dismissing something optional. The first control in this app that is an X. */
@Component({
  selector: 'lib-close-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloseIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./close-icon.svg?raw')
  );
}

/**
 * A bare tick, for the badge on the confirmed screen.
 *
 * The circle around it there is a styled element rather than part of the artwork,
 * because it is 60px of surface and border that follows the theme, which a two colour
 * glyph could not do.
 */
@Component({
  selector: 'lib-check-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./check-icon.svg?raw')
  );
}

/**
 * A ticked circle drawn in outline, beside a sentence.
 *
 * Distinct from `check-circle-icon`, which is filled and knocks its tick out in the
 * surface colour: that one marks a list line as done at a glance in a dense row, and
 * this one sits inline with text where a filled disc would read as a bullet.
 */
@Component({
  selector: 'lib-check-outline-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckOutlineIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./check-outline-icon.svg?raw')
  );
}

/**
 * Google's mark, in Google's colours.
 *
 * The one icon that does not use `currentColor`, and the one that must not: the
 * colours are part of a third party's brand and their sign-in branding guidelines
 * require them exactly. That is also why it lives in this library rather than in
 * `shared/ui` (plan 0002, section 9): it is a brand asset tied to this app's sign-in
 * flow, not a UI primitive.
 */
@Component({
  selector: 'lib-google-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./google-icon.svg?raw')
  );
}

/** A person, for the members link and for a row with no letter to draw. */
@Component({
  selector: 'lib-person-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./person-icon.svg?raw')
  );
}

/**
 * The row menu's button.
 *
 * Three dots and no text, which is the one shape a control here is allowed to take
 * without a label: the button carries an `aria-label` naming the person whose row it
 * belongs to, so a screen reader hears "More options for Marta" rather than "button"
 * repeated down a list (plan 0010, section 7).
 */
@Component({
  selector: 'lib-ellipsis-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EllipsisIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./ellipsis-icon.svg?raw')
  );
}

/**
 * A warning triangle, for a group whose owner has gone.
 *
 * Distinct from `AlertIcon`, which is a circled cross and reads as a failure. Nothing
 * has failed here: something will happen unless somebody acts, which is a different
 * thing to say and deserves a different shape (section 3.5).
 */
@Component({
  selector: 'lib-warning-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WarningIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./warning-icon.svg?raw')
  );
}

/**
 * A filled circle with a tick knocked out of it: a line that has been got.
 *
 * Filled rather than outlined, and that is the whole point of it existing beside
 * `CheckOutlineIcon`. On a row the state control is read at a glance in a moving hand,
 * so the difference between done and not done is a difference in **weight**, which
 * survives being seen badly. The knockout uses the raised surface rather than
 * `currentColor`, because the tick has to punch through whatever colour the ring takes.
 */
@Component({
  selector: 'lib-check-filled-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckFilledIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./check-filled-icon.svg?raw')
  );
}

/**
 * A circle with a stroke through it: on the list, and not in the shop.
 *
 * Distinct from `XCircleIcon`, which is a cross and reads as a failure or a dismissal.
 * Nothing has failed here and nobody has cancelled anything: the item is still wanted
 * and the shop did not have it, which is a third thing and gets a third shape
 * (section 3.4).
 */
@Component({
  selector: 'lib-slash-circle-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlashCircleIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./slash-circle-icon.svg?raw')
  );
}

/**
 * A speech bubble: the comment count and the sheet it opens, and **the app bar's way
 * into the assistant** (plan 0032, section 1).
 *
 * Two uses and one glyph, which is what that plan's instruction to check whether an
 * icon already fits before adding another comes out at here: the design's assistant
 * mark is this bubble, redrawn. A second component with the same artwork would be two
 * files that have to keep matching for no gain.
 *
 * They do not read as the same control despite that. On a row the bubble carries a
 * count and sits among the line's own affordances; in the app bar it is alone in a slot
 * that has never held anything else, and both carry their own `aria-label`.
 */
@Component({
  selector: 'lib-comment-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./comment-icon.svg?raw')
  );
}

/**
 * Two columns of dots: the grip a row is dragged by in reorder mode.
 *
 * It is a **focusable button** and not decoration, because up and down on it move the
 * row. A grip that only answered a pointer would put the manual order out of reach of
 * anybody without a working one (section 7).
 */
@Component({
  selector: 'lib-grip-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GripIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./grip-icon.svg?raw')
  );
}

/**
 * A paper plane: sending the comment in the box beside it.
 *
 * The glyph rather than the word, because the composer's button has to be as tall as
 * a two row textarea to sit level with it, and a tall button with "Send" written
 * across the middle of it reads as a panel rather than as a control. The accessible
 * name is still the word, carried by the button (plan 0025).
 */
@Component({
  selector: 'lib-send-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./send-icon.svg?raw')
  );
}

/**
 * The dictation's four glyphs (plan 0032, section 4).
 *
 * They are shapes before they are colours, and that is the requirement rather than the
 * styling: **colour is never the only signal** here. Stop is a square, pause is two
 * bars, carry on is a triangle, and the microphone is the microphone. Somebody who
 * cannot tell the amber from the coral still has four distinguishable controls, and
 * confusing pause with stop costs a whole spoken message.
 *
 * Filled rather than stroked, apart from the microphone, because each is read at a
 * glance in a moving hand at 52px: weight survives being seen badly, and an outline of
 * a square is a rectangle with a hole in it.
 */
@Component({
  selector: 'lib-mic-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./mic-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-stop-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StopIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./stop-icon.svg?raw')
  );
}

@Component({
  selector: 'lib-pause-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PauseIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./pause-icon.svg?raw')
  );
}

/** Carry on after a pause. A triangle, so it is not the pause with a colour swapped. */
@Component({
  selector: 'lib-play-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./play-icon.svg?raw')
  );
}

/**
 * The five glyphs the install screens draw (plan 0033).
 *
 * `libs/shared/ui` already has a `download-icon`, and CLAUDE.md says to look there
 * first, which is what happened: it is a filled glyph in the older four file pattern,
 * with an `@Input` for its colour and no `:host` sizing, so putting it beside these
 * would leave two icon languages on one card. The note at the top of this file already
 * records that split, and moving the whole set is still its own change.
 *
 * Every one of them is decorative. Each step names the control in words, because the
 * person the steps are written for is exactly the person who cannot see the glyph
 * (section 7).
 */
@Component({
  selector: 'lib-install-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./install-icon.svg?raw')
  );
}

/**
 * Apple's Share glyph, the box with the arrow leaving it.
 *
 * Distinct from `ShareIcon`, which is three linked nodes and means sharing an invite.
 * This one is not a metaphor: it is a picture of the button somebody has to find in
 * Safari's toolbar, and the iOS steps are much harder to follow without it.
 */
@Component({
  selector: 'lib-share-ios-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareIosIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./share-ios-icon.svg?raw')
  );
}

/** Four corners pushing outwards: the whole screen, with no browser around it. */
@Component({
  selector: 'lib-fullscreen-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FullscreenIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./fullscreen-icon.svg?raw')
  );
}

/** A handset: one tap from the home screen. */
@Component({
  selector: 'lib-phone-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./phone-icon.svg?raw')
  );
}

/**
 * The signal arcs, drawn whole.
 *
 * Deliberately not `OfflineIcon`, which is the same arcs struck through and means
 * something is wrong. This sits beside a benefit, and a warning glyph on a benefit
 * reads as the opposite of what the line says.
 */
@Component({
  selector: 'lib-signal-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignalIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./signal-icon.svg?raw')
  );
}

/**
 * Throw away a recording that has not been sent (plan 0041, section 4).
 *
 * Here rather than from `@portfolio/shared/ui`, which does have a `trash-icon`:
 * that one is the older four file pattern with an `@Input` for its colour, and
 * velista imports none of the shared icons. Reaching for it would add this
 * library's first cross library icon dependency and leave two icon languages
 * inside one row, which is the same reasoning the note at the top of this file
 * gives for the product neutral glyphs.
 */
@Component({
  selector: 'lib-trash-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrashIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./trash-icon.svg?raw')
  );
}

/**
 * A shopping basket, drawn for two things that are both baskets.
 *
 * On a **group** in the composer's suggestions (plan 0043, section 6), it marks the
 * row that adds several products at once, which is the one thing a person choosing
 * between "Milk" and "Leche entera Pascual, 1 L" needs to tell apart at a glance. The
 * badge beside it says the same thing in a word, because a glyph alone is not a
 * distinction anybody has been taught yet.
 *
 * On a **generated shopping list** (plan 0045) it marks the thing everywhere it
 * appears: the dashboard's primary action, the card above it, the history page's empty
 * state. `ListLinesIcon` is the *zone* list's glyph and stays that, because the two are
 * different objects and drawing them alike is exactly the confusion the naming note in
 * `generated-list-view` is about: a zone list is a standing collection, a basket is one
 * trip composed out of several of them.
 *
 * One component for both, because it is one picture of one idea. Splitting it would
 * leave two files to keep in sync for a glyph nobody would draw differently.
 */
@Component({
  selector: 'lib-basket-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./basket-icon.svg?raw')
  );
}

/**
 * A carton: the glyph on one catalog **product**, and on a product chip.
 *
 * Deliberately quieter than the basket beside it. A group ranks above an item and
 * is the answer most people want, so the item rows are the ordinary weight and the
 * group is the one that stands out.
 */
@Component({
  selector: 'lib-product-icon',
  template: TEMPLATE,
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductIcon {
  readonly svg = inlineSvg(
    () =>
      // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
      import('./product-icon.svg?raw')
  );
}
