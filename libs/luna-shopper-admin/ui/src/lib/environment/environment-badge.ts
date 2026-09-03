import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';

/**
 * Which deployment the app is talking to, said in words and in the accent colour
 * (plan 0001, section 6).
 *
 * Presentational: it is handed a deployment and renders it. It does no reading of
 * its own, so the same component serves the login screen in `0002` and whatever
 * chrome `0004` builds, and a spec can put it in every state without a backend.
 *
 * `undefined` and `null` are drawn differently on purpose. Still asking is a quiet
 * line; could not find out is a statement, because an operator who cannot see which
 * environment they are in needs to be told that rather than shown a default.
 */
@Component({
  selector: 'lib-environment-badge',
  imports: [RokuTranslatorPipe],
  template: `
    @if (deployment() === undefined) {
      <p class="checking">{{ 'environment.checking' | rokuT }}</p>
    } @else {
      <p class="badge">
        <span class="label">{{ 'environment.label' | rokuT }}</span>
        <span class="name">{{ nameKey() | rokuT }}</span>
      </p>
      @if (deployment() === null) {
        <p class="unknown">{{ 'environment.unknownExplanation' | rokuT }}</p>
      } @else {
        <p class="source">{{ 'environment.sourcedFromApi' | rokuT }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .badge {
      display: inline-flex;
      align-items: baseline;
      gap: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
    }

    .label {
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .name {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--admin-accent);
    }

    .checking,
    .source,
    .unknown {
      margin-block-start: var(--admin-space-2);
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .unknown {
      max-inline-size: 44ch;
      color: var(--admin-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnvironmentBadge {
  /** The deployment, `null` if it could not be established, `undefined` while asking. */
  readonly deployment = input.required<Deployment | null | undefined>();

  /**
   * The key for the deployment's name.
   *
   * A key per deployment rather than one interpolated string, so the three names
   * are translatable independently and, more to the point, so a name this app does
   * not know cannot reach the screen as raw text from the API.
   */
  readonly nameKey = computed(
    () => `environment.${this.deployment() ?? 'unknown'}`
  );
}
