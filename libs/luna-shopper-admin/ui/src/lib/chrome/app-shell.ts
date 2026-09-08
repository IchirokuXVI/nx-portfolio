import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { EnvironmentBadge } from '../environment/environment-badge';

/** One entry in the navigation, on either row. */
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
   * nothing else does (admin plan 0022, section 4). It used to be the shell's own
   * rule, written as a comparison against `/`; it is on the entry now, because a
   * section is a route branch and the shell has no business knowing which branch
   * happens to be the root.
   */
  readonly exact?: boolean;
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
   * beside its name. The difference is on the row rather than in the chrome
   * (admin plan 0010, section 4).
   */
  badge?(): number | null;
}

/**
 * The chrome around every screen (plan 0004, section 7).
 *
 * Navigation between resources, who is signed in, the way out, and the
 * environment colour and name. The last of those is on **every** screen and not
 * only on the login page, which is the point of `0001`'s unauthenticated read:
 * an operator has to know which database they are about to change before they
 * change it, not only before they sign in.
 *
 * **The navigation has two rows** since admin plan 0022: the sections, and the
 * screens inside whichever section the operator is in. This component draws both
 * and works out neither. Which section is current is a question about the URL,
 * and `AdminShellPage` answers it, exactly as it already answers which resources
 * exist.
 *
 * Navigation collapses on a phone, from an input rather than a media query, for
 * the same reason the list's layout does: a switch a spec cannot set is a switch
 * nothing asserts.
 */
@Component({
  selector: 'lib-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    RokuTranslatorPipe,
    EnvironmentBadge,
  ],
  template: `
    <header>
      <div class="bar">
        @if (compact()) {
          <button
            (click)="toggle()"
            [attr.aria-expanded]="open()"
            aria-controls="shell-nav"
            class="toggle"
            type="button"
          >
            {{ 'shell.menu' | rokuT }}
          </button>
        }

        <p class="app">{{ 'app.name' | rokuT }}</p>

        <lib-environment-badge [deployment]="deployment()" />

        <div class="identity">
          <span class="who">{{ operator() }}</span>
          <button (click)="signOut.emit()" type="button">
            {{ 'shell.signOut' | rokuT }}
          </button>
        </div>
      </div>

      @if (!compact() || open()) {
        <nav [attr.aria-label]="'shell.navigation' | rokuT" id="shell-nav">
          <ul [class.stack]="compact()" class="sections">
            @for (section of sections(); track section.path) {
              <li>
                <a
                  (click)="close()"
                  [routerLink]="section.path"
                  [routerLinkActiveOptions]="{ exact: section.exact === true }"
                  routerLinkActive="current"
                >
                  {{ section.label | rokuT }}
                  @if (section.badge?.(); as waiting) {
                    <span
                      [attr.aria-label]="
                        'shell.waiting' | rokuT: { count: waiting }
                      "
                      class="badge"
                      >{{ waiting }}</span
                    >
                  }
                </a>

                <!-- On a phone the second row is the current section's screens,
                     indented under it, and only the current one opens: a menu
                     that lists twenty three links has not solved anything
                     (admin plan 0022, section 4.1). -->
                @if (
                  compact() &&
                  section.path === current() &&
                  screens().length > 0
                ) {
                  <ul class="inside">
                    @for (screen of screens(); track screen.path) {
                      <li>
                        <a
                          (click)="close()"
                          [routerLink]="screen.path"
                          routerLinkActive="current"
                        >
                          {{ screen.label | rokuT }}
                          @if (screen.badge?.(); as waiting) {
                            <span
                              [attr.aria-label]="
                                'shell.waiting' | rokuT: { count: waiting }
                              "
                              class="badge"
                              >{{ waiting }}</span
                            >
                          }
                        </a>
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        </nav>
      }

      <!-- The second row on a wide screen. The box is always there and keeps its
           height whether or not it holds anything, because a row that appears on
           every third navigation and pushes the page down by forty pixels makes
           a two level navigation feel worse than the flat one it replaced. -->
      @if (!compact()) {
        <div class="second">
          @if (screens().length > 0) {
            <nav [attr.aria-label]="'shell.screens' | rokuT">
              <ul class="screens">
                @for (screen of screens(); track screen.path) {
                  <li>
                    <a [routerLink]="screen.path" routerLinkActive="current">
                      {{ screen.label | rokuT }}
                      @if (screen.badge?.(); as waiting) {
                        <span
                          [attr.aria-label]="
                            'shell.waiting' | rokuT: { count: waiting }
                          "
                          class="badge"
                          >{{ waiting }}</span
                        >
                      }
                    </a>
                  </li>
                }
              </ul>
            </nav>
          }
        </div>
      }
    </header>

    <main>
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    header {
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
      align-items: center;
      padding: var(--admin-space-3) var(--admin-space-4);
    }

    .app {
      font-weight: 700;
    }

    .identity {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      margin-inline-start: auto;
    }

    .who {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    nav ul {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1);
      padding: 0 var(--admin-space-4) var(--admin-space-3);
      list-style: none;
    }

    /* On a phone the sections are a list, one per line. Wrapped into rows they
       read as a broken row rather than as a level, because the open section's
       screens sit between one row and the next. */
    nav ul.sections.stack {
      flex-direction: column;
      align-items: flex-start;
    }

    /* The current section's screens on a phone, one under the other and
       indented, so the menu reads as two levels rather than as one long list. */
    nav ul.inside {
      flex-direction: column;
      padding: var(--admin-space-1) 0 var(--admin-space-2) var(--admin-space-4);
    }

    nav ul.inside a {
      font-weight: 400;
    }

    /* The second row's box, which is here whether or not there is a row to put
       in it. A row that appears on some navigations and not others would move
       the page under the operator by its own height every time. */
    .second {
      min-block-size: calc(2.75rem + var(--admin-space-3));
    }

    .second a {
      font-size: 0.9375rem;
      font-weight: 500;
    }

    nav a {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border-radius: var(--admin-radius);
      font-weight: 600;
      text-decoration: none;
      color: var(--admin-ink-muted);
    }

    nav .badge {
      padding: 0 var(--admin-space-2);
      border-radius: 999px;
      background: var(--admin-accent);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      color: var(--admin-accent-ink);
    }

    nav a.current {
      background: var(--admin-accent-wash);
      color: var(--admin-accent);
    }

    main {
      display: flex;
      flex: 1;
      flex-direction: column;
      inline-size: 100%;
      max-inline-size: 72rem;
      margin-inline: auto;
      padding: var(--admin-space-6) var(--admin-space-4);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    a:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  /**
   * The first row: the sections, in the order they are drawn.
   *
   * Every entry is matched by prefix unless it asks for `exact`, which is what
   * keeps a section marked while the operator is on a screen inside it and what
   * stops the overview being marked everywhere.
   */
  readonly sections = input.required<readonly ShellLink[]>();
  /**
   * The second row: the screens inside the section the operator is in.
   *
   * Empty for a section that has only its own home, which is the overview and
   * the admins section. The box the row sits in is drawn either way.
   */
  readonly screens = input<readonly ShellLink[]>([]);
  /**
   * Which section those screens belong to, as its path.
   *
   * Only the collapsed menu needs it, where the screens are indented under
   * their own section rather than drawn in a row of their own. `routerLinkActive`
   * answers the same question for the highlight, and cannot answer this one: it
   * settles in a content hook, so a structural block reading it renders a pass
   * behind the highlight beside it.
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

  readonly signOut = output<void>();

  /** Whether the collapsed navigation is showing. Ignored on a wide screen. */
  readonly open = signal(false);

  toggle(): void {
    this.open.update((open) => !open);
  }

  /**
   * Following a link closes the menu.
   *
   * On a phone the navigation covers the page it navigated to, so leaving it
   * open would hide the thing the operator just asked for.
   */
  close(): void {
    this.open.set(false);
  }
}
