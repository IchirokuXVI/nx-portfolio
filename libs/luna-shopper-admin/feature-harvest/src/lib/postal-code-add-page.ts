import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { toGatewayError } from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  DEFAULT_POSTAL_CODE_COUNTRY,
  PostalCodeQueueGateway,
} from './postal-code-queue-gateway';

/** One code that was refused, and why. */
interface AddFailure {
  readonly postalCode: string;
  readonly reasonKey: string;
}

/**
 * How many codes are added at once.
 *
 * Plan 0020's number, and its reasoning: enough that twelve codes are not twelve
 * round trips end to end, few enough that adding a city does not arrive at the
 * gateway as a burst.
 */
const AT_ONCE = 4;

/**
 * Adding postal codes (admin plan 0021, section 3).
 *
 * **The codes field accepts several.** An operator adding a city adds twelve
 * codes, not one, and a form used twelve times is a form nobody uses. That is
 * the whole reason this screen exists instead of the generic form: everything
 * else about it is three fields.
 *
 * The route keeps one code per call (backend plan 0097, section 6.1), because a
 * bulk endpoint is a transaction boundary and a timeout budget the harvester
 * does not have. So twelve codes are twelve calls from the browser, and this
 * screen is honest about that under plan 0020's rules:
 *
 * - Four at a time, with a progress line counting codes rather than time.
 * - **Each failure named with its own code and its own reason.** The common one
 *   is a code that does not exist, which is a typo, and an operator told "3 of
 *   12 failed" cannot fix a typo they cannot see.
 * - What succeeded stays succeeded. The field keeps only the codes that were
 *   refused, so pressing again retries exactly those and nothing else.
 */
@Component({
  selector: 'lib-postal-code-add-page',
  imports: [FormsModule, RokuTranslatorPipe],
  template: `
    <header>
      <h1>{{ 'harvest.postalCodes.add.heading' | rokuT }}</h1>
      <p class="lead">{{ 'harvest.postalCodes.add.lead' | rokuT }}</p>
    </header>

    <form (ngSubmit)="submit()">
      <label class="country">
        <span>{{ 'harvest.postalCodes.add.country' | rokuT }}</span>
        <input
          [(ngModel)]="country"
          [disabled]="running()"
          maxlength="2"
          name="country"
          type="text"
        />
      </label>

      <label class="codes">
        <span>{{ 'harvest.postalCodes.add.codes' | rokuT }}</span>
        <textarea
          [(ngModel)]="codes"
          [disabled]="running()"
          name="codes"
          rows="6"
        ></textarea>
        <small>{{ 'harvest.postalCodes.add.codesHelp' | rokuT }}</small>
      </label>

      <label class="discover">
        <input
          [(ngModel)]="discoverNow"
          [disabled]="running()"
          name="discoverNow"
          type="checkbox"
        />
        <span>
          {{ 'harvest.postalCodes.add.discoverNow' | rokuT }}
          <small>{{ 'harvest.postalCodes.add.discoverNowHelp' | rokuT }}</small>
        </span>
      </label>

      @if (progress(); as run) {
        <p class="progress" role="status">
          {{
            'harvest.postalCodes.add.progress'
              | rokuT: { done: run.done, total: run.total }
          }}
        </p>
      } @else {
        <div class="controls">
          <button
            [disabled]="parsed().length === 0"
            class="primary"
            type="submit"
          >
            {{
              'harvest.postalCodes.add.submit'
                | rokuT: { count: parsed().length }
            }}
          </button>
          <button (click)="back()" type="button">
            {{ 'harvest.postalCodes.add.cancel' | rokuT }}
          </button>
        </div>
      }
    </form>

    @if (report(); as done) {
      <section class="report" role="status">
        <p>
          {{
            'harvest.postalCodes.add.added'
              | rokuT: { added: done.added, total: done.total }
          }}
        </p>

        @if (done.failed.length > 0) {
          <ul class="failures">
            @for (failure of done.failed; track failure.postalCode) {
              <li>
                <span class="code">{{ failure.postalCode }}</span>
                <span class="reason">{{ failure.reasonKey | rokuT }}</span>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    .lead {
      color: var(--admin-ink-muted);
    }

    form {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    label small {
      display: block;
      color: var(--admin-ink-muted);
    }

    .country input {
      inline-size: 5rem;
    }

    .codes {
      inline-size: 100%;
    }

    .codes textarea {
      inline-size: 100%;
      font-family: monospace;
    }

    .discover {
      flex-direction: row;
      gap: var(--admin-space-3);
      align-items: flex-start;
    }

    .discover span {
      color: var(--admin-ink);
    }

    .controls {
      display: flex;
      gap: var(--admin-space-3);
    }

    .primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    button {
      cursor: pointer;
    }

    .progress {
      color: var(--admin-ink-muted);
    }

    .report {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .failures {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .failures li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .code {
      font-family: monospace;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostalCodeAddPage {
  private readonly _gateway = inject(PostalCodeQueueGateway);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  readonly country = signal(DEFAULT_POSTAL_CODE_COUNTRY);
  readonly codes = signal('');

  /**
   * Whether adding a code also asks for a run.
   *
   * On by default, because that is what somebody typing a postal code into this
   * screen wants. Off parks the code: the row exists and is listed, and no run
   * is queued for it, which is for a code an operator wants tracked without
   * spending a run today.
   */
  readonly discoverNow = signal(true);

  /** How far a run has got, or null when none is going. */
  readonly progress = signal<{ done: number; total: number } | null>(null);

  /** What the last run did, by code. */
  readonly report = signal<{
    added: number;
    total: number;
    failed: readonly AddFailure[];
  } | null>(null);

  readonly running = computed(() => this.progress() !== null);

  /**
   * The codes as typed, split and deduplicated.
   *
   * Whitespace, commas and newlines all separate, because a person pasting a
   * list from somewhere else has no idea which one that list used, and none of
   * the three can appear inside a postal code.
   */
  readonly parsed = computed(() => splitPostalCodes(this.codes()));

  async submit(): Promise<void> {
    const codes = this.parsed();
    if (codes.length === 0 || this.running()) {
      return;
    }

    const country = this.country().trim().toLowerCase();
    const discoverNow = this.discoverNow();

    this.report.set(null);
    this.progress.set({ done: 0, total: codes.length });

    const failed: AddFailure[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const postalCode = codes[next++];
        if (postalCode === undefined) {
          return;
        }

        try {
          await this._gateway.create({ country, postalCode, discoverNow });
        } catch (error) {
          failed.push({
            postalCode,
            reasonKey:
              gatewayErrorKey(toGatewayError(error)) ??
              'resource.error.unknown',
          });
        } finally {
          this.progress.update((run) =>
            run === null ? null : { ...run, done: run.done + 1 }
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, codes.length) }, worker)
    );

    this.progress.set(null);
    // Only the refused ones stay in the field, in the order they were typed, so
    // pressing again retries exactly those. A form that kept all twelve would
    // send nine that already worked and answer nine conflicts.
    const refused = new Set(failed.map((failure) => failure.postalCode));
    this.codes.set(codes.filter((code) => refused.has(code)).join('\n'));
    this.report.set({
      added: codes.length - failed.length,
      total: codes.length,
      failed: codes
        .filter((code) => refused.has(code))
        .map(
          (code) =>
            failed.find((failure) => failure.postalCode === code) as AddFailure
        ),
    });
  }

  back(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }
}

/**
 * A typed or pasted block of codes, as a list.
 *
 * Order is the order they were typed, because that is the order the report and
 * the retry are read in. Duplicates are dropped: a code pasted twice is one
 * code, and sending it twice would answer a conflict the operator did not cause.
 */
export function splitPostalCodes(text: string): readonly string[] {
  const seen = new Set<string>();
  const codes: string[] = [];

  for (const raw of text.split(/[\s,;]+/)) {
    const code = raw.trim();
    if (code !== '' && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  return codes;
}
