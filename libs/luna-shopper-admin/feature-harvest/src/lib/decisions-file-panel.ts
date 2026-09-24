import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  type BulkOperationErrorCode,
  type EntryDecisionOutcome,
  type EntryDecisionsAnswer,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import {
  DECISIONS_MAX_OPERATIONS,
  isDecisionsFile,
  parseDecisionsFile,
  type DecisionsFile,
  type DecisionsFileProblem,
  type DecisionsFileRow,
} from './decisions-file';

/** A row of the file beside what the route said about it. */
interface RefusedLine {
  readonly row: DecisionsFileRow;
  readonly outcome: EntryDecisionOutcome;
}

/**
 * "Apply a decisions file", on the entries queue (admin plan 0035, section 3).
 *
 * A curation run decides the queue offline and writes `decisions.jsonl`; the
 * CLI applies it with `--apply`. This is the same apply from the back office:
 * the file is read in the browser, every operation it holds is drawn in a
 * table, and one press sends it, whole, to the route the CLI uses. The app does
 * not change a decision, and a `REVIEW` line sends nothing, exactly as the CLI
 * does.
 *
 * **Picking a file sends nothing.** The table is the review, and the apply
 * button under it is the only thing that writes.
 *
 * The answer is all or nothing. Applied, it says how many operations went
 * through and how many prices were written. Refused, it says at which step the
 * route stopped and lists the operation that stopped it with the server's own
 * reason, which is the one thing an operator holding a refused file needs.
 */
@Component({
  selector: 'lib-decisions-file-panel',
  imports: [RokuTranslatorPipe],
  template: `
    <section
      [attr.aria-label]="'harvest.entries.decisionsFile.heading' | rokuT"
      class="panel"
      data-decisions-panel
    >
      <div class="head">
        <h2>{{ 'harvest.entries.decisionsFile.heading' | rokuT }}</h2>
        <button (click)="closed.emit()" type="button" data-decisions-close>
          {{ 'harvest.entries.decisionsFile.close' | rokuT }}
        </button>
      </div>
      <p class="muted">{{ 'harvest.entries.decisionsFile.lead' | rokuT }}</p>

      @if (answer(); as done) {
        @if (done.applied) {
          <p class="applied" role="status" data-decisions-applied>
            {{
              'harvest.entries.decisionsFile.applied'
                | rokuT: { count: done.results.length, prices: pricesWritten() }
            }}
          </p>
          @if (done.priceSkips.length > 0) {
            <h3>{{ 'harvest.entries.decisionsFile.priceSkips' | rokuT }}</h3>
            <ul class="plain">
              @for (skip of done.priceSkips; track $index) {
                <li>
                  <code>{{ skip.entryId }}</code> {{ skip.reason }}
                </li>
              }
            </ul>
          }
        } @else {
          <div class="refused" role="alert" data-decisions-refused>
            <p>
              {{
                'harvest.entries.decisionsFile.refused'
                  | rokuT
                    : {
                        step:
                          ('harvest.entries.decisionsFile.step.' +
                            (done.failedStep ?? 'UNKNOWN') | rokuT),
                      }
              }}
            </p>
            @if (done.error; as sentence) {
              <p class="detail">{{ sentence }}</p>
            }
          </div>
          @if (refusedLines().length > 0) {
            <div class="table-wrap">
              <table data-decisions-failed>
                <thead>
                  <tr>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.kind' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.entry' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.target' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.reason' | rokuT }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of refusedLines(); track $index) {
                    <tr>
                      <td>{{ kindKey(line.row.kind) | rokuT }}</td>
                      <td>
                        <span class="stack">
                          <span>{{ line.row.entryName }}</span>
                          <code>{{ line.row.entryId }}</code>
                        </span>
                      </td>
                      <td>
                        <code>{{ line.row.target }}</code>
                      </td>
                      <td>
                        <span class="stack">
                          <strong>{{
                            errorCodeKey(line.outcome.error?.code) | rokuT
                          }}</strong>
                          <span class="detail">{{
                            line.outcome.error?.detail
                          }}</span>
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
        @if (done.orphanedItemIds.length > 0) {
          <p class="warn">
            {{
              'harvest.entries.decisionsFile.orphaned'
                | rokuT: { ids: done.orphanedItemIds.join(', ') }
            }}
          </p>
        }
        <div class="controls">
          <button (click)="reset()" type="button" data-decisions-another>
            {{ 'harvest.entries.decisionsFile.another' | rokuT }}
          </button>
        </div>
      } @else {
        <label class="file">
          <span>{{ 'harvest.entries.decisionsFile.file' | rokuT }}</span>
          <input
            (change)="chooseFile($event)"
            [disabled]="applying()"
            accept=".jsonl,application/x-ndjson,application/jsonl,text/plain"
            name="decisions"
            type="file"
            data-decisions-file
          />
        </label>

        @if (problem(); as trouble) {
          <p class="failure" role="alert">
            {{
              problemKey(trouble)
                | rokuT
                  : {
                      line: lineOf(trouble),
                      count: countOf(trouble),
                      max: max,
                    }
            }}
          </p>
        }

        @if (file(); as read) {
          <dl class="facts">
            <div>
              <dt>{{ 'harvest.entries.decisionsFile.run' | rokuT }}</dt>
              <dd>
                <code>{{ read.header.runId ?? '' }}</code>
              </dd>
            </div>
            <div>
              <dt>
                {{ 'harvest.entries.decisionsFile.decidedAgainst' | rokuT }}
              </dt>
              <dd>
                <code>{{ read.header.mainUrl ?? '' }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'harvest.entries.decisionsFile.counts' | rokuT }}</dt>
              <dd>
                {{
                  'harvest.entries.decisionsFile.countsValue'
                    | rokuT
                      : {
                          creates: creates(),
                          links: links(),
                          reviews: read.reviews,
                        }
                }}
              </dd>
            </div>
          </dl>

          @if (otherGateway()) {
            <p class="warn" data-decisions-other-gateway>
              {{
                'harvest.entries.decisionsFile.otherGateway'
                  | rokuT: { url: read.header.mainUrl }
              }}
            </p>
          }

          @if (read.rows.length === 0) {
            <p class="state">
              {{ 'harvest.entries.decisionsFile.nothing' | rokuT }}
            </p>
          } @else {
            <div class="table-wrap">
              <table data-decisions-review>
                <thead>
                  <tr>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.kind' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.entry' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.target' | rokuT }}
                    </th>
                    <th scope="col">
                      {{ 'harvest.entries.decisionsFile.name' | rokuT }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of read.rows; track $index) {
                    <tr>
                      <td>{{ kindKey(row.kind) | rokuT }}</td>
                      <td>
                        <code>{{ row.entryId }}</code>
                      </td>
                      <td>
                        <span class="stack">
                          <code>{{ row.target }}</code>
                          @if (row.itemName; as name) {
                            <span>{{ name }}</span>
                          }
                        </span>
                      </td>
                      <td>{{ row.entryName }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (errorKey(); as key) {
            <p class="failure" role="alert">{{ key | rokuT }}</p>
          }

          <div class="controls">
            <button
              (click)="apply()"
              [disabled]="applying() || read.rows.length === 0"
              class="primary"
              type="button"
              data-apply-decisions
            >
              {{
                (applying()
                  ? 'resource.action.working'
                  : 'harvest.entries.decisionsFile.apply'
                ) | rokuT: { count: read.rows.length }
              }}
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      inline-size: 100%;
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    h3 {
      font-size: 0.875rem;
      font-weight: 700;
    }

    .muted,
    .state,
    .detail {
      color: var(--admin-ink-muted);
    }

    .detail {
      font-size: 0.8125rem;
    }

    .file {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .file > span,
    dt,
    th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-4);
    }

    code {
      font-family: monospace;
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
    }

    .table-wrap {
      overflow: auto;
      inline-size: 100%;
      max-block-size: 28rem;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    thead th {
      position: sticky;
      inset-block-start: 0;
      background: var(--admin-surface-raised);
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .applied {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .refused,
    .failure {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .refused .detail {
      color: inherit;
    }

    .warn {
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-status-attention);
      border-radius: var(--admin-radius);
      background: var(--admin-status-attention-wash);
      color: var(--admin-status-attention-on-wash);
    }

    .plain {
      list-style: none;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionsFilePanel {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _config = inject(ADMIN_API_CONFIG, { optional: true });

  /** The file applied, so the queue under it is read again. */
  readonly applied = output<void>();
  /** The panel is closed. */
  readonly closed = output<void>();

  readonly max = DECISIONS_MAX_OPERATIONS;

  readonly file = signal<DecisionsFile | null>(null);
  readonly problem = signal<DecisionsFileProblem | null>(null);
  readonly applying = signal(false);
  readonly answer = signal<EntryDecisionsAnswer | null>(null);
  private readonly _error = signal<GatewayError | null>(null);
  readonly errorKey = computed(() => gatewayErrorKey(this._error()));

  readonly creates = computed(
    () =>
      (this.file()?.rows ?? []).filter((row) => row.kind === 'createItem')
        .length
  );
  readonly links = computed(
    () =>
      (this.file()?.rows ?? []).filter((row) => row.kind === 'accept').length
  );

  /**
   * Whether the file was decided against a different gateway than this app's.
   *
   * The CLI refuses such a file outright. Here it is said out loud instead,
   * because a browser's idea of the gateway's address and the one a terminal
   * used can differ by a name for the same machine; the route's own checks on
   * every row still refuse a file whose rows are not this queue's.
   */
  readonly otherGateway = computed(() => {
    const decided = this.file()?.header.mainUrl ?? null;
    const here = this._config?.gatewayBaseUrl ?? null;
    return (
      decided !== null &&
      here !== null &&
      normalize(decided) !== normalize(here)
    );
  });

  readonly pricesWritten = computed(() =>
    (this.answer()?.results ?? []).reduce(
      (sum, line) => sum + line.pricesWritten,
      0
    )
  );

  /** The operations the refusal names, beside their rows in the file. */
  readonly refusedLines = computed<readonly RefusedLine[]>(() => {
    const answer = this.answer();
    const rows = this.file()?.rows ?? [];
    if (answer === null) {
      return [];
    }
    return answer.results.flatMap((outcome, index) => {
      if (outcome.error === null) {
        return [];
      }
      const row =
        rows.find((candidate) => candidate.entryId === outcome.entryId) ??
        rows[index];
      return row === undefined ? [] : [{ row, outcome }];
    });
  });

  /**
   * Read the chosen file. Nothing is sent: the table this draws is the review.
   */
  async chooseFile(event: Event): Promise<void> {
    const chosen = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file.set(null);
    this.problem.set(null);
    this.answer.set(null);
    this._error.set(null);
    if (chosen === null) {
      return;
    }

    const read = parseDecisionsFile(await chosen.text());
    if (isDecisionsFile(read)) {
      this.file.set(read);
    } else {
      this.problem.set(read);
    }
  }

  /** Send the reviewed file, whole, in one request. */
  async apply(): Promise<void> {
    const read = this.file();
    if (read === null || read.rows.length === 0 || this.applying()) {
      return;
    }
    this.applying.set(true);
    this._error.set(null);
    try {
      const answer = await this._service.applyEntryDecisions(read.request);
      this.answer.set(answer);
      if (answer.applied) {
        this.applied.emit();
      }
    } catch (error) {
      this._error.set(error as GatewayError);
    } finally {
      this.applying.set(false);
    }
  }

  /** Put the panel back to choosing a file. */
  reset(): void {
    this.file.set(null);
    this.problem.set(null);
    this.answer.set(null);
    this._error.set(null);
  }

  kindKey(kind: DecisionsFileRow['kind']): string {
    return kind === 'createItem'
      ? 'harvest.entries.decisionsFile.kindCreate'
      : 'harvest.entries.decisionsFile.kindLink';
  }

  errorCodeKey(code: BulkOperationErrorCode | undefined): string {
    return `harvest.entries.decisionsFile.error.${code ?? 'UNKNOWN'}`;
  }

  problemKey(problem: DecisionsFileProblem): string {
    return `harvest.entries.decisionsFile.problem.${problem.kind}`;
  }

  lineOf(problem: DecisionsFileProblem): number | null {
    return problem.kind === 'notJson' ? problem.line : null;
  }

  countOf(problem: DecisionsFileProblem): number | null {
    return problem.kind === 'tooMany' ? problem.count : null;
  }
}

/** A gateway address without a trailing slash, as the CLI compares them. */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
