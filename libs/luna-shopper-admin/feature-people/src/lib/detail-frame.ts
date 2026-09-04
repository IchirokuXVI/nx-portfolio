import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One line of a definition list: a keyed label, and a value already formatted. */
export interface DetailFact {
  /** A translation key. */
  readonly label: string;
  /** Already formatted. Empty renders as "none". */
  readonly text: string;
}

/**
 * The frame every people detail screen draws inside.
 *
 * The four screens under `0007` show genuinely different things: an account and
 * the zones it is in, a membership and a set of lists, the lines of a list, the
 * lines of a basket. What they share is everything around that, and writing it
 * four times is how the fourth one ends up disagreeing with the first about
 * what a failed read looks like.
 *
 * So this owns the heading, the way back, and the three states a read has, and
 * the screens own their content. It is presentational throughout: it reads
 * nothing and holds nothing.
 */
@Component({
  selector: 'lib-detail-frame',
  imports: [RokuTranslatorPipe],
  template: `
    <header>
      <button (click)="back.emit()" class="back" type="button">
        {{ 'people.detail.back' | rokuT }}
      </button>
      <h1>{{ heading() }}</h1>
      <p class="kind">{{ kindKey() | rokuT }}</p>
    </header>

    @if (loading()) {
      <p class="state" role="status">{{ 'people.detail.loading' | rokuT }}</p>
    } @else if (errorKey(); as key) {
      <div class="state error" role="alert">
        <p>{{ key | rokuT }}</p>
        <button (click)="retry.emit()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else {
      <ng-content />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: baseline;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    .kind {
      color: var(--admin-ink-muted);
    }

    .back {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .state.error button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailFrame {
  /** What this row is called. Already resolved, since it is data and not a key. */
  readonly heading = input('');
  /** What kind of thing it is, as a key: the resource's singular label. */
  readonly kindKey = input.required<string>();
  readonly loading = input(false);
  /** A key for whatever went wrong, or null when nothing did. */
  readonly errorKey = input<string | null>(null);

  readonly back = output<void>();
  readonly retry = output<void>();
}

/**
 * A definition list, from facts that are already strings.
 *
 * Separate from the frame because three of the four screens draw more than one
 * of these, and because a list of facts is exactly the thing worth asserting on
 * without rendering: a spec reads the array.
 */
@Component({
  selector: 'lib-detail-facts',
  imports: [RokuTranslatorPipe],
  template: `
    <dl>
      @for (fact of facts(); track fact.label) {
        <div class="pair">
          <dt>{{ fact.label | rokuT }}</dt>
          <dd>
            @if (fact.text === '') {
              <span class="none">{{ 'resource.value.none' | rokuT }}</span>
            } @else {
              {{ fact.text }}
            }
          </dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host {
      display: block;
    }

    dl {
      display: grid;
      gap: var(--admin-space-2);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .pair {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      justify-content: space-between;
    }

    dt {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    dd {
      overflow-wrap: anywhere;
      text-align: end;
    }

    .none {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailFacts {
  readonly facts = input.required<readonly DetailFact[]>();
}
