import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  EnumOption,
  FieldDescriptor,
  FilterDescriptor,
  InfoContent,
  NamedAction,
  ResourceRow,
  ResourceRowView,
} from '@portfolio/luna-shopper-admin/models';
import { InfoButton } from '../info/info-button';
import { PageHeader } from '../page/page-header';
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
 */
@Component({
  selector: 'lib-resource-list',
  imports: [
    RokuTranslatorPipe,
    ResourceCellView,
    ResourceFilters,
    PageHeader,
    InfoButton,
  ],
  template: `
    @switch (heading()) {
      @case ('page') {
        <lib-page-header [heading]="titleKey() | rokuT" [info]="info()">
          @if (canCreate()) {
            <button
              (click)="create.emit()"
              class="primary"
              pageAction
              type="button"
            >
              {{ createKey() | rokuT }}
            </button>
          }
        </lib-page-header>
      }
      @case ('pane') {
        <!-- The list is a column beside the row that is open, and that row's
             page draws the header. The column says what it lists. -->
        <div class="pane-head">
          @if (headingLevel() === 1) {
            <h1>{{ titleKey() | rokuT }}</h1>
          } @else {
            <h2>{{ titleKey() | rokuT }}</h2>
          }
          @if (info(); as content) {
            <lib-info-button [info]="content" />
          }
          @if (canCreate()) {
            <button (click)="create.emit()" type="button" data-create>
              {{ createKey() | rokuT }}
            </button>
          }
        </div>
      }
      @default {
        <!-- A tab: the page above already drew the header and the tab says
             what is listed, so only the action is left to draw. -->
        @if (canCreate() || info() !== null) {
          <div class="tools">
            @if (info(); as content) {
              <lib-info-button [info]="content" />
            }
            @if (canCreate()) {
              <button
                (click)="create.emit()"
                class="primary"
                type="button"
                data-create
              >
                {{ createKey() | rokuT }}
              </button>
            }
          </div>
        }
      }
    }

    @for (notice of noticeKeys(); track notice) {
      <p class="notice" role="status">{{ notice | rokuT }}</p>
    }

    @if (layout() === 'rows') {
      <!-- A column has room for one field. The search stays in view, and the
           other filters and the order open under a button, which says how
           many of them are narrowing the list. -->
      @if (searchFilters().length > 0 || hasMoreFilters()) {
        <div class="column-tools">
          @if (searchFilters().length > 0) {
            <lib-resource-filters
              (filterChange)="filterChange.emit($event)"
              [filters]="searchFilters()"
              [lookup]="lookup()"
              [scope]="filterScope()"
              [sorts]="[]"
              [values]="filterValues()"
              class="column-search"
            />
          }
          @if (hasMoreFilters()) {
            <button
              (click)="filtersOpen.set(!filtersOpen())"
              [attr.aria-expanded]="filtersOpen()"
              class="filter-toggle"
              type="button"
              data-more-filters
            >
              {{ 'resource.filter.more' | rokuT }}
              @if (narrowedBy(); as count) {
                <span class="filter-count">{{ count }}</span>
              }
            </button>
          }
        </div>
        @if (filtersOpen() && hasMoreFilters()) {
          <lib-resource-filters
            (filterChange)="filterChange.emit($event)"
            (orderChange)="orderChange.emit($event)"
            [filters]="otherFilters()"
            [lookup]="lookup()"
            [order]="order()"
            [scope]="filterScope()"
            [sorts]="sorts()"
            [values]="filterValues()"
          />
        }
      }
    } @else if (filters().length > 0 || sorts().length > 0) {
      <lib-resource-filters
        (filterChange)="filterChange.emit($event)"
        (orderChange)="orderChange.emit($event)"
        [filters]="filters()"
        [lookup]="lookup()"
        [order]="order()"
        [scope]="filterScope()"
        [sorts]="sorts()"
        [values]="filterValues()"
      />
    }

    <!-- A refusal of something the operator did to one row, such as a delete
         the server would not do, with a link to what stands in the way. -->
    <ng-content select="[listRefusal]" />

    <!-- What the page draws for ticked rows: a count, the bulk actions, and
         the panel one of them opened (admin plan 0035, section 2). -->
    <ng-content select="[listBulk]" />

    @if (loading()) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (failed()) {
      <div class="state error" role="alert">
        <p>{{ errorKey() | rokuT }}</p>
        <button (click)="retry.emit()" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (idNotFound()) {
      <!-- An ID was typed into the search and no row of this resource has it
           (admin plan 0051). Its own sentence: nothing is hidden by a filter,
           and the list is not empty. -->
      <div class="state" role="status" data-id-not-found>
        <p>
          @if (oneKey() !== '') {
            {{ 'resource.id.notFound' | rokuT: { thing: oneKey() | rokuT } }}
          } @else {
            {{ 'resource.id.notFoundHere' | rokuT }}
          }
        </p>
        <button (click)="clear.emit()" type="button">
          {{ 'resource.action.clearFilters' | rokuT }}
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
    } @else if (layout() === 'rows') {
      <!-- A column beside the open row: a name, one line, and the row's
           states. No delete here, since the open row's own page has it. -->
      <ul class="rows">
        @for (row of rows(); track row.id) {
          <li>
            <button
              (click)="open.emit(row.id)"
              [attr.aria-current]="row.id === currentId() ? 'true' : null"
              [class.current]="row.id === currentId()"
              class="row"
              type="button"
              data-row
            >
              <span class="row-main">
                <span class="row-heading">{{
                  row.brief?.heading ?? row.title
                }}</span>
                @if (row.brief?.line || (row.states ?? []).length > 0) {
                  <span class="row-line">
                    @if (row.brief?.line; as line) {
                      <span>{{ line }}</span>
                    }
                    @for (state of row.states ?? []; track state.label) {
                      <span [attr.data-tone]="state.tone" class="state-chip">{{
                        state.label | rokuT: state.args
                      }}</span>
                    }
                  </span>
                }
              </span>
              @if (row.brief?.trailing; as trailing) {
                <span class="row-trailing">{{ trailing }}</span>
              }
            </button>
          </li>
        }
      </ul>
    } @else if (compact()) {
      <ul class="cards">
        @for (row of rows(); track row.id) {
          <li [class.picked]="isSelected(row.id)" class="card">
            @if (selectable()) {
              <label class="pick">
                <input
                  (change)="pick.emit(row.id)"
                  [checked]="isSelected(row.id)"
                  [disabled]="selectionLocked()"
                  type="checkbox"
                  data-pick-row
                />
                <span>{{
                  'resource.bulk.selectRow' | rokuT: { name: row.title }
                }}</span>
              </label>
            }
            @if (canOpen()) {
              <button (click)="open.emit(row.id)" class="title" type="button">
                {{ row.title }}
              </button>
            } @else {
              <p class="title plain">{{ row.title }}</p>
            }
            @if ((row.states ?? []).length > 0) {
              <p class="states">
                @for (state of row.states ?? []; track state.label) {
                  <span [attr.data-tone]="state.tone" class="state-chip">{{
                    state.label | rokuT: state.args
                  }}</span>
                }
              </p>
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
              @if (selectable()) {
                <th class="pick-cell" scope="col">
                  <span class="sr-only">{{
                    'resource.bulk.selectColumn' | rokuT
                  }}</span>
                </th>
              }
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
              <tr [class.picked]="isSelected(row.id)">
                @if (selectable()) {
                  <td class="pick-cell">
                    <input
                      (change)="pick.emit(row.id)"
                      [attr.aria-label]="
                        'resource.bulk.selectRow' | rokuT: { name: row.title }
                      "
                      [checked]="isSelected(row.id)"
                      [disabled]="selectionLocked()"
                      type="checkbox"
                      data-pick-row
                    />
                  </td>
                }
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
                    @if (index === 0) {
                      @for (state of row.states ?? []; track state.label) {
                        <span
                          [attr.data-tone]="state.tone"
                          class="state-chip beside"
                          >{{ state.label | rokuT: state.args }}</span
                        >
                      }
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

    .pane-head {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      min-block-size: 3.25rem;
      margin-inline: calc(-1 * var(--admin-page-inline));
      margin-block-start: calc(-1 * var(--admin-page-block));
      padding-inline: var(--admin-page-inline);
      border-block-end: 1px solid var(--admin-border);
    }

    .pane-head h1,
    .pane-head h2 {
      flex: 1;
      overflow: hidden;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .column-tools {
      display: flex;
      gap: var(--admin-space-2);
      align-items: flex-end;
    }

    .column-search {
      flex: 1;
      min-inline-size: 0;
    }

    .filter-toggle {
      display: inline-flex;
      flex: none;
      gap: 0.375rem;
      align-items: center;
    }

    .filter-toggle[aria-expanded='true'] {
      border-color: var(--admin-accent);
    }

    .filter-count {
      padding: 0.0625rem 0.375rem;
      border-radius: 0.5625rem;
      background: var(--admin-accent-wash);
      font-size: 0.75rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--admin-accent-on-wash);
    }

    .tools {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      justify-content: flex-end;
    }

    /* The rows of a column reach its edges, so that the wash of the open row
       is a band and not a box inside a box. */
    .rows {
      display: flex;
      flex-direction: column;
      margin-inline: calc(-1 * var(--admin-page-inline));
      border-block-end: 1px solid var(--admin-border);
      list-style: none;
    }

    button.row {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-page-inline);
      border: none;
      border-block-start: 1px solid var(--admin-border);
      border-radius: 0;
      background: none;
      text-align: start;
    }

    button.row.current {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    button.row:focus-visible {
      outline-offset: -2px;
    }

    .row-main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    .row-heading {
      overflow-wrap: anywhere;
    }

    .current .row-heading {
      font-weight: 600;
    }

    .row-line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
      align-items: center;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .current .row-line {
      color: var(--admin-accent-on-wash);
    }

    .row-trailing {
      flex: none;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .current .row-trailing {
      color: var(--admin-accent-on-wash);
    }

    .states {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
    }

    .state-chip {
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .state-chip.beside {
      margin-inline-start: var(--admin-space-2);
    }

    .state-chip[data-tone='good'] {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    /* On the wash of the open row the good state would be the wash on itself,
       so it takes the raised surface there. */
    .current .state-chip[data-tone='good'] {
      background: var(--admin-surface-raised);
    }

    .state-chip[data-tone='waiting'] {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .state-chip[data-tone='danger'] {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
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

    /* A notice is something that is true today rather than always, so it is on
       the page and not behind the info button. A tinted box takes the wash and
       the wash's ink, which is the rule the tokens file states. */
    .notice {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-waiting-on-wash);
      border-radius: var(--admin-radius);
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
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

    /* In the table the actions stay a cell. As a flex box the cell took the
       height of its buttons and not of its row, so its line sat above or below
       the line of the cells beside it once a row and a button stopped being
       the same height. */
    td.row-actions {
      display: table-cell;
      text-align: end;
      vertical-align: middle;
    }

    td.row-actions button {
      margin-block: 0.125rem;
      margin-inline-start: var(--admin-space-2);
    }

    button {
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
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

    .pick-cell {
      inline-size: 2.75rem;
    }

    .pick {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    input[type='checkbox'] {
      inline-size: 1.25rem;
      block-size: 1.25rem;
      accent-color: var(--admin-accent);
    }

    tr.picked td,
    .card.picked {
      background: var(--admin-accent-wash);
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
  /**
   * What the list draws above itself (admin plan 0042).
   *
   * - `page`: the page header, for a list that is the whole page.
   * - `pane`: a title and the add button, for a list that is a column beside
   *   the row that is open. That row's page draws the page header.
   * - `none`: the add button alone, for a list that is a tab of a page.
   */
  readonly heading = input<'page' | 'pane' | 'none'>('page');
  /**
   * The level of the `pane` title: 1 while nothing is open beside the column,
   * since the column is then all the page has, and 2 under an open row.
   */
  readonly headingLevel = input<1 | 2>(2);
  /** What the add button says, as a key. */
  readonly createKey = input('resource.action.create');
  /**
   * `rows` draws each row as one line of a column, from its `brief`, whatever
   * the width. `auto` is a table, or cards when {@link compact}.
   */
  readonly layout = input<'auto' | 'rows'>('auto');
  /** The row that is open beside a `rows` list, which is marked as current. */
  readonly currentId = input<string | null>(null);
  /**
   * A name that keeps the ids of this list's filters apart from those of
   * another list on the same page. Empty for a list that is the whole page.
   */
  readonly filterScope = input('');
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
  /** A failure with rows already on screen: a line, not a replacement. */
  readonly moreFailed = input(false);
  /** The key for whatever went wrong, chosen by the page. */
  readonly errorKey = input('resource.error.unknown');
  readonly empty = input(false);
  readonly noMatch = input(false);
  /** The search holds a record ID that no row of this resource has. */
  readonly idNotFound = input(false);
  /** What one row is called ("product"), as a key, for that sentence. */
  readonly oneKey = input('');
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
  /** What the info button in the header says. No button without it. */
  readonly info = input<InfoContent | null>(null);
  /**
   * Sentences that are true right now, as keys, above the rows.
   *
   * The info button explains the screen and never changes. These say what the screen
   * has just found out: that nothing is draining the queue it is showing, or
   * that a column could not be filled in. Empty is the ordinary case.
   */
  readonly noticeKeys = input<readonly string[]>([]);
  readonly namedActions = input<readonly NamedAction<ResourceRow>[]>([]);
  /** The row something is happening to, so its controls stop taking clicks. */
  readonly busyRowId = input<string | null>(null);

  /**
   * Whether rows draw a tick box, for a resource with bulk actions (admin plan
   * 0035, section 2). A tick only marks a row: what happens to the ticked rows
   * is the page's business, and always goes through a review first.
   */
  readonly selectable = input(false);
  /** The ticked rows, by id. */
  readonly selected = input<ReadonlySet<string>>(new Set());
  /** While a bulk panel is open, the ticks it was opened with hold still. */
  readonly selectionLocked = input(false);

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
  /** A row's tick box was pressed. */
  readonly pick = output<string>();

  /** Whether the filters behind the button of a column are shown. */
  readonly filtersOpen = signal(false);

  /** The filters a column keeps in view: what the operator types into. */
  readonly searchFilters = computed(() =>
    this.filters().filter((filter) => filter.kind === 'search')
  );

  /** The filters a column puts behind its button. */
  readonly otherFilters = computed(() =>
    this.filters().filter((filter) => filter.kind !== 'search')
  );

  readonly hasMoreFilters = computed(
    () => this.otherFilters().length > 0 || this.sorts().length > 0
  );

  /** How many of the filters behind the button are set, order included. */
  readonly narrowedBy = computed(() => {
    const values = this.filterValues();
    const set = this.otherFilters().filter(
      (filter) => (values[filter.param] ?? '') !== ''
    ).length;

    return set + (this.order() === undefined ? 0 : 1);
  });

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

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
