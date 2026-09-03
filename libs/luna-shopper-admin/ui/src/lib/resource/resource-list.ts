import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  EnumOption,
  FieldDescriptor,
  FilterDescriptor,
  NamedAction,
  ResourceRow,
  ResourceRowView,
} from '@portfolio/luna-shopper-admin/models';
import type { ReferenceLookup } from './reference-lookup';
import { ResourceCellView } from './resource-cell';
import { ResourceFilters, type FilterChange } from './resource-filters';

/** A named action, asked for on one row. */
export interface RowAction {
  readonly action: NamedAction<ResourceRow>;
  readonly row: ResourceRowView;
}

/**
 * Every list in the back office (plan 0004, section 3).
 *
 * **A table on a wide screen and cards on a narrow one, from one descriptor.**
 * Not a table that scrolls sideways: fifteen columns on a phone are unusable
 * however they scroll, which is why the descriptor names the fields that survive
 * and this component draws only those below the breakpoint.
 *
 * Purely presentational. It is handed rows that are already formatted, and it
 * emits what the operator asked for; the store decides what any of it means.
 * That is what makes the four states below assertable without a backend, and it
 * is the reason a second entity costs a descriptor rather than a component.
 *
 * The four states are the point of writing this once:
 *
 * - **Loading**, which says so rather than showing an empty table.
 * - **Empty**, meaning there is nothing here.
 * - **No match**, meaning there is something here and the filter is hiding it.
 *   A different sentence with a different remedy, and the only one of the two
 *   that offers a way out. An operator staring at "no supermarkets" because a
 *   filter from three screens ago is still set is the failure this exists for.
 * - **Failed**, which offers the request again.
 * - **Blocked**, meaning a required filter has no answer and nothing has been
 *   asked for yet. Three of the catalog's lists are addressed under a parent,
 *   so this is the screen saying which choice is missing rather than showing an
 *   error it caused itself by asking anyway.
 */
@Component({
  selector: 'lib-resource-list',
  imports: [RokuTranslatorPipe, ResourceCellView, ResourceFilters],
  template: `
    <header class="head">
      <h1>{{ titleKey() | rokuT }}</h1>
      @if (canCreate()) {
        <button (click)="create.emit()" class="primary" type="button">
          {{ 'resource.action.create' | rokuT }}
        </button>
      }
    </header>

    @if (noteKey(); as note) {
      <p class="note">{{ note | rokuT }}</p>
    }

    @if (filters().length > 0 || sorts().length > 0) {
      <lib-resource-filters
        (filterChange)="filterChange.emit($event)"
        (orderChange)="orderChange.emit($event)"
        [filters]="filters()"
        [lookup]="lookup()"
        [order]="order()"
        [sorts]="sorts()"
        [values]="filterValues()"
      />
    }

    @if (blocked()) {
      <p class="state" role="status">
        {{ 'resource.list.blocked' | rokuT: { names: waitingForLabels() } }}
      </p>
    } @else if (loading()) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <div class="state error" role="alert">
        <p>{{ errorKey() | rokuT }}</p>
        <button (click)="retry.emit()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (noMatch()) {
      <div class="state" role="status">
        <p>{{ 'resource.list.noMatch' | rokuT }}</p>
        <button (click)="clear.emit()" type="button">
          {{ 'resource.action.clearFilters' | rokuT }}
        </button>
      </div>
    } @else if (empty()) {
      <p class="state" role="status">{{ 'resource.list.empty' | rokuT }}</p>
    } @else if (compact()) {
      <ul class="cards">
        @for (row of rows(); track row.id) {
          <li class="card">
            @if (canOpen()) {
              <button (click)="open.emit(row.id)" class="title" type="button">
                {{ row.title }}
              </button>
            } @else {
              <p class="title plain">{{ row.title }}</p>
            }
            <dl>
              @for (field of compactColumns(); track field.name) {
                <div class="pair">
                  <dt>{{ field.label | rokuT }}</dt>
                  <dd>
                    <lib-resource-cell [cell]="cellOf(row, field.name)" />
                  </dd>
                </div>
              }
            </dl>
            <div class="row-actions">
              @for (action of actionsFor(row); track action.name) {
                <button
                  (click)="act.emit({ action, row })"
                  [disabled]="busyRowId() === row.id"
                  type="button"
                >
                  {{ action.label | rokuT }}
                </button>
              }
              @if (canDelete()) {
                <button
                  (click)="remove.emit(row.id)"
                  [disabled]="busyRowId() === row.id"
                  class="danger"
                  type="button"
                >
                  {{ 'resource.action.delete' | rokuT }}
                </button>
              }
            </div>
          </li>
        }
      </ul>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              @for (field of columns(); track field.name) {
                <th scope="col">{{ field.label | rokuT }}</th>
              }
              <th class="actions-head" scope="col">
                <span class="sr-only">{{
                  'resource.list.actions' | rokuT
                }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr>
                @for (
                  field of columns();
                  track field.name;
                  let index = $index
                ) {
                  <td>
                    <!-- The first column is the row's own name, and is the
                         control that opens it. A row needs one thing that is
                         reachable by keyboard and says what it opens, and its
                         name is the only honest candidate. -->
                    @if (index === 0 && canOpen()) {
                      <button
                        (click)="open.emit(row.id)"
                        class="title"
                        type="button"
                      >
                        {{ row.title }}
                      </button>
                    } @else if (index === 0) {
                      <span class="title plain">{{ row.title }}</span>
                    } @else {
                      <lib-resource-cell [cell]="cellOf(row, field.name)" />
                    }
                  </td>
                }
                <td class="row-actions">
                  @for (action of actionsFor(row); track action.name) {
                    <button
                      (click)="act.emit({ action, row })"
                      [disabled]="busyRowId() === row.id"
                      type="button"
                    >
                      {{ action.label | rokuT }}
                    </button>
                  }
                  @if (canDelete()) {
                    <button
                      (click)="remove.emit(row.id)"
                      [disabled]="busyRowId() === row.id"
                      class="danger"
                      type="button"
                    >
                      {{ 'resource.action.delete' | rokuT }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (moreFailed()) {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    }

    @if (hasMore()) {
      <button
        (click)="more.emit()"
        [disabled]="loadingMore()"
        class="more"
        type="button"
      >
        {{
          (loadingMore() ? 'resource.list.loadingMore' : 'resource.action.more')
            | rokuT
        }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .state {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: top;
    }

    th {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody tr:last-child td {
      border-block-end: none;
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      list-style: none;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .pair {
      display: flex;
      gap: var(--admin-space-3);
      justify-content: space-between;
    }

    dt {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    dd {
      text-align: end;
    }

    .note {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink-muted);
    }

    .title.plain {
      font-weight: 600;
      color: var(--admin-ink);
    }

    .title {
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-weight: 600;
      text-align: start;
      color: var(--admin-accent);
      cursor: pointer;
    }

    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      justify-content: flex-end;
    }

    button {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.title {
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .more {
      align-self: center;
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceList {
  /** The resource's plural label, as a key. */
  readonly titleKey = input.required<string>();
  readonly columns = input.required<readonly FieldDescriptor[]>();
  /** The subset that survives to a phone, in card order. */
  readonly compactColumns = input.required<readonly FieldDescriptor[]>();
  readonly rows = input.required<readonly ResourceRowView[]>();

  /**
   * Whether to draw cards instead of a table.
   *
   * An input rather than a media query inside these styles, so the switch is a
   * value a spec can set. `Viewport` is what supplies it in the app.
   */
  readonly compact = input(false);

  readonly loading = input(false);
  readonly failed = input(false);
  /**
   * Nothing has been read, and nothing will be until a filter is answered.
   *
   * A fifth state beside the four above, and it is not "empty": there may be
   * thousands of rows, and the screen has not asked for them. Saying "there is
   * nothing here" would be a claim about the data rather than about the screen.
   */
  readonly blocked = input(false);
  /** What is missing, already translated and joined, for the blocked message. */
  readonly waitingForLabels = input('');
  /** A failure with rows already on screen: a line, not a replacement. */
  readonly moreFailed = input(false);
  /** The key for whatever went wrong, chosen by the page. */
  readonly errorKey = input('resource.error.unknown');
  readonly empty = input(false);
  readonly noMatch = input(false);
  readonly hasMore = input(false);
  readonly loadingMore = input(false);

  readonly canCreate = input(false);
  readonly canDelete = input(false);
  /**
   * Whether a row leads anywhere.
   *
   * False for a resource with no detail screen, where the name is drawn as text
   * rather than as a control. A button that looks like a link and goes nowhere
   * is worse than a plain name, and a keyboard reaches it first.
   */
  readonly canOpen = input(true);
  /** A sentence above the list, as a key. For a screen whose shape needs explaining. */
  readonly noteKey = input<string | null>(null);
  readonly namedActions = input<readonly NamedAction<ResourceRow>[]>([]);
  /** The row something is happening to, so its controls stop taking clicks. */
  readonly busyRowId = input<string | null>(null);

  readonly filters = input<readonly FilterDescriptor[]>([]);
  readonly filterValues = input<Readonly<Record<string, string>>>({});
  readonly sorts = input<readonly EnumOption[]>([]);
  readonly order = input<string | undefined>(undefined);
  /** How a reference filter finds the resource it points at. */
  readonly lookup = input<ReferenceLookup>({
    search: async () => [],
    resolve: async () => null,
  });

  readonly create = output<void>();
  readonly open = output<string>();
  readonly remove = output<string>();
  readonly more = output<void>();
  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly act = output<RowAction>();
  readonly filterChange = output<FilterChange>();
  readonly orderChange = output<string>();

  /** One cell, or an empty one when the row view has none for this field. */
  cellOf(row: ResourceRowView, name: string) {
    return row.cells[name] ?? { text: '', key: 'resource.value.none' };
  }

  /** The named actions this row is allowed to have done to it right now. */
  actionsFor(row: ResourceRowView): readonly NamedAction<ResourceRow>[] {
    return this.namedActions().filter(
      (action) => action.available?.(row.row) ?? true
    );
  }
}
