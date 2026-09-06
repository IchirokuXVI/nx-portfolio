import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * A block of the dashboard that did not answer (admin plan 0016, section 5).
 *
 * One notice in the section the block would have filled, naming the service and
 * offering the refresh. The rest of the page draws, because a document with one
 * missing block is still three blocks of true numbers and a 502 for the whole
 * page would throw them away.
 *
 * **The copy is per service**, which is why the heading is an input rather than
 * a fixed string: the four are four deployments, and the operator reading this
 * is about to go and look at one of them.
 *
 * Not `lib-harvest-notice`, which says something different: that one is about a
 * service the chart never renders in two of the three environments, and it is
 * built around telling "expected" from "broken". Nothing here is expected, and
 * `harvesterDeployed` must not be consulted: both clusters run the harvester
 * now, so the document is the only thing that knows.
 */
@Component({
  selector: 'lib-block-notice',
  imports: [RokuTranslatorPipe],
  template: `
    <div class="notice" role="status">
      <h3>{{ heading() | rokuT }}</h3>
      <p>{{ 'dashboard.down.body' | rokuT }}</p>
      <button (click)="retry.emit()" type="button">
        {{ 'dashboard.down.retry' | rokuT }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .notice {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px dashed var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    h3 {
      font-size: 1rem;
      font-weight: 700;
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockNotice {
  /** A translation key naming the service that did not answer. */
  readonly heading = input.required<string>();

  readonly retry = output<void>();
}
