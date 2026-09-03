import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { EnvironmentBadge } from '@portfolio/luna-shopper-admin/ui';

/**
 * The landing page: who is signed in, which environment answered, and nothing
 * else.
 *
 * It lives in the app rather than in a `feature-*` library because it is
 * scaffolding with a known end. `0004` replaces it with the real chrome and the
 * first list, which belongs in a library; creating a routed library to hold two
 * paragraphs that are going to be deleted would leave an empty shell behind when
 * they are.
 *
 * The name comes from the session first and `GET /v1/admin/auth/me` second (plan
 * 0002, section 6). The session's username is there the instant the login
 * answers; the identity arrives a round trip later and is the one that stays
 * true when a display name is changed on another device. Preferring the second
 * when it exists means the page never waits, and never shows a stale name once
 * it does not have to.
 */
@Component({
  selector: 'app-placeholder-page',
  imports: [EnvironmentBadge, RokuTranslatorPipe],
  template: `
    <main>
      <h1>{{ 'placeholder.heading' | rokuT }}</h1>
      <lib-environment-badge [deployment]="deployment()" />
      <p class="body">{{ 'placeholder.body' | rokuT: { name: name() } }}</p>
    </main>
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
    }

    main {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-6);
      align-items: flex-start;
      max-inline-size: 40rem;
      margin-inline: auto;
      padding: var(--admin-space-8) var(--admin-space-4);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .body {
      max-inline-size: 44ch;
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  private readonly _deployments = inject(DeploymentStore);
  private readonly _sessions = inject(SessionStore);

  readonly deployment = this._deployments.deployment;

  /**
   * What to call the operator.
   *
   * The display name when there is one, the username otherwise, and the
   * identity's copy of either in preference to the session's. Never empty: this
   * route cannot be reached without a session, so the final fallback is
   * unreachable rather than a default worth thinking about.
   */
  readonly name = computed(() => {
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
}
