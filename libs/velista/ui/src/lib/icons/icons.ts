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
