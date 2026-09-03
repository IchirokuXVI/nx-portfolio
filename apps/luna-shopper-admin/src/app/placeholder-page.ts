import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';
import { EnvironmentBadge } from '@portfolio/luna-shopper-admin/ui';

/**
 * The only page this plan renders: which environment answered, and nothing else.
 *
 * It lives in the app rather than in a `feature-*` library because it is scaffolding
 * with a known end. `0002` puts the login screen in front of it and `0004` replaces
 * it with the real chrome and the first list, and both of those belong in libraries.
 * Creating a routed library to hold two paragraphs that are going to be deleted
 * would leave an empty shell behind when they are.
 */
@Component({
  selector: 'app-placeholder-page',
  imports: [EnvironmentBadge, RokuTranslatorPipe],
  template: `
    <main>
      <h1>{{ 'placeholder.heading' | rokuT }}</h1>
      <lib-environment-badge [deployment]="deployment()" />
      <p class="body">{{ 'placeholder.body' | rokuT }}</p>
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

  readonly deployment = this._deployments.deployment;
}
