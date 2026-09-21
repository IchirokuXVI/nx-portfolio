import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { BasketIcon, HomeIcon, ProductIcon } from '../icons/icons';

/** The three tabs, left to right. `null` is every other screen in the app. */
export type NavTab = 'home' | 'catalog' | 'basket';

/** Above this, the badge says so rather than saying a number nobody reads. */
const BADGE_MAX = 99;

/**
 * Which tab a URL lights, which is often none.
 *
 * `home` lights Home, `catalog` lights Catalog, anything under `shopping-lists` lights
 * Shopping list, and every other screen lights nothing. **The bar on the account screen
 * is a way out, not a claim about where you are** (section 2).
 *
 * The segment is found rather than counted, because how many segments sit in front of
 * it is the one thing this component may not know: the mount is `/velista` under the
 * portfolio and `''` on velista's own origin (the extraction contract, item 5), and the
 * locale is one more. No page in this app takes any of the three words as a later
 * segment, so the first match is the page.
 *
 * A pure function, and exported, so the rule is testable without a component and the
 * component cannot hold a second copy of it.
 */
export function activeNavTab(url: string): NavTab | null {
  const path = url.split('#')[0]?.split('?')[0] ?? '';

  for (const segment of path.split('/')) {
    if (segment === 'home') {
      return 'home';
    }
    if (segment === 'catalog') {
      return 'catalog';
    }
    if (segment === 'shopping-lists') {
      return 'basket';
    }
  }

  return null;
}

/**
 * The bar at the bottom of the app: three tabs, drawn once for the whole of it
 * (velista `0097`).
 *
 * velista had no navigation. Every screen was reached by going into something and
 * every way back was a chevron, so the catalog had no door and the basket being
 * shopped was three taps from the list somebody was reading.
 *
 * ## What it is, and what decides it
 *
 * Presentational, and drawn by `AppLayout` as a sibling of the outlet. **Whether it is
 * drawn at all is not this component's question**: `NavChrome` answers that in
 * `platform`, because it needs the router and rule D1 keeps every router read out of
 * this library. What arrives here is the URL and a number.
 *
 * ## Every tab is a word under a glyph
 *
 * Never a bare glyph. The words are nouns a person would use rather than features, so
 * somebody who has never opened the app can read the row and know where each one goes.
 * The active tab is drawn **twice over**, in the quiet action colour and behind a pill
 * of the same hue, because colour alone is not a state (plan `0002`, section 11).
 *
 * ## The links are built here and the paths are literals
 *
 * `appPath` puts the mount and the locale in front, so neither is written down. The
 * segments are written out rather than taken from `BASKET_PATHS`, which is the route
 * table's own reason for writing them out: that constant lives in a lazy loaded
 * library, and naming it here would pull every basket screen into the shell's initial
 * payload.
 */
@Component({
  selector: 'lib-app-nav',
  imports: [RokuTranslatorPipe, RouterLink, BasketIcon, HomeIcon, ProductIcon],
  templateUrl: './app-nav.html',
  styleUrl: './app-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppNav {
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Where the app is, from `NavChrome`. The only thing that decides the active tab. */
  readonly url = input.required<string>();

  /**
   * How many lines the live basket still needs, or null for no badge.
   *
   * From `LiveBasketBadge`, which `data-access` writes: a `ui` component may not read a
   * store (rule D1), and this is the inversion that resolves it.
   */
  readonly badge = input<number | null>(null);

  readonly active = computed(() => activeNavTab(this.url()));

  readonly homeUrl = computed(() =>
    appPath(this._locale(), this._basePath, 'home')
  );

  readonly catalogUrl = computed(() =>
    appPath(this._locale(), this._basePath, 'catalog')
  );

  /**
   * The third tab opens the basket being shopped, through the screen that finds it
   * (section 7). `current` is a word rather than an id, and the route table declares it
   * before `:basketId` so it is never read as one.
   */
  readonly basketUrl = computed(() =>
    appPath(this._locale(), this._basePath, 'shopping-lists', 'current')
  );

  /** The mark itself: the number, or `99+` for anything a person would not read. */
  readonly badgeText = computed(() => {
    const pending = this.badge();
    if (pending === null || pending <= 0) {
      return null;
    }

    return pending > BADGE_MAX ? `${BADGE_MAX}+` : `${pending}`;
  });

  /** Whether a tab is the one being drawn, for its class and its `aria-current`. */
  isActive(tab: NavTab): boolean {
    return this.active() === tab;
  }
}
