import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { RunWatches } from '@portfolio/luna-shopper-admin/data-access';
import { failureBlockReason } from '@portfolio/luna-shopper-admin/models';
import {
  HarvestNotice,
  RunProgressView,
} from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HarvestShell } from './harvest-shell';

/**
 * One run, watched (plan 0006, section 2).
 *
 * Everything about how often it reads and when it stops is in `RunWatch`, which
 * is a plain class with a spec. What is here is the screen: the progress, the
 * abort, and the sentences that say what state the watching itself is in.
 *
 * Two of those sentences exist because a run is long. **Paused** is not
 * finished: a hidden tab stops polling, and an operator who came back to numbers
 * from ten minutes ago has to be told that is what they are looking at.
 * **Aborting** is not aborted: the request lands, the run flushes what it has,
 * and only then finalizes, so there is a window where nothing appears to happen
 * and the screen has to account for it.
 *
 * The watch is stopped on destroy, from the **component's** `DestroyRef` and not
 * from a route provider. A route's injector is never destroyed in this router,
 * so a service scoped to the route would leave its timer running after the
 * screen was gone.
 */
@Component({
  selector: 'lib-run-page',
  imports: [RouterLink, RokuTranslatorPipe, HarvestNotice, RunProgressView],
  template: `
    <p class="back">
      <a routerLink="..">{{ 'harvest.run.back' | rokuT }}</a>
    </p>

    @if (watch.loading()) {
      <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (watch.failed()) {
      <lib-harvest-notice (retry)="watch.refresh()" [absent]="shell.absent()" />
    } @else if (watch.run(); as run) {
      <header>
        <h1>{{ 'harvest.mode.' + run.mode | rokuT }}</h1>
        <p [class]="run.status" class="status">
          {{ 'harvest.status.' + run.status | rokuT }}
        </p>
      </header>

      <lib-run-progress [progress]="watch.progress()!" [run]="run" />

      @if (watch.paused()) {
        <p class="note">{{ 'harvest.run.paused' | rokuT }}</p>
      }

      @if (run.abortRequestedAt !== null && !watch.finished()) {
        <p class="note">{{ 'harvest.run.aborting' | rokuT }}</p>
      }

      @if (blockedKey(); as key) {
        <p class="failure" role="alert">{{ key | rokuT }}</p>
      } @else if (run.error; as message) {
        <p class="failure" role="alert">{{ message }}</p>
      }

      @if (watch.error() !== null) {
        <p class="note" role="alert">{{ 'harvest.run.pollFailed' | rokuT }}</p>
      }

      <dl class="facts">
        @for (fact of facts(); track fact.key) {
          @if (fact.value !== '') {
            <div>
              <dt>{{ 'harvest.run.fact.' + fact.key | rokuT }}</dt>
              <dd>{{ fact.value }}</dd>
            </div>
          }
        }
      </dl>

      @if (watch.canAbort()) {
        <button (click)="watch.abort()" class="danger" type="button">
          {{ 'harvest.run.abort' | rokuT }}
        </button>
      } @else if (watch.aborting()) {
        <button disabled type="button">
          {{ 'resource.action.working' | rokuT }}
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    lib-run-progress {
      inline-size: 100%;
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

    .state,
    .note {
      color: var(--admin-ink-muted);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .danger {
      min-block-size: 2.75rem;
      border-color: var(--admin-danger);
      color: var(--admin-danger-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPage {
  private readonly _route = inject(ActivatedRoute);

  readonly shell = inject(HarvestShell);

  readonly watch = inject(RunWatches).for(
    this._route.snapshot.paramMap.get('id') ?? ''
  );

  /** A finished run whose failure names one of the three switches. */
  readonly blockedKey = computed(() => {
    const run = this.watch.run();
    if (run === null) {
      return null;
    }

    const reason = failureBlockReason(run);
    return reason === null ? null : `harvest.blocked.${reason}`;
  });

  readonly facts = computed(() => {
    const run = this.watch.run();
    if (run === null) {
      return [];
    }

    return [
      { key: 'requested', value: formatInstant(run.requestedAt) },
      { key: 'started', value: formatInstant(run.startedAt) },
      { key: 'finished', value: formatInstant(run.finishedAt) },
      { key: 'heartbeat', value: formatInstant(run.heartbeatAt) },
      { key: 'correlationId', value: run.correlationId ?? '' },
    ];
  });

  constructor() {
    this.watch.start();

    // On the component, never on a route provider. A route's injector is not
    // destroyed when the screen leaves, so teardown declared there never runs
    // and the poll would carry on against a screen nobody is looking at.
    inject(DestroyRef).onDestroy(() => this.watch.stop());
  }
}
