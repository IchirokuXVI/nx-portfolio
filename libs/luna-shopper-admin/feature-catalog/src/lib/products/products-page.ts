import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceListPage,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  FilterDescriptor,
  InfoContent,
  ResourceCell,
} from '@portfolio/luna-shopper-admin/models';
import {
  CATEGORY_TREE_ALL,
  CATEGORY_TREE_NONE,
  CategoryTree,
  PageHeader,
  PopoverSheet,
  ResourceCellView,
  ResourceFilters,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import type { Item } from '../items';
import { CategoryTreeStore } from './category-nodes';
import { PriceScopePicker } from './price-scope-picker';
import { formatPrice, formatSeen, formatSize } from './product-format';
import {
  PRICE_STATE_FILTER,
  PRICES_AT_FILTER,
  toPriceState,
  type PriceState,
  type ScopePriced,
} from './product-list-gateway';
import {
  PricesAtStore,
  type PriceScopeChoice,
  type ScopeRow,
} from './scope-choices';

/** What the info button of the product list says (admin plan 0043, target 9). */
export const PRODUCTS_INFO: InfoContent = {
  title: 'catalog.items.info.title',
  points: ['catalog.items.info.tick', 'catalog.items.info.scope'],
};

/** The filter the category tree sets. */
const CATEGORY_FILTER = 'categoryId';

/** What the Price cell of one row says. */
export type PriceCell =
  /** The shown price, as money. */
  | { readonly kind: 'price'; readonly text: string }
  /** The scope does not sell the product. */
  | { readonly kind: 'unavailable' }
  /** Nothing to say: the scope holds no price for the product. */
  | { readonly kind: 'none' };

/** One product, as the list draws it. */
export interface ProductRowView {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly size: string;
  readonly barcode: string;
  /** The group's name, as the cell the generic list would draw. */
  readonly group: ResourceCell;
  readonly price: PriceCell;
  /** When the shown price was seen, as words, or `''`. */
  readonly seen: string;
  /** Whether the shown price is out of date. */
  readonly stale: boolean;
}

/**
 * The product list (admin plan 0043, target 2).
 *
 * It is the list every resource has: the same store, the same filters, the
 * same ticks and the same bulk panels, all inherited. What is its own is what
 * a product needs and no other resource does:
 *
 * - **The category tree** beside the list on a wide screen, and behind a
 *   "Category" button that opens the same tree in a sheet on a narrow one. A
 *   press narrows the list, through the filter the list already had.
 * - **"Prices at"**, a picker of one price scope. With a scope the list gains
 *   a Price and a Seen column, read for the whole page in one request, and
 *   the one state the gateway can list by, "Out of date". The choice is kept
 *   for the operator.
 * - **Its own rows**: the name over the brand, the size, the barcode in the
 *   mono face, the group, and the price. Two lines on a phone.
 * - **A bar at the bottom** while rows are ticked, with what can be done to
 *   them.
 *
 * With a state chosen the page is read from the prices and not from the
 * products, because that is the read that can filter by state. Such a row
 * names its product and carries nothing else of it, so the search, the group
 * and the tree are put away, and the rows cannot be ticked: a review of a
 * change has to show what each product holds now, and these rows do not know.
 *
 * **Put away on every screen, the tree's column included.** The read of the
 * prices takes the scope and the state and nothing else, so a tree left
 * beside the rows would mark a category that the rows do not follow. A
 * category, a search or an order set before the state was chosen is kept and
 * not applied, the page says so in words, and all of it comes back with
 * "Any price".
 */
@Component({
  selector: 'lib-products-page',
  imports: [
    PageHeader,
    CategoryTree,
    PopoverSheet,
    PriceScopePicker,
    ResourceFilters,
    ResourceCellView,
    NgComponentOutlet,
    RouterLink,
    RokuTranslatorPipe,
  ],
  providers: [CategoryTreeStore],
  template: `
    <lib-page-header [heading]="descriptor.labels.many | rokuT" [info]="info">
      <button (click)="create()" class="primary" pageAction type="button">
        {{ 'catalog.items.add' | rokuT }}
      </button>
    </lib-page-header>

    <div [class.split]="withTree()" class="layout">
      @if (withTree()) {
        <aside class="tree">
          <h2>{{ 'catalog.categories.many' | rokuT }}</h2>
          <lib-category-tree
            (choose)="chooseCategory($event)"
            [label]="'catalog.categories.many' | rokuT"
            [nodes]="tree.nodes()"
            [selected]="category()"
          />
          @if (categoriesPath; as path) {
            <a [routerLink]="path" class="edit-tree">{{
              'catalog.categoryTree.edit' | rokuT
            }}</a>
          }
        </aside>
      }

      <section class="list">
        <!-- On a phone only the search stays in view. The group and the order
             open under a button, so that the first product is not a screen
             down. -->
        @if (state() === null) {
          <lib-resource-filters
            (filterChange)="store.setFilter($event.param, $event.value)"
            (orderChange)="store.setOrder($event)"
            [filters]="compact() ? searchFilters : shownFilters"
            [lookup]="lookup"
            [order]="store.order()"
            [sorts]="compact() ? [] : (descriptor.sorts ?? [])"
            [values]="store.filters()"
          />
        }

        <!-- One row: the category on a screen with no room for the tree, the
             scope the prices are read at, and the states of a price there. -->
        <div class="tools">
          @if (state() === null && !split()) {
            <button
              (click)="treeOpen.set(true)"
              [attr.aria-expanded]="treeOpen()"
              #categoryButton
              class="button pick"
              type="button"
              data-category-button
            >
              <span class="muted">{{
                'catalog.items.filter.categoryId' | rokuT
              }}</span>
              <span class="picked">{{
                categoryName() || ('resource.filter.any' | rokuT)
              }}</span>
            </button>
          }

          <lib-price-scope-picker
            (choiceChange)="chooseScope($event)"
            [choice]="scope()"
            [clearable]="true"
            [label]="'catalog.pricesAt.choose' | rokuT"
            [placeholder]="'catalog.pricesAt.none' | rokuT"
            [prefix]="'catalog.pricesAt.label' | rokuT"
            clearKey="catalog.pricesAt.clear"
          />

          @if (state() === null && compact()) {
            <button
              (click)="filtersOpen.set(!filtersOpen())"
              [attr.aria-expanded]="filtersOpen()"
              class="button pick"
              type="button"
              data-more-filters
            >
              {{ 'resource.filter.more' | rokuT }}
              @if (narrowedBy(); as count) {
                <span class="filter-count">{{ count }}</span>
              }
            </button>
          }

          @if (scope() !== null) {
            <div
              [attr.aria-label]="'catalog.pricesAt.state.label' | rokuT"
              class="segment"
              role="group"
            >
              @for (option of states; track option.value) {
                <button
                  (click)="chooseState(option.value)"
                  [attr.aria-pressed]="state() === option.value"
                  [attr.data-state]="option.value ?? 'any'"
                  [class.on]="state() === option.value"
                  type="button"
                >
                  {{ option.label | rokuT }}
                </button>
              }
            </div>
          }
        </div>

        @if (state() === null && compact() && filtersOpen()) {
          <lib-resource-filters
            (filterChange)="store.setFilter($event.param, $event.value)"
            (orderChange)="store.setOrder($event)"
            [filters]="otherFilters"
            [lookup]="lookup"
            [order]="store.order()"
            [sorts]="descriptor.sorts ?? []"
            [values]="store.filters()"
          />
        }

        @if (state() !== null) {
          <p class="note">{{ 'catalog.pricesAt.state.note' | rokuT }}</p>
          @if (suspended()) {
            <p class="note" data-suspended>
              {{ 'catalog.pricesAt.state.suspended' | rokuT }}
            </p>
          }
        }

        @if (refusal(); as refused) {
          <p class="refusal" role="alert" data-refusal>
            {{ refused.key | rokuT: { name: refused.name } }}
            <button (click)="refusal.set(null)" class="button" type="button">
              {{ 'resource.action.dismiss' | rokuT }}
            </button>
          </p>
        }

        @if (activeBulk(); as action) {
          <div #bulkPanel class="bulk-panel">
            <ng-container
              *ngComponentOutlet="action.panel; inputs: bulkInputs()"
            />
          </div>
        }

        @if (store.status() === 'loading') {
          <p class="state" role="status">
            {{ 'resource.list.loading' | rokuT }}
          </p>
        } @else if (failed()) {
          <div class="state error" role="alert">
            <p>{{ errorKey() | rokuT }}</p>
            <button (click)="store.load()" class="button" type="button">
              {{ 'resource.action.retry' | rokuT }}
            </button>
          </div>
        } @else if (store.idNotFound()) {
          <div class="state" role="status" data-id-not-found>
            <p>
              {{
                'resource.id.notFound'
                  | rokuT: { thing: descriptor.labels.one | rokuT }
              }}
            </p>
            <button (click)="clearFilters()" class="button" type="button">
              {{ 'resource.action.clearFilters' | rokuT }}
            </button>
          </div>
        } @else if (store.noMatch()) {
          <div class="state" role="status">
            <p>{{ 'resource.list.noMatch' | rokuT }}</p>
            <button (click)="clearFilters()" class="button" type="button">
              {{ 'resource.action.clearFilters' | rokuT }}
            </button>
          </div>
        } @else if (store.empty()) {
          <p class="state" role="status">
            {{ 'resource.list.empty' | rokuT }}
          </p>
        } @else if (compact()) {
          <ul class="cards">
            @for (row of products(); track row.id) {
              <li [class.picked]="isPicked(row.id)" class="card">
                @if (selectable()) {
                  <input
                    (change)="pick(row.id)"
                    [attr.aria-label]="
                      'resource.bulk.selectRow' | rokuT: { name: row.name }
                    "
                    [checked]="isPicked(row.id)"
                    [disabled]="activeBulk() !== null"
                    type="checkbox"
                    data-pick-row
                  />
                }
                <button
                  (click)="open(row.id)"
                  [attr.data-row]="row.id"
                  class="card-body"
                  type="button"
                >
                  <span class="line">
                    <span class="name">{{ row.name }}</span>
                    @if (row.brand !== '') {
                      <span class="muted">{{ row.brand }}</span>
                    }
                  </span>
                  <span class="line second">
                    <span class="muted grow">{{ row.size }}</span>
                    @switch (row.price.kind) {
                      @case ('price') {
                        @if (row.stale) {
                          <span class="chip bad">{{
                            'catalog.prices.stale' | rokuT
                          }}</span>
                        }
                        <span class="price">{{ row.price.text }}</span>
                      }
                      @case ('unavailable') {
                        <span class="chip">{{
                          'catalog.pricesAt.notSold' | rokuT
                        }}</span>
                      }
                    }
                  </span>
                </button>
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
                      <input
                        (change)="pickAll()"
                        [attr.aria-label]="'catalog.items.selectAll' | rokuT"
                        [checked]="allPicked()"
                        [disabled]="activeBulk() !== null"
                        type="checkbox"
                        data-pick-all
                      />
                    </th>
                  }
                  <th scope="col">{{ 'catalog.items.product' | rokuT }}</th>
                  @if (state() === null) {
                    <th scope="col">{{ 'catalog.items.unitSize' | rokuT }}</th>
                    <th scope="col">{{ 'catalog.items.ean' | rokuT }}</th>
                    <th scope="col">{{ 'catalog.items.group' | rokuT }}</th>
                  }
                  @if (scope() !== null) {
                    <th class="number" scope="col">
                      {{ 'catalog.prices.price' | rokuT }}
                    </th>
                    <th scope="col">{{ 'catalog.pricesAt.seen' | rokuT }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of products(); track row.id) {
                  <tr [class.picked]="isPicked(row.id)">
                    @if (selectable()) {
                      <td class="pick-cell">
                        <input
                          (change)="pick(row.id)"
                          [attr.aria-label]="
                            'resource.bulk.selectRow'
                              | rokuT: { name: row.name }
                          "
                          [checked]="isPicked(row.id)"
                          [disabled]="activeBulk() !== null"
                          type="checkbox"
                          data-pick-row
                        />
                      </td>
                    }
                    <td>
                      <button
                        (click)="open(row.id)"
                        [attr.data-row]="row.id"
                        class="title"
                        type="button"
                      >
                        {{ row.name }}
                      </button>
                      @if (row.brand !== '') {
                        <span class="brand">{{ row.brand }}</span>
                      }
                    </td>
                    @if (state() === null) {
                      <td>{{ row.size }}</td>
                      <td class="mono">{{ row.barcode }}</td>
                      <td><lib-resource-cell [cell]="row.group" /></td>
                    }
                    @if (scope() !== null) {
                      <td class="number">
                        @switch (row.price.kind) {
                          @case ('price') {
                            <span class="price">{{ row.price.text }}</span>
                          }
                          @case ('unavailable') {
                            <span class="chip">{{
                              'catalog.pricesAt.notSold' | rokuT
                            }}</span>
                          }
                        }
                      </td>
                      <td>
                        @if (row.stale) {
                          <span class="chip bad">{{
                            'catalog.prices.stale' | rokuT
                          }}</span>
                        } @else {
                          <span class="muted">{{ row.seen }}</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (moreFailed()) {
          <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
        }

        @if (store.hasMore()) {
          <button
            (click)="store.loadMore()"
            [disabled]="store.loadingMore()"
            class="button more"
            type="button"
          >
            {{
              (store.loadingMore()
                ? 'resource.list.loadingMore'
                : 'resource.action.more'
              ) | rokuT
            }}
          </button>
        }
      </section>
    </div>

    @if (selectedRows().length > 0 && activeBulk() === null) {
      <div class="bulk-bar" data-bulk-bar>
        <p aria-live="polite" class="bulk-count">
          {{
            'catalog.items.selected' | rokuT: { count: selectedRows().length }
          }}
        </p>
        @for (action of bulkActions; track action.name) {
          <button
            (click)="startBulk(action.name)"
            [attr.data-bulk]="action.name"
            type="button"
          >
            {{ action.label | rokuT }}
          </button>
        }
        <button
          (click)="clearSelection()"
          class="quiet"
          type="button"
          data-bulk-clear
        >
          {{ 'catalog.items.clearSelection' | rokuT }}
        </button>
      </div>
    }

    @if (treeOpen() && !split()) {
      <lib-popover-sheet
        (closed)="closeTree()"
        [heading]="'catalog.categories.many' | rokuT"
        [sheet]="true"
      >
        <lib-category-tree
          (choose)="chooseCategory($event)"
          [label]="'catalog.categories.many' | rokuT"
          [nodes]="tree.nodes()"
          [selected]="category()"
        />
      </lib-popover-sheet>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    .layout {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-inline-size: 0;
    }

    /* The tree reaches the edges of the page, and the list takes the page's
       own padding back, as the panes of a split do. */
    .layout.split {
      display: grid;
      grid-template-columns: 14.75rem minmax(0, 1fr);
      align-items: start;
      margin-inline: calc(-1 * var(--admin-page-inline));
      margin-block-end: calc(-1 * var(--admin-page-block));
    }

    .tree {
      position: sticky;
      inset-block-start: 0;
      display: flex;
      flex-direction: column;
      max-block-size: 100dvh;
      min-block-size: calc(100dvh - 5.75rem);
      overflow-y: auto;
      border-inline-end: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    .tree h2 {
      padding: var(--admin-space-3) var(--admin-space-4) var(--admin-space-2);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .edit-tree {
      margin-block-start: auto;
      padding: var(--admin-space-3) var(--admin-space-4);
      font-size: 0.8125rem;
      color: var(--admin-accent);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
      padding-block-start: var(--admin-page-block);
    }

    .split > .list {
      padding: var(--admin-space-4) var(--admin-page-inline)
        var(--admin-page-block);
    }

    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .button.pick {
      display: inline-flex;
      gap: var(--admin-space-2);
      align-items: center;
      max-inline-size: 100%;
      padding-inline: var(--admin-space-3);
      font-weight: 500;
    }

    .pick .muted {
      font-weight: 400;
      white-space: nowrap;
    }

    .picked {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .button[aria-expanded='true'] {
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

    .segment {
      display: inline-flex;
      max-inline-size: 100%;
      overflow: hidden;
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
    }

    .segment button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: none;
      border-inline-start: 1px solid var(--admin-border-strong);
      background: none;
      font: inherit;
      white-space: nowrap;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    .segment button:first-child {
      border-inline-start: none;
    }

    .segment button.on {
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .note,
    .muted {
      color: var(--admin-ink-muted);
    }

    .note {
      font-size: 0.8125rem;
    }

    .button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .primary {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid transparent;
      border-radius: var(--admin-radius-control);
      background: var(--admin-accent);
      font: inherit;
      font-weight: 600;
      white-space: nowrap;
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    .more {
      align-self: center;
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

    .state.error,
    .refusal {
      border: 1px solid var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }

    .refusal {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2) var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border-radius: var(--admin-radius);
      color: var(--admin-danger-on-wash);
    }

    .bulk-panel {
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      scroll-margin-block-start: var(--admin-space-4);
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
      padding: var(--admin-space-2) var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: middle;
    }

    th {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    tbody tr:last-child td {
      border-block-end: none;
    }

    .number {
      font-variant-numeric: tabular-nums;
      text-align: end;
      white-space: nowrap;
    }

    .pick-cell {
      inline-size: 2.75rem;
    }

    input[type='checkbox'] {
      flex: none;
      inline-size: 1.125rem;
      block-size: 1.125rem;
      accent-color: var(--admin-accent);
    }

    .title {
      display: block;
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-weight: 500;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .title:hover {
      color: var(--admin-accent);
    }

    .brand {
      display: block;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .mono {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
    }

    .price {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .chip {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      color: var(--admin-neutral-on-wash);
    }

    .chip.bad {
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    tr.picked td,
    .card.picked {
      background: var(--admin-accent-wash);
    }

    .cards {
      display: flex;
      flex-direction: column;
      margin-inline: calc(-1 * var(--admin-page-inline));
      border-block: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
      list-style: none;
    }

    .card {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      padding-inline-start: var(--admin-page-inline);
      border-block-start: 1px solid var(--admin-border);
    }

    .card:first-child {
      border-block-start: none;
    }

    .card-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
      min-block-size: 3.25rem;
      justify-content: center;
      padding: var(--admin-space-2) var(--admin-page-inline)
        var(--admin-space-2) 0;
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .line {
      display: flex;
      gap: var(--admin-space-2);
      align-items: baseline;
      min-inline-size: 0;
    }

    .line .name {
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .line.second {
      align-items: center;
      font-size: 0.875rem;
    }

    .grow {
      flex: 1;
    }

    /* In view at the bottom while the list scrolls. On a phone it sits above
       the navigation bar, which is fixed below it. */
    .bulk-bar {
      position: sticky;
      inset-block-end: 0;
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
      margin-block-start: auto;
      margin-inline: calc(-1 * var(--admin-page-inline));
      padding: var(--admin-space-2) var(--admin-page-inline);
      background: var(--admin-ink);
      color: var(--admin-surface-raised);
    }

    @media (max-width: 47.99rem) {
      .bulk-bar {
        inset-block-end: var(--admin-bar);
      }
    }

    .bulk-count {
      flex: 1;
      min-inline-size: 8rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .bulk-bar button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-surface-raised);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .bulk-bar button.quiet {
      border-color: var(--admin-ink-muted);
      background: none;
      color: var(--admin-surface-raised);
    }

    button:focus-visible,
    a:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .bulk-bar button:focus-visible {
      outline-color: var(--admin-surface-raised);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsPage extends ResourceListPage {
  private readonly _translate = inject(RokuTranslatorService);
  private readonly _locales = inject(ContentLocaleStore);
  private readonly _resources = inject(ResourceRegistry);
  private readonly _pricesAt = inject(PricesAtStore);
  private readonly _view = inject(Viewport);

  private readonly _categoryButton =
    viewChild<ElementRef<HTMLButtonElement>>('categoryButton');
  private readonly _bulkPanel = viewChild<ElementRef<HTMLElement>>('bulkPanel');

  readonly tree = inject(CategoryTreeStore);

  readonly info = PRODUCTS_INFO;
  readonly split = this._view.split;

  /** The filters drawn as controls: every one but the tree's. */
  readonly shownFilters: readonly FilterDescriptor[] = this.filters.filter(
    (filter) => filter.param !== CATEGORY_FILTER
  );

  /** What a phone keeps in view: the field the operator types into. */
  readonly searchFilters = this.shownFilters.filter(
    (filter) => filter.kind === 'search'
  );

  /** What a phone puts behind its "Filters" button, with the order. */
  readonly otherFilters = this.shownFilters.filter(
    (filter) => filter.kind !== 'search'
  );

  /** Whether those are shown, on a phone. */
  readonly filtersOpen = signal(false);

  /** How many of the filters behind the button are set, the order included. */
  readonly narrowedBy = computed(() => {
    const values = this.store.filters();
    const set = this.otherFilters.filter(
      (filter) => (values[filter.param] ?? '') !== ''
    ).length;
    return set + (this.store.order() === undefined ? 0 : 1);
  });

  /** Where the Categories tab is, for the link under the tree. */
  readonly categoriesPath = this._resources.pathOf('categories');

  /** Whether the tree's sheet is open, on a screen with no room for the column. */
  readonly treeOpen = signal(false);

  /** The states a scope can be narrowed to. `null` is every product. */
  readonly states: readonly {
    readonly value: PriceState | null;
    readonly label: string;
  }[] = [
    { value: null, label: 'catalog.pricesAt.state.any' },
    { value: 'stale', label: 'catalog.pricesAt.state.stale' },
  ];

  /**
   * The scope the list shows prices at, with its chain, or `null`.
   *
   * The operator's kept choice, unless the link that opened the list named
   * another scope: that one is then shown, and named once it is read.
   */
  private readonly _linked = signal<PriceScopeChoice | null>(null);
  readonly scope = computed<PriceScopeChoice | null>(() => {
    const id = this.store.filters()[PRICES_AT_FILTER] ?? '';
    if (id === '') {
      return null;
    }
    const kept = this._pricesAt.choice();
    if (kept?.scope.id === id) {
      return kept;
    }
    const linked = this._linked();
    return linked?.scope.id === id ? linked : unnamed(id);
  });

  /** The state the list is narrowed to, or `null`. */
  readonly state = computed<PriceState | null>(() =>
    this.scope() === null
      ? null
      : toPriceState(this.store.filters()[PRICE_STATE_FILTER])
  );

  /**
   * Whether the tree's column is drawn: on a wide screen, and not while the
   * rows are read from the prices, which no category narrows.
   */
  readonly withTree = computed(() => this.split() && this.state() === null);

  /**
   * Whether a state is chosen while something else narrows or orders the
   * list. None of it reaches the read of the prices, so the page says that it
   * is set aside.
   */
  readonly suspended = computed(() => {
    if (this.state() === null) {
      return false;
    }
    const narrowed = Object.entries(this.store.filters()).some(
      ([param, value]) =>
        param !== PRICES_AT_FILTER &&
        param !== PRICE_STATE_FILTER &&
        value !== ''
    );
    return narrowed || this.store.order() !== undefined;
  });

  /** What the tree marks: a category, every product, or no category. */
  readonly category = computed(
    () => this.store.filters()[CATEGORY_FILTER] ?? CATEGORY_TREE_ALL
  );

  /** What the "Category" button says on a narrow screen, or `''` for any. */
  readonly categoryName = computed(() => {
    const chosen = this.category();
    if (chosen === CATEGORY_TREE_ALL) {
      return '';
    }
    // Read so that the words follow the catalogue once it has loaded.
    this._translate.loaded();
    return chosen === CATEGORY_TREE_NONE
      ? this._translate.t('catalog.categoryTree.none')
      : this.tree.nameOf(chosen) || chosen;
  });

  /**
   * Whether rows can be ticked. Not while the page is read from the prices:
   * those rows do not carry what a review has to show.
   */
  readonly selectable = computed(
    () => this.bulkActions.length > 0 && this.state() === null
  );

  /** The rows, as this list draws them. */
  readonly products = computed<readonly ProductRowView[]>(() => {
    const locale = this._translate.locale();
    const now = Date.now();

    return this.rows().map((view) => {
      const row = view.row as unknown as Item & ScopePriced;
      const price = row.scopePrice ?? null;

      return {
        id: view.id,
        name: view.title === '' ? view.id : view.title,
        brand: typeof row.brand === 'string' ? row.brand : '',
        size: row.partial === true ? '' : formatSize(row, locale),
        barcode: typeof row.ean === 'string' ? row.ean : '',
        group: view.cells['productGroupId'] ?? {
          text: '',
          key: 'resource.value.none',
        },
        price: priceCell(price, locale),
        seen:
          price === null || price.price === null || price.available === false
            ? ''
            : formatSeen(price.observedAt, now, locale),
        stale:
          price !== null &&
          price.price !== null &&
          price.available !== false &&
          price.stale === true,
      };
    });
  });

  /** Whether every row on screen is ticked. */
  readonly allPicked = computed(() => {
    const rows = this.rows();
    return rows.length > 0 && rows.every((row) => this.selected().has(row.id));
  });

  constructor() {
    super();

    void this.tree.load();

    // The tree is named in the language the catalog is read in, and its rows
    // were ordered in the one they were read in. A switch reads them again,
    // as the list beside it does.
    let readIn = this._locales.locale();
    effect(() => {
      const locale = this._locales.locale();
      untracked(() => {
        if (locale !== readIn) {
          readIn = locale;
          void this.tree.load();
        }
      });
    });

    void this._nameLinkedScope();
  }

  /**
   * The list opens at the scope the operator chose last, unless the link that
   * opened it names one.
   *
   * It runs while the page is being built, so it reads through `inject` and
   * through no field of this class.
   */
  protected override initialFilters(): Record<string, string> {
    const filters = super.initialFilters();
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const linked = params.get(PRICES_AT_FILTER);
    const scopeId =
      linked !== null && linked !== ''
        ? linked
        : (inject(PricesAtStore).choice()?.scope.id ?? '');

    if (scopeId === '') {
      return filters;
    }

    const state = toPriceState(params.get(PRICE_STATE_FILTER));
    return {
      ...filters,
      [PRICES_AT_FILTER]: scopeId,
      ...(state === null ? {} : { [PRICE_STATE_FILTER]: state }),
    };
  }

  isPicked(id: string): boolean {
    return this.selected().has(id);
  }

  /** Tick every row on screen, or untick them when they all are. */
  pickAll(): void {
    if (this.activeBulk() !== null) {
      return;
    }
    this.selected.set(
      this.allPicked() ? new Set() : new Set(this.rows().map((row) => row.id))
    );
  }

  /** Open one bulk action's panel, and bring it into view above the rows. */
  startBulk(name: string): void {
    const action = this.bulkActions.find((entry) => entry.name === name);
    if (action === undefined) {
      return;
    }
    this.openBulk(action);
    // After the panel is drawn. A browser without the method, which is the
    // one the specs run in, leaves the page where it is.
    setTimeout(() => {
      this._bulkPanel()?.nativeElement.scrollIntoView?.({ block: 'start' });
    });
  }

  /** A category of the tree was pressed. */
  chooseCategory(id: string): void {
    this.closeTree();
    if (id !== this.category()) {
      void this.store.setFilter(CATEGORY_FILTER, id);
    }
  }

  /** Close the tree's sheet, and put the focus back on its button. */
  closeTree(): void {
    if (!this.treeOpen()) {
      return;
    }
    this.treeOpen.set(false);
    this._categoryButton()?.nativeElement.focus();
  }

  /** A scope was chosen in "Prices at", or the choice was cleared. */
  async chooseScope(choice: PriceScopeChoice | null): Promise<void> {
    this._pricesAt.choose(choice);

    if (choice === null && this.state() !== null) {
      // The state means nothing without a scope. One read after the other, so
      // that the second answer is the one left on screen.
      await this.store.setFilter(PRICE_STATE_FILTER, '');
    }
    await this.store.setFilter(PRICES_AT_FILTER, choice?.scope.id ?? '');
  }

  /** Narrow the list to one state of the price at the scope, or to none. */
  chooseState(state: PriceState | null): void {
    if (state === this.state()) {
      return;
    }
    // Rows read from the prices cannot be ticked, and rows ticked before are
    // not on screen any more.
    this.clearSelection();
    void this.store.setFilter(PRICE_STATE_FILTER, state ?? '');
  }

  /**
   * The way out of an empty filtered list: every filter goes, and the scope
   * stays, since it narrows nothing and is the operator's kept choice.
   */
  async clearFilters(): Promise<void> {
    const scopeId = this.scope()?.scope.id ?? '';
    await this.store.clear();
    if (scopeId !== '') {
      await this.store.setFilter(PRICES_AT_FILTER, scopeId);
    }
  }

  /**
   * Name the scope a link asked for, when it is not the kept one. The button
   * says the id until both reads answer, and keeps saying it when either
   * fails.
   */
  private async _nameLinkedScope(): Promise<void> {
    const id = this.store.filters()[PRICES_AT_FILTER] ?? '';
    if (id === '' || this._pricesAt.choice()?.scope.id === id) {
      return;
    }

    const scope = (await this.references.resolve('price-scopes', id))?.row as
      | ScopeRow
      | undefined;
    if (scope === undefined) {
      return;
    }
    const chain = (
      await this.references.resolve('supermarkets', scope.supermarketId)
    )?.row as PriceScopeChoice['chain'] | undefined;
    if (chain !== undefined) {
      this._linked.set({ chain, scope });
    }
  }
}

/** A scope known by its id alone, until it is read. */
function unnamed(id: string): PriceScopeChoice {
  return {
    chain: { id: '', name: {}, defaultPriceScopeId: null },
    scope: {
      id,
      supermarketId: '',
      kind: 'NATIONAL',
      externalKey: id,
      label: null,
    },
  };
}

/** What the Price cell says for the row the gateway gave, or for none. */
function priceCell(
  price: ScopePriced['scopePrice'],
  locale: string
): PriceCell {
  if (price === null || price === undefined) {
    return { kind: 'none' };
  }
  // What the scope says about stock comes first: a price it once had says
  // nothing to a shopper who cannot buy the product there.
  if (price.available === false) {
    return { kind: 'unavailable' };
  }
  return price.price === null
    ? { kind: 'none' }
    : {
        kind: 'price',
        text: formatPrice(price.price, price.currency, locale),
      };
}
