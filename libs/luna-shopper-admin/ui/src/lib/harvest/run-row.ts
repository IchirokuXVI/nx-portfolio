import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  HarvestRunMode,
  HarvestRunStatus,
} from '@portfolio/luna-shopper-admin/models';

/**
 * One run, as a row is drawn.
 *
 * Formatted strings rather than the run, because the two dates on it are
 * formatted with `Intl` where a spec can call the formatter, and a `DatePipe` in
 * the template would put that decision somewhere nothing can assert on it. The
 * caller builds this; what is shared is the row.
 */
export interface RunRow {
  readonly id: string;
  readonly mode: HarvestRunMode;
  readonly status: HarvestRunStatus;
  /** When it was asked for, already formatted. */
  readonly requested: string;
  readonly processed: number;
  readonly failed: number;
  /** When its writes were taken back, already formatted. Empty when they stand. */
  readonly reverted: string;
  /** Who took them back. Shown on hover, because it is a uuid. */
  readonly revertedBy: string;
  /** A translation key saying why a finished run did nothing, or `null`. */
  readonly reasonKey: string | null;
}

/**
 * A run in a list of runs (plan 0006; admin plan 0016, section 3.3).
 *
 * Here rather than on the runs screen because two screens draw it: the runs
 * list, and the dashboard's last five runs. A copy of it would be a copy of the
 * status chip's colours, of the revert chip and of the decision to put the
 * operator's uuid on hover, and the two would drift the first time one of them
 * gained a counter.
 *
 * The link is an input rather than built here. The runs list addresses a run
 * relative to itself and the dashboard addresses it absolutely, and a component
 * that guessed which would be guessing about where it had been rendered.
 */
@Component({
  selector: 'lib-run-row',
  imports: [RouterLink, RokuTranslatorPipe],
  template: `
    <a [routerLink]="link()">
      <span class="mode">{{ 'harvest.mode.' + row().mode | rokuT }}</span>
      <span [class]="row().status" class="status">
        {{ 'harvest.status.' + row().status | rokuT }}
      </span>
      <!-- A second chip rather than a replacement: the status says how the run
           ended and a revert does not change that. -->
      @if (row().reverted !== '') {
        <span [title]="row().revertedBy" class="reverted">
          {{ 'harvest.runs.row.reverted' | rokuT: { when: row().reverted } }}
        </span>
      }
      <span class="when">{{ row().requested }}</span>
      <span class="counts">
        {{
          'harvest.runs.row.counts'
            | rokuT: { processed: row().processed, failed: row().failed }
        }}
      </span>
      @if (row().reasonKey; as key) {
        <span class="reason">{{ key | rokuT }}</span>
      }
    </a>
  `,
  styles: `
    :host {
      display: block;
    }

    a {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      text-decoration: none;
      color: inherit;
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .mode {
      font-weight: 700;
    }

    .status {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      text-transform: uppercase;
    }

    .status.RUNNING,
    .status.PENDING {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-ink);
    }

    .status.FAILED,
    .status.STALE {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-ink);
    }

    .reverted {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      font-size: 0.75rem;
      color: var(--admin-danger-ink);
    }

    .when,
    .counts,
    .reason {
      color: var(--admin-ink-muted);
    }

    .reason {
      flex-basis: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunRowView {
  readonly row = input.required<RunRow>();
  /** Where this run's own screen is, as a `routerLink` array or a path. */
  readonly link = input.required<readonly unknown[] | string>();
}
