import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  RunWatches,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  exportFileName,
  failureBlockReason,
  isFileImportRun,
  PRICE_WRITING_MODES,
  queuedByRun,
  runWarningRows,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  HarvestNotice,
  RunProgressView,
} from '@portfolio/luna-shopper-admin/ui';
import { formatInstant } from './format-instant';
import { HARVEST_SEGMENT } from './harvest-paths';
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
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    ConfirmDialog,
    HarvestNotice,
    RunProgressView,
  ],
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
        <!-- Beside the status and never instead of it: a revert takes back what
             the run wrote and does not change how the run ended. -->
        @if (run.revertedAt !== null) {
          <p class="reverted">{{ 'harvest.run.reverted.chip' | rokuT }}</p>
        }
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

      <!-- The export (admin plan 0014, section 2). Offered on a finished walk
           and a finished import, and on nothing else: those are the two runs
           that hold rows worth carrying to another cluster. It is a read, so it
           is offered whether or not this deployment may start runs, which is the
           whole point of it. -->
      @if (canExport()) {
        <section class="export">
          <button (click)="exportRun()" [disabled]="exporting()" type="button">
            {{
              (exporting()
                ? 'harvest.run.export.working'
                : 'harvest.run.export.action'
              ) | rokuT
            }}
          </button>
          <p class="note">{{ 'harvest.run.export.help' | rokuT }}</p>
          @if (exportFailed()) {
            <p class="failure" role="alert">
              {{ 'harvest.run.export.failed' | rokuT }}
            </p>
          }
        </section>
      }

      <!-- The import half (admin plan 0010, section 5). Additive, and drawn
           only for a file import: a crawl's warnings list is empty, so without
           the guard every catalog run would carry an empty table. -->
      @if (fileImport()) {
        @if (queueLink(); as link) {
          <p class="queued">
            <a [queryParams]="link.params" [routerLink]="link.path">{{
              'harvest.run.queue.open' | rokuT
            }}</a>
            <span class="count">{{
              'harvest.run.queue.count' | rokuT: { count: queued() }
            }}</span>
          </p>
        }

        @if (warnings().length > 0) {
          <section class="warnings">
            <h2>{{ 'harvest.run.warnings.heading' | rokuT }}</h2>
            <p class="note">{{ 'harvest.run.warnings.lead' | rokuT }}</p>
            <ul>
              @for (warning of warnings(); track warning.key) {
                <li>
                  <span class="code">{{
                    'harvest.warning.' + warning.code | rokuT
                  }}</span>
                  @if (warning.offerId !== '') {
                    <span class="offer">{{ warning.offerId }}</span>
                  }
                  @if (warning.page !== '') {
                    <span class="page">{{ warning.page }}</span>
                  }
                  @if (warning.name !== '') {
                    <strong>{{ warning.name }}</strong>
                  }
                  <span class="message">{{ warning.message }}</span>
                </li>
              }
            </ul>
          </section>
        }
      }

      @if (run.revertedAt !== null) {
        <p class="note">{{ 'harvest.run.reverted.done' | rokuT }}</p>
      }

      <div class="controls">
        @if (watch.canAbort()) {
          <button (click)="watch.abort()" class="danger" type="button">
            {{ 'harvest.run.abort' | rokuT }}
          </button>
        } @else if (watch.aborting()) {
          <button disabled type="button">
            {{ 'resource.action.working' | rokuT }}
          </button>
        }

        @if (watch.canRevert()) {
          <button (click)="confirming.set(true)" class="danger" type="button">
            {{ 'harvest.run.revert.action' | rokuT }}
          </button>
        }
      </div>

      @if (confirming()) {
        <lib-confirm-dialog
          (confirm)="revert()"
          (dismiss)="confirming.set(false)"
          [bodyArgs]="confirmCounts()"
          [bodyKey]="confirmBodyKey()"
          [busy]="watch.reverting()"
          [confirmKey]="'harvest.run.revert.action'"
          [headingKey]="'harvest.run.revert.heading'"
        />
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

    /* The import half (admin plan 0010, section 5). */
    .queued {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: baseline;
    }

    .queued a {
      color: var(--admin-accent);
    }

    .count {
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .warnings {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      inline-size: 100%;
    }

    .warnings h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .warnings ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      list-style: none;
    }

    .warnings li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: baseline;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    .export {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: flex-start;
      inline-size: 100%;
    }

    .export button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .export button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .code {
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .offer,
    .page,
    .message {
      color: var(--admin-ink-muted);
    }

    .offer {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .reverted {
      padding: var(--admin-space-1) var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--admin-danger-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _references = inject(ResourceReferences);

  readonly shell = inject(HarvestShell);

  readonly watch = inject(RunWatches).for(
    this._route.snapshot.paramMap.get('id') ?? ''
  );

  /** A finished run whose failure names one of the switches. */
  readonly blockedKey = computed(() => {
    const run = this.watch.run();
    if (run === null) {
      return null;
    }

    const reason = failureBlockReason(run);
    return reason === null ? null : `harvest.blocked.${reason}`;
  });

  /**
   * Whether this run read a document (admin plan 0010, section 5).
   *
   * Everything below is drawn on that answer alone. The counters keep their own
   * labels either way, with `skipped` now among them, because a counter that
   * appeared and disappeared per mode would be worse than one that reads zero.
   */
  readonly fileImport = computed(() => isFileImportRun(this.watch.run()));

  /**
   * Whether this run's rows can be carried to another cluster (admin plan 0014,
   * section 2).
   *
   * A finished walk or a finished import, because those are the two that hold
   * rows. Not a store discovery, which found shops rather than products, and not
   * a run still going, whose rows are half written.
   *
   * `HARVEST_ENABLED` is not consulted, and that is the point rather than an
   * oversight: exporting is a read, and the arrangement this exists for is a
   * machine that may crawl exporting to a cluster that may not.
   */
  readonly canExport = computed(() => {
    const run = this.watch.run();
    return (
      run !== null &&
      run.status === 'COMPLETED' &&
      PRICE_WRITING_MODES.includes(run.mode)
    );
  });

  readonly exporting = signal(false);
  readonly exportFailed = signal(false);

  /** Offer id, code and message, for what the import dropped and why. */
  readonly warnings = computed(() => runWarningRows(this.watch.run()));

  /** How many products this run put in front of a person. */
  readonly queued = computed(() => queuedByRun(this.watch.run()));

  /**
   * The queue, opened on this run's chain.
   *
   * The chain rides in the query string, which is what the queue reads to open
   * itself rather than asking again. An operator arriving from a run already
   * chose that chain when they uploaded the document, and making them pick it a
   * second time between the run and its own queue is asking them to remember
   * something the URL already knows.
   *
   * `null` for a run with no chain, which a file import never is: the spawn
   * refuses one without a `supermarketId`. The guard is here because a link
   * with a hole in its query string is worse than no link.
   */
  readonly queueLink = computed(() => {
    const run = this.watch.run();
    return run === null || run.supermarketId === null
      ? null
      : {
          path: ['/', HARVEST_SEGMENT, 'entries'],
          params: { supermarketId: run.supermarketId },
        };
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
      // What the revert actually did, from the operation's own answer rather
      // than from the estimate the confirmation offered (backend plan 0082).
      { key: 'reverted', value: formatInstant(run.revertedAt) },
      {
        key: 'revertedPrices',
        value:
          run.revertedPriceCount === null ? '' : String(run.revertedPriceCount),
      },
      { key: 'revertedBy', value: run.revertedByUserId ?? '' },
      { key: 'correlationId', value: run.correlationId ?? '' },
    ];
  });

  /** Whether the confirmation is up. Nothing is deleted until it is answered. */
  readonly confirming = signal(false);

  /**
   * The numbers the confirmation names (backend plan 0082, section 6).
   *
   * They are the run's **own counters**, not a fresh count from catalog, and
   * that is deliberate: `created` is the price rows the run inserted and
   * `notFound` is the offers it queued, so the sentence costs no extra read.
   * They are an estimate, and they can be low, because an alias accepted after
   * the run wrote more rows on the run's behalf. What the operation actually
   * deleted is shown afterwards, from the reply.
   */
  readonly confirmCounts = computed(() => {
    const run = this.watch.run();
    return {
      prices: run?.created ?? 0,
      queued: run?.notFound ?? 0,
    };
  });

  /**
   * Which sentence to confirm with.
   *
   * A file import is the only mode that leaves rows waiting for a person, so
   * it is the only one whose confirmation mentions the queue. For a catalog
   * discovery `notFound` counts products the chain does not stock,
   * which has nothing to do with a queue and would read as a lie.
   */
  readonly confirmBodyKey = computed(() =>
    this.watch.run()?.mode === 'FILE_IMPORT'
      ? 'harvest.run.revert.confirmImport'
      : 'harvest.run.revert.confirm'
  );

  /**
   * The file the export is saved as (admin plan 0014, section 2).
   *
   * The chain, the scope and the day, resolved through the directory so the name
   * reads as words rather than as three uuids. The chain falls back to its id
   * when the directory cannot answer, because a file named after an id is still
   * a file somebody can find.
   *
   * The scope is not on the run, so it is read off the document the export
   * itself answers: the harvester fills the three hints in (backend plan 0086,
   * section 6.2), and the scope hint is the scope this run wrote for.
   */
  async exportName(
    document: Readonly<Record<string, unknown>>
  ): Promise<string> {
    const run = this.watch.run();
    const hints = document['hints'];
    const scopeId =
      typeof hints === 'object' && hints !== null
        ? String((hints as Record<string, unknown>)['price_scope_id'] ?? '')
        : '';

    const chain =
      run?.supermarketId == null
        ? ''
        : ((await this._references.resolve('supermarkets', run.supermarketId))
            ?.title ?? run.supermarketId);
    const scope =
      scopeId === ''
        ? ''
        : ((await this._references.resolve('price-scopes', scopeId))?.title ??
          scopeId);

    return exportFileName({
      chain,
      scope,
      day: (run?.finishedAt ?? '').slice(0, 10),
    });
  }

  /**
   * Ask for the run's rows and hand the browser a file.
   *
   * The request carries the bearer token, so it cannot be an anchor the browser
   * follows: the document is read as JSON and turned into a download here. A
   * failure is a line under the button rather than a takeover, because
   * everything else on this screen is still true.
   */
  async exportRun(): Promise<void> {
    const run = this.watch.run();
    if (run === null || this.exporting()) {
      return;
    }

    this.exporting.set(true);
    this.exportFailed.set(false);

    try {
      const document = await this._service.exportRun(run.id);
      download(await this.exportName(document), JSON.stringify(document));
    } catch {
      this.exportFailed.set(true);
    } finally {
      this.exporting.set(false);
    }
  }

  async revert(): Promise<void> {
    await this.watch.revert();
    this.confirming.set(false);
  }

  constructor() {
    this.watch.start();

    // On the component, never on a route provider. A route's injector is not
    // destroyed when the screen leaves, so teardown declared there never runs
    // and the poll would carry on against a screen nobody is looking at.
    inject(DestroyRef).onDestroy(() => this.watch.stop());
  }
}

/**
 * Hand the browser a file it did not ask a server for.
 *
 * An object URL and a synthetic click, which is the only way to save a response
 * that needed a bearer token to fetch. Guarded, because `createObjectURL` does
 * not exist in the test environment and a spec asserting on the file's name has
 * no business being the thing that fails.
 */
function download(name: string, text: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    return;
  }

  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
