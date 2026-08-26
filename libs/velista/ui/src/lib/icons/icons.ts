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
