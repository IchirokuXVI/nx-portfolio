import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * Why this screen has nothing on it (plan 0006, section 4).
 *
 * The harvester is switched off in production and in staging on purpose, and
 * nothing renders in either cluster: no Deployment, no Service, no database.
 * Every read here therefore fails in exactly the two environments most people
 * will ever open this app in.
 *
 * **An empty list would be a lie, and a permanent one.** "There have been no
 * runs" and "there is no harvester to have had runs" look identical when both
 * are drawn as nothing, and the first reads as a bug forever. So a failed read
 * on these screens draws this instead, and it says which of the two it is when
 * it can tell.
 *
 * `absent` is the case the chart already settles: production and staging do not
 * run this service, so a failure there is expected rather than broken and there
 * is nothing to retry. Everywhere else a failure is a failure, and the retry
 * button is offered.
 */
@Component({
  selector: 'lib-harvest-notice',
  imports: [RokuTranslatorPipe],
  template: `
    <div [class.absent]="absent()" class="notice">
      <h2>
        {{
          (absent() ? 'harvest.absent.heading' : 'harvest.down.heading') | rokuT
        }}
      </h2>
      <p>
        {{ (absent() ? 'harvest.absent.body' : 'harvest.down.body') | rokuT }}
      </p>

      @if (!absent()) {
        <button (click)="retry.emit()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      }
    </div>
  `,
  styles: `
    .notice {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    /* Expected, so it is drawn as information rather than as an alarm. */
    .notice.absent {
      border-style: dashed;
      border-color: var(--admin-border);
      background: var(--admin-surface-raised);
      color: var(--admin-ink-muted);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HarvestNotice {
  /** Whether this deployment is one the chart never renders the harvester in. */
  readonly absent = input.required<boolean>();

  readonly retry = output<void>();
}
