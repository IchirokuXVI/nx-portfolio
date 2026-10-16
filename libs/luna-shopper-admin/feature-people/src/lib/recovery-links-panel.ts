import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  type OnDestroy,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import type { RecoveryLinks } from '@portfolio/luna-shopper-admin/data-access';
import { CautionLine } from '@portfolio/luna-shopper-admin/ui';
import { instant } from './people-format';

/** How long a button says "Copied" before it offers the copy again. */
const COPIED_FOR_MS = 2000;

/** Which of the two links a row of the panel holds. */
type LinkKind = 'reset' | 'signIn';

/**
 * The two links of a reset grant, for the operator to hand to the person
 * (backend plan 0210, target state 8).
 *
 * **The links live here and nowhere else.** They arrive as an input from the
 * outcome of the action, which the record page holds in one signal until the
 * dialog closes; this component reads them and copies them on request. Not a
 * store, not `localStorage`, not the URL, not a log line. Closing the dialog
 * destroys this component and the page drops the outcome, and then the links
 * are gone from the back office. Creating them again makes a new grant.
 *
 * Each link is drawn whole, in a field the operator can select by hand when
 * the browser refuses the clipboard, with a copy button beside it. The warning
 * comes first, because these are a key to somebody's account.
 */
@Component({
  selector: 'lib-recovery-links-panel',
  imports: [CautionLine, RokuTranslatorPipe],
  template: `
    <lib-caution-line
      [text]="'people.users.recovery.warning' | rokuT"
      data-recovery-warning
    />

    @for (row of rows(); track row.kind) {
      <div class="link">
        <label [for]="'recovery-' + row.kind">{{ row.label | rokuT }}</label>
        <div class="value">
          <input
            [attr.data-recovery-link]="row.kind"
            [id]="'recovery-' + row.kind"
            [value]="row.url"
            readonly
            spellcheck="false"
            type="text"
          />
          <button
            (click)="copy(row.kind, row.url)"
            [attr.aria-label]="
              copied() === row.kind
                ? null
                : ('people.users.recovery.copy' | rokuT) +
                  ': ' +
                  (row.label | rokuT)
            "
            [attr.data-copy-recovery]="row.kind"
            type="button"
          >
            {{
              (copied() === row.kind
                ? 'people.users.recovery.copied'
                : 'people.users.recovery.copy'
              ) | rokuT
            }}
          </button>
        </div>
      </div>
    }

    <p class="expires" data-recovery-expires>
      {{ 'people.users.recovery.expires' | rokuT: { until: until() } }}
    </p>

    <!-- The button changes its own words, which a screen reader does not
         read out by itself. This line is what it hears. -->
    <p aria-live="polite" class="sr-only">
      {{
        copied() !== null
          ? ('people.users.recovery.copied' | rokuT)
          : failed()
            ? ('people.users.recovery.copyFailed' | rokuT)
            : ''
      }}
    </p>
    @if (failed()) {
      <p class="failed" data-copy-failed>
        {{ 'people.users.recovery.copyFailed' | rokuT }}
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .link {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    label {
      font-weight: 600;
    }

    .value {
      display: flex;
      gap: var(--admin-space-2);
      min-inline-size: 0;
    }

    input {
      flex: 1;
      min-inline-size: 0;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-2);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface);
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
      color: var(--admin-ink);
    }

    button {
      flex: none;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: none;
      color: var(--admin-ink);
      cursor: pointer;
    }

    input:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .expires,
    .failed {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecoveryLinksPanel implements OnDestroy {
  private readonly _translator = inject(RokuTranslatorService);

  readonly links = input.required<RecoveryLinks>();

  /** The two rows, the reset link first: it is the one that closes every way in. */
  readonly rows = computed(() => {
    const links = this.links();
    return [
      {
        kind: 'reset' as LinkKind,
        label: 'people.users.recovery.reset',
        url: links.resetUrl,
      },
      {
        kind: 'signIn' as LinkKind,
        label: 'people.users.recovery.signIn',
        url: links.signInUrl,
      },
    ];
  });

  /** When both links stop working, in the reading language of the operator. */
  readonly until = computed(() =>
    instant(this.links().expiresAt, this._translator.locale())
  );

  /** The link that was just copied, which its button then says. */
  readonly copied = signal<LinkKind | null>(null);
  /** Whether the browser refused the last copy. */
  readonly failed = signal(false);

  private _timer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this._clearTimer();
  }

  /**
   * Copy one link, and say so on its button for a moment. A browser that
   * refuses says so in a line, and the link is still in its field to be
   * selected by hand.
   */
  async copy(kind: LinkKind, url: string): Promise<void> {
    this._clearTimer();
    this.failed.set(false);
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(kind);
      this._timer = setTimeout(() => {
        this._timer = null;
        this.copied.set(null);
      }, COPIED_FOR_MS);
    } catch {
      this.copied.set(null);
      this.failed.set(true);
    }
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
