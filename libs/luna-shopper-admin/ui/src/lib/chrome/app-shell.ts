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

/** One entry in the navigation. */
export interface ShellLink {
  /** The route to go to, relative to the app root. */
  readonly path: string;
  /** A translation key. */
  readonly label: string;
  /**
   * Whether this entry belongs in front of the resources rather than after
   * them (admin plan 0016).
   *
   * The bespoke screens are a section at the end of the navigation, which is
   * where a group of them belongs. The dashboard is not one of that group: it
   * is the screen the app opens to, so it sits first, above everything it
   * summarises. `AdminShellPage` is what reads this, because it is what puts the
   * two lists together.
   */
  readonly leading?: boolean;
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
          <ul>
            @for (link of links(); track link.path) {
              <li>
                <a
                  (click)="close()"
                  [routerLink]="link.path"
                  [routerLinkActiveOptions]="{ exact: link.path === '/' }"
                  routerLinkActive="current"
                >
                  {{ link.label | rokuT }}
                  @if (link.badge?.(); as waiting) {
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
   * The navigation, in the order it is drawn.
   *
   * A link to `/` is matched **exactly** and every other link is matched by
   * prefix. Prefix matching is what makes `/harvest/runs` stay highlighted on
   * `/harvest/runs/abc`, and it is also what would leave a link to `/` marked as
   * the current page on every screen in the app, since every URL starts with a
   * slash. Only that one path needs the exception, so only that one path gets
   * it.
   */
  readonly links = input.required<readonly ShellLink[]>();
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
