import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { HarvestSwitch } from '@portfolio/luna-shopper-admin/models';

/**
 * The three switches, shown and not editable (plan 0006, section 3).
 *
 * They are three because they are three different decisions, and this panel
 * exists so that "why did my run do nothing" is answerable from the screen. Two
 * of them are deployment configuration rather than application state, and a back
 * office button that edited a cluster's config map is a different and much
 * larger feature, so nothing here is a control.
 *
 * The per chain `enabled` flag is the one switch this app does change, and it is
 * deliberately **not** here: it lives on the sources screen beside the chain it
 * belongs to, because putting it in this panel would suggest it is the same kind
 * of thing as the other three.
 *
 * A switch may be `unknown`, and that state is drawn rather than rounded to
 * `off`. Nothing reports `HARVEST_ENABLED` or `MERCADONA_ENABLED`, so before
 * anything has been attempted this app genuinely does not know; both default to
 * false, so a guess would be right most of the time and wrong exactly when
 * somebody is trying to work out what is going on.
 */
@Component({
  selector: 'lib-switch-panel',
  imports: [RokuTranslatorPipe],
  template: `
    <section>
      <h2>{{ 'harvest.switch.heading' | rokuT }}</h2>
      <p class="lead">{{ 'harvest.switch.lead' | rokuT }}</p>

      <ul>
        @for (item of switches(); track item.name) {
          <li>
            <span [class]="item.state" class="state">
              {{ 'harvest.switch.state.' + item.state | rokuT }}
            </span>
            <span class="body">
              <strong>{{ 'harvest.switch.name.' + item.name | rokuT }}</strong>
              <span class="what">
                {{ 'harvest.switch.what.' + item.name | rokuT }}
              </span>
              <span class="source">{{ item.source | rokuT }}</span>
            </span>
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .lead {
      color: var(--admin-ink-muted);
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      list-style: none;
    }

    li {
      display: flex;
      gap: var(--admin-space-3);
      align-items: flex-start;
    }

    .state {
      flex: none;
      min-inline-size: 5.5rem;
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-align: center;
      text-transform: uppercase;
    }

    .state.on {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-ink);
    }

    .state.off {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-ink);
    }

    .state.unknown {
      border: 1px dashed var(--admin-border);
      color: var(--admin-ink-muted);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .what,
    .source {
      color: var(--admin-ink-muted);
    }

    .source {
      font-size: 0.8125rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwitchPanel {
  readonly switches = input.required<readonly HarvestSwitch[]>();
}
