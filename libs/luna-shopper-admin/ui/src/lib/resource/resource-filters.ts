import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  EnumOption,
  FilterDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup } from './reference-lookup';
import { ReferencePicker } from './reference-picker';

/** One filter changing. */
export interface FilterChange {
  readonly param: string;
  readonly value: string;
}

/**
 * The controls that narrow a list, from the descriptor's filters.
 *
 * Its own component rather than part of the list, because the list already owns
 * four states and two layouts and this is the part of it a reader is least
 * likely to be looking for. Presentational throughout: it holds no values and
 * reads nothing, so the store stays the one thing that knows what is filtered.
 */
@Component({
  selector: 'lib-resource-filters',
  imports: [RokuTranslatorPipe, ReferencePicker],
  template: `
    <div class="filters">
      @for (filter of filters(); track filter.param) {
        <!-- The label points at its control by id rather than wrapping it. A
             wrapping label whose control is inside a @switch is associated with
             nothing that a linter, or a screen reader, can see. -->
        <div class="filter">
          <label [for]="controlId(filter.param)" class="label">{{
            filter.label | rokuT
          }}</label>

          @switch (filter.kind) {
            @case ('search') {
              <input
                (input)="onInput(filter.param, $event)"
                [id]="controlId(filter.param)"
                [value]="valueOf(filter.param)"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                type="search"
              />
            }
            @case ('enum') {
              <select
                (change)="onInput(filter.param, $event)"
                [id]="controlId(filter.param)"
                [value]="valueOf(filter.param)"
              >
                <option value="">{{ 'resource.filter.any' | rokuT }}</option>
                @for (option of optionsOf(filter); track option.value) {
                  <option [value]="option.value">
                    {{ option.label | rokuT }}
                  </option>
                }
              </select>
            }
            @case ('boolean') {
              <select
                (change)="onInput(filter.param, $event)"
                [id]="controlId(filter.param)"
                [value]="valueOf(filter.param)"
              >
                <option value="">{{ 'resource.filter.any' | rokuT }}</option>
                <option value="true">{{ 'resource.value.yes' | rokuT }}</option>
                <option value="false">{{ 'resource.value.no' | rokuT }}</option>
              </select>
            }
            @case ('date') {
              <input
                (change)="onDate(filter, $event)"
                [id]="controlId(filter.param)"
                [value]="dayOf(filter)"
                type="date"
              />
            }
            @case ('reference') {
              <lib-reference-picker
                (valueChange)="
                  filterChange.emit({ param: filter.param, value: $event })
                "
                [controlId]="controlId(filter.param)"
                [lookup]="lookup()"
                [nullable]="true"
                [resource]="resourceOf(filter)"
                [value]="valueOf(filter.param)"
              />
            }
          }
        </div>
      }

      @if (sorts().length > 0) {
        <div class="filter">
          <label class="label" for="resource-order">{{
            'resource.sort.label' | rokuT
          }}</label>
          <select
            (change)="onOrder($event)"
            [value]="order() ?? ''"
            id="resource-order"
          >
            <option value="">{{ 'resource.sort.default' | rokuT }}</option>
            @for (sort of sorts(); track sort.value) {
              <option [value]="sort.value">{{ sort.label | rokuT }}</option>
            }
          </select>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    .filter {
      display: flex;
      flex: 1 1 12rem;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label {
      cursor: pointer;
    }

    .label {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    input,
    select {
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      font: inherit;
      font-size: 1rem;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
    }

    input:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceFilters {
  readonly filters = input.required<readonly FilterDescriptor[]>();
  readonly values = input.required<Readonly<Record<string, string>>>();
  readonly sorts = input<readonly EnumOption[]>([]);
  readonly order = input<string | undefined>(undefined);
  /** How a reference filter finds the resource it points at. */
  readonly lookup = input<ReferenceLookup>({
    search: async () => [],
    resolve: async () => null,
  });

  readonly filterChange = output<FilterChange>();
  readonly orderChange = output<string>();

  valueOf(param: string): string {
    return this.values()[param] ?? '';
  }

  /** The resource a reference filter points at, for a template that lost the narrowing. */
  resourceOf(filter: FilterDescriptor): string {
    return filter.kind === 'reference' ? filter.resource : '';
  }

  /**
   * A date filter's value, as the `YYYY-MM-DD` a date input reads.
   *
   * The stored value is the instant that goes to the gateway, so it is cut back
   * to a day here rather than kept twice. An unparseable one shows as empty
   * instead of as a broken control.
   */
  dayOf(filter: FilterDescriptor): string {
    const value = this.valueOf(filter.param);
    if (value === '') {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    // An upper bound holds the start of the following day, because the
    // gateway's bound is exclusive. The operator chose the day before that, so
    // that is the day the control has to show back to them.
    if (filter.kind === 'date' && filter.edge === 'end') {
      date.setDate(date.getDate() - 1);
    }

    return toDay(date);
  }

  /** The control's id, which is also what its label points at. */
  controlId(param: string): string {
    return `filter-${param}`;
  }

  /** The options of an enum filter, for a template that has lost the narrowing. */
  optionsOf(filter: FilterDescriptor): readonly EnumOption[] {
    return filter.kind === 'enum' ? filter.options : [];
  }

  onInput(param: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    this.filterChange.emit({ param, value: target.value });
  }

  /**
   * A day, as the instant the gateway's bound is.
   *
   * `createdAfter` is inclusive and `createdBefore` is exclusive, so a lower
   * bound sends the start of the chosen day and an upper bound sends the start
   * of the next one. Picking the same day at both ends therefore means that
   * day, which is the only reading an operator has in mind.
   *
   * Local midnight rather than UTC. The operator picked a day on a calendar
   * they are looking at, and shifting it by their offset would silently move
   * the boundary by a day for anybody far enough east or west.
   */
  onDate(filter: FilterDescriptor, event: Event): void {
    const day = (event.target as HTMLInputElement).value;
    if (day === '') {
      this.filterChange.emit({ param: filter.param, value: '' });
      return;
    }

    const [year, month, date] = day.split('-').map(Number);
    const at = new Date(year, month - 1, date);
    if (filter.kind === 'date' && filter.edge === 'end') {
      at.setDate(at.getDate() + 1);
    }

    this.filterChange.emit({
      param: filter.param,
      value: at.toISOString(),
    });
  }

  onOrder(event: Event): void {
    this.orderChange.emit((event.target as HTMLSelectElement).value);
  }
}

/** A date as `YYYY-MM-DD`, in the reader's own day rather than in UTC. */
function toDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
