import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { ErrorLinkTarget } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { CATEGORIES } from '../categories';
import { CategoryTreeStore, type CategoryNode } from './category-nodes';

/** The filter of the product list that a count opens it narrowed by. */
const CATEGORY_FILTER = 'categoryId';

/**
 * The category tree, as the thing being edited (admin plan 0043, target 5).
 *
 * The two levels drawn as they are: each top level category with the
 * categories inside it, and the product count of each. It was a flat list
 * filtered by parent, where the tree had to be worked out from a "Parent"
 * column.
 *
 * A name opens the category's form. A count opens the product list narrowed
 * to that category, which is where an operator goes to move products before a
 * category can be deleted. Create, edit and delete are what they were: the
 * same forms and the same refusals, said here on the row they are about.
 *
 * The search narrows the tree in the browser. The tree is a few dozen rows
 * and is read whole, so there is nothing to ask the gateway for.
 */
@Component({
  selector: 'lib-categories-page',
  imports: [
    PageHeader,
    RouterLink,
    ConfirmDialog,
    ChevronLeftIcon,
    NgTemplateOutlet,
    RokuTranslatorPipe,
  ],
  providers: [CategoryTreeStore],
  template: `
    <lib-page-header [heading]="descriptor.labels.many | rokuT">
      <button (click)="create()" class="primary" pageAction type="button">
        {{ 'catalog.categories.add' | rokuT }}
      </button>
    </lib-page-header>

    <label class="search">
      <span>{{ 'catalog.categories.filter.query' | rokuT }}</span>
      <input
        (input)="term.set($any($event.target).value)"
        [value]="term()"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        type="search"
        data-category-search
      />
    </label>

    @if (refusal(); as refused) {
      <p class="refusal" role="alert" data-refusal>
        {{ refused.key | rokuT: { name: refused.name } }}
        @if (refused.link; as link) {
          <a
            [queryParams]="link.queryParams ?? null"
            [routerLink]="link.commands"
            >{{ link.labelKey | rokuT }}</a
          >
        }
        <button (click)="refusal.set(null)" class="button" type="button">
          {{ 'resource.action.dismiss' | rokuT }}
        </button>
      </p>
    }

    @if (tree.status() === 'loading' && tree.rows().length === 0) {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    } @else if (tree.status() === 'error') {
      <div class="state error" role="alert">
        <p>{{ tree.errorKey() ?? 'resource.error.unknown' | rokuT }}</p>
        <button (click)="tree.load()" class="button" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </div>
    } @else if (tree.rows().length === 0) {
      <p class="state" role="status">{{ 'resource.list.empty' | rokuT }}</p>
    } @else if (shown().length === 0) {
      <div class="state" role="status">
        <p>{{ 'resource.list.noMatch' | rokuT }}</p>
        <button (click)="term.set('')" class="button" type="button">
          {{ 'resource.action.clearFilters' | rokuT }}
        </button>
      </div>
    } @else {
      <ul class="tree">
        @for (root of shown(); track root.id) {
          <li>
            <div class="row root">
              @if (root.children.length > 0) {
                <button
                  (click)="toggle(root.id)"
                  [attr.aria-expanded]="isOpen(root.id)"
                  [attr.aria-label]="
                    (isOpen(root.id)
                      ? 'catalog.categoryTree.close'
                      : 'catalog.categoryTree.open'
                    ) | rokuT: { name: root.name }
                  "
                  [class.open]="isOpen(root.id)"
                  class="twist"
                  type="button"
                >
                  <lib-chevron-left-icon />
                </button>
              } @else {
                <span class="twist"></span>
              }
              <ng-container
                *ngTemplateOutlet="cells; context: { $implicit: root }"
              />
            </div>

            @if (isOpen(root.id) && root.children.length > 0) {
              <ul>
                @for (child of root.children; track child.id) {
                  <li>
                    <div class="row child">
                      <ng-container
                        *ngTemplateOutlet="cells; context: { $implicit: child }"
                      />
                    </div>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    }

    <ng-template #cells let-node>
      <span class="main">
        <button
          (click)="open(node.id)"
          [attr.data-category]="node.id"
          class="name"
          type="button"
        >
          {{ node.name }}
        </button>
        <span class="slug">{{ node.row.slug }}</span>
      </span>
      @if (node.count !== null && productsPath !== null) {
        <a
          [attr.aria-label]="
            'catalog.categories.products'
              | rokuT: { count: number(node.count), name: node.name }
          "
          [queryParams]="filterBy(node.id)"
          [routerLink]="productsPath"
          class="count"
          data-category-count
          >{{ number(node.count) }}</a
        >
      }
      <button
        (click)="askToDelete(node)"
        [attr.aria-label]="
          'catalog.categories.delete' | rokuT: { name: node.name }
        "
        [disabled]="busy()"
        class="button danger"
        type="button"
        data-category-delete
      >
        {{ 'resource.action.delete' | rokuT }}
      </button>
    </ng-template>

    @if (deleting(); as node) {
      <lib-confirm-dialog
        (confirm)="confirmDelete()"
        (dismiss)="deleting.set(null)"
        [bodyArgs]="{ name: node.name }"
        [busy]="busy()"
        bodyKey="resource.confirm.delete.body"
        confirmKey="resource.confirm.delete.confirm"
        headingKey="resource.confirm.delete.heading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    .search {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      max-inline-size: 24rem;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .search input {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: var(--admin-field-size);
      color: var(--admin-ink);
    }

    ul {
      display: flex;
      flex-direction: column;
      list-style: none;
    }

    .tree {
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .row {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--admin-space-1) var(--admin-space-3) var(--admin-space-1) 0;
      border-block-start: 1px solid var(--admin-border);
    }

    .tree > li:first-child > .row.root {
      border-block-start: none;
    }

    /* Past the chevron of the category it is inside, and then some. */
    .row.child {
      padding-inline-start: 4rem;
    }

    .twist {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      inline-size: 2.5rem;
      min-block-size: 2.25rem;
      padding: 0;
      border: none;
      background: none;
      color: var(--admin-ink-muted);
    }

    button.twist {
      cursor: pointer;
    }

    /* The one chevron the app has points back. Turned, it points right for a
       closed category and down for an open one. */
    .twist lib-chevron-left-icon {
      inline-size: 1rem;
      block-size: 1rem;
      rotate: 180deg;
    }

    .twist.open lib-chevron-left-icon {
      rotate: -90deg;
    }

    .main {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 0 var(--admin-space-3);
      align-items: baseline;
      min-inline-size: 0;
    }

    .name {
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-weight: 500;
      text-align: start;
      overflow-wrap: anywhere;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .root .name {
      font-weight: 600;
    }

    .name:hover {
      color: var(--admin-accent);
    }

    .slug {
      font-family: var(--admin-font-mono);
      font-size: 0.75rem;
      color: var(--admin-ink-muted);
    }

    .count {
      flex: none;
      min-inline-size: 3rem;
      padding: 0.125rem 0.375rem;
      font-variant-numeric: tabular-nums;
      text-align: end;
      color: var(--admin-accent);
    }

    .button,
    .primary {
      flex: none;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      white-space: nowrap;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .primary {
      padding-inline: var(--admin-space-4);
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .button.danger {
      border-color: var(--admin-danger);
      color: var(--admin-danger);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible,
    a:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
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
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .refusal > button {
      margin-inline-start: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _translate = inject(RokuTranslatorService);

  readonly tree = inject(CategoryTreeStore);
  readonly descriptor = CATEGORIES;

  /** Where the product list is, for the link on a count. */
  readonly productsPath = this._registry.pathOf('items');

  /** What is typed to find a category by its name or its handle. */
  readonly term = signal('');

  /** The top level categories the operator closed, by id. Open is the rule. */
  private readonly _closed = signal<ReadonlySet<string>>(new Set());

  readonly busy = signal(false);
  readonly deleting = signal<CategoryNode | null>(null);
  /** A delete the gateway refused, said above the tree. */
  readonly refusal = signal<{
    readonly key: string;
    readonly name: string;
    readonly link: ErrorLinkTarget | null;
  } | null>(null);

  /**
   * The tree, narrowed by what was typed. A top level category stays when it
   * matches or when one inside it does, and then shows only those that do.
   */
  readonly shown = computed<readonly CategoryNode[]>(() => {
    const term = this.term().trim().toLowerCase();
    const nodes = this.tree.nodes();
    if (term === '') {
      return nodes;
    }
    const matches = (node: CategoryNode) =>
      `${node.name} ${node.row.slug}`.toLowerCase().includes(term);

    return nodes.flatMap((root) => {
      if (matches(root)) {
        return [root];
      }
      const children = root.children.filter(matches);
      return children.length === 0 ? [] : [{ ...root, children }];
    });
  });

  constructor() {
    void this.tree.load();

    // The rows were ordered in the language they were read in, so a switch
    // of the content language reads them again.
    let readIn = this._content.locale();
    effect(() => {
      const locale = this._content.locale();
      untracked(() => {
        if (locale !== readIn) {
          readIn = locale;
          void this.tree.load();
        }
      });
    });
  }

  /** Open while searching, so that a match inside a closed category shows. */
  isOpen(id: string): boolean {
    return this.term().trim() !== '' || !this._closed().has(id);
  }

  toggle(id: string): void {
    const next = new Set(this._closed());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this._closed.set(next);
  }

  /** The product list's filter for one category, as query parameters. */
  filterBy(id: string): Record<string, string> {
    return { [CATEGORY_FILTER]: id };
  }

  /** A count with the separators of the interface language. */
  number(value: number): string {
    return new Intl.NumberFormat(this._translate.locale()).format(value);
  }

  create(): void {
    void this._router.navigate(['new'], { relativeTo: this._route });
  }

  open(id: string): void {
    void this._router.navigate([id], { relativeTo: this._route });
  }

  askToDelete(node: CategoryNode): void {
    this.refusal.set(null);
    this.deleting.set(node);
  }

  async confirmDelete(): Promise<void> {
    const node = this.deleting();
    if (node === null) {
      return;
    }
    this.busy.set(true);
    try {
      await this.tree.remove(node.id);
      this._changes.wrote(this.descriptor.name);
    } catch (thrown) {
      const error = toGatewayError(thrown);
      const declared = this.descriptor.errorLinks?.[error.code];
      this.refusal.set({
        key: gatewayErrorKey(error) ?? 'resource.error.unknown',
        name: node.name,
        // A link that names no detail is about the category itself.
        link:
          declared === undefined
            ? null
            : this._registry.linkFor(
                declared,
                declared.detail === undefined
                  ? node.id
                  : (error.detailString(declared.detail) ?? node.id)
              ),
      });
    } finally {
      this.deleting.set(null);
      this.busy.set(false);
    }
  }
}
