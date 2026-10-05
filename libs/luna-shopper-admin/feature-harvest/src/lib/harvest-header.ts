import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  harvestRunPath,
  runProgress,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import { PageHeader, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { HarvestStatus } from './harvest-status';

/**
 * The header of every Harvest tab (admin plan 0044, targets 1 and 3).
 *
 * The title is the section, because the three tabs under it are the section's
 * and say which part of it is open. The frame gives the tabs, with the count
 * of what waits on Review.
 *
 * **A run in progress shows here, on every tab.** In the header on a wide
 * screen, and as one line under the tabs on a phone: the state, the chain and
 * the kind of run, a bar, and "N of M". It is a link to the run. Nothing is
 * drawn when no run is in progress, so the header says nothing about runs on
 * a quiet day.
 *
 * While a tab is open the dashboard is read at the cadence of a run, so the
 * bar moves. Leaving the section gives the slower cadence back.
 */
@Component({
  selector: 'lib-harvest-header',
  imports: [PageHeader, RouterLink, RokuTranslatorPipe],
  template: `
    <lib-page-header
      [heading]="'shell.sections.harvest' | rokuT"
      [info]="info()"
    >
      <ng-content ngProjectAs="[pageChip]" select="[pageChip]" />
      @if (wide(); as run) {
        <a
          [attr.aria-label]="
            'harvest.running.open'
              | rokuT: { what: what(), processed: run.processed }
          "
          [routerLink]="run.link"
          class="run"
          pageChip
          data-running="header"
        >
          <span class="chip">{{ 'harvest.status.' + run.status | rokuT }}</span>
          <span class="what">{{ what() }}</span>
          @if (run.percent !== null) {
            <span class="bar"><b [style.inline-size.%]="run.percent"></b></span>
          }
          <span class="count">{{
            (run.total === null
              ? 'harvest.run.progress.processed'
              : 'harvest.run.progress.of'
            ) | rokuT: { processed: run.processed, total: run.total }
          }}</span>
        </a>
      }
      <ng-content ngProjectAs="[pageAction]" select="[pageAction]" />
      <ng-content ngProjectAs="[pageMoreAction]" select="[pageMoreAction]" />
    </lib-page-header>

    @if (narrow(); as run) {
      <a
        [attr.aria-label]="
          'harvest.running.open'
            | rokuT: { what: what(), processed: run.processed }
        "
        [routerLink]="run.link"
        class="run line"
        data-running="line"
      >
        <span class="chip">{{ 'harvest.status.' + run.status | rokuT }}</span>
        <span class="what">{{ what() }}</span>
        @if (run.percent !== null) {
          <span class="bar"><b [style.inline-size.%]="run.percent"></b></span>
        }
        <span class="count">{{
          (run.total === null
            ? 'harvest.run.progress.processed'
            : 'harvest.run.progress.of'
          ) | rokuT: { processed: run.processed, total: run.total }
        }}</span>
      </a>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .run {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-inline-size: 0;
      font-size: 0.8125rem;
      text-decoration: none;
      color: var(--admin-ink);
    }

    .run:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .chip {
      flex: none;
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-accent-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-accent-on-wash);
    }

    .what {
      overflow: hidden;
      min-inline-size: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar {
      flex: none;
      overflow: hidden;
      inline-size: 8.75rem;
      block-size: 0.375rem;
      border-radius: 0.1875rem;
      background: var(--admin-border);
    }

    .bar b {
      display: block;
      block-size: 100%;
      background: var(--admin-accent);
    }

    .count {
      flex: none;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    /* One line under the tabs on a phone, edge to edge like the tabs. */
    .line {
      margin-inline: calc(-1 * var(--admin-page-inline));
      padding: var(--admin-space-2) var(--admin-page-inline);
      border-block-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .line .what {
      flex: 1;
    }

    .line .bar {
      inline-size: 4rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HarvestHeader {
  private readonly _status = inject(HarvestStatus);
  private readonly _chains = inject(ChainNames);
  private readonly _viewport = inject(Viewport);
  private readonly _translate = inject(RokuTranslatorService);

  /** What the info button says. No button is drawn without it. */
  readonly info = input<InfoContent | null>(null);

  /** The run in progress, in the words the line draws, or `null`. */
  private readonly _run = computed(() => {
    const run = this._status.running();
    if (run === null) {
      return null;
    }

    const progress = runProgress(run);

    return {
      status: run.status,
      mode: run.mode,
      supermarketId: run.supermarketId ?? '',
      processed: progress.processed,
      total: progress.total,
      percent: progress.percent ?? null,
      link: harvestRunPath(run.id),
    };
  });

  /** In the header on a wide screen. */
  readonly wide = computed(() =>
    this._viewport.compact() ? null : this._run()
  );

  /** Under the tabs on a phone. */
  readonly narrow = computed(() =>
    this._viewport.compact() ? this._run() : null
  );

  /** The chain, where the run has one, and the kind of run. */
  readonly what = computed(() => {
    const run = this._run();
    if (run === null) {
      return '';
    }

    return [
      run.supermarketId === '' ? '' : this._chains.nameOf(run.supermarketId),
      this._translate.t(`harvest.mode.${run.mode}`),
    ]
      .filter((part) => part !== '')
      .join(', ');
  });

  constructor() {
    this._status.followRuns(true);
    inject(DestroyRef).onDestroy(() => this._status.followRuns(false));
    // Read at once. The rail's read is a minute apart while no Harvest tab is
    // open, so without this the run line could be a minute old on entry.
    this._status.refresh();

    effect(() => {
      const chain = this._run()?.supermarketId ?? '';
      if (chain !== '') {
        untracked(() => void this._chains.resolve([chain]));
      }
    });
  }
}
