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
import type { ReferenceContext, ReferenceLookup } from './reference-lookup';
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
            @case ('reference') {
              <!-- The picker rather than a select, because the thing being
                   chosen is a row of another resource and a select would need
                   every one of them loaded. It offers a way to empty itself
                   whether or not the filter is required: clearing a required
                   one takes the screen back to asking for a parent, which is a
                   place an operator is allowed to be. -->
              <lib-reference-picker
                (valueChange)="
                  filterChange.emit({ param: filter.param, value: $event })
                "
                [context]="contextFor(filter)"
                [controlId]="controlId(filter.param)"
                [disabled]="isWaiting(filter)"
                [lookup]="lookup()"
                [nullable]="true"
                [resource]="resourceOf(filter)"
                [value]="valueOf(filter.param)"
              />

              @if (isWaiting(filter)) {
                <p class="waiting">
                  {{
                    'resource.filter.chooseFirst'
                      | rokuT: { name: waitingLabel(filter) | rokuT }
                  }}
                </p>
              }
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

    .waiting {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
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
  /** Answers the reference filters' searches. Absent means there are none. */
  readonly lookup = input<ReferenceLookup>({
    search: async () => [],
    resolve: async () => null,
  });

  readonly filterChange = output<FilterChange>();
  readonly orderChange = output<string>();

  valueOf(param: string): string {
    return this.values()[param] ?? '';
  }

  /** The control's id, which is also what its label points at. */
  controlId(param: string): string {
    return `filter-${param}`;
  }

  /** The options of an enum filter, for a template that has lost the narrowing. */
  optionsOf(filter: FilterDescriptor): readonly EnumOption[] {
    return filter.kind === 'enum' ? filter.options : [];
  }

  /** The resource a reference filter points at. */
  resourceOf(filter: FilterDescriptor): string {
    return filter.kind === 'reference' ? filter.resource : '';
  }

  /**
   * The filter that has to be answered before this one can search, if any.
   *
   * A shop belongs to a chain and the route that lists shops is addressed under
   * the chain, so the shop picker cannot ask anything until a chain is chosen.
   */
  private _scope(filter: FilterDescriptor): FilterDescriptor | undefined {
    if (filter.kind !== 'reference' || filter.scopedBy === undefined) {
      return undefined;
    }
    const name = filter.scopedBy;
    return this.filters().find((entry) => entry.param === name);
  }

  /** Whether this filter is waiting on the one that scopes it. */
  isWaiting(filter: FilterDescriptor): boolean {
    const scope = this._scope(filter);
    return scope !== undefined && this.valueOf(scope.param) === '';
  }

  /** What to call the filter this one is waiting on. */
  waitingLabel(filter: FilterDescriptor): string {
    return this._scope(filter)?.label ?? '';
  }

  /** What narrows this filter's search: the value of the filter that scopes it. */
  contextFor(filter: FilterDescriptor): ReferenceContext {
    const scope = this._scope(filter);
    return scope === undefined
      ? {}
      : { [scope.param]: this.valueOf(scope.param) };
  }

  onInput(param: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    this.filterChange.emit({ param, value: target.value });
  }

  onOrder(event: Event): void {
    this.orderChange.emit((event.target as HTMLSelectElement).value);
  }
}
