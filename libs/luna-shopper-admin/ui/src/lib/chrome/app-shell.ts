import { NgComponentOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
  type Type,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { MenuIcon } from '@portfolio/shared/ui';
import { keepTabInside } from '../focus-trap';
import { PAGE_FRAME_TABS, type PageTab } from '../page/page-tabs';

/** One entry in the navigation: a section, or a screen inside one. */
export interface ShellLink {
  /** The route to go to, relative to the app root. */
  readonly path: string;
  /** A translation key. */
  readonly label: string;
  /**
   * Whether this entry is the current page only on exactly its own path.
   *
   * Prefix matching is what keeps `/harvest/runs` marked on `/harvest/runs/abc`,
   * and it is also what would leave a link to `/` marked on every screen in the
   * app, since every URL starts with a slash. So the overview asks for this and
   * nothing else does (admin plan 0022, section 4).
   */
  readonly exact?: boolean;
  /**
   * The icon above a section's label in the rail and the bar: an icon component
   * from `libs/shared/ui`. A screen inside a section has none.
   */
  readonly icon?: Type<unknown>;
  /**
   * How much work is waiting behind this link, when it is the sort of screen
   * that has an answer to that.
   *
   * A function rather than a number, so the badge follows the count instead of
   * whatever it was when the link list was built. It is read inside the
   * template, so a signal read here registers as a dependency and the badge
   * updates with no further wiring.
   *
   * **`null` is not zero**, even though both draw nothing. A queue that has not
   * been read yet, or that is per chain with no chain chosen, has no count at
   * all, and something that read it and found nothing has a count of none; the
   * badge is silent either way, because a drained queue does not need a `0`
   * beside its name (admin plan 0010, section 4).
   */
  badge?(): number | null;
}

/** How many sections the bar on a phone shows before "More". */
export const BAR_SECTIONS = 4;

/**
 * The frame around every screen (admin plan 0041).
 *
 * A rail at the side on a wide screen and a bar at the bottom on a phone. Both
 * take the colour of the deployment and write its name, because an operator has
 * to know which database they are about to change before they change it, and
 * the navigation is the one part of the app that looks the same on every
 * screen. A red rail reads as "this is production" and not as an error on the
 * page.
 *
 * There is no top bar. The page under the frame draws its own header, and the
 * screens of the current section reach it as tabs through
 * {@link PAGE_FRAME_TABS}, so nothing here takes height from the page on a wide
 * screen and only the bar does on a phone.
 *
 * This component draws the navigation and works out none of it. Which section
 * is current is a question about the URL, and `AdminShellPage` answers it.
 *
 * The switch between the rail and the bar is an input rather than a media
 * query, for the same reason the list's layout is: a switch a spec cannot set
 * is a switch nothing asserts.
 */
@Component({
  selector: 'lib-app-shell',
  imports: [
    NgComponentOutlet,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    RokuTranslatorPipe,
    MenuIcon,
  ],
  providers: [
    {
      provide: PAGE_FRAME_TABS,
      useFactory: () => inject(AppShell).tabs,
    },
  ],
  template: `
    @if (!compact()) {
      <nav [attr.aria-label]="'shell.navigation' | rokuT" class="rail">
        <ul>
          @for (section of sections(); track section.path) {
            <li>
              <a
                [routerLink]="section.path"
                [routerLinkActiveOptions]="{ exact: section.exact === true }"
                ariaCurrentWhenActive="page"
                class="entry"
                routerLinkActive="current"
              >
                <span class="icon">
                  @if (section.icon; as icon) {
                    <ng-container *ngComponentOutlet="icon" />
                  }
                </span>
                {{ section.label | rokuT }}
                @if (section.badge?.(); as waiting) {
                  <span
                    [attr.aria-label]="
                      'shell.waiting' | rokuT: { count: waiting }
                    "
                    class="count"
                    >{{ waiting }}</span
                  >
                }
              </a>
            </li>
          }
        </ul>

        <div class="foot">
          @if (deployment() !== undefined) {
            <p class="deployment">
              <span class="sr-only">{{ 'environment.label' | rokuT }}:</span>
              {{ deploymentKey() | rokuT }}
            </p>
          }

          <!-- The language the catalog is read in (admin plan 0026, section
               7). Beside the account rather than in a screen's toolbar,
               because it is a property of who is reading and not of what is
               on screen: in a filter bar it would read as narrowing the rows,
               which is the one thing it never does. -->
          <div class="menu-host">
            <button
              (click)="toggleMenu('language')"
              [attr.aria-expanded]="menu() === 'language'"
              [attr.aria-label]="
                ('shell.contentLanguage' | rokuT) +
                ': ' +
                ('shell.language.' + contentLocale() | rokuT)
              "
              class="foot-button"
              type="button"
              data-menu="language"
            >
              {{ contentLocale().toUpperCase() }}
            </button>
            @if (menu() === 'language') {
              <div class="menu" role="group">
                <p class="menu-title">{{ 'shell.contentLanguage' | rokuT }}</p>
                @for (locale of contentLocales(); track locale) {
                  <button
                    (click)="chooseContent(locale)"
                    [attr.aria-pressed]="locale === contentLocale()"
                    [class.on]="locale === contentLocale()"
                    type="button"
                  >
                    {{ 'shell.language.' + locale | rokuT }}
                  </button>
                }
              </div>
            }
          </div>

          <div class="menu-host">
            <button
              (click)="toggleMenu('account')"
              [attr.aria-expanded]="menu() === 'account'"
              [attr.aria-label]="'shell.account' | rokuT: { name: operator() }"
              class="foot-button"
              type="button"
              data-menu="account"
            >
              {{ initials() }}
            </button>
            @if (menu() === 'account') {
              <!-- Who is signed in, to which deployment, the language the
                   catalog is read in, and the way out (admin plan 0046,
                   target 9). The deployment is said here in words as well as
                   by the color of the rail. -->
              <div class="menu" role="group">
                <p class="menu-title who">{{ operator() }}</p>
                @if (deployment() !== undefined) {
                  <p class="menu-title">
                    {{ 'environment.label' | rokuT }}:
                    {{ deploymentKey() | rokuT }}
                  </p>
                }
                <p class="menu-title rule">
                  {{ 'shell.contentLanguage' | rokuT }}
                </p>
                @for (locale of contentLocales(); track locale) {
                  <button
                    (click)="chooseContent(locale)"
                    [attr.aria-pressed]="locale === contentLocale()"
                    [class.on]="locale === contentLocale()"
                    type="button"
                  >
                    {{ 'shell.language.' + locale | rokuT }}
                  </button>
                }
                <button (click)="leave()" class="danger rule" type="button">
                  {{ 'shell.signOut' | rokuT }}
                </button>
              </div>
            }
          </div>
        </div>
      </nav>
    }

    <main [class.compact]="compact()">
      <router-outlet />
    </main>

    @if (compact()) {
      <nav [attr.aria-label]="'shell.navigation' | rokuT" class="bar">
        @for (section of shown(); track section.path) {
          <a
            (click)="closeMenu(false)"
            [routerLink]="section.path"
            [routerLinkActiveOptions]="{ exact: section.exact === true }"
            ariaCurrentWhenActive="page"
            class="entry"
            routerLinkActive="current"
          >
            <span class="icon">
              @if (section.icon; as icon) {
                <ng-container *ngComponentOutlet="icon" />
              }
            </span>
            {{ section.label | rokuT }}
            @if (section.badge?.(); as waiting) {
              <span
                [attr.aria-label]="'shell.waiting' | rokuT: { count: waiting }"
                class="count"
                >{{ waiting }}</span
              >
            }
          </a>
        }

        <button
          (click)="toggleMenu('more')"
          [attr.aria-expanded]="menu() === 'more'"
          [class.current]="moreCurrent()"
          aria-haspopup="dialog"
          class="entry"
          type="button"
          data-menu="more"
        >
          <span class="icon"><lib-menu-icon /></span>
          {{ 'shell.more' | rokuT }}
          @if (moreWaiting(); as waiting) {
            <span
              [attr.aria-label]="'shell.waiting' | rokuT: { count: waiting }"
              class="count"
              >{{ waiting }}</span
            >
          }
        </button>
      </nav>

      @if (menu() === 'more') {
        <!-- A press on the scrim is a press outside the sheet, which the
             document listener of this component already closes on. -->
        <div class="scrim"></div>
        <section
          (keydown)="keepInside($event)"
          [attr.aria-label]="'shell.more' | rokuT"
          #sheet
          aria-modal="true"
          class="sheet"
          role="dialog"
          tabindex="-1"
        >
          <p class="sheet-head">
            @if (deployment() !== undefined) {
              <span class="deployment">
                <span class="sr-only">{{ 'environment.label' | rokuT }}:</span>
                {{ deploymentKey() | rokuT }}
              </span>
            }
            <span class="who">{{
              'shell.signedInAs' | rokuT: { name: operator() }
            }}</span>
          </p>

          @for (section of overflow(); track section.path) {
            <a
              (click)="closeMenu(false)"
              [routerLink]="section.path"
              [routerLinkActiveOptions]="{ exact: section.exact === true }"
              ariaCurrentWhenActive="page"
              class="item"
              routerLinkActive="current"
            >
              {{ section.label | rokuT }}
              @if (section.badge?.(); as waiting) {
                <span class="waiting">{{
                  'shell.waiting' | rokuT: { count: waiting }
                }}</span>
              }
            </a>
          }

          <div
            [attr.aria-label]="'shell.contentLanguage' | rokuT"
            class="item language"
            role="group"
          >
            <span>{{ 'shell.contentLanguage' | rokuT }}</span>
            @for (locale of contentLocales(); track locale) {
              <button
                (click)="chooseContent(locale)"
                [attr.aria-pressed]="locale === contentLocale()"
                [class.on]="locale === contentLocale()"
                type="button"
              >
                {{ 'shell.language.' + locale | rokuT }}
              </button>
            }
          </div>

          <button (click)="leave()" class="item danger" type="button">
            {{ 'shell.signOut' | rokuT }}
          </button>
        </section>
      }
    }
  `,
  host: {
    '(document:click)': 'pressed($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-inline-size: 0;
    }

    /* The rail. It stays in view while the page scrolls, and takes no height
       from the page: it is beside it. */
    .rail {
      position: sticky;
      z-index: 10;
      inset-block-start: 0;
      display: flex;
      flex: none;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: center;
      inline-size: 4.75rem;
      block-size: 100dvh;
      padding-block: 0.625rem;
      background: var(--admin-nav);
    }

    .rail ul {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.125rem;
      min-block-size: 0;
      overflow-y: auto;
      list-style: none;
      scrollbar-width: none;
    }

    .entry {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.1875rem;
      align-items: center;
      justify-content: center;
      min-block-size: 0;
      padding: 0;
      border: none;
      border-radius: 0.5rem;
      background: var(--admin-nav);
      font: inherit;
      font-size: 0.6875rem;
      line-height: 1.2;
      text-decoration: none;
      color: var(--admin-nav-ink);
      cursor: pointer;
    }

    .rail .entry {
      inline-size: 4rem;
      block-size: 3.375rem;
    }

    .entry.current {
      background: var(--admin-nav-current);
      color: var(--admin-nav-current-ink);
    }

    .icon {
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }

    /* How much waits behind the entry: dark text on the near white, so that it
       reads on every one of the four navigation colours. */
    .count {
      position: absolute;
      inset-block-start: 0.25rem;
      inset-inline-end: 0.375rem;
      display: flex;
      align-items: center;
      justify-content: center;
      min-inline-size: 1.125rem;
      block-size: 1.125rem;
      padding-inline: 0.3125rem;
      border-radius: 0.5625rem;
      background: var(--admin-count);
      font-size: 0.6875rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink);
    }

    .foot {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      align-items: center;
    }

    /* The name of the deployment, so that colour is never the only sign. */
    .deployment {
      padding: 0.125rem 0.375rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-count);
      font-size: 0.625rem;
      font-weight: 600;
      color: var(--admin-ink);
    }

    .menu-host {
      position: relative;
    }

    .foot-button {
      inline-size: 2.75rem;
      min-block-size: 2.25rem;
      padding: 0;
      border: 1px solid
        color-mix(in srgb, var(--admin-nav-ink) 45%, var(--admin-nav));
      border-radius: var(--admin-radius-control);
      background: var(--admin-nav);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-nav-ink);
      cursor: pointer;
    }

    /* A ring in the near white: the accent would vanish on a red or a blue
       rail. */
    .entry:focus-visible,
    .foot-button:focus-visible {
      outline: 2px solid var(--admin-count);
      outline-offset: -2px;
    }

    .menu {
      position: absolute;
      z-index: 20;
      inset-block-end: 0;
      inset-inline-start: calc(100% + 0.75rem);
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      min-inline-size: 12rem;
      padding: var(--admin-space-2);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.5rem 1.5rem rgb(20 33 29 / 16%);
      color: var(--admin-ink);
    }

    .menu-title {
      padding: var(--admin-space-1) var(--admin-space-2);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .menu-title.who {
      font-size: 0.875rem;
      color: var(--admin-ink);
    }

    .menu button {
      border-color: transparent;
      text-align: start;
      cursor: pointer;
    }

    .menu button.on,
    .language button.on {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .menu button.danger {
      color: var(--admin-danger);
    }

    /* A line above a part of the menu that is about something else. */
    .menu .rule {
      margin-block-start: var(--admin-space-1);
      padding-block-start: var(--admin-space-2);
      border-block-start: 1px solid var(--admin-border);
      border-start-start-radius: 0;
      border-start-end-radius: 0;
    }

    main {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
      padding: var(--admin-page-block) var(--admin-page-inline);
    }

    /* The page reserves the height of the bar, so that the last row of a long
       list can be scrolled above it. */
    main.compact {
      padding-block-end: calc(var(--admin-page-block) + var(--admin-bar));
    }

    /* The bar: the only fixed thing on a phone. */
    .bar {
      position: fixed;
      z-index: 25;
      inset: auto 0 0;
      display: flex;
      block-size: var(--admin-bar);
      padding-block-end: env(safe-area-inset-bottom, 0px);
      background: var(--admin-nav);
    }

    .bar .entry {
      flex: 1;
      border-radius: 0;
    }

    .bar .count {
      inset-block-start: 0.3125rem;
      inset-inline-end: calc(50% - 1.5rem);
    }

    .scrim {
      position: fixed;
      z-index: 23;
      inset: 0;
      background: rgb(20 33 29 / 50%);
    }

    /* The sheet sits on the bar and leaves it in view: "More" is still the way
       to close it, and the other sections are still one press away. */
    .sheet {
      position: fixed;
      z-index: 24;
      inset: auto 0 var(--admin-bar);
      display: flex;
      flex-direction: column;
      padding: var(--admin-space-4) var(--admin-space-4) var(--admin-space-3);
      border-radius: 0.875rem 0.875rem 0 0;
      background: var(--admin-surface-raised);
    }

    .sheet-head {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      padding-block-end: var(--admin-space-3);
    }

    /* The same label as in the rail: dark text on the near white (plan 0041,
       section 2). The sheet is the near white too, so here it gets a line
       round it to stay a label. */
    .sheet-head .deployment {
      border: 1px solid var(--admin-border-strong);
      font-size: 0.6875rem;
    }

    /* The sheet takes the focus when it opens. It is not a control, so it
       draws no ring. */
    .sheet:focus {
      outline: none;
    }

    .who {
      color: var(--admin-ink-muted);
    }

    .item {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 3rem;
      padding: 0 var(--admin-space-1);
      border: none;
      border-block-start: 1px solid var(--admin-border);
      border-radius: 0;
      background: none;
      font: inherit;
      text-align: start;
      text-decoration: none;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .item.current {
      font-weight: 600;
    }

    .item.danger {
      color: var(--admin-danger);
    }

    .item.language {
      cursor: default;
    }

    .item.language span {
      flex: 1;
    }

    .waiting {
      margin-inline-start: auto;
      padding: 0.0625rem 0.375rem;
      border-radius: 0.5625rem;
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-waiting-on-wash);
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }

    /* The sheet fades, as every sheet does. The two menus of the rail do not:
       the plan names no motion for them. */
    @media (prefers-reduced-motion: no-preference) {
      .scrim,
      .sheet {
        animation: appear 120ms ease-out;
      }
    }

    @keyframes appear {
      from {
        opacity: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _sheet = viewChild<ElementRef<HTMLElement>>('sheet');

  /**
   * The sections, in the order they are drawn.
   *
   * Every entry is matched by prefix unless it asks for `exact`, which is what
   * keeps a section marked while the operator is on a screen inside it and what
   * stops the overview being marked everywhere.
   */
  readonly sections = input.required<readonly ShellLink[]>();
  /**
   * The screens inside the section the operator is in, which every page of
   * that section shows as its tabs.
   *
   * Empty for a section that has only its own home, which is the overview and
   * the admins section.
   */
  readonly screens = input<readonly ShellLink[]>([]);
  /**
   * Which section the operator is in, as its path.
   *
   * Only the bar needs it, to mark "More" while the current section is one of
   * those behind it. `routerLinkActive` answers the same question for a link,
   * and "More" is a button with no link to ask.
   *
   * Told, not worked out. `AdminShellPage` decides which section a URL is in,
   * exactly as it decides which screens exist.
   */
  readonly current = input<string | null>(null);
  /** `null` when the environment could not be established, `undefined` while asking. */
  readonly deployment = input.required<Deployment | null | undefined>();
  /** What to call the operator. */
  readonly operator = input('');
  readonly compact = input(false);

  /**
   * The language the operator reads the catalog in (admin plan 0026).
   *
   * **Not the interface language.** The labels around it are English whatever
   * this says, because the catalog is read by shoppers and the back office is
   * read by one operator, and the two lists are different lengths.
   */
  readonly contentLocale = input('');
  /** The languages the content is written in, as the options to offer. */
  readonly contentLocales = input<readonly string[]>([]);

  readonly signOut = output<void>();
  /** The operator picked a language to read the catalog in. */
  readonly chooseContentLocale = output<string>();

  /** Which of the three menus is open: one at a time, or none. */
  readonly menu = signal<'language' | 'account' | 'more' | null>(null);

  /** The sections the bar has room for. */
  readonly shown = computed(() => this.sections().slice(0, BAR_SECTIONS));
  /** The sections behind "More". */
  readonly overflow = computed(() => this.sections().slice(BAR_SECTIONS));

  /** Whether the operator is in a section that only "More" reaches. */
  readonly moreCurrent = computed(() =>
    this.overflow().some((section) => section.path === this.current())
  );

  /**
   * What waits behind "More": the sum of the sections it holds.
   *
   * Work waiting behind an entry the operator cannot see is the one way a
   * bar of five makes this app worse than a list of every section.
   */
  readonly moreWaiting = computed(() =>
    this.overflow().reduce((sum, section) => sum + (section.badge?.() ?? 0), 0)
  );

  /**
   * The key for the short name of the deployment.
   *
   * A key per deployment, so a name this app does not know cannot reach the
   * screen as raw text from the API. A local stack answers `development`, and
   * the word for that is "LOCAL".
   */
  readonly deploymentKey = computed(
    () => `environment.short.${this.deployment() ?? 'unknown'}`
  );

  /** The operator in two letters, for a button 44 px wide. */
  readonly initials = computed(() =>
    this.operator()
      .split(/[\s._-]+/)
      .filter((word) => word !== '')
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('')
  );

  /** The screens of the current section, as the tabs a page header draws. */
  readonly tabs = computed<readonly PageTab[]>(() =>
    this.screens().map((screen) => ({
      path: screen.path,
      label: screen.label,
      exact: screen.exact,
      waiting: true,
      count: () => screen.badge?.() ?? null,
    }))
  );

  toggleMenu(name: 'language' | 'account' | 'more'): void {
    this.menu.update((open) => (open === name ? null : name));

    if (this.menu() === 'more') {
      // The sheet is modal: the focus moves into it when it opens, and
      // `keepInside` holds Tab there until it closes.
      afterNextRender(() => this._sheet()?.nativeElement.focus(), {
        injector: this._injector,
      });
    }
  }

  /** Tab stays inside the "More" sheet while it is open. */
  keepInside(event: KeyboardEvent): void {
    const sheet = this._sheet()?.nativeElement;

    if (sheet !== undefined) {
      keepTabInside(event, sheet);
    }
  }

  /**
   * Close whichever menu is open.
   *
   * `refocus` gives the focus back to the button that opened it. That is right
   * for Escape and for a choice made inside the menu, whose own button has
   * just been taken off the screen. It is wrong for a link that was followed,
   * where the focus belongs to the page, and for a press somewhere else, where
   * it belongs to whatever was pressed.
   */
  closeMenu(refocus = false): void {
    const open = this.menu();
    if (open === null) {
      return;
    }

    this.menu.set(null);

    if (refocus) {
      this._host.nativeElement
        .querySelector<HTMLElement>(`[data-menu="${open}"]`)
        ?.focus();
    }
  }

  chooseContent(locale: string): void {
    this.chooseContentLocale.emit(locale);
    this.closeMenu(true);
  }

  leave(): void {
    this.closeMenu(false);
    this.signOut.emit();
  }

  /** A press outside an open menu closes it. */
  pressed(event: Event): void {
    const target = event.target;

    if (
      this.menu() !== null &&
      target instanceof Element &&
      target.closest('.menu-host, .sheet, [data-menu]') === null
    ) {
      this.closeMenu();
    }
  }
}
