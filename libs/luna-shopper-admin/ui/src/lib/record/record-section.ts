import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One per section, so two on one page do not share a heading id. */
let nextId = 0;

/**
 * A panel with one heading, and the rows of a record under it (admin plan
 * 0052, section 3.1).
 *
 * The same panel while the page reads and while it changes, so nothing moves
 * when the mode does. It holds no data: the rows are whatever is put in it,
 * usually one `lib-field-row` for each field.
 *
 * Two slots. `[sectionAction]` is one small button at the end of the heading
 * row, and everything else is a row.
 */
@Component({
  selector: 'lib-record-section',
  template: `
    <section [attr.aria-labelledby]="headingId">
      <div class="head">
        <!-- The level is the page's to say: a section of the page is a second
             level heading, and a section inside a pane is one level down. -->
        @if (level() === 3) {
          <h3 [id]="headingId">{{ heading() }}</h3>
        } @else {
          <h2 [id]="headingId">{{ heading() }}</h2>
        }
        @if (count() !== null) {
          <span class="count" data-count>{{ count() }}</span>
        }
        <span class="action"><ng-content select="[sectionAction]" /></span>
      </div>

      <ng-content />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    section {
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .head {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 2.625rem;
      padding: var(--admin-space-1) var(--admin-space-4);
    }

    h2,
    h3 {
      min-inline-size: 0;
      font-size: 0.9375rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    h3 {
      font-size: 0.875rem;
    }

    .count {
      flex: none;
      padding: 0.0625rem var(--admin-space-2);
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-neutral-on-wash);
    }

    .action {
      display: flex;
      flex: 1;
      justify-content: flex-end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordSection {
  /** The heading, already translated. */
  readonly heading = input.required<string>();
  /** A count beside the heading. `null` draws none. */
  readonly count = input<number | null>(null);
  /** The level of the heading. A pane uses 3. */
  readonly level = input<2 | 3>(2);

  readonly headingId = `record-section-${nextId++}`;
}
