import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  DeploymentStore,
  SessionStore,
  SIGN_IN_PATH,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  AppShell,
  Viewport,
  type ShellLink,
} from '@portfolio/luna-shopper-admin/ui';
import { ResourceRegistry } from './resource-registry';
import { SHELL_LINKS } from './shell-links';

/**
 * The chrome, wired up (plan 0004, section 7).
 *
 * `AppShell` draws it and reads nothing; this is the half that knows where the
 * navigation, the operator's name and the environment come from. The split is
 * what lets a spec put the chrome in every state without a session or a
 * gateway.
 *
 * The navigation is **the registry**, not a list written out again. A resource
 * the app mounted is a resource the operator can reach, and a link that pointed
 * at a route nobody declared would be a 404 the app itself produced.
 */
@Component({
  selector: 'lib-admin-shell-page',
  imports: [AppShell],
  template: `
    <lib-app-shell
      (signOut)="signOut()"
      [compact]="compact()"
      [deployment]="deployment()"
      [links]="links()"
      [operator]="operator()"
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
  private readonly _registry = inject(ResourceRegistry);
  private readonly _extraLinks = inject(SHELL_LINKS);
  private readonly _sessions = inject(SessionStore);
  private readonly _deployments = inject(DeploymentStore);
  private readonly _viewport = inject(Viewport);
  private readonly _router = inject(Router);

  readonly deployment = this._deployments.deployment;
  readonly compact = this._viewport.compact;

  /**
   * The navigation: every resource, then every screen that is not one.
   *
   * Resources come from the registry rather than from a list written out again,
   * so a resource the app mounted is one the operator can reach and a link
   * cannot point at a route nobody declared. The rest come from
   * {@link SHELL_LINKS}, which is how a hand written screen says it exists;
   * plan 0006's harvester screens are the first, because a run and a review
   * queue are not resources with a form.
   *
   * Resources in the middle, in the order the app named them. The bespoke
   * screens are the ones with a reason to be grouped at the end: they are a
   * section rather than more of the same list.
   *
   * A named screen may say it belongs in front of them instead, with
   * `leading` (admin plan 0016). The dashboard is what that is for, and it is
   * one entry rather than a second token: it is not a section, it is the screen
   * the app opens to, and it sits above everything it summarises. Both groups
   * keep the order they were named in, so an app naming two leading screens
   * gets them in that order.
   */
  readonly links = computed<readonly ShellLink[]>(() => [
    ...this._extraLinks.filter((link) => link.leading === true),
    ...this._registry.all().map((descriptor) => ({
      path: `/${descriptor.segment}`,
      label: descriptor.labels.many,
    })),
    ...this._extraLinks.filter((link) => link.leading !== true),
  ]);

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

  signOut(): void {
    this._sessions.signOut();
    void this._router.navigateByUrl(`/${SIGN_IN_PATH}`);
  }
}
