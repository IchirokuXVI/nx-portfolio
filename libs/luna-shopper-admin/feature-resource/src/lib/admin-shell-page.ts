import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  ContentLocaleStore,
  DeploymentStore,
  SessionStore,
  SIGN_IN_PATH,
} from '@portfolio/luna-shopper-admin/data-access';
import { CONTENT_LOCALES } from '@portfolio/luna-shopper-admin/models';
import {
  AppShell,
  Viewport,
  type ShellLink,
} from '@portfolio/luna-shopper-admin/ui';
import {
  ADMIN_SECTIONS,
  sectionLink,
  sectionScreens,
  type AdminSection,
} from './admin-section';

/**
 * The chrome, wired up (plan 0004, section 7; admin plan 0022, section 4).
 *
 * `AppShell` draws it and reads nothing; this is the half that knows where the
 * navigation, the operator's name and the environment come from. The split is
 * what lets a spec put the chrome in every state without a session or a
 * gateway.
 *
 * The navigation is **the sections**, not a list written out again. A resource a
 * section mounted is a resource the operator can reach, and a link that pointed
 * at a route nobody declared would be a 404 the app itself produced. The second
 * row is the current section's screens, and working out which section that is,
 * from the URL, is the one thing this component gained.
 */
@Component({
  selector: 'lib-admin-shell-page',
  imports: [AppShell],
  template: `
    <lib-app-shell
      (chooseContentLocale)="chooseContentLocale($event)"
      (signOut)="signOut()"
      [compact]="compact()"
      [contentLocale]="contentLocale()"
      [contentLocales]="contentLocales"
      [current]="current()"
      [deployment]="deployment()"
      [operator]="operator()"
      [screens]="screens()"
      [sections]="sections()"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShellPage {
  private readonly _sections = inject(ADMIN_SECTIONS);
  private readonly _sessions = inject(SessionStore);
  private readonly _deployments = inject(DeploymentStore);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _viewport = inject(Viewport);
  private readonly _router = inject(Router);

  readonly deployment = this._deployments.deployment;
  readonly compact = this._viewport.compact;

  /**
   * The URL, as a signal.
   *
   * Written by hand from the router's events rather than through
   * `rxjs-interop`, which this workspace forbids anywhere a remote could load a
   * second copy of it. The subscription is torn down with the component, which
   * in this app means never: the shell is the route every screen sits inside.
   */
  private readonly _url = signal(this._router.url);

  constructor() {
    const events = this._router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this._url.set(event.urlAfterRedirects);
      }
    });

    inject(DestroyRef).onDestroy(() => events.unsubscribe());
  }

  /**
   * The first row: one tab per section, pointing at its home.
   *
   * A section mounted at the root **with a home of its own** is matched
   * exactly. That is the overview, and prefix matching would leave it marked on
   * every screen in the app, since every URL starts with a slash. The admins
   * section is also at the root and is not exact, because its tab points at its
   * only screen and has to stay marked on a row inside it.
   */
  readonly sections = computed<readonly ShellLink[]>(() =>
    this._sections.flatMap((section) => {
      const path = sectionLink(section);

      return path === null
        ? []
        : [
            {
              path,
              label: section.label,
              exact:
                section.segment === undefined && section.home !== undefined,
              badge: () => sectionBadge(section),
            },
          ];
    })
  );

  /**
   * The second row: the screens inside whichever section the URL is in.
   *
   * **The longest matching tab, not the first.** `/harvest` and `/harvest/runs`
   * are both prefixes of `/harvest/runs/abc`, and only one of them is a section.
   *
   * A URL matching no section is the not found page, and it draws an empty
   * second row: the operator is somewhere the app does not know about, and
   * guessing a section for them is worse than admitting it.
   *
   * **A section whose tab already is its only screen draws no row either.** That
   * is the admins section, and a second row repeating the word above it says
   * nothing an operator did not just read.
   */
  readonly screens = computed<readonly ShellLink[]>(() => {
    const section = this._activeSection();
    if (section === null) {
      return [];
    }

    const screens = sectionScreens(section);

    return section.home === undefined && screens.length === 1 ? [] : screens;
  });

  /**
   * Which section those screens belong to, as the path of its tab.
   *
   * The collapsed menu indents the screens under their own section, and needs
   * to be told which one that is: `routerLinkActive` answers the same question
   * for the highlight and settles a change detection pass later, which is fine
   * for a class and wrong for a structural block.
   */
  readonly current = computed<string | null>(() => {
    const section = this._activeSection();

    return section === null ? null : sectionLink(section);
  });

  private readonly _activeSection = computed<AdminSection | null>(() => {
    const url = this._url();
    let best: AdminSection | null = null;
    let length = -1;

    for (const section of this._sections) {
      const path = sectionLink(section);
      if (path === null || !inside(url, path)) {
        continue;
      }

      if (path.length > length) {
        best = section;
        length = path.length;
      }
    }

    return best;
  });

  /**
   * What to call the operator.
   *
   * The identity's copy in preference to the session's, and a display name in
   * preference to a username. The session's username is there the instant the
   * login answers; the identity arrives a round trip later and is the one that
   * stays true when a display name is changed elsewhere. Preferring the second
   * when it exists means the chrome never waits, and never shows a stale name
   * once it does not have to.
   */
  readonly operator = computed(() => {
    const identity = this._sessions.identity();
    const session = this._sessions.session();

    return (
      identity?.displayName ??
      identity?.username ??
      session?.displayName ??
      session?.username ??
      ''
    );
  });

  /**
   * The language the catalog is read in, and the languages it is written in
   * (admin plan 0026, section 7).
   *
   * The options are the content locales and never `APP_AVAILABLE_LOCALES`,
   * which is the interface's list and is one entry long. The chrome draws the
   * control and decides nothing, exactly as it draws the navigation and works
   * out none of it.
   */
  readonly contentLocale = this._content.locale;
  readonly contentLocales = CONTENT_LOCALES;

  chooseContentLocale(locale: string): void {
    this._content.choose(locale);
  }

  signOut(): void {
    this._sessions.signOut();
    void this._router.navigateByUrl(`/${SIGN_IN_PATH}`);
  }
}

/**
 * Whether a URL is under a tab's path.
 *
 * A segment boundary, not a string prefix: `/prices` must not count as being
 * inside a section at `/price`. The root is inside nothing but itself, which is
 * the same exception the `exact` flag makes on the tab.
 */
function inside(url: string, path: string): boolean {
  const here = url.split('?')[0].split('#')[0];

  if (path === '/') {
    return here === '/' || here === '';
  }

  return here === path || here.startsWith(`${path}/`);
}

/**
 * A section's badge: the sum of its screens' (admin plan 0022, section 4.2).
 *
 * `null` only when every screen it holds answers `null`, and a screen answering
 * `0` contributes `0`, which is `0010`'s distinction between a queue that has
 * been read and found empty and one that has no count at all. Both draw nothing,
 * so the sum draws nothing either way and the difference survives for whatever
 * asks next.
 *
 * It exists because work waiting behind a link an operator can no longer see is
 * the one way two rows make this app worse than one.
 */
function sectionBadge(section: AdminSection): number | null {
  const counts = sectionScreens(section)
    .map((screen) => screen.badge?.() ?? null)
    .filter((count): count is number => count !== null);

  return counts.length === 0
    ? null
    : counts.reduce((sum, count) => sum + count, 0);
}
